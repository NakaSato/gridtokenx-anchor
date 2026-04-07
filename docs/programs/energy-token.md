# Energy Token Program

> **GRX Token: Energy-Backed SPL Token-2022 with PDA-Controlled Minting**

**Program ID:** `n52aKuZwUeZAocpWqRZAJR4xFhQqAvaRE7Xepy2JBGk`

---

## Overview

The Energy Token program implements **GRX** — an SPL Token-2022 asset where supply expansion is governed by verified energy production. No keypair can mint GRX; only program logic with PDA signatures.

**Core Principle:** 1 GRX = 1 kWh of verified renewable energy

### Key Features

- **PDA Mint Authority**: Mint authority is a Program Derived Address — impossible to mint outside program instructions
- **REC Validator Co-signing**: When validators are registered, one must co-sign every direct mint
- **Token-2022 Extensions**: Full SPL Token-2022 compatibility (confidential transfers, transfer hooks)
- **Metaplex Metadata**: Optional metadata creation for wallet display
- **Decentralized Supply**: Registry program mints via CPI after energy settlement

---

## State Accounts

### TokenInfo

**PDA Seeds:** `["token_info_2022"]`
**Layout:** `zero_copy`, `AccountLoader`

| Field | Type | Description |
|-------|------|-------------|
| `authority` | `Pubkey` | Admin authority for configuration |
| `registry_authority` | `Pubkey` | Authorized registry for CPI minting |
| `registry_program` | `Pubkey` | Registry program ID (stored for reference) |
| `mint` | `Pubkey` | GRX Token-2022 Mint address |
| `total_supply` | `u64` | Cached total supply (synced periodically via `sync_total_supply`) |
| `created_at` | `i64` | Initialization timestamp |
| `rec_validators` | `[Pubkey; 5]` | Authorized REC validator array |
| `rec_validators_count` | `u8` | Active validator count (max 5) |

### GRX Mint Account

**PDA Seeds:** `["mint_2022"]`
**Owner:** Token-2022 Program
**Decimals:** 9 (nano-GRX precision)
**Mint Authority:** TokenInfo PDA

### Constants

```rust
pub const DECIMALS: u8 = 9;
// 1 GRX = 1_000_000_000 atomic units
```

---

## Instructions

### initialize_token

One-time initialization of the GRX token system.

**Arguments:**
- `registry_program_id: Pubkey` — Registry program ID
- `registry_authority: Pubkey` — Registry authority pubkey (used for CPI validation)

**Accounts:**
- `token_info` (init, PDA `["token_info_2022"]`)
- `mint` (init, PDA `["mint_2022"]`, authority = `token_info`)
- `authority` (Signer, mut) — Payer and initial admin

**Logic:**
1. Initialize TokenInfo with authority, registry references
2. Initialize SPL Mint with PDA as mint authority
3. Set `total_supply = 0`, `rec_validators_count = 0`

---

### create_token_mint

Attaches Metaplex metadata for wallet display (Phantom, Solflare).

**Arguments:**
- `name: String` — Display name (e.g., "Grid Token")
- `symbol: String` — Ticker (e.g., "GRX")
- `uri: String` — Metadata URI (IPFS/Arweave)

**Accounts:**
- `mint` (mut) — Must match `token_info.load()?.mint`
- `token_info` (PDA)
- `metadata` (UncheckedAccount, mut) — Created via Metaplex CPI
- `payer`, `authority` (Signers)
- `metadata_program` (UncheckedAccount) — Metaplex Token Metadata program
- `sysvar_instructions` (UncheckedAccount)

**Note:** Metaplex CPI is guarded by `metadata_program.executable` check for localnet compatibility.

---

### mint_to_wallet

Admin-controlled minting to arbitrary wallet (airdrops, treasury, liquidity).

**Arguments:**
- `amount: u64` — Atomic units (1 GRX = 1,000,000,000)

**Accounts:**
- `mint` (mut)
- `token_info` (PDA, constraint: `authority` must match)
- `destination` (mut, TokenAccount)
- `destination_owner` (AccountInfo)
- `authority` (Signer)
- `payer` (Signer)

**Validation:** Caller must be TokenInfo authority

**CPI:** Uses `token_interface::mint_to` with PDA signer seeds

---

### mint_tokens_direct

**Primary energy-to-token conversion mechanism.** Requires REC validator co-signing when validators are registered.

**Arguments:**
- `amount: u64` — GRX to mint (proportional to kWh)

**Accounts:**
- `token_info` (PDA, read-only — no write lock for Sealevel parallelism)
- `mint` (mut)
- `user_token_account` (mut)
- `authority` (Signer) — Must be admin or `registry_authority`
- `registry_authority` (UncheckedAccount) — Validated against stored value
- `rec_validator` (Signer) — Must be in `token_info.rec_validators` when `count > 0`
- `token_program` (Interface)

