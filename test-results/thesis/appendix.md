# GridTokenX Benchmark Appendix

## Results Summary

| Benchmark | Metric | Value | p50 (ms) | p99 (ms) | Success % |
|-----------|--------|-------|----------|----------|-----------|
| TPC-C | tpmC | 21,378 | 11 | 20 | 99.9 |
| Smallbank | TPS | 1,741 | 6 | 10 | 99.8 |
| TPC-E | tpsE | 307 | 8 | 17 | 97.0 |
| TPC-H | QphH | 254,930 | 65 | 145 | 99.0 |

## Comparative Analysis

| Platform | Benchmark | TPS | Latency (ms) | Source |
|----------|-----------|-----|--------------|--------|
| GridTokenX | TPC-C | 356 | 11.34 | This Study |
| GridTokenX | Smallbank | 1,741 | 5.72 | This Study |
| Hyperledger Fabric 2.2 | TPC-C | 200 | 350 | TPCTC 2023 |
| Ethereum (PoS) | Transfer | 30 | 12,000 | Etherscan |
| PostgreSQL 15 | TPC-C | 5,000 | 2 | TPC.org |

## Trust Premium

**GridTokenX vs PostgreSQL**: 5.67x latency multiplier

This represents the "cost of decentralization" - the performance overhead 
for Byzantine fault tolerance, cryptographic verification, and consensus.

## Reproducibility

```bash
pnpm install
anchor build
pnpm performance:research
pnpm export:csv
```
