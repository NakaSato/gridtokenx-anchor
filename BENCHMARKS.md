# GridTokenX Anchor — On-Chain Benchmark Results

Academic-grade benchmark report for the Solana/Anchor programs in this repo.
Three standard OLTP workloads ported to the account model: **BlockBench**
(SIGMOD 2017 micro-benchmarks + YCSB), **SmallBank**, and **TPC-C**.

> Raw machine-readable artifacts (JSON + CSV, one file per run, with full
> reproducibility metadata) live in [`test-results/`](test-results/). The
> tables below are transcribed from the `n=150` scaled runs and the TPC-C
> concurrency sweep.

---

## Environment & Reproducibility

| Field | Value |
|-------|-------|
| Git commit | `3cb3388` (dirty — docs WIP) |
| Solana/agave cluster | 3.1.10 |
| Anchor | `anchor-lang` 1.0.x / `anchor-cli` 1.0.0 |
| Node | v24.16.0 |
| OS / arch | Darwin 25.5.0 / arm64 |
| CPU | Apple M2, 8 cores |
| Validator | local `solana-test-validator` (single node, PoA-style permissioned) |
| Run date | 2026-07-06 |

**Statistical method.** Each operation runs `WARMUP` discarded iterations
followed by `ITERS` measured iterations. Latency is wall-clock
(`performance.now()`, client→confirmed). Reported: sample mean, sample
standard deviation (Bessel `n−1`), percentiles (NumPy type-7 linear
interpolation), and 95% confidence interval of the mean
(`ci95 = 1.96·σ/√n`, normal approx). Compute units captured post-hoc from
`getTransaction(sig).meta.computeUnitsConsumed`. Every JSON artifact embeds
git commit/dirty flag, cluster version, and host metadata.

**Reproduce:**

```bash
# validator must be running with both bench programs deployed
BENCH_ITERS=150 BENCH_WARMUP=10 npm run test:blockbench
BENCH_ITERS=150 BENCH_WARMUP=10 npm run test:smallbank
TPC_TX_COUNT=500 TPC_CONCURRENCY=20 npm run test:tpc-stress
```

> **Caveat.** Latency is dominated by single-node block time (~400–600 ms
> confirmation) and the sequential client submit loop, **not** program
> execution. The *compute-unit* columns are the load-independent, machine-free
> measure of on-chain cost and are the figures to cite for program efficiency.

---

## 1. BlockBench OLTP (n = 150, sequential)

| Operation | n | mean ms | stddev | p50 | p95 | p99 | ci95 | TPS | CU/tx | fail |
|-----------|---|---------|--------|-----|-----|-----|------|-----|-------|------|
| do_nothing | 150 | 485.12 | 4.39 | 484.36 | 491.94 | 498.32 | ±0.702 | 2.06 | 769 | 0 |
| cpu_heavy_sort | 150 | 485.39 | 4.34 | 485.15 | 491.81 | 496.76 | ±0.694 | 2.06 | 10 154 | 0 |
| ycsb_insert | 150 | 485.20 | 3.97 | 484.71 | 490.67 | 495.80 | ±0.635 | 2.06 | 13 773 | 0 |
| ycsb_read | 150 | 0.687 | 0.115 | 0.672 | 0.784 | 0.883 | ±0.018 | 1454 | n/a¹ | 0 |

¹ `ycsb_read` is an RPC account fetch (no consensus round-trip) → ~1454 TPS,
three orders of magnitude faster than write paths, and consumes no on-chain CU.
(On a fresh-reset ledger this run saw 0 `ycsb_insert` duplicate-key collisions,
so all four ops have the full n=150; a prior warm-ledger run lost 20 inserts to
collisions — not program errors.)

**Reading:** `do_nothing` (769 CU) is the Anchor dispatch + signature-verify
floor. `cpu_heavy_sort` (64-element sort) is ~10.2k CU. A single keyed insert
of a value record is ~13.8k CU — well inside the 200k default CU budget. On a
fresh-reset single-node validator the write paths pin to one block per op
(~485 ms, σ ≈ 4 ms) → the flat ~2.06 TPS is block-time-bound, not a program
limit; the tight stddev (vs a warm ledger's 120–160 ms) is the load-free floor.

---

## 2. SmallBank OLTP (n = 150, sequential)

| Transaction | n | mean ms | stddev | p50 | p95 | p99 | ci95 | TPS | CU/tx | fail |
|-------------|---|---------|--------|-----|-----|-----|------|-----|-------|------|
| TransactSavings | 150 | 493.82 | 19.77 | 486.14 | 543.77 | 549.92 | ±3.16 | 2.03 | 3 598 | 0 |
| DepositChecking | 150 | 549.99 | 132.72 | 539.52 | 553.40 | 565.60 | ±21.24 | 1.82 | 3 601 | 0 |
| SendPayment | 150 | 549.97 | 133.15 | 538.82 | 554.28 | 558.21 | ±21.31 | 1.82 | 6 328 | 0 |
| WriteCheck | 150 | 539.00 | 7.77 | 538.47 | 550.27 | 558.72 | ±1.24 | 1.86 | 3 605 | 0 |
| Amalgamate | 150 | 550.19 | 131.17 | 540.02 | 555.42 | 561.31 | ±20.99 | 1.82 | 6 301 | 0 |

**Reading:** All 750 transactions succeeded. Compute cost is value-independent
and scales with the **number of account writes**: single-account txns
(TransactSavings / DepositChecking / WriteCheck) ~3.6k CU; two-account txns
(SendPayment / Amalgamate) ~6.3k CU. No contention in the sequential schedule.
CU is ~7% higher than the `58cfc79` baseline across the board (e.g.
SendPayment 5 963 → 6 328) — a build-level shift on `3cb3388`, not a workload
change; both legs still land at one block per op (~490–550 ms).

---

## 3. TPC-C Concurrency Sweep (TX = 500, 50% NewOrder / 50% Payment)

100% success at every concurrency level. Throughput from concurrent in-flight
submission; latency is per-transaction client→confirmed.

| Concurrency | TPS | mean ms | stddev | p50 | p95 | p99 | ci95 | CU/tx mean | CU/tx p95 | CU/tx max |
|-------------|-----|---------|--------|-----|-----|-----|------|------------|-----------|-----------|
| 5 | 7.87 | 571.85 | 393.48 | 539 | 556 | 563 | ±34.49 | 23 714 | 32 873 | 40 373 |
| 10 | 18.74 | 532.19 | 42.40 | 538 | 552 | 557 | ±3.72 | 23 317 | 32 864 | 38 873 |
| 20 | 33.68 | 533.18 | 103.97 | 530 | 547 | 552 | ±9.11 | 23 234 | 32 873 | 40 364 |
| 40 | 74.25 | 512.33 | 9.58 | 510 | 529 | 533 | ±0.84 | 22 590 | 31 373 | 38 864 |

**Reading:**

- **Super-linear scaling, no saturation knee through c=40.** 5→40 concurrency
  (8×) yields 7.87→74.25 TPS (**9.4×**), climbing monotonically with no plateau
  — the doubling c=20→c=40 alone gives 33.68→74.25 TPS (2.2×). On this
  fresh-reset validator/build the single node does **not** saturate by c=40.
  *This overturns the prior `58cfc79` run's headline* (that run was sublinear,
  ~3.45× over the same range with a knee at c=10–20). Do not cite a c≤40
  saturation knee — it is not reproduced here.
