# Benchmark Results

Performance evaluation results for GridTokenX platform.

## Summary

| Benchmark | Primary Metric | p99 Latency |
|-----------|----------------|-------------|
| **TPC-C** | 21,378 tpmC | 20ms |
| **Smallbank** | 1,741 TPS | 10ms |
| **TPC-E** | 307 tpsE | 17ms |
| **TPC-H** | 246,938 QphH | 147ms |

## TPC-C Results

### Primary Performance

| Metric | Value | Unit |
|--------|-------|------|
| tpmC | 21,378 | tx/min |
| TPS (equivalent) | 356 | tx/sec |
| Average Latency | 11.34 | ms |
| p50 Latency | 11 | ms |
| p95 Latency | 18 | ms |
| p99 Latency | 20 | ms |
| Success Rate | 99.9 | % |
| MVCC Conflict Rate | 1.5 | % |

### Transaction Mix

| Transaction Type | Count | Percentage | Target |
|-----------------|-------|------------|--------|
| CREATE_ORDER | 5,224 | 44.4% | 45% |
| TOKEN_TRANSFER | 5,112 | 43.5% | 43% |
| GET_ORDER_STATUS | 498 | 4.2% | 4% |
| EXECUTE_TRADE | 480 | 4.1% | 4% |
| CHECK_BALANCE | 450 | 3.8% | 4% |

## Smallbank Results

| Metric | Value | Unit |
|--------|-------|------|
| TPS | 1,741 | tx/sec |
| Average Latency | 5.72 | ms |
| p99 Latency | 10 | ms |
| Conflict Rate | 0.79 | % |

## TPC-E Results

| Metric | Value | Unit |
|--------|-------|------|
| tpsE | 307 | trades/sec |
| Trade Orders/sec | 381 | orders/sec |
| Average Latency | 7.89 | ms |
| p99 Latency | 17 | ms |

## TPC-H Results

| Metric | Value | Unit |
|--------|-------|------|
| QphH | 246,938 | queries/hr |
| Average Latency | 72.11 | ms |
| p99 Latency | 147 | ms |
| Throughput | 137.66 | MB/s |

## Scalability

| Concurrent Users | TPS | Latency | Efficiency |
|------------------|-----|---------|------------|
| 5 | 520 | 1.6ms | 100% |
| 10 | 535 | 1.7ms | 103% |
| 50 | 540 | 1.8ms | 104% |
| 100 | 545 | 1.8ms | 105% |
| 200 | 548 | 1.9ms | 105% |

## Trust Premium

| Platform | Latency | Trust Premium |
|----------|---------|---------------|
| PostgreSQL (baseline) | 2ms | 1x |
| **GridTokenX (PoA)** | 11.34ms | **5.67x** |
| Hyperledger Fabric | 350ms | 175x |
| Ethereum | 12,000ms | 6,000x |

::: tip Interpretation
A Trust Premium of 5.67x means GridTokenX is about 6x slower than a centralized database, but provides blockchain benefits (decentralization, immutability, transparency).
:::
