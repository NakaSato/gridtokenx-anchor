# Energy Token Program

The Energy Token program manages SPL Token 2022 tokens representing energy credits in the GridTokenX platform.

## Overview

| Property | Value |
|----------|-------|
| Program ID | `energy_token` |
| Token Standard | SPL Token 2022 |
| Decimals | 6 |
| Symbol | GRID |

## Instructions

### `initialize`

Initialize the token mint and metadata.

```rust
pub fn initialize(ctx: Context<Initialize>, name: String, symbol: String) -> Result<()>
```

**Accounts:**
- `mint` - Token mint PDA
- `token_info` - Token metadata PDA
- `authority` - Program authority
- `payer` - Transaction fee payer

### `mint_to_wallet`

Mint tokens to a user's wallet.

```rust
pub fn mint_to_wallet(ctx: Context<MintToWallet>, amount: u64) -> Result<()>
```

**Accounts:**
- `mint` - Token mint
- `destination` - User's ATA
- `destination_owner` - Wallet owner
- `authority` - Mint authority

**Example:**
```typescript
await program.methods
  .mintToWallet(new BN(1000 * 1e6))
  .accounts({
    mint: mintPda,
    destination: userAta,
    destinationOwner: userPubkey,
    authority: authority.publicKey,
  })
  .signers([authority])
  .rpc();
```

### `burn`

Burn tokens from a user's wallet.

```rust
pub fn burn(ctx: Context<Burn>, amount: u64) -> Result<()>
```

## PDAs

| PDA | Seeds | Purpose |
|-----|-------|---------|
| Token Info | `["token_info"]` | Token metadata |
| Mint | `["mint"]` | Token mint |

## Events

```rust
#[event]
pub struct TokenMinted {
    pub destination: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct TokenBurned {
    pub source: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}
```

## Error Codes

| Code | Name | Description |
|------|------|-------------|
| 6000 | Unauthorized | Caller not authorized |
| 6001 | InsufficientBalance | Not enough tokens |
| 6002 | InvalidAmount | Amount must be > 0 |