- **Latency flat and tightening under load.** Mean holds ~510–570 ms across all
  levels and stddev *falls* to 9.6 ms at c=40. The c=5 point is noisy (σ ≈ 393 ms
  — a cold-start/JIT + validator-warmup artifact on the first level of the sweep);
  treat its 7.87 TPS as a soft floor, not a clean datapoint.
- **CU/tx flat (~22–24k) across all loads.** On-chain compute cost is independent
  of concurrency → any ceiling is *consensus/block-time + write serialization on
  `District.next_o_id`*, not execution. The mean CU is ~10% above the `58cfc79`
  run (~21k → ~23k) — same build-level shift seen in §1/§2.

**Roadmap consequence:** since no knee appears by c=40, the real saturation
point is above this sweep — push concurrency past 40 (and add open-loop λ-ramp)
to locate peak/collapse before quoting a max sustainable TPS.

---

## 4. Governance & Oracle Instruction CU Profile (in-process, litesvm)

Happy-path compute-unit cost of every governance + oracle instruction, measured
in-process via litesvm (`computeUnitsConsumed()` from the tx meta) against the
**default-feature** `.so` (no `localnet`, so `compute_fn!` is a no-op — these are
production-representative). No validator required.

Reproduce: `npm run test:cu-profile` (asserts each instruction < 200k default budget).

> **Determinism & baseline gate.** The profiles use fixed (deterministic) keypairs, not
> `Keypair.generate()`: a PDA's bump-search iteration count is charged in CU and varies
> with the account address, so random keys make init instructions jitter by thousands of
> CU. With fixed keys every number below is reproducible run-to-run. The values are
> committed to `tests/cu-baseline.json`; each profile asserts its measurements against it
> within 5% (`tests/cu-baseline.ts`), so a compute regression — not just a 200k blowout —
> fails CI. Regenerate after an intentional change: `CU_BASELINE_UPDATE=1 npm run test:cu-profile`.

| Instruction | CU |
| ----------- | --: |
| `governance.initialize_governance` | 8 917 |
| `governance.propose_authority_change` | 5 834 |
| `governance.approve_authority_change` | 5 784 |
| `governance.set_oracle_authority` | 5 830 |
| `governance.update_erc_limits` | 5 789 |
| `oracle.initialize` | 11 098 |
| `oracle.submit_meter_reading` (first — inits meter PDA) | 16 050 |
| `oracle.submit_meter_reading` (subsequent) | 13 376 |
| `oracle.trigger_market_clearing` | 8 390 |
| `oracle.aggregate_readings` | 8 362 |
| `oracle.update_validation_config` | 7 819 |

**Reading:** all governance/oracle instructions sit at **≤16.1k CU (≤8.1% of the
200k budget)** — cheap config/control paths with ample headroom. The hot oracle
write path (`submit_meter_reading`) is now the ceiling here: ~16k on first touch
(meter PDA init) and ~13.4k steady-state. The **governance config paths dropped
~7.5k each vs the `58cfc79` baseline** (initialize 16.4k → 8.9k; the four
authority/ERC control ixs 13.3k → ~5.8k) — a shared reduction in the common
governance path (fewer account loads / one less syscall on that code), a real
efficiency win, not measurement drift. Contrast §1's `settle_offchain_match` at
122k: these are config/telemetry instructions, not signature-verifying
settlement. The CI assertion turns an accidental extra syscall or a serialized
hot-path account into a test failure.

**Fungible REC token (1 token = 1 MWh) — approximate.** The REC mint path is profiled
in `tests/governance_rec_token_litesvm.ts` (full registry→governance→Token-2022 flow),
which uses random keypairs, so these are *not* in the deterministic `cu-baseline.json`
gate and may jitter by a few k CU on the PDA-init paths:

| Instruction | CU (approx) |
| ----------- | --: |
| `governance.issue_erc` (registry `mark_erc_claimed` CPI + Token-2022 `mint_to` + ATA init) | ~68 000 |
| `governance.retire_rec` (burn) | ~13 200 |

`issue_erc` is the heaviest governance path because it CPIs registry *and* mints REC into a
freshly-init'd ATA, yet still sits at ~34% of the 200k budget — adding the fungible-REC
mint to the provenance path left ample headroom.

---

## 5. Treasury Instruction CU Profile (in-process, litesvm)

Compute-unit cost of the treasury economic hot paths (swap / redeem / stake /
settlement recording) plus the admin/attestation primitives. Same method as §4
(litesvm `computeUnitsConsumed()`, default-feature `.so`, Token-2022 wiring
mirroring `tests/treasury_redeem_guards_litesvm.ts`). No validator required.

Reproduce: `npm run test:cu-profile` (runs every `tests/cu_profile_*_litesvm.ts`).

| Instruction | CU |
| ----------- | --: |
| `treasury.initialize` | 42 277 |
| `treasury.swap_grx_for_thbc` †  | 21 509 |
| `treasury.redeem_thbc_for_grx` † | 21 328 |
| `treasury.issue_thbc` ‡ | 18 465 |
| `treasury.exchange_grx_for_thbc` ‡ | 23 929 |
| `treasury.exchange_thbc_for_grx` ‡ | 23 904 |
| `treasury.redeem_thbc_for_fiat` ‡ | 19 875 |
| `treasury.confirm_redemption` ‡ | 15 585 |
| `treasury.reclaim_redemption` ‡ | 16 488 |
| `treasury.stake_grx` (first — inits position) | 19 538 |
| `treasury.set_params` | 3 404 |
| `treasury.update_attestation` | 3 303 |
| `treasury.record_settlement` | 3 301 |

