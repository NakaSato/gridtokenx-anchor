# Energy Token Program - Technical Specification v1.0

> GridTokenX GRID Token Management System - SPL Token Wrapper with PDA Authority

## Overview

The Energy Token Program manages the GRID token—a fungible SPL token representing tradeable energy units on the GridTokenX platform. It implements trustless token minting through Program Derived Address (PDA) authority, supports both SPL Token and Token-2022 interfaces, and provides optional Metaplex metadata integration.

**Program ID:** `9sAB52aZ71ciGhaVwuCg6ohTeWu8H6fDb2B29ohxsFVp`

---

## Architecture

### System Design

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Energy Token Program                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────┐    ┌──────────────────┐    ┌────────────────┐  │
│  │   Token Info    │    │   SPL Token      │    │   Metaplex     │  │
│  │     (PDA)       │    │     Mint         │    │   Metadata     │  │
│  │                 │    │                  │    │  (Optional)    │  │
│  │ • Authority     │    │ • 9 Decimals     │    │                │  │
│  │ • Mint Address  │    │ • PDA Authority  │    │ • Name         │  │
│  │ • Total Supply  │    │ • No Freeze      │    │ • Symbol       │  │
│  │ • Created At    │    │                  │    │ • URI          │  │
│  └─────────────────┘    └──────────────────┘    └────────────────┘  │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                    PDA Authority Pattern                         ││
│  │  TokenInfo PDA → Mint Authority → Trustless Programmatic Minting ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                    External Programs                             ││
│  │  • SPL Token (TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA)      ││
│  │  • Associated Token (ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL)││
│  │  • Metaplex Metadata (metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s)││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Core Components

| Component | Purpose | Key Features |
|-----------|---------|--------------|
| **TokenInfo** | Program configuration and mint authority PDA | authority, mint, total_supply, created_at |
| **Mint** | SPL Token mint account | 9 decimals, PDA-controlled, no freeze authority |
| **Metadata** | Metaplex token metadata (optional) | name, symbol, URI for rich token display |

---

## Program Metadata

