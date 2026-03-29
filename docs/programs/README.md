# GridTokenX Program Documentation

> **Comprehensive Technical Documentation for Solana-based Decentralized Energy Trading**

**Version:** 2.0.0
**Last Updated:** March 16, 2026

---

## Overview

This directory contains complete technical documentation for all GridTokenX Anchor programs. The documentation is organized into two tiers:

1. **Program Reference Docs** - API specifications, state architecture, and instruction references
2. **Deep Dive Docs** - Advanced technical analysis for developers, researchers, and auditors

---

## Documentation Index

### Core Programs

| Program | Description | Doc |
|---------|-------------|-----|
| **Trading** | Multi-modal energy marketplace (P2P, AMM, Batch) | [trading.md](./trading.md) |
| **Energy Token** | GRX token with PDA-controlled minting | [energy-token.md](./energy-token.md) |
| **Oracle** | Meter data ingestion and validation | [oracle.md](./oracle.md) |
| **Registry** | User and device identity management | [registry.md](./registry.md) |
| **Governance** | PoA authority and REC certification | [governance.md](./governance.md) |

### Benchmark Programs

| Program | Description | Doc |
|---------|-------------|-----|
| **BLOCKBENCH** | Micro-benchmarks and YCSB workloads | [blockbench.md](./blockbench.md) |
| **TPC-C** | Industry-standard OLTP benchmark | [tpc-benchmark.md](./tpc-benchmark.md) |

### Deep Dive Documentation

Advanced technical documentation with detailed algorithms, security analysis, and implementation guides:

| Document | Focus Area |
|----------|------------|
| [AMM & Bonding Curves](./deep-dive/amm-bonding-curves.md) | Mathematical foundations for energy-specific AMMs |
| [Periodic Auction System](./deep-dive/periodic-auction.md) | Batch clearing and uniform price discovery |
| [Confidential Trading](./deep-dive/confidential-trading.md) | ElGamal encryption and zero-knowledge proofs |
| [Carbon Credit System](./deep-dive/carbon-credits.md) | REC tokenization and carbon offset tracking |
| [Cross-Chain Bridge](./deep-dive/cross-chain-bridge.md) | Wormhole integration for multi-chain trading |
| [Oracle Security Model](./deep-dive/oracle-security.md) | Byzantine fault tolerance and data validation |
| [Settlement Architecture](./deep-dive/settlement-architecture.md) | Atomic settlement and payment finality |

---

## Architecture Overview

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                          GridTokenX Platform Architecture                      │
├───────────────────────────────────────────────────────────────────────────────┤
│                                                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │                          Trading Program                                 │  │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐           │  │
│  │  │ Order Book │ │    AMM     │ │  Auction   │ │ Settlement │           │  │
│  │  │   (P2P)    │ │  Bonding   │ │  (Batch)   │ │   Engine   │           │  │
│  │  └────────────┘ └────────────┘ └────────────┘ └────────────┘           │  │
│  │                                                                          │  │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐           │  │
│  │  │  Dynamic   │ │  Carbon    │ │Confidential│ │Cross-Chain │           │  │
│  │  │  Pricing   │ │  Credits   │ │  Trading   │ │ (Wormhole) │           │  │
│  │  └────────────┘ └────────────┘ └────────────┘ └────────────┘           │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
│                                      │                                         │
│         ┌────────────────────────────┼────────────────────────────┐           │
│         │                            │                            │           │
│         ▼                            ▼                            ▼           │
│  ┌─────────────┐            ┌─────────────┐            ┌─────────────┐       │
│  │   Oracle    │────────────│  Registry   │────────────│ Governance  │       │
│  │  Program    │            │  Program    │            │  Program    │       │
│  │             │            │             │            │             │       │
│  │ • Meter Data│            │ • Identity  │            │ • PoA Auth  │       │
│  │ • Validation│            │ • Devices   │            │ • ERC Certs │       │
│  │ • Consensus │            │ • Settlement│            │ • Emergency │       │
│  └──────┬──────┘            └──────┬──────┘            └──────┬──────┘       │
│         │                          │                          │               │
│         └──────────────────────────┴──────────────────────────┘               │
│                                    │                                          │
│                                    ▼                                          │
│                           ┌─────────────┐                                     │
│                           │Energy Token │                                     │
│                           │  Program    │                                     │
│                           │             │                                     │
│                           │ • GRX Mint  │                                     │
│                           │ • Token2022 │                                     │
│                           │ • PDA Auth  │                                     │
│                           └─────────────┘                                     │
│                                                                                │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

## Program IDs

| Program | Devnet/Testnet ID |
|---------|-------------------|
| Trading | `GTuRUUwCfvmqW7knqQtzQLMCy61p4UKUrdT5ssVgZbat` |
| Energy Token | `8jTDw36yCQyYdr9hTtve5D5bFuQdaJ6f3WbdM4iGPHuq` |
| Oracle | `ACeKwdMK1sma3EPnxy7bvgC5yMwy8tg7ZUJvaogC9YfR` |
| Registry | `3aF9FmyFuGzg4i1TCyySLQM1zWK8UUQyFALxo2f236ye` |
| Governance | `51d3SDcs5coxkiwvcjMzPrKeajTPF9yikw66WezipTva` |
| BLOCKBENCH | `B5aDPT9bM692E63ZtBVLQuJhsoJsPdyjn6ATqqgWpbTg` |
| TPC-C | `BcXcPzZHpBJ82RwDSuVY2eVCXj3enda8R3AxUTjXwFgu` |

---

## Quick Links

- [Project README](../../README.md)
- [Academic Documentation](../academic/) - Thesis chapters and research methodology
- [API Reference](../../target/idl/)
- [Test Suite](../../tests/)

### Academic Chapters

| Chapter | Title |
|---------|-------|
| [01](../academic/01-executive-summary.md) | Executive Summary |
| [02](../academic/02-business-model.md) | Business Model |
| [03](../academic/03-system-architecture.md) | System Architecture |
| [04](../academic/04-data-flow-diagrams.md) | Data Flow Diagrams |
| [05](../academic/05-token-economics.md) | Token Economics |
| [06](../academic/06-process-flows.md) | Process Flows |
| [07](../academic/07-security-analysis.md) | Security Analysis |
| [08](../academic/08-research-methodology.md) | Research Methodology |
| [09](../academic/09-comparative-analysis.md) | Comparative Analysis |
| [10](../academic/10-future-roadmap.md) | Future Roadmap |
| [11](../academic/11-software-testing.md) | Software Testing |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 2.0.0 | 2026-02-02 | Added deep dive documentation, cross-references |
| 1.5.0 | 2026-01-17 | Cross-chain and carbon modules |
| 1.0.0 | 2025-12-01 | Initial release |
