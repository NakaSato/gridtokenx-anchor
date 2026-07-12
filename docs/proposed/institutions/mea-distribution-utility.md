# MEA Distribution-Utility Program (`mea`) — PROPOSED

> **⚠️ STATUS: PROPOSED (new program, 2026-07-10).** Not built. Target spec in the
> [`docs/programs/`](../../programs/README.md) house style; existing-side touch points cited
> `path:line`. This is the **canonical distribution-utility spec**; the provincial utility
> [`pea`](./pea-distribution-utility.md) is the same program with a different program-ID,
> seed domain, and territory constant — its doc states only the deltas. See the
> [design-set index](./README.md) for shared conventions and the two integration deltas
> (A: admission delegation; B: per-territory tariff) this design assumes.

## Abstract

The `mea` program is the on-chain arm of the Metropolitan Electricity Authority (MEA / กฟน),
the distribution utility for Bangkok, Nonthaburi, and Samut Prakan. It implements the three
retail-market operator roles [`role-map.md`](../../design/role-map.md) §1 assigns to a
distribution utility but currently leaves to stand-in dev keys: **(1)** per-territory
licensing and collateral custody of the licensed aggregators that clear P2P trades in MEA
territory, **(2)** signing authority over the distribution **wheeling and loss** tariff that
[`trading`](../../programs/trading.md) charges at settlement, and **(3)** allocation of
distribution-grid **Available Transfer Capacity (ATC)** to those aggregators, which throttles
the cross-zone flow `trading` already meters. It also maintains the map from service
points/meters to MEA territory and customer class. The program never custodies trade energy or
takes a matching role — it is the regulator-of-the-wire for its territory: who may operate,
what the grid charge is, and how much capacity each operator holds. Because MEA and PEA share
this role verbatim, differing only by territory, this spec is authoritative for both.

---

## 1. Program Identity

| Property | Value |
| --- | --- |
| Program ID | **Unassigned** — `anchor keys sync`, then `declare_id!` + `Anchor.toml` |
| Crate name | `mea` |
| Crate version | `0.1.0` (target) |
| Description | "MEA metropolitan distribution utility — licensing, tariff, ATC capacity" |
| Territory constant | `TERRITORY_CODE = 1` (MEA metro); PEA uses `2` |

### Dependencies (target)

| Dependency | Version / Source | Role |
| --- | --- | --- |
| `anchor-lang` / `anchor-spl` | `1.0.0` | Framework + SPL collateral vault |
| `bytemuck` | `1.20.0` (feature `derive`) | Pod for capacity/tariff hot state |
| `governance` | path `../governance`, feature `cpi` | `admit_aggregator`/`revoke_aggregator` (segment=Retail); `is_operational` |
| `trading` | path `../trading`, feature `cpi` | `set_wheeling_rate`/`set_loss_rate`; set `ZoneMarket.capacity` / init `ZoneCapacity` |
| `registry` | path `../registry`, feature `cpi` | `slash_validator` on licence breach; read bond state |
| `treasury` | path `../treasury`, feature `cpi` | Collateral custody; rebate routing |
| `compute-debug` | path `../../shared/compute-debug`, optional | CU profiling |

---

## 2. System Role

`trading` already meters everything MEA regulates — it charges wheeling/loss from a
`TariffConfig` whose authorities are "MEA/PEA distribution keys"
([`trading/src/state/tariff_config.rs:38`](../../../programs/trading/src/state/tariff_config.rs)),
and it throttles cross-zone flow against `ZoneMarket.capacity` / `ZoneCapacity`
([`trading/src/state/zone_market.rs:31`](../../../programs/trading/src/state/zone_market.rs),
[`trading/src/instructions/settle_offchain.rs:101`](../../../programs/trading/src/instructions/settle_offchain.rs)).
Today those authorities and that capacity are set by bare admin keys. `mea` replaces the keys
with a program that (a) holds the territory's authoritative tariff schedule and *drives*
`trading`'s tariff as its on-chain signer, (b) allocates capacity per aggregator and pushes the
zone ceilings into `trading`, and (c) ties aggregator admission to posted collateral —
realizing `role-map.md` §3's "admission ⇒ bond, bond ⇒ admission" principle at the territory
level. The economic figures it carries (wheeling ~1.07–1.151 THB/kWh bundled rate, TPA fixed
fees) come from [`cost-fee-structure.md`](../../design/cost-fee-structure.md) §3, §8.

The retail-consensus-validator role EGAT/MEA/PEA hold is, as in the EGAT doc, a cluster/genesis
concern out of program scope.

---

## 3. State Model

### 3.1 `DistributionUtility` (zero-copy singleton)

