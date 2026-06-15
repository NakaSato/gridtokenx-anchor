# BlockBench Benchmark Program

## Abstract

`blockbench` is an on-chain Solana/Anchor program that ports the BLOCKBENCH micro-benchmark suite — introduced in *"BLOCKBENCH: A Framework for Analyzing Private Blockchains"* (SIGMOD 2017) — to Solana's account model and the BPF/SBF execution environment (`lib.rs:1-25`). It is a **measurement harness, not a production component**: it carries no business logic for the GridTokenX energy-trading platform and exists solely to quantify the per-layer cost of the runtime — consensus overhead, execution throughput, storage I/O, and query/aggregation behaviour. The program additionally implements two standard online-transaction-processing (OLTP) reference workloads adapted for the account model: the **SmallBank** banking workload and the **YCSB** (Yahoo! Cloud Serving Benchmark) key-value workload (`lib.rs:14-25`). The figures it produces are tabulated in the repository's `BENCHMARKS.md`. Because the program performs no privileged operation and gates nothing, it has no security-critical invariants; its correctness requirement is only that each workload exercise a representative, deterministic unit of work whose compute cost can be measured.

---

## 1. Program Identity

| Property | Value |
|----------|-------|
| Program ID | `9AM4JkvUkK8ZfRneTAQVahFgPe9rEisNkB9byRfZ4TwT` |
| Crate name | `blockbench` (`Cargo.toml:2`) |
| Crate version | `0.1.1` (`Cargo.toml:3`) |
| Anchor version | `anchor-lang` 1.0.0 (`Cargo.toml:24`) |
| `declare_id!` | `lib.rs:38` |
| Module name | `pub mod blockbench` (`lib.rs:86`) |

The crate is built both as a deployable program (`cdylib`) and as a library (`Cargo.toml:8`). The `init-if-needed` Anchor feature is enabled (`Cargo.toml:24`), which the IOHeavy write path relies on (`io_heavy.rs:160`). The `localnet` feature wires in the `compute-debug` profiling macros; when it is absent, `compute_fn!` and `compute_checkpoint!` degrade to no-ops (`lib.rs:40-53`, `Cargo.toml:13,25`). The crate forces `overflow-checks = true` for release builds, countering the Solana default of silent wrapping arithmetic (`Cargo.toml:27-30`).

---

## 2. System Role

`blockbench` is the OLTP measurement program of the GridTokenX Anchor repository. It is one of two benchmark crates in the repo (the other being `tpc-benchmark`) and is unrelated to the five production programs (`energy-token`, `governance`, `oracle`, `registry`, `trading`). It does not participate in the CPI graph and exposes no instruction that any production service invokes.

The program organises its instructions as **layer-isolation tests**: each workload is designed to stress one layer of the blockchain stack so that the layer's cost can be measured in isolation (`lib.rs:5-12`):

| Workload module | Target layer | What it isolates |
|-----------------|--------------|------------------|
| `do_nothing` | Consensus | Pure transaction overhead with no computation or state change — the latency/compute floor (`do_nothing.rs:1-4`) |
| `cpu_heavy` | Execution | Compute-bound BPF/SBF work: sorting, tight loops, hashing, matrix multiply (`cpu_heavy.rs:1-4`) |
| `io_heavy` | Data model | Account read/write throughput (`io_heavy.rs:1-4`) |
| `analytics` | Query | OLAP-style aggregation and scan over many accounts (`analytics.rs:1-4`) |
| `ycsb` | Key-value store | YCSB insert/read/update/delete over PDA-keyed records (`ycsb.rs:1-4`) |
| `smallbank` | OLTP application | SmallBank banking transactions (`smallbank.rs:1`) |

A `metrics` module aggregates per-operation measurements on-chain into a `BlockbenchState` account and computes a summary (`metrics.rs:1-3`). The relationship to `BENCHMARKS.md` is direct: the TypeScript suites drive these instructions, capture wall-clock latency and `computeUnitsConsumed`, and transcribe the results into the report's BlockBench and SmallBank tables (`BENCHMARKS.md:52,73`). The report notes that latency is dominated by single-node block time and the sequential submit loop, so the **compute-unit columns are the load-independent figure of merit** for program cost (`BENCHMARKS.md:44-48`).

---

## 3. State Model

