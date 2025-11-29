# GridTokenX Performance Testing Guide

## Introduction

This guide explains how to test the performance of transactions on the Solana blockchain for the GridTokenX project, focusing on measuring throughput (TPS) and latency of token transfer transactions.

---

## Performance Testing Components

### 1. Throughput

- **Definition**: Number of transactions that can be processed within a given time period (Transactions Per Second - TPS)
- **Measurement**: Count successful transactions within the test period
- **Target**: Maximize TPS without affecting system stability

### 2. Latency

- **Definition**: Time required to process and confirm a transaction (Transaction Latency)
- **Measurement**: Measure time from transaction submission to confirmation
- **Target**: Minimize latency as much as possible

---

## Using the Performance Test Script

### Basic Command

```bash
ts-node scripts/loop-transfer-test.ts <iterations> <amount> [delay]
```

### Parameters

- `iterations`: Number of token transfers to execute (Required)
- `amount`: Amount of GRX to transfer per transaction (Required)
- `delay`: Delay between transactions in ms (Optional, default: 100ms)

### Usage Examples

#### Basic Test

```bash
# Test 10 iterations, transfer 0.5 GRX per transaction, 500ms delay
ts-node scripts/loop-transfer-test.ts 10 0.5 500
```

#### Medium Load Test

```bash
# Test 50 iterations, transfer 1 GRX per transaction, 200ms delay
ts-node scripts/loop-transfer-test.ts 50 1 200
```

#### High Load Test

```bash
# Test 100 iterations, transfer 0.5 GRX per transaction, 100ms delay
ts-node scripts/loop-transfer-test.ts 100 0.5 100
```

#### Stress Test

```bash
# Test 500 iterations, transfer 0.1 GRX per transaction, 50ms delay
ts-node scripts/loop-transfer-test.ts 500 0.1 50
```

---

## Test Results

### Output Information

- **Transaction Summary**: Total, successful, and failed transaction counts
- **Performance Metrics**:
  - Total Time: Total test duration
  - Average Latency: Mean latency in milliseconds
  - Min/Max Latency: Minimum and maximum latency values
  - Throughput: Processing rate (TPS)
- **Error Details**: Error information (if any)
- **Balance Verification**: Pre and post-test balance verification

### Performance Evaluation

The script evaluates and provides feedback on performance:

#### Throughput Evaluation

| Rating    | TPS       |
|-----------|-----------|
| Excellent | >5 TPS    |
| Moderate  | 2-5 TPS   |
| Low       | <2 TPS    |

#### Latency Evaluation

| Rating    | Latency    |
|-----------|------------|
| Excellent | <500 ms    |
| Moderate  | 500-1000 ms|
| High      | >1000 ms   |

---

## Test Preparation

### Prerequisites

1. Solana validator running
2. Token mint created
3. Two wallets with tokens
4. Token transfer permissions

### Setup Commands

```bash
# Create token if not exists
ANCHOR_WALLET=./wallet-2-keypair.json pnpm run token:create

# Setup for loop transfer test
ANCHOR_WALLET=./wallet-2-keypair.json pnpm run setup:loop-test

# Check total supply
pnpm run token:total-supply
```

---

## Troubleshooting

### Common Issues

#### 1. Transaction Failures

- **Cause**: Insufficient balance or connection issues
- **Solution**: Check balance and validator status

```bash
# Check wallet balance
solana balance ./wallet-1-keypair.json

# Check validator status
solana cluster-version
```

#### 2. High Latency

- **Cause**: Network congestion or slow validator
- **Solution**: Increase delay between transactions or reduce concurrent transactions

#### 3. Low Throughput

- **Cause**: Network conditions or unsuitable configuration
- **Solution**: Adjust configuration or check hardware resources

### Optimization Tips

#### Increasing Throughput

1. Reduce delay between transactions
2. Increase concurrent transactions (if possible)
3. Use endpoints closer to the validator

#### Reducing Latency

1. Use faster connections (WebSocket if possible)
2. Reduce transaction size
3. Use priority fees for faster processing

---

## Saving Results

The script automatically saves test results to a JSON file:

```
performance-results-[timestamp].json
```

This file contains:

- Complete performance summary
- Latency details for each transaction
- Errors (if any)
- Test duration

Use this file to compare performance across different test runs.

---

## Automated Testing

### Automated Test Script

```bash
#!/bin/bash
# automated-performance-test.sh

echo "=== GridTokenX Automated Performance Testing ==="

# Test 1: Basic Performance
echo "Running Basic Performance Test..."
pnpm run test:loop-transfer-quick

# Test 2: Medium Load
echo "Running Medium Load Test..."
pnpm run test:loop-transfer

# Test 3: Stress Test
echo "Running Stress Test..."
pnpm run test:loop-transfer-stress

echo "=== Performance Testing Complete ==="
```

### Scheduled Testing

Use cron jobs for scheduled performance testing:

```bash
# Run performance tests daily at 2 AM
0 2 * * * /path/to/gridtokenx-anchor/scripts/automated-performance-test.sh >> /path/to/logs/performance.log
```

---

## Result Interpretation

### Comparing Results

| Test   | Iterations | Amount  | Delay | TPS  | Avg Latency | Status    |
|--------|------------|---------|-------|------|-------------|-----------|
| Test 1 | 10         | 0.5 GRX | 500ms | 8.5  | 450ms       | Excellent |
| Test 2 | 50         | 1.0 GRX | 200ms | 12.3 | 380ms       | Excellent |
| Test 3 | 100        | 0.5 GRX | 100ms | 15.7 | 520ms       | Moderate  |

### Trend Analysis

- Monitor latency changes over time
- Analyze factors affecting performance
- Check system stability during extended tests

---

## Conclusion

Performance testing is a critical part of developing and improving the GridTokenX project. Regular performance measurement ensures the system operates as expected and can handle real-world usage.

**Recommendations:**

- Test in different environments
- Record test results for comparison
- Use test data to tune the system
- Set appropriate performance targets for your system requirements

---

## Document Navigation

| Previous | Current | Next |
|----------|---------|------|
| [Testing Guide](./testing.md) | **Performance Testing** | [Deployment Guide](./deployment.md) |

---

**Document Version**: 1.0  
**Last Updated**: November 2024  
**Status**: Complete
