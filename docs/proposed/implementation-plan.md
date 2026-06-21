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

## §1 — Slash distribution rework (registry + treasury) — DONE (T1.1–T1.8, on-chain 13/13)

Goal: replace the single-destination slash with severity-scaled, capped-victim-compensation + transparent-fund distribution. Self-contained; no Merkle/challenge needed.

> **Status (code reconciled 2026-06-20):** the core rework is **already implemented** in `registry::slash_validator` (`programs/registry/src/lib.rs:839`). The plan checkboxes were stale — corrected below. Two items remain genuinely open (T1.3 multi-victim, T1.4 distinct fund PDA), both design-gated. On-chain re-verification (`tests/staking.ts`) is pending a live validator (the in-session one died; bring up via the recipe in §2 before re-running).

- [x] T1.1 Severity fraction `σ` — implemented as a **per-call arg** `slash_bps` (1..=10000, `InvalidSlashFraction` guard), `slash_amount = bond * slash_bps / 10_000` capped at bond (`lib.rs:883`). Deviation from "registry config table": severity is **governance-attested per slash**, not a stored per-fault-class table — fits the D3 governance-attested model; revisit only if fault classes need fixed on-chain rates.
- [x] T1.2 `compensation = min(slash_amount, proven_loss)`, fund remainder `F = slash_amount − compensation`; `proven_loss` is a governance-attested arg (`lib.rs:889`).
- [x] T1.3 **DONE (additive).** Multi-victim pro-rata payout shipped as a NEW instruction `registry::slash_validator_multi` (`lib.rs`, ctx `SlashValidatorMulti`) — victims passed as `remaining_accounts` parallel to a `victim_losses: Vec<u64>` arg; `pool = min(slash_amount, Σloss)`, victim `i` gets `pool * loss_i / Σloss` (floor; dust → fund), fund = `slash − Σpaid`, `slash == Σpaid + fund` invariant, same Suspended/Slashed transitions + guards (`VictimCountMismatch` added). The single-victim `slash_validator` is left untouched (no interface break). On-chain verified `tests/staking.ts` 13/13 (A=3000,B=1000 pro-rata of a 10k slash, fund=6000, Active) via the typed client (registry IDL regenerated with `anchor build -p registry --ignore-keys`).
- [x] T1.4 **DONE (additive).** Distinct transparent fund PDA + published accounting shipped: `registry::initialize_slash_fund` creates a registry-owned GRX vault `[b"slash_fund"]` + a `SlashFundLedger` PDA `[b"slash_fund_ledger"]`; point `slash_destination` at the vault so slash remainders route in automatically (inflows = vault balance), and `registry::disburse_slash_fund(amount)` pays out (e.g. to treasury `reward_vault` for `fund_rewards`), PoA-gated + bounded by vault balance, bumping `total_disbursed`/`disbursement_count` and emitting `SlashFundDisbursed`. Single/multi slash paths unchanged (additive). On-chain verified `tests/staking.ts` 13/13: full slash → bond into fund, disburse 5k → destination + typed `SlashFundLedger.total_disbursed` delta. Called via the typed client (registry IDL regenerated; `slash_validator_multi`/`initialize_slash_fund`/`disburse_slash_fund` + `SlashFundLedger` now in the IDL).
- [x] T1.5 Top-up demotion: partial slash leaving `remaining < MIN_VALIDATOR_STAKE` → `Suspended`; full forfeiture (`slash_bps == 10000` or `remaining == 0`) → terminal `Slashed` (`lib.rs:949`).
- [x] T1.6 Guards: only `validator_status == Active` (`NotActiveValidator`); refuse if `has_slash_destination == 0`; authority-only; destination must equal the configured one (no misroute); full slash → `Slashed` bars re-registration.
- [x] T1.7 Invariant `slash_amount == compensation + fund_amount` enforced (`SlashAccountingMismatch`, `lib.rs:896`).
- [x] T1.8 `compute_fn!` wrap + `compute_checkpoint!` around CPIs; `Clock::get()` hoisted before `emit!`; `checked_*`/u128 math.

