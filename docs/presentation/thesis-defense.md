---
marp: true
theme: default
paginate: true
backgroundColor: #1a1a2e
color: #eee
---

# GridTokenX
## Blockchain Performance Analysis for P2P Energy Trading

**Master's Thesis Defense**

*December 2024*

---

# Research Motivation

- Renewable energy adoption accelerating
- Prosumers need peer-to-peer trading capability
- Blockchain provides decentralized trust
- **Challenge**: Can blockchain meet performance requirements?

---

# Research Questions

1. Can blockchain achieve **production-level** performance for energy trading?
2. What is the **Trust Premium** (cost of decentralization)?
3. How does GridTokenX compare to **existing platforms**?

---

# Methodology

## BLOCKBENCH + TPC Benchmark Suite

| Layer | Benchmark | Purpose |
|-------|-----------|---------|
| Consensus | DoNothing | Measure pure consensus overhead |
| Execution | CPUHeavy | Smart contract computation |
| Data Model | IOHeavy | State read/write operations |
| Application | TPC-C/E/H, Smallbank, YCSB | Real workloads |

---

# Platform Architecture

## GridTokenX Technology Stack

- **Blockchain**: Solana-based
- **Consensus**: Proof of Authority (PoA)
- **Framework**: Anchor 0.32.1
- **Smart Contracts**: 5 programs + BLOCKBENCH
- **Testing**: LiteSVM in-process simulator

---

# BLOCKBENCH Micro-benchmark Results

## Layer-by-Layer Analysis

| Layer | Benchmark | TPS | Latency |
|-------|-----------|-----|---------|
| Consensus | DoNothing | 225 | 2.5ms |
| Execution | CPUHeavy | 231 | 2.5ms |
| Data Model | IOHeavy-Write | 192 | 3.0ms |
| Data Model | IOHeavy-Mixed | 192 | 3.0ms |

---

# YCSB Workload Results

## Application Layer Performance

| Workload | Profile | ops/s | Latency |
|----------|---------|-------|---------|
| YCSB-A | 50% read, 50% update | 290 | 2.7ms |
| YCSB-B | 95% read, 5% update | 442 | 1.8ms |
| YCSB-C | 100% read | 391 | 2.1ms |

**Smallbank OLTP**: 1,714 TPS @ 5.8ms

---

# TPC Benchmark Results

## Industry-Standard Performance Metrics

| Benchmark | Primary Metric | Latency | p99 |
|-----------|---------------|---------|-----|
| **TPC-C** | 2,111 tpmC | 117ms | 216ms |
| **TPC-E** | 306 tpsE | 7.9ms | 17ms |
| **TPC-H** | 250,486 QphH | 71ms | 147ms |

---

# Comparative Analysis

## Platform Comparison

| Platform | Smallbank TPS | Latency | Trust Premium |
|----------|---------------|---------|---------------|
| **GridTokenX** | 1,714 | 5.8ms | 58x |
| Hyperledger Fabric | 400 | 150ms | 175x |
| Ethereum | 30 | 12,000ms | 6,000x |
| PostgreSQL | 5,000 | 2ms | 1x |

---

# Trust Premium Analysis

> **Trust Premium** = Blockchain Latency / Centralized Baseline Latency

- GridTokenX TPC-C: **58.28x** (117ms vs 2ms baseline)
- Hyperledger Fabric: 175x
- Ethereum: 6,000x

**GridTokenX achieves ~3x better Trust Premium than Hyperledger**

---

# Scalability Results

## Concurrency & Duration Tests

| Test | Result | Stability |
|------|--------|-----------|
| Peak TPS (1 thread) | 443 TPS | 100% |
| 32 concurrent threads | 398 TPS | 90% retained |
| 60-second sustained | 416 TPS | Stable |
| 1,000 accounts | 220 TPS | Linear degradation |

---

# Key Contributions

1. **BLOCKBENCH Layer Analysis** for Solana/Anchor
2. **TPC-C/E/H Adaptation** for blockchain
3. **Trust Premium Quantification**: 58x vs 175x (Fabric)
4. **Scalability Validation**: Stable under load

---

# Limitations

- LiteSVM simulation (not network)
- Single-validator PoA configuration
- No real smart meter integration
- Limited geographic distribution

---

# Future Work

- Multi-validator PoA cluster deployment
- Real network latency measurements
- Smart meter IoT integration
- Zero-knowledge privacy extensions

---

# Conclusion

- GridTokenX achieves **2,111 tpmC** TPC-C
- **1,714 TPS** Smallbank throughput
- **Trust Premium of 58x** vs PostgreSQL baseline
- **Stable performance** under concurrency

**Blockchain is viable for P2P energy trading**

---

# Thank You

## Questions?

📊 Benchmark Data: `test-results/`
📈 Charts: `test-results/charts/`
📄 Full Results: `docs/thesis/chapter4-results.tex`

---
