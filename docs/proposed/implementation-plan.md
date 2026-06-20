# GridTokenX — Implementation Plan: Proposed Settlement-Validity & Collateral Model

Closes the gap between the PROPOSED design docs and the current on-chain code.

Source design docs (all banner-flagged PROPOSED):
- [`blockchain-node-network.md`](blockchain-node-network.md) — Tier-2 settlement validity (Merkle commit + challenge-response)
- [`collateral-slashing.md`](collateral-slashing.md) — THBG bond, partial slash, capped victim compensation, fund
- [`../design/cost-fee-structure.md`](../design/cost-fee-structure.md) — on-chain VAT recording, Merkle-batched settlement
- [`../design/wallet-authority.md`](../design/wallet-authority.md) — authority map (mostly already implemented)

Current code baseline (verified):
- `treasury::record_settlement(ctx, value: u64)` → bumps one global `total_settled_thbg`. No root/VAT/zone.
- Bond = **GRX** (`registry::stake_grx`, `MIN_VALIDATOR_STAKE`; treasury GRX yield staking).
- Slash = GRX → single `slash_destination` (registry `slash_validator`), redistributed via `fund_rewards`.
- No Merkle / challenge-window / fraud-proof / per-zone settlement record anywhere.

---

## Phase 0 — Decisions (BLOCKER, needs sign-off before coding)

- [ ] **D1. Collateral asset: GRX or THBG?** Docs contradict (network doc=GRX §2, slashing doc=THBG). THBG path = new bond vault + migration of existing validators; GRX path = keep current bond, rewrite only distribution. **Recommend: keep GRX bond, adopt the new *distribution* rules (capped victim comp + fund + partial slash).** Smaller blast radius; THBG bond is a separate later phase.
- [ ] **D2. Bond reward: keep yield or move to no-reward?** Slashing doc says no-reward. Treasury staking is currently yield-bearing. Decide whether validator bond and yield-staking stay as two products (current) or merge.
- [ ] **D3. On-chain fraud adjudication feasibility.** Verifying Ed25519 meter sigs + Merkle proof on-chain is CU-heavy and needs the ed25519 native program via instruction introspection. Decide: full on-chain adjudication vs. governance-attested adjudication (cheaper, less trustless). **Recommend: governance-attested for v1, on-chain proof as v2.**
- [ ] **D4. VAT scope.** Record VAT as data only (audit/e-Tax) vs. enforce any arithmetic. **Recommend: data-only fields first.**

Tests for Phase 0: none (design gate). Output = ADR entry per decision.

---

## Phase 1 — Settlement commitment (Merkle root + zone + VAT)

Goal: `record_settlement` binds a per-zone Merkle commitment instead of only a value.

- [ ] T1.1 Add `SettlementRecord` zero-copy PDA, seeds `[b"settlement", zone_id, epoch]`: `merkle_root:[u8;32]`, `total_value:u64`, `vat_amount:u64`, `vat_rate_bps:u16`, `zone_id`, `epoch`, `committed_ts:i64`, `status` (Committed/Finalized/Slashed), `_paddingN`. Follow zero-copy invariant (manual padding, `8 + size_of`).
- [ ] T1.2 Extend `record_settlement(value)` → `record_settlement(value, merkle_root, vat_amount, vat_rate_bps, zone_id, epoch)`; init/load the `SettlementRecord`, keep the existing `total_settled_thbg` bump.
- [ ] T1.3 Update trading CPI call sites (`settle_offchain_match`, `batch_settle_offchain_match`) to pass root + VAT.
- [ ] T1.4 Wrap handler body in `compute_fn!`; hoist `Clock::get()` before any `emit!`.
- [ ] T1.5 TS: aggregator builds Merkle tree off-chain, retains leaves; `scripts/execute-settlement.ts` + `init-treasury.ts` updated.

Tests:
- [ ] `treasury.ts`: record_settlement persists root/VAT/zone/epoch on the PDA.
- [ ] PDA derivation per `(zone, epoch)` is unique; two zones write in parallel (no shared write-lock).
- [ ] Backward path: trading settlement still bumps `total_settled_thbg` by gross.
- [ ] `TreasurySettlementRequired` policy still enforced for THBG markets.
- [ ] CU profile of `record_settlement` under budget (compute-debug feature).

---

## Phase 2 — Challenge-response window

Goal: committed settlement is challengeable for a window, then finalizes.