PDA seed `[b"mea_utility"]`. Read-only on hot paths.

| Field | Type | Meaning |
| --- | --- | --- |
| `authority` | `Pubkey` | MEA operator authority (target k-of-n vault). |
| `governance` | `Pubkey` | Bound `governance_config` for maintenance + delegated-admit checks. |
| `territory_code` | `u8` | `1` = MEA metro. |
| `tariff_authority` | `Pubkey` | Key/PDA permitted to set the territory tariff (may equal `authority`). |
| `collateral_mint` | `Pubkey` | Asset held for TPA deposits + bond custody (GRX or THBG). |
| `min_collateral` | `u64` | Deposit required before an aggregator can be endorsed. |
| `licensed_count` | `u32` | Stale-on-purpose stat. |
| `allocated_capacity` | `u64` | Σ ATC allocated across zones (reconciled by admin). |
| `active` | `u8` | 1 = operational. |
| `_padding` | `[u8; N]` | — |

### 3.2 `DistributionTariff` (regular `#[account]`, per territory)

PDA seed `[b"mea_tariff"]`. The territory's authoritative schedule; the program signs updates
into `trading::TariffConfig` from it (or, per Delta B, `trading` reads a territory-keyed config
directly). Mirrors `trading::TariffConfig` fields plus territory context.

| Field | Type | Meaning |
| --- | --- | --- |
| `wheeling_rate_per_kwh` | `u64` | Flat 6-dp THB/kWh (bundled transmission+distribution recovery, [`cost-fee-structure.md`](../../design/cost-fee-structure.md) §3). |
| `loss_bps` | `u16` | Line-loss rate, bps of trade value. |
| `ft_component` | `i64` | Fuel-adjustment (Ft) surcharge, 6-dp, ERC-reset every 4 months. |
| `customer_class_mult` | `[u16; 4]` | Type 1–4 multipliers (bps), 10000 = 1.0×. |
| `effective_from` | `i64` | Activation timestamp. |
| `bump` | `u8` | — |

Caps mirror `trading`: `wheeling_rate_per_kwh ≤ MAX_WHEELING_RATE_PER_KWH` (10 THB/kWh),
`loss_bps ≤ MAX_LOSS_BPS` (2000)
([`trading/src/state/tariff_config.rs:7`](../../../programs/trading/src/state/tariff_config.rs)).

### 3.3 `LicensedAggregator` (regular `#[account]`, per aggregator)

PDA seed `[b"mea_lic", aggregator.as_ref()]`. The territory roster + collateral ledger entry.

| Field | Type | Meaning |
| --- | --- | --- |
| `aggregator` | `Pubkey` | Aggregator key (same identity as its `governance::AggregatorEntry` and `registry` bond). |
| `license_id` | `[u8; 32]` | ERC/TPA licence reference. |
| `status` | `u8` | 0=Pending,1=Active,2=Suspended,3=Revoked. |
| `collateral_posted` | `u64` | TPA deposits + bond custody balance for this aggregator. |
| `zone_scope` | `u32` | Zone(s) the aggregator may serve (bitmask or base zone). |
| `endorsed_at` | `i64` | When endorsed into governance. |
| `bump` | `u8` | — |

### 3.4 `CapacityAllocation` (zero-copy, per zone per aggregator) — hot path

PDA seed `[b"mea_cap", &zone_id.to_le_bytes(), aggregator.as_ref()]`. Per-entity so concurrent
allocation reads/writes across aggregators don't serialize.

| Field | Type | Meaning |
| --- | --- | --- |
| `zone_id` | `u32` | — |
| `aggregator` | `Pubkey` | — |
| `atc_allocated` | `u64` | Available Transfer Capacity granted (base units). |
| `atc_used` | `u64` | Reserved/committed. |
| `bump` | `u8` | — |
| `_padding` | `[u8; N]` | — |

### 3.5 `ServicePoint` (regular `#[account]`, per meter)

PDA seed `[b"mea_sp", meter_id_bytes.as_ref()]`. Maps a meter/connection to MEA territory,
zone, and customer class. Fields: `meter_id: [u8;32]` + `meter_id_len: u8`, `zone_id: u32`,
`customer_class: u8` (1–4), `active: u8`, `bump`. Cross-refs `oracle::MeterState`
([`oracle/src/state.rs:11`](../../../programs/oracle/src/state.rs)) and `registry` meter
accounts by meter id.

### 3.6 Collateral vault

An SPL token account PDA `[b"mea_collateral"]` (authority = utility authority PDA) holding
posted TPA deposits and aggregator-bond custody in `collateral_mint`. Release is gated by the
utility; slashing routes through `registry`/`treasury` (§6).

---

