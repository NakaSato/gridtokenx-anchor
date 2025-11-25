# GridTokenX Anchor Programs Documentation

## Overview

This directory contains comprehensive documentation for all Anchor programs in the GridTokenX energy trading ecosystem. Each document provides detailed explanations, architecture diagrams, and integration points without including code snippets.

## Documentation Files

### 📡 [Oracle Program](./oracle-program.md)
The data gateway for AMI smart meter readings into the blockchain.

**Key Features:**
- Secure meter reading submission
- Data validation and quality scoring
- Market clearing triggers
- API Gateway authorization

**Main Components:**
- Oracle Data Account
- Validation Configuration
- Reading History
- Quality Metrics

---

### 💱 [Trading Program](./trading-program.md)
The decentralized P2P energy marketplace for buying and selling renewable energy.

**Key Features:**
- Order book management (buy/sell orders)
- Price discovery and market depth
- Order matching and trade execution
- ERC certificate integration

**Main Components:**
- Market Account
- Order Accounts
- Batch Configuration
- Market Depth Tracking

---

### 📋 [Registry Program](./registry-program.md)
The identity and asset management system for users and smart meters.

**Key Features:**
- User registration (Prosumers and Consumers)
- Smart meter registry
- Energy accounting (generation/consumption)
- Settlement tracking and double-mint prevention

**Main Components:**
- Registry Account
- User Accounts
- Meter Accounts
- Settlement Balances

---

### 🏛️ [Governance Program](./governance-program.md)
The Proof of Authority governance system for ERC certification.

**Key Features:**
- Energy Renewable Certificate (ERC) issuance
- REC authority management
- Emergency controls (pause/unpause)
- Certificate lifecycle management

**Main Components:**
- PoA Configuration
- ERC Certificates
- Authority Controls
- Anti-Double-Claim Logic

---

### 🪙 [Energy Token Program](./energy-token-program.md)
The tokenization layer that converts verified energy generation into GRID tokens.

**Key Features:**
- Energy-to-token conversion (1 kWh = 1 GRID)
- SPL Token standard compliance
- Integration with Registry for settlement
- Metaplex metadata support

**Main Components:**
- Token Info Account
- GRID Token Mint
- User Token Accounts
- Minting Operations

---

## System Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                GridTokenX Ecosystem Architecture                  │
└──────────────────────────────────────────────────────────────────┘

External Systems              Solana Blockchain Programs
┌──────────────┐             ┌─────────────────────────┐
│              │   Readings  │                         │
│ Smart Meters ├────────────▶│   Oracle Program        │
│ (AMI)        │             │   - Data Gateway        │
└──────────────┘             │   - Validation          │
                             └───────────┬─────────────┘
                                         │
                                         │ Triggers Market
                                         ▼
┌──────────────┐             ┌─────────────────────────┐
│              │   Register  │                         │
│ Prosumers    ├────────────▶│   Registry Program      │
│ Consumers    │   Meters    │   - User Management     │
│              │             │   - Meter Tracking      │
└──────────────┘             │   - Energy Accounting   │
                             └───────────┬─────────────┘
                                         │
                                         │ Verify Users/Meters
                                         ▼
┌──────────────┐             ┌─────────────────────────┐
│              │   Trade     │                         │
│ Energy       ├────────────▶│   Trading Program       │
│ Buyers/      │   Energy    │   - Order Book          │
│ Sellers      │             │   - Price Discovery     │
│              │             │   - Trade Execution     │
└──────────────┘             └───────────┬─────────────┘
                                         │
                                         │ Validate ERC
                                         ▼
┌──────────────┐             ┌─────────────────────────┐
│              │   Issue     │                         │
│ REC          ├────────────▶│   Governance Program    │
│ Authority    │   ERCs      │   - PoA Control         │
│              │             │   - ERC Certification   │
└──────────────┘             │   - Emergency Controls  │
                             └───────────┬─────────────┘
                                         │
                                         │ Validate ERC
                                         ▼
┌──────────────┐             ┌─────────────────────────┐
│              │   Mint      │                         │
│ Prosumers    ├────────────▶│   Energy Token Program  │
│              │   GRID      │   - Tokenization        │
│              │   Tokens    │   - SPL Token Mint      │
└──────────────┘             │   - Settlement CPI      │
                             └─────────────────────────┘
```

## Program Interactions

### Data Flow Summary

1. **Meter Reading Submission:**
   ```
   Smart Meters → API Gateway → Oracle Program → Registry Program
   ```

2. **User and Meter Registration:**
   ```
   Users → Registry Program (stores identities and meters)
   ```

3. **ERC Certificate Issuance:**
   ```
   REC Authority → Governance Program ← Registry Program (anti-double-claim)
   ```

4. **Energy Trading:**
   ```
   Sellers → Trading Program ← Governance Program (ERC validation)
                ↓
           Buyers ← Registry Program (user verification)
   ```

5. **Market Clearing:**
   ```
   Oracle Program (triggers) → Trading Program (matches orders)
   ```

6. **Energy Tokenization:**
   ```
   Prosumers → Energy Token Program → Registry Program (settlement)
                      ↓
              GRID Tokens Minted
   ```

## Core Concepts

### Energy Flow

```
1. Generation
   └─ Smart Meter measures production
      └─ Oracle records reading
         └─ Registry tracks totals

