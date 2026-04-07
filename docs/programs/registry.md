# Registry Program

> **Identity, Device Management & Energy Settlement**

**Program ID:** `FmvDiFUWPrwXsqo7z7XnVniKbZDcz32U5HSDVwPug89c`

---

## Overview

The Registry program is the identity backbone for GridTokenX. It manages participant identities, smart meter registrations, orchestrates energy settlement, and mints GRX tokens via CPI to the Energy Token program.

### Core Functions

1. **Identity Management** — Maps Solana wallets to real-world entities with geolocation (lat/long at 1e7 precision, H3 index)
2. **Device Registry** — Links physical smart meters to on-chain owners with generation/consumption tracking
3. **Settlement Orchestration** — Coordinates with Energy Token program for GRX minting after energy verification
4. **GRX Staking** — Stake GRX tokens to participate as a network validator (minimum 10,000 GRX)
5. **Sharded Counters** — Distributed user/meter counters to reduce write contention

---

## State Accounts

### Registry

**PDA Seeds:** `["registry"]`
**Layout:** `zero_copy`, `AccountLoader`

| Field | Type | Description |
|-------|------|-------------|
| `authority` | `Pubkey` | Admin authority (REC certifying entity) |
| `oracle_authority` | `Pubkey` | Authorized oracle pubkey |
| `has_oracle_authority` | `u8` | Boolean: 1 = oracle configured |
| `user_count` | `u64` | Total registered users (aggregated from shards) |
| `meter_count` | `u64` | Total registered meters (aggregated from shards) |
| `active_meter_count` | `u64` | Currently active meters |

### RegistryShard

**PDA Seeds:** `["registry_shard", &[shard_id]]`
**Layout:** `zero_copy`

| Field | Type | Description |
|-------|------|-------------|
| `shard_id` | `u8` | Shard identifier (0-15) |
| `user_count` | `u64` | Users in this shard |
| `meter_count` | `u64` | Meters in this shard |

### UserAccount

**PDA Seeds:** `["user", authority.key()]`
**Layout:** `zero_copy`

| Field | Type | Description |
|-------|------|-------------|
| `authority` | `Pubkey` | Wallet address (owner) |
| `user_type` | `UserType` | `Prosumer` or `Consumer` |
| `lat_e7` | `i32` | Latitude × 10^7 |
| `long_e7` | `i32` | Longitude × 10^7 |
| `h3_index` | `u64` | H3 geospatial index |
| `status` | `UserStatus` | `Active | Suspended | Inactive` |
| `validator_status` | `ValidatorStatus` | `None | Active | Slashed | Suspended` |
| `shard_id` | `u8` | User's shard assignment |
| `registered_at` | `i64` | Registration timestamp |
| `meter_count` | `u32` | Number of meters owned |
| `staked_grx` | `u64` | Amount of GRX staked |
| `last_stake_at` | `i64` | Last staking action timestamp |

### MeterAccount

**PDA Seeds:** `["meter", owner.key(), meter_id.as_bytes()]`
**Layout:** `zero_copy`

| Field | Type | Description |
|-------|------|-------------|
| `meter_id` | `[u8; 32]` | Fixed-size serial number (null-padded) |
| `owner` | `Pubkey` | User who owns this meter |
| `meter_type` | `MeterType` | `Solar | Wind | Battery | Grid` |
| `status` | `MeterStatus` | `Active | Inactive | Maintenance` |
| `registered_at` | `i64` | Registration timestamp |
| `last_reading_at` | `i64` | Most recent reading timestamp |
| `total_generation` | `u64` | Cumulative energy produced |
| `total_consumption` | `u64` | Cumulative energy consumed |
| `settled_net_generation` | `u64` | **High-water mark** for tokenized energy |
| `claimed_erc_generation` | `u64` | **High-water mark** for ERC-certified energy |

### High-Water Mark Formula

```
Mintable GRX    = (total_generation - total_consumption) - settled_net_generation
Claimable ERC   = total_generation - claimed_erc_generation
```

---

## Instructions

### initialize

Deploys the global Registry singleton.

