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

### §2a — treasury commitment instruction — DONE (commit 930bf52)

- [x] T2a.1 `SettlementRecord` zero-copy PDA (112B, hand-padded), seeds `[b"settlement", zone_id, batch_id]`: `merkle_root[32]`, `recorder`, `total_value`, `vat_amount`, `committed_ts`, `batch_id`, `zone_id`, `vat_rate_bps`, `bump`, `_padding`.
- [x] T2a.2 `record_settlement_batch(value, merkle_root, vat_amount, vat_rate_bps, zone_id, batch_id)` — bumps `total_settled_thbg`, inits the per-batch `SettlementRecord`, authorized by `settlement_recorder`. VAT rate per-batch (no Treasury-struct change). `compute_fn!` + Clock hoisted.
- [x] T2a.3 `SettlementBatchRecorded` event (value/VAT/rate/root/total).
- [x] Tests (`tests/settlement_commitment_litesvm.ts`, litesvm, 3 passing): commit+total bump; recorder gate; duplicate-`(zone,batch)` rejected.

### §2b — wire trading batch path → treasury commitment — TODO (needs validator/CI)

> **Verification note:** the batch settle path (`SettleOffchainMatchBatchContext`) moves escrow funds and is ~20 accounts + 2 Ed25519 verify ixs per match. It is **not** litesvm-testable cheaply; its test runs under `anchor test` (live validator), like `tests/escrow_settlement.ts`. Do this task only where a validator/CI is available — compile-only is insufficient for a CPI-init account-threading change (PDA-seed / signer / account-order errors surface at runtime, not compile).

- [x] T2b.1 Added args to `batch_settle_offchain_match`: `merkle_root: [u8;32]`, `vat_amount: u64`, `vat_rate_bps: u16`, `batch_id: u64`. (`zone_id` from `zone_market.zone_id`.) **(compile-verified)**
- [x] T2b.2 Added `settlement_record: Option<UncheckedAccount>` (mut) to `SettleOffchainMatchBatchContext` (`payer`/`system_program`/`treasury_*` already present). **(compile-verified)**
- [x] T2b.3 Post-loop treasury block now calls `treasury::cpi::record_settlement_batch(value, merkle_root, vat_amount, vat_rate_bps, zone_market.zone_id, batch_id)` with `RecordSettlementBatch { treasury, settlement_record, recorder: market_authority, payer, system_program }`, `new_with_signer`. `TreasurySettlementRequired`/`TreasuryCurrencyMismatch` preserved; `settlement_record` required when recording fires. **(compile-verified; IDL confirms args + account)**
- [x] T2b.4 Single `settle_offchain_match` left on `record_settlement` (per-batch commitment only).
- [x] T2b.5 Client PDA helper added: `scripts/settlement-pda.ts` → `settlementRecordPda(zoneId, batchId)` derives `[b"settlement", zone_id_le(u32), batch_id_le(u64)]` under the treasury program. **Verified** it matches the litesvm test's on-chain-confirmed derivation (`HHYQ…` for zone 301/batch 42). Wiring it into an actual batch-settle caller still needs the off-chain match flow (validator-bound).

