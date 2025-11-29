# GridTokenX Smart Contract Programs

> **Academic Documentation for Thesis Research**

This section provides comprehensive documentation for the five interconnected Anchor programs that comprise the GridTokenX platform.

---

## System Overview

GridTokenX implements a decentralized peer-to-peer (P2P) energy trading platform through five specialized smart contracts deployed on the Solana blockchain.

### Program Summary

| Program | Purpose | Key Responsibility |
|---------|---------|-------------------|
| [Registry](./registry.md) | Identity Management | User and meter registration, dual-tracker system |
| [Oracle](./oracle.md) | Data Validation | Smart meter data ingestion and quality assurance |
| [Energy Token](./energy-token.md) | Asset Management | GRID token minting and supply control |
| [Trading](./trading.md) | Market Operations | Order book, matching engine, settlement |
| [Governance](./governance.md) | Compliance | ERC certification, PoA configuration |

### Program IDs

| Program | Program ID (Base58) |
|---------|---------------------|
| Registry | `9XS8uUEVErcA8LABrJQAdohWMXTToBwhFN7Rvur6dC5` |
| Oracle | `DvdtU4quEbuxUY2FckmvcXwTpC9qp4HLJKb1PMLaqAoE` |
| Energy Token | `94G1r674LmRDmLN2UPjDFD8Eh7zT8JaSaxv9v68GyEur` |
| Trading | `GZnqNTJsre6qB4pWCQRE9FiJU2GUeBtBDPp6s7zosctk` |
| Governance | `4DY97YYBt4bxvG7xaSmWy3MhYhmA6HoMajBHVqhySvXe` |

---

## Architectural Principles

### Layered Architecture

The system follows a layered architecture pattern separating concerns across distinct program boundaries:

**Layer 1 - Data Layer (Oracle)**
- Smart meter data ingestion
- Validation and quality metrics
- Anomaly detection

**Layer 2 - Core Layer (Registry + Energy Token)**
- User and meter account management
- Token minting and supply control
- State tracking and settlement

**Layer 3 - Market Layer (Trading)**
- Order book management
- Price discovery (VWAP)
- Trade matching and execution

**Layer 4 - Compliance Layer (Governance)**
- ERC certificate issuance
- Authority configuration
- Emergency controls

### Cross-Program Invocation Pattern

The programs communicate through carefully designed CPI relationships:

- **Registry → Energy Token**: Settlement triggers token minting
- **Governance → Registry**: ERC issuance updates meter tracking
- **Trading → Governance**: Order validation reads ERC certificates

### Design Principles

1. **Single Responsibility**: Each program handles one domain
2. **Minimal CPI Surface**: Limited cross-program calls reduce attack surface
3. **PDA Authority**: Trustless operations via Program Derived Addresses
4. **Atomic Operations**: All-or-nothing transaction semantics

---

## Key Metrics

| Metric | Value |
|--------|-------|
| Total Programs | 5 |
| Total Instructions | 43 |
| Transaction Latency | ~400ms |
| Token Precision | 9 decimals |

---

## Research Contributions

### Dual-Tracker System

The platform introduces a novel dual-tracker system that independently tracks:

1. **Net Energy (GRID Tokens)**: Surplus energy available for trading
2. **Gross Generation (ERC Certificates)**: Total renewable generation for compliance

This design prevents double-counting while enabling full utilization of both tokenization and certification systems.

### Mathematical Invariants

**Token Supply Invariant:**
$$\text{Total GRID Supply} \leq \sum_{m \in \text{Meters}} (\text{generation}_m - \text{consumption}_m)$$

**Certificate Integrity Invariant:**
$$\text{Total ERC Certified} \leq \sum_{m \in \text{Meters}} \text{generation}_m$$

---

*For implementation details, see [Technical Documentation](../../technical/programs/)*
