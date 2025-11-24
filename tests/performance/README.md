# GridTokenX Architecture Performance Test Suite

This comprehensive test suite analyzes the performance of the GridTokenX energy trading platform, focusing on throughput and transaction latency across all architectural components.

## Overview

The GridTokenX platform consists of five main smart contract programs:
- **Energy Token** - SPL token for energy credits
- **Trading** - Peer-to-peer energy marketplace
- **Registry** - User and asset registration
- **Oracle** - Price feeds and data verification
- **Governance** - Protocol decision-making

The performance test suite evaluates these components through multiple testing scenarios, measuring:
- Transaction throughput (TPS)
- Latency (min/max/average/percentiles)
- Error rates and reliability
- Computational resource usage
- Account management efficiency
- Cross-program interaction overhead

## Test Architecture

### Test Structure

```
tests/performance/
├── utils/                          # Utility modules
│   ├── metrics-collector.ts         # Performance metrics collection
│   └── transaction-runner.ts        # Transaction execution framework
├── architecture/                    # Architecture-focused tests
│   ├── energy-trading-performance.test.ts
│   ├── architecture-analysis.test.ts
│   └── run-performance-tests.ts     # Test runner script
├── reports/                         # Test output directory
└── README.md                        # This file
```

### Key Components

#### Metrics Collection (`metrics-collector.ts`)

A comprehensive utility for collecting and analyzing performance metrics:

```typescript
// Collects performance data across multiple dimensions
interface PerformanceMetrics {
  totalTransactions: number;
  successfulTransactions: number;
  failedTransactions: number;
  totalDuration: number;
  throughput: number;
  latencies: number[];
  avgLatency: number;
  minLatency: number;
  maxLatency: number;
  p50Latency: number;      // Median
  p95Latency: number;
  p99Latency: number;
  errorRate: number;
  errors: string[];
  transactionTypes: Record<string, number>;
  avgComputeUnits: number;
  avgAccountSizeChange: number;
  timestamp: string;
}
```

#### Transaction Runner (`transaction-runner.ts`)

Executes transactions and measures detailed performance:

```typescript
// Result from a single transaction
interface TransactionResult {
  success: boolean;
  signature: string;
  latency: number;
  computeUnitsUsed: number;
  accountSizeChange: number;
  transactionType: string;
  error: Error | null;
}
```

## Test Suites

### 1. Energy Trading Performance Tests

Focuses on core trading operations:

- **Sequential Token Transfers**: Measures latency for individual transfers
- **Parallel Token Transfers**: Evaluates throughput with concurrent transfers
- **Order Placement**: Tests performance of buy/sell order creation
- **Order Matching**: Measures efficiency of order matching operations
- **Mixed Workload**: Simulates real-world transaction patterns
- **Sustained Load**: Tests performance under extended load

### 2. Architecture Analysis Tests

Examines system-wide performance characteristics:

- **Program Interaction**: Analyzes overhead from cross-program calls
- **Account Management**: Tests efficiency of account operations
- **Resource Utilization**: Measures compute unit and memory usage
- **Linear Scalability**: Evaluates performance scaling with transaction volume
- **Stress Testing**: Tests system limits under extreme load
- **Benchmark Scoring**: Generates comprehensive performance scores

## Usage

### Prerequisites

1. Ensure Solana validator is running:
   ```bash
   solana-test-validator --reset
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Build programs:
   ```bash
   anchor build
   ```

### Running Tests

#### Quick Start

Run all performance tests with default settings:
```bash
pnpm run test:performance
```

#### Advanced Usage

Use the test runner script for more control:
```bash
# Run all tests
ts-node tests/performance/architecture/run-performance-tests.ts

# Run specific test suite
ts-node tests/performance/architecture/run-performance-tests.ts --test-suite=energy-trading

# Run with verbose output
ts-node tests/performance/architecture/run-performance-tests.ts --verbose

# Save detailed JSON reports
ts-node tests/performance/architecture/run-performance-tests.ts --save-json

# Run tests sequentially (default: parallel)
ts-node tests/performance/architecture/run-performance-tests.ts --sequential

# Custom report path
ts-node tests/performance/architecture/run-performance-tests.ts --report-path=./my-reports
```

#### Individual Test Suites

Run specific test suites directly with Mocha:
```bash
# Energy trading tests
npx ts-mocha -p ./tsconfig.json -t 600000 tests/performance/architecture/energy-trading-performance.test.ts

# Architecture analysis tests
npx ts-mocha -p ./tsconfig.json -t 600000 tests/performance/architecture/architecture-analysis.test.ts
```

## Performance Reports

### Report Formats

Tests generate two types of reports:

1. **Console Output**: Formatted results with performance evaluation
2. **JSON Reports**: Detailed metrics for further analysis

### Key Metrics

#### Throughput
- Measured in Transactions Per Second (TPS)
- Evaluates processing capacity
- Target: >50 TPS for excellent performance

#### Latency
- Measured in milliseconds (ms)
- Includes min/max/average/percentile values
- Target: <500ms average for excellent performance

#### Reliability
- Measured as error rate percentage
- Evaluates system stability
- Target: <1% error rate for excellent performance

#### Resource Efficiency
- Compute units per transaction
- Account size changes
- Memory usage patterns

### Sample Report

```
======================================================================
  Energy Trading Performance
