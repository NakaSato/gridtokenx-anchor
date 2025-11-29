# Energy Token Program

> **Academic Documentation - GRID Token Management System**

Program ID: `9sAB52aZ71ciGhaVwuCg6ohTeWu8H6fDb2B29ohxsFVp`

---

## Overview

The Energy Token Program manages the GRID token—a fungible SPL token representing tradeable energy units. It implements the token minting mechanism, supply controls, and serves as the mint authority through a Program Derived Address (PDA) pattern. The program supports both SPL Token and Token-2022 interfaces with optional Metaplex metadata.

---

## Theoretical Foundation

### Energy Tokenization Model

The GRID token implements a 1:1 tokenization model:

$$1 \text{ GRID} = 1 \text{ kWh} = 10^9 \text{ base units}$$

This model provides:
- **Intuitive mapping**: Direct correspondence to physical energy
- **High precision**: 9 decimal places for micro-transactions
- **Auditability**: Token supply reflects actual energy generation

### Why SPL Token Standard?

The program uses Solana's SPL Token standard for:

| Feature | Benefit |
|---------|---------|
| Composability | Works with all Solana DeFi protocols |
| Wallet support | Compatible with all Solana wallets |
| Standardization | Well-audited, battle-tested code |
| Efficiency | Optimized for Solana's architecture |
| Token-2022 Ready | Interface supports next-gen token features |

---

## Account Architecture

### TokenInfo Account

Program configuration and mint authority PDA.

| Field | Type | Size | Description |
|-------|------|------|-------------|
| `authority` | Pubkey | 32 bytes | Administrative authority |
| `mint` | Pubkey | 32 bytes | SPL Token mint address |
| `total_supply` | u64 | 8 bytes | Total tokens ever minted |
| `created_at` | i64 | 8 bytes | Initialization timestamp |

**Total Size**: 8 (discriminator) + 80 = 88 bytes

**PDA Derivation**: Seeds = `[b"token_info"]`

### Mint Account

Standard SPL Token mint with PDA authority.

| Property | Value |
|----------|-------|
| Decimals | 9 |
| Mint Authority | TokenInfo PDA |
| Freeze Authority | None (non-freezable) |

**PDA Derivation**: Seeds = `[b"mint"]`

---

## PDA Authority Pattern

### Trustless Minting Architecture

The Energy Token Program implements a trustless minting pattern using PDAs:

**Traditional Approach (Problematic):**
- Private key controls mint authority
- Key compromise = unlimited minting
- Requires secure key management

**PDA Approach (Implemented):**
- No private key exists for mint authority
- Only program logic can sign for minting
- Mathematically impossible to compromise

### How PDA Signing Works

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

1. TokenInfo PDA is set as mint authority
2. Minting requires PDA signature
3. Only Energy Token Program can derive PDA signer seeds
4. Program validates all minting requests before signing

This ensures tokens can only be minted through authorized program logic.

---

## Token Economics

### Supply Mechanics

| Category | Behavior |
|----------|----------|
| Initial Supply | 0 (no pre-mint) |
| Maximum Supply | Unlimited (demand-driven) |
| Minting | Tied to verified energy generation |
| Burning | Enabled for energy redemption |

### Supply Formula

Total supply grows with verified energy production:

$$S(t) = \sum_{i=0}^{t} M_i - \sum_{j=0}^{t} B_j$$

Where:
- $S(t)$ = Total supply at time $t$
- $M_i$ = Minted tokens in period $i$
- $B_j$ = Burned tokens in period $j$

### Token Value Proposition

GRID tokens derive value from:

1. **Physical backing**: Each token represents 1 kWh of generated energy
2. **Utility**: Required for P2P energy trading
3. **Scarcity**: Supply limited by actual energy production
4. **Demand**: Consumers need tokens to purchase energy

---

## Instructions

### Administrative Instructions

| Instruction | Authority | Description |
|-------------|-----------|-------------|
| `initialize` | Any | Simple program initialization (logs only) |
| `initialize_token` | Deployer | Create TokenInfo PDA and mint |
| `add_rec_validator` | Authority | Register REC validator (logging only) |

### Token Creation Instructions

| Instruction | Signer | Description |
|-------------|--------|-------------|
| `create_token_mint` | Authority | Create standalone mint with Metaplex metadata |

### Minting Instructions

| Instruction | Signer | Description |
|-------------|--------|-------------|
| `mint_to_wallet` | Authority | Mint tokens with auto ATA creation |
| `mint_tokens_direct` | Authority | Mint to existing account, update supply |

### Transfer & Burn Instructions

| Instruction | Signer | Description |
|-------------|--------|-------------|
| `transfer_tokens` | Token Owner | Standard SPL transfer |
| `burn_tokens` | Token Owner | Burn tokens, decrement supply |

---

