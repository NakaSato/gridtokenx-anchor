# Architecture

GridTokenX is built on Solana blockchain with Proof of Authority (PoA) consensus, optimized for peer-to-peer energy trading.

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     GridTokenX Platform                      │
├─────────────────────────────────────────────────────────────┤
│                      Frontend / API                          │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│  │ Energy   │ │ Trading  │ │ Oracle   │ │ Registry │        │
│  │ Token    │ │ Program  │ │ Program  │ │ Program  │        │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘        │
│  ┌──────────┐                                               │
│  │Governance│                                               │
│  │ Program  │                                               │
│  └──────────┘                                               │
├─────────────────────────────────────────────────────────────┤
│                   Solana Runtime (PoA)                       │
└─────────────────────────────────────────────────────────────┘
```

## Programs Overview

| Program | Purpose | Key Features |
|---------|---------|--------------|
| **Energy Token** | Tokenized energy credits | SPL Token 2022, mint/burn |
| **Trading** | Order book matching | Buy/sell orders, settlement |
| **Oracle** | Price feeds | External data integration |
| **Registry** | Prosumer management | KYC, asset registration |
| **Governance** | DAO voting | Proposals, token voting |

## Consensus: Proof of Authority

GridTokenX uses PoA consensus for:

- **High throughput**: ~4,000+ TPS
- **Low latency**: Sub-second finality
- **Energy efficiency**: No mining required
- **Suitable for**: Enterprise/utility deployments

### Validator Configuration

```rust
pub struct PoAConfig {
    validators: Vec<Pubkey>,
    block_time_ms: u64,  // ~400ms
    epoch_length: u64,
}
```

## Data Flow

```
Smart Meter → API Gateway → Trading Program → Energy Token → Settlement
     ↓              ↓              ↓               ↓
  Reading       Validate       Match Order     Transfer
     ↓              ↓              ↓               ↓
  Signed        Registry        Order Book      Ledger
```

## Account Structure

### Energy Token Accounts

```
┌─────────────────┐
│   Token Info    │ ← PDA: ["token_info"]
├─────────────────┤
│   Mint          │ ← PDA: ["mint"]
├─────────────────┤
│   User ATA      │ ← Associated Token Account
└─────────────────┘
```

### Trading Accounts

```
┌─────────────────┐
│   Market        │ ← PDA: ["market", symbol]
├─────────────────┤
│   Order         │ ← PDA: ["order", user, id]
├─────────────────┤
│   Trade         │ ← PDA: ["trade", id]
└─────────────────┘
```

## Security Model

1. **Program-Owned Accounts**: All state in PDAs
2. **Signature Verification**: All transactions signed
3. **Access Control**: Authority checks in programs
4. **Audit Trail**: Immutable transaction history