- [ ] T2.1 Add `challenge_window_secs` param to treasury config + `set_params`.
- [ ] T2.2 `submit_challenge(zone, epoch, fraud_proof)` — opens/records a challenge against a `Committed` record within the window; store challenger, claimed loss, proof handle.
- [ ] T2.3 `adjudicate(zone, epoch)` — per D3: v1 governance-attested verdict; v2 on-chain Ed25519 + Merkle-proof verification (instruction introspection of the ed25519 native program).
- [ ] T2.4 `finalize_settlement(zone, epoch)` — after window with no upheld challenge, set `Finalized`; reject if challenged-and-unresolved.
- [ ] T2.5 Events: `SettlementChallenged`, `SettlementAdjudicated`, `SettlementFinalized` (hoist Clock).

Tests:
- [ ] Challenge inside window accepted; outside window rejected.
- [ ] Finalize blocked while an open challenge exists.
- [ ] Finalize succeeds after clean window expiry (litesvm clock warp).
- [ ] Adjudication verdict transitions Committed→Slashed (fraud) / →Finalized (dismissed).
- [ ] v2 only: valid Merkle proof of a dropped match upholds; forged proof rejected.

---

## Phase 3 — Slash distribution rework (partial + capped victim comp + fund)

Goal: replace single-destination slash with σ-fraction + capped compensation + fund remainder.

- [ ] T3.1 Add per-fault-class slash fraction `σ` (bps) config; `slash_amount = σ * bond` (checked).
- [ ] T3.2 Compensation = `min(slash_amount, proven_loss)`, pro-rata across victims by proven loss; fund remainder `F = slash_amount − compensation`.
- [ ] T3.3 Add transparent **fund** account (PDA, published accounting), distinct from victim payouts. Replace/augment `slash_destination` semantics.
- [ ] T3.4 Top-up rule: after partial slash, if remaining bond `< MIN_VALIDATOR_STAKE` → demote to Suspended (reuse existing status logic) until topped up.
- [ ] T3.5 Preserve guards: only slash `validator_status == Active`; refuse if destination/fund unset.
- [ ] T3.6 Invariant enforce: `slash_amount == compensation + F` (eq. 6).

Tests:
- [ ] Full slash (σ=1), victim fully compensated, remainder to fund (Example 1 numbers).
- [ ] Partial slash (σ=0.1), top-up demotion when below `MIN_VALIDATOR_STAKE` (Example 2).
- [ ] Under-bonded: compensation pro-rated, fund=0, no over-pay (Example 3).
- [ ] Value-accounting invariant holds (no value created/destroyed).
- [ ] Capped comp: compensation never exceeds proven loss (no bounty-gaming).
- [ ] Slash refused when fund/destination unset, or validator not Active.

---

## Phase 4 — THBG bond migration (only if D1 = THBG)

- [ ] T4.1 New THBG collateral vault PDA, separate from `swap_vault`/`stake_vault` (vault-separation invariant).
- [ ] T4.2 `post_bond`/`return_bond`/`top_up_bond` in THBG; per-zone `B_min` param.
- [ ] T4.3 Honest-exit return after final settlement window.
- [ ] T4.4 Migration path for existing GRX validator bonds (decide: drain/convert/dual-run).

Tests:
- [ ] THBG bond vault separate from peg `swap_vault` (collateral never backs peg).
- [ ] Post → lock → return full bond after clean exit window.
- [ ] Per-zone `B_min` enforced on post and on post-slash top-up.
- [ ] Migration: existing validators handled per chosen strategy.

---

## Phase 5 — VAT / e-Tax recording (data layer)

- [ ] T5.1 VAT fields already on `SettlementRecord` (Phase 1); add `set_vat_rate_bps` admin (rate is a parameter, not constant — expires 30 Sep 2026).
- [ ] T5.2 Emit settlement event carrying energy value, VAT, rate for off-chain e-Tax invoice issuance.

Tests:
- [ ] VAT rate adjustable via admin; default 7% (700 bps).
- [ ] Event exposes energy value / VAT / rate for audit.

---

## Cross-cutting / global checks

- [ ] All new state zero-copy + manual padding recounted; `Space = 8 + size_of::<T>()`.
- [ ] No `String` in zero-copy (use `[u8;N]` + `_len`).
- [ ] `overflow-checks = true` retained; explicit `checked_*`/`saturating_*`.
- [ ] `compute_fn!` wraps every new handler; CU profiled vs 200k default / 1.4M max.
- [ ] Hot-path writes go to per-entity/per-zone PDAs, not global config (Sealevel parallelism).
- [ ] Update `SKILL.md` invariants + per-program `ARCHITECTURE.md`; flip doc banners PROPOSED→IMPLEMENTED per phase.
- [ ] Reconcile the GRX/THBG contradiction across the four design docs once D1 lands.

Run order per phase: `anchor build` → `npm run test:treasury` / `test:registry` → litesvm suites → CU profile. Never `cargo` from repo root; `cd` into program crate.
