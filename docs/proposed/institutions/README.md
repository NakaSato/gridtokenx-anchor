# Institutional Programs — Design Set (PROPOSED)

> **⚠️ STATUS: PROPOSED (new-program design, 2026-07-10).** These four programs do not
> exist in the codebase yet. This directory specifies them at the design-doc level, in the
> house style of [`docs/programs/`](../../programs/README.md) (identity, system role, state
> model, instruction set, invariants, CPI, events, errors, testing) blended with the
> *why + model* narrative of [`docs/design/`](../../design/) — appropriate because nothing
> here is built, so every claim is a **target**, not a `path:line` citation of shipped code.
> Where a program must touch an existing account or instruction, the existing side **is**
> cited `path:line`, and any change required on that existing side is called out as an
> **integration delta** (the same convention [`role-map.md`](../../design/role-map.md) uses).

This set turns the four institutional roles that [`role-map.md`](../../design/role-map.md)
maps but leaves as "local/dev keys stand in for them" into their own on-chain programs:

| # | Program (crate) | Institution | On-chain function it adds | Doc |
|---|---|---|---|---|
| 1 | `egat` | **EGAT / กฟผ** | Wholesale generation auction (day-ahead merit-order clearing under the Enhanced Single Buyer model); wholesale-segment award feed | [egat-wholesale-auction.md](./egat-wholesale-auction.md) |
| 2 | `mea` | **MEA / กฟน** | Metro distribution utility: per-territory aggregator licensing + collateral custody, distribution wheeling/loss tariff authority, ATC capacity allocation | [mea-distribution-utility.md](./mea-distribution-utility.md) |
| 3 | `pea` | **PEA / กฟภ** | Provincial distribution utility — identical role to MEA, separate crate/program-ID/territory | [pea-distribution-utility.md](./pea-distribution-utility.md) |
| 4 | `load-aggregator` | **Licensed aggregator (DR/VPP)** | Demand-response / DER portfolio: load enrollment, flexibility offers, dispatch, baseline-vs-actual settlement, participant payout | [load-aggregator.md](./load-aggregator.md) |

The programs are additive: they wrap and drive the six production programs
([`energy-token`](../../programs/energy-token.md), [`governance`](../../programs/governance.md),
[`oracle`](../../programs/oracle.md), [`registry`](../../programs/registry.md),
[`trading`](../../programs/trading.md), [`treasury`](../../programs/treasury.md)) rather than
replacing any of them. No existing account layout changes are *required* to deploy them; two
optional integration deltas (below) make the coupling first-class instead of key-based.

---

## 1. Where they sit in the authority graph

Extending [`role-map.md`](../../design/role-map.md) §4 — the boxes that were bare keys become
programs holding PDAs:

```
ERC (กกพ) ── governance authority (k-of-n) ─────────────────────────────┐
  │  admit/revoke/slash/params, REC issuance                            │
  ├── delegates per-territory admission ▶ [mea] / [pea]  (delta A)      │
  ▼                                                                     ▼
[egat] ── wholesale generation auction ──▶ trading (segment=1 zones)  [load-aggregator]
   │        merit-order clear, SMP per period                          (DR/VPP portfolio,
   │        awards ▶ energy-token mint on delivery, treasury record     bonded + licensed)
   ▼                                                                     ▲
[mea] (metro) / [pea] (provincial) ── distribution utilities ──────────┘
   ├─ wheeling + loss tariff authority ▶ trading::TariffConfig  (delta B)
   ├─ ATC capacity allocation ▶ trading::ZoneMarket.capacity / ZoneCapacity
   ├─ aggregator licensing + collateral custody ▶ governance admit + registry bond
   └─ service-point ↔ territory/customer-class map ▶ oracle meters
                                                                        │
prosumer/consumer ── clients (no stake) ── swap/redeem ── orders ───────┘
```

Consensus membership (EGAT = wholesale validator, MEA/PEA = retail validators) stays a
cluster/genesis concern no Anchor program can express — same scoping call as `role-map.md`
§5. These programs cover only the **application-layer** roles.

## 2. Shared conventions (inherited, non-negotiable)

Every program here follows the repo's load-bearing invariants
([`ARCHITECTURE.md`](../../../ARCHITECTURE.md) §5):