## 4. Instruction Set

All gate on `governance::is_operational()` → `MaintenanceMode`, wrap in `compute_fn!`, hoist
`Clock::get()` before `emit!`.

**`initialize_utility(territory_code, tariff_authority, collateral_mint, min_collateral)`** —
Signer: `authority`. `init` the singleton + collateral vault. Rejects `territory_code` ≠ this
crate's constant.

**`set_distribution_tariff(wheeling_rate_per_kwh, loss_bps, ft_component, customer_class_mult)`**
— Signer: `tariff_authority`. Validates caps (`TariffRateExceedsCap`); writes
`DistributionTariff`; emits `TariffUpdated`.

**`push_tariff_to_trading()`** — Signer: `tariff_authority`. CPI `trading::set_wheeling_rate` +
`trading::set_loss_rate` ([`trading/src/instructions/tariff.rs:59`](../../../programs/trading/src/instructions/tariff.rs),
[`:75`](../../../programs/trading/src/instructions/tariff.rs)), signed by the utility's
`tariff_authority` PDA (which must be registered as `trading`'s `wheeling_authority` /
`loss_authority`). Under Delta B this collapses into `trading` reading the territory-keyed
config directly. Emits `TariffPushed`.

**`license_aggregator(aggregator, license_id, zone_scope)`** — Signer: `authority`. `init`
`LicensedAggregator` in `Pending`. Does **not** yet grant operating rights.

**`post_collateral(aggregator, amount)`** — Signer: the aggregator (or a funder on its behalf).
Transfers `amount` `collateral_mint` into the vault; increments `collateral_posted`. Emits
`CollateralPosted`.