======================================================================

--- Transaction Summary ---
  Total Transactions:        50
  Successful:               45 (90.00%)
  Failed:                   5 (10.00%)

--- Performance Metrics ---
  Total Duration:           12500.00 seconds
  Throughput:               3.60 TPS
  Error Rate:               10.00%

--- Latency Analysis ---
  Average:                  1250.50 ms
  Min:                      450 ms
  Max:                      3200 ms
  P50 (Median):             1200 ms
  P95:                      2100 ms
  P99:                      2900 ms

--- Performance Evaluation ---
  ✓ Excellent throughput: 3.60 TPS
  ⚠ Moderate latency: 1250.50 ms average
  ⚠ Moderate reliability: 10.00% error rate
======================================================================
```

## Performance Optimization Recommendations

### Based on Test Results

#### High Latency
1. **Instruction Optimization**
   - Reduce account reads/writes
   - Batch operations where possible
   - Minimize cross-program calls

2. **Compute Optimization**
   - Profile compute unit usage
   - Optimize validation logic
   - Use efficient data structures

#### Low Throughput
1. **Transaction Batching**
   - Combine multiple operations
   - Implement efficient batching
   - Optimize transaction size

2. **Parallel Processing**
   - Process independent transactions concurrently
   - Implement proper connection pooling
   - Use appropriate confirmation strategies

#### High Error Rate
1. **Error Handling**
   - Implement retry logic
   - Add proper validation
   - Handle network issues gracefully

2. **Account Management**
   - Pre-create accounts where possible
   - Optimize account layouts
   - Reduce account contention

### Architecture-Specific Optimizations

#### Token Transfers
- Use memo programs for off-chain metadata
- Implement efficient token wrapping
- Optimize for high-frequency transfers

#### Order Matching
- Implement efficient order book data structures
- Use batch matching algorithms
- Optimize for market maker operations

#### Cross-Program Calls
- Minimize unnecessary calls
- Cache frequently accessed data
- Use efficient serialization

## Benchmark Scoring

The test suite generates comprehensive benchmark scores:

```typescript
interface BenchmarkScore {
  overall: number;          // 0-100
  throughput: number;       // 0-100
  latency: number;          // 0-100
  reliability: number;      // 0-100
  grade: 'A' | 'B' | 'C' | 'D';
}
```

### Scoring Criteria

- **Grade A** (80-100): Excellent performance
- **Grade B** (60-79): Good performance with minor issues
- **Grade C** (40-59): Moderate performance requiring optimization
- **Grade D** (0-39): Poor performance requiring significant improvements

## Continuous Integration

### Automated Testing

To integrate performance testing in CI/CD:

1. Add to CI pipeline:
   ```yaml
   - name: Performance Tests
     run: |
       solana-test-validator &
       ts-node tests/performance/architecture/run-performance-tests.ts --benchmark-only
   ```

2. Configure thresholds:
   - Minimum throughput: 10 TPS
   - Maximum latency: 2000ms
   - Maximum error rate: 5%

3. Performance regression detection:
   - Compare with baseline metrics
   - Alert on significant degradation
   - Track performance trends over time

## Troubleshooting

### Common Issues

#### Test Failures
1. **Binding Issues**
   - Run `npm run rebuild` if encountering binding errors
   - Ensure Solana CLI is properly installed

2. **Account Creation Failures**
   - Check SOL balance in test wallets
   - Verify airdrop functionality
   - Ensure validator is running

3. **Transaction Timeouts**
   - Increase timeout values in test configuration
   - Check network connectivity
   - Verify validator responsiveness

#### Performance Issues
1. **High Latency**
   - Check validator resource usage
   - Verify sufficient compute units allocated
   - Optimize instruction complexity

2. **Low Throughput**
   - Reduce transaction delays
   - Implement proper batching
   - Optimize parallelization

### Debug Mode

Enable debug mode for detailed logging:
```bash
RUST_LOG=debug ts-node tests/performance/architecture/run-performance-tests.ts --verbose
```

## Contributing

### Adding New Tests

1. Create new test files in appropriate directories
2. Follow the existing test patterns
3. Use the utilities in `utils/` for consistency
4. Update documentation

### Performance Regression Testing

1. Establish baseline metrics
2. Track changes over time
3. Set up automated alerts
4. Optimize based on findings

## References

- [Solana Performance Documentation](https://docs.solana.com/developing/programming-model/transactions#performance)
- [Anchor Framework](https://anchor-lang.com/)
- [Solana Transaction Fees](https://docs.solana.com/developing/programming-model/fees)
- [GridTokenX Architecture Documentation](../../README.md)