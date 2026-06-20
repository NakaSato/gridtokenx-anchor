# GridTokenX — Implementation Plan: Slashing Distribution & Settlement Audit Commitment

Recommended track to close the highest-value part of the PROPOSED design→code gap,
**without** the high-risk trustless Tier-2 machinery. See the design review below for why.

Source design docs (banner-flagged PROPOSED):
- [`collateral-slashing.md`](collateral-slashing.md) — THBG bond, partial slash, capped victim compensation, fund
- [`blockchain-node-network.md`](blockchain-node-network.md) — Tier-2 settlement validity (Merkle commit + challenge-response)
- [`../design/cost-fee-structure.md`](../design/cost-fee-structure.md) — on-chain VAT recording, Merkle-batched settlement
- [`../design/wallet-authority.md`](../design/wallet-authority.md) — authority map (mostly already implemented)

Current code baseline (verified):
- `treasury::record_settlement(ctx, value: u64)` → bumps one global `total_settled_thbg`. No root/VAT/zone.
- Bond = **GRX** (`registry::stake_grx`, `MIN_VALIDATOR_STAKE`; treasury GRX yield staking, separate product).
- Slash = GRX → single `slash_destination` (registry `slash_validator@827`), redistributed via `fund_rewards`.
- No Merkle / challenge-window / fraud-proof / per-zone settlement record anywhere.

---

## Decisions (DECIDED — recommended track)

- **D1. Collateral asset = GRX.** Keep the existing registry GRX validator bond; change only the *distribution* of a slash. THBG bond + migration is deferred (complexity, third collateral concept).
- **D2. Bond reward = unchanged.** Registry bond stays no-yield security bond; treasury GRX yield-staking stays a separate product. Do not merge.
- **D3. Adjudication = governance-attested (off-chain).** Governance decides fraud and triggers the slash; this matches the permissioned PoA trust model. **Trustless on-chain Merkle fraud proof is DEFERRED** behind a feasibility spike (§3) — a vanilla Merkle root cannot prove a *dropped* match (needs a sparse/indexed tree) and on-chain Ed25519+proof CU is unproven.
- **D4. VAT = data-only.** Record VAT amount/rate as audit/e-Tax data; no on-chain VAT arithmetic enforcement.

### Settlement model (reconciled — important)

`settle_offchain_match` moves escrow funds **immediately and atomically** at match time. There is **no optimistic revert window**. Therefore:
- Settlement finality is **not** gated by any challenge window.
- A proven fraud does **not** reverse a trade; victims are made whole from the aggregator's **bond** (capped victim compensation), and the aggregator is slashed.
- Consequence: there is **no** `finalize_settlement` / Committed→Finalized state machine. The settlement commitment (§2) is **audit data**, not an adjudication gate.

---

## §1 — Slash distribution rework (registry + treasury) — DO FIRST

Goal: replace the single-destination slash with severity-scaled, capped-victim-compensation + transparent-fund distribution. Self-contained; no Merkle/challenge needed.

- [ ] T1.1 Add per-fault-class slash fraction `σ` (bps) to registry config; `slash_amount = checked(σ * bond / 10_000)`.
- [ ] T1.2 `slash_validator` computes `compensation = min(slash_amount, proven_loss)` and fund remainder `F = slash_amount − compensation`; `proven_loss` passed by governance (attested).
- [ ] T1.3 Victim payout: pro-rata across harmed parties by proven loss (remaining-accounts list of victim token accounts + per-victim loss).
- [ ] T1.4 Transparent **fund**: distinct PDA with published accounting; `F` routed there (augment/replace `slash_destination`).
- [ ] T1.5 Top-up rule: after partial slash, if remaining bond `< MIN_VALIDATOR_STAKE` → demote to `Suspended` (reuse existing status) until topped up.
- [ ] T1.6 Preserve guards: only slash `validator_status == Active`; refuse if fund/destination unset; slashed validator barred from re-register (existing `@739`).
- [ ] T1.7 Invariant: `slash_amount == compensation + F` (no value created/destroyed).
- [ ] T1.8 `compute_fn!` wrap; hoist `Clock::get()` before `emit!`; `checked_*`.

Tests:
- [ ] Full slash σ=1, victim fully compensated, remainder→fund (Example 1).
- [ ] Partial slash σ=0.1, top-up demotion below `MIN_VALIDATOR_STAKE` (Example 2).
- [ ] Under-bonded: comp pro-rated, fund=0, no over-pay (Example 3).
- [ ] `Δ == comp + F` invariant.
- [ ] Capped: comp never exceeds proven loss.
- [ ] Refused when fund unset / validator not Active / already Slashed.
- [ ] CU under budget.