**Accounts:**
- `registry` (init, PDA `["registry"]`)
- `authority` (Signer, mut)

---

### initialize_shard

Creates a distributed counter shard.

**Arguments:**
- `shard_id: u8` — Shard ID (0-15)

**Accounts:**
- `shard` (init, PDA `["registry_shard", &[shard_id]]`)
- `authority` (Signer, mut)

---

### register_user

Onboards a new participant with automatic 20 GRX airdrop.

**Arguments:**
- `user_type: UserType` — `Prosumer` or `Consumer`
- `lat_e7: i32` — Latitude × 10^7
- `long_e7: i32` — Longitude × 10^7
- `h3_index: u64` — H3 geospatial index
- `shard_id: u8` — Shard assignment (0-15)

**Accounts:**
- `user_account` (init, PDA `["user", authority.key()]`)
- `registry_shard` (mut)
- `registry` (mut)
- `authority` (Signer, mut)
- **Optional airdrop accounts:** `energy_token_program`, `mint`, `token_info`, `user_token_account`, `token_program`

**Logic:**
1. Create UserAccount with `status = Active`
2. Increment shard `user_count`
3. If energy token program provided: CPI `mint_to_wallet` for 20 GRX airdrop (`AIRDROP_AMOUNT = 20_000_000_000`)

**Event:** `UserRegistered { user, user_type, lat_e7, long_e7, h3_index }`

---

### register_meter

Links physical smart meter to user's identity.

**Arguments:**
- `meter_id: String` — Unique identifier (max 32 bytes)
- `meter_type: MeterType` — `Solar | Wind | Battery | Grid`
- `shard_id: u8` — Shard assignment (0-15)

**Accounts:**
- `meter_account` (init, PDA `["meter", owner.key(), meter_id.as_bytes()]`)
- `user_account` (mut)
- `registry_shard` (mut)
- `registry` (mut)
- `owner` (Signer, mut)

**Logic:**
1. Initialize MeterAccount with zero cumulative values
2. Increment `user_account.meter_count` and shard `meter_count`

**Event:** `MeterRegistered { meter_id, owner, meter_type }`

---

### update_meter_reading

**Primary data ingestion endpoint.** Oracle-only reading update.

**Arguments:**
- `energy_generated: u64`
- `energy_consumed: u64`
- `reading_timestamp: i64` — Must be strictly > `last_reading_at`

**Accounts:**
- `registry` (readonly)
- `meter_account` (mut)
- `oracle_authority` (Signer)

**Validation:**
1. Oracle must be configured (`has_oracle_authority == 1`)
2. Signer must match `registry.oracle_authority`
3. Meter must be `Active`
4. `reading_timestamp > last_reading_at` (monotonic, prevents replay)
5. Values ≤ `MAX_READING_DELTA` (1 trillion units, prevents overflow attacks)

**Event:** `MeterReadingUpdated { meter_id, owner, energy_generated, energy_consumed }`

---

### settle_meter_balance

Prepares meter for token minting by updating settlement watermark.

**Accounts:**
- `meter_account` (mut)
- `meter_owner` (Signer)

**Logic:**
1. Calculate `net_generation = total_generation - total_consumption`
2. Calculate `unsettled = net_generation - settled_net_generation`
3. Require `unsettled > 0`
4. Update `settled_net_generation = net_generation`
5. Return `unsettled` amount

**Returns:** `u64` — Amount of GRX to mint

**Event:** `MeterBalanceSettled { meter_id, owner, tokens_to_mint, total_settled }`

---

### settle_and_mint_tokens

**Atomic settlement + minting via CPI to Energy Token program.**

**Accounts:**
- `meter_account` (mut)
- `meter_owner` (Signer)
- `token_info`, `mint`, `user_token_account` (mut, Energy Token accounts)
- `registry` (PDA `["registry"]` — signs the CPI)
- `energy_token_program` (AccountInfo)
- `rec_validator` (AccountInfo)
- `token_program` (AccountInfo)

**Logic:**
1. Perform settlement calculation
2. CPI to `energy_token::mint_tokens_direct` with Registry as `registry_authority`
3. Registry PDA signs the CPI

