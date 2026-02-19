# GridTokenX Platform Diagrams

**Version:** 2.0.0  
**Last Updated:** February 2, 2026

This directory contains comprehensive visual documentation for the GridTokenX decentralized energy trading platform.

---

## 📁 Diagram Index

| Diagram | Description | File |
|---------|-------------|------|
| **Protocol Application** | Complete protocol diagrams with Mermaid | [protocol-application-diagram.md](./protocol-application-diagram.md) |
| System Architecture | High-level platform overview | [architecture.md](./architecture.md) |
| Sequence Diagrams | Transaction flow sequences | [sequences.md](./sequences.md) |
| Entity Relationship | Account data models | [entity-relationship.md](./entity-relationship.md) |
| Network Topology | Infrastructure layout | [network-topology.md](./network-topology.md) |
| State Machines | Account state transitions | [state-machines.md](./state-machines.md) |

---

## Quick Reference: System Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         GRIDTOKENX PLATFORM ARCHITECTURE                        │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │   PROSUMER   │    │   CONSUMER   │    │  AUTHORITY   │    │   ORACLE     │  │
│  │   (Seller)   │    │   (Buyer)    │    │   (Admin)    │    │  (API GW)    │  │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘    └──────┬───────┘  │
│         │                   │                   │                   │          │
│         └─────────────────┬─┴───────────────────┴───────────────────┘          │
│                           │                                                     │
│                           ▼                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                        SOLANA BLOCKCHAIN LAYER                          │   │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │   │
│  │  │                      GRIDTOKENX PROGRAMS                         │   │   │
│  │  │                                                                  │   │   │
│  │  │  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐    │   │   │
│  │  │  │ REGISTRY  │  │  ORACLE   │  │GOVERNANCE │  │  ENERGY   │    │   │   │
│  │  │  │           │◄─┤           │  │           │  │  TOKEN    │    │   │   │
│  │  │  │ Users     │  │ Meter     │  │ PoA       │  │           │    │   │   │
│  │  │  │ Meters    │  │ Readings  │  │ ERC Certs │  │ GRX Mint  │    │   │   │
│  │  │  └─────┬─────┘  └───────────┘  └─────┬─────┘  └─────┬─────┘    │   │   │
│  │  │        │                             │              │           │   │   │
│  │  │        └──────────────┬──────────────┴──────────────┘           │   │   │
│  │  │                       │                                          │   │   │
│  │  │                       ▼                                          │   │   │
│  │  │               ┌───────────────┐                                  │   │   │
│  │  │               │   TRADING     │                                  │   │   │
│  │  │               │               │                                  │   │   │
│  │  │               │ • AMM Pools   │                                  │   │   │
│  │  │               │ • Auctions    │                                  │   │   │
│  │  │               │ • P2P Orders  │                                  │   │   │
│  │  │               │ • Settlement  │                                  │   │   │
│  │  │               └───────────────┘                                  │   │   │
│  │  │                                                                  │   │   │
│  │  └──────────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Program IDs (Mainnet/Devnet)

| Program | Program ID |
|---------|------------|
| Trading | `8S2e2p4ghqMJuzTz5AkAKSka7jqsjgBH7eWDcCHzXPND` |
| Registry | `CXXRVpEwyd2ch7eo425mtaBfr2Yi1825Nm6yik2NEWqR` |
| Oracle | `EkcPD2YEXhpo1J73UX9EJNnjV2uuFS8KXMVLx9ybqnhU` |
| Governance | `8bNpJqZoqqUWKu55VWhR8LWS66BX7NPpwgYBAKhBzu2L` |
| Energy Token | `5DJCWKo5cXt3PXRsrpH1xixra4wXWbNzxZ1p4FHqSxvi` |

---

## Color Legend (for diagrams)

| Color | Meaning |
|-------|---------|
| 🔵 Blue | User/External actors |
| 🟢 Green | On-chain programs |
| 🟡 Yellow | Off-chain services |
| 🔴 Red | Critical/Security components |
| ⚪ Gray | Infrastructure |
