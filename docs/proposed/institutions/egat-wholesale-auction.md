# EGAT Wholesale Auction Program (`egat`) — PROPOSED

> **⚠️ STATUS: PROPOSED (new program, 2026-07-10).** Not built. Target spec in the
> [`docs/programs/`](../../programs/README.md) house style. Existing-side touch points are
> cited `path:line`; everything under this program's own crate is a target design. See the
> [design-set index](./README.md) for shared conventions and the authority graph.

## Abstract

The `egat` program is the on-chain **wholesale generation auction** operated by the
Electricity Generating Authority of Thailand (EGAT / กฟผ) in its statutory role as
transmission monopoly and Single Buyer under Thailand's Enhanced Single Buyer (ESB) market
structure ([`thailand-market-context.md`](../../design/thailand-market-context.md) §"Current
state"). Where the existing [`trading`](../../programs/trading.md) program runs the *retail*
peer-to-peer continuous double auction, `egat` runs the *bulk* side that
[`role-map.md`](../../design/role-map.md) §1 tags as EGAT's "wholesale generation-auction
operator (bulk sellers clear here — separate, not-yet-built segment)". It collects step-wise
generation offers from licensed bulk generators (IPPs, SPPs, EGAT-owned plants) for each
delivery period of a day-ahead session, clears them against EGAT's forecast demand by
merit order, and produces per-period award records at a uniform System Marginal Price (SMP).
Awards feed the wholesale market segment of `trading` (`ZoneMarket.segment == 1`,
[`trading/src/state/zone_market.rs:18`](../../../programs/trading/src/state/zone_market.rs))
and, on physical delivery, reconcile against `energy-token::mint_generation`. The program is
the authoritative record of who was dispatched, at what price, for which period — the ledger
the ESB settlement runs on.

---

## 1. Program Identity

| Property | Value |
| --- | --- |
| Program ID | **Unassigned** — `anchor keys sync`, then `declare_id!` + `Anchor.toml` |
| Crate name | `egat` |
| Crate version | `0.1.0` (target) |
| Description | "EGAT wholesale generation auction — day-ahead merit-order clearing (ESB)" |
| Edition | 2021 |

### Dependencies (target)

| Dependency | Version / Source | Role |
| --- | --- | --- |
| `anchor-lang` | `1.0.0` (feature `init-if-needed`) | Framework |
| `anchor-spl` | `1.0.0` | Token settlement helpers |
| `bytemuck` | `1.20.0` (feature `derive`) | Pod / zero-copy for auction state |
| `governance` | path `../governance`, feature `cpi` | `GovernanceConfig::is_operational`; generator-licence cross-check (types + ID only) |
| `trading` | path `../trading`, feature `cpi` | Feed cleared awards into the wholesale segment; re-use `AuctionOrder`/clearing types |
| `treasury` | path `../treasury`, feature `cpi` | `record_settlement` of cleared wholesale value |
| `energy-token` | path `../energy-token`, feature `cpi` | Types only — reconcile delivery mint (`GenerationMintRecord`, [`energy-token/src/state.rs:27`](../../../programs/energy-token/src/state.rs)) |
| `compute-debug` | path `../../shared/compute-debug`, optional | CU profiling under `localnet` |

---

## 2. System Role

EGAT sits above the retail P2P layer. Its market is **day-ahead and periodic**, not
continuous: a session opens for the next delivery day, generators submit offers until gate
closure, EGAT (the single buyer) posts forecast demand per delivery period, and the program
clears each period independently by merit order. This differs from `trading`'s continuous
double auction ([`trading.md`](../../programs/trading.md) §2.1) in three ways that justify a
separate program rather than another `trading` instruction:

1. **Bulk, licensed sellers** — participants are registered generators with a licensed
   capacity ceiling and fuel/plant type, not anonymous prosumers.
2. **Day-ahead session lifecycle** — gate-open → gate-close → clear → settle, with delivery
   periods (e.g. 48 half-hours or 24 hours) rather than always-on order books.
3. **Single-buyer demand** — the demand curve is EGAT's forecast, not matched counterparty
   orders, reflecting the ESB structure where EGAT procures and resells all bulk generation.

The program is deliberately passive about *physical* delivery: actual generated energy still
flows through the AMI → [`oracle`](../../programs/oracle.md) →
`energy-token::mint_generation` idempotent bridge
([`node-validator.md`](../../design/node-validator.md) §4). `egat` records the *financial*
award (dispatched quantity × SMP); delivery reconciliation matches the award against the
minted GRID for the same generator and window.

---

## 3. State Model

### 3.1 `WholesaleMarket` (zero-copy singleton)

PDA seed `[b"wholesale_market"]`. Read-only on the hot offer-submission path (Sealevel).

| Field | Type | Meaning |
| --- | --- | --- |
| `authority` | `Pubkey` | EGAT operator authority (target: k-of-n vault; a `Signer` check accepts a multisig PDA identically, per `role-map.md` §2 row 1). |
| `governance` | `Pubkey` | Bound `governance_config` for the maintenance gate. |
| `clearing_rule` | `u8` | 0 = uniform SMP, 1 = pay-as-bid. |
| `num_periods` | `u8` | Delivery periods per session (e.g. 24 or 48). |
| `price_floor` | `u64` | Min offer price (6-dp THB/kWh, matches `price_per_kwh`). |
| `price_cap` | `u64` | Max offer/clearing price; 0 = uncapped. |
| `current_session` | `u64` | Monotonic session counter. |
| `settlement_thbg_mint` | `Pubkey` | THBG mint used for `treasury::record_settlement`. |
| `total_sessions_cleared` | `u64` | Stale-on-purpose global stat. |
| `total_wholesale_volume` | `u64` | Cumulative cleared energy. |
| `active` | `u8` | 1 = accepting sessions. |
| `_padding` | `[u8; N]` | Recount by hand when adding fields. |

### 3.2 `GeneratorRegistration` (regular `#[account]`, per generator)

PDA seed `[b"generator", generator.as_ref()]` — one per bulk seller (per-entity PDA).

| Field | Type | Meaning |
| --- | --- | --- |
| `generator` | `Pubkey` | Generator signing key. |
| `licensed_capacity` | `u64` | Max offerable quantity per period (base units). |
| `fuel_type` | `u8` | 0=gas,1=coal,2=hydro,3=solar,4=wind,5=SMR/nuclear,6=other (tracks PDP2026 mix). |
| `node_zone` | `u32` | Transmission node / zone binding. |
| `rec_eligible` | `u8` | 1 = renewable, REC-issuable on delivery. |
| `status` | `u8` | 0=Active,1=Suspended,2=Deregistered. |
| `registered_at` | `i64` | — |
| `bump` | `u8` | — |

### 3.3 `AuctionSession` (zero-copy, per session)

PDA seed `[b"auction", &session_id.to_le_bytes()]`.

| Field | Type | Meaning |
| --- | --- | --- |
| `session_id` | `u64` | — |
| `delivery_date` | `i64` | Unix seconds, day boundary. |
| `gate_close_ts` | `i64` | Offers rejected at/after this instant. |
| `status` | `u8` | 0=Open,1=Closed,2=Cleared,3=Settled. |
| `num_periods` | `u8` | Copied from market at open. |
| `demand_forecast` | `[u64; MAX_PERIODS]` | Single-buyer demand per period (base units). |
| `clearing_price` | `[u64; MAX_PERIODS]` | SMP per period, set at clear (0 until cleared). |
| `cleared_volume` | `[u64; MAX_PERIODS]` | Matched quantity per period. |
| `_padding` | `[u8; N]` | — |

`MAX_PERIODS` (e.g. 48) is fixed to keep the account Pod-sized and within transaction limits,
the same discipline `trading` uses for `MAX_DEPTH_LEVELS = 10`
([`zone_market.rs:7`](../../../programs/trading/src/state/zone_market.rs)).

### 3.4 `GenerationOffer` (zero-copy, per generator per session)

PDA seed `[b"offer", &session_id.to_le_bytes(), generator.as_ref()]` — **hot path**, per-entity
so concurrent generators' submissions touch disjoint write sets.

| Field | Type | Meaning |
| --- | --- | --- |
| `session_id` | `u64` | — |
| `generator` | `Pubkey` | — |
| `steps` | `[OfferStep; MAX_STEPS]` | Price/quantity ladder (Pod sub-struct). |
| `step_count` | `u8` | Valid steps. |
| `period_mask` | `u64` | Bitmask of periods this offer applies to. |
| `submitted_at` | `i64` | — |
| `_padding` | `[u8; N]` | — |

`OfferStep { price_per_kwh: u64, quantity: u64 }` (`#[repr(C)]`, Pod). Merit order sorts steps
ascending by `price_per_kwh`.

### 3.5 `AwardRecord` (regular `#[account]`, per generator-session-period) — settlement + replay guard

PDA seed `[b"award", &session_id.to_le_bytes(), generator.as_ref(), &[period]]`. Created at
`execute_wholesale_awards`; its existence is the **exactly-once** guard against re-settling the
same award (mirrors the `TradeNullifier` pattern,
[`trading/src/state/nullifier.rs:15`](../../../programs/trading/src/instructions/settle_offchain.rs)).
Fields: `session_id`, `generator`, `period`, `cleared_quantity`, `clearing_price`,
`settled` (`u8`), `delivered_quantity` (reconciled from minted GRID), `bump`.

---

## 4. Instruction Set

Every state-mutating instruction gates on `governance::is_operational()` → `MaintenanceMode`,
wraps its body in `compute_fn!`, and hoists `Clock::get()` before `emit!`.

**`initialize_wholesale_market(clearing_rule, num_periods, price_floor, price_cap, settlement_thbg_mint)`**
— Signer: `authority` (becomes `WholesaleMarket.authority`). `init` the singleton.

**`register_generator(generator, licensed_capacity, fuel_type, node_zone, rec_eligible)`** —
Signer: `authority`. `init` a `GeneratorRegistration`. Licensing is EGAT's call; a
governance-side licence cross-check (an admitted-aggregator-style entry, segment = Wholesale)
may additionally be required — see §6.

**`open_auction_session(session_id, delivery_date, gate_close_ts, demand_forecast: Vec<u64>)`**
— Signer: `authority`. Preconditions: `session_id == current_session + 1` (monotonic);
`demand_forecast.len() == num_periods`; `gate_close_ts > now`; `delivery_date` in the future.
`init` `AuctionSession` (status `Open`), copy demand, bump `current_session`. Emits
`AuctionSessionOpened`.

**`submit_generation_offer(session_id, steps: Vec<OfferStep>, period_mask)`** — Signer:
`generator`. Preconditions: session `Open`; `now < gate_close_ts` else `GateClosed`; generator
`Active`; `steps.len() ≤ MAX_STEPS` else `TooManySteps`; per-period `Σ quantity ≤
licensed_capacity` else `OfferExceedsCapacity`; each `price ∈ [price_floor, price_cap]` else
`PriceOutOfBounds`. `init_if_needed` the per-(session,generator) `GenerationOffer` (a generator
may resubmit to overwrite before gate closure). Emits `GenerationOfferSubmitted`.

**`close_auction_session(session_id)`** — Signer: `authority`. Requires `now ≥ gate_close_ts`;
flips status `Open → Closed`. Emits `AuctionSessionClosed`.

**`clear_auction_session(session_id, period, offers: Vec<AuctionOrder>)`** — Signer:
`authority`. Per-period merit-order clear (called once per period, or looped within a period
budget). Reuses `trading`'s clearing primitives conceptually
([`trading.md`](../../programs/trading.md) §4.3 `clear_auction`/`find_clearing_point`): sort
accepted steps ascending by price, accumulate the supply stack until it meets
`demand_forecast[period]`, set `clearing_price[period]` = marginal accepted price (uniform SMP)
or leave per-step for pay-as-bid, set `cleared_volume[period]`. Requires session `Closed`;
`clearing_price[period] == 0` (not already cleared). When all periods are cleared, flips status
`Closed → Cleared`. Emits `AuctionSessionCleared { period, smp, volume }`.

**`execute_wholesale_awards(session_id, period, awards: Vec<AwardPair>)`** — Signer:
`authority`. For each cleared (generator, period): `init` the `AwardRecord` PDA
(replay-guarded), set `cleared_quantity`/`clearing_price`. Then, when the settlement currency
is THBG, CPI `treasury::record_settlement`
([`treasury/src/lib.rs:360`](../../../programs/treasury/src/lib.rs)) with the period's cleared
value, signed by the wholesale-market authority PDA. Optionally open/feed a `trading`
wholesale-segment (`segment == 1`) zone so downstream reporting is unified. Emits
`WholesaleAwarded`. Idempotent per award via the PDA (`AwardAlreadySettled`).

**`reconcile_delivery(session_id, generator, period, delivered_quantity)`** — Signer:
`authority` or an admitted wholesale aggregator. Reads the generator's minted GRID for the
delivery window (via `energy-token`/`oracle` types) and writes `delivered_quantity` onto the
`AwardRecord`; the gap between `cleared_quantity` and `delivered_quantity` is the
under-/over-delivery that ESB imbalance settlement (or a slash, §6) acts on. Emits
`DeliveryReconciled`.

**`suspend_generator` / `reactivate_generator` / `update_market_config`** — Signer:
`authority`. Administrative.

---

## 5. Invariants & Security Properties

1. **Merit-order correctness.** Cleared supply for a period is the cheapest set of offer steps
   whose cumulative quantity meets `demand_forecast[period]`; under uniform SMP every accepted
   step is paid the marginal accepted price, so no dispatched generator receives less than its
   offer — the wholesale analogue of `trading`'s "price improvement" auction invariant
   ([`trading.md`](../../programs/trading.md) §5.2).
2. **Capacity ceiling.** Per period, a generator's awarded quantity never exceeds its
   `licensed_capacity` (enforced at offer time and re-checked at clear).
3. **Gate-closure monotonicity.** Offers are accepted only while `now < gate_close_ts` and the
   session is `Open`; clearing requires `Closed`; settlement requires `Cleared` — a strict
   status ladder that prevents offering into a session being cleared.
4. **Exactly-once award settlement.** The `AwardRecord` PDA is `init`ed at settlement; a replay
   finds it program-owned and reverts `AwardAlreadySettled`, exactly as `TradeNullifier` guards
   retail settlement ([`trading.md`](../../programs/trading.md) §5.3).
5. **Price bounds.** Every offer price and every clearing price lies in
   `[price_floor, price_cap]` (cap 0 = uncapped) — the ESB price-control lever.
6. **Segment binding.** Wholesale awards feed only `ZoneMarket.segment == 1` zones and are
   settleable only by Wholesale-admitted aggregators, matching `trading`'s
   `AggregatorSegmentMismatch` gate
   ([`settle_offchain.rs:160`](../../../programs/trading/src/instructions/settle_offchain.rs)).
7. **Delivery reconciliation is financial, not custodial.** `egat` never mints or moves GRID;
   physical settlement stays with the idempotent `energy-token` bridge. `reconcile_delivery`
   only records the delivered figure for imbalance/slash accounting.
8. **Checked arithmetic** on all price×quantity products (u128 intermediates), `saturating_*`
   on stats, `overflow-checks = true`.

---

## 6. Cross-Program Interfaces (CPI)

- **egat → governance** — read `GovernanceConfig` for `is_operational()`; optionally require a
  Wholesale-segment governance licence entry for generators (reusing the
  `[b"aggregator", key]` PDA convention with `segment == 1`,
  [`governance/src/state/aggregator.rs:21`](../../../programs/governance/src/state/aggregator.rs)),
  so ERC retains the licence veto. Types + ID only.
- **egat → treasury** — `record_settlement` / `record_settlement_batch`
  ([`treasury/src/lib.rs:360`](../../../programs/treasury/src/lib.rs),
  [`:389`](../../../programs/treasury/src/lib.rs)) of cleared wholesale value, signed by the
  wholesale-market authority PDA (the `recorder` identity treasury expects).
- **egat → trading** — optional: open a `segment == 1` `ZoneMarket`
  ([`trading/src/lib.rs:161`](../../../programs/trading/src/lib.rs) `initialize_zone_market`)
  and route wholesale awards through its settlement so the whole market shares one settlement
  ledger; the Wholesale-admitted aggregator is the settle `payer`.
- **egat → energy-token** — types only: read `GenerationMintRecord`
  ([`energy-token/src/state.rs:27`](../../../programs/energy-token/src/state.rs)) to reconcile
  the delivered GRID for a `(generator, window)` against the award.
- **Infra (out of program scope):** EGAT is also the **wholesale consensus validator** — a
  cluster/genesis concern, not expressible in this or any Anchor program (`role-map.md` §5).

---

## 7. Events

`WholesaleMarketInitialized`, `GeneratorRegistered`, `AuctionSessionOpened`,
`GenerationOfferSubmitted`, `AuctionSessionClosed`, `AuctionSessionCleared` (`session_id`,
`period`, `smp`, `cleared_volume`), `WholesaleAwarded` (`session_id`, `generator`, `period`,
`quantity`, `price`), `DeliveryReconciled`, `GeneratorSuspended`, `MarketConfigUpdated`. All
carry a hoisted `timestamp: i64`.

## 8. Error Codes (target `EgatError`)

`Unauthorized`, `MaintenanceMode`, `MarketInactive`, `SessionNotOpen`, `SessionNotClosed`,
`SessionAlreadyCleared`, `GateClosed`, `GateNotReached`, `NonMonotonicSession`,
`DemandLengthMismatch`, `TooManySteps`, `OfferExceedsCapacity`, `PriceOutOfBounds`,
`GeneratorNotActive`, `PeriodOutOfRange`, `PeriodNotCleared`, `AwardAlreadySettled`,
`DemandNotMet`, `Overflow`.

## 9. Testing (target)

- **In-crate unit tests** for the pure merit-order clearing function (host struct literals over
  Pod state, no validator), mirroring `oracle`'s `validate_meter_reading_tests`
  ([`oracle.md`](../../programs/oracle.md) §9): supply-stack meets demand exactly, marginal SMP
  selection, price-cap rejection, capacity ceiling, empty/over-demand edge cases.
- **LiteSVM integration** (`tests/egat_wholesale_litesvm.ts`): full session lifecycle
  open→offer→close→clear→award, replay-award rejection, gate-closure rejection, cross-program
  `treasury::record_settlement` assertion — matching the repo's `*_litesvm.ts` convention.
- **CU profile** (`tests/cu_profile_egat_litesvm.ts`) for the clearing loop under the 1.4M CU
  ceiling, since per-period merit-order clearing is the compute-heavy path.

---

*Companion: [`role-map.md`](../../design/role-map.md) (EGAT = wholesale validator + auction
operator), [`thailand-market-context.md`](../../design/thailand-market-context.md) (ESB / Single
Buyer), [design-set index](./README.md) (shared conventions, integration deltas).*
