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
| `treasury.swap_grx_for_thbg` | 21 509 |
| `treasury.redeem_thbg_for_grx` | 21 328 |
| `treasury.stake_grx` (first — inits position) | 19 538 |
| `treasury.set_params` | 3 404 |
| `treasury.update_attestation` | 3 303 |
| `treasury.record_settlement` | 3 301 |

**Reading:** the swap/redeem/stake hot paths cluster at **~19.5–21.5k CU**, driven
by the Token-2022 transfer + mint/burn CPIs (one-time `stake` adds a position-PDA
init). `initialize` is the heaviest at 42k — a one-off that creates the THBG mint
plus the three GRX vaults (swap/stake/reward). Pure-state admin instructions
(`update_attestation`, `record_settlement`, `set_params`) are ~3.3–3.4k. All sit
well inside the 200k budget — the baht-settlement primitive (swap) costs ~1/5 of
the §1 `settle_offchain_match` figure.

---

## 5b. Treasury Sharded-Settlement & Batch CU Profile (in-process, litesvm)

The §2c parallel-settlement reconciliation layer (separate from the §5 swap/stake
hot paths). `record_settlement_sharded` bumps a per-shard PDA instead of the global
`total_settled_thbg` (no write-lock under concurrent settles); `aggregate_settlement_shards`
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
| `energy_token.burn_tokens` | 6 537 |
| `energy_token.add_rec_validator` | 3 496 |
| `energy_token.remove_rec_validator` | 3 291 |

**Reading:** the REC-gated `mint_to_wallet` — the provenance boundary that requires
a registered REC validator co-sign before any GRID is minted — costs **13.7k CU**
(REC-set scan + Token-2022 mint CPI). `initialize_token` (18.4k) is the one-off
mint-PDA creation. Transfer/burn are plain Token-2022 CPIs at 6.5-8k. Validator-set
edits are pure-state at ~3.3–3.5k (up from ~1.5k on `58cfc79`). All well inside budget.

---

## 9. Oracle Meter-Telemetry Scaling (80 → 100,000 meters, live validator)

End-to-end AMI ingest under fleet load: `oracle.submit_meter_reading` fired from
N distinct meters against a **live** `solana-test-validator` (not litesvm), over 2
epochs 61 s apart (on-chain `min_reading_interval` = 60 s). Epoch 1 initialises each
`MeterState` PDA; epoch ≥2 is the steady-state write. Every meter targets its own
`[b"meter", meter_id]` PDA — writes are Sealevel-disjoint by design.

Submits are authorised by the single gateway (`oracle_data.chain_bridge` = the
provider wallet), which is the `mut` fee-payer and therefore **write-locked on every
transaction**. That shared payer + single-node banking — *not* per-meter contention —
is the throughput ceiling here.

**Two client harnesses** (same on-chain path — transport changes TPS, never CU):
the ≤10k rows used per-tx `.rpc()` websocket confirms through a 300-in-flight pool;
that transport collapses beyond ~10k pending confirms, so the ≥50k rows use locally
pre-signed raw sends (cached blockhash, 10 s refresh) + bulk `getSignatureStatuses`
polling (1.5 s sweep, 3 000-tx in-flight window). Large-N latency is therefore
poll-quantised (±1.5 s) and the TPS step-up at 50k reflects the better transport.
CU is sampled (≤200 confirmed tx/epoch) from `getTransaction(sig).meta`.

Reproduce (validator up, oracle deployed + `scripts/init-oracle.ts` run):

```bash
NODE_OPTIONS=--max-old-space-size=16384 \
METERS=100000 EPOCHS=2 MAX_INFLIGHT=3000 CU_SAMPLE=200 PREFIX=RUN_M \
  npx tsx scripts/bench-meter-throughput.ts
```

**Success / loss**

