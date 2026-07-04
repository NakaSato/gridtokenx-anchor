# Security / Audit Remediation Status

> **STATUS: IN PROGRESS (2026-06-22).** Tracks the on-chain remediation pass triggered by the
> 6-program business-logic audit. Pairs with [`role-map.md`](./role-map.md) (the institutional
> authority redesign that motivates the Wave-0 enforcement fixes). Verification column: **litesvm**
> = asserted by an in-process `*_litesvm.ts` test here; **cargo** = Rust unit test; **inspect** =
> correct-by-construction / behavior-identical on the normal path; **pending** = needs a live
> validator (`anchor test`).

## Wave 0 — enforcement hardening (make the trust model actually bind)

| # | Fix | Where | Verified |
|---|-----|-------|----------|
| 0.1 | Validator bond requires a governance-admitted aggregator entry (no self-promotion) | `registry::register_validator` + `GOVERNANCE_PROGRAM_ID` | litesvm |
| 0.2 | Slash-escape closed — Active validator can't unstake below MIN to dodge a slash | `registry::unstake_grx` | litesvm |
| 0.3 | Settlement gated on governance maintenance mode (was ungated fund path) | `trading::settle_offchain_match` / `batch_settle_offchain_match` (gov `governance_config` via `remaining_accounts` — [[settle-context-stack-limit]]) | litesvm (single) |
| 0.4 | Network charges (wheeling+loss) capped vs trade value (anti seller-siphon) | `trading` `net_seller_after_charges`, `MAX_NETWORK_CHARGE_BPS` | litesvm (single) |
| 0.5 | REC provenance mandatory — no `rec_validators_count > 0` opt-out | `energy-token::mint_to_wallet` / `mint_generation` | litesvm |

## Follow-ups completed

| Fix | Where | Verified |
|-----|-------|----------|
| Honest-exit `deregister_validator` (timelocked, still-slashable resign) | `registry`: `ValidatorStatus::Resigning`, `resign_at`, `RESIGN_COOLDOWN_SECS`; slash gate accepts Resigning | litesvm |
| `UserAccount` 104-byte layout guard (resign_at carved from padding) | `registry/state.rs` `layout_tests` | cargo |
| Meter-status count integrity — Inactive terminal, only via `deactivate_meter` | `registry::set_meter_status` (`InvalidMeterStatusTransition`) | litesvm |
| `issue_erc` slice-panic DoS — exact `[8..8+size]` slice | `governance/handlers/erc.rs` | inspect |
| Treasury over-pay vector — `total_staked` `saturating_sub`→`checked_sub` | `treasury` unstake + slash | inspect |
| **Proposal/vote zone-binding** — meter bound to one zone; `create_proposal`/`cast_vote` require `meter.zone_id == target_zone` | `registry::MeterAccount.zone_id` + `register_meter` (`zone_id` arg); `governance/handlers/dao.rs` (`MeterZoneMismatch`) | litesvm (`governance_zone_binding_litesvm.ts` — cross-zone proposal + vote rejected) + cargo (layout) |
| `GovernanceConfig` size_test fixed (assert `LEN`, not `mem::size_of`) | `governance/size_test.rs` | cargo |

Full in-process suite green: **`npm run test:litesvm` → 142 passing.**

## Caller landmines wired (ABI changes from 0.1/0.3/0.5) — **pending validator**

The program changes above changed three instruction shapes; these validator-suite callers were
updated to match but are **not runnable in-process** (need `anchor test` against a bootstrapped
validator). Pattern: `bootstrap.ts` inits governance `governance_config` (operational) + energy token but
registers no REC validator and admits no aggregator, so each test self-provisions idempotently
(`addRecValidator` / `admitAggregator`).

- `tests/staking.ts` (0.1 — admit + `aggregatorEntry`)
- `tests/escrow_settlement.ts` (0.3 gov remaining acct + 0.5 REC)
- `tests/batch_settle_thbg.ts`, `tests/batch_settle_tps.ts` (0.3 trailing gov acct + 0.5 REC)
- `tests/generation_mint_idempotency.ts` (0.5 REC)
- `scripts/simulate-token-lifecycle.ts` (0.1 admit + 0.5 REC + zone arg)
- Zone-binding `register_meter` arg added to: `tests/governance_dao.ts` (meter zone = proposal zone 301), `tests/oracle_integration.ts`, `tests/governance.ts` (zone 0). The litesvm callers (`cu_profile_registry`, `registry_meter_reading_guards`) are already green.

Verify: `anchor test` (or `./scripts/run-tests.sh`).

**Zone-binding residual trust:** zone is *self-declared* at `register_meter` — it binds a meter to ONE zone (a meter can no longer vote across zones), but does not prove physical location. Airtight assignment (authority-set or h3-derived from `UserAccount.h3_index`) is a later step. The cross-zone-rejection enforcement IS runtime-verified in `governance_zone_binding_litesvm.ts` (fabricated registry-owned meters); the validator `governance_dao.ts` covers the happy path with real registration.

## Findings investigated, NOT bugs in current code

- **Reserve attestor split** (role-map 1.1) — already implemented: `Treasury.authority` (admin) vs
  `Treasury.attestor`, checked in `update_attestation`.
- **Quorum-0 no-op** — `min_quorum_votes` is set to 100 at init and has no zero-path
  (`update_governance_config` doesn't touch it; no setter).

## Remaining — structural / inherent-trust (NOT one-shot patches)

| Finding | Severity | Why it's a project, not a patch |
|---------|----------|----------------------------------|
| Oracle globals are gateway-asserted (`aggregate_readings`, quality score) | HIGH | inherent to the gateway-trust model; role-map already recommends moving oracle off-chain → redesign |
| `aggregate_shards` silent undercount (subset of shards) | MED | correct fix needs an initialized-shard counter → `initialize_shard` ABI change → wide caller blast |
| Treasury slash-strand (slash last staker → GRX parked unclaimable) | MED | rare edge; correct fix needs deferred-redistribution state + a treasury-staking test harness |
| Tariff authority + per-zone wheeling/loss rate (0.4b) | — | needs the role-map tariff authority decided; replaces the 0.4 sanity cap with a governance-set rate |
| `mint_tokens_direct` registry-faucet REC policy (0.5b) | — | decide: register the registry PDA as a validator vs explicit faucet exemption |

---

*Companion to [`role-map.md`](./role-map.md). The Wave-0 fixes are the on-chain enforcement the
role-map's institutional separation depends on.*