All persistent accounts use the regular (non-zero-copy) Anchor `#[account]` representation. The program defines six account types plus several Borsh-serialised helper structs.

### 3.1 Account types

| Account | Seeds | Space constant | Purpose |
|---------|-------|----------------|---------|
| `BlockbenchState` | `[b"blockbench", authority]` | `LEN` (`state.rs:35-41`) | Per-authority benchmark config + aggregated metrics + run state (`state.rs:12-32`) |
| `YcsbStore` | `[b"ycsb_store", authority]` | `LEN = 49` (`state.rs:223`) | YCSB store header: record count, field config, bump (`state.rs:212-220`) |
| `YcsbRecord` | `[b"ycsb_record", store, key]` | `BASE_LEN + value.len()` (`state.rs:245`) | One key-value record; `MAX_VALUE_SIZE = 1024` (`state.rs:226-248`) |
| `IoHeavyAccount` | `[b"io_heavy", payer, key_prefix]` | `MAX_LEN` (`state.rs:276`) | Variable-size data blob + write counter; `MAX_DATA_SIZE = 2048` (`state.rs:255-277`) |
| `SmallbankCustomer` | `[b"sb_customer", customer_id]` | `SPACE = 37` (`state.rs:337-341`) | Customer id + name (max 16 chars) (`state.rs:324-334`) |
| `SmallbankSavings` | `[b"sb_savings", customer_id]` | `SPACE = 25` (`state.rs:357-361`) | Savings `i64` balance (`state.rs:344-354`) |
| `SmallbankChecking` | `[b"sb_checking", customer_id]` | `SPACE = 25` (`state.rs:377-381`) | Checking `i64` balance (`state.rs:363-374`) |

Two further `#[account]` types are declared for detailed metric capture but are not instantiated by any instruction in the current instruction set: `MetricEntry` (`state.rs:284-298`) and `LatencyHistogram` (`state.rs:301-317`). They reserve space for per-operation entries and a seven-bucket latency histogram respectively.

### 3.2 Embedded (Borsh) structs

| Struct | Definition | Role |
|--------|-----------|------|
| `BlockbenchConfig` | `state.rs:44-76` | Workload selection, operation count, concurrency, YCSB record/field sizing, key distribution, Zipfian constant (basis points) (`LEN = 29`, `state.rs:75`) |
| `BlockbenchMetrics` | `state.rs:79-112` | 18 `u64` counters: op counts, latency stats (incl. `latency_sum_squares` for std-dev), compute-unit stats, per-YCSB-op counts, error breakdown (`LEN = 144`, `state.rs:111`) |
| `BenchmarkSummary` | `state.rs:115-137` | TPS, average latency, p50/p90/p95/p99, success-rate bps, average compute units, duration — the `finalize` return value |
| `AnalyticsResult` | `state.rs:199-205` | Aggregation type, result value, records scanned, compute units used |

### 3.3 Enumerations

`WorkloadType` (14 variants, `state.rs:144-161`) tags the configured workload and defaults to `DoNothing`. `DistributionType` (`Uniform`/`Zipfian`/`Latest`/`Hotspot`, `state.rs:164-171`) selects key-distribution strategy; the constant defaults to `Uniform`. `BenchmarkType` (`state.rs:174-186`) classifies a recorded metric. `AggregationType` (`Sum`/`Count`/`Average`/`Min`/`Max`, `state.rs:189-196`) selects the analytics reduction.

The YCSB workload mixes are declared as constants in `blockbench_constants` (`lib.rs:55-83`): Workload A = 50/50 read/update, B = 95/5, C = 100% read, F = 50% read + 50% read-modify-write.

---

## 4. Instruction Set

The program exposes 27 instructions (`lib.rs:86-313`). Every handler body is wrapped in `compute_fn!("label" => { ... })` so that, under the `localnet` feature, its compute consumption is logged. Several compute-bound handlers return a checksum or hash so the validator cannot elide the work and so the client can verify execution.

### 4.1 Initialization

**`initialize_benchmark(config)`** (`lib.rs:93-100`, `initialize.rs:7-44`). Creates the `BlockbenchState` PDA, stores the supplied `BlockbenchConfig`, zeroes metrics, and seeds `min_latency_us` / `min_compute_units` to `u64::MAX` so the running minimum is computed correctly (`initialize.rs:22-24`). Accounts: `authority` (signer/payer), `benchmark_state` (`init`), `system_program`.

