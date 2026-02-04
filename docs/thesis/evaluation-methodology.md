# GridTokenX Benchmark Evaluation Methodology

This document describes the methodology used for evaluating the GridTokenX platform performance, following academic standards for blockchain benchmarking.

## 1. Benchmark Framework Selection

### 1.1 BLOCKBENCH Methodology

We adopt the BLOCKBENCH framework (Dinh et al., 2017) for systematic blockchain performance evaluation. BLOCKBENCH isolates performance at three layers:

| Layer | Benchmark | Metric | Purpose |
|-------|-----------|--------|---------|
| **Consensus** | DoNothing | TPS, Latency | Network overhead baseline |
| **Execution** | CPUHeavy | TPS, Compute | Smart contract execution efficiency |
| **Storage** | IOHeavy | TPS, I/O | AccountsDB read/write performance |
| **Application** | YCSB, Smallbank | TPS, Conflicts | Full-stack transaction processing |

### 1.2 TPC Benchmarks

For industry-standard comparison, we implement TPC variants:

- **TPC-C**: OLTP benchmark measuring order processing throughput (tpmC)
- **TPC-E**: Trading/DeFi simulation with complex order matching
- **Smallbank**: Consensus stress test with hotspot contention

## 2. Test Environment

### 2.1 Hardware Configuration

| Component | Specification |
|-----------|---------------|
| CPU | Apple M2 Pro (12 cores) |
| RAM | 32 GB |
| Storage | NVMe SSD |
| Network | Local (no network latency) |

### 2.2 Software Configuration

| Component | Version |
|-----------|---------|
| Solana | 1.18.x |
| Anchor | 0.30.x |
| LiteSVM | Latest |
| Node.js | 20.x |
| TypeScript | 5.x |

### 2.3 Test Parameters

| Parameter | Value | Justification |
|-----------|-------|---------------|
| Duration | 30 seconds | Sufficient for statistical stability |
| Warmup | 10% discarded | Eliminate JIT compilation effects |
| Concurrency | 5-10 workers | Balance between load and contention |
| Iterations | 1,000+ per test | Statistical significance |

## 3. Metrics Collected

### 3.1 Throughput Metrics

| Metric | Unit | Description |
|--------|------|-------------|
| **TPS** | tx/s | Raw transactions per second |
| **tpmC** | tx/min | TPC-C new order transactions per minute |
| **QphH** | queries/hr | TPC-H analytical queries per hour |

### 3.2 Latency Metrics

| Percentile | Description |
|------------|-------------|
| **Average** | Mean latency across all transactions |
| **P50** | Median latency (50th percentile) |
| **P90** | 90th percentile latency |
| **P95** | 95th percentile latency |
| **P99** | 99th percentile latency |
| **P99.9** | Tail latency (99.9th percentile) |

### 3.3 Reliability Metrics

| Metric | Target | Description |
|--------|--------|-------------|
| **Success Rate** | >99.5% | Percentage of successful transactions |
| **MVCC Conflict Rate** | <2% | Multi-version concurrency conflicts |
| **Error Count** | Minimal | Total failed transactions |

### 3.4 Resource Metrics

| Metric | Description |
|--------|-------------|
| **Compute Units** | CU consumed per instruction |
| **Account Rent** | Storage cost for on-chain state |
| **Transaction Size** | Bytes per serialized transaction |

## 4. Experimental Procedure

### 4.1 Benchmark Execution Steps

1. **Environment Setup**
   - Start local Solana validator or LiteSVM
   - Deploy all program binaries
   - Initialize test accounts with SOL

2. **Warmup Phase**
   - Execute 10% of planned transactions
   - Discard warmup results
   - Allow JIT compilation to stabilize

3. **Measurement Phase**
   - Execute benchmark workload
   - Record all latency samples
   - Track success/failure counts

4. **Cooldown Phase**
   - Finish pending transactions
   - Collect final state

5. **Data Export**
   - Generate JSON, CSV, LaTeX outputs
   - Calculate percentile statistics
   - Produce comparison tables

### 4.2 Workload Characteristics

#### TPC-C Transaction Mix

| Transaction | Percentage | Description |
|-------------|------------|-------------|
| CREATE_ORDER | 45% | Create sell/buy orders |
| TOKEN_TRANSFER | 43% | GRX token transfers |
| GET_ORDER_STATUS | 4% | Query order state |
| CHECK_BALANCE | 4% | Balance inquiries |
| EXECUTE_TRADE | 4% | Match and settle |

#### Smallbank Transaction Mix

| Transaction | Percentage | Description |
|-------------|------------|-------------|
| WRITE_CHECK | 25% | Debit account |
| SEND_PAYMENT | 25% | Transfer between accounts |
| TRANSACT_SAVINGS | 15% | Update savings |
| DEPOSIT_CHECKING | 15% | Credit account |
| BALANCE | 10% | Read balance |
| AMALGAMATE | 10% | Merge accounts |

## 5. Statistical Analysis

### 5.1 Confidence Intervals

We report 95% confidence intervals for all throughput and latency metrics:

$$CI = \bar{x} \pm t_{\alpha/2} \cdot \frac{s}{\sqrt{n}}$$

Where:
- $\bar{x}$ = sample mean
- $t_{\alpha/2}$ = t-critical value for 95% confidence
- $s$ = sample standard deviation
- $n$ = sample size

### 5.2 Outlier Handling

- **Detection**: Values beyond P99.9 are flagged as outliers
- **Treatment**: Reported separately, not excluded from primary metrics
- **Justification**: Tail latency is important for production systems

### 5.3 Reproducibility

All benchmarks are:
- **Deterministic**: Using fixed random seeds where applicable
- **Idempotent**: Can be re-run with consistent results (±5% variance)
- **Documented**: Full configuration exported with results

## 6. Comparison Methodology

### 6.1 Platform Selection

We compare against platforms from the BLOCKBENCH paper:

| Platform | Consensus | Permission Model |
|----------|-----------|------------------|
| **Solana (GridTokenX)** | PoH + Tower BFT | Permissionless |
| Hyperledger Fabric | Raft | Permissioned |
| Ethereum (PoW) | Ethash | Permissionless |
| Parity (PoA) | Aura | Permissioned |

### 6.2 Normalization

To ensure fair comparison:
- **Hardware**: Benchmark results normalized to single-core equivalent
- **Network**: Local execution to isolate blockchain overhead
- **Workload**: Identical transaction mix across platforms

## 7. Limitations

1. **Local Testing**: Results represent best-case with no network latency
2. **Scale**: Tests run with limited concurrent users (10 max)
3. **Hardware Specific**: Apple M2 may differ from commodity x86
4. **LiteSVM vs Mainnet**: Simulated environment may differ from production

## 8. Data Availability

All benchmark data is available in multiple formats:

| Format | Location | Use Case |
|--------|----------|----------|
| JSON | `test-results/benchmark-suite/*.json` | Programmatic analysis |
| CSV | `test-results/benchmark-suite/*.csv` | Spreadsheet analysis |
| LaTeX | `test-results/benchmark-suite/*.tex` | Academic papers |
| Prometheus | `test-results/benchmark-suite/metrics.prom` | Monitoring integration |

---

## References

1. Dinh, T. T. A., et al. (2017). "BLOCKBENCH: A Framework for Analyzing Private Blockchains." *SIGMOD '17*.
2. TPC-C Benchmark. Transaction Processing Performance Council.
3. Cooper, B. F., et al. (2010). "Benchmarking Cloud Serving Systems with YCSB." *SoCC '10*.

---

*Methodology document for GridTokenX Thesis*
