# Quick Start: Performance Testing

## TL;DR - Run Performance Tests Now

```bash
# Terminal 1: Start validator
cd anchor && anchor localnet

# Terminal 2: Run performance tests (choose one)
make test-anchor-perf              # All tests (~30 min)
make test-anchor-perf-quick        # Quick test (~5 min)
make test-anchor-perf-stress       # Stress test (~15 min)
```

## Test Commands

### Using Makefile (Recommended)

```bash
# Full performance suite
make test-anchor-perf

# Quick performance check (sequential only)
make test-anchor-perf-quick

# High-volume stress test
make test-anchor-perf-stress
```

### Using Script Directly

```bash
cd anchor

# All performance tests
./tests/run-performance-test.sh

# Specific test suites
./tests/run-performance-test.sh --suite sequential
./tests/run-performance-test.sh --suite batch
./tests/run-performance-test.sh --suite sustained
./tests/run-performance-test.sh --suite stress
./tests/run-performance-test.sh --suite distribution

# Custom output directory
./tests/run-performance-test.sh --output ./my-results
```

### Using Anchor Directly

```bash
cd anchor

# All performance tests
anchor test --skip-local-validator tests/performance-benchmark.test.ts

# Specific test pattern
anchor test --skip-local-validator tests/performance-benchmark.test.ts --grep "Sequential"
anchor test --skip-local-validator tests/performance-benchmark.test.ts --grep "Batch"
anchor test --skip-local-validator tests/performance-benchmark.test.ts --grep "Sustained"
anchor test --skip-local-validator tests/performance-benchmark.test.ts --grep "Stress"
```

## What Gets Tested

### 1. Sequential Tests (~5 minutes)
- 50 token transfers
- 30 order placements  
- 20 REC validator additions
- **Measures**: Individual transaction latency

### 2. Batch Tests (~10 minutes)
- 100 transfers in batches of 10
- 60 orders in batches of 5
- **Measures**: Parallel transaction throughput

### 3. Sustained Load (~15 minutes)
- 200 mixed transactions
- **Measures**: System stability under diverse load

### 4. Stress Test (~30 minutes)
- 500 rapid token burns
- **Measures**: Maximum throughput and failure points

### 5. Latency Analysis (~10 minutes)
- 100 transfers with distribution analysis
- **Measures**: P50, P95, P99 latency percentiles

## Understanding Results

### Sample Output

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
```

### Key Metrics

- **Throughput**: Transactions per second (higher is better)
- **Avg Latency**: Average transaction time (lower is better)
- **P95/P99 Latency**: 95th/99th percentile latency (consistency indicator)
- **Success Rate**: Percentage of successful transactions (higher is better)

### Performance Targets

✅ **Good Performance**:
- Throughput > 1.0 tx/sec
- Avg Latency < 2 seconds
- P95 Latency < 3 seconds
- Success Rate > 95%

⚠️ **Acceptable Performance**:
- Throughput > 0.5 tx/sec
- Avg Latency < 5 seconds
- P95 Latency < 10 seconds
- Success Rate > 80%

❌ **Poor Performance**:
- Throughput < 0.5 tx/sec
- Avg Latency > 10 seconds
- P95 Latency > 20 seconds
- Success Rate < 70%

## Test Results Location

Results are saved to `anchor/test-results/`:

```
anchor/test-results/
├── performance_all_20250116_143022.log
├── performance_sequential_20250116_145533.log
├── performance_stress_20250116_150012.log
└── ...
```

## Troubleshooting

### Validator Not Running

```bash
# Error: Connection refused
# Solution: Start validator
cd anchor && anchor localnet
```

### Tests Timeout

```bash
# Error: Test timeout
# Solution: Increase timeout in test file or skip slower tests
./tests/run-performance-test.sh --suite sequential  # Faster
```

### High Latency

```bash
# Causes:
# - RPC connection issues (use local validator)
# - System resource contention (close other apps)
# - Network instability (check connectivity)
```

### Low Throughput

```bash
# Causes:
# - Sequential execution (use batch tests)
# - Transaction complexity (optimize program logic)
# - Account contention (parallelize better)
```

## Advanced Usage

### Customize Test Parameters

Edit `anchor/tests/performance-benchmark.test.ts`:

```typescript
// Line ~84: Change iteration counts
const iterations = 100; // Increase for more samples

// Line ~207: Change batch sizes
const batchSize = 20; // Increase for more parallelism

// Line ~89: Change transfer amounts
const transferAmount = BigInt(10_000_000); // Adjust test data
```

### Run Multiple Times for Average

```bash
# Run 5 times and average results
for i in {1..5}; do
  echo "Run $i of 5"
  make test-anchor-perf-quick
  sleep 10
done
```

### Monitor System Resources

```bash
# Terminal 3: Watch system resources during test
watch -n 1 "ps aux | grep solana-test-validator | grep -v grep"
```

## Next Steps

1. **Run Quick Test**: `make test-anchor-perf-quick` (5 minutes)
2. **Review Results**: Check `anchor/test-results/` for logs
3. **Analyze Metrics**: Look at throughput and latency percentiles
4. **Optimize**: If performance is poor, review program logic
5. **Full Suite**: Run `make test-anchor-perf` for comprehensive benchmarks

## Documentation

- **Full Guide**: `anchor/tests/PERFORMANCE_TESTING.md`
- **Test File**: `anchor/tests/performance-benchmark.test.ts`
- **Script**: `anchor/tests/run-performance-test.sh`

## Examples

### Morning Coffee Test (5 min)
```bash
make test-anchor-perf-quick
```

### Pre-PR Check (15 min)
```bash
make test-anchor-perf-stress
```

### Weekly Benchmark (30 min)
```bash
make test-anchor-perf
```

---

**Happy Testing! 🚀**