- **Zero-copy hot-path state.** `#[account(zero_copy)] #[repr(C)]` + `bytemuck::Pod`, manual
  `_paddingN` for 8-byte alignment, `AccountLoader` + `load()/load_mut()/load_init()`, space
  `8 + size_of::<T>()`. Cold/marker accounts (idempotency nullifiers, one-shot records) may be
  regular `#[account]` (Borsh, space `8 + LEN`).
- **No `String` in zero-copy** — `[u8; N]` + `*_len: u8`, `registry::string_to_bytes32`.
- **Sealevel parallelism** — hot writes go to per-entity PDAs (per generator-session, per
  enrollment, per dispatch event), never to a singleton config; global totals are
  stale-on-purpose, reconciled by admin instructions.
- **`compute_fn!` wrapping** every handler; **`Clock::get()` hoisted** into a local before any
  `emit!`.
- **Checked/saturating arithmetic**; `[profile.release] overflow-checks = true`.
- **`anchor-lang` / `anchor-spl` = 1.0.0**; path-dep the existing crates with
  `features = ["cpi"]` for types + PDA derivation (no needless invoke).
- **Maintenance gate** — every state-mutating instruction reads `governance::GovernanceConfig`
  (`[b"governance_config"]`) and rejects `MaintenanceMode` when `!is_operational()`
  (`get_governance_config` / `is_operational`, [`trading/src/utils.rs`](../../../programs/trading/src/utils.rs)).

## 3. Program-ID & PDA-seed registry (to assign)

Program IDs are **unassigned**; on first build run `anchor keys sync`, copy `declare_id!` into
each `lib.rs`, and add rows to `Anchor.toml [programs.localnet]`
([`ARCHITECTURE.md`](../../../ARCHITECTURE.md) §5 invariant 6). Seed **domains are namespaced
per program** so no two programs collide on a PDA address:

| Program | Singleton config seed | Key per-entity seeds |
|---|---|---|
| `egat` | `[b"wholesale_market"]` | `[b"generator", gen]`, `[b"auction", session_id]`, `[b"offer", session_id, gen]`, `[b"award", session_id, gen, period]` |
| `mea` | `[b"mea_utility"]` | `[b"mea_lic", agg]`, `[b"mea_cap", zone, agg]`, `[b"mea_sp", meter]`, `[b"mea_tariff"]`, `[b"mea_collateral"]` |
| `pea` | `[b"pea_utility"]` | `[b"pea_lic", agg]`, `[b"pea_cap", zone, agg]`, `[b"pea_sp", meter]`, `[b"pea_tariff"]`, `[b"pea_collateral"]` |
| `load-aggregator` | `[b"dr_program"]` | `[b"portfolio", agg]`, `[b"enroll", agg, meter]`, `[b"dispatch", agg, event_id]`, `[b"delivery", event_id, meter]`, `[b"dr_null", event_id]` |

## 4. New CPI edges (added to [`ARCHITECTURE.md`](../../../ARCHITECTURE.md) §4)

```
egat            → governance   (is_operational; generator-licence cross-check, types only)
egat            → trading      (open/settle wholesale segment-1 zone; award value)
egat            → treasury     (record_settlement of cleared wholesale value)
egat            → energy-token (types only: reconcile GRID mint on delivery via the bridge)
mea, pea        → governance   (admit_aggregator / revoke_aggregator, segment = Retail)   [delta A]
mea, pea        → trading      (set_wheeling_rate / set_loss_rate; set ZoneMarket.capacity) [delta B]
mea, pea        → registry     (slash_validator on licence breach; read bond state)
mea, pea        → treasury     (collateral custody; rebate routing)
load-aggregator → governance   (is_operational; AggregatorEntry Retail check, types only)
load-aggregator → registry     (read bond; slash_validator on DR non-delivery)
load-aggregator → oracle       (types only: read MeterState for DR baseline vs actual)
load-aggregator → treasury     (record_settlement; DR payout distribution)
load-aggregator → mea / pea    (licence + ATC capacity check, types only)
```

## 5. Two integration deltas (existing-side changes these designs assume)

