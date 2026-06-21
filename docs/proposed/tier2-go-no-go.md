# Trustless Settlement Tier-2 — Go/No-Go Decision

> **Status: DECISION DOC (recommendation: NO-GO for now).** Resolves the §3
> feasibility-spike gate in [`implementation-plan.md`](implementation-plan.md).
> The CU/soundness questions the spike existed to answer are **cleared**; the
> remaining blocker is an architectural one (settlement finality), and for a
> permissioned PoA network the cost/risk does not yet justify it. This is a
> recommendation to a human owner, not a unilateral close — re-open if the
> trust model changes (e.g. moving off PoA, or external/adversarial aggregators).

---

## 1. What was being decided

Whether to build a **trustless on-chain fraud-proof + challenge-response** layer
("Tier-2 settlement validity") so a dropped or mis-settled match can be proven on
chain and adjudicated without trusting governance — vs. the **governance-attested**
slashing that ships today (decision D3).

The §3 spike was the gate: prove the fraud-proof primitive is *cheap enough* and
*sound* before committing to the epic.

## 2. What the spike settled (CLEARED)

- **Soundness — exclusion proofs work.** An indexed Merkle tree proves a match was
  *dropped* (non-membership) via the bounding "low leaf": valid drops verify, and
  both forge classes (claim-present-absent; widen the range) are rejected — proven
  off-chain (`tests/spike_merkle_exclusion.ts`, 5/5) and on-chain
  (`tests/spike_merkle_cu.ts`, 6/6, forge vectors revert).
- **CU — negligible.** On-chain inclusion verify ≈ 3 250 CU (depth 10) / 4 114
  (depth 14); exclusion ≈ 3 629 / 4 493 — ~216 CU/level. Per-challenge cost =
  the existing Ed25519 SigVerify precompile (already inside the ~85–103k settle
  CU) + this ~3.6k Merkle verify: **< 2% of the 200k default budget**. CU does
  **not** block a trustless Tier-2. (Recorded in `BENCHMARKS.md`.)

**Conclusion:** the thing the spike was meant to test is no longer a risk.

## 3. The actual blocker (UNRESOLVED — architectural, not CU)

Settlement is **immediate and atomic**: `trading::settle_offchain_match` /
`batch_settle_offchain_match` move escrow funds at match time. There is **no
revert window** (`implementation-plan.md` "Settlement model"). A trustless
challenge is only meaningful if there is something to *undo* — so a real Tier-2
requires a **settlement-finality redesign**, not just the (cheap) proof verify:

1. **Delayed finality / challenge window.** Funds must be *held* (escrow / pending
   state) for a challenge period before they are spendable, instead of settling
   instantly. This contradicts the continuous-CDA, settle-on-match design.
2. **A `Committed → Finalized` state machine** + a `finalize_settlement` path
   (explicitly *removed* from the current model), plus `challenge` /
   `resolve_challenge` instructions and per-batch challenge accounting.
3. **Liveness/economic params.** Window length, challenger bond + anti-griefing,
   reward for a valid challenge, interaction with the existing GRX validator bond
   and the new transparent slash fund (§1).
4. **The three 🔴 design assumptions** from the plan's design review remain:
   (a) a vanilla Merkle root can't prove a drop — *resolved* (indexed tree, §3);
   (b) optimistic challenge grafted onto immediate settlement has nothing to
   revert — *this is item 1, still open*; (c) a per-epoch root contradicts
   continuous CDA — the §2 commitment is already per-batch, so a challenge model
   must be per-batch too.

This is a **large, settlement-core redesign** with real latency/UX cost (trades
no longer final on match), on the highest-risk part of the system.

## 4. Recommendation: NO-GO (keep governance-attested) — for now

For a **permissioned PoA** network where utilities/operators are the trust root:

- Governance-attested slashing (shipped: §1 severity-scaled slash + capped
  multi-victim compensation + transparent fund) already delivers the *economic*
  deterrent and victim make-whole — ~70% of the value at ~20% of the risk
  (design-review thesis).
- The §2 per-`(zone,batch)` `SettlementRecord` (Merkle root + VAT) already gives
  **audit-grade tamper evidence**: off-chain verifiers recompute the root and can
  *detect* a dropped match; governance then acts. The on-chain *automatic*
  adjudication is the only delta, and it costs a settlement-finality redesign.
- The CU win (cheap proof) does not offset the latency/complexity of delayed
  finality on a network that doesn't need trustlessness against its own operators.

**Decide GO only if** the trust model changes: moving off permissioned PoA,
admitting external/adversarial aggregators, or a regulatory requirement for
trustless (non-governance) dispute resolution. At that point this becomes a
scoped epic whose first task is the delayed-finality/challenge-window design
(item 1 above), *not* the proof verify (already done).

## 5. Cleanup implied by NO-GO

The §3 spike artifacts are throwaway. On a confirmed NO-GO, revert:
`programs/blockbench/src/instructions/merkle_verify.rs` + its wiring + the
`solana-sha256-hasher` dep, and optionally `tests/spike_merkle_*.ts`. Keep the
BENCHMARKS.md datapoint (the CU figure stays useful as evidence). Left in place
pending the owner's decision so the evidence is reproducible.
