# Energy Token Program - Technical Reference

> **Implementation reference for the Energy Token Program**

Program ID: `94G1r674LmRDmLN2UPjDFD8Eh7zT8JaSaxv9v68GyEur`

Source: [`programs/energy-token/src/lib.rs`](../../../programs/energy-token/src/lib.rs)

---

## Instructions

### `initialize_token`

Creates token configuration and SPL mint.

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `token_info` | PDA (mut) | Token configuration |
| `mint` | PDA (mut) | SPL Token mint |
| `authority` | Signer | Initial authority |
| `token_program` | Program | SPL Token program |
| `system_program` | Program | System program |
| `rent` | Sysvar | Rent sysvar |

**PDA Seeds:**
- `token_info`: `["token_info"]`
- `mint`: `["mint"]`

---

### `mint_tokens`

Mints tokens to a recipient (authority only).

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `token_info` | PDA (mut) | Token configuration |
| `mint` | Account (mut) | SPL Token mint |
| `recipient` | Account (mut) | Recipient token account |
| `authority` | Signer | Token authority |
| `token_program` | Program | SPL Token program |

**Arguments:**
| Name | Type | Description |
|------|------|-------------|
| `amount` | u64 | Amount to mint (base units) |

---

### `mint_tokens_direct`

Mints tokens via CPI from Registry.

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `token_info` | PDA (mut) | Token configuration |
| `mint` | Account (mut) | SPL Token mint |
| `recipient` | Account (mut) | Recipient token account |
| `token_info_authority` | PDA | Mint authority (PDA) |
| `token_program` | Program | SPL Token program |

**Arguments:**
| Name | Type | Description |
|------|------|-------------|
| `amount` | u64 | Amount to mint (base units) |

**Note:** This instruction validates the CPI caller is the Registry program.

---

### `burn_tokens`

Burns tokens from holder's account.

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `token_info` | PDA (mut) | Token configuration |
| `mint` | Account (mut) | SPL Token mint |
| `token_account` | Account (mut) | Source token account |
| `owner` | Signer | Token account owner |
| `token_program` | Program | SPL Token program |

**Arguments:**
| Name | Type | Description |
|------|------|-------------|
| `amount` | u64 | Amount to burn (base units) |

---

### `enable_minting` / `disable_minting`

Controls minting capability.

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `token_info` | PDA (mut) | Token configuration |
| `authority` | Signer | Token authority |

---

## Account Structures

### TokenInfo

```rust
#[account]
pub struct TokenInfo {
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub total_supply: u64,
    pub circulating_supply: u64,
    pub burned: u64,
    pub mint_enabled: bool,
    pub created_at: i64,
    pub bump: u8,
}
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
| Freeze Authority | None |

---

## Events

```rust
#[event]
pub struct TokenInitialized {
    pub mint: Pubkey,
    pub authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct TokensMinted {
    pub recipient: Pubkey,
    pub amount: u64,
    pub new_total_supply: u64,
    pub timestamp: i64,
}

#[event]
pub struct TokensBurned {
    pub burner: Pubkey,
    pub amount: u64,
    pub new_total_supply: u64,
    pub timestamp: i64,
}

#[event]
pub struct MintingEnabled {
    pub authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct MintingDisabled {
    pub authority: Pubkey,
    pub timestamp: i64,
}
```

---

## Errors

```rust
#[error_code]
pub enum EnergyTokenError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Minting is disabled")]
    MintingDisabled,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Invalid recipient")]
    InvalidRecipient,
    #[msg("Supply overflow")]
    SupplyOverflow,
    #[msg("Insufficient balance")]
    InsufficientBalance,
    #[msg("Invalid CPI caller")]
    InvalidCpiCaller,
}
```

---

## CPI Interface

The Energy Token program exposes a CPI interface for the Registry program:

```rust
// In registry program
use energy_token::cpi::accounts::MintTokensDirect;
use energy_token::cpi::mint_tokens_direct;

let cpi_accounts = MintTokensDirect {
    token_info: ctx.accounts.token_info.to_account_info(),
    mint: ctx.accounts.mint.to_account_info(),
    recipient: ctx.accounts.user_token_account.to_account_info(),
    token_info_authority: ctx.accounts.token_info_authority.to_account_info(),
    token_program: ctx.accounts.token_program.to_account_info(),
};

let cpi_ctx = CpiContext::new_with_signer(
    ctx.accounts.energy_token_program.to_account_info(),
    cpi_accounts,
    signer_seeds,
);

mint_tokens_direct(cpi_ctx, amount)?;
```

---

*For academic documentation, see [Academic Energy Token Documentation](../../academic/programs/energy-token.md)*