### 4.2 DoNothing — consensus baseline

**`do_nothing()`** (`lib.rs:102-106`, `do_nothing.rs:10-14`). Returns `Ok(())` after a single `msg!`, performing no state change. Measures the consensus/transaction floor. Account: `payer` (signer only) (`do_nothing.rs:23-27`).

**`do_nothing_nonce(nonce: u32)`** (`lib.rs:108-112`, `do_nothing.rs:17-21`). Identical empty body, but the `u32` nonce makes each transaction unique to defeat deduplication/caching (`do_nothing.rs:17-21`). The `u32` width is chosen over `u64` to minimise serialization overhead. Accounts: `payer`, optional `benchmark_state` (`do_nothing.rs:31-42`).

### 4.3 CpuHeavy — execution layer

All four take only the `CpuHeavy` context (`payer` signer, `cpu_heavy.rs:194-198`) and bound their input against a per-operation maximum to stay within the compute budget.

| Instruction | Definition | Work measured | Bound |
|-------------|-----------|---------------|-------|
| `cpu_heavy_sort(array_size, seed)` | `lib.rs:114-119`, `cpu_heavy.rs:60-84` | LCG array generation + in-place quicksort; returns a wrapping checksum | `array_size ≤ MAX_SORT_SIZE = 1024` (`cpu_heavy.rs:48,65`) |
| `cpu_heavy_loop(iterations)` | `lib.rs:121-126`, `cpu_heavy.rs:111-128` | Tight arithmetic loop (add/mul/xor/shift); returns accumulator | `iterations ≤ MAX_LOOP_ITERATIONS = 1_000_000` (`cpu_heavy.rs:51,115`) |
| `cpu_heavy_hash(iterations, data_size)` | `lib.rs:128-137`, `cpu_heavy.rs:131-153` | Iterated hash chain over a custom mixing function; returns final 32-byte digest | `iterations ≤ 1000`, `data_size ≤ 1024` (`cpu_heavy.rs:54,136-137`) |
| `cpu_heavy_matrix(matrix_size)` | `lib.rs:139-144`, `cpu_heavy.rs:156-192` | Naive O(n³) matrix multiply C = A·B; returns checksum | `matrix_size ≤ MAX_MATRIX_SIZE = 16` (`cpu_heavy.rs:57,160`) |

The hash function is a self-contained mixing routine (no external crate) chosen to avoid syscall dependencies (`cpu_heavy.rs:9-45`).

### 4.4 IoHeavy — data-model layer

**`io_heavy_write(key_prefix, value_size, num_writes)`** (`lib.rs:146-155`, `io_heavy.rs:14-58`). Initialises an `IoHeavyAccount` on first use (`init_if_needed`) and performs `num_writes` successive in-place rewrites of its `data` field, bumping `write_count` each time. Measures repeated same-account write cost. Bounds: `num_writes ≤ MAX_IO_OPS = 20`, `value_size ≤ MAX_DATA_SIZE` (`io_heavy.rs:11,20-21`). Accounts: `payer`, `io_account` (`init_if_needed`), `system_program` (`io_heavy.rs:155-169`).

**`io_heavy_read(num_reads)`** (`lib.rs:157-165`, `io_heavy.rs:61-99`). Reads `num_reads` accounts supplied via `remaining_accounts`, deserialises each as `IoHeavyAccount`, and accumulates a byte checksum. Measures read/deserialization throughput. Requires `remaining.len() ≥ num_reads` (`io_heavy.rs:68-71`). Account: `payer`; targets are remaining accounts (`io_heavy.rs:171-175`).

**`io_heavy_mixed(read_ratio, total_ops)`** (`lib.rs:167-175`, `io_heavy.rs:102-151`). Interleaves reads (from `remaining_accounts`) and writes (to one `io_account`) according to `read_ratio` (0–100). Bounds: `total_ops ≤ MAX_IO_OPS`, `read_ratio ≤ 100` (`io_heavy.rs:107-108`). Accounts: `payer`, `io_account` (mut), plus remaining accounts (`io_heavy.rs:177-190`).

### 4.5 Analytics — query layer

