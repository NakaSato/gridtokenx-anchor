# GridTokenX Instructions Reference

## Overview

This section provides detailed documentation for all on-chain instructions across the 5 GridTokenX programs.

---

## Programs

| Program | Description | Documentation |
|---------|-------------|---------------|
| **Registry** | User/meter registration | [registry.md](./registry.md) |
| **Oracle** | Price feeds & validation | [oracle.md](./oracle.md) |
| **Energy Token** | GRID token operations | [energy-token.md](./energy-token.md) |
| **Trading** | P2P marketplace | [trading.md](./trading.md) |
| **Governance** | Protocol governance | [governance.md](./governance.md) |

---

## Account Types

### PDAs (Program Derived Addresses)

All programs use PDAs for data storage:

| Account Type | Seeds | Program |
|--------------|-------|---------|
| `UserAccount` | `["user", wallet]` | Registry |
| `MeterAccount` | `["meter", serial]` | Registry |
| `PriceFeed` | `["price_feed"]` | Oracle |
| `Order` | `["order", seller, nonce]` | Trading |
| `Proposal` | `["proposal", creator, nonce]` | Governance |

### Finding PDAs

```typescript
import { PublicKey } from '@solana/web3.js';

// User account PDA
const [userPda] = PublicKey.findProgramAddressSync(
  [Buffer.from('user'), wallet.toBuffer()],
  REGISTRY_PROGRAM_ID
);

// Meter account PDA
const [meterPda] = PublicKey.findProgramAddressSync(
  [Buffer.from('meter'), Buffer.from(serialNumber)],
  REGISTRY_PROGRAM_ID
);
```

---

## Common Patterns

### Transaction Building

```typescript
import { Transaction, sendAndConfirmTransaction } from '@solana/web3.js';

const transaction = new Transaction();
transaction.add(instruction1);
transaction.add(instruction2);

const signature = await sendAndConfirmTransaction(
  connection,
  transaction,
  [wallet]
);
```

### Error Handling

```typescript
try {
  const tx = await program.methods
    .someInstruction()
    .accounts({ ... })
    .rpc();
} catch (error) {
  if (error instanceof AnchorError) {
    console.log('Error code:', error.error.errorCode.code);
    console.log('Error message:', error.error.errorMessage);
  }
}
```

### Account Fetching

```typescript
// Single account
const account = await program.account.userAccount.fetch(pda);

// Multiple accounts
const accounts = await program.account.userAccount.all();

// Filtered accounts
const filtered = await program.account.userAccount.all([
  { memcmp: { offset: 8, bytes: wallet.toBase58() } }
]);
```

---

## Cross-Program Invocations (CPI)

GridTokenX programs interact through CPI:

```
Registry ──────┐
               │
Oracle ────────┼──▶ Energy Token ──▶ Trading
               │
Governance ────┘
```

### CPI Example

```rust
// In Trading program
let cpi_accounts = Transfer {
    from: ctx.accounts.seller_token_account.to_account_info(),
    to: ctx.accounts.escrow_account.to_account_info(),
    authority: ctx.accounts.seller.to_account_info(),
};

let cpi_program = ctx.accounts.token_program.to_account_info();
let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

token::transfer(cpi_ctx, amount)?;
```

---

## Quick Reference

### Registry Instructions
- `initialize` - Initialize registry
- `register_user` - Register new user
- `update_user` - Update user details
- `register_meter` - Register smart meter
- `update_meter` - Update meter status
- `update_meter_reading` - Record reading

### Oracle Instructions
- `initialize` - Initialize oracle
- `update_price_feed` - Update GRX price
- `validate_meter_reading` - Validate reading
- `add_authorized_oracle` - Add operator
- `remove_authorized_oracle` - Remove operator

### Energy Token Instructions
- `initialize` - Initialize token mint
- `mint_tokens` - Mint GRID tokens
- `burn_tokens` - Burn GRID tokens
- `transfer` - Transfer tokens

### Trading Instructions
- `initialize` - Initialize marketplace
- `create_order` - Create sell order
- `match_order` - Execute trade
- `cancel_order` - Cancel order

### Governance Instructions
- `initialize` - Initialize governance
- `create_proposal` - Create proposal
- `vote` - Cast vote
- `execute_proposal` - Execute passed proposal
- `cancel_proposal` - Cancel proposal

---

**Document Version**: 1.0