Tests (`tests/staking.ts`):
- [x] Reject non-authority slash; full slash σ=1 → fund → `Slashed` (per prior on-chain run, plan §A2 line; outdated tests fixed in `f06ee5d`).
- [x] Partial slash σ=0.1 → `Suspended` demotion below `MIN_VALIDATOR_STAKE` (Example 2) — `tests/staking.ts` "partial slash demotes to Suspended" (bond==MIN, 10% slash → remaining 90% < MIN → Suspended).
- [x] Capped comp, both directions: proven_loss < slash → comp = proven_loss, remainder → fund, stays Active; proven_loss > slash → comp capped at slash_amount, fund=0. Asserts victim/fund deltas + the value invariant `comp + fund == slash_amount == vault drain`.
- [x] `slash_amount == comp + F` invariant — enforced on-chain (program `require!`) **and** asserted via balance deltas in the capped-comp test.
- [x] Capped: comp never exceeds proven loss — `min(slash_amount, proven_loss)` (program), asserted both directions.
- [x] Refused when destination unset / validator not Active / already Slashed — guards present; non-auth + status guards exercised.
- [x] CU under budget — `slash_validator` (comp+fund two-transfer path) = **27 811 CU** (`BENCH_SLASH_CU`), well inside the 200k default budget.
- [x] **On-chain verified (2026-06-21)** — `tests/staking.ts` **11/11** on a fresh validator (Solana 3.1.10, full deploy): vault init, stake, validator register (min-stake gate), unstake cooldown, slash non-authority reject, authority full-slash → `Slashed`, **partial-slash → `Suspended`**, **capped-compensation (both directions) + value invariant**, **slash CU datapoint**.

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
- [x] **Settle-path validation guards — DONE** via a new in-process litesvm full-match harness
  (`tests/settle_offchain_guards_litesvm.ts`, **9/9**). First harness that boots trading
  market+zone+shards+collectors, the energy Token-2022 mint, and the treasury in-process; signs a match
  with two Ed25519 precompile ixs; compresses the ~23-account settle through a hand-built ALT installed
  via `setAccount`. One valid-match template drives a positive control + every guard via field overrides
  (Ed25519 msgs regenerate from payloads → sigs stay valid). Guards asserted, all previously untested:
  - `TreasuryCurrencyMismatch` (6030): treasury passed but `thbg_mint` ≠ settlement currency → reverts at
    `require_keys_eq!` (`settle_offchain.rs:474`) **before** any `record_settlement` CPI. Lighter than the
    deferred live-validator 2nd-mint/market-reconfig route — the trigger is a mismatched-mint treasury,
    not an alt-currency market. Positive control (treasury omitted) settles the same match end-to-end.
  - `SlippageExceeded` (both directions: `match_price` above buyer limit / below seller limit).
  - `InvalidOrderSide` (wrong side flag), `InvalidAmount` (zero match amount).
  - `CapacityExceeded`: a cross-zone match (both legs zone 8) settled against a low-cap zone (cap 50,
    amount 60) → throttled at the `committed_flow + amount ≤ capacity` check ([[settlement-tps-zone-market-lock]]).
  - **Replay / double-settle**: re-submitting the control's order ids reverts at the per-order nullifier
    replay guard (`match_amount > remaining` → `InvalidAmount`), proving a signed order can't settle twice.
  - `OrderExpired`: bank clock warped past a non-zero `expires_at` (via litesvm `setClock`) → rejected.