2. Certification
   └─ Renewable energy generated
      └─ Governance issues ERC
         └─ Prevents double-claiming

3. Trading
   └─ Prosumer creates sell order (with ERC)
      └─ Consumer creates buy order
         └─ Trading matches orders

4. Settlement
   └─ Registry marks energy as settled
      └─ Prevents double-minting
         └─ Tokens can be created

5. Tokenization
   └─ Energy Token calls settlement
      └─ GRID tokens minted (1 kWh = 1 GRID)
         └─ Tokens tradeable on markets
```

### Key Security Features

**Double-Claim Prevention:**
- Registry tracks `claimed_erc_generation`
- Same energy cannot get multiple ERCs
- Enforced by Governance Program

**Double-Mint Prevention:**
- Registry tracks `settled_net_generation`
- Same energy cannot be tokenized twice
- Enforced by Energy Token Program

**Trade Authenticity:**
- Sell orders must reference valid ERC
- Only renewable energy can be sold
- Enforced by Trading Program

**Access Control:**
- Oracle: Only API Gateway can submit readings
- Registry: Only owners can register meters
- Trading: Only active users can trade
- Governance: Only REC Authority can issue ERCs
- Energy Token: Only meter owners can mint their tokens

## Documentation Structure

Each program documentation includes:

1. **Overview**: Purpose and high-level description
2. **System Architecture**: Visual diagrams of components
3. **Core Components**: Detailed explanation of accounts and data structures
4. **Data Flow**: Process diagrams for key operations
5. **Instructions**: Complete list of all program instructions
6. **Events**: All emitted events and their data
7. **Security Model**: Access control and validation layers
8. **Integration Points**: How the program interacts with others
9. **Best Practices**: Guidelines for operators and developers
10. **Limitations**: Current constraints and design trade-offs
11. **Future Enhancements**: Potential improvements

## Text Diagram Legend

The documentation uses ASCII art diagrams to illustrate concepts:

**Boxes represent components:**
```
┌──────────────┐
│  Component   │
└──────────────┘
```

**Arrows show data flow:**
```
ComponentA ────▶ ComponentB  (data flows from A to B)
```

**Vertical flows:**
```
Step 1
  │
  ▼
Step 2
  │
  ▼
Step 3
```

**Hierarchical structures:**
```
Parent
  ├─ Child 1
  ├─ Child 2
  └─ Child 3
```

## Getting Started

### For Developers

1. **Start with Registry Program:**
   - Understand user and meter management
   - Learn about settlement tracking

2. **Then Oracle Program:**
   - See how readings enter the system
   - Understand validation mechanisms

3. **Next Governance Program:**
   - Learn ERC certification process
   - Understand authority model

4. **Then Energy Token Program:**
   - Understand tokenization mechanics
   - Learn settlement integration
   - See double-mint prevention

5. **Finally Trading Program:**
   - See how all pieces integrate
   - Understand market mechanics

### For Operators

1. **Review Security Models** in each program
2. **Understand Best Practices** sections
3. **Study Emergency Procedures** in Governance
4. **Learn Event Monitoring** for system health

### For Auditors

1. **Focus on Integration Points** between programs
2. **Review Validation Layers** in each program
3. **Examine Double-Claim Prevention** logic
4. **Study Access Control** hierarchies

## Additional Resources

- **Implementation Plan**: See `/docs/implementation_plan.md` for development roadmap
- **API Documentation**: See `/docs/api/` for off-chain API integration
- **Testing Guide**: See `/tests/` for comprehensive test suites
- **Deployment Guide**: See `/docs/deployment.md` for mainnet deployment

## Contributing to Documentation

When updating these documents:

1. **No Code Snippets**: Keep documentation code-free
2. **Use Text Diagrams**: Illustrate concepts with ASCII art
3. **Focus on Concepts**: Explain the "why" not just the "what"
4. **Include Examples**: Use realistic scenarios
5. **Keep Updated**: Sync with code changes
6. **Cross-Reference**: Link between related documents

## Questions and Feedback

For questions about these programs:
- Review the relevant program documentation first
- Check the Integration Points section for cross-program interactions
- Consult the Best Practices sections for common scenarios
- Refer to Limitations sections for known constraints

---

**Last Updated:** 2024-11-25  
**Documentation Version:** 1.0  
**Anchor Version:** 0.30.1  
**Solana Version:** 1.18.x
