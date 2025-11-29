# Architecture Documentation

> **System design and architectural decisions for GridTokenX**

---

## Overview

GridTokenX is built on a modular architecture with 5 interconnected Solana programs that handle different aspects of the P2P energy trading platform.

### System Architecture

```mermaid
flowchart TB
    subgraph External["External Layer"]
        UI[Web Interface]
        MTR[Smart Meters]
    end
    
    subgraph API["API Layer"]
        GW[API Gateway]
        SDK[TypeScript SDK]
    end
    
    subgraph Programs["Solana Programs"]
        REG[Registry]
        ORC[Oracle]
        TOK[Energy Token]
        TRD[Trading]
        GOV[Governance]
    end
    
    subgraph Storage["Storage Layer"]
        DB[(PostgreSQL)]
        BC[Blockchain State]
    end
    
    UI --> GW
    MTR --> GW
    GW --> SDK
    SDK --> Programs
    Programs --> BC
    GW --> DB
```

### Program Interactions

```mermaid
flowchart LR
    REG[Registry] --> ORC[Oracle]
    ORC --> TOK[Energy Token]
    TOK --> TRD[Trading]
    REG --> TRD
    GOV[Governance] --> TRD
    GOV --> ORC
```

---

## Documents

### [System Overview](./system-overview.md)
High-level architecture covering all system components.

- Component interactions
- Data flow patterns
- Security model

### [P2P Trading Architecture](./p2p-trading.md)
Detailed trading system design.

- Order book structure
- Matching algorithm
- Settlement process

### [CPI Implementation](./cpi-implementation.md)
Cross-program invocation patterns.

- CPI security
- Account validation
- Error handling

---

## Design Principles

1. **Modularity** - Each program handles a single responsibility
2. **Security** - PDA-based access control, CPI validation
3. **Scalability** - Stateless design, parallel processing
4. **Transparency** - All transactions on-chain, auditable

---

## Related

- [Program Documentation](../programs/)
- [Process Flows](../flows/)
- [API Reference](../../api/)
