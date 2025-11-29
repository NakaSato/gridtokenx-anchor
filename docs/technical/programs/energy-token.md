# Energy Token Program - Technical Reference

> **Implementation reference for the Energy Token Program**

Program ID: `9sAB52aZ71ciGhaVwuCg6ohTeWu8H6fDb2B29ohxsFVp`

Source: [`programs/energy-token/src/lib.rs`](../../../programs/energy-token/src/lib.rs)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    ENERGY TOKEN PROGRAM                     │
├─────────────────────────────────────────────────────────────┤
│  PDAs                                                       │
│  ├── token_info: [b"token_info"]  → TokenInfo account      │
│  └── mint: [b"mint"]              → SPL Mint account        │
├─────────────────────────────────────────────────────────────┤
│  External Programs                                          │
│  ├── SPL Token Program (TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA)      │
│  ├── Associated Token Program (ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL) │
│  └── Metaplex Token Metadata (metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s)   │
└─────────────────────────────────────────────────────────────┘
```

---

## Instructions

### `initialize`

Simple program initialization that logs a message.

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `authority` | Signer | Program authority |

---

### `initialize_token`

Creates the `TokenInfo` PDA and program-controlled mint.

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `token_info` | PDA (init, mut) | Token configuration - seeds: `[b"token_info"]` |
| `mint` | PDA (init, mut) | SPL Token mint - seeds: `[b"mint"]` |
| `authority` | Signer (mut) | Initial authority and payer |
| `system_program` | Program | System program |
| `token_program` | Program | SPL Token program |
| `rent` | Sysvar | Rent sysvar |

**Key Features:**
- Mint authority is set to the `token_info` PDA (program-controlled)
- 9 decimal places for precision

**PDA Seeds:**
- `token_info`: `[b"token_info"]`
- `mint`: `[b"mint"]`

---

### `create_token_mint`

Creates a standalone mint with **Metaplex metadata** (Token 2022 compatible).

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `mint` | Signer (init, mut) | New token mint keypair |
| `metadata` | UncheckedAccount (mut) | Metaplex metadata PDA |
| `payer` | Signer (mut) | Transaction fee payer |
| `authority` | Signer | Mint authority |
| `system_program` | Program | System program |
| `token_program` | Interface | SPL Token or Token-2022 program |
| `metadata_program` | UncheckedAccount | Metaplex Token Metadata program |
| `rent` | Sysvar | Rent sysvar |
| `sysvar_instructions` | UncheckedAccount | Sysvar instructions (for Metaplex) |

**Arguments:**
| Name | Type | Description |
|------|------|-------------|
| `name` | String | Token name (e.g., "Grid Renewable Energy Token") |
| `symbol` | String | Token symbol (e.g., "GRID") |
| `uri` | String | Metadata JSON URI |

**Note:** Graceful degradation - falls back to mint-only if Metaplex unavailable (localnet).

---

### `mint_to_wallet`

Mints GRX tokens to a wallet using PDA signing and Token Interface.

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `mint` | InterfaceAccount (mut) | Token mint |
| `token_info` | Account | TokenInfo PDA with `has_one = authority` constraint |
| `destination` | InterfaceAccount (init_if_needed, mut) | Recipient ATA |
| `destination_owner` | AccountInfo | Owner of destination token account |
| `authority` | Signer | Must match `token_info.authority` |
| `payer` | Signer (mut) | Transaction fee payer |
| `token_program` | Interface | SPL Token program |
| `associated_token_program` | Program | Associated Token program |
| `system_program` | Program | System program |

**Arguments:**
| Name | Type | Description |
|------|------|-------------|
| `amount` | u64 | Amount to mint (base units, 9 decimals) |

**Emits:** `TokensMinted { recipient, amount, timestamp }`

---

### `mint_tokens_direct`

Authority-only minting for **off-chain verified meter readings**.

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `token_info` | PDA (mut) | Token configuration - seeds: `[b"token_info"]` |
| `mint` | Account (mut) | SPL Token mint |
| `user_token_account` | Account (mut) | Recipient token account (must exist) |
| `authority` | Signer | Must match `token_info.authority` |
| `token_program` | Program | SPL Token program |

**Arguments:**
| Name | Type | Description |
|------|------|-------------|
| `amount` | u64 | Amount to mint (base units) |

**Key Difference from `mint_to_wallet`:**
- Updates `total_supply` on `TokenInfo`
- Requires existing token account (no `init_if_needed`)

**Emits:** `TokensMintedDirect { recipient, amount, timestamp }`

---

### `transfer_tokens`

Standard SPL transfer wrapper.

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `from_token_account` | Account (mut) | Source SPL TokenAccount |
| `to_token_account` | Account (mut) | Destination SPL TokenAccount |
| `from_authority` | Signer | Token owner/delegate |
| `token_program` | Program | SPL Token program |

**Arguments:**
| Name | Type | Description |
|------|------|-------------|
| `amount` | u64 | Amount to transfer (base units) |

---

### `burn_tokens`

Burns tokens and decrements `total_supply`.

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `token_info` | Account (mut) | Token configuration |
| `mint` | Account (mut) | SPL Token mint |
| `token_account` | Account (mut) | Source token account |
| `authority` | Signer | Token account owner |
| `token_program` | Program | SPL Token program |

**Arguments:**
| Name | Type | Description |
|------|------|-------------|
| `amount` | u64 | Amount to burn (base units) |

**Use Case:** Energy consumption settlement.

---

### `add_rec_validator`

Adds a Renewable Energy Certificate validator to the system.

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `token_info` | Account (mut) | Token configuration with `has_one = authority` |
| `authority` | Signer | Must match `token_info.authority` |

**Arguments:**
| Name | Type | Description |
|------|------|-------------|
| `validator_pubkey` | Pubkey | Validator's public key |
| `authority_name` | String | Validator authority name |

**Note:** Currently logs only—no persistent storage of validators.

---

## Account Structures

### TokenInfo (88 bytes total)

```rust
#[account]
#[derive(InitSpace)]
pub struct TokenInfo {
    pub authority: Pubkey,      // 32 bytes - Admin authority
    pub mint: Pubkey,           // 32 bytes - GRID mint address
    pub total_supply: u64,      // 8 bytes  - Total minted supply
    pub created_at: i64,        // 8 bytes  - Unix timestamp
}
// Space: 8 (discriminator) + 32 + 32 + 8 + 8 = 88 bytes
```

---

## Token Specifications

| Property | Value |
|----------|-------|
| Name | GRID |
| Symbol | GRID |
| Decimals | 9 |
| Initial Supply | 0 |
| Max Supply | Unlimited |
| Mint Authority | TokenInfo PDA (program-controlled) |
| Freeze Authority | None |

---

## Events

```rust
#[event]
pub struct TokensMinted {
    pub recipient: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct TokensMintedDirect {
    pub recipient: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct GridTokensMinted {
    pub meter_owner: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}
```

---

## Errors

```rust
#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized authority")]
    UnauthorizedAuthority,        // 6000
    #[msg("Invalid meter")]
    InvalidMeter,                 // 6001
    #[msg("Insufficient token balance")]
    InsufficientBalance,          // 6002
    #[msg("Invalid metadata account")]
    InvalidMetadataAccount,       // 6003
    #[msg("No unsettled balance")]
    NoUnsettledBalance,           // 6004
}
```

---

## PDA Signing Pattern

The Energy Token program uses PDA signing for trustless minting:

```rust
// PDA acts as mint authority
let seeds = &[b"token_info".as_ref(), &[ctx.bumps.token_info]];
let signer_seeds = &[&seeds[..]];

let cpi_accounts = MintTo {
    mint: ctx.accounts.mint.to_account_info(),
    to: ctx.accounts.user_token_account.to_account_info(),
    authority: ctx.accounts.token_info.to_account_info(),
};

let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
token::mint_to(cpi_ctx, amount)?;
```

---

## Security Model

| Aspect | Implementation |
|--------|----------------|
| **Mint Authority** | PDA-controlled (`token_info` seeds) |
| **Admin Authority** | Single `authority` pubkey in `TokenInfo` |
| **Authorization** | `has_one = authority` constraint + explicit checks |
| **Overflow Protection** | `saturating_add/sub` for supply tracking |

---

## Integration Points

```
┌───────────────┐      ┌─────────────────┐      ┌──────────────┐
│   Registry    │      │  Energy Token   │      │   Trading    │
│   Program     │ ───► │    Program      │ ◄─── │   Program    │
└───────────────┘      └─────────────────┘      └──────────────┘
        │                      │                        │
        │ meter readings       │ mint/burn              │ execute trades
        │                      │                        │
        ▼                      ▼                        ▼
┌───────────────┐      ┌─────────────────┐      ┌──────────────┐
│    Oracle     │      │   SPL Token     │      │  Governance  │
│   Program     │      │   (GRID)        │      │   Program    │
└───────────────┘      └─────────────────┘      └──────────────┘
```

---

*For academic documentation, see [Academic Energy Token Documentation](../../academic/programs/energy-token.md)*