> **Verification status:** §2b is **on-chain verified, both paths.** The **single** `settle_offchain_match` path (incl. the `record_settlement` treasury CPI) passes via `tests/escrow_settlement.ts` (4/4). The **batch** path (`batch_settle_offchain_match` → `record_settlement_batch` + per-batch `SettlementRecord`) now passes via `tests/batch_settle_thbg.ts` (1/1). Getting the batch path green required a **program fix**: the batch handler read each `OrderNullifier` via `Account::try_from` and only updated `filled_amount` — it never created the PDA (the single path uses `init_if_needed`, which the `remaining_accounts` batch path can't). It now creates+seeds a fresh nullifier in-loop via a signed `system::create_account` CPI (`ensure_nullifier_initialized`), so fresh off-chain matches settle (previously failed `AccountNotInitialized`/3012). Remaining batch TODOs (negative cases, CU, root-rebuild) below.

### On-chain test recipe (reproducible — this is how A2 was run)

The in-session validator dies on a default TTL; disable it and run the full chain:

```bash
SOLANA_VALIDATOR_TTL=0 just solana-up          # fresh validator, no auto-kill (superproject dir)
export ANCHOR_PROVIDER_URL=http://localhost:8899 ANCHOR_WALLET=$HOME/.config/solana/id.json
anchor deploy --provider.cluster http://localhost:8899   # my wallet = upgrade authority (fresh chain)
npx tsx scripts/bootstrap.ts                    # creates the Token-2022 energy mint (mint_2022) + base state
# for THBG-market tests also: npx tsx scripts/init-treasury.ts
npx mocha -r tsx tests/<suite>.ts --timeout 1000000
```

Gotchas learned: (1) a pre-existing validator deployed by another upgrade authority can't be upgraded — use a fresh chain you deploy; (2) energy mint is Token-2022, currency is classic — token programs must match per mint; (3) Anchor 1.0 needs optional accounts passed as `null`; (4) the long settle test is sensitive to validator websocket-pubsub flakiness on confirm.

### A2 provider regression — DONE (on-chain, this session)

- [x] `tests/treasury.ts` — 9/9 (swap/stake/redeem/slashStake; §2a treasury clean)
- [x] `tests/staking.ts` — 7/7 (§1 slash: reject non-auth + full slash → fund → Slashed; outdated tests fixed in `f06ee5d`)
- [x] `tests/escrow_settlement.ts` — 4/4 across runs (token-program + optional-account fixes in `7cfb5e0`/`62aad8a`; the signed off-chain **settle passes**, proving the `record_settlement` CPI on-chain)

### §2b batch runtime — happy + total_settled_thbg + TreasurySettlementRequired DONE (on-chain)

`tests/batch_settle_thbg.ts` — 2/2 on a live validator. Required the
`ensure_nullifier_initialized` program fix (see verification status above) +
three test-setup fixes (THBG funding vs swap rate, idempotent ATA, tx
`recentBlockhash`). **Rebuild + redeploy current `trading.so` before running** —
a stale binary resurfaces the `remaining_accounts.len()` mismatch.
Note: `batchId` is now per-run (`Date.now()`) — the validator ledger persists
across runs, so a fixed `(zone,batch)` `SettlementRecord` PDA collides on re-run.

- [x] Setup: `init-treasury.ts` (sets `settlement_thbg_mint`), attest reserve, users swap GRX→THBG, deposit THBG + energy escrows.
- [x] Batch THBG settle writes the `SettlementRecord` (root/VAT/zone/batch, via `scripts/settlement-pda.ts`).
- [x] `TreasurySettlementRequired` (6031) fires when treasury/settlement_record omitted on a THBG market — asserted via send + `conf.value.err` `Custom:6031`.
- [x] Assert `total_settled_thbg` bumped by gross — happy-path captures the cumulative pre/post settle and asserts the delta == `total_value` (= `matchAmount*matchPrice`), not the VAT-adjusted/escrow-net figure. 2/2 on-chain.
- [ ] `TreasuryCurrencyMismatch` (6030) on wrong currency — needs a 2nd currency mint + market reconfig (alt-currency escrows); heavier, deferred.
- [x] CU under budget (batch + CPI-init) — 1-match batch settle ≈ **80–92k CU** (`BENCH_BATCH_SETTLE_CU`), asserted < 1.4M; recorded in `BENCHMARKS.md`. ~12k spread is `find_program_address` bump-seek noise on fresh keypairs, not ledger drift. Off-chain rebuilt-root == on-chain root still moot (the test root is synthetic `1..32`, not a real Merkle tree).
- [x] Batch-CU curve at >1 match — **single-tx cap = 1 match** (per-match inline Ed25519 verify ix data can't go in an ALT; 2 matches overrun the 1232-byte packet). A real marginal curve needs reworked sig packaging — documented in `BENCHMARKS.md`.
- [x] TPS sweep over the batch settle path (`tests/batch_settle_tps.ts`) — open-loop goodput, single authority: **~0.5 TPS, flat** (conc 5→0.51, 10→0.58; N=10, 100% goodput, 0 reverts, CU ≈86–89k). No concurrency scaling + always 1 retry round = single-shard write contention (one payer → one `marketShard`/`zoneShard`). Recorded in `BENCHMARKS.md`.
- [ ] Multi-authority settle sweep (distinct payers → distinct shards) for Sealevel parallelism; true open-loop (no per-round barrier) for peak TPS; per-match marginal CU once sig packaging reworked.

## §3 — Feasibility spike (GATE — before any trustless work) — DO THIRD

Goal: prove or kill the trustless fraud-proof path **before** spending on it. PoC only, throwaway.

> **Verification note:** CU measurement (T3.2) requires on-chain execution — run under a live validator / `anchor test`, not litesvm.

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
