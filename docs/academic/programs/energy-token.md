# Energy Token Program

> **Academic Documentation - GRID Token Management System**

Program ID: `94G1r674LmRDmLN2UPjDFD8Eh7zT8JaSaxv9v68GyEur`

---

## Overview

The Energy Token Program manages the GRID token—a fungible SPL token representing tradeable energy units. It implements the token minting mechanism, supply controls, and serves as the mint authority through a Program Derived Address (PDA) pattern.

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

---

## Account Architecture

### Token Info Account

Program configuration and mint authority PDA.

| Field | Type | Description |
|-------|------|-------------|
| `authority` | PublicKey | Administrative authority |
| `mint` | PublicKey | SPL Token mint address |
| `total_supply` | u64 | Total tokens ever minted |
| `circulating_supply` | u64 | Currently circulating tokens |
| `burned` | u64 | Total tokens burned |
| `mint_enabled` | bool | Whether minting is active |
| `created_at` | i64 | Initialization timestamp |
| `bump` | u8 | PDA bump seed |

**PDA Derivation**: Seeds = `["token_info"]`

### Mint Account

Standard SPL Token mint with PDA authority.

| Property | Value |
|----------|-------|
| Decimals | 9 |
| Mint Authority | TokenInfo PDA |
| Freeze Authority | None (non-freezable) |

**PDA Derivation**: Seeds = `["mint"]`

---

## PDA Authority Pattern

### Trustless Minting Architecture

The Energy Token Program implements a trustless minting pattern using PDAs:

**Traditional Approach (Problematic):**
- Private key controls mint authority
- Key compromise = unlimited minting
- Requires secure key management

**PDA Approach (Implemented):**
- No private key exists
- Only program logic can mint
- Mathematically impossible to compromise

### How PDA Signing Works

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
| `initialize_token` | Deployer | Create token configuration and mint |
| `update_authority` | Authority | Transfer administrative control |
| `enable_minting` | Authority | Enable token minting |
| `disable_minting` | Authority | Pause token minting |

### Minting Instructions

| Instruction | Signer | Description |
|-------------|--------|-------------|
| `mint_tokens` | Authority | Mint tokens to specified account |
| `mint_tokens_direct` | Registry (CPI) | Mint via cross-program call |
| `mint_from_production` | Registry (CPI) | Mint based on energy production |

### Burn Instructions

| Instruction | Signer | Description |
|-------------|--------|-------------|
| `burn_tokens` | Token Holder | Burn tokens from own account |

### Query Instructions

| Instruction | Access | Description |
|-------------|--------|-------------|
| `get_token_info` | Public | Retrieve token statistics |

---

## Cross-Program Integration

### Registry → Energy Token CPI

The Registry Program invokes Energy Token for minting:

**Flow:**
1. Registry validates settlement request
2. Registry calculates mintable amount
3. Registry invokes `mint_tokens_direct` via CPI
4. Energy Token validates CPI context
5. Energy Token mints to user account
6. Supply counters updated atomically

**Security Guarantees:**
- Only Registry can invoke CPI minting
- Amount limited by settlement calculation
- Atomic execution prevents partial states

### Validation Requirements

CPI minting requests must satisfy:

| Requirement | Validation |
|-------------|------------|
| Caller identity | Must be Registry program |
| Mint enabled | `mint_enabled` must be true |
| Valid recipient | Token account exists |
| Amount > 0 | Non-zero mint amount |

---

## Security Model

### Access Control

| Operation | Public | Holder | Registry | Authority |
|-----------|:------:|:------:|:--------:|:---------:|
| View info | ✓ | ✓ | ✓ | ✓ |
| Transfer | | ✓ | | |
| Burn | | ✓ | | |
| Mint | | | ✓ (CPI) | ✓ |
| Configure | | | | ✓ |

### Threat Mitigations

| Threat | Mitigation |
|--------|------------|
| Unauthorized minting | PDA authority + CPI validation |
| Supply manipulation | Immutable mint logic |
| Double-minting | Registry tracker prevents |
| Authority compromise | Multi-sig option, PDA minting |

### Audit Trail

All token operations emit events for:
- Complete transaction history
- Supply reconciliation
- Regulatory compliance

---

## Events

| Event | Trigger | Key Fields |
|-------|---------|------------|
| `TokenInitialized` | Initialization | mint, authority |
| `TokensMinted` | Mint operation | recipient, amount, new_supply |
| `TokensBurned` | Burn operation | burner, amount, new_supply |
| `MintingEnabled` | Enable minting | authority, timestamp |
| `MintingDisabled` | Disable minting | authority, timestamp |
| `AuthorityUpdated` | Authority change | old, new |

---

## Errors

| Error Code | Name | Description |
|------------|------|-------------|
| 6200 | `Unauthorized` | Caller lacks authority |
| 6201 | `MintingDisabled` | Minting currently paused |
| 6202 | `InvalidAmount` | Zero or negative amount |
| 6203 | `InvalidRecipient` | Token account invalid |
| 6204 | `SupplyOverflow` | Supply would exceed max |
| 6205 | `InsufficientBalance` | Not enough tokens to burn |
| 6206 | `InvalidCpiCaller` | CPI from unauthorized program |

---

## Research Implications

### Contribution to Literature

The Energy Token Program demonstrates:

1. **PDA Authority Pattern**: Trustless token minting without key custody
2. **Supply-Constrained Tokenization**: Physical asset backing
3. **Cross-Program Token Operations**: Composable DeFi primitives

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
| CPI overhead | ~15,000 CU |
| Account rent | ~0.002 SOL |

---

*For implementation details, see [Technical Energy Token Documentation](../../technical/programs/energy-token.md)*
