# GridTokenX Performance Benchmarking Plan

## Research Paper Test Methodology

### 1. Test Environment Configurations

| Environment | Description | Use Case |
|------------|-------------|----------|
| **LiteSVM** | In-process VM, no network | Baseline performance, max throughput |
| **Local Validator** | Single node validator | Network overhead measurement |
| **Devnet** | Public test network | Real-world conditions |

### 2. Metrics to Measure

#### 2.1 Throughput Metrics
- **TPS (Transactions Per Second)**: Sustained transaction rate
- **Peak TPS**: Maximum achievable under burst load
- **Effective TPS**: Successful transactions only (excluding failures)

#### 2.2 Latency Metrics
- **Submission Latency**: Time to send transaction to validator
- **Confirmation Latency**: Time until transaction is confirmed
- **End-to-End Latency**: Total time from client to confirmed state
- **Percentiles**: p50, p75, p90, p95, p99

#### 2.3 Resource Metrics
- **Compute Units (CU)**: Per transaction type
- **Memory Usage**: Program heap consumption
- **Account Data Size**: Storage requirements

### 3. Test Scenarios

#### 3.1 Single Transaction Types (Isolation Tests)
| Test | Description | Iterations |
|------|-------------|------------|
| SOL Transfer | Baseline native transfer | 1000 |
| Energy Token Mint | Mint new energy tokens | 1000 |
| Create Order | Place trading order | 1000 |
| Match Orders | Execute order matching | 500 |
| Update Oracle | Price feed updates | 1000 |

#### 3.2 Load Tests (Throughput)
| Test | Concurrent Users | Duration | Target |
|------|-----------------|----------|--------|
| Light Load | 10 | 60s | Baseline |
| Medium Load | 50 | 60s | Normal operation |
| Heavy Load | 100 | 60s | Stress test |
| Peak Load | 200 | 30s | Breaking point |

#### 3.3 Latency Distribution Tests
- **Cold Start**: First transaction after idle
- **Warm State**: Sustained operation
- **Under Load**: Various concurrency levels

### 4. Test Execution Plan

```
Phase 1: Baseline (LiteSVM)
├── Single transaction latency
├── Maximum throughput
└── CU measurements

Phase 2: Local Validator
├── Network overhead
├── Confirmation times
└── Block inclusion

Phase 3: Devnet (Optional)
├── Real-world latency
├── Network congestion effects
└── Geographic distribution
```

### 5. Data Collection Format

```json
{
  "testId": "throughput_001",
  "timestamp": "2025-12-16T00:00:00Z",
  "environment": "litesvm",
  "scenario": "heavy_load",
  "config": {
    "concurrentUsers": 100,
    "durationSeconds": 60,
    "transactionType": "create_order"
  },
  "results": {
    "totalTransactions": 5000,
    "successfulTransactions": 4950,
    "failedTransactions": 50,
    "throughput": {
      "avgTps": 82.5,
      "peakTps": 125.0,
      "minTps": 45.0
    },
    "latency": {
      "p50Ms": 12.5,
      "p75Ms": 18.2,
      "p90Ms": 25.8,
      "p95Ms": 35.1,
      "p99Ms": 65.3,
      "avgMs": 15.8,
      "minMs": 3.2,
      "maxMs": 125.0
    },
    "computeUnits": {
      "avg": 45000,
      "max": 52000,
      "min": 42000
    }
  }
}
```

### 6. Statistical Analysis

- **Sample Size**: Minimum 1000 transactions per test
- **Warm-up Period**: Discard first 10% of measurements
- **Outlier Handling**: Report but exclude >3σ from mean
- **Confidence Intervals**: Report 95% CI for all metrics

### 7. Comparative Analysis

Compare against:
- Native SOL transfers (baseline)
- Similar DeFi protocols (if data available)
- Theoretical Solana limits (~65,000 TPS)

### 8. Output Artifacts

1. `results/benchmark-summary.json` - Aggregated results
2. `results/raw-latencies.csv` - Individual measurements
3. `results/charts/` - Visualization data
4. `results/statistical-analysis.md` - Statistical report