> † **Stale — these two instructions no longer exist.** The F6 fix replaced
> `swap_grx_for_thbc` / `redeem_thbc_for_grx` with `exchange_grx_for_thbc` /
> `exchange_thbc_for_grx`, which transfer against an inventory vault instead of
> minting/burning. Kept for comparison, not as current numbers.
>
> ‡ **Measured 2026-07-29 under litesvm**, not on a validator: `npx tsx
> scripts/measure-treasury-cu.ts`, reading `meta().computeUnitsConsumed()` against
> `target/deploy/treasury.so`. Program consumption including the token-program CPI,
> excluding the ComputeBudget instruction. The rest of this table was gathered
> differently, so treat cross-row comparisons within a few hundred CU as noise —
> the ‡ rows are comparable to each other.
>
> **The prediction in the previous revision of this note was WRONG.** It said the
> exchange pair "should be cheaper — a `transfer_checked` in place of a `mint_to`, and
> no `thbc_supply` write on the forward path". Both are ~2 400 CU *more* expensive
> (21 509 → 23 929, 21 328 → 23 904). The reasoning missed that the exchange does
> **two** `transfer_checked` CPIs where the swap did one transfer plus a `mint_to`, and
> loads an extra `InterfaceAccount` for the inventory vault. Removing a mint did not pay
> for adding a transfer.
>
> `issue_thbc` at 18 465 *is* cheaper than the old swap despite creating the F3
> nullifier account, because it has no GRX leg at all. The F7 instructions are the
> cheapest of the group: `confirm_redemption` (burn + account close) and
> `reclaim_redemption` (one transfer + close) touch fewer accounts than any exchange.
>
> All six sit far below the 200k per-instruction default, so none is near a budget
> ceiling; `issue_thbc` is nonetheless submitted with an explicit 400k limit because it
> is bundled behind a `create_associated_token_account_idempotent`.


**Reading:** the swap/redeem/stake hot paths cluster at **~19.5–21.5k CU**, driven
by the Token-2022 transfer + mint/burn CPIs (one-time `stake` adds a position-PDA
init). `initialize` is the heaviest at 42k — a one-off that creates the THBC mint
plus the three GRX vaults (swap/stake/reward). Pure-state admin instructions
(`update_attestation`, `record_settlement`, `set_params`) are ~3.3–3.4k. All sit
well inside the 200k budget — the baht-settlement primitive (swap) costs ~1/5 of
the §1 `settle_offchain_match` figure.

---

## 5b. Treasury Sharded-Settlement & Batch CU Profile (in-process, litesvm)

The §2c parallel-settlement reconciliation layer (separate from the §5 swap/stake
hot paths). `record_settlement_sharded` bumps a per-shard PDA instead of the global
`total_settled_thbc` (no write-lock under concurrent settles); `aggregate_settlement_shards`
reconciles the global total off the hot path; `record_settlement_batch` writes a
per-`(zone,batch)` audit commitment. Same method as §4-8; wiring mirrors
`tests/settle_shard_litesvm.ts`.

| Instruction | CU |
| ----------- | --: |
| `treasury.record_settlement_batch` | 12 367 |
| `treasury.initialize_settlement_shard` | 9 905 |
| `treasury.aggregate_settlement_shards` (2 shards) | 6 734 |
| `treasury.record_settlement_sharded` | 5 374 |

