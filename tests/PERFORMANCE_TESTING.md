# Performance Testing Guide - Transaction Latency & Throughput

## Overview

This guide explains how to run comprehensive performance benchmarks for GridTokenX Anchor programs, measuring transaction latency and throughput under various load conditions.

## Test File

**Location**: `anchor/tests/performance-benchmark.test.ts`

## Test Suites

### 1. Sequential Transaction Loop
Measures individual transaction latency by executing transactions one after another.

- **50 Sequential Token Transfers**: Baseline latency measurement
- **30 Sequential Order Placements**: Trading order latency
- **20 Sequential REC Validator Additions**: Validator management latency

**Use Case**: Understanding single-transaction performance and baseline latency.

### 2. Batch Transaction Loop
Measures throughput by executing multiple transactions in parallel batches.

- **100 Token Transfers (batches of 10)**: High-volume transfer throughput
- **60 Order Placements (batches of 5)**: Trading order throughput

**Use Case**: Evaluating concurrent transaction processing capabilities.

### 3. Sustained Load Test
Simulates realistic mixed workload over extended period.

- **200 Mixed Transactions**: Alternating between transfers, orders, and burns

**Use Case**: Testing system stability under sustained diverse load.

### 4. Stress Test - High Volume
Tests system limits with aggressive transaction rates.

- **500 Rapid Token Burns**: Maximum throughput stress test

**Use Case**: Identifying bottlenecks and failure points.

### 5. Latency Distribution Analysis
Analyzes latency patterns and percentiles.

- **100 Transfers with Distribution**: P50, P95, P99 latency metrics

**Use Case**: Understanding latency characteristics for SLA definition.

## Running Tests

### Prerequisites

1. **Start Solana Localnet**:
   ```bash
   # Terminal 1
   cd anchor
   anchor localnet
   ```

2. **Wait for validator to be ready** (usually ~10 seconds)

### Run All Performance Tests

```bash
cd anchor
anchor test --skip-local-validator tests/performance-benchmark.test.ts
```

### Run Specific Test Suite

```bash
# Sequential tests only
anchor test --skip-local-validator tests/performance-benchmark.test.ts --grep "Sequential"

# Batch tests only
anchor test --skip-local-validator tests/performance-benchmark.test.ts --grep "Batch"

# Sustained load test
anchor test --skip-local-validator tests/performance-benchmark.test.ts --grep "Sustained"

# Stress test
anchor test --skip-local-validator tests/performance-benchmark.test.ts --grep "Stress"

# Latency analysis
anchor test --skip-local-validator tests/performance-benchmark.test.ts --grep "Distribution"
```

### Quick Performance Check

For a faster performance snapshot (~5 minutes):

```bash
anchor test --skip-local-validator tests/performance-benchmark.test.ts --grep "Sequential Transaction Loop"
```

## Performance Metrics Explained

### Reported Metrics

- **Total Transactions**: Total number of transaction attempts
- **Successful**: Transactions that completed successfully
- **Failed**: Transactions that encountered errors
- **Total Duration**: Time from first to last transaction (ms)
- **Throughput**: Successful transactions per second (tx/sec)

### Latency Metrics

- **Avg Latency**: Mean transaction time (ms)
- **Min Latency**: Fastest transaction (ms)
- **Max Latency**: Slowest transaction (ms)
- **P50 Latency (Median)**: 50th percentile - half of transactions faster
- **P95 Latency**: 95th percentile - 95% of transactions faster
- **P99 Latency**: 99th percentile - 99% of transactions faster

### Performance Criteria

The tests include automated performance assertions:

- ✅ **Throughput**: Should exceed 0.5 tx/sec
- ✅ **Avg Latency**: Should be under 15,000 ms (15 seconds)
- ✅ **P95 Latency**: Should be under 20,000 ms (20 seconds)
- ✅ **Success Rate**: Should exceed 70%

## Sample Output

```
======================================================================
  Sequential Token Transfers
======================================================================
  Total Transactions:      50
  Successful:              48
  Failed:                  2
  Total Duration:          45234.56 ms
  Throughput:              1.06 tx/sec
----------------------------------------------------------------------
  Avg Latency:             942.39 ms
  Min Latency:             721.45 ms
  Max Latency:             2105.67 ms
  P50 Latency (Median):    891.23 ms
  P95 Latency:             1456.78 ms
  P99 Latency:             1890.12 ms
======================================================================

📊 Performance Criteria:
  ✓ Throughput: 1.06 tx/sec (PASS)
  ✓ Avg Latency: 942.39 ms (PASS)
  ✓ P95 Latency: 1456.78 ms (PASS)
  ✓ Success Rate: 96.00% (PASS)
```