Both are **optional** — the designs degrade to a key-based binding without them — but each
removes a trusted-key assumption, in the spirit of `role-map.md`'s regulator/operator split.

- **Delta A — per-territory admission delegation.** `governance::admit_aggregator` today
  requires the caller to be the single `governance_config.authority`
  ([`governance/src/contexts.rs:288`](../../../programs/governance/src/contexts.rs),
  [`handlers/aggregator.rs:9`](../../../programs/governance/src/handlers/aggregator.rs)), so
  MEA/PEA cannot admit their own territory's aggregators. Proposed: add an optional
  `admission_delegate: Option<Pubkey>` to `GovernanceConfig` (or a per-territory delegate PDA)
  and accept `authority == config.authority || signer == admission_delegate` in
  `AdmitAggregator`. Then the `mea`/`pea` utility-authority PDA can `endorse_aggregator` → CPI
  `admit_aggregator(..., segment = 0)` directly. Without it, MEA/PEA write a
  `TerritoryEndorsement` PDA and ERC's key performs the admit after reading it.

- **Delta B — per-territory tariff.** `trading::TariffConfig` is a **single global singleton**
  (`[b"tariff_config"]`, one `wheeling_authority` + one `loss_authority`,
  [`trading/src/state/tariff_config.rs:36`](../../../programs/trading/src/state/tariff_config.rs)),
  so it cannot carry distinct MEA-metro vs PEA-provincial rates simultaneously. Proposed:
  key the tariff PDA by territory — `[b"tariff_config", territory_code]` — and thread the
  territory tag through the settle path's tariff lookup
  ([`settle_offchain.rs:136`](../../../programs/trading/src/instructions/settle_offchain.rs)).
  Until then, MEA and PEA either (i) share the one config and coordinate a single joint rate,
  or (ii) express per-territory rates through the already-per-zone
  `ZoneConfig.wheeling_charge_bps`
  ([`trading/src/state/zone_config.rs`](../../../programs/trading/src/state/zone_config.rs)),
  which the settle path would need to consult. Each `mea`/`pea` doc owns the authoritative
  per-territory `*_tariff` schedule regardless, and drives whichever binding is chosen.

## 6. Suggested deployment / init order

```
(existing) bootstrap → init-registry → init-oracle → init-market
                     → init-governance → init-zone-config
(new)      init-egat            (wholesale_market; register generators)
           init-mea / init-pea  (utility; tariff; then license + endorse aggregators)
           init-load-aggregator (dr_program; portfolios enroll after licensing)
```

MEA/PEA must initialize before `load-aggregator` portfolios can be licensed, and before
`trading::TariffConfig` authorities are repointed to the utility PDAs. `egat` is independent of
the retail chain and can init in parallel.

## 7. Open questions carried into implementation

1. **Delta A vs endorsement.** Is ERC comfortable delegating admit to MEA/PEA program PDAs, or
   must every admission keep a human ERC signature (endorsement-only)? Decides whether `mea`/`pea`
   CPI into governance or just write an endorsement PDA.
2. **Wholesale clearing rule.** EGAT day-ahead: uniform System Marginal Price (SMP) or
   pay-as-bid? Availability/capacity payments (ESB) modeled on-chain or left off-chain? (§ egat doc §5.)
3. **DR baseline method.** Which baseline (e.g. high-X-of-Y, regression, control-group) is the
   on-chain settlement authority, given the oracle only stores per-meter cumulative readings?
4. **Collateral asset.** TPA deposits + aggregator bond in GRX, THBC, or mixed — and does the
   utility custody it, or does it stay in `registry`'s GRX bond vault with the utility only
   gating release?
5. **Per-territory tariff (Delta B).** Adopt the `[b"tariff_config", territory]` migration, or
   route territory rates through `ZoneConfig`?

---

*Design-set index. Companion real-world backing: [`thailand-market-context.md`](../../design/thailand-market-context.md)
(ESB, PDP2026, EGAT/MEA/PEA roles), [`cost-fee-structure.md`](../../design/cost-fee-structure.md)
(wheeling, VAT, TPA fees, aggregator margin), [`node-validator.md`](../../design/node-validator.md)
(the off-chain aggregator node these programs coordinate with).*