**`analytics_aggregate(aggregation_type)`** (`lib.rs:177-185`, `analytics.rs:11-73`). Scans all `remaining_accounts`, deserialises each as `IoHeavyAccount`, and reduces `write_count` by the requested `AggregationType` (Sum/Count/Average/Min/Max). Returns `AnalyticsResult`. Requires at least one account (`analytics.rs:17`). Account: `payer` (`analytics.rs:107-111`).

**`analytics_scan(filter_threshold)`** (`lib.rs:187-195`, `analytics.rs:76-105`). Scans `remaining_accounts` and counts those whose `write_count` exceeds `filter_threshold`; returns the match count. Models a filtered table scan. Account: `payer` (`analytics.rs:113-117`).

### 4.6 YCSB — key-value workload

**`ycsb_init_store()`** (`lib.rs:197-201`, `ycsb.rs:11-24`). Creates the per-authority `YcsbStore` header. Accounts: `authority`, `ycsb_store` (`init`), `system_program` (`ycsb.rs:155-170`).

**`ycsb_insert(key, value)`** (`lib.rs:203-207`, `ycsb.rs:27-59`). Creates a `YcsbRecord` PDA keyed by the 32-byte `key`, sets version 1 and timestamps, and increments the store's `record_count`. Models YCSB Insert. Bound: `value.len() ≤ MAX_VALUE_SIZE` (`ycsb.rs:32-35`). Accounts: `authority`, `ycsb_store` (mut), `record` (`init`, space `BASE_LEN + value.len()`), `system_program` (`ycsb.rs:172-195`).

**`ycsb_read(key)`** (`lib.rs:209-214`, `ycsb.rs:62-76`). Verifies the record's key matches and returns the stored value. Models YCSB Read. The benchmark drives this as a simulated `.view()` call, so no compute units are captured (`tests/blockbench.ts:161-167`). Accounts: `authority`, `ycsb_store`, `record` (read-only) (`ycsb.rs:197-213`).

**`ycsb_update(key, value)`** (`lib.rs:216-220`, `ycsb.rs:79-110`). Verifies the key, rewrites the value (reallocating the account to `BASE_LEN + value.len()`), refreshes `updated_at`, and increments `version`. Models YCSB Update / read-modify-write. Bound: value size (`ycsb.rs:84-87`). Accounts include `realloc`-enabled `record` (`ycsb.rs:227-235`).

**`ycsb_delete(key)`** (`lib.rs:222-226`, `ycsb.rs:113-131`). Verifies the key, decrements `record_count` (saturating), and closes the record account, returning rent to the authority. Models YCSB Delete. Account constraint `close = authority` (`ycsb.rs:253-259`).

**`ycsb_batch_insert(records)`** (`lib.rs:228-235`, `ycsb.rs:134-149`). A placeholder: it logs the store's current record count but performs no per-record creation, because Solana cannot create many PDAs from a single typed argument vector. The source flags this explicitly (`ycsb.rs:138-139`).

### 4.7 SmallBank — OLTP application workload

The five canonical SmallBank read-write transactions plus an account-creation helper. Balances are `i64`; debit paths use `checked_*` arithmetic and the `MathOverflow` / `InsufficientFunds` errors.

| Instruction | Definition | Transaction modelled |
|-------------|-----------|----------------------|
| `smallbank_create_account(customer_id, name, initial_savings, initial_checking)` | `lib.rs:266-276`, `smallbank.rs:122-145` | Provisions `SmallbankCustomer` + `SmallbankSavings` + `SmallbankChecking` PDAs in one transaction |
| `smallbank_transact_savings(amount)` | `lib.rs:278-285`, `smallbank.rs:147-154` | Credit/debit savings (checked) |
| `smallbank_deposit_checking(amount)` | `lib.rs:287-294`, `smallbank.rs:156-163` | Deposit to checking (checked) |
| `smallbank_send_payment(amount)` | `lib.rs:296-300`, `smallbank.rs:165-184` | Move funds between two checking accounts; rejects non-positive amounts and insufficient funds |
| `smallbank_write_check(amount)` | `lib.rs:302-306`, `smallbank.rs:186-193` | Debit checking (checked subtraction) |
| `smallbank_amalgamate()` | `lib.rs:308-312`, `smallbank.rs:195-206` | Move entire savings balance into checking, zeroing savings; the `checking.customer_id == savings.customer_id` constraint binds the pair (`smallbank.rs:111`) |

