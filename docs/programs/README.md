# GridTokenX Anchor Programs

> **Solana Smart Contracts for Decentralized P2P Energy Trading**

**Version:** 3.0.0
**Last Updated:** April 6, 2026

---

## Overview

GridTokenX is a blockchain-powered Peer-to-Peer (P2P) energy trading platform built on Solana. Five Anchor programs work together to enable trustless energy trading between prosumers (producers) and consumers.

### Core Principle: 1 GRX = 1 kWh

The platform token **GRX** is backed 1:1 by verified renewable energy generation. Tokens are minted only when energy production is cryptographically confirmed by oracle-validated smart meter readings.

---

## Program Architecture

| Program | Program ID | Purpose |
|---------|------------|---------|
| **[Energy Token](./energy-token.md)** | `n52aKuZwUeZAocpWqRZAJR4xFhQqAvaRE7Xepy2JBGk` | GRX token management with PDA-controlled minting, Token-2022 extensions, REC validator co-signing |
| **[Registry](./registry.md)** | `FmvDiFUWPrwXsqo7z7XnVniKbZDcz32U5HSDVwPug89c` | User identity, smart meter registration, settlement orchestration, GRX staking |
| **[Trading](./trading.md)** | `69dGpKu9a8EZiZ7orgfTH6CoGj9DeQHHkHBF2exSr8na` | Multi-modal marketplace: P2P orders, CDA limit/market orders, batch processing, sharded order book |
| **[Oracle](./oracle.md)** | `JDUVXMkeGi4oxLp8njBaGScAFaVBBg7iGoiqcY1LxKop` | Trusted meter reading ingestion, anomaly detection, market clearing triggers, backup oracle consensus |
| **[Governance](./governance.md)** | `DamT9e1VqbA5nSyFZHExKwQu6qs4L5FW6dirWCK8YLd4` | PoA authority, REC (ERC) certificate issuance & lifecycle, emergency controls, multi-sig authority transfer |

### Advanced Topics

| Document | Description |
|----------|-------------|
| **[Auction Clearing](./auction-clearing.md)** | Periodic batch auction algorithm with uniform price discovery |
| **[Transaction Settlement](./transaction-settlement.md)** | Complete settlement flows for all trading mechanisms |

---

## Platform Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     GridTokenX Platform Architecture                      │
├──────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │                        Trading Program                               │ │
│  │  ┌──────────┐ ┌──────────────┐ ┌──────────┐ ┌───────────────────┐  │ │
│  │  │ P2P Orders│ │ Batch Proc.  │ │ CDA CLOB  │ │ Sharded Matching │  │ │
│  │  └────┬─────┘ └──────┬───────┘ └────┬─────┘ └────────┬──────────┘  │ │
│  │       │               │              │                 │              │ │
│  └───────┼───────────────┼──────────────┼─────────────────┼──────────────┘ │
│          │               │              │                 │                 │
│    ┌─────┴─────┐   ┌─────┴─────┐  ┌────┴──────┐   ┌─────┴──────────┐    │
│    │  Oracle   │   │ Registry  │  │Governance │   │ Energy Token   │    │
│    │  Program  │   │ Program   │  │ Program   │   │   Program      │    │
│    │           │   │           │  │           │   │                │    │
│    │ • Meter   │   │ • Users   │  │ • PoA     │   │ • GRX Mint     │    │
│    │   Data    │   │ • Meters  │  │ • REC     │   │ • Token-2022   │    │
│    │ • Clear.  │   │ • Settle  │  │ • ERC     │   │ • PDA Auth     │    │
│    │ • Anomaly │   │ • Stake   │  │ • Emergency│  │ • REC Co-sign  │    │
│    └─────┬─────┘   └────┬──────┘  └────┬──────┘   └────────┬───────┘    │
│          │              │              │                    │              │
│          └──────────────┴──────────────┴────────────────────┘              │
│                                     │                                       │
│                                     ▼                                       │
│                          ┌────────────────────┐                             │
│                          │  Solana Blockchain  │                             │
│                          │  • Sealevel Runtime │                             │
│                          │  • PoH Consensus    │                             │
│                          │  • SPL Token-2022   │                             │
│                          └────────────────────┘                             │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Key Data Flows

### Energy Production → GRX Minting

```
Smart Meter → Oracle Program → Registry Program → Energy Token Program
     │              │                │                    │
     ▼              ▼                ▼                    ▼
  Reading       Validation      Settlement          GRX Minting
  Submitted     & Anomaly       + CPI Mint           (PDA Authority)
                Detection
```

### P2P Energy Trade

```
Seller → Trading Program (Create Sell Order + ERC Validation)
                                      │
                                      ▼
Buyer  → Trading Program (Match Order) → Atomic Settlement
                                         │
                                ┌────────┴────────┐
                                ▼                 ▼
                           Energy Transfer    Payment Transfer
                           (Seller → Buyer)    (Buyer → Seller)
```

### Batch Auction Clearing

```
Order Collection (batch window) → Supply/Demand Curve Construction
                                          │
                                          ▼
                                   Find Clearing Price
                                   (Uniform Pricing)
                                          │
                                          ▼
                                   Generate Matches
                                   (Partial Fills OK)
                                          │
                                          ▼
                                   Atomic Settlement
```

---

## Quick Start

### Deploy Programs

```bash
# Build all programs
anchor build

# Deploy to local validator
anchor deploy

# Initialize governance
npx ts-node scripts/init-governance.ts

# Initialize energy token
npx ts-node scripts/init-energy-token.ts
```

### Run Tests

```bash
# All program tests
anchor test

# Individual program
cd programs/trading && cargo test
```

---

## Technology Stack

| Component | Technology | Version |
|-----------|------------|---------|
| Smart Contracts | Anchor Framework | 0.32.1 |
| Token Standard | SPL Token-2022 | 8.0.0 |
| Metadata | Metaplex Token Metadata | Latest |
| Language | Rust (SBF) | 1.75+ |
| Testing | Mocha + TypeScript | Latest |

---

## Security Model

| Feature | Implementation |
|---------|---------------|
| **PDA Authority** | All critical operations use Program Derived Addresses — no keypair can mint GRX outside program logic |
| **REC Validator Co-signing** | When validators are registered, one must co-sign every `mint_tokens_direct` call |
| **Dual High-Water Marks** | `settled_net_generation` (tokenization) and `claimed_erc_generation` (REC certification) prevent double-minting |
| **ERC-Linked Orders** | Sell orders optionally validate against Renewable Energy Certificates for compliance |
| **Emergency Pause** | Governance program circuit breaker halts all certificate issuance |
| **Multi-sig Authority Transfer** | 2-step authority change with 48-hour expiration window |

---

## Contributing

### Code Review Checklist
- [ ] PDA derivation correctness
- [ ] Account constraint validation
- [ ] CPI security checks
- [ ] Event emission for off-chain indexing
- [ ] Overflow-safe arithmetic (saturating_add/mul)

### Documentation Standards
- Use Markdown with GitHub Flavored syntax
- Include code examples for all instructions
- Document error codes and mitigation strategies
- Provide compute unit (CU) cost estimates

---

**GridTokenX** — Decentralized Energy Trading on Solana
