# PEA Distribution-Utility Program (`pea`) — PROPOSED

> **⚠️ STATUS: PROPOSED (new program, 2026-07-10).** Not built. `pea` is the **same program
> as [`mea`](./mea-distribution-utility.md)** — identical role, state model, instruction set,
> invariants, CPI, events, and errors — deployed as a **separate crate with its own program
> ID, seed domain, and territory constant**. This doc states only the deltas; for everything
> else, [`mea-distribution-utility.md`](./mea-distribution-utility.md) is authoritative.

## Why a separate program (not a parameter)

MEA and PEA share one statutory role — distribution utility — so the logic is identical. They
are nonetheless two programs (the deployment choice recorded for this design) to get **hard
isolation**: independent upgrade authority per utility, a compromised or paused MEA program
that cannot touch PEA's tariff/collateral/capacity state, and separate program-owned PDA
address spaces so no cross-territory account can ever be substituted. The cost is code
duplication; the two crates should be built from a **shared module** (e.g. a
`shared/distribution-core` crate holding the state structs, handlers, and errors, with each of
`mea`/`pea` supplying only `declare_id!`, the seed-prefix constants, and `TERRITORY_CODE`) so
the logic stays single-sourced even though the deployed artifacts are distinct. This mirrors
how the repo already factors common on-chain types into [`shared/core`](../../../shared/core)
([`ARCHITECTURE.md`](../../../ARCHITECTURE.md) §3).

## Deltas from the MEA spec

| Aspect | MEA | PEA |
| --- | --- | --- |
| Institution | Metropolitan Electricity Authority (กฟน) | Provincial Electricity Authority (กฟภ) |
| Territory served | Bangkok, Nonthaburi, Samut Prakan (metro) | All 74 remaining provinces (provincial) |
| Crate name | `mea` | `pea` |
| Program ID | Unassigned (its own) | Unassigned (**distinct**) |
| `TERRITORY_CODE` | `1` | `2` |
| Singleton seed | `[b"mea_utility"]` | `[b"pea_utility"]` |
| Tariff seed | `[b"mea_tariff"]` | `[b"pea_tariff"]` |
| Licence seed | `[b"mea_lic", agg]` | `[b"pea_lic", agg]` |
| Capacity seed | `[b"mea_cap", zone, agg]` | `[b"pea_cap", zone, agg]` |
| Service-point seed | `[b"mea_sp", meter]` | `[b"pea_sp", meter]` |
| Collateral vault seed | `[b"mea_collateral"]` | `[b"pea_collateral"]` |
| Error enum | `DistributionError` (shared) | `DistributionError` (shared) |

Everything else — the `DistributionUtility` / `DistributionTariff` / `LicensedAggregator` /
`CapacityAllocation` / `ServicePoint` layouts, the full instruction set
(`initialize_utility` … `set_tariff_authority`), all seven invariants, and every CPI edge — is
**exactly** as specified in [`mea-distribution-utility.md`](./mea-distribution-utility.md).

## Territory-specific notes

- **Scale and zone count.** PEA covers vastly more territory and connection points than MEA, so
  its `ServicePoint` population and per-zone `CapacityAllocation` count are far larger. Keep the
  same per-entity-PDA discipline (no growing `Vec` in the singleton) — it is exactly what lets
  the provincial scale parallelize under Sealevel.
- **Customer classes.** The `customer_class_mult: [u16; 4]` (Type 1–4) applies identically;
  provincial tariff *values* differ from metro but the schedule shape is the same
  ([`cost-fee-structure.md`](../../design/cost-fee-structure.md) §2.1 notes MEA and PEA share
  the same Ft but bill different territories).
- **Integration deltas A/B** apply per-territory: PEA endorses its own aggregators
  (`segment = Retail`) and owns its own `[b"pea_tariff"]` schedule. Under Delta B's
  territory-keyed tariff, PEA's `trading` config is `[b"tariff_config", &[2]]`; under the
  interim single-config model, MEA and PEA must coordinate a joint rate or route through
  per-zone `ZoneConfig.wheeling_charge_bps` — the coordination point the index doc flags.

## Testing (target)

Reuse the MEA LiteSVM suite parametrized for `TERRITORY_CODE = 2` and the `pea_*` seed domain
(`tests/pea_distribution_litesvm.ts`), plus one **cross-territory isolation** test asserting
that a PEA-seeded account cannot be passed where an MEA program expects an MEA-seeded one (and
vice-versa) — the property that motivates two programs over one.

---

*See [`mea-distribution-utility.md`](./mea-distribution-utility.md) for the full spec and the
[design-set index](./README.md) for shared conventions and integration deltas.*