| Property | Value |
|----------|-------|
| **Program ID** | `9sAB52aZ71ciGhaVwuCg6ohTeWu8H6fDb2B29ohxsFVp` |
| **Framework** | Anchor v0.32.1 |
| **Language** | Rust |
| **Network** | Solana (Private Network) |
| **Version** | 1.0.0 |
| **Instructions** | 8 |
| **Accounts** | 1 (TokenInfo) |
| **Token Standard** | SPL Token / Token-2022 Compatible |
| **Decimals** | 9 |

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Theoretical Foundation](#theoretical-foundation)
4. [Account Structures](#account-structures)
5. [Instructions](#instructions)
6. [PDA Authority Pattern](#pda-authority-pattern)
7. [Token Economics](#token-economics)
8. [Events](#events)
9. [Error Handling](#error-handling)
10. [Security Model](#security-model)
11. [Cross-Program Integration](#cross-program-integration)
12. [Performance Characteristics](#performance-characteristics)

---

## Theoretical Foundation

### Energy Tokenization Model

The GRID token implements a 1:1 tokenization model for renewable energy:

$$1 \text{ GRID} = 1 \text{ kWh} = 10^9 \text{ base units}$$

This model provides:
- **Intuitive mapping**: Direct correspondence to physical energy units
- **High precision**: 9 decimal places for micro-transactions
- **Auditability**: Token supply reflects actual energy generation
- **Composability**: Standard SPL token works with all Solana DeFi

### Why PDA Mint Authority?

The program uses a Program Derived Address (PDA) as the mint authority for trustless token issuance:

| Approach | Trust Model | Risk | Implementation |
|----------|-------------|------|----------------|
| **Private Key Mint** | Centralized | Key compromise = unlimited minting | Traditional |
| **Multi-sig Mint** | N-of-M | Collusion risk | Complex |
| **DAO-controlled** | Token voting | Governance attacks | Very complex |
| **PDA Mint Authority** | Trustless | None (programmatic only) | **Implemented** |

**Key Security Property:** No private key exists that can mint tokens—only program logic can authorize minting.

### SPL Token Integration

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SPL TOKEN INTEGRATION                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   GRID Token Properties                                                      │
│   ═════════════════════                                                      │
│                                                                              │
│   ┌───────────────────┐                                                      │
│   │   SPL Token Mint  │                                                      │
│   ├───────────────────┤                                                      │
│   │ Decimals: 9       │ ◀── Same as SOL for intuitive amounts               │
│   │ Mint Authority:   │                                                      │
│   │   TokenInfo PDA   │ ◀── Trustless, program-controlled                   │
│   │ Freeze Authority: │                                                      │
│   │   None            │ ◀── Tokens cannot be frozen                         │
│   │ Supply: Unlimited │ ◀── Backed by energy production                     │
│   └───────────────────┘                                                      │
│                                                                              │
│   Compatibility                                                              │
│   ═════════════                                                              │
│   ✓ All Solana wallets (Phantom, Solflare, etc.)                            │
│   ✓ DEX protocols (Jupiter, Raydium, Orca)                                  │
│   ✓ Token metadata standards (Metaplex)                                     │
│   ✓ Token-2022 interface support                                            │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Account Structures

### TokenInfo Account

Global configuration storing token state and serving as mint authority PDA.

| Field | Type | Size | Description |
|-------|------|------|-------------|
| `authority` | Pubkey | 32 bytes | Administrative authority (can trigger minting) |
| `mint` | Pubkey | 32 bytes | GRID token mint address |
| `total_supply` | u64 | 8 bytes | Total tokens minted (tracked separately from mint supply) |
| `created_at` | i64 | 8 bytes | Token info creation timestamp |

**PDA Seeds:** `[b"token_info"]`

**Space Calculation:**
```
8 (discriminator) + 32 (authority) + 32 (mint) + 8 (total_supply) + 8 (created_at) = 88 bytes
```

### Mint Account (Program-Controlled)

SPL Token mint account created during initialization.

| Property | Value | Description |
|----------|-------|-------------|
| Decimals | 9 | Same precision as SOL |
| Mint Authority | TokenInfo PDA | Program-controlled minting |
| Freeze Authority | None | Tokens cannot be frozen |
| Supply | Variable | Grows with energy production |

**PDA Seeds:** `[b"mint"]`

---

## Instructions

### Instruction Summary (8 Total)

| # | Instruction | Type | Authority | State Changes |
|---|-------------|------|-----------|---------------|
| 1 | `initialize` | Admin | Any | Logs initialization |
| 2 | `initialize_token` | Write | Deployer | Creates TokenInfo + Mint PDAs |
| 3 | `create_token_mint` | Write | Authority | Creates standalone mint with metadata |
| 4 | `mint_to_wallet` | Write | Authority | Mints tokens via PDA signing |
| 5 | `mint_tokens_direct` | Write | Authority | Mints + updates total_supply |
| 6 | `transfer_tokens` | Write | Token Owner | Standard SPL transfer |
| 7 | `burn_tokens` | Write | Token Owner | Burns tokens, decrements supply |
| 8 | `add_rec_validator` | Admin | Authority | Logs validator addition |

---

### 1. initialize

Simple program initialization that logs a message.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `authority` | Signer | Program authority |

**State Changes:** None (logs only)

**Events Emitted:** None

---

### 2. initialize_token

Creates the TokenInfo PDA and program-controlled mint.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `token_info` | PDA (init) | Token configuration - seeds: `[b"token_info"]` |
| `mint` | PDA (init) | SPL Token mint - seeds: `[b"mint"]` |
| `authority` | Signer (mut) | Initial authority and payer |
| `system_program` | Program | System program |
| `token_program` | Program | SPL Token program |
| `rent` | Sysvar | Rent sysvar |

**PDA Derivation:**
```rust
// TokenInfo PDA
let (token_info_pda, bump) = Pubkey::find_program_address(
    &[b"token_info"],
    &program_id
);

// Mint PDA  
let (mint_pda, bump) = Pubkey::find_program_address(
    &[b"mint"],
    &program_id
);
```

**State Changes:**
- Creates TokenInfo account with:
  - `authority` = signer
  - `mint` = mint PDA
  - `total_supply` = 0
  - `created_at` = current timestamp
- Creates Mint account with:
  - `decimals` = 9
  - `mint_authority` = token_info PDA
  - `freeze_authority` = None

**Key Feature:** Mint authority is the TokenInfo PDA, enabling trustless minting.

---

### 3. create_token_mint

Creates a standalone mint with Metaplex metadata (Token-2022 compatible).

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `mint` | Signer (init) | New token mint keypair |
| `metadata` | UncheckedAccount (mut) | Metaplex metadata PDA |
| `payer` | Signer (mut) | Transaction fee payer |
| `authority` | Signer | Mint authority |
| `system_program` | Program | System program |
| `token_program` | Interface | SPL Token or Token-2022 |
| `metadata_program` | UncheckedAccount | Metaplex Token Metadata |
| `rent` | Sysvar | Rent sysvar |
| `sysvar_instructions` | UncheckedAccount | Sysvar instructions |

**Arguments:**

| Argument | Type | Constraints | Description |
|----------|------|-------------|-------------|
| `name` | String | - | Token name (e.g., "Grid Renewable Energy Token") |
| `symbol` | String | - | Token symbol (e.g., "GRID") |
| `uri` | String | - | Metadata JSON URI |

**Metaplex CPI:**
```rust
CreateV1CpiBuilder::new(&metadata_program)
    .metadata(&metadata)
    .mint(&mint, true)
    .authority(&authority)
    .payer(&payer)
    .name(name)
    .symbol(symbol)
    .uri(uri)
    .seller_fee_basis_points(0)
    .decimals(9)
    .token_standard(TokenStandard::Fungible)
    .print_supply(PrintSupply::Zero)
    .invoke()?;
```

**Graceful Degradation:** Falls back to mint-only creation if Metaplex program unavailable (localnet).

---

### 4. mint_to_wallet

Mints GRID tokens to a wallet using PDA signing. Creates ATA if needed.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `mint` | InterfaceAccount (mut) | Token mint |
| `token_info` | Account | TokenInfo PDA (has_one = authority) |
| `destination` | InterfaceAccount (init_if_needed, mut) | Recipient ATA |
| `destination_owner` | AccountInfo | Owner of destination token account |
| `authority` | Signer | Must match `token_info.authority` |
| `payer` | Signer (mut) | Transaction fee payer |
| `token_program` | Interface | SPL Token program |
| `associated_token_program` | Program | Associated Token program |
| `system_program` | Program | System program |

**Arguments:**

| Argument | Type | Unit | Description |
|----------|------|------|-------------|
| `amount` | u64 | Base units | Amount to mint (9 decimals) |

**PDA Signing:**
```rust
let seeds = &[b"token_info".as_ref(), &[ctx.bumps.token_info]];
let signer_seeds = &[&seeds[..]];

token_interface::mint_to(
    CpiContext::new_with_signer(token_program, cpi_accounts, signer_seeds),
    amount
)?;
```

**Events Emitted:** `TokensMinted`

---

### 5. mint_tokens_direct

Authority-only minting for off-chain verified meter readings. Updates `total_supply`.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `token_info` | PDA (mut) | Token configuration - seeds: `[b"token_info"]` |
| `mint` | Account (mut) | SPL Token mint |
| `user_token_account` | Account (mut) | Recipient token account (must exist) |
| `authority` | Signer | Must match `token_info.authority` |
| `token_program` | Program | SPL Token program |

**Arguments:**

| Argument | Type | Unit | Description |
|----------|------|------|-------------|
| `amount` | u64 | Base units | Amount to mint (9 decimals) |

**Validation:**
```rust
require!(
    ctx.accounts.authority.key() == ctx.accounts.token_info.authority,
    ErrorCode::UnauthorizedAuthority
);
```

**State Changes:**
- Mints `amount` tokens to `user_token_account`
- Increments `token_info.total_supply` by `amount` (using `saturating_add`)

**Events Emitted:** `TokensMintedDirect`

**Key Difference from `mint_to_wallet`:**
- Updates `total_supply` counter on TokenInfo
- Requires existing token account (no auto-creation)
- Designed for CPI calls from Registry program

---

### 6. transfer_tokens

Standard SPL transfer wrapper for convenience.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `from_token_account` | Account (mut) | Source SPL TokenAccount |
| `to_token_account` | Account (mut) | Destination SPL TokenAccount |
| `from_authority` | Signer | Token owner/delegate |
| `token_program` | Program | SPL Token program |

**Arguments:**

| Argument | Type | Unit | Description |
|----------|------|------|-------------|
| `amount` | u64 | Base units | Amount to transfer (9 decimals) |

**Note:** This wraps standard SPL transfer—clients can also use SPL Token directly.

---

### 7. burn_tokens

Burns tokens and decrements `total_supply`.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `token_info` | Account (mut) | Token configuration |
| `mint` | Account (mut) | SPL Token mint |
| `token_account` | Account (mut) | Source token account |
| `authority` | Signer | Token account owner |
| `token_program` | Program | SPL Token program |

**Arguments:**

| Argument | Type | Unit | Description |
|----------|------|------|-------------|
| `amount` | u64 | Base units | Amount to burn (9 decimals) |

**State Changes:**
- Burns `amount` tokens from `token_account`
- Decrements `token_info.total_supply` by `amount` (using `saturating_sub`)

**Use Case:** Energy consumption settlement—consumers burn GRID tokens when consuming energy.

---

### 8. add_rec_validator

Adds a Renewable Energy Certificate validator (logging only in current version).

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `token_info` | Account (mut) | Token configuration (has_one = authority) |
| `authority` | Signer | Must match `token_info.authority` |

**Arguments:**

| Argument | Type | Description |
|----------|------|-------------|
| `validator_pubkey` | Pubkey | Validator's public key |
| `authority_name` | String | Validator authority name |

**Current Implementation:** Logs validator addition only. Future versions may store validator registry.

---

## PDA Authority Pattern

### How It Works

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      PDA AUTHORITY PATTERN                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   TRADITIONAL APPROACH (Risky)                                               │
│   ════════════════════════════                                               │
│                                                                              │
│   Private Key ───▶ Mint Authority ───▶ mint_to() ───▶ New Tokens            │
│       ↑                                                                      │
│       └── If compromised, unlimited minting possible!                        │
│                                                                              │
│   ─────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│   PDA AUTHORITY APPROACH (Trustless)                                         │
│   ══════════════════════════════════                                         │
│                                                                              │
│   TokenInfo PDA ◀── Created with seeds ["token_info"]                        │
│        │                                                                     │
│        │ Set as mint authority during initialize_token                       │
│        ▼                                                                     │
│   Mint Account ───▶ mint_authority = TokenInfo PDA                           │
│                                                                              │
│   Minting Flow:                                                              │
│   ═════════════                                                              │
│   Authority ───▶ mint_to_wallet() ───┬──▶ Verify authority matches ✓        │
│     Signer                           ├──▶ Derive PDA signer seeds           │
│                                      ├──▶ CPI with PDA signature            │
│                                      └──▶ Tokens minted                      │
│                                                                              │
│   KEY SECURITY:                                                              │
│   • No private key for mint authority exists                                 │
│   • Only Energy Token program can sign as PDA                                │
│   • Program logic validates all minting requests                             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### PDA Signing Implementation

```rust
pub fn mint_to_wallet(ctx: Context<MintToWallet>, amount: u64) -> Result<()> {
    // Derive PDA signer seeds
    let seeds = &[b"token_info".as_ref(), &[ctx.bumps.token_info]];
    let signer = &[&seeds[..]];

    // CPI to SPL Token with PDA signature
    let cpi_accounts = token_interface::MintTo {
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.destination.to_account_info(),
        authority: ctx.accounts.token_info.to_account_info(),  // PDA signs
    };

    token_interface::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer  // PDA signer seeds
        ),
        amount
    )?;

    Ok(())
}
```

---

## Token Economics

### Supply Mechanics

| Category | Behavior |
|----------|----------|
| Initial Supply | 0 (no pre-mint) |
| Maximum Supply | Unlimited (demand-driven) |
| Minting Trigger | Verified energy generation |
| Burning Trigger | Energy consumption settlement |
| Freeze | Not supported (no freeze authority) |

### Supply Formula

$$S(t) = \sum_{i=0}^{t} M_i - \sum_{j=0}^{t} B_j$$

Where:
- $S(t)$ = Total supply at time $t$
- $M_i$ = Minted tokens in period $i$
- $B_j$ = Burned tokens in period $j$

### Value Backing

GRID tokens derive value from:

1. **Physical Backing**: Each token represents 1 kWh of verified renewable energy
2. **Utility**: Required for P2P energy trading on the platform
3. **Supply Constraint**: Limited by actual energy production (not arbitrary)
4. **Demand**: Energy consumers need tokens to purchase energy

### Common Amounts

| Human Readable | Base Units | Code Example |
|----------------|------------|--------------|
| 0.1 GRID | 100,000,000 | `100_000_000` |
| 1 GRID | 1,000,000,000 | `1_000_000_000` |
| 10 GRID | 10,000,000,000 | `10_000_000_000` |
| 100 GRID | 100,000,000,000 | `100_000_000_000` |

---

## Events

### Event Definitions (3 Total)

| Event | Trigger | Fields |
|-------|---------|--------|
| `TokensMinted` | `mint_to_wallet` | recipient, amount, timestamp |
| `TokensMintedDirect` | `mint_tokens_direct` | recipient, amount, timestamp |
| `GridTokensMinted` | Grid meter minting | meter_owner, amount, timestamp |

### Event Structures

```rust
#[event]
pub struct TokensMinted {
    pub recipient: Pubkey,      // Destination token account
    pub amount: u64,            // Amount minted (base units)
    pub timestamp: i64,         // Unix timestamp
}

#[event]
pub struct TokensMintedDirect {
    pub recipient: Pubkey,      // Destination token account
    pub amount: u64,            // Amount minted (base units)
    pub timestamp: i64,         // Unix timestamp
}

#[event]
pub struct GridTokensMinted {
    pub meter_owner: Pubkey,    // Meter owner wallet
    pub amount: u64,            // Amount minted (base units)
    pub timestamp: i64,         // Unix timestamp
}
```

### Event Usage

| Event | Analytics Use Case |
|-------|-------------------|
| `TokensMinted` | Track minting via wallet interface |
| `TokensMintedDirect` | Track CPI minting from Registry |
| `GridTokensMinted` | Track meter-based minting |

---

## Error Handling

### Error Codes (5 Total)

| Code | Name | Message | Trigger |
|------|------|---------|---------|
| 6000 | `UnauthorizedAuthority` | Unauthorized authority | Signer ≠ token_info.authority |
| 6001 | `InvalidMeter` | Invalid meter | Meter validation failed |
| 6002 | `InsufficientBalance` | Insufficient token balance | Burn/transfer exceeds balance |
| 6003 | `InvalidMetadataAccount` | Invalid metadata account | Metaplex account validation failed |
| 6004 | `NoUnsettledBalance` | No unsettled balance | Settlement with zero balance |

### Error Definition

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

## Security Model

### Access Control Matrix

| Instruction | Public | Token Holder | Authority | 
|-------------|:------:|:------------:|:---------:|
| `initialize` | ✓ | ✓ | ✓ |
| `initialize_token` | | | ✓ |
| `create_token_mint` | | | ✓ |
| `mint_to_wallet` | | | ✓ |
| `mint_tokens_direct` | | | ✓ |
| `transfer_tokens` | | ✓ | |
| `burn_tokens` | | ✓ | |
| `add_rec_validator` | | | ✓ |

### Security Constraints

| Constraint | Implementation | Error |
|------------|----------------|-------|
| Authority validation | `has_one = authority` | `UnauthorizedAuthority` |
| PDA mint authority | Mint authority = TokenInfo PDA | N/A (structural) |
| Supply overflow protection | `saturating_add` / `saturating_sub` | N/A (safe math) |
| No freeze authority | Set to None at initialization | N/A (structural) |

### Anchor Constraints Used

```rust
#[derive(Accounts)]
pub struct MintToWallet<'info> {
    #[account(mut)]
    pub mint: InterfaceAccount<'info, MintInterface>,

    #[account(
        seeds = [b"token_info"],
        bump,
        has_one = authority,  // ← Authority constraint
    )]
    pub token_info: Account<'info, TokenInfo>,
    
    // ...
}
```

---

## Cross-Program Integration

### Integration Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      CROSS-PROGRAM INTEGRATION                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌─────────────────┐                     ┌─────────────────┐               │
│   │    REGISTRY     │                     │    TRADING      │               │
│   │     Program     │                     │    Program      │               │
│   ├─────────────────┤                     ├─────────────────┤               │
│   │                 │                     │                 │               │
│   │ settle_and_     │───CPI──┐            │ execute_trade   │               │
│   │ mint_tokens     │        │            │                 │               │
│   │                 │        │            │                 │               │
│   └─────────────────┘        │            └────────┬────────┘               │
│                              │                     │                        │
│                              ▼                     │ Transfer               │
│                   ┌─────────────────┐              │ GRID tokens            │
│                   │  ENERGY TOKEN   │              │                        │
│                   │    Program      │◀─────────────┘                        │
│                   ├─────────────────┤                                       │
│                   │                 │                                       │
│                   │ mint_tokens_    │                                       │
│                   │ direct          │                                       │
│                   │                 │                                       │
│                   │ transfer_tokens │                                       │
│                   │                 │                                       │
│                   │ burn_tokens     │                                       │
│                   │                 │                                       │
│                   └────────┬────────┘                                       │
│                            │                                                │
│                            ▼                                                │
│                   ┌─────────────────┐                                       │
│                   │   SPL TOKEN     │                                       │
│                   │   (GRID Mint)   │                                       │
│                   └─────────────────┘                                       │
│                                                                              │
│   ┌─────────────────┐                     ┌─────────────────┐               │
│   │   GOVERNANCE    │                     │     ORACLE      │               │
│   │    Program      │                     │    Program      │               │
│   ├─────────────────┤                     ├─────────────────┤               │
│   │                 │                     │                 │               │
│   │ ERC issuance    │                     │ Price feeds     │               │
│   │ linked to       │                     │ for token       │               │
│   │ GRID tokens     │                     │ valuation       │               │
│   │                 │                     │                 │               │
│   └─────────────────┘                     └─────────────────┘               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### CPI from Registry Program

The Registry Program uses CPI to mint tokens after settling meter balances:

```rust
// In Registry Program
pub fn settle_and_mint_tokens(ctx: Context<SettleAndMintTokens>) -> Result<()> {
    // 1. Calculate unsettled energy
    let unsettled = calculate_unsettled_balance(&ctx.accounts.meter_account)?;
    
    // 2. Update settlement tracker
    ctx.accounts.meter_account.settled_net_generation += unsettled;
    
    // 3. CPI to Energy Token Program
    let cpi_accounts = MintTokensDirect {
        token_info: ctx.accounts.token_info.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        user_token_account: ctx.accounts.user_token_account.to_account_info(),
        authority: ctx.accounts.authority.to_account_info(),
        token_program: ctx.accounts.token_program.to_account_info(),
    };
    
    energy_token::cpi::mint_tokens_direct(
        CpiContext::new(
            ctx.accounts.energy_token_program.to_account_info(),
            cpi_accounts
        ),
        unsettled
    )?;
    
    Ok(())
}
```

---

## Performance Characteristics

### Compute Units by Instruction

| Instruction | Compute Units | Accounts | Space Created |
|-------------|---------------|----------|---------------|
| `initialize` | ~5,000 | 1 | 0 bytes |
| `initialize_token` | ~45,000 | 6 | 88 + 82 bytes |
| `create_token_mint` | ~65,000 | 9 | 82 + ~600 bytes |
| `mint_to_wallet` | ~40,000 | 9 | ~165 bytes (ATA) |
| `mint_tokens_direct` | ~35,000 | 5 | 0 bytes |
| `transfer_tokens` | ~25,000 | 4 | 0 bytes |
| `burn_tokens` | ~30,000 | 5 | 0 bytes |
| `add_rec_validator` | ~8,000 | 2 | 0 bytes |

### Account Rent Costs

| Account | Size | Rent (SOL) |
|---------|------|------------|
| TokenInfo | 88 bytes | ~0.00114 |
| Mint | 82 bytes | ~0.00106 |
| Token Account (ATA) | 165 bytes | ~0.00203 |
| Metadata | ~600 bytes | ~0.00567 |

---

## Appendix: TypeScript SDK Usage

### Initialization

```typescript
import { Program, AnchorProvider, web3 } from "@coral-xyz/anchor";
import { EnergyToken } from "./types/energy_token";

// Find PDAs
const [tokenInfoPda] = web3.PublicKey.findProgramAddressSync(
  [Buffer.from("token_info")],
  program.programId
);

const [mintPda] = web3.PublicKey.findProgramAddressSync(
  [Buffer.from("mint")],
  program.programId
);

// Initialize token
await program.methods
  .initializeToken()
  .accounts({
    tokenInfo: tokenInfoPda,
    mint: mintPda,
    authority: wallet.publicKey,
    systemProgram: web3.SystemProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID,
    rent: web3.SYSVAR_RENT_PUBKEY,
  })
  .rpc();
```

### Minting Tokens

```typescript
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";

const recipientAta = getAssociatedTokenAddressSync(mintPda, recipientWallet);

await program.methods
  .mintToWallet(new BN(5_000_000_000)) // 5 GRID tokens
  .accounts({
    mint: mintPda,
    tokenInfo: tokenInfoPda,
    destination: recipientAta,
    destinationOwner: recipientWallet,
    authority: wallet.publicKey,
    payer: wallet.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: web3.SystemProgram.programId,
  })
  .rpc();
```

### Fetching Token Info

```typescript
const tokenInfo = await program.account.tokenInfo.fetch(tokenInfoPda);

console.log("Authority:", tokenInfo.authority.toBase58());
console.log("Mint:", tokenInfo.mint.toBase58());
console.log("Total Supply:", tokenInfo.totalSupply.toString());
console.log("Created At:", new Date(tokenInfo.createdAt.toNumber() * 1000));
```

---

## Changelog

### v1.0.0 (Current)
- Initial release
- PDA-controlled mint authority
- SPL Token and Token-2022 interface support
- Metaplex metadata integration
- `mint_to_wallet` with auto ATA creation
- `mint_tokens_direct` for CPI minting
- `burn_tokens` for supply reduction
- Event emission for all minting operations

### Planned for v2.0
- Validator registry storage
- Rate limiting for minting
- Multi-authority support
- Enhanced metadata management

---

*Last Updated: November 2025*
*Version: 1.0.0*
