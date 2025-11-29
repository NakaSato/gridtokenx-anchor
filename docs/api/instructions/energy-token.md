# Energy Token Program Instructions

## Program ID
```
9sAB52aZ71ciGhaVwuCg6ohTeWu8H6fDb2B29ohxsFVp
```

---

## initialize

Initialize the energy token program (logs message only).

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `authority` | `Signer` | Program authority |

### Example

```typescript
await program.methods
  .initialize()
  .accounts({
    authority: wallet.publicKey,
  })
  .rpc();
```

---

## initialize_token

Initialize the token configuration and create the program-controlled mint.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `token_info` | `PDA (init)` | Token configuration - seeds: `[b"token_info"]` |
| `mint` | `PDA (init)` | SPL Token mint - seeds: `[b"mint"]` |
| `authority` | `Signer (mut)` | Initial authority and payer |
| `system_program` | `Program` | System program |
| `token_program` | `Program` | SPL Token program |
| `rent` | `Sysvar` | Rent sysvar |

### Example

```typescript
const [tokenInfoPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("token_info")],
  program.programId
);
const [mintPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("mint")],
  program.programId
);

await program.methods
  .initializeToken()
  .accounts({
    tokenInfo: tokenInfoPda,
    mint: mintPda,
    authority: wallet.publicKey,
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID,
    rent: SYSVAR_RENT_PUBKEY,
  })
  .rpc();
```

---

## create_token_mint

Create a new token mint with Metaplex metadata (Token 2022 compatible).

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `mint` | `Signer (init)` | New token mint keypair |
| `metadata` | `UncheckedAccount (mut)` | Metaplex metadata PDA |
| `payer` | `Signer (mut)` | Transaction fee payer |
| `authority` | `Signer` | Mint authority |
| `system_program` | `Program` | System program |
| `token_program` | `Interface` | SPL Token or Token-2022 program |
| `metadata_program` | `UncheckedAccount` | Metaplex Token Metadata program |
| `rent` | `Sysvar` | Rent sysvar |
| `sysvar_instructions` | `UncheckedAccount` | Sysvar instructions |

### Arguments

| Name | Type | Description |
|------|------|-------------|
| `name` | `string` | Token name (e.g., "Grid Renewable Energy Token") |
| `symbol` | `string` | Token symbol (e.g., "GRID") |
| `uri` | `string` | Metadata JSON URI |

### Example

```typescript
const mintKeypair = Keypair.generate();
const metadataPda = PublicKey.findProgramAddressSync(
  [
    Buffer.from("metadata"),
    new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s").toBuffer(),
    mintKeypair.publicKey.toBuffer(),
  ],
  new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s")
)[0];

await program.methods
  .createTokenMint(
    "Grid Renewable Energy Token",
    "GRID",
    "https://gridtokenx.com/metadata.json"
  )
  .accounts({
    mint: mintKeypair.publicKey,
    metadata: metadataPda,
    payer: wallet.publicKey,
    authority: wallet.publicKey,
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID,
    metadataProgram: new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"),
    rent: SYSVAR_RENT_PUBKEY,
    sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
  })
  .signers([mintKeypair])
  .rpc();
```

---

## mint_to_wallet

Mint GRID tokens to a wallet using PDA signing. Creates ATA if needed.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `mint` | `InterfaceAccount (mut)` | Token mint |
| `token_info` | `Account` | TokenInfo PDA (has_one = authority) |
| `destination` | `InterfaceAccount (init_if_needed, mut)` | Recipient ATA |
| `destination_owner` | `AccountInfo` | Owner of destination token account |
| `authority` | `Signer` | Must match `token_info.authority` |
| `payer` | `Signer (mut)` | Transaction fee payer |
| `token_program` | `Interface` | SPL Token program |
| `associated_token_program` | `Program` | Associated Token program |
| `system_program` | `Program` | System program |

### Arguments

| Name | Type | Description |
|------|------|-------------|
| `amount` | `u64` | Amount to mint (9 decimals) |

### Example

