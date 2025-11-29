# GridTokenX Program Documentation

> Technical specifications for all Solana programs in the GridTokenX platform

---

## Overview

GridTokenX is a decentralized peer-to-peer energy trading platform built on Solana using the Anchor framework. The platform consists of five interconnected programs that handle user registration, energy tokenization, trading, and regulatory compliance.

---

## Program Index

| Program | Program ID | Version | Description |
|---------|------------|---------|-------------|
| [Registry](./registry-program.md) | `FQYhgNRRWDCvy9WPeZPo5oZw63iHpJZToi1uUp25jE4a` | v2.0 | User/meter registration, oracle authorization, settlement |
| [Oracle](./oracle-program.md) | `HtV8jTeaCVXKZVCQQVWjXcAvmiF6id9QSLVGP5MT5osX` | v0.1.0 | AMI data bridge, validation pipeline, quality metrics |
| [Energy Token](./energy-token-program.md) | `9sAB52aZ71ciGhaVwuCg6ohTeWu8H6fDb2B29ohxsFVp` | v1.0 | GRID token management with PDA authority pattern |
| [Trading](./trading-program.md) | `9t3s8sCgVUG9kAgVPsozj8mDpJp9cy6SF5HwRK5nvAHb` | v1.0 | P2P marketplace, order book, ERC validation, VWAP pricing |
| [Governance](./governance-program.md) | `4D9Mydr4f3BEiDoKxE2V8yMZBj53X6nxMjMWaNPAQKrN` | v2.0 | ERC certificates, PoA system, multi-sig authority |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         GRIDTOKENX PROGRAM ARCHITECTURE                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐     │
│   │    REGISTRY     │      │     ORACLE      │      │   GOVERNANCE    │     │
│   │    Program      │      │    Program      │      │    Program      │     │
│   ├─────────────────┤      ├─────────────────┤      ├─────────────────┤     │
│   │ • Users         │      │ • AMI Data      │      │ • ERC Certs     │     │
│   │ • Meters        │      │ • Validation    │      │ • PoA Config    │     │
│   │ • Settlement    │◀────▶│ • Quality       │      │ • Authority     │     │
│   └────────┬────────┘      └────────┬────────┘      └────────┬────────┘     │
│            │                        │                        │              │
│            │ CPI                    │ Events                 │ Account Read │
│            ▼                        ▼                        ▼              │
│   ┌─────────────────────────────────────────────────────────────────┐      │
│   │                      ENERGY TOKEN PROGRAM                        │      │
│   │                                                                  │      │
│   │  • GRID Token Minting (PDA Authority)                           │      │
│   │  • Token Transfers                                               │      │
│   │  • Token Burning                                                 │      │
│   └────────────────────────────────┬────────────────────────────────┘      │
│                                    │                                        │
│                                    │ Token Settlement                       │
│                                    ▼                                        │
│   ┌─────────────────────────────────────────────────────────────────┐      │
│   │                       TRADING PROGRAM                            │      │
│   │                                                                  │      │
│   │  • Order Book Management (Buy/Sell)                             │      │
│   │  • Order Matching (VWAP Pricing)                                │      │
│   │  • ERC Certificate Validation                                    │      │
│   │  • Batch Processing                                              │      │
│   │  • Market Depth Tracking                                         │      │
│   └─────────────────────────────────────────────────────────────────┘      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Program Interactions

### Data Flow

```
Smart Meter → Oracle Program → Registry Program → Energy Token Program → Trading Program
                                      ↓
                            Governance Program (ERC Validation)
```

### Cross-Program Invocation (CPI)

| Source | Target | Purpose |
|--------|--------|---------|
| Registry | Energy Token | Mint GRID tokens on meter settlement |
| Trading | Governance | Validate ERC certificates for sell orders |
| Governance | Registry | Read MeterAccount for ERC issuance |

### Event-Based Integration

| Program | Event | Consumer |
|---------|-------|----------|
| Oracle | `MeterReadingSubmitted` | Registry |
| Oracle | `MarketClearingTriggered` | Trading |
| Registry | `MeterBalanceSettled` | Energy Token |
| Trading | `OrderMatched` | External systems |
| Governance | `ErcIssued` | Trading |

---

## Common Concepts

### PDA (Program Derived Address) Seeds

| Program | Account | Seeds |
|---------|---------|-------|
| Registry | Registry | `[b"registry"]` |
| Registry | UserAccount | `[b"user", user_authority.key()]` |
| Registry | MeterAccount | `[b"meter", meter_id.as_bytes()]` |
| Oracle | OracleData | `[b"oracle_data"]` |
| Energy Token | TokenInfo | `[b"token_info"]` |
| Energy Token | Mint | `[b"mint"]` |
| Trading | Market | `[b"market"]` |
| Trading | Order | `[b"order", authority.key(), active_orders]` |
| Trading | TradeRecord | `[b"trade", buy_order.key(), sell_order.key()]` |
| Governance | PoAConfig | `[b"poa_config"]` |
| Governance | ErcCertificate | `[b"erc_certificate", certificate_id.as_bytes()]` |

### Authority Model

| Role | Description | Programs |
|------|-------------|----------|
| **Registry Authority** | Platform admin | Registry |
| **Oracle Authority** | Authorized data submitter | Registry, Oracle |
| **API Gateway** | AMI data bridge | Oracle |
| **PoA Authority** | REC certifying entity | Governance |
| **Market Authority** | Trading marketplace admin | Trading |
| **Token Authority** | Token minting control | Energy Token |

---

## Development Resources

### Framework

- **Anchor Version**: v0.32.1
- **Rust Version**: 1.70+
- **Solana Version**: 1.17+

### Testing

```bash
# Run all program tests
anchor test

# Run specific program tests
anchor test -- --test-thread=1 --test energy-token
anchor test -- --test-thread=1 --test trading
```

### Build

```bash
# Build all programs
anchor build

# Build specific program
anchor build -p trading
```

---

## Quick Links

- [Getting Started Guide](../guides/getting-started.md)
- [Deployment Guide](../guides/deployment.md)
- [SDK Documentation](../api/sdk/README.md)
- [Integration Examples](../guides/integration-examples.md)

---

*Last Updated: November 2025*
