# GridTokenX Performance Analysis Guide

This document describes the performance analysis methodology and tools for the GridTokenX blockchain research platform.

## Overview

The GridTokenX platform includes comprehensive performance benchmarking tools designed for academic research on blockchain-based energy trading systems.

## Quick Start

```bash
# Run full performance analysis
pnpm performance:analysis

# View generated report
open test-results/performance-analysis/reports/performance-report.html
```

## Test Environment

### Supported Environments

| Environment | Description | Use Case |
|------------|-------------|----------|
| **LiteSVM** | In-process VM, no network overhead | Baseline performance |
| **Local Validator** | Single node validator | Network overhead measurement |
| **Devnet** | Public test network | Real-world conditions |
| **AWS ECS** | Cloud deployment | Production simulation |

### Hardware Requirements

| Metric | Minimum | Recommended |
|--------|---------|-------------|
| CPU | 2 cores | 4+ cores |
| RAM | 4GB | 8GB+ |
| Storage | 20GB SSD | 50GB SSD |

## Benchmarks

### 1. Throughput Benchmark

Measures transactions per second (TPS) under various conditions.

```bash
pnpm benchmark:throughput
```

**Metrics Collected:**
- Average TPS
- Peak TPS
- Success rate
- Total transactions processed

### 2. Latency Benchmark

Measures end-to-end transaction latency with percentile distributions.

```bash
pnpm benchmark:latency
```

**Metrics Collected:**
- Average latency (ms)
- P50, P75, P90, P95, P99 latencies
- Min/Max latency

### 3. Concurrent Users Benchmark

Tests system behavior under concurrent load.

```bash
pnpm benchmark:concurrent
```

**Metrics Collected:**
- Max concurrent users supported
- Response time under load
- Error rate
- Contention events

### 4. Real-World Scenario Benchmark

Simulates actual energy trading patterns.

```bash
pnpm benchmark:realworld
```

**Scenarios:**
- P2P energy trades
- Token minting from meters
- Order matching
- Multi-user trading sessions

## Output Formats

### JSON Report
```
test-results/performance-analysis/reports/analysis-report.json
```

### CSV Data (for statistical analysis)
```
test-results/performance-analysis/reports/performance-data.csv
```

### HTML Report (visual)
```
test-results/performance-analysis/reports/performance-report.html
```

## Data Schema

```json
{
  "metadata": {
    "version": "1.0.0",
    "timestamp": "ISO-8601",
    "environment": "LiteSVM|LocalValidator|Devnet",
    "solanaVersion": "x.x.x",
    "anchorVersion": "x.x.x"
  },
  "summary": {
    "totalTests": 5,
    "passedTests": 5,
    "failedTests": 0,
    "totalDuration": 120000
  },
  "benchmarks": [
    {
      "name": "Throughput Benchmark",
      "metrics": {
        "throughput": {
          "avgTps": 250,
          "peakTps": 500,
          "successRate": 99.5
        },
        "latency": {
          "p50Ms": 12,
          "p95Ms": 45,
          "p99Ms": 120
        }
      }
    }
  ]
}
```

## Comparison Baselines

| Metric | GridTokenX | Native SOL Transfer | Theoretical Max |
|--------|------------|---------------------|-----------------|
| TPS | ~250-500 | ~1000 | ~65,000 |
| P99 Latency | <100ms | <50ms | - |
| Success Rate | >99% | >99.9% | 100% |

## Research Methodology

### Statistical Requirements

- **Sample Size**: Minimum 1000 transactions per test
- **Warm-up Period**: First 10% of measurements discarded
- **Outlier Handling**: >3σ from mean reported separately
- **Confidence Intervals**: 95% CI reported for all metrics

### Reproducibility

All tests are deterministic when using LiteSVM. For validator tests:
1. Reset validator state before each run
2. Use consistent wallet funding
3. Execute tests in isolated environment

## Troubleshooting

### Common Issues

**Low TPS Results**
- Ensure no other processes competing for CPU
- Check network connectivity for validator tests
- Increase Solana compute budget if needed

**High Latency**
- Restart local validator
- Check for account contention
- Reduce concurrent operations

## References

- [Solana Performance Guidelines](https://docs.solana.com/developing/programming-model/performance)
- [Anchor Framework Documentation](https://www.anchor-lang.com/)