---

### stake_grx

Stake GRX tokens to participate in the network.

**Arguments:**
- `amount: u64`

**Accounts:**
- `user_account` (mut, PDA)
- `grx_vault` (mut, PDA `["grx_vault"]`)
- `registry` (PDA `["registry"]`)
- `user_grx_ata` (mut)
- `grx_mint` (readonly)
- `authority` (Signer, mut)

**Logic:** CPI transfer from user ATA to vault, increment `user_account.staked_grx`.

---

### register_validator

Register as a network validator (requires ≥ 10,000 GRX staked).

**Accounts:**
- `user_account` (mut)
- `authority` (Signer)

**Constraint:** `staked_grx >= 10_000_000_000_000` (10,000 GRX, 9 decimals)

---

### mark_erc_claimed

Marks energy as claimed for ERC issuance.

**Arguments:**
- `amount: u64`

**Accounts:**
- `meter_account` (mut)
- `registry` (readonly)
- `authority` (Signer) — Must be registry authority or oracle authority

---

### Administrative Instructions

| Instruction | Auth | Purpose |
|-------------|------|---------|
| `set_oracle_authority` | Registry admin | Designate oracle pubkey |
| `update_user_status` | Registry admin | Suspend/activate users |
| `set_meter_status` | Owner or admin | Change meter status |
| `deactivate_meter` | Owner | Permanently deactivate |
| `aggregate_shards` | Registry admin | Roll up shard counters |
| `initialize_vault` | Registry admin | Create GRX staking vault |

---

## Error Codes

| Discriminant | Error | Condition |
|--------------|-------|-----------|
| 0 | `UnauthorizedUser` | Caller doesn't own user/meter |
| 1 | `UnauthorizedAuthority` | Caller ≠ registry admin |
| 2 | `InvalidUserStatus` | User status validation failed |
| 3 | `InvalidMeterStatus` | Meter status validation failed |
| 6 | `NoUnsettledBalance` | Nothing to settle |
| 7 | `OracleNotConfigured` | No oracle authority set |
| 8 | `UnauthorizedOracle` | Caller ≠ configured oracle |
| 9 | `StaleReading` | `reading_timestamp ≤ last_reading_at` |
| 10 | `ReadingTooHigh` | Value exceeds `MAX_READING_DELTA` |
| 11 | `AlreadyInactive` | Meter already inactive |
| 12 | `InvalidMeterId` | Meter ID > 32 bytes |
| 14 | `InvalidShardId` | `shard_id ≥ 16` |
| 16 | `MinStakeNotMet` | Insufficient staked GRX for validator registration |

---

## Events

| Event | Fields |
|-------|--------|
| `UserRegistered` | `user`, `user_type`, `lat_e7`, `long_e7`, `h3_index` |
| `MeterRegistered` | `meter_id`, `owner`, `meter_type` |
| `MeterReadingUpdated` | `meter_id`, `owner`, `energy_generated`, `energy_consumed` |
| `MeterBalanceSettled` | `meter_id`, `owner`, `tokens_to_mint`, `total_settled` |
| `MeterDeactivated` | `meter_id`, `owner`, `final_generation`, `final_consumption` |
| `MeterStatusUpdated` | `meter_id`, `owner`, `old_status`, `new_status` |
| `UserStatusUpdated` | `user`, `old_status`, `new_status` |
| `OracleAuthoritySet` | `old_oracle`, `new_oracle` |

---

## Data Integrity Mechanisms

### Temporal Monotonicity
Every `update_meter_reading` call requires `reading_timestamp > last_reading_at`, creating an append-only, causally-ordered ledger of energy flows.

### Dual High-Water Marks
`settled_net_generation` and `claimed_erc_generation` are non-decreasing counters. Once energy is tokenized or REC-certified, that portion can never be re-claimed.

### Sharded Counters
16 shards distribute write load for user/meter registration. `aggregate_shards` rolls up counts to the global Registry when needed.

---

**Related:** [Energy Token](./energy-token.md) — GRX minting via CPI · [Governance](./governance.md) — ERC certification
