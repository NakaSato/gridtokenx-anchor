# Energy Token Program Instructions

## Program ID
```
94G1r674LmRDmLN2UPjDFD8Eh7zT8JaSaxv9v68GyEur
```

---

## initialize

Initialize the energy token mint.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `authority` | `Signer` | Program authority |
| `mint` | `PDA` | Token mint account |
| `token_state` | `PDA` | Program state |
| `token_program` | `Program` | SPL Token program |
| `system_program` | `Program` | System program |
| `rent` | `Sysvar` | Rent sysvar |

### Arguments

| Name | Type | Description |
|------|------|-------------|
| `decimals` | `u8` | Token decimals (9) |

### Example

```typescript
await program.methods
  .initialize(9)
  .accounts({
    authority: wallet.publicKey,
    mint: mintPda,
    tokenState: tokenStatePda,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
    rent: SYSVAR_RENT_PUBKEY,
  })
  .rpc();
```

---

## mint_tokens

Mint GRID tokens for validated energy production.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `authority` | `Signer` | Meter owner or oracle |
| `mint` | `PDA` | Token mint |
| `recipient` | `ATA` | Recipient token account |
| `meter_account` | `PDA` | Validated meter |
| `validation_result` | `PDA` | Oracle validation proof |
| `token_state` | `PDA` | Program state |
| `token_program` | `Program` | SPL Token program |

### Arguments

| Name | Type | Description |
|------|------|-------------|
| `amount` | `u64` | Amount to mint (9 decimals) |

### Example

```typescript
await program.methods
  .mintTokens(new BN(5_000_000_000)) // 5 GRID
  .accounts({
    authority: wallet.publicKey,
    mint: mintPda,
    recipient: recipientAta,
    meterAccount: meterPda,
    validationResult: validationPda,
    tokenState: tokenStatePda,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .rpc();
```

### Validation

- Meter must be active
- Validation must be recent (< 1 hour)
- Amount must match validated production
- Cannot double-mint for same validation

### Errors

| Code | Description |
|------|-------------|
| `InvalidMeter` | Meter not found |
| `MeterNotActive` | Meter is inactive |
| `InvalidValidation` | Validation proof invalid |
| `ValidationExpired` | Validation too old |
| `AlreadyMinted` | Already minted for validation |
| `AmountMismatch` | Amount doesn't match validation |
| `Unauthorized` | Caller not authorized |

---

## burn_tokens

Burn GRID tokens.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `authority` | `Signer` | Token owner |
| `mint` | `PDA` | Token mint |
| `token_account` | `ATA` | Source token account |
| `token_state` | `PDA` | Program state |
| `token_program` | `Program` | SPL Token program |

### Arguments

| Name | Type | Description |
|------|------|-------------|
| `amount` | `u64` | Amount to burn (9 decimals) |

### Example

```typescript
await program.methods
  .burnTokens(new BN(3_000_000_000)) // 3 GRID
  .accounts({
    authority: wallet.publicKey,
    mint: mintPda,
    tokenAccount: ownerAta,
    tokenState: tokenStatePda,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .rpc();
```

### Errors

| Code | Description |
|------|-------------|
| `InsufficientBalance` | Not enough tokens |
| `InvalidAmount` | Amount is zero |

---

## transfer

Transfer GRID tokens to another wallet.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `authority` | `Signer` | Token owner |
| `from` | `ATA` | Source token account |
| `to` | `ATA` | Destination token account |
| `token_program` | `Program` | SPL Token program |

### Arguments

| Name | Type | Description |
|------|------|-------------|
| `amount` | `u64` | Amount to transfer (9 decimals) |
| `memo` | `Option<String>` | Optional memo |

### Example

```typescript
await program.methods
  .transfer(
    new BN(1_000_000_000), // 1 GRID
    'Payment for energy'
  )
  .accounts({
    authority: wallet.publicKey,
    from: senderAta,
    to: recipientAta,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .rpc();
```

### Errors

| Code | Description |
|------|-------------|
| `InsufficientBalance` | Not enough tokens |
| `InvalidAmount` | Amount is zero |
| `AccountFrozen` | Account is frozen |
| `SameAccount` | Cannot transfer to self |

---

## create_token_account

Create an associated token account for GRID.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `payer` | `Signer` | Transaction fee payer |
| `owner` | `Account` | Token account owner |
| `mint` | `PDA` | Token mint |
| `token_account` | `ATA` | Account to create |
| `token_program` | `Program` | SPL Token program |
| `associated_token_program` | `Program` | ATA program |
| `system_program` | `Program` | System program |

### Example

```typescript
const ata = getAssociatedTokenAddressSync(mintPda, ownerPubkey);

await program.methods
  .createTokenAccount()
  .accounts({
    payer: wallet.publicKey,
    owner: ownerPubkey,
    mint: mintPda,
    tokenAccount: ata,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

---

## Account Structures

### TokenState

```rust
pub struct TokenState {
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub total_minted: u64,
    pub total_burned: u64,
    pub minting_enabled: bool,
    pub initialized_at: i64,
}
```

### MintRecord

```rust
pub struct MintRecord {
    pub meter: Pubkey,
    pub validation: Pubkey,
    pub amount: u64,
    pub recipient: Pubkey,
    pub timestamp: i64,
}
```

---

## Events

### TokensMinted

```rust
#[event]
pub struct TokensMinted {
    pub meter: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub validation: Pubkey,
    pub timestamp: i64,
}
```

### TokensBurned

```rust
#[event]
pub struct TokensBurned {
    pub owner: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}
```

### TokensTransferred

```rust
#[event]
pub struct TokensTransferred {
    pub from: Pubkey,
    pub to: Pubkey,
    pub amount: u64,
    pub memo: Option<String>,
    pub timestamp: i64,
}
```

---

## Token Economics

### Minting Rules

1. **1:1 Ratio**: 1 kWh validated production = 1 GRID token
2. **Validation Required**: Must have oracle validation proof
3. **Single Use**: Each validation can only mint once
4. **Time Bound**: Validation must be < 1 hour old

### Supply Model

```
Supply = Total Minted - Total Burned
```

No hard cap on total supply - backed by actual energy production.

---

## Integration with SPL Token

GRID tokens are standard SPL tokens compatible with:
- Phantom, Solflare, and other wallets
- Jupiter, Raydium DEXs
- Standard token transfers
- Token metadata standards

### Metadata

```typescript
const metadata = {
  name: 'GridTokenX Energy',
  symbol: 'GRID',
  decimals: 9,
  image: 'https://gridtokenx.io/logo.png',
};
```

---

**Document Version**: 1.0