**Authorization:**
- Either `authority == token_info.authority` (admin) OR `authority == registry_authority` (CPI from Registry)
- If `rec_validators_count > 0`, `rec_validator` signer must match one of the registered validators

**Event:** `GridTokensMinted { meter_owner, amount, timestamp }`

**Design Note:** `token_info` is read-only (no `total_supply` update) to eliminate write-lock contention during high-frequency minting. Use `sync_total_supply` periodically.

---

### sync_total_supply

Batch-update `total_supply` cache from canonical SPL Mint account.

**Accounts:**
- `token_info` (mut, PDA)
- `mint` (readonly)
- `authority` (Signer)

**Logic:** Reads `mint.supply` (canonical source of truth) and writes to `token_info.total_supply`. Admin only.

**Event:** `TotalSupplySynced { authority, supply, timestamp }`

---

### add_rec_validator

Adds authorized REC validator to whitelist.

**Arguments:**
- `validator_pubkey: Pubkey`
- `_authority_name: String` — Human-readable label (unused, kept for compatibility)

**Accounts:**
- `token_info` (mut, `has_one = authority`)
- `authority` (Signer)

**Constraints:**
- Max 5 validators (fixed array)
- No duplicates

---

### transfer_tokens

Standard SPL Token transfer with decimal enforcement.

**Arguments:**
- `amount: u64` — Atomic units

**Accounts:**
- `from_token_account`, `to_token_account` (mut)
- `mint` (for decimal reference)
- `from_authority` (Signer)
- `token_program` (Interface)

**CPI:** `token_interface::transfer_checked`

---

### burn_tokens

Destroys tokens (energy consumption, REC retirement).

**Arguments:**
- `amount: u64` — Atomic units

**Accounts:**
- `mint` (mut)
- `token_account` (mut)
- `authority` (Signer)
- `token_program` (Interface)

**CPI:** `token_interface::burn`

**Note:** `total_supply` is NOT updated here. Use `sync_total_supply` for batch reconciliation.

---

## Events

| Event | Fields | Emitted By |
|-------|--------|------------|
| `GridTokensMinted` | `meter_owner`, `amount`, `timestamp` | `mint_tokens_direct` |
| `TokensMinted` | `recipient`, `amount`, `timestamp` | `mint_to_wallet` |
| `TotalSupplySynced` | `authority`, `supply`, `timestamp` | `sync_total_supply` |

---

## Error Codes

| Discriminant | Error | Condition |
|--------------|-------|-----------|
| 0 | `UnauthorizedAuthority` | Caller ≠ `token_info.authority` AND ≠ `registry_authority` |
| 1 | `InvalidMeter` | Meter validation failed |
| 2 | `InsufficientBalance` | Token account balance insufficient |
| 3 | `InvalidMetadataAccount` | Metaplex metadata account invalid |
| 4 | `NoUnsettledBalance` | No energy available for tokenization |
| 5 | `UnauthorizedRegistry` | Registry program mismatch |
| 6 | `ValidatorAlreadyExists` | Duplicate validator pubkey |
| 7 | `MaxValidatorsReached` | `rec_validators_count ≥ 5` |
| 8 | `RecValidatorNotFound` | Co-signer not in registered validators list |

---

## Architecture Decisions

### Read-Only TokenInfo During Minting

`mint_tokens_direct` loads `token_info` as read-only (`load()`, not `load_mut()`). This eliminates write-lock contention on the global config account, enabling parallel minting to different users within the same block.

### REC Validator Co-Signing

When `rec_validators_count > 0`, a registered REC validator must sign the transaction. This creates a cryptographic link between minted GRX and verified renewable energy certificates, ensuring 1 GRX = 1 kWh of certified green energy.

### Total Supply Cache

`total_supply` in `TokenInfo` is a cache, not the source of truth. The canonical supply lives in the SPL Mint account (`mint.supply`). `sync_total_supply` reconciles the cache periodically. This trades immediate consistency for higher throughput.

---

## Integration

### Registry → Energy Token CPI

The Registry program calls `mint_tokens_direct` via CPI during `settle_and_mint_tokens`:

```rust
let signer_seeds = &[b"registry".as_ref(), &[bump]];
let cpi_ctx = CpiContext::new_with_signer(energy_token_program, cpi_accounts, signer);
energy_token::cpi::mint_tokens_direct(cpi_ctx, new_tokens_to_mint)?;
```

The Registry signs as the `registry_authority`, bypassing the need for the admin key.

---

**Related:** [Registry Program](./registry.md) — Settlement & minting via CPI