### 4.8 Metrics

**`record_metric(benchmark_type, latency_us, compute_units, success)`** (`lib.rs:237-247`, `metrics.rs:10-64`). Folds one measurement into `BlockbenchState.metrics`: increments total/success/fail counts, updates latency min/max/sum and `latency_sum_squares`, updates compute-unit min/max/sum, and bumps the matching per-YCSB-op counter. Uses saturating arithmetic throughout.

**`reset_metrics()`** (`lib.rs:249-253`, `metrics.rs:67-82`). Authority-gated (`Unauthorized` otherwise); resets metrics to default, re-seeds minimums to `u64::MAX`, clears `is_running`, and increments `run_id`.

**`finalize_benchmark()`** (`lib.rs:255-260`, `metrics.rs:85-144`). Stamps `end_time`, computes a `BenchmarkSummary` — TPS, average latency, success-rate basis points, average compute units — and returns it. Percentiles are approximations derived from the average and max latency because no on-chain histogram is populated (`metrics.rs:126-130`).

---

## 5. Methodology and Measurement

### 5.1 What each workload models

- **DoNothing** establishes the irreducible cost of submitting and confirming a transaction (consensus + fee accounting), independent of program logic (`do_nothing.rs:2-4`). It is the baseline against which every other workload is read.
- **CpuHeavy** isolates BPF/SBF execution cost. The four variants span different cost profiles — comparison-heavy sort, branch-light arithmetic loop, byte-mixing hash chain, and arithmetic-dense matrix multiply — each bounded so it fits the compute budget (`cpu_heavy.rs:2-4,48-57`).
- **IoHeavy** isolates the data-model layer: serialization, account rent, and repeated read/write cost over `IoHeavyAccount` (`io_heavy.rs:2-4`).
- **Analytics** models OLAP scans/aggregations across many accounts — a workload class blockchains handle poorly — to measure that cost explicitly (`analytics.rs:3-4`).
- **YCSB** is the standard Yahoo! Cloud Serving Benchmark key-value workload, mapped onto PDA-keyed records; the A/B/C/F mix ratios are encoded as constants and exercised by the harness by composing insert/read/update operations (`lib.rs:14-20,55-70`).
- **SmallBank** is the standard SmallBank OLTP banking workload — five short read-write transactions over per-customer savings/checking accounts (`smallbank.rs`).

### 5.2 Compute-unit profiling

Each handler is wrapped in the `compute-debug` macro `compute_fn!` (`lib.rs:97-312`). Under the `localnet` feature this records the compute units consumed by the labelled block; in release builds it expands to the bare block with zero overhead (`lib.rs:43-53`). This makes on-chain compute cost the primary, machine-independent metric, consistent with the report's guidance that compute-unit figures — not wall-clock latency — are the citable measure of program efficiency (`BENCHMARKS.md:44-48`).

### 5.3 How metrics are recorded

Two complementary measurement paths exist. **On-chain**, `record_metric` aggregates measurements into `BlockbenchState.metrics`, and `finalize_benchmark` reduces them to a `BenchmarkSummary` (`metrics.rs:10-144`). **Off-chain**, the TypeScript harness (`tests/utils/bench.ts`, invoked via `measureOp`) runs a warmup phase followed by `ITERS` measured invocations, captures wall-clock latency and per-transaction `computeUnitsConsumed` from `getTransaction`, computes mean/stddev/percentiles/95% CI, and writes JSON/CSV artifacts under `test-results/` (`tests/blockbench.ts:9-19`, `BENCHMARKS.md:27-34`). The off-chain path is what produces the published tables; the on-chain metrics account is available for in-program aggregation but is independent of the report pipeline.

The harness deliberately varies inputs to defeat validator caching: `cpu_heavy_sort` is called with a per-iteration seed offset (`tests/blockbench.ts:104-106`), and each `ycsb_insert` targets a fresh 32-byte key / PDA (`tests/blockbench.ts:119-126`).

---

## 6. Error Codes

Defined in `error.rs:5-66` as `BlockbenchError`.