- [x] CU under budget (batch + CPI-init) — 1-match batch settle ≈ **80–92k CU** (`BENCH_BATCH_SETTLE_CU`), asserted < 1.4M; recorded in `BENCHMARKS.md`. ~12k spread is `find_program_address` bump-seek noise on fresh keypairs, not ledger drift. Off-chain rebuilt-root == on-chain root still moot (the test root is synthetic `1..32`, not a real Merkle tree).
- [x] Batch-CU curve at >1 match — **single-tx cap = 1 match** (per-match inline Ed25519 verify ix data can't go in an ALT; 2 matches overrun the 1232-byte packet). A real marginal curve needs reworked sig packaging — documented in `BENCHMARKS.md`.
- [x] TPS sweep over the batch settle path (`tests/batch_settle_tps.ts`) — open-loop goodput: **~0.5–0.6 TPS, flat** (conc 5→0.51, 10→0.58; N=10, 100% goodput, 0 reverts, CU ≈86–89k). Recorded in `BENCHMARKS.md`.
- [x] Root-caused the contention: **NOT the shard.** Spreading across all 16 shards (`BENCH_TPS_SHARD_SPREAD=1`) gave identical numbers (0.59/0.57, still 2 rounds). Serialization is the global writable accounts every settle touches — `treasury_state` (`total_settled_thbg` accumulator) + the 3 fixed fee/wheeling/loss collectors. Settlement is global-write-bound by design; sharding parallelizes order submission, not settlement.
- [ ] True open-loop (no per-round barrier) for peak TPS; shard the treasury accumulator/collectors (or amortize more matches per CPI, blocked by 1-match cap) to parallelize settlement; per-match marginal CU once sig packaging reworked.

## §2c — Shard the settlement write set (throughput) — Part A+B DONE; TPS win blocked on zone_market + open-loop bench

Goal: lift settle TPS off the ~0.5 TPS floor. §2b root-caused the ceiling (line 123):
settlement is **global-write-bound** — every settle write-locks the same accounts, so
Sealevel serializes them regardless of order/shard. Two write sets to shard:

1. **`treasury_state.total_settled_thbg`** accumulator (CPI `record_settlement*`).
2. **`fee_collector` / `wheeling_collector` / `loss_collector`** ATAs (token-transfer
   destinations in `settle_offchain.rs`).

Sharding only one leaves the other serializing — both must shard to move TPS.

### §2c Part A — accumulator shard (treasury) — DONE (litesvm 5/5)

Self-contained, CPI-only, no fund movement. Mirrors the registry 16-shard counter.

- [x] `SettlementShard` zero-copy PDA (24B, hand-padded), seeds `[b"settle_shard", &[shard_id]]`:
  `settled_thbg`, `settlement_count`, `shard_id`, `bump`, `_padding` (`state.rs`). `NUM_SETTLE_SHARDS = 16`,
  `settle_shard_for(key) = key[0] % 16`.
- [x] `initialize_settlement_shard(shard_id)` — admin-gated, one PDA per shard (`lib.rs`).
- [x] `record_settlement_sharded(value, shard_id)` — bumps the shard PDA, **not** the global.
  Treasury passed **read-only** (recorder gate only) — a shared read lock does not serialize
  parallel settles, unlike the `mut` treasury in `record_settlement`. Shard bound to `shard_id`
  by PDA seeds (no scatter). `compute_fn!` + Clock hoisted + `checked_*`.
- [x] `aggregate_settlement_shards` — admin; sums shards from `remaining_accounts`
  (program-owner + stored-bump-PDA validation, `u16` shard-id dedup bitmask) → `total_settled_thbg`.
  Global total stale-on-purpose, same trade-off as registry `aggregate_shards`.
- [x] Errors `InvalidShardId` / `DuplicateShard`; event `SettlementShardRecorded` (shard total, not global).
- [x] Tests `tests/settle_shard_litesvm.ts` **5/5**: per-shard accumulation + count, global stays 0
  until aggregation, recorder gate, out-of-range shard reject, aggregation sums across shards,
  duplicate-shard reject. Sibling litesvm suites (commitment/slash/staking) **10/10**, no regression.
  (Build: `anchor build -p treasury --ignore-keys` then **copy** `programs/treasury/target/deploy/treasury.so`
  → root `target/deploy/` for litesvm — SKILL gotcha #1.)

### §2c Part B — collector ATA shards (trading, batch path) — DONE plumbing; TPS win NOT shown

Scope: batch path only (the TPS-benchmarked one). Touches the escrow **fund-movement** path and is an
interface change to `batch_settle_offchain_match` (account-set + a new `settle_shard_id: u8` arg). Verified
under a live validator (Solana 3.1.10), not litesvm.

- [x] T2c.1 Sharded collectors: seeds `[b"fee_collector", currency_mint, &[shard_id]]` (+ wheeling/loss),
  created by `initialize_sharded_collectors(shard_id)` (`escrow.rs`). Same `market_authority` seed-binding —
  fees can't be redirected.
- [x] T2c.2 `SettleOffchainMatchBatchContext` collectors keyed by an **explicit `settle_shard_id` arg**,
  NOT payer-derived. **Design correction:** payer-derived sharding is useless in production — one service
  wallet pays every settle, pinning all to one shard. The off-chain matcher rotates `settle_shard_id` to
  spread load. Validated `< NUM_SETTLE_SHARDS` in the handler.
- [x] T2c.3 Treasury CPI routed through new `record_settlement_batch_sharded(...,shard_id)` (Part A's shard
  + the per-(zone,batch) `SettlementRecord`), dropping the global `total_settled_thbg` write off the hot path.
- [x] T2c.4 `sweep_collectors(shard_id)` — permissionless consolidation of a shard's 3 ATAs into the
  canonical (unsharded) collectors (both `market_authority`-owned → can't exfiltrate).
- [x] T2c.6 CU under budget: batch settle (sharded) ≈ **87k CU** (`tests/batch_settle_thbg.ts`), < 1.4M.
- [x] Correctness verified on-chain (`tests/batch_settle_thbg.ts` 2/2): the per-shard accumulator advances by
  the gross value, the **global total stays flat** (reconciled only via aggregation), buyer receives energy,
  `TreasurySettlementRequired` (6031) still fires. Sharded litesvm accumulator (`settle_shard_litesvm.ts`) 5/5.
- [~] **T2c.5 TPS win NOT demonstrated — confirmed unmeasurable at localnet scale.** Sweep
  (`tests/batch_settle_tps.ts`, N=8 conc=8, Solana 3.1.10): baseline (pinned shard 0) **0.41 TPS**,
  sharded-spread **0.47 TPS** — within noise, no real gain. A `BENCH_BATCH_SLOTTPS` slot-density probe
  (counts landed-tx per on-chain slot span, independent of confirm-poll latency) settles it: pinned landed
  8 settles across **slot_span=40** (0.20/slot), spread across **slot_span=35** (0.23/slot) — i.e. ~1 settle
  every 5 slots, **never two in the same slot**. With zero same-slot writers there is no write-lock to relieve,
  so pinned vs spread is statistical noise by construction. Two reasons:
  1. **Harness is latency-bound, not contention-bound.** Both runs report `dropped=0 reverted=0` — the validator
     dropped **zero** same-slot writers, i.e. there was no write-lock contention to relieve. The ~0.4 TPS is the
     closed-loop harness's ALT-setup + confirm-poll latency, not a throughput ceiling. A real measurement needs a
     **true open-loop generator** (submit without per-tx confirm, count landed-tx/slot) — already listed open below.
  2. **`zone_market` is still a global `mut` lock the §2b root-cause missed.** Every settle does
     `zone_market.load_mut()` (`settle_offchain.rs:591`) and the account is declared `mut` (`:251`) **regardless**
     of whether `committed_flow` is updated, so Sealevel write-locks the singleton zone PDA on every settle.
     Sharding collectors + treasury removed two of ≥3 global writes; this one remains. Hard to shard: the capacity
     throttle is a **global** cap, and Anchor's static account model can't conditionally lock — intra-zone settles
     (the common, no-wheeling case) still pay the lock. A fix needs either two instruction variants
     (intra read-only / cross mut) or moving `committed_flow` to the per-shard `zone_shard` with periodic global
     reconciliation — a separate, larger change.

**Net:** Part B sharding is correct and shipped (collector + treasury locks gone, on-chain verified), but it does
**not** move measured TPS, because (1) the bench harness is latency-bound and (2) `zone_market`'s unconditional
`mut` lock is the dominant remaining serializer. Closing the throughput gap is gated on the two open items below.

### §2c open (throughput, deferred)
- True open-loop TPS generator (no per-round confirm barrier) — without it, neither the win nor the remaining
  bottleneck is measurable on the current closed-loop harness.
- Make `zone_market` read-only on the settle hot path (shard `committed_flow` into `zone_shard` + reconcile, or
  split intra/cross settle instructions) — the last global `mut` lock on settlement.

## §3 — Feasibility spike (GATE — before any trustless work) — DO THIRD

Goal: prove or kill the trustless fraud-proof path **before** spending on it. PoC only, throwaway.

> **Verification note:** CU measurement (T3.2) requires on-chain execution — run under a live validator / `anchor test`, not litesvm.

- [x] T3.1 Prototype **indexed** Merkle tree giving **proof-of-exclusion** (`tests/spike_merkle_exclusion.ts`, throwaway PoC — 5/5, no validator). Leaf/index scheme confirmed: leaf = `H(value ‖ nextValue ‖ nextIndex)` (sentinel leaf 0 = `{0,0,0}`), sorted linked list. Non-membership of `q` = inclusion proof of the low leaf `L` with `L.value < q < L.nextValue` (or `L.nextValue == 0` for max) — O(log n) hashes (DEPTH 10 here), not the 2^256 SMT path. Both forge vectors rejected: claiming a present id absent fails the range check; widening `nextValue` fails the root check. Chose indexed over sparse precisely to keep the T3.2 on-chain proof small. (sha256 in the spike; on-chain → keccak syscall.)
- [x] T3.2 Measured on-chain CU of the Merkle verify (`tests/spike_merkle_cu.ts` → throwaway `blockbench::merkle_verify_inclusion`/`_exclusion`, sha256 ladder, live validator Solana 3.1.10): **inclusion 3 250 CU @ depth 10 / 4 114 @ depth 14; exclusion 3 629 / 4 493** — ~**216 CU per tree level**, exclusion ~380 CU over inclusion (extra low-leaf hash + range check). Both forge vectors **revert on-chain** (tampered sibling → root mismatch; claim-present-absent → range check). The Ed25519 leg is the existing SigVerify precompile already measured in the settle path (the 103k single / ~85k batch settle CU *include* 2 ed verifies); per challenge that's 1 meter-sig verify + this ~3.6k Merkle exclusion verify. **Total per-challenge verify ≪ 200k default budget (~2%), ~0.3% of the 1.4M max.**
- [~] T3.3 Decide. **CU gate: PASS** (3–4.5k CU, depth-logarithmic, huge headroom). **Soundness: demonstrated** (valid drop proven, both forge classes rejected — off-chain T3.1 *and* on-chain T3.2). So the *CU-and-soundness* blocker that this spike existed to test is **cleared**. BUT the go/no-go is not CU alone: the three 🔴 design assumptions in "Why this track" remain — chiefly that settlement is **immediate/non-reversible**, so an optimistic challenge has nothing to revert. A trustless Tier-2 would need a settlement-finality delay (escrow hold / challenge window) before funds move, which is a larger redesign. **Recommendation: CU/soundness no longer block trustless; the open gate is the challenge-window redesign — decide that before opening a Tier-2 epic.** Not a unilateral go.

Tests / exit criteria:
- [x] CU measurement recorded vs 200k default / 1.4M max — Merkle verify 3.25–4.5k CU (≤2% of default), recorded above + in `BENCHMARKS.md`.
- [x] Exclusion-proof correctness demo (valid drop proven; forged rejected) — `tests/spike_merkle_exclusion.ts` (off-chain 5/5) + `tests/spike_merkle_cu.ts` (on-chain 6/6, forge vectors revert).
- [x] Written go/no-go — see T3.3 above + the full decision doc [`tier2-go-no-go.md`](tier2-go-no-go.md) (**recommendation: NO-GO for now** — CU/soundness cleared, but a trustless Tier-2 needs a settlement-finality/challenge-window redesign that a permissioned PoA network doesn't yet justify; re-open if the trust model changes).

---

## Deferred (only if §3 passes — current recommendation NO-GO, see [`tier2-go-no-go.md`](tier2-go-no-go.md))
- Trustless on-chain Merkle fraud proof + challenge-response — **gated on a settlement-finality/challenge-window redesign** (the proof verify itself is done + cheap). Re-open only if the trust model leaves permissioned PoA.
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