```typescript
const [tokenInfoPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("token_info")],
  program.programId
);
const [mintPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("mint")],
  program.programId
);

const recipientAta = getAssociatedTokenAddressSync(mintPda, recipientPubkey);

await program.methods
  .mintToWallet(new BN(5_000_000_000)) // 5 GRID tokens
  .accounts({
    mint: mintPda,
    tokenInfo: tokenInfoPda,
    destination: recipientAta,
    destinationOwner: recipientPubkey,
    authority: wallet.publicKey,
    payer: wallet.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

### Events Emitted

```rust
TokensMinted {
    recipient: Pubkey,
    amount: u64,
    timestamp: i64,
}
```

---

## mint_tokens_direct

Mint tokens directly to a user (authority only). Used for off-chain verified meter readings.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `token_info` | `PDA (mut)` | Token configuration - seeds: `[b"token_info"]` |
| `mint` | `Account (mut)` | SPL Token mint |
| `user_token_account` | `Account (mut)` | Recipient token account (must exist) |
| `authority` | `Signer` | Must match `token_info.authority` |
| `token_program` | `Program` | SPL Token program |

### Arguments

| Name | Type | Description |
|------|------|-------------|
| `amount` | `u64` | Amount to mint (9 decimals) |

### Example

```typescript
await program.methods
  .mintTokensDirect(new BN(10_000_000_000)) // 10 GRID tokens
  .accounts({
    tokenInfo: tokenInfoPda,
    mint: mintPda,
    userTokenAccount: userAta,
    authority: wallet.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .rpc();
```

### Events Emitted

```rust
TokensMintedDirect {
    recipient: Pubkey,
    amount: u64,
    timestamp: i64,
}
```

### Validation

- Authority must match `token_info.authority`
- User token account must already exist
- Updates `total_supply` in TokenInfo

### Errors

| Code | Description |
|------|-------------|
| `UnauthorizedAuthority` | Caller is not the token authority |

---

## transfer_tokens

Transfer GRID tokens between accounts.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `from_token_account` | `Account (mut)` | Source SPL TokenAccount |
| `to_token_account` | `Account (mut)` | Destination SPL TokenAccount |
| `from_authority` | `Signer` | Token owner/delegate |
| `token_program` | `Program` | SPL Token program |

### Arguments

| Name | Type | Description |
|------|------|-------------|
| `amount` | `u64` | Amount to transfer (9 decimals) |

### Example

```typescript
await program.methods
  .transferTokens(new BN(1_000_000_000)) // 1 GRID token
  .accounts({
    fromTokenAccount: senderAta,
    toTokenAccount: recipientAta,
    fromAuthority: wallet.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .rpc();
```

---

## burn_tokens

Burn GRID tokens from holder's account.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `token_info` | `Account (mut)` | Token configuration |
| `mint` | `Account (mut)` | SPL Token mint |
| `token_account` | `Account (mut)` | Source token account |
| `authority` | `Signer` | Token account owner |
| `token_program` | `Program` | SPL Token program |

### Arguments

| Name | Type | Description |
|------|------|-------------|
| `amount` | `u64` | Amount to burn (9 decimals) |

### Example

```typescript
await program.methods
  .burnTokens(new BN(3_000_000_000)) // 3 GRID tokens
  .accounts({
    tokenInfo: tokenInfoPda,
    mint: mintPda,
    tokenAccount: userAta,
    authority: wallet.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .rpc();
```

### Notes

- Decrements `total_supply` in TokenInfo using `saturating_sub`
- Use case: Energy consumption settlement

---

## add_rec_validator

Add a Renewable Energy Certificate validator to the system.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `token_info` | `Account (mut)` | Token configuration (has_one = authority) |
| `authority` | `Signer` | Must match `token_info.authority` |

### Arguments

| Name | Type | Description |
|------|------|-------------|
| `validator_pubkey` | `Pubkey` | Validator's public key |
| `authority_name` | `string` | Validator authority name |

### Example

```typescript
await program.methods
  .addRecValidator(
    validatorPubkey,
    "Thailand Energy Authority"
  )
  .accounts({
    tokenInfo: tokenInfoPda,
    authority: wallet.publicKey,
  })
  .rpc();
```

### Notes

- Currently logs only—no persistent storage of validators
- Requires authority to match `token_info.authority`

---

## Account Structures

### TokenInfo

```rust
pub struct TokenInfo {
    pub authority: Pubkey,      // 32 bytes - Admin authority
    pub mint: Pubkey,           // 32 bytes - GRID mint address
    pub total_supply: u64,      // 8 bytes  - Total minted supply
    pub created_at: i64,        // 8 bytes  - Unix timestamp
}
```

---

## Events

### TokensMinted

```rust
#[event]
pub struct TokensMinted {
    pub recipient: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}
```

### TokensMintedDirect

```rust
#[event]
pub struct TokensMintedDirect {
    pub recipient: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}
```

### GridTokensMinted

```rust
#[event]
pub struct GridTokensMinted {
    pub meter_owner: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}
```

---

## Error Codes

| Code | Name | Description |
|------|------|-------------|
| 6000 | `UnauthorizedAuthority` | Caller is not the token authority |
| 6001 | `InvalidMeter` | Meter not found or invalid |
| 6002 | `InsufficientBalance` | Not enough tokens |
| 6003 | `InvalidMetadataAccount` | Metadata account invalid |
| 6004 | `NoUnsettledBalance` | No unsettled balance to mint |

---

## Token Economics

### Specifications

| Property | Value |
|----------|-------|
| Symbol | GRID |
| Decimals | 9 |
| Initial Supply | 0 |
| Max Supply | Unlimited |
| Mint Authority | TokenInfo PDA (program-controlled) |
| Freeze Authority | None |

### Common Amounts

| Human Readable | Base Units |
|----------------|------------|
| 0.1 GRID | `100_000_000` |
| 1 GRID | `1_000_000_000` |
| 10 GRID | `10_000_000_000` |
| 100 GRID | `100_000_000_000` |

### Supply Model

```
Circulating Supply = Total Minted - Total Burned
```

No hard cap on total supply—backed by actual energy production.

---

## Integration with SPL Token

GRID tokens are standard SPL tokens compatible with:
- Phantom, Solflare, and other Solana wallets
- Jupiter, Raydium DEXs
- Standard token transfers
- Token metadata standards (Metaplex)

---

**Document Version**: 2.0  
**Last Updated**: November 2024