| Variant | Message | Raised by |
|---------|---------|-----------|
| `BenchmarkNotRunning` | Benchmark is not running | reserved |
| `BenchmarkAlreadyRunning` | Benchmark is already running | reserved |
| `Unauthorized` | Unauthorized access | `reset_metrics` (`metrics.rs:70-73`) |
| `InvalidConfig` | Invalid configuration parameter | `io_heavy_mixed` (`io_heavy.rs:108`) |
| `OperationCountExceeded` | Operation count exceeded | reserved |
| `YcsbRecordNotFound` | YCSB record not found | `ycsb_read`/`update`/`delete` key check (`ycsb.rs:66,93,117`) |
| `YcsbRecordAlreadyExists` | YCSB record already exists | reserved |
| `ValueTooLarge` | Value size exceeds maximum | YCSB insert/update, IO write, hash (`ycsb.rs:34,85`; `io_heavy.rs:21`; `cpu_heavy.rs:137`) |
| `ArrayTooLarge` | Array size exceeds compute budget | `cpu_heavy_sort`/`loop` (`cpu_heavy.rs:65,115`) |
| `InvalidAggregationType` | Invalid aggregation type | reserved |
| `InsufficientAccounts` | Insufficient accounts provided | `io_heavy_read`, `analytics_aggregate` (`io_heavy.rs:70`; `analytics.rs:17`) |
| `MatrixTooLarge` | Matrix size exceeds limit | `cpu_heavy_matrix` (`cpu_heavy.rs:160`) |
| `TooManyHashIterations` | Hash iteration count exceeds limit | `cpu_heavy_hash` (`cpu_heavy.rs:136`) |
| `TooManyIoOperations` | IO operation count exceeds limit | IO write/read/mixed (`io_heavy.rs:20,65,107`) |
| `DurationExceeded` | Benchmark duration exceeded | reserved |
| `InvalidDistribution` | Invalid distribution type | reserved |
| `ArithmeticOverflow` | Arithmetic overflow | reserved |
| `MathOverflow` | Math check failed | SmallBank checked arithmetic (`smallbank.rs:152,161,181,191,203`) |
| `InvalidAmount` | Invalid amount | `smallbank_send_payment` (`smallbank.rs:170`) |
| `InsufficientFunds` | Insufficient funds | `smallbank_send_payment` (`smallbank.rs:177`) |

Variants marked *reserved* are declared but not raised by any handler in the current instruction set.

---

## 7. Testing and Running

Two Mocha/TypeScript suites drive the program, both importing the generated `Blockbench` type and the shared `measureOp` / `BenchReport` harness (`tests/blockbench.ts:1-7`, `tests/smallbank.ts:1-7`).

**BlockBench suite** — `tests/blockbench.ts`. Initialises a `BlockbenchState` and a `YcsbStore` (tolerating "already in use" on a live ledger), then measures `do_nothing` (latency floor), `cpu_heavy_sort` (compute-bound), `ycsb_insert` (write), and `ycsb_read` (point read via `.view()`) (`tests/blockbench.ts:82-171`). Run with:

```bash
npm run test:blockbench          # anchor test tests/blockbench.ts (package.json:19)
```

**SmallBank suite** — `tests/smallbank.ts`. Airdrops to the authority, creates two customers (Alice/Bob) seeded with `1e12` balances so monotonic-debit operations never underflow, then measures all five transactions — `TransactSavings`, `DepositChecking`, `SendPayment`, `WriteCheck`, `Amalgamate` (`tests/smallbank.ts:53-148`). The `name` field is capped at 16 chars on-chain; the suite documents that padding it to 32 chars overflows the account and yields `AccountDidNotSerialize` (`tests/smallbank.ts:61-63`). Run with:

```bash
npm run test:smallbank           # anchor test tests/smallbank.ts (package.json:20)
```

Both suites accept `BENCH_ITERS` and `BENCH_WARMUP` environment variables (defaults 100 / 10), which the report raises to `150` / `10` for paper-grade runs (`tests/blockbench.ts:28-29`, `BENCHMARKS.md:36-43`). They are also reachable via the aggregate `npm run test:all` recipe and `./scripts/run-tests.sh`. Per the repository build gotcha, Anchor 1.0 may spawn `surfpool` as the test validator; where it is unavailable, `./scripts/run-tests.sh` uses `solana-test-validator` instead.
