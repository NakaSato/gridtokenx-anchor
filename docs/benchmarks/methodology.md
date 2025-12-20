# Benchmark Methodology

GridTokenX performance evaluation follows TPC benchmark standards adapted for blockchain.

## TPC Adaptation

Following the "blockchainification" methodology from TPCTC conferences:

### TPC-C Mapping

| TPC-C Transaction | Frequency | GridTokenX Operation |
|-------------------|-----------|---------------------|
| New Order | 45% | Create Energy Order |
| Payment | 43% | Token Transfer |
| Order Status | 4% | Query Order |
| Delivery | 4% | Execute Trade |
| Stock Level | 4% | Balance Check |

## Benchmarks

### TPC-C (OLTP)

Standard OLTP workload simulating order processing.

```bash
pnpm benchmark:tpc-c
```

**Primary Metric**: tpmC (transactions per minute)

### Smallbank

Consensus stress testing with simple operations.

```bash
pnpm benchmark:smallbank
```

**Primary Metric**: TPS (transactions per second)

### TPC-E (Trading)

Financial trading simulation for DEX operations.

```bash
pnpm benchmark:tpc-e
```

**Primary Metric**: tpsE (trades per second)

### TPC-H (Analytics)

Decision support queries for analytics.

```bash
pnpm benchmark:tpc-h
```

**Primary Metric**: QphH (queries per hour)

## Statistical Methodology

### Warmup Period

Discard first 10% of measurements to allow system stabilization.

### Outlier Removal

Exclude samples > 3σ from mean to remove anomalies.

### Confidence Intervals

Report 95% confidence intervals for all metrics.

## Test Environment

| Component | Specification |
|-----------|---------------|
| Platform | Solana-based with PoA |
| Framework | Anchor 0.32.1 |
| Runtime | Agave 3.0.13 |
| Validator | LiteSVM / Local |

## Running Benchmarks

```bash
# Full suite
pnpm performance:research

# Generate charts
pnpm charts:generate

# Export CSV data
pnpm export:csv

# Generate thesis content
pnpm thesis:all
```