## §2 — Settlement audit commitment (treasury) — DO SECOND

Goal: enrich settlement recording with a tamper-evidence root + VAT audit data. **Per-batch**, commit-only (no on-chain verification) — matches the continuous CDA, not a per-epoch root.

- [ ] T2.1 Add `SettlementRecord` zero-copy PDA, seeds `[b"settlement", zone_id, batch_id]`: `merkle_root[32]`, `total_value`, `vat_amount`, `vat_rate_bps`, `zone_id`, `batch_id`, `committed_ts`, `recorder`, `_paddingN`. Manual padding; `8 + size_of`.
- [ ] T2.2 Extend `record_settlement(value)` → `record_settlement(value, merkle_root, vat_amount, vat_rate_bps, zone_id, batch_id)`; init/load the per-batch `SettlementRecord`; keep the `total_settled_thbg` bump.
- [ ] T2.3 Trading call sites (`settle_offchain_match`, `batch_settle_offchain_match`) pass root + VAT; batch records its own root per batch.
- [ ] T2.4 `set_vat_rate_bps` admin (default 700; rate is a parameter — reduced 7% expires 30 Sep 2026).
- [ ] T2.5 Emit settlement event carrying value/VAT/rate/root for off-chain e-Tax + verifier.
- [ ] T2.6 `compute_fn!`; hoist Clock; per-`(zone,batch)` PDA → parallel writes, no global write-lock.

Tests:
- [ ] Record persists root/VAT/zone/batch; two zones write in parallel.
- [ ] `total_settled_thbg` still bumped by gross; `TreasurySettlementRequired` policy intact.
- [ ] VAT rate adjustable; default 700 bps; event exposes value/VAT/rate.
- [ ] Off-chain: rebuild root from match leaves == on-chain root.
- [ ] CU under budget.

## §3 — Feasibility spike (GATE — before any trustless work) — DO THIRD

Goal: prove or kill the trustless fraud-proof path **before** spending on it. PoC only, throwaway.

- [ ] T3.1 Prototype sparse/indexed Merkle tree giving **proof-of-exclusion** (to prove a dropped match). Confirm leaf/index scheme.
- [ ] T3.2 Measure on-chain CU of: Ed25519 meter-sig verify (instruction introspection, as `settle_offchain` does) + Merkle inclusion/exclusion verify, per challenge.
- [ ] T3.3 Decide: CU ≤ budget AND exclusion proofs sound → write a future "trustless Tier-2" epic. Else → **stop**; governance-attested (D3) is the final design for this permissioned network.

Tests / exit criteria:
- [ ] CU measurement recorded vs 200k default / 1.4M max.
- [ ] Exclusion-proof correctness demo (valid drop proven; forged rejected).
- [ ] Written go/no-go in this doc.

---

## Deferred (only if §3 passes)
- Trustless on-chain Merkle fraud proof + challenge-response.
- THBG-denominated bond + migration of live GRX bonds.

## Cross-cutting
- Zero-copy + manual padding recounted; `Space = 8 + size_of::<T>()`; no `String` in zero-copy.
- `overflow-checks = true` retained; explicit `checked_*`/`saturating_*`.
- `compute_fn!` every new handler; CU profiled.
- Hot-path writes to per-entity/per-zone/per-batch PDAs, never global config.
- Update `SKILL.md` + per-program `ARCHITECTURE.md` / `docs/programs/*`; flip design-doc banners as features land.
- Run order per section: `anchor build --ignore-keys` → `npm run test:registry`/`test:treasury` → litesvm → CU profile. Never `cargo` from repo root.

---

## Why this track (design review summary)

The original full plan carried three unreconciled 🔴 assumptions: (1) a vanilla Merkle root can't prove a *dropped* match (needs sparse tree); (2) optimistic challenge grafted onto already-immediate settlement (no revert possible); (3) a per-epoch root contradicts continuous CDA settlement. The genuinely-new trustless adjudication is also the highest CU risk, and governance-attested v1 collapses to existing `slash_validator` + a distribution change. For a **permissioned PoA** network where utilities are the trust root, governance-attested slashing + audit-grade commitments deliver ~70% of the value at ~20% of the risk. §1 + §2 ship that; §3 gates whether the trustless remainder is even feasible.
