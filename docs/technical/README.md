# Technical Documentation

> **Developer-focused documentation with implementation details**

This section contains technical documentation for developers working with the GridTokenX platform, including architecture decisions, implementation patterns, and system flows.

---

## 📐 Architecture

Detailed system architecture and design decisions.

- [System Overview](./architecture/system-overview.md) - High-level architecture
- [P2P Trading Architecture](./architecture/p2p-trading.md) - Trading system design
- [Cross-Program Invocation](./architecture/cpi-implementation.md) - CPI patterns

---

## 🔧 Programs

Implementation documentation for each smart contract.

- [Registry Program](./programs/registry.md) - User and meter management
- [Oracle Program](./programs/oracle.md) - Data validation system
- [Energy Token Program](./programs/energy-token.md) - Token operations
- [Trading Program](./programs/trading.md) - Marketplace implementation
- [Governance Program](./programs/governance.md) - ERC and governance

---

## 🔄 Flows

End-to-end system flows and processes.

- [Smart Meter to Settlement](./flows/smart-meter-to-settlement.md) - Complete data flow
- [Token Minting Flow](./flows/token-minting-flow.md) - Tokenization process

---

## Quick Reference

### Program IDs

| Program | ID |
|---------|-----|
| Registry | `2XPQmRp1wz9ZdVxGLdgBEJjKL7gaV7g7ScvhzSGBV2ek` |
| Oracle | `DvdtU4quEbuxUY2FckmvcXwTpC9qp4HLJKb1PMLaqAoE` |
| Energy Token | `94G1r674LmRDmLN2UPjDFD8Eh7zT8JaSaxv9v68GyEur` |
| Trading | `GZnqNTJsre6qB4pWCQRE9FiJU2GUeBtBDPp6s7zosctk` |
| Governance | `4DY97YYBt4bxvG7xaSmWy3MhYhmA6HoMajBHVqhySvXe` |

### Key Design Patterns

| Pattern | Usage |
|---------|-------|
| PDA Authority | Trustless token minting |
| Dual-Tracker | Double-claim prevention |
| Gateway Authorization | Data validation |
| Atomic Settlement | Trade execution |

---

*For academic documentation, see [Academic Documentation](../academic/)*