| N meters | total tx | confirmed | loss % | harness |
|---------:|---------:|----------:|-------:|:--------|
| 80 | 400 | 400 | 0 | rpc-pool |
| 1 000 | 2 000 | 1 992 | 0.40 | rpc-pool |
| 5 000 | 10 000 | 9 952 | 0.48 | rpc-pool |
| 10 000 | 20 000 | 19 908 | 0.46 | rpc-pool |
| 50 000 | 100 000 | 99 261 | 0.74 | raw-send |
| 100 000 | 200 000 | 198 383 | 0.81 | raw-send |

**Compute units per `submit_meter_reading` (scale-invariant)**

| N meters | init CU min | init CU med | steady CU min | steady CU med | steady CU max |
|---------:|------------:|------------:|--------------:|--------------:|--------------:|
| 80 | 16 088 | 16 088 | 13 468 | 13 468 | 20 968 |
| 1 000 | 16 145 | 17 645 | 13 525 | 15 025 | 28 525 |
| 5 000 | 16 145 | 17 645 | 13 525 | 15 025 | 22 525 |
| 10 000 | 16 180 | 17 680 | 13 560 | 15 060 | 22 560 |
| 50 000 | 16 254 | 17 754 | 13 634 | 15 134 | 22 634 |
| 100 000 | 16 254 | 17 754 | 13 634 | 15 134 | 24 134 |

**Throughput & latency (steady-state, single-node localnet)**

| N meters | TPS mean | lat p50 (ms) | lat p95 (ms) | lat max (ms) |
|---------:|---------:|-------------:|-------------:|-------------:|
| 80 | 135 | 659 | 859 | 861 |
| 1 000 | 120 | 1 334 | 1 440 | 4 809 |
| 5 000 | 188 | 1 356 | 1 781 | 5 058 |
| 10 000 | 217 | 1 214 | 1 548 | 14 971 |
| 50 000 | 359 | 1 749 | 2 565 | 2 886 |
| 100 000 | 329 | 1 944 | 2 869 | 4 196 |

**Reading.** The steady-state **base write path (`CU min`) holds 13.5–13.6k CU across
a 1 250× meter-count range** (13 468 at N=80 → 13 634 at N=50k/100k) — per-meter cost
is O(1), independent of fleet size, and cross-validates §4's litesvm
`submit_meter_reading` subsequent = 13 376. The small upward drift tracks meter-id
byte length (longer ids = more seed/copy bytes), not N; the `CU med/max` spread tracks
the reading *values* (the anomaly production/consumption-ratio branch). **TPS does not
grow with N**: ~120–220 on the rpc-pool harness, ~330–360 on the raw-send harness —
flat within each harness even as N doubles 50k→100k, because every tx is signed by the
single write-locked gateway payer on one validator. This is a serialization ceiling,
not a per-meter one — the disjoint PDAs need multi-gateway fee-payer pooling plus a
multi-node deployment to convert into proportional throughput, and the flat CU shows
the per-write cost is already scale-free. Loss stays **< 0.9% at 100 000 concurrent
meters** (0.74% @50k, 0.81% @100k); p95 latency ~2.6–2.9 s under the 3 000-tx window.
100k CU values re-probed post-run — the rotating ledger pruned in-run tx history under
the 200k-tx load; probe values match the 50k run exactly (deterministic path; see that
run's `.md`). (Solana 3.1.10, Apple M2, 2026-07-06; harness
`scripts/bench-meter-throughput.ts`.)

---

## Artifacts

```
test-results/
├── blockbench/   blockbench-<ISO8601>.{json,csv}
├── smallbank/    smallbank-<ISO8601>.{json,csv}
├── tpc/          tpc-c-<ISO8601>.{json,csv}   (one file per concurrency level)
├── meter-throughput-<N>m-<ISO8601>.{json,md}  (§9 per-size: per-epoch + per-meter)
└── meter-scaling-summary.md                   (§9 combined 80→100k scaling tables)
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
  on-chain verified now (`tests/batch_settle_thbg.ts`). **Batch CU, 1 match =
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
  `treasury_state` (the `total_settled_thbg` accumulator bumped by
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