**Reading:** the recurring sharded record (`record_settlement_sharded`) is **5.4k CU**
— cheaper than the global `record_settlement` (§5, 3.3k is the no-shard single bump;
the sharded path adds the per-shard PDA write). `aggregate_settlement_shards` scales
with the number of shards passed (6.7k for two). Shard-init is a one-time PDA
creation at ~9.9k; the per-`(zone,batch)` audit commitment `record_settlement_batch`
rose to **12.4k** (was 9.3k on `58cfc79`). The point of this layout is contention, not
raw CU: distinct shards never write-lock one account, so settle throughput is not
serialized on the global total (see the settlement-TPS note in §1's roadmap).

---

## 6. Registry Lifecycle CU Profile (in-process, litesvm)

Compute-unit cost of the registry user/meter lifecycle — the telemetry hot path
(`register_user` → `register_meter` → `update_meter_reading`) plus the admin/shard
setup. Same method as §4/§5. No validator, no token CPI on this path.

Reproduce: `npm run test:cu-profile` (runs every `tests/cu_profile_*_litesvm.ts`).

| Instruction | CU |
| ----------- | --: |
| `registry.register_meter` | 20 125 |
| `registry.register_user` | 15 910 |
| `registry.deactivate_meter` | 12 495 |
| `registry.initialize_shard` | 10 904 |
| `registry.update_meter_reading` | 7 568 |
| `registry.initialize` | 6 666 |
| `registry.set_oracle_authority` | 1 569 |

**Reading:** the recurring telemetry write `update_meter_reading` is now **7.6k CU**
(3.8% of budget) — **up from 3.9k on the `58cfc79` baseline**. The +3.7k is a
deliberate security fix, commit **`1b12b4c`** ("close oracle/registry
double-bookkeeping gap"): the handler now cross-checks its own cumulative meter
totals against oracle's independently rate-limited `MeterState` before those
numbers can back a mint, closing an inflation path where a corrupt
`oracle_authority` could report generation to registry that oracle never
recorded. The added cost is a `find_program_address` bump-seek for the oracle
meter PDA (the dominant share) plus an owner check, a `bytes32_to_string`, a
raw borrow of oracle's `MeterState` bytes, and two `≤` invariants
(`lib.rs:513–539`). It is **no longer a pure per-meter-PDA write** — it reads a
second, cross-program account — but 7.6k CU is still cheap for the guarantee.
(The bump-seek is the optimizable half: passing/storing the oracle-meter bump
→ `create_program_address` would recover ~1.5–2k CU; tracked separately.)
`deactivate_meter` rose 10.9k → 12.5k (commit `0b470fa` binds `user_account`).
The one-time registrations are heavier (`register_meter` 20k inits the meter PDA
+ bumps its shard; `register_user` 15.9k), but still a fraction of the budget.
The token-bearing registry instructions (`stake_grx` validator bond,
`settle_and_mint_tokens`, `claim_airdrop`) are out of scope here; the bond
plumbing mirrors the §5 treasury stake (~19.5k CU).

---

## 7. Trading CDA Order-Path CU Profile (in-process, litesvm)

Compute-unit cost of the trading order book path — market/zone setup, escrow
deposit/withdraw, create sell/buy order, on-chain `match_orders` (CDA), and cancel.
Same method as §4-6. The fabricated governance GovernanceConfig/ErcCertificate mirror
`tests/order_guards_litesvm.ts`. Token transfers use classic SPL (Token program).

Reproduce: `npm run test:cu-profile` (runs every `tests/cu_profile_*_litesvm.ts`).

| Instruction | CU |
| ----------- | --: |
| `trading.deposit_escrow` | 27 670 |
| `trading.withdraw_escrow` | 18 106 |
| `trading.match_orders` (CDA) | 11 752 |
| `trading.create_sell_order` | 11 518 |
| `trading.create_buy_order` | 10 464 |
| `trading.initialize_market` | 8 392 |
| `trading.initialize_zone_market` | 6 877 |
| `trading.cancel_order` | 4 469 |

**Reading:** the **on-chain CDA match** (`match_orders`) is **11.7k CU** — cheap,
because it only touches the two `Order` PDAs + the `zone_market` and writes a trade
record; no token movement. Contrast §1's `settle_offchain_match` at **122k**: the
~10× gap is the Ed25519 signature-verify precompile + dual-mint escrow transfers on
the *settlement* path, which `match_orders` does not perform. The escrow
deposit/withdraw (SPL transfer + PDA init/close accounting) dominate this path at
18-28k. Order create/cancel are ~4.5-11.5k.

---

## 8. Energy-Token (GRID Mint) CU Profile (in-process, litesvm)

Compute-unit cost of the GRID mint lifecycle — token init, REC-validator set
management, REC-gated `mint_to_wallet`, transfer, and burn. Same method as §4-7.
Token-2022 mint owned by the program's mint PDA; `mint_to_wallet` is co-signed by a
registered REC validator (wiring from `tests/energy_token_rec_guards_litesvm.ts`).

Reproduce: `npm run test:cu-profile` (runs every `tests/cu_profile_*_litesvm.ts`).

| Instruction | CU |
| ----------- | --: |
| `energy_token.initialize_token` | 18 424 |
| `energy_token.mint_to_wallet` (REC-gated) | 13 722 |
| `energy_token.transfer_tokens` | 8 035 |
| `energy_token.retire_energy_tokens` | 6 537 |
| `energy_token.add_rec_validator` | 3 496 |
| `energy_token.remove_rec_validator` | 3 291 |

**Reading:** the REC-gated `mint_to_wallet` — the provenance boundary that requires
a registered REC validator co-sign before any GRID is minted — costs **13.7k CU**
(REC-set scan + Token-2022 mint CPI). `initialize_token` (18.4k) is the one-off
mint-PDA creation. Transfer/burn are plain Token-2022 CPIs at 6.5-8k. Validator-set
edits are pure-state at ~3.3–3.5k (up from ~1.5k on `58cfc79`). All well inside budget.

---

## 9. Oracle Meter-Telemetry Scaling (80 → 200,000 meters, live validator)

End-to-end AMI ingest under fleet load: `oracle.submit_meter_reading` fired from
N distinct meters against a **live** `solana-test-validator` (not litesvm), over 2
epochs 61 s apart (on-chain `min_reading_interval` = 60 s). Epoch 1 initialises each
`MeterState` PDA; epoch ≥2 is the steady-state write. Every meter targets its own
`[b"meter", meter_id]` PDA — writes are Sealevel-disjoint by design.

Submits are authorised by the single gateway (`oracle_data.chain_bridge` = the
provider wallet), which is the `mut` fee-payer and therefore **write-locked on every
transaction**. That shared payer + single-node banking — *not* per-meter contention —
is the throughput ceiling here.

**Transport** (same on-chain path at every size — transport shapes TPS/latency, never
CU): transactions are pre-signed locally against a cached blockhash (10 s refresh) and
raw-sent (`skipPreflight`, no retry), confirmed by bulk `getSignatureStatuses` polling
(1.5 s sweep) under a 3 000-tx in-flight window. Latency is send→first-seen-confirmed,
poll-quantised (±1.5 s). CU is sampled from the *tail* of each epoch's confirmed set
(≤200 tx via `getTransaction(sig).meta` — the rotating ledger prunes older history
under 100k+ tx loads, so strided sampling starves). Reading timestamps and the
inter-epoch wait use the **on-chain clock**, not wall time — a laptop sleep/wake
leaves the test validator's Bank clock hours behind, and wall-clock stamps are then
rejected as `FutureReading`. An earlier two-transport run (per-tx `.rpc()` websocket
confirms ≤10k) produced the same CU values with lower TPS (~120–220): transport-bound,
retained in git history (`46fc183`).

Reproduce: `scripts/bench-meter-throughput.ts` (env `METERS`/`EPOCHS`/`MAX_INFLIGHT`/
`CU_SAMPLE`), against a live validator with the oracle deployed +
`scripts/init-oracle.ts` run; the multi-scale sweep below is driven by
`scripts/run-meter-scale-sweep.sh` (the harness was removed for a period and
restored — the 80 → 100k tables predate the removal, the extension sweep
postdates the restore).

**Outcome decomposition.** Every non-confirmed transaction is attributed to one of
three classes: **send-rejected** (RPC refused — never entered the validator, no fee),
**validation-rejected** (executed and failed an oracle guard — fee paid, recorded
on-chain), and **expired** (accepted but never confirmed in 90 s — queue drop or
blockhash aging; no fee, no trace). In these runs every validation rejection is
`AnomalousReading` (6004): the synthetic value pattern deliberately drives ~0.47% of
meters past the 10× production/consumption anomaly gate, so that bucket demonstrates
the oracle's input validation firing correctly at 100k-meter scale — it is not
delivery failure. **True delivery loss = send-rejected + expired.**

| N meters | total tx | confirmed | validation-rejected | delivery loss | loss total |
|---------:|---------:|----------:|--------------------:|--------------:|-----------:|
| 80 | 160 | 160 | 0 (0%) | 0 (0%) | 0% |
| 1 000 | 2 000 | 1 988 | 8 (0.40%) | 4 (0.20%) | 0.60% |
| 5 000 | 10 000 | 9 906 | 48 (0.48%) | 46 (0.46%) | 0.94% |
| 10 000 | 20 000 | 19 862 | 92 (0.46%) | 46 (0.23%) | 0.69% |
| 50 000 | 100 000 | 99 247 | 474 (0.47%) | 279 (0.28%) | 0.75% |
| 100 000 | 200 000 | 198 347 | 950 (0.48%) | 703 (0.35%) | 0.83% |

**Compute units per `submit_meter_reading` (scale-invariant)**

| N meters | init CU min | init CU med | steady CU min | steady CU med | steady CU max |
|---------:|------------:|------------:|--------------:|--------------:|--------------:|
| 80 | 16 180 | 16 180 | 13 560 | 13 560 | 25 560 |
| 1 000 | 16 254 | 17 754 | 13 634 | 15 134 | 25 634 |
| 5 000 | 16 254 | 17 754 | 13 634 | 15 134 | 31 634 |
| 10 000 | 15 957 | 17 457 | 13 337 | 14 837 | 22 337 |
| 50 000 | 15 957 | 17 457 | 13 337 | 14 837 | 26 837 |
| 100 000 | 16 254 | 17 754 | 13 634 | 15 134 | 27 134 |

**Throughput & latency (steady-state epoch, single-node localnet)**

| N meters | TPS mean | lat p50 (ms) | lat p95 (ms) | lat max (ms) |
|---------:|---------:|-------------:|-------------:|-------------:|
| 80 | 47 | 1 602 | 1 687 | 1 703 |
| 1 000 | 267 | 1 464 | 1 947 | 2 003 |
| 5 000 | 393 | 1 554 | 2 301 | 2 476 |
| 10 000 | 462 | 1 544 | 2 347 | 2 582 |
| 50 000 | 490 | 1 611 | 2 415 | 3 033 |
| 100 000 | 322 | 2 016 | 3 120 | 4 393 |

**Reading.** The steady-state **base write path (`CU min`) holds 13.3–13.6k CU across
a 1 250× meter-count range** — per-meter cost is O(1), independent of fleet size, and
cross-validates §4's litesvm `submit_meter_reading` subsequent = 13 376. The ±150-CU
drift tracks meter-id byte length (longer ids = more seed/copy bytes), not N; the
`CU med/max` spread tracks the reading *values* (the anomaly-ratio branch). **TPS is
transport/ramp-bound at small N** (an 80-tx burst never fills the pipeline) and
**payer-bound at large N**: sustained rates reach ~390–490 TPS at 5k–50k and ~322 TPS
at 100k, flat-to-declining as N grows because every tx is signed by the single
write-locked gateway payer on one validator. This is a serialization ceiling, not a
per-meter one — the disjoint PDAs need multi-gateway fee-payer pooling plus a
multi-node deployment to convert into proportional throughput, and the flat CU shows
the per-write cost is already scale-free. **True delivery loss stays ≤ 0.46% at every
fleet size** (0.35% at 100 000 meters / 200 000 tx, no client retry — one retry round
would push effective loss to ~10⁻⁵); p95 latency ≤ 3.1 s under the 3 000-tx window.
(Solana 3.1.10, Apple M2, 2026-07-07; harness `bench-meter-throughput.ts`.)

### 9b. Extension sweep: 10,000 → 200,000 meters (2026-07-19)

Same harness and transport, driven across five scales by
`scripts/run-meter-scale-sweep.sh` (unique PDA prefix per scale + sweep tag, so
epoch 1 is a true init at every scale). Scales ran back-to-back on one validator
with **no ledger reset between them**: the 200 000-meter case starts against
310 000+ pre-existing meter PDAs from the smaller scales, and the sweep ends with
510 000 meter PDAs / 1 020 000 transactions from this experiment alone. Combined
summary generated by `scripts/summarize-meter-scale.ts`
(`test-results/meter-scale-summary-2026-07-19T14-14-39-869Z.{json,md}`).

| N meters | total tx | confirmed | validation-rejected | delivery loss |
|---------:|---------:|----------:|--------------------:|--------------:|
| 10 000 | 20 000 | 19 908 | 92 (0.46%) | 0 (0%) |
| 50 000 | 100 000 | 99 524 | 476 (0.48%) | 0 (0%) |
| 100 000 | 200 000 | 199 048 | 952 (0.48%) | 0 (0%) |
| 150 000 | 300 000 | 298 572 | 1 428 (0.48%) | 0 (0%) |
| 200 000 | 400 000 | 398 096 | 1 904 (0.48%) | 0 (0%) |

| N meters | init CU min | init CU med | steady CU min | steady CU med | steady CU max |
|---------:|------------:|------------:|--------------:|--------------:|--------------:|
| 10 000 | 16 145 | 17 645 | 13 525 | 15 025 | 27 025 |
| 50 000 | 16 145 | 16 145 | 13 525 | 13 525 | 24 025 |
| 100 000 | 16 180 | 17 680 | 13 560 | 15 060 | 22 560 |
| 150 000 | 16 180 | 16 180 | 13 560 | 13 560 | 25 560 |
| 200 000 | 16 180 | 16 180 | 13 560 | 13 560 | 25 560 |

| N meters | TPS init | TPS steady | lat p50 (ms) | lat p95 (ms) | lat max (ms) |
|---------:|---------:|-----------:|-------------:|-------------:|-------------:|
| 10 000 | 439 | 429 | 1 546 | 2 354 | 2 512 |
| 50 000 | 320 | 243 | 1 868 | 3 064 | 7 074 |
| 100 000 | 410 | 455 | 1 553 | 2 346 | 2 594 |
| 150 000 | 449 | 426 | 1 586 | 2 402 | 2 970 |
| 200 000 | 438 | 443 | 1 582 | 2 391 | 2 756 |

**Reading.** Doubling the fleet past the earlier 100k ceiling changes nothing:
steady TPS holds a flat 426–455 band at 10k/100k/150k/200k (the 243 at 50k is a
transient validator stall — it does not recur at any larger scale, including the
100k case run immediately after), latency stays at p50 ≈ 1.5–1.9 s / p95 ≤ 3.1 s,
and the steady base write holds the same 13 525–13 560 CU band as the original
tables. The write path is **O(1) in accumulated account count as well as fleet
size** — the final 200k submissions execute against a state set 5× the first
scale's at indistinguishable cost. **Delivery loss is exactly zero across all
1 020 000 first-attempt sends** (no send-reject, no expiry); the entire 0.46–0.48%
residue is the deterministic `AnomalousReading` probe. Single-validator,
single-fee-payer caveats unchanged. On-chain global counters (`OracleData`)
stay untouched by design — the hot path is read-only on them; fleet totals
reconcile via `aggregate_readings`. (Solana 3.1.10, Apple M2, 2026-07-19.)

---

## 10. Trading Order-Entry Throughput (live validator)

The trading-side counterpart of §9: 10 000 `submit_limit_order_sharded`
instructions (alternating buy/sell, 16 zone shards round-robin, one per-order PDA
each) fired at a live validator through the same raw-send + bulk-status transport
and outcome attribution as §9.

Reproduce: the `bench-trading-throughput.ts` harness has been _removed_; the table
below is retained as historical record (it ran with `ORDERS`/`ZONE_ID` env against a
live validator with trading deployed, self-bootstrapping market/zone/shards).

| ok/N | delivery loss | on-chain err | TPS | lat p50 | lat p95 | CU min | CU med | CU max |
|-----:|--------------:|-------------:|----:|--------:|--------:|-------:|-------:|-------:|
| 9 977 / 10 000 | 23 (0.23%) | 0 | 180 | 2 173 ms | 3 565 ms | 9 884 | 12 886 | 23 384 |

**Reading.** Order entry is the *cheapest* hot-path write measured (9.9k CU min —
below the 13.3–13.6k meter write) yet delivers **~2.6× lower TPS than meter ingest
at the same fleet size on the same setup** (180 vs 462 at N=10k, §9): direct
evidence that the path is lock-bound, not compute-bound. The cause is its write-lock
footprint: besides the shared fee-payer, `SubmitLimitOrderShardedContext` at the time
of measurement still declared `zone_market` as `mut` although the handler writes only
the per-shard `zone_shard` — so every "sharded" order write-locked the one shared
`ZoneMarket` account and the 16 shards serialized behind it. This is the same defect
class fixed for `ShardedMatchOrdersContext` in `95e7cdd` (measured there: writable →
1 match/slot, read-only → 3/slot); the vestigial `mut` was subsequently dropped in
`1ee4417` — `zone_market` is now read-only in the sharded submit context
(`programs/trading/src/instructions/submit_sharded_limit_order.rs:14-18`). Delivery
loss is pure transport (23 expired, zero on-chain errors). (Solana 3.1.10, Apple M2, 2026-07-07; harness
`bench-trading-throughput.ts`, since removed.)

---

## 11. 1-Month Community Simulation (80 real meters, full token lifecycle)

End-to-end month of a real community, replayed against a live validator: an
80-meter fleet from the **smart-meter simulator** (`gridtokenx-smartmeter-simulator`,
seeded solar/load models, 12 solar prosumers + 68 consumers), 30 days × 96
15-minute ticks = **230,400 readings**, with a **10 kWh/day sell cap** per
prosumer. Month energy: 15,868.5 kWh generated / 144,879.8 kWh consumed /
10,386.7 kWh tick-surplus. Three phases (the `bench-community-month.ts` harness has
since been _removed_; dataset exported via the simulator's Python
API — `MeterGenerator` + `SmartMeter.generate_reading`, seed 42):

1. **Telemetry replay** — historical timestamps (the oracle only rejects future
   stamps), so the month compresses to minutes. The strictly-increasing
   per-meter timestamp guard forbids two in-flight readings of one meter, so
   readings ship as **per-meter batched txs** (≤10 `submit_meter_reading`
   ix/tx; in-tx sequential execution preserves order) across 80 parallel meter
   chains; readings that would trip the 10× anomaly gate go as singletons so
   the on-chain rejection is still measured.
2. **Daily CDA order entry** — 12 sellers offer min(day surplus, 10 kWh), 68
   buyers bid their actual daily consumption.
3. **Token lifecycle** — daily per prosumer: registry sync + `settle_and_mint_tokens`
   (GRID, Token-2022) → escrow deposit → Ed25519-signed `settle_offchain_match`
   against a rotating consumer (v0 tx + ALT) → buyer withdraw + `retire_energy_tokens`.
   Month-end: cap-withheld surplus certified as RECs via governance `issue_erc`
   (CPIs `mark_erc_claimed` → GRID + REC ≤ metered generation, on-chain).

Reproduce: the `bench-community-month.ts` harness has been _removed_; the results
below are retained as historical record (it took a `DATA_DIR=<exported-dataset>` env
against a fresh validator with oracle/trading/registry/governance/energy_token deployed,
then `bootstrap.ts` + `init-shards.ts` run).

**Canonical run (2026-07-07, Solana 3.1.10, Apple M2):**

| Phase | Result |
|:------|:-------|
| Telemetry | 229,481/230,400 readings confirmed; 919 = anomaly-gate rejections (fee-paid, on-ledger), **0 delivery loss**; 212.9 readings/s at 21.3 tx/s (batch amortization); CU 13,386/reading |
| Orders | 2,396/2,396 confirmed, 53.4 TPS session bursts, CU med 11,384 |
| Lifecycle | all stages 0 fail — mint 433 (CU med 29,410), deposit 433 (14,905), settle 353 (107,141), burn 353 (21,963), REC 12 (71,369) |
| Month | absorbed in **1,394.7 s → 1,858× real-time compression** |

**Energy conservation closes exactly (oracle-accepted surplus only):** GRID
minted 3,290.7 kWh = trade-settled = burned; cap-withheld surplus certified as
RECs 4,962.8 kWh; minted + REC = 8,253.5 kWh = the gate-passing tick-surplus.
The 10 kWh/day cap binds on 305/360 prosumer-days and withholds 68% of raw
tick-surplus from the market. Settlement currency volume 13,137 units across
353 Ed25519-verified matches. The telemetry outcome (229,481 confirmed / 919
rejected) reproduced **bit-identically across four runs**; throughput varied
213–232 readings/s with host load.

**On-chain audit.** A companion `audit-community-month.ts` harness (since _removed_)
re-derived every headline number from live chain state (RPC reads only, run right after the bench):
Σ per-meter `total_readings` = 229,481; Order/TradeNullifier/OrderNullifier PDA
counts = 2,396/353/706; registry Σ `settled_net_generation` = 3,290,724 Wh and
Σ `claimed_erc_generation` = 4,962,778 Wh (= the 12 ErcCertificates); GRID
supply after burns = the 68 escrow-seed Wh (every traded Wh burned); REC supply
= claimed × 1,000 base units; currency conserves exactly (buyer outflow 13,137 =
seller proceeds 12,832 + wheeling 305). **15/15 checks passed** on the
2026-07-07T17-18-23 run. (Note: `oracle_data.total_readings` stays 0 by design —
the hot path writes only per-meter PDAs; global totals reconcile via
`aggregate_readings`.)

**Reproducibility postmortem worth keeping:** the first lifecycle run lost
112/353 settles to *silent transaction dedupe* — consecutive cap-bound days
produced byte-identical deposit txs (same ix, accounts, fee payer, and cached
blockhash within its 10 s refresh window) → identical signature → the validator
deduped the second send while the client saw the (old) signature "confirmed"
and reported success, leaving the seller escrow empty at settle time. Any replay
harness reusing a cached blockhash must salt each tx (the harness now prepends a
day-varying `ComputeBudget` ix). `AddressLookupTable` creation also races
preflight ("not a recent slot") — send it raw with `skipPreflight` and retry
with a fresh slot.

### 11b. Full lifecycle under each price rule (2026-07-19)

The §11 harness gained a `PRICE_MODEL` knob (`uniform | cda | buyback | fixed`,
`scripts/bench-community-month.ts`) and a per-rule driver
(`scripts/run-lifecycle-price-models.sh`): the 7-day fleet dataset
(`scale-80m-12p-s42-7d-cap5`, 53,760 readings, 403.3 kWh capped surplus) replayed
once per rule on a fresh validator each — full pipeline per prosumer-day
(telemetry → registry-CPI GRID mint → escrow deposit → Ed25519-signed
`settle_offchain_match` at the rule's price → withdraw + burn). `uniform` settles
every match at the top ask 3.45; `cda` settles each seller at its own ladder ask
(3.00/3.15/3.30/3.45, volume-weighted 3.221); `buyback` has no P2P leg — the
seller retires the minted GRID directly (`retire_energy_tokens`) and the
2.20 THB/kWh feed-in value is off-chain. Charges are levied on-chain by the dev
tariff (fee 25 bps, wheeling 0.10 THB/kWh flat, loss 5 bps —
`scripts/bootstrap.ts:311`).

| rule | p\* (THB/kWh) | settles | CU/settle med | seller net (THB/kWh) | lifecycle wall (s) |
|------|--------------:|--------:|--------------:|---------------------:|-------------------:|
| uniform | 3.450 | 83/83 | 100,545 | 3.340 | 132 |
| cda | 3.221 (VW) | 83/83 | 97,577 | 3.111 | 132 |
| buyback | 2.200 | — (direct retire) | — | 2.200 | 21 |

Every run conserves exactly (minted = settled = retired = **403.319 kWh**, zero
failed transactions, 53,760/53,760 readings accepted). Settlement compute is
price-invariant on the full lifecycle path, and at this wheeling point both P2P
rules beat the buyback rate — the mirror regime of the modelled `w = 1.15`
comparison where CDA falls below it. Quantisation caveat: the harness carries
energy in watt-hour-scale units (§11 convention, 10^6 below atomic), so the
per-match gross is ~17 six-dec units and every charge floor truncates to zero
on-chain — the net column applies the deployed tariff at nominal atomic scale.
The uniform run is chain-audited by RPC reads alone
(`scripts/audit-lifecycle.ts`, 11/11): reading counters sum to 53,760;
order/trade-nullifier/order-nullifier counts 559/83/166; GRID supply after
burns = 68 seed units; currency conserves exactly (buyer outflow 1,369 =
seller proceeds 1,369 + collectors 0/0/0). Artifacts:
`test-results/community-month-80m-12p-{uniform,cda,buyback}-*.json`.

**Reproducibility (2026-07-20, 3× replication):** the full sweep was repeated
three times per rule — 9 fresh-validator runs. Economics are bit-identical in
all 9: conservation 403.319 kWh, currency volume 1,369/1,260/852, telemetry
53,760/0-reject, 83/83 settles, zero failures in any stage of any run. The
only variance across the nine runs is compute-unit jitter quantised at
exactly 1,500 CU — one `create_program_address` bump-search iteration —
because each run's random keypairs need a different number of bump candidates
(settle CU median takes exactly two values, 97,545/99,045; litesvm
sharded-match likewise 12,211/15,211; the earlier 100,545 sits in the same
family at +2×1,500). A second, far smaller residue exists against the 07-19
runs (CDA median 97,577, +32 CU): the checked-arithmetic branch spread on
differing currency magnitudes, sampled at a different median point. Zero
effect on state or economics either way. In-process suites (23 tests) pass
3/3 reps with numerically identical output. Log: 3× driver over
`scripts/run-lifecycle-price-models.sh`'s per-model recipe.

---

## Artifacts

```
test-results/
├── blockbench/   blockbench-<ISO8601>.{json,csv}
├── smallbank/    smallbank-<ISO8601>.{json,csv}
├── tpc/          tpc-c-<ISO8601>.{json,csv}   (one file per concurrency level)
├── meter-throughput-<N>m-<ISO8601>.{json,md}  (§9 per-size: per-epoch + per-meter)
├── meter-scaling-summary.md                   (§9 combined 80→100k scaling tables)
├── trading-order-entry-<N>o-<ISO8601>.{json,md}  (§10 order-entry run)
└── community-month-<N>m-<P>p-<ISO8601>.{json,md} (§11 month sim; canonical = 2026-07-07T16-45-40)
```

Each JSON carries full per-sample distributions and host metadata; each CSV is
a single summary row for spreadsheet/plotting ingestion.

---

## Best Practices & Roadmap

The results above are a **single-node, generic-OLTP** baseline. To make them
defensible as a *P2P energy-trading* benchmark, the gaps below remain. Tags:
**[CRIT]** = fix or claims get rejected · **[IMP]** = strong-paper material ·
**[POLISH]** = rigor polish.

**Systems performance**
- **[CRIT — first datapoint measured]** Benchmark the **real CDA settlement path**
  (`trading::settle_offchain_match` / `batch_settle_offchain_match`: escrow +
  order nullifier + signature verify + trade record), not just BlockBench /
  SmallBank / TPC-C proxies — so TPS/CU describe this system, not a generic
  workload. **Single-match CU is now measured on-chain:** `settle_offchain_match`
  = **121 813 CU** (match_amount 100·1e9 atomic kWh, price 4e6), captured via the
  `BENCH_SETTLE_CU` probe in `tests/escrow_settlement.ts` against a live validator
  (Solana 3.1.10, build `3cb3388`, re-run 2026-07-06; was 103 363 on `58cfc79`).
  That is **~5.3× the ~23k CU/tx TPC-C proxy above** — the
  Ed25519 signature verify + dual-mint (classic currency / Token-2022 energy)
  transfers + escrow/nullifier writes dominate, so the generic-OLTP figure
  materially *understates* per-trade compute. The §2b **batch** path
  (`batch_settle_offchain_match` → treasury `record_settlement_batch`) is also
  on-chain verified now (`tests/batch_settle_thbc.ts`). **Batch CU, 1 match =
  101 470 CU** (`BENCH_BATCH_SETTLE_CU` probe, both mints Token-2022, +
  `record_settlement_batch` CPI + 2 in-loop nullifier creates), captured against
  the same validator (was ~80–92k on `58cfc79`). Lower than the 121 813
  single-match figure above because that run paid a classic-SPL→Token-2022
  cross-program currency leg; here both legs are Token-2022. The run-to-run
  spread is **bump-seek noise, not
  ledger drift**: the in-loop binding derives ~10 PDAs via `find_program_address`
  (settle_offchain.rs:606–634), and each run's fresh keypairs land on different
  bump-search iteration counts.
  **A >1-match single-transaction batch is not achievable** with the current
  design: `batch_settle_offchain_match` introspects the instructions sysvar for 2
  inline Ed25519 verify ixs *per match* (`settle_offchain.rs:598`), and that
  ~189 B/ix sig+pubkey+message payload lives in instruction data, not accounts —
  an ALT can't compress it. Two matches (4 Ed25519 ixs ~760 B + 2 serialized
  `BatchMatchPair`s ~370 B + the settle ix account-index list + headers) overrun
  the 1232-byte packet (`RangeError: encoding overruns Uint8Array` at
  `MessageV0.serialize`). A real per-match marginal-CU curve therefore needs a
  packaging change (pre-verified signature accounts, or an off-chain aggregated
  multisig), not just more matches per call.
  **Batch-settle TPS (single authority, `tests/batch_settle_tps.ts`):** an
  open-loop submission sweep (pre-seed + pre-build all settle txs, then fire with
  `conc` in flight and poll to confirmed; goodput-style — dropped txs re-fired) on
  the same validator gives **~0.6 TPS, flat across concurrency** (conc 5 → 0.61,
  conc 10 → 0.56 TPS; N=10/level, 100% goodput, 0 dropped, 0 on-chain reverts,
  CU ≈ 115k; re-run 2026-07-06 on `3cb3388`, was ~0.5 TPS / CU ≈ 86–89k on
  `58cfc79`). Throughput does **not** scale with concurrency and every level
  needs a second re-fire round. **The bottleneck is NOT the shard.** Spreading the settles across
  all 16 shards (`BENCH_TPS_SHARD_SPREAD=1`; `market_shard`/`zone_shard` carry no
  seeds constraint — `settle_offchain.rs:260` — so the client picks the shard)
  gave the *same* numbers (0.59 / 0.57 TPS, still 2 rounds). The serialization is
  the set of **global writable accounts every settle touches regardless of shard**:
  `treasury_state` (the `total_settled_thbc` accumulator bumped by
  `record_settlement_batch`) and the three fixed `fee`/`wheeling`/`loss` collector
  token accounts (one PDA each per currency). Settlement is therefore
  global-write-bound by design — sharding parallelizes *order submission* (per-
  entity PDAs on the hot path), but settlement reconciles into global totals. The
  load-free per-trade cost (CU) is the figure to cite. To actually parallelize
  settlement you'd need to shard the treasury accumulator + collectors too, or
  amortize more matches per CPI (blocked by the 1-match single-tx cap above).
  Still TODO: a true open-loop (no per-round confirm barrier) for peak TPS, and
  the batch-CU curve once the signature packaging is reworked.
- **[IMP — §3 spike, on-chain]** **Trustless fraud-proof verify CU.** Feasibility
  gate for an indexed-Merkle exclusion proof (prove a settled match was *dropped*):
  measured via the throwaway `blockbench::merkle_verify_inclusion`/`_exclusion`
  instructions (sha256 ladder, `tests/spike_merkle_cu.ts`, Solana 3.1.10).
  Inclusion = **3 250 CU @ depth 10 / 4 114 @ depth 14**; exclusion = **3 629 /
  4 493** — ~**216 CU per tree level**, exclusion ~380 CU over inclusion (one extra
  low-leaf hash + the range check). Both forge classes revert on-chain (tampered
  sibling → root mismatch; claim-present-absent → range check). A challenge's
  Ed25519 meter-sig verify is the existing SigVerify precompile (already inside the
  122k single / ~101k batch settle CU). **Per-challenge verify is ≪ the 200k default
  budget (~2%), ~0.3% of the 1.4M max** — CU does NOT block a trustless Tier-2; the
  open gate is the immediate-settlement → challenge-window redesign (see
  `docs/proposed/implementation-plan.md` §3 T3.3). NOTE: these `blockbench`
  additions are spike-only (throwaway); the blockbench IDL was not regenerated (the
  test builds the ix by hand).
- **[IMP — §1 slash, on-chain]** **`registry::slash_validator` CU = 27 811** on the
  heavier two-transfer path (victim compensation + fund remainder; `BENCH_SLASH_CU`
  in `tests/staking.ts`, Solana 3.1.10) — well inside the 200k default budget. The
  full §1 slash-distribution rework (severity σ, capped compensation, transparent
  fund, Suspended/Slashed transitions, value invariant) is on-chain verified there
  (11/11).
- **[CRIT]** **Multi-validator** (3–4 PoA nodes). A single validator measures
  no consensus cost, yet "block-time is the bottleneck" is the headline claim.
- **[CRIT]** **Open-loop load** (fix arrival rate λ, ramp to saturation) and
  **push past the c=40 knee** to find peak/collapse. Report max sustainable
  TPS at an SLA (p99 < X ms).
- **[IMP]** **Repeat the sweep ≥3–5×** → CI on TPS (currently CI95 on latency
  only; TPS is a single point per concurrency level).
- **[IMP]** Run sequential workloads concurrently **or** label their ~1.6 TPS
  as latency-bound, not throughput.

**P2P-energy domain**
- **[CRIT]** **Settlement-window throughput** — trades cleared per 15-min /
  900 s market-clearing epoch vs deadline (≈26.9k headroom at 29.9 TPS), not
  bare TPS.
- **[CRIT]** **Cost per trade** — convert ~21k CU/tx to fee/$ at a stated
  lamport price; report the fee-to-trade-value ratio (adoption gate).
- **[CRIT]** **CDA allocative efficiency / welfare** vs a uniform-price or
  feed-in-tariff baseline — the actual P2P contribution.
- **[IMP]** **Baseline comparison** vs Hyperledger Fabric (dominant in
  P2P-energy literature) and/or a centralized DB market-clearing baseline.
- **[IMP]** **Liveness under validator failure** (1-of-N down) — PoA
  consortium availability claim.

Full rationale, priority table, and the minimum-viable subset live in the
superproject doc `docs/benchmark-best-practices.md`.
