# GridTokenX Deep Dive Documentation

> **Advanced Technical Documentation** for developers, researchers, and auditors who require in-depth understanding of the GridTokenX platform architecture.

---

## Overview

This directory contains detailed technical deep dives into each component of the GridTokenX decentralized energy trading platform. These documents go beyond the standard API documentation to cover:

- **Internal Algorithms**: Step-by-step breakdowns of complex computational logic
- **Security Analysis**: Threat models, attack vectors, and mitigations
- **Performance Characteristics**: Compute unit profiles, optimization techniques
- **Integration Patterns**: Cross-program invocation (CPI) flows and dependencies
- **Research Contributions**: Novel implementations and academic relevance

---

## Document Index

| Document | Focus Area | Complexity |
|----------|------------|------------|
| [AMM & Bonding Curves](./amm-bonding-curves.md) | Automated Market Maker mathematics and energy-specific curves | ⭐⭐⭐ |
| [Periodic Auction System](./periodic-auction.md) | Batch order matching and uniform price clearing | ⭐⭐⭐ |
| [Confidential Trading](./confidential-trading.md) | Zero-knowledge proofs and ElGamal encryption | ⭐⭐⭐⭐ |
| [Carbon Credit System](./carbon-credits.md) | REC tokenization and carbon offset tracking | ⭐⭐ |
| [Cross-Chain Bridge](./cross-chain-bridge.md) | Wormhole integration for multi-chain energy trading | ⭐⭐⭐⭐ |
| [Oracle Security Model](./oracle-security.md) | Byzantine fault tolerance and data validation | ⭐⭐⭐ |
| [Settlement Architecture](./settlement-architecture.md) | Atomic settlement and payment finality | ⭐⭐⭐ |

---

## Architecture Diagram

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                          GridTokenX Platform Architecture                       │
├───────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                          Trading Program                                 │   │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐          │   │
│  │  │ Order Book │ │    AMM     │ │  Auction   │ │ Settlement │          │   │
│  │  │   (P2P)    │ │  Bonding   │ │  (Batch)   │ │   Engine   │          │   │
│  │  └─────┬──────┘ └─────┬──────┘ └─────┬──────┘ └─────┬──────┘          │   │
│  │        │              │              │              │                   │   │
│  │        └──────────────┴──────────────┴──────────────┘                   │   │
│  │                              │                                           │   │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐          │   │
│  │  │  Dynamic   │ │  Carbon    │ │ Confidential│ │Cross-Chain │          │   │
│  │  │  Pricing   │ │  Credits   │ │  Trading   │ │  (Wormhole)│          │   │
│  │  └────────────┘ └────────────┘ └────────────┘ └────────────┘          │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                      │                                          │
│         ┌────────────────────────────┼────────────────────────────┐            │
│         │                            │                            │            │
│         ▼                            ▼                            ▼            │
│  ┌─────────────┐            ┌─────────────┐            ┌─────────────┐        │
│  │   Oracle    │────────────│  Registry   │────────────│ Governance  │        │
│  │  Program    │            │  Program    │            │  Program    │        │
│  │             │            │             │            │             │        │
│  │ • Meter Data│            │ • Identity  │            │ • PoA Auth  │        │
│  │ • Validation│            │ • Devices   │            │ • ERC Certs │        │
│  │ • Consensus │            │ • Settlement│            │ • Emergency │        │
│  └──────┬──────┘            └──────┬──────┘            └──────┬──────┘        │
│         │                          │                          │                │
│         └──────────────────────────┴──────────────────────────┘                │
│                                    │                                            │
│                                    ▼                                            │
│                           ┌─────────────┐                                      │
│                           │Energy Token │                                      │
│                           │  Program    │                                      │
│                           │             │                                      │
│                           │ • GRX Mint  │                                      │
│                           │ • Token2022 │                                      │
│                           │ • PDA Auth  │                                      │
│                           └─────────────┘                                      │
│                                                                                 │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

## Reading Order

### For Developers
1. Start with [Settlement Architecture](./settlement-architecture.md) to understand the core trading flow
2. Continue with [AMM & Bonding Curves](./amm-bonding-curves.md) for instant liquidity mechanics

### For Security Auditors
1. Begin with [Oracle Security Model](./oracle-security.md) for the trust model
2. Study [Confidential Trading](./confidential-trading.md) for cryptographic guarantees
3. Review [Settlement Architecture](./settlement-architecture.md) for atomic operations

### For Researchers
1. [Periodic Auction System](./periodic-auction.md) covers novel batch clearing algorithms
2. [Carbon Credit System](./carbon-credits.md) for environmental economics integration
3. [Cross-Chain Bridge](./cross-chain-bridge.md) for interoperability research

---

## Prerequisites

Understanding these documents requires familiarity with:

- **Solana Development**: Anchor framework, PDAs, CPIs
- **DeFi Concepts**: AMMs, order books, liquidity pools
- **Cryptography**: ElGamal encryption, zero-knowledge proofs (for confidential trading)
- **Energy Markets**: Time-of-use pricing, renewable energy certificates (RECs)

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 2.0.0 | 2026-02-02 | Added deep dive documentation |
| 1.5.0 | 2026-01-17 | Cross-chain and carbon modules |
| 1.0.0 | 2025-12-01 | Initial release |