## Interpreting Results

### Good Performance Indicators

- **Low P95/P99 latency**: Consistent performance
- **High throughput**: Efficient transaction processing
- **Low failure rate**: Stable system
- **Tight latency distribution**: Predictable behavior

### Red Flags

- **High P99 latency**: Occasional slowdowns
- **Low throughput**: Processing bottlenecks
- **High failure rate**: System instability
- **Wide latency distribution**: Unpredictable performance

## Optimization Tips

### If Latency is High

1. **Check RPC connection**: Use local validator, not devnet/testnet
2. **Reduce transaction complexity**: Simplify program logic
3. **Optimize compute units**: Review instruction efficiency
4. **Check network conditions**: Ensure stable connectivity

### If Throughput is Low

1. **Increase batch size**: More parallel transactions
2. **Reduce transaction size**: Smaller data payloads
3. **Optimize account lookups**: Minimize PDA derivations
4. **Check validator resources**: CPU, memory, disk I/O

### If Failure Rate is High

1. **Check account state**: Ensure proper initialization
2. **Review error logs**: Identify common failure patterns
3. **Increase retry logic**: Handle transient failures
4. **Verify transaction parameters**: Check for invalid inputs

## Advanced Usage

### Custom Test Parameters

Edit `performance-benchmark.test.ts` to adjust:

```typescript
// Change iteration count
const iterations = 100; // Default: varies by test

// Modify batch size
const batchSize = 20; // Default: varies by test

// Adjust transfer amounts
const transferAmount = BigInt(5_000_000); // Default: varies by test
```

### Export Results to CSV

Add this helper function to export metrics:

```typescript
function exportToCSV(metrics: PerformanceMetrics, filename: string) {
  const fs = require('fs');
  const csv = `Metric,Value\n` +
    `Total Transactions,${metrics.totalTransactions}\n` +
    `Successful,${metrics.successfulTransactions}\n` +
    `Failed,${metrics.failedTransactions}\n` +
    `Throughput,${metrics.throughput.toFixed(2)}\n` +
    `Avg Latency,${metrics.avgLatency.toFixed(2)}\n` +
    `P50 Latency,${metrics.p50Latency.toFixed(2)}\n` +
    `P95 Latency,${metrics.p95Latency.toFixed(2)}\n` +
    `P99 Latency,${metrics.p99Latency.toFixed(2)}\n`;
  
  fs.writeFileSync(filename, csv);
}
```

## Troubleshooting

### Test Timeout Errors

If tests timeout, increase timeout values:

```typescript
this.timeout(600000); // Increase to 10 minutes
```

### "Account Not Found" Errors

Ensure programs are properly deployed:

```bash
cd anchor
anchor build
anchor deploy --provider.cluster localnet
```

### Connection Refused Errors

Verify localnet is running:

```bash
# Check if validator is running
solana cluster-version --url http://localhost:8899

# Restart if needed
cd anchor
anchor localnet
```

## CI/CD Integration

For automated performance monitoring:

```yaml
# .github/workflows/performance-test.yml
name: Performance Tests
on: [push, pull_request]

jobs:
  performance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Setup Solana
        run: |
          sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      - name: Install Dependencies
        run: pnpm install
      - name: Start Validator
        run: cd anchor && anchor localnet &
      - name: Run Performance Tests
        run: cd anchor && anchor test --skip-local-validator tests/performance-benchmark.test.ts --grep "Sequential"
```

## Best Practices

1. **Run on consistent hardware**: Performance varies by machine
2. **Close other applications**: Minimize resource contention
3. **Use local validator**: Avoid network variability
4. **Run multiple times**: Average results for consistency
5. **Document environment**: Record hardware specs with results
6. **Compare over time**: Track performance trends
7. **Set baselines**: Establish acceptable performance thresholds

## Support

For issues or questions:
- Check validator logs: `anchor/test-ledger/validator.log`
- Review program logs: `anchor/.anchor/program-logs/`
- Consult Anchor docs: https://www.anchor-lang.com/
- GridTokenX docs: `docs/technical/`

---

**Next Steps**: After running performance tests, review results and optimize bottlenecks identified in the metrics reports.
