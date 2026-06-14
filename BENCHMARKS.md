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
| Git commit | `58cfc79` (clean) |
| Solana/agave cluster | 3.1.10 |
| Anchor | `anchor-lang` 1.0.x / `anchor-cli` 1.0.0 |
| Node | v24.16.0 |
| OS / arch | Darwin 25.5.0 / arm64 |
| CPU | Apple M2, 8 cores |
| Validator | local `solana-test-validator` (single node, PoA-style permissioned) |
| Run date | 2026-06-07 |

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
| do_nothing | 150 | 719.95 | 159.49 | 671.15 | 991.46 | 1455 | ±25.52 | 1.39 | 648 | 0 |
| cpu_heavy_sort | 150 | 590.83 | 119.18 | 544.27 | 811.55 | 1025 | ±19.07 | 1.69 | 9 645 | 0 |
| ycsb_insert | 130 | 654.08 | 118.56 | 639.21 | 863.56 | 1051 | ±20.38 | 1.53 | 12 904 | 20¹ |
| ycsb_read | 150 | 4.29 | 3.92 | 3.46 | 8.67 | 16.85 | ±0.628 | 233.18 | n/a² | 0 |

¹ `ycsb_insert` records to a unique PDA per key; 20 duplicate-key collisions
on the live ledger across the run are counted as `fail`, leaving n=130 valid
samples. Not program errors.
² `ycsb_read` is an RPC account fetch (no consensus round-trip) → ~233 TPS,
two orders of magnitude faster than write paths, and consumes no on-chain CU.

**Reading:** `do_nothing` (648 CU) is the Anchor dispatch + signature-verify
floor. `cpu_heavy_sort` (64-element sort) is ~9.6k CU. A single keyed insert
of a value record is ~12.9k CU — well inside the 200k default CU budget.

---

## 2. SmallBank OLTP (n = 150, sequential)

| Transaction | n | mean ms | stddev | p50 | p95 | p99 | ci95 | TPS | CU/tx | fail |
|-------------|---|---------|--------|-----|-----|-----|------|-----|-------|------|
| TransactSavings | 150 | 599.09 | 90.79 | 572.13 | 767.99 | 941.92 | ±14.53 | 1.67 | 3 355 | 0 |
| DepositChecking | 150 | 570.99 | 118.00 | 531.20 | 779.56 | 1122 | ±18.88 | 1.75 | 3 358 | 0 |
| SendPayment | 150 | 604.63 | 99.04 | 578.67 | 781.12 | 1006 | ±15.85 | 1.65 | 5 963 | 0 |
| WriteCheck | 150 | 589.01 | 78.02 | 565.13 | 753.79 | 812.31 | ±12.49 | 1.70 | 3 362 | 0 |
| Amalgamate | 150 | 631.62 | 105.86 | 604.21 | 827.51 | 935.96 | ±16.94 | 1.58 | 5 936 | 0 |

**Reading:** All 750 transactions succeeded. Compute cost is value-independent
and scales with the **number of account writes**: single-account txns
(TransactSavings / DepositChecking / WriteCheck) ~3.4k CU; two-account txns
(SendPayment / Amalgamate) ~5.9k CU. No contention in the sequential schedule.

---

## 3. TPC-C Concurrency Sweep (TX = 500, 50% NewOrder / 50% Payment)

100% success at every concurrency level. Throughput from concurrent in-flight
submission; latency is per-transaction client→confirmed.

| Concurrency | TPS | mean ms | stddev | p50 | p95 | p99 | ci95 | CU/tx mean | CU/tx p95 | CU/tx max |
|-------------|-----|---------|--------|-----|-----|-----|------|------------|-----------|-----------|
| 5 | 8.67 | 575.00 | 88.35 | 554 | 726.10 | 880.08 | ±7.74 | 21 263 | 30 035 | 37 286 |
| 10 | 14.50 | 679.34 | 108.53 | 658.5 | 879.95 | 1052 | ±9.51 | 20 633 | 28 544 | 39 035 |
| 20 | 21.87 | 856.74 | 301.95 | 755 | 1656.15 | 1677 | ±26.47 | 21 269 | 30 035 | 39 044 |
| 40 | 29.90 | 1057.79 | 411.89 | 900 | 1707 | 2071 | ±36.10 | 21 508 | 30 044 | 37 535 |

**Reading:**

- **Sublinear scaling.** 5→40 concurrency (8×) yields 8.67→29.90 TPS (3.45×).
  Diminishing returns — the single validator's block production is the ceiling.
- **Saturation knee between c=10 and c=20.** Latency stddev jumps 108→302 ms
  and p95 nearly doubles (880→1656 ms): in-flight transactions begin queueing.
- **CU/tx flat (~21k) across all loads.** On-chain compute cost is independent
  of concurrency → the bottleneck is *consensus/block-time + write
  serialization on `District.next_o_id`*, not execution. This is the expected
  signature of a write-contended OLTP workload on a single-node ledger.

A prior `TX=200 @ c=10` reference run gave 14.79 TPS / 21 118 CU mean,
consistent with the `TX=500 @ c=10` point above (14.50 TPS), confirming
run-to-run stability.

---

## Artifacts

```
test-results/
├── blockbench/   blockbench-<ISO8601>.{json,csv}
├── smallbank/    smallbank-<ISO8601>.{json,csv}
└── tpc/          tpc-c-<ISO8601>.{json,csv}   (one file per concurrency level)
```

Each JSON carries full per-sample distributions and host metadata; each CSV is
a single summary row for spreadsheet/plotting ingestion.
