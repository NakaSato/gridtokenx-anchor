# GridTokenX Performance Benchmark Results

## Executive Summary

- **Test Environment**: LiteSVM (In-Process Solana VM)
- **Timestamp**: 2025-12-16T16:46:59.189Z
- **Platform**: darwin

## Latency Under Load Analysis

| Concurrent Users | Avg Latency (ms) | p50 (ms) | p95 (ms) | p99 (ms) |
|------------------|------------------|----------|----------|----------|
| 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| 25 | 0.00 | 0.00 | 0.00 | 0.00 |
| 50 | 1.92 | 1.90 | 2.06 | 2.15 |
| 100 | 2.19 | 1.92 | 4.00 | 6.14 |
| 200 | 2.26 | 1.94 | 3.11 | 5.89 |

## Concurrent User Simulation Results

| Scenario | Users | Total Tx | Effective TPS | Avg Latency | p99 Latency | Success Rate |
|----------|-------|----------|---------------|-------------|-------------|--------------|
| low_load | 10 | 500 | 8.9 | 5.78ms | 9.34ms | 2.0% |
| medium_load | 50 | 1500 | 19.8 | 6.43ms | 11.74ms | 3.3% |
| high_load | 100 | 2000 | 34.7 | 6.43ms | 9.34ms | 5.0% |
| stress_test | 200 | 3000 | 158.3 | 2.45ms | 4.01ms | 6.7% |
| burst_load | 150 | 1500 | 258.8 | 2.06ms | 3.97ms | 10.0% |

## Scalability Analysis

| Users | Throughput (TPS) | Avg Latency (ms) | p99 Latency (ms) |
|-------|------------------|------------------|------------------|
| 5 | 517 | 2.87 | 6.58 |
| 10 | 530 | 1.91 | 1.98 |
| 25 | 518 | 1.91 | 2.14 |
| 50 | 513 | 1.95 | 2.95 |
| 75 | 444 | 2.24 | 5.27 |
| 100 | 454 | 2.20 | 5.90 |
| 150 | 492 | 2.03 | 3.03 |
| 200 | 479 | 2.08 | 3.87 |

## Key Findings

1. **Peak Throughput**: 530 TPS
2. **Average Latency**: 2.15ms across all load levels
3. **Minimum Latency**: 0.00ms (low load conditions)

## Methodology

- Tests were conducted using LiteSVM, an in-process Solana Virtual Machine
- Each test iteration includes transaction creation, signing, and execution
- Latency measurements use high-resolution performance timers
- Statistical analysis includes percentile calculations (p50, p95, p99)