**`endorse_aggregator(aggregator)`** — Signer: `authority`. Preconditions: entry `Pending`;
`collateral_posted ≥ min_collateral` else `InsufficientCollateral` (this is the "admission ⇒
bond" enforcement, `role-map.md` §3). Flips status → `Active`; then **Delta A**: CPI
`governance::admit_aggregator(aggregator, segment = 0 /* Retail */)`
([`governance/src/handlers/aggregator.rs:9`](../../../programs/governance/src/handlers/aggregator.rs))
signed by the utility authority PDA acting as admission delegate. Without Delta A, this instead
writes a `TerritoryEndorsement` PDA that ERC's key reads before performing the admit. Emits
`AggregatorEndorsed`.

**`allocate_capacity(zone_id, aggregator, atc)`** — Signer: `authority`. Preconditions:
aggregator `Active`; `Σ atc_allocated (this zone) + atc ≤ zone physical capacity` else
`CapacityOversubscribed`. `init_if_needed` `CapacityAllocation`, set `atc_allocated`; CPI
`trading` to set `ZoneMarket.capacity` and/or init `ZoneCapacity`
([`trading/src/lib.rs:161`](../../../programs/trading/src/lib.rs) `initialize_zone_market`,
[`:199`](../../../programs/trading/src/lib.rs) `initialize_zone_capacity`). Emits `CapacityAllocated`.
Ties to the TPA ATC allocation fee ([`cost-fee-structure.md`](../../design/cost-fee-structure.md) §8).

**`release_capacity(zone_id, aggregator)` / `update_capacity(...)`** — Signer: `authority`.
Adjusts/zeroes an allocation; re-pushes the zone ceiling.

**`suspend_aggregator(aggregator, reason)`** — Signer: `authority`. Status → `Suspended`; CPI
`governance::revoke_aggregator`. If the breach is slashable, CPI `registry::slash_validator`
([`registry/src/lib.rs:950`](../../../programs/registry/src/lib.rs)) against the aggregator's
bond, routing to the configured `slash_destination` (rebate pool). Emits `AggregatorSuspended`.

**`revoke_aggregator(aggregator)` / `release_collateral(aggregator, amount)`** — Signer:
`authority`. Full revocation; collateral returned only after any cooldown/dispute window.

**`register_service_point(meter_id, zone_id, customer_class)` / `update_service_point(...)`** —
Signer: `authority`. Maps a meter to territory/zone/class.

**`update_utility_config(...)` / `set_tariff_authority(new)`** — Signer: `authority`.

---

## 5. Invariants & Security Properties

1. **Admission ⇒ collateral.** `endorse_aggregator` is impossible unless
   `collateral_posted ≥ min_collateral`; revocation and slashing act on that same custody
   balance — closing the "self-granted bond" gap `role-map.md` §2 row 4 flags.
2. **Single tariff authority.** Only `tariff_authority` mutates `DistributionTariff`, and rates
   are cap-bounded at set time (`MAX_WHEELING_RATE_PER_KWH`, `MAX_LOSS_BPS`), so the territory
   charge can never exceed the regulated ceiling — the on-chain half of the
   [`cost-fee-structure.md`](../../design/cost-fee-structure.md) §3 wheeling bound.
3. **Capacity conservation.** For any zone, `Σ atc_allocated` across aggregators never exceeds
   the zone's physical distribution capacity; `trading`'s settle-time `CapacityExceeded` check
   ([`settle_offchain.rs:738`](../../../programs/trading/src/instructions/settle_offchain.rs))
   is the runtime enforcement, this program is the allocation ledger that feeds it.
4. **Territory binding.** Every `ServicePoint`, `CapacityAllocation`, and tariff is scoped to
   this crate's `TERRITORY_CODE`; a meter or zone belonging to PEA is invisible here, so MEA and
   PEA cannot double-govern the same connection.
5. **Custody isolation.** The collateral vault's SPL authority is the utility PDA; only
   `release_collateral`/slash paths move funds, and release is gated on aggregator status +
   cooldown — a suspended aggregator cannot withdraw its bond ahead of a slash (the
   unstake-escape `role-map.md` §2 row 5 closes, applied to territory collateral).
6. **Delegated-admit provenance.** Under Delta A the CPI admit is signed by the utility PDA and
   `governance` records the admitting authority; ERC retains revoke/slash veto, so delegation
   never becomes unrevocable.
7. **Checked arithmetic**; `saturating_*` on stats; `overflow-checks = true`.

---

## 6. Cross-Program Interfaces (CPI)

- **mea → governance** — `admit_aggregator(_, segment=0)` / `revoke_aggregator`
  ([`handlers/aggregator.rs:9`](../../../programs/governance/src/handlers/aggregator.rs),
  [`:36`](../../../programs/governance/src/handlers/aggregator.rs)) as admission delegate
  (Delta A), plus `is_operational` reads. Segment is fixed **Retail (0)** — MEA never admits a
  wholesale operator.
- **mea → trading** — `set_wheeling_rate` / `set_loss_rate`
  ([`tariff.rs:59`](../../../programs/trading/src/instructions/tariff.rs),
  [`:75`](../../../programs/trading/src/instructions/tariff.rs)) as the tariff authority;
  `initialize_zone_market` / `initialize_zone_capacity` to publish ATC ceilings.
- **mea → registry** — `slash_validator`
  ([`registry/src/lib.rs:950`](../../../programs/registry/src/lib.rs)) on a slashable licence
  breach; read bond state to confirm an aggregator is bonded before endorsing.
- **mea → treasury** — collateral held in an SPL vault; slashed amounts route to the configured
  `rebate_vault` ([`treasury/src/lib.rs:462`](../../../programs/treasury/src/lib.rs)) /
  `slash_destination`, consistent with `role-map.md` §2 row 10.

## 7. Events

`UtilityInitialized`, `TariffUpdated`, `TariffPushed`, `AggregatorLicensed`, `CollateralPosted`,
`AggregatorEndorsed`, `CapacityAllocated`, `CapacityReleased`, `AggregatorSuspended`,
`AggregatorRevoked`, `CollateralReleased`, `ServicePointRegistered`, `UtilityConfigUpdated`. All
carry a hoisted `timestamp` and `territory_code`.

## 8. Error Codes (target `DistributionError`)

`Unauthorized`, `MaintenanceMode`, `UtilityInactive`, `WrongTerritory`, `TariffRateExceedsCap`,
`AggregatorNotPending`, `AggregatorNotActive`, `InsufficientCollateral`, `CapacityOversubscribed`,
`AllocationNotFound`, `CollateralLocked`, `InvalidCustomerClass`, `MeterAlreadyRegistered`,
`Overflow`.

## 9. Testing (target)

- **Unit** (host struct literals): tariff-cap rejection, `endorse` blocked below
  `min_collateral`, capacity-oversubscription math, customer-class multiplier bounds.
- **LiteSVM** (`tests/mea_distribution_litesvm.ts`): license→post_collateral→endorse→(CPI admit)
  →allocate_capacity→settle a retail trade in `trading` that draws the pushed tariff and ATC;
  suspend→CPI revoke + slash; collateral-lock-on-suspend rejection.
- **Cross-program** assertions that the pushed tariff is what `trading` actually charges at
  settle (`tests/oracle_guards`-style guard suite) and that `ZoneCapacity` reflects the
  allocation.

---

*Canonical distribution-utility spec. Provincial sibling: [`pea`](./pea-distribution-utility.md).
Companion: [`role-map.md`](../../design/role-map.md), [`cost-fee-structure.md`](../../design/cost-fee-structure.md),
[design-set index](./README.md) (Delta A/B).*
