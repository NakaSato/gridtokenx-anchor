# Load Aggregator Program (`load-aggregator`) — PROPOSED

> **⚠️ STATUS: PROPOSED (new program, 2026-07-10).** Not built. Target spec in the
> [`docs/programs/`](../../programs/README.md) house style; existing-side touch points cited
> `path:line`. See the [design-set index](./README.md) for shared conventions and the
> off-chain [`node-validator.md`](../../design/node-validator.md) this program coordinates with.

## Abstract

The `load-aggregator` program is the on-chain home of the **demand-response / distributed-energy
aggregation** business — the "licensed aggregator (private, per zone)" economic actor
[`role-map.md`](../../design/role-map.md) §1 identifies, modeled not as a bare validator bond
but as a working **flexibility portfolio**. An aggregator enrolls a portfolio of flexible
consumer resources (controllable loads, EV chargers, batteries, rooftop solar) drawn from meters
in a MEA or PEA territory, offers their aggregate curtailable capacity into demand-response (DR)
dispatch, and — when a grid operator calls a DR event — dispatches curtailment, measures
delivered load reduction against a baseline (from [`oracle`](../../programs/oracle.md) meter
readings), and settles the DR payment out to participants pro-rata by delivered reduction. It is
where Thailand's ERC-sandbox VPP / demand-response track
([`thailand-market-context.md`](../../design/thailand-market-context.md) §"Market
liberalization") becomes an on-chain settlement object. The aggregator operating this program is
the same identity that is **governance-admitted (Retail)**, **MEA/PEA-licensed**, and
**registry-bonded** — this program adds the portfolio and dispatch lifecycle on top of that
bonded identity, and non-delivery is slashable against the bond.

---

## 1. Program Identity

| Property | Value |
| --- | --- |
| Program ID | **Unassigned** — `anchor keys sync`, then `declare_id!` + `Anchor.toml` |
| Crate name | `load-aggregator` (`load_aggregator`) |
| Crate version | `0.1.0` (target) |
| Description | "Demand-response / DER portfolio — enrollment, dispatch, baseline settlement" |

### Dependencies (target)

| Dependency | Version / Source | Role |
| --- | --- | --- |
| `anchor-lang` / `anchor-spl` | `1.0.0` | Framework + DR payout transfers |
| `bytemuck` | `1.20.0` (feature `derive`) | Pod for dispatch/enrollment hot state |
| `governance` | path `../governance`, feature `cpi` | `is_operational`; `AggregatorEntry` Retail check (types + ID) |
| `registry` | path `../registry`, feature `cpi` | Read bond; `slash_validator` on DR non-delivery |
| `oracle` | path `../oracle`, feature `cpi` | Types only — read `MeterState` for baseline vs actual |
| `treasury` | path `../treasury`, feature `cpi` | `record_settlement`; DR payout distribution |
| `mea` / `pea` | path deps, feature `cpi` | Types only — licence + ATC capacity cross-check |
| `compute-debug` | path `../../shared/compute-debug`, optional | CU profiling |

---

## 2. System Role

The existing platform settles *generation* (surplus energy sold P2P). Demand response is the
mirror image: settling *avoided consumption* — a resource that reduces its load on request
delivers "negawatts" the grid pays for. The on-chain programs already have every primitive this
needs except the aggregation lifecycle: `oracle` holds per-meter cumulative readings
([`oracle/src/state.rs:11`](../../../programs/oracle/src/state.rs)) from which a baseline and an
actual can be computed; `registry` holds the aggregator's slashable bond
([`registry/src/lib.rs:792`](../../../programs/registry/src/lib.rs)); `treasury` records and
routes baht settlement ([`treasury/src/lib.rs:360`](../../../programs/treasury/src/lib.rs)); and
`governance`/`mea`/`pea` gate who may operate. `load-aggregator` composes them into the DR
event lifecycle: **enroll → offer → dispatch → measure → settle → distribute**.

The program is the settlement authority for *what was delivered and who gets paid*; it is not a
matching engine and does not custody trade energy. Physical measurement stays in the AMI/oracle
layer; this program reads it and applies the baseline arithmetic that turns a reading delta into
a DR payment.

---

## 3. State Model

### 3.1 `DrProgram` (zero-copy singleton)

PDA seed `[b"dr_program"]`. Read-only on hot dispatch paths.

| Field | Type | Meaning |
| --- | --- | --- |
| `authority` | `Pubkey` | Program admin (platform / ERC-sandbox operator). |
| `governance` | `Pubkey` | Bound `governance_config` for the maintenance gate. |
| `settlement_mint` | `Pubkey` | THBG mint for DR payouts. |
| `baseline_method` | `u8` | 0 = high-X-of-Y, 1 = regression, 2 = control-group (default policy). |
| `max_event_seconds` | `u32` | Ceiling on a single DR event window. |
| `penalty_bps` | `u16` | Under-delivery penalty rate (bps of shortfall value). |
| `min_performance_bps` | `u16` | Delivery below this fraction of requested → slashable. |
| `total_events_settled` | `u64` | Stale-on-purpose stat. |
| `active` | `u8` | 1 = operational. |
| `_padding` | `[u8; N]` | — |

### 3.2 `AggregatorPortfolio` (zero-copy, per aggregator)

PDA seed `[b"portfolio", aggregator.as_ref()]`.

| Field | Type | Meaning |
| --- | --- | --- |
| `aggregator` | `Pubkey` | Operator identity (same key as `governance::AggregatorEntry`, `registry` bond, MEA/PEA licence). |
| `territory_code` | `u8` | 1 = MEA, 2 = PEA (must match the licensing utility). |
| `zone_id` | `u32` | Primary DR zone. |
| `enrolled_capacity` | `u64` | Σ `max_curtailable_kw` across active enrollments (reconciled). |
| `participant_count` | `u32` | Active enrollments. |
| `status` | `u8` | 0=Active,1=Suspended,2=Closed. |
| `_padding` | `[u8; N]` | — |

### 3.3 `Enrollment` (regular `#[account]`, per portfolio per meter) — hot-ish, per-entity

PDA seed `[b"enroll", aggregator.as_ref(), meter_id_bytes.as_ref()]`.

| Field | Type | Meaning |
| --- | --- | --- |
| `aggregator` | `Pubkey` | Portfolio owner. |
| `meter_id` | `[u8; 32]` + `meter_id_len: u8` | Participant meter (cross-ref `oracle::MeterState`). |
| `participant` | `Pubkey` | The consumer who consented (receives payout). |
| `resource_type` | `u8` | 0=controllable load,1=EV,2=battery,3=solar,4=other. |
| `max_curtailable_kw` | `u64` | Enrolled flexibility ceiling. |
| `share_bps` | `u16` | Participant's share of DR payment for this resource (≤ 10000). |
| `baseline_ref` | `u64` | Cached rolling baseline (updated per event). |
| `status` | `u8` | 0=Active,1=Withdrawn. |
| `bump` | `u8` | — |

Participant consent: `enroll_resource` requires the `participant` as a co-signer (or a stored
consent proof), so an aggregator cannot enroll a meter it does not control.

### 3.4 `DispatchEvent` (zero-copy, per portfolio per event)

PDA seed `[b"dispatch", aggregator.as_ref(), &event_id.to_le_bytes()]`.

| Field | Type | Meaning |
| --- | --- | --- |
| `aggregator` | `Pubkey` | — |
| `event_id` | `u64` | Monotonic per portfolio. |
| `called_by` | `Pubkey` | Grid operator that called the event (MEA/PEA/EGAT authority). |
| `window_start` / `window_end` | `i64` | Event bounds (≤ `max_event_seconds`). |
| `requested_kw` | `u64` | Reduction requested. |
| `delivered_kw` | `u64` | Measured aggregate reduction (set at measure). |
| `clearing_price` | `u64` | THB per kWh reduced. |
| `status` | `u8` | 0=Called,1=Dispatched,2=Measured,3=Settled. |
| `_padding` | `[u8; N]` | — |

### 3.5 `DeliveryRecord` (regular `#[account]`, per event per meter)

PDA seed `[b"delivery", &event_id.to_le_bytes(), meter_id_bytes.as_ref()]`. Fields: `event_id`,
`meter_id`+len, `baseline`, `actual`, `delivered_kwh` (`max(0, baseline − actual)`),
`payout_amount`, `bump`. This is the per-participant settlement leaf.

### 3.6 `DrNullifier` (regular `#[account]`) — exactly-once settlement

PDA seed `[b"dr_null", &event_id.to_le_bytes()]`. `init`ed at `settle_dispatch`; a replay finds
it program-owned and reverts `EventAlreadySettled` — the `TradeNullifier` pattern
([`trading.md`](../../programs/trading.md) §5.3) applied to DR events.

---

## 4. Instruction Set

All gate on `governance::is_operational()` → `MaintenanceMode`, wrap in `compute_fn!`, hoist
`Clock::get()` before `emit!`.

**`initialize_dr_program(settlement_mint, baseline_method, max_event_seconds, penalty_bps, min_performance_bps)`**
— Signer: `authority`. `init` the singleton.

**`register_portfolio(aggregator, territory_code, zone_id)`** — Signer: `aggregator`.
Preconditions (cross-checks, types only): the aggregator owns an **active** governance
`AggregatorEntry` (Retail) ([`governance/src/state/aggregator.rs:9`](../../../programs/governance/src/state/aggregator.rs)),
a MEA/PEA `LicensedAggregator` in `Active` for `territory_code`, and a `registry` validator bond
≥ `MIN_VALIDATOR_STAKE` ([`registry/src/lib.rs:35`](../../../programs/registry/src/lib.rs)).
`init` the portfolio. Emits `PortfolioRegistered`.

**`enroll_resource(meter_id, resource_type, max_curtailable_kw, share_bps)`** — Signers:
`aggregator` **and** `participant`. Preconditions: `share_bps ≤ 10000`; meter in the portfolio's
territory (cross-ref MEA/PEA `ServicePoint`); not already enrolled elsewhere as active. `init`
`Enrollment`; add `max_curtailable_kw` to `enrolled_capacity`. Emits `ResourceEnrolled`.

**`withdraw_resource(meter_id)`** — Signer: `participant` or `aggregator`. Status → `Withdrawn`;
subtract from `enrolled_capacity`. Emits `ResourceWithdrawn`.

**`submit_flexibility_offer(window_start, window_end, capacity_kw, price)`** — Signer:
`aggregator`. Preconditions: `capacity_kw ≤ enrolled_capacity` else `OfferExceedsEnrolled`;
window ≤ `max_event_seconds`. Records/emits the offer for the DR/VPP market (may feed a `trading`
ancillary segment or an EGAT balancing call). Emits `FlexibilityOffered`.

**`call_dispatch_event(event_id, window_start, window_end, requested_kw, clearing_price)`** —
Signer: `called_by` — a **grid operator** (MEA/PEA/EGAT authority), not the aggregator itself,
so DR events are operator-initiated. Preconditions: `event_id == portfolio.next_event`;
`requested_kw ≤ enrolled_capacity`; window bounds valid. `init` `DispatchEvent` (`Called`). Emits
`DispatchEventCalled`.

**`report_dispatch(event_id)`** — Signer: `aggregator`. Marks the event `Dispatched` (the
aggregator has actuated curtailment on its resources). Emits `DispatchReported`. The physical
actuation is off-chain; this is the on-chain acknowledgement that starts the measurement window.

**`measure_delivery(event_id, deliveries: Vec<DeliveryLeaf>)`** — Signer: `authority` or
`called_by`. For each enrolled meter, `init` a `DeliveryRecord`: `baseline` from the enrollment /
oracle rolling window per `baseline_method`, `actual` from `oracle::MeterState` consumption over
the event window (types + PDA derivation only — no invoke), `delivered_kwh = max(0, baseline −
actual)`. Sum into `DispatchEvent.delivered_kw`; set status `Measured`. Emits `DeliveryMeasured`.
Challengeable within a window before settlement (a watcher can dispute a baseline, mirroring the
aggregator-node challenge model, [`node-validator.md`](../../design/node-validator.md) §7).

**`settle_dispatch(event_id)`** — Signer: `authority`. Preconditions: status `Measured`; the
`DrNullifier` claim (exactly-once). Compute `event_payment = delivered_kw_as_kwh ×
clearing_price` (u128, checked). Under-delivery: if `delivered_kw × 10000 < requested_kw ×
min_performance_bps`, apply the penalty and CPI `registry::slash_validator`
([`registry/src/lib.rs:950`](../../../programs/registry/src/lib.rs)) against the bond. CPI
`treasury::record_settlement` for the event value. Status → `Settled`. Emits `DispatchSettled`.

**`distribute_participant_payments(event_id, meters: Vec<Pubkey>)`** — Signer: `authority` or
`aggregator`. For each `DeliveryRecord`, `payout = event_payment × (delivered_leaf /
delivered_total) × share_bps / 10000`; transfer `settlement_mint` to the participant (SPL
transfer signed by the program payout PDA); the aggregator margin is the residual
([`cost-fee-structure.md`](../../design/cost-fee-structure.md) §7 — a few satang/unit).
Idempotent per leaf (mark `payout_amount` set). Emits `ParticipantPaid` per leaf.

**`suspend_portfolio` / `close_portfolio` / `update_dr_config`** — Signer: `authority`.

---

## 5. Invariants & Security Properties

1. **Enrolled-capacity conservation.** `enrolled_capacity == Σ max_curtailable_kw` over active
   enrollments; every offer and every dispatch is bounded by it — an aggregator cannot offer or
   be dispatched for flexibility it has not enrolled.
2. **Consent binding.** An `Enrollment` requires the participant's signature; payouts flow only
   to the enrolled `participant`, and the enrollment seed includes both aggregator and meter, so
   a meter cannot be co-opted into a portfolio it did not join.
3. **Baseline integrity.** `actual` is read from `oracle::MeterState` over the exact event window
   and `delivered_kwh = max(0, baseline − actual)` is floored at zero — a resource that *raised*
   consumption delivers nothing, never a negative that could inflate someone else's share. The
   baseline method is a program-level policy, not a per-event caller input.
4. **Delivered ≤ requested for payment.** Payment is on measured `delivered_kw` capped at
   `requested_kw`; over-delivery is not overpaid.
5. **Payment conservation.** `Σ participant payouts + aggregator margin == event_payment`; every
   `share_bps ≤ 10000` and per event the shares of delivering resources are normalized by
   `delivered_total`, so payouts can never exceed the settled amount.
6. **Exactly-once settlement.** The `DrNullifier` PDA makes `settle_dispatch` idempotent per
   event; `distribute_participant_payments` is idempotent per leaf.
7. **Non-delivery is slashable.** Delivery below `min_performance_bps` of requested triggers the
   penalty + `registry::slash_validator` against the same bond that admitted the aggregator —
   closing the loop `role-map.md` §3 draws between admission, bond, and accountability.
8. **Operator-initiated events.** `call_dispatch_event` is signed by a grid operator, not the
   aggregator, so an aggregator cannot manufacture events to pay itself.
9. **Checked arithmetic** (u128 for price×quantity and share splits); `saturating_*` on stats;
   `overflow-checks = true`.

---

## 6. Cross-Program Interfaces (CPI)

- **load-aggregator → governance** — `is_operational` gate; read the aggregator's Retail
  `AggregatorEntry` at portfolio registration
  ([`governance/src/state/aggregator.rs:9`](../../../programs/governance/src/state/aggregator.rs)).
- **load-aggregator → registry** — read the bond at registration; `slash_validator`
  ([`registry/src/lib.rs:950`](../../../programs/registry/src/lib.rs)) on under-delivery.
- **load-aggregator → oracle** — types only: derive `MeterState` PDAs
  ([`oracle/src/state.rs:11`](../../../programs/oracle/src/state.rs)) and read consumption for
  baseline vs actual; no invoke, matching how `oracle` itself reads governance
  ([`oracle.md`](../../programs/oracle.md) §6).
- **load-aggregator → treasury** — `record_settlement`
  ([`treasury/src/lib.rs:360`](../../../programs/treasury/src/lib.rs)) for the event; SPL
  transfers for participant payouts signed by the program's payout PDA.
- **load-aggregator → mea / pea** — types only: confirm the portfolio's aggregator is
  `LicensedAggregator::Active` and its enrollments sit in the utility's territory/ATC.

## 7. Events

`DrProgramInitialized`, `PortfolioRegistered`, `ResourceEnrolled`, `ResourceWithdrawn`,
`FlexibilityOffered`, `DispatchEventCalled`, `DispatchReported`, `DeliveryMeasured`,
`DispatchSettled` (`event_id`, `delivered_kw`, `event_payment`, `slashed: bool`),
`ParticipantPaid` (`event_id`, `participant`, `payout_amount`), `PortfolioSuspended`,
`DrConfigUpdated`. All carry a hoisted `timestamp`.

## 8. Error Codes (target `LoadAggregatorError`)

`Unauthorized`, `MaintenanceMode`, `ProgramInactive`, `NotAdmitted`, `NotLicensed`, `NotBonded`,
`WrongTerritory`, `ShareExceedsBps`, `MeterAlreadyEnrolled`, `NotEnrolled`,
`OfferExceedsEnrolled`, `EventWindowTooLong`, `NonMonotonicEvent`, `RequestExceedsEnrolled`,
`EventNotCalled`, `EventNotDispatched`, `EventNotMeasured`, `EventAlreadySettled`,
`BaselineUnavailable`, `PayoutExceedsSettlement`, `Overflow`.

## 9. Testing (target)

- **Unit** (host struct literals): `delivered_kwh` floor-at-zero, payment-conservation split
  math, `share_bps` bound, under-delivery penalty threshold, over-delivery cap.
- **LiteSVM** (`tests/load_aggregator_dr_litesvm.ts`): full lifecycle register→enroll(consent)
  →offer→call→report→measure(oracle baseline)→settle→distribute; replay-settle rejection;
  under-delivery → CPI slash assertion; consent-missing enrollment rejection; payout equals
  measured share.
- **CU profile** (`tests/cu_profile_dr_litesvm.ts`) for `measure_delivery` and
  `distribute_participant_payments` over a full portfolio, since those loop over enrollments.

---

*Companion: [`role-map.md`](../../design/role-map.md) (licensed aggregator = bonded actor),
[`node-validator.md`](../../design/node-validator.md) (off-chain aggregator node + challenge
model), [`cost-fee-structure.md`](../../design/cost-fee-structure.md) §7 (aggregator margin),
[design-set index](./README.md).*