## Cross-Program Integration

### System Architecture

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

### CPI Integration Pattern

The Energy Token program can be invoked via CPI from other programs:

```rust
// From Registry program - mint tokens for meter settlement
let cpi_accounts = MintTokensDirect {
    token_info: ctx.accounts.token_info.to_account_info(),
    mint: ctx.accounts.mint.to_account_info(),
    user_token_account: ctx.accounts.user_token_account.to_account_info(),
    authority: ctx.accounts.registry_authority.to_account_info(),
    token_program: ctx.accounts.token_program.to_account_info(),
};

let cpi_ctx = CpiContext::new(
    ctx.accounts.energy_token_program.to_account_info(),
    cpi_accounts,
);

energy_token::cpi::mint_tokens_direct(cpi_ctx, amount)?;
```

---

## Security Model

### Access Control Matrix

| Operation | Public | Holder | Authority |
|-----------|:------:|:------:|:---------:|
| View info | ✓ | ✓ | ✓ |
| Transfer | | ✓ | |
| Burn | | ✓ | |
| Mint | | | ✓ |
| Configure | | | ✓ |

### Constraint Mechanisms

```rust
// Authority validation via Anchor constraint
#[account(
    mut,
    seeds = [b"token_info"],
    bump,
    has_one = authority @ ErrorCode::UnauthorizedAuthority
)]
pub token_info: Account<'info, TokenInfo>,
```

### Threat Mitigations

| Threat | Mitigation |
|--------|------------|
| Unauthorized minting | PDA authority + has_one constraint |
| Supply manipulation | Immutable mint logic in program |
| Overflow attacks | `saturating_add/sub` for supply |
| Double-minting | Registry tracker prevents |
| Authority compromise | PDA minting (no private key) |

### Audit Trail

All token operations emit events for:
- Complete transaction history
- Supply reconciliation
- Regulatory compliance

---

## Events

| Event | Trigger | Key Fields |
|-------|---------|------------|
| `TokensMinted` | `mint_to_wallet` | recipient, amount, timestamp |
| `TokensMintedDirect` | `mint_tokens_direct` | recipient, amount, timestamp |
| `GridTokensMinted` | Grid meter minting | meter_owner, amount, timestamp |

---

## Errors

| Error Code | Name | Description |
|------------|------|-------------|
| 6000 | `UnauthorizedAuthority` | Caller lacks authority |
| 6001 | `InvalidMeter` | Meter account invalid |
| 6002 | `InsufficientBalance` | Not enough tokens |
| 6003 | `InvalidMetadataAccount` | Metadata account invalid |
| 6004 | `NoUnsettledBalance` | No balance to settle |

---

## Metaplex Integration

### Token Metadata Support

The `create_token_mint` instruction supports optional Metaplex metadata:

```rust
CreateV1CpiBuilder::new(&ctx.accounts.metadata_program)
    .metadata(&ctx.accounts.metadata)
    .mint(&ctx.accounts.mint, true)
    .authority(&ctx.accounts.authority)
    .name(name)
    .symbol(symbol)
    .uri(uri)
    .token_standard(TokenStandard::Fungible)
    .print_supply(PrintSupply::Zero)
    .invoke()?;
```

**Graceful Degradation**: Falls back to mint-only if Metaplex unavailable (localnet testing).

---

## Research Implications

### Contribution to Literature

The Energy Token Program demonstrates:

1. **PDA Authority Pattern**: Trustless token minting without key custody
2. **Supply-Constrained Tokenization**: Physical asset backing
3. **Cross-Program Token Operations**: Composable DeFi primitives
4. **Token Interface Flexibility**: SPL Token and Token-2022 support

### Comparison with Other Approaches

| Approach | Trust Model | Flexibility | Complexity |
|----------|-------------|-------------|------------|
| **PDA Mint Authority** | Trustless | High | Medium |
| Multi-sig Mint | N-of-M | Medium | High |
| DAO-controlled | Token voting | High | Very High |
| Centralized | Single entity | Low | Low |

### Performance Characteristics

| Metric | Value |
|--------|-------|
| Mint compute units | ~40,000 CU |
| Burn compute units | ~30,000 CU |
| Transfer compute units | ~25,000 CU |
| Account rent (TokenInfo) | ~0.002 SOL |

---

## Future Considerations

### Potential Enhancements

1. **Validator Registry**: Persistent storage for REC validators
2. **Minting Caps**: Per-period minting limits
3. **Transfer Hooks**: Token-2022 transfer hook integration
4. **Confidential Transfers**: Privacy-preserving token transfers

### Upgrade Path

The program can be upgraded to support:
- Additional metadata fields
- Enhanced access control (multi-authority)
- Cross-chain bridge compatibility

---

*For implementation details, see [Technical Energy Token Documentation](../../technical/programs/energy-token.md)*
