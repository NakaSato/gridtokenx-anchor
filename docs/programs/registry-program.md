# Registry Program v2.0

> **Technical Specification Document**
> 
> User and smart meter registration with dual-tracker tokenization system, oracle authorization, and complete meter lifecycle management for the GridTokenX platform.

---

## Program Metadata

| Property | Value |
|----------|-------|
| **Program ID** | `FQYhgNRRWDCvy9WPeZPo5oZw63iHpJZToi1uUp25jE4a` |
| **Framework** | Anchor v0.32.1 |
| **Language** | Rust |
| **Network** | Solana (Devnet/Mainnet) |
| **Version** | 2.0.0 |
| **Instructions** | 14 |
| **Accounts** | 3 (Registry, UserAccount, MeterAccount) |

---

## Table of Contents

1. [Overview](#overview)
2. [What's New in v2.0](#whats-new-in-v20)
3. [Theoretical Foundation](#theoretical-foundation)
4. [Instructions](#instructions)
5. [Account Structures](#account-structures)
6. [Oracle Authorization System](#oracle-authorization-system)
7. [Meter Lifecycle Management](#meter-lifecycle-management)
8. [Dual-Tracker System](#dual-tracker-system)
9. [Type Definitions](#type-definitions)
10. [Events](#events)
11. [Error Handling](#error-handling)
12. [Security Model](#security-model)
13. [Cross-Program Integration](#cross-program-integration)

---

## Overview

The Registry Program serves as the **identity and asset management layer** for the GridTokenX platform. It manages:

- **User registration and lifecycle** - Prosumer/consumer onboarding
- **Smart meter registration** - Device identity and ownership
- **Energy accounting** - Generation and consumption tracking
- **Oracle authorization** - Secure meter reading submission
- **Meter lifecycle** - Complete status management and deactivation
- **Settlement coordination** - Token minting preparation via CPI

### Program Responsibilities

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         REGISTRY PROGRAM v2.0                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Identity Layer                                                             │
│   ├── User registration (Prosumer/Consumer)                                  │
│   ├── User status management (Active/Suspended/Inactive)                     │
│   └── Geographic location tracking                                           │
│                                                                              │
│   Asset Layer                                                                │
│   ├── Meter registration (Solar/Wind/Battery/Grid)                           │
│   ├── Meter status management (Active/Inactive/Maintenance)                  │
│   ├── Meter deactivation (permanent)                                         │
│   └── Ownership verification                                                 │
│                                                                              │
│   Oracle Layer (NEW in v2.0)                                                 │
│   ├── Oracle authority configuration                                         │
│   ├── Reading validation (timestamp, delta limits)                           │
│   └── Authorized submission enforcement                                      │
│                                                                              │
│   Accounting Layer                                                           │
│   ├── Energy generation tracking                                             │
│   ├── Energy consumption tracking                                            │
│   ├── Net balance calculation                                                │
│   ├── Active meter count tracking                                            │
│   └── Dual-tracker settlement system                                         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## What's New in v2.0

### New Features

| Feature | Description | Security Impact |
|---------|-------------|-----------------|
| **Oracle Authorization** | Only configured oracle can submit readings | 🔴 Critical security fix |
| **Reading Validation** | Timestamp and delta limit checks | 🟠 Data integrity |
| **Meter Lifecycle** | Complete status management + deactivation | 🟡 Feature completeness |
| **Active Meter Tracking** | Separate counter for active meters | 🟢 Analytics |

### New Instructions (3 Added)

| Instruction | Purpose | Authority |
|-------------|---------|-----------|
| `set_oracle_authority` | Configure authorized oracle | Registry admin |
| `set_meter_status` | Change meter operational status | Owner or admin |
| `deactivate_meter` | Permanently deactivate meter | Owner only |

### New Events (3 Added)

| Event | Trigger |
|-------|---------|
| `OracleAuthoritySet` | Oracle configuration changed |
| `MeterStatusUpdated` | Meter status transition |
| `MeterDeactivated` | Meter permanently deactivated |

### New Error Codes (5 Added)

| Code | Error | Description |
|------|-------|-------------|
| 6007 | `OracleNotConfigured` | Oracle authority not set |
| 6008 | `UnauthorizedOracle` | Signer ≠ configured oracle |
| 6009 | `StaleReading` | Timestamp ≤ last reading |
| 6010 | `ReadingTooHigh` | Exceeds 1 GWh delta limit |
| 6011 | `AlreadyInactive` | Meter already deactivated |

### Breaking Changes

⚠️ **`update_meter_reading` now requires:**
1. Registry account with configured oracle authority
2. Signer must match `registry.oracle_authority`
3. Timestamp must be > `meter.last_reading_at`
4. Energy deltas must be ≤ 1 GWh (1,000,000,000,000 Wh)

---

## Theoretical Foundation

### 3.1 Energy Tokenization Model

The Registry Program implements a **conservative tokenization model** where only verified net energy can be converted to tokens:

$$
\text{Mintable Energy} = \max(0, \text{Net Generation} - \text{Previously Settled})
$$

Where:
$$
\text{Net Generation} = \text{Total Generation} - \text{Total Consumption}
$$

### 3.2 Dual-Tracker Design Rationale

The program maintains two independent trackers to support different use cases:

| Tracker | Purpose | Use Case |
|---------|---------|----------|
| `settled_net_generation` | Net energy minted as GRID tokens | P2P energy trading |
| `claimed_erc_generation` | Gross generation claimed as ERC | Regulatory compliance |

This separation allows:
1. A prosumer to sell net energy surplus as tokens
2. The same prosumer to claim ERC certificates for total renewable generation
3. Prevention of double-counting within each system

### 3.3 Oracle Trust Model (v2.0)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ORACLE TRUST MODEL                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   BEFORE v2.0 (Vulnerable)                                                   │
│   ════════════════════════                                                   │
│                                                                              │
│   Any Signer ───▶ update_meter_reading() ───▶ MeterAccount                  │
│        ↑                                                                     │
│        └── No validation! Anyone could submit fake readings                  │
│                                                                              │
│   ─────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│   AFTER v2.0 (Secure)                                                        │
│   ═══════════════════                                                        │
│                                                                              │
│   Registry.oracle_authority ◀── set_oracle_authority() ◀── Admin            │
│            │                                                                 │
│            ▼                                                                 │
│   Oracle Signer ───▶ update_meter_reading() ───┬──▶ Validate oracle ✓       │
│                                                 ├──▶ Validate timestamp ✓    │
│                                                 ├──▶ Validate delta ✓        │
│                                                 └──▶ Update MeterAccount     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.4 State Machine Model

User and meter lifecycle follows a finite state machine:

```
User States:
    ┌────────────┐    suspend    ┌────────────┐
    │   ACTIVE   │──────────────▶│ SUSPENDED  │
    │            │◀──────────────│            │
    └────────────┘   reactivate  └────────────┘
          │                            │
          │ deactivate                 │ deactivate
          ▼                            ▼
    ┌────────────┐              ┌────────────┐
    │  INACTIVE  │              │  INACTIVE  │
    └────────────┘              └────────────┘

Meter States (Enhanced in v2.0):
    ┌────────────┐  set_meter_status  ┌─────────────┐
    │   ACTIVE   │◀──────────────────▶│ MAINTENANCE │
    │            │                    │             │
    └─────┬──────┘                    └──────┬──────┘
          │                                  │
          │ set_meter_status                 │ set_meter_status
          │ deactivate_meter                 │ deactivate_meter
          ▼                                  ▼
    ┌────────────────────────────────────────────┐
    │                  INACTIVE                   │
    │           (Permanent - No Recovery)         │
    └────────────────────────────────────────────┘
```

---

## Instructions

### 4.1 Instruction Summary (14 Total)

| # | Instruction | Type | Authority | State Changes |
|---|-------------|------|-----------|---------------|
| 1 | `initialize` | Write | Deployer | Creates Registry |
| 2 | `set_oracle_authority` | Write | Admin | Updates Registry.oracle_authority |
| 3 | `register_user` | Write | Any wallet | Creates UserAccount, +user_count |
| 4 | `register_meter` | Write | User | Creates MeterAccount, +meter_count |
| 5 | `update_user_status` | Write | Admin | Updates UserAccount.status |
| 6 | `update_meter_reading` | Write | Oracle | Updates energy counters |
| 7 | `set_meter_status` | Write | Owner/Admin | Updates MeterAccount.status |
| 8 | `deactivate_meter` | Write | Owner | Permanently deactivates meter |
| 9 | `is_valid_user` | Read | Public | None |
| 10 | `is_valid_meter` | Read | Public | None |
| 11 | `get_unsettled_balance` | Read | Public | None |
| 12 | `settle_meter_balance` | Write | Owner | Updates settled_net_generation |
| 13 | `settle_and_mint_tokens` | Write+CPI | Owner | Updates tracker + mints tokens |

### 4.2 Instruction Details

#### `initialize`

Creates the global registry account.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `registry` | PDA (init) | Registry singleton |
| `authority` | Signer | Registry admin |
| `system_program` | Program | System program |

**State Changes:**
- Creates Registry PDA with seeds `[b"registry"]`
- Sets `authority` to signer
- Sets `oracle_authority` to `None`
- Initializes all counters to 0

**Emits:** `RegistryInitialized`

---

#### `set_oracle_authority` (NEW in v2.0)

Configures the authorized oracle for meter readings.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `oracle` | Pubkey | Authorized oracle wallet |

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `registry` | Account (mut) | Registry singleton |
| `authority` | Signer | Must be registry authority |

**Authorization:** Registry authority only

**Errors:**

| Error | Condition |
|-------|-----------|
| `UnauthorizedAuthority` | Signer ≠ registry.authority |

**Emits:** `OracleAuthoritySet`

---

#### `register_user`

Registers a new user account tied to a wallet.

**Parameters:**

| Parameter | Type | Constraints |
|-----------|------|-------------|
| `user_type` | UserType | Prosumer or Consumer |
| `location` | String | Max 100 characters |

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `registry` | Account (mut) | Registry singleton |
| `user_account` | PDA (init) | User account |
| `user_authority` | Signer | User's wallet |
| `system_program` | Program | System program |

**PDA Seeds:** `[b"user", user_authority.key().as_ref()]`

**State Changes:**
- Creates UserAccount
- Increments `registry.user_count`

**Emits:** `UserRegistered`

---

#### `register_meter`

Registers a new smart meter for a user.

**Parameters:**

| Parameter | Type | Constraints |
|-----------|------|-------------|
| `meter_id` | String | Max 50 characters, unique |
| `meter_type` | MeterType | Solar/Wind/Battery/Grid |

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `registry` | Account (mut) | Registry singleton |
| `user_account` | Account (mut) | Owner's user account |
| `meter_account` | PDA (init) | Meter account |
| `user_authority` | Signer | User's wallet |
| `system_program` | Program | System program |

**PDA Seeds:** `[b"meter", meter_id.as_bytes()]`

**State Changes:**
- Creates MeterAccount with status `Active`
- Increments `user_account.meter_count`
- Increments `registry.meter_count`
- Increments `registry.active_meter_count`

**Emits:** `MeterRegistered`

---

#### `update_meter_reading` (ENHANCED in v2.0)

Submits new energy reading from authorized oracle.

**Parameters:**

| Parameter | Type | Unit | Constraints |
|-----------|------|------|-------------|
| `energy_generated` | u64 | Watt-hours | ≤ 1,000,000,000,000 (1 GWh) |
| `energy_consumed` | u64 | Watt-hours | ≤ 1,000,000,000,000 (1 GWh) |
| `reading_timestamp` | i64 | Unix timestamp | > meter.last_reading_at |

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `registry` | Account | Registry (for oracle validation) |
| `meter_account` | Account (mut) | Meter to update |
| `oracle_authority` | Signer | Must match registry.oracle_authority |

**Validation (v2.0):**
1. ✅ `registry.oracle_authority.is_some()` - Oracle must be configured
2. ✅ `signer == registry.oracle_authority` - Must be authorized oracle
3. ✅ `meter.status == Active` - Meter must be active
4. ✅ `timestamp > meter.last_reading_at` - No stale readings
5. ✅ `delta ≤ MAX_READING_DELTA` - Reasonable delta limits

**State Changes:**
- `meter.last_reading_at = reading_timestamp`
- `meter.total_generation += energy_generated`
- `meter.total_consumption += energy_consumed`

**Errors:**

| Error | Condition |
|-------|-----------|
| `OracleNotConfigured` | oracle_authority is None |
| `UnauthorizedOracle` | Signer ≠ oracle_authority |
| `InvalidMeterStatus` | Meter not active |
| `StaleReading` | timestamp ≤ last_reading_at |
| `ReadingTooHigh` | delta > 1 GWh |

**Emits:** `MeterReadingUpdated`

---

#### `set_meter_status` (NEW in v2.0)

Changes meter operational status.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `new_status` | MeterStatus | Active/Inactive/Maintenance |

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `registry` | Account (mut) | Registry singleton |
| `meter_account` | Account (mut) | Meter to update |
| `authority` | Signer | Owner or admin |

**Authorization:** Owner OR registry authority

**State Changes:**
- Updates `meter.status`
- Adjusts `registry.active_meter_count` based on transition

**Active Count Logic:**

| Transition | Count Change |
|------------|--------------|
| Active → Non-Active | -1 |
| Non-Active → Active | +1 |

**Emits:** `MeterStatusUpdated`

---

#### `deactivate_meter` (NEW in v2.0)

Permanently deactivates a meter.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `registry` | Account (mut) | Registry singleton |
| `user_account` | Account (mut) | Owner's user account |
| `meter_account` | Account (mut) | Meter to deactivate |
| `owner` | Signer | Must be meter owner |

**Authorization:** Owner only (admin cannot deactivate)

**State Changes:**
- Sets `meter.status = Inactive`
- Decrements `user_account.meter_count`
- Decrements `registry.active_meter_count` (if was active)

**Errors:**

| Error | Condition |
|-------|-----------|
| `UnauthorizedUser` | Signer ≠ meter.owner |
| `AlreadyInactive` | meter.status == Inactive |

**Emits:** `MeterDeactivated` (includes final generation/consumption)

---

#### `settle_meter_balance`

Settles the unsettled net generation balance.

**Returns:** Amount of energy settled (in Wh)

**Algorithm:**
1. Calculate `current_net_gen = total_generation - total_consumption`
2. Calculate `new_tokens_to_mint = current_net_gen - settled_net_generation`
3. If `new_tokens_to_mint <= 0`, return Error::NoUnsettledBalance
4. Set `settled_net_generation = current_net_gen`
5. Return `new_tokens_to_mint`

**Emits:** `MeterBalanceSettled`

---

#### `settle_and_mint_tokens`

Combined settlement and token minting via CPI.

**Accounts (8 total):**

| Account | Type | Description |
|---------|------|-------------|
| `meter_account` | Account (mut) | Meter to settle |
| `meter_owner` | Signer | Must be meter owner |
| `token_info` | AccountInfo (mut) | Energy token's token_info PDA |
| `mint` | AccountInfo (mut) | GRID token mint |
| `user_token_account` | AccountInfo (mut) | User's token account |
| `authority` | AccountInfo | Token mint authority |
| `energy_token_program` | AccountInfo | Energy token program |
| `token_program` | AccountInfo | SPL Token program |

**Process Flow:**
1. Verify meter ownership
2. Verify meter is active
3. Calculate unsettled balance
4. Update settled_net_generation
5. CPI → energy_token::mint_tokens_direct(amount)
6. Emit settlement event

---

## Account Structures

### 5.1 Registry Account (ENHANCED in v2.0)

Global singleton storing registry state.

| Field | Type | Size | Description |
|-------|------|------|-------------|
| `authority` | Pubkey | 32 bytes | Registry administrator |
| `oracle_authority` | Option<Pubkey> | 33 bytes | Authorized oracle for meter readings (NEW) |
| `user_count` | u64 | 8 bytes | Total registered users |
| `meter_count` | u64 | 8 bytes | Total registered meters (all time) |
| `active_meter_count` | u64 | 8 bytes | Currently active meters (NEW) |
| `created_at` | i64 | 8 bytes | Registry creation timestamp |

**PDA Seeds:** `[b"registry"]`

**Space:** 8 (discriminator) + 32 + 33 + 8 + 8 + 8 + 8 = **105 bytes**

---

### 5.2 UserAccount

User identity and status.

| Field | Type | Size | Description |
|-------|------|------|-------------|
| `authority` | Pubkey | 32 bytes | User's wallet address |
| `user_type` | UserType | 1 byte | User classification |
| `location` | String | 4 + 100 bytes | Geographic location |
| `status` | UserStatus | 1 byte | Current status |
| `registered_at` | i64 | 8 bytes | Registration timestamp |
| `meter_count` | u32 | 4 bytes | Number of active meters owned |
| `created_at` | i64 | 8 bytes | Backward compatibility field |

**PDA Seeds:** `[b"user", user_authority.key().as_ref()]`

**Space:** 8 + 32 + 1 + 104 + 1 + 8 + 4 + 8 = **166 bytes**

---

### 5.3 MeterAccount

Smart meter identity and energy tracking.

| Field | Type | Size | Description |
|-------|------|------|-------------|
| `meter_id` | String | 4 + 50 bytes | Unique meter identifier |
| `owner` | Pubkey | 32 bytes | Owner's wallet address |
| `meter_type` | MeterType | 1 byte | Meter classification |
| `status` | MeterStatus | 1 byte | Current operational status |
| `registered_at` | i64 | 8 bytes | When meter was registered |
| `last_reading_at` | i64 | 8 bytes | Last reading timestamp |
| `total_generation` | u64 | 8 bytes | Cumulative energy generated (Wh) |
| `total_consumption` | u64 | 8 bytes | Cumulative energy consumed (Wh) |
| `settled_net_generation` | u64 | 8 bytes | Energy already minted as GRID tokens (Wh) |
| `claimed_erc_generation` | u64 | 8 bytes | Energy already claimed as ERC certificates (Wh) |

**PDA Seeds:** `[b"meter", meter_id.as_bytes()]`

**Space:** 8 + 54 + 32 + 1 + 1 + 8 + 8 + 8 + 8 + 8 + 8 = **144 bytes**

---

## Oracle Authorization System

### 6.1 System Overview

The Oracle Authorization System ensures only trusted sources can submit meter readings:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ORACLE AUTHORIZATION FLOW                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Step 1: Configuration (Admin)                                              │
│   ══════════════════════════════                                             │
│                                                                              │
│   Admin Wallet ──▶ set_oracle_authority(oracle_pubkey)                       │
│                          │                                                   │
│                          ▼                                                   │
│                   Registry.oracle_authority = Some(oracle_pubkey)            │
│                                                                              │
│   ─────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│   Step 2: Reading Submission (Oracle)                                        │
│   ═══════════════════════════════════                                        │
│                                                                              │
│   Oracle Wallet ──▶ update_meter_reading(generated, consumed, timestamp)     │
│                          │                                                   │
│                          ▼                                                   │
│                   ┌─────────────────────────────────────┐                    │
│                   │        VALIDATION CHECKS             │                   │
│                   ├─────────────────────────────────────┤                   │
│                   │ 1. oracle_authority.is_some()? ✓    │                   │
│                   │ 2. signer == oracle_authority? ✓    │                   │
│                   │ 3. meter.status == Active? ✓        │                   │
│                   │ 4. timestamp > last_reading? ✓      │                   │
│                   │ 5. delta <= MAX_DELTA? ✓            │                   │
│                   └─────────────────────────────────────┘                    │
│                          │                                                   │
│                          ▼                                                   │
│                   MeterAccount Updated                                       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Reading Validation Rules

| Check | Constant | Purpose |
|-------|----------|---------|
| Oracle configured | - | Prevent readings before setup |
| Oracle authorized | - | Only trusted source |
| Meter active | - | No updates to inactive meters |
| Timestamp newer | - | Prevent replay/stale data |
| Delta limit | 1 GWh (1e12 Wh) | Prevent absurd values |

---

## Meter Lifecycle Management

### 7.1 Status Transitions

```
                                ┌─────────────────────────────┐
                                │    Meter Status Graph        │
                                └─────────────────────────────┘

                          set_meter_status(Maintenance)
                    ┌─────────────────────────────────────────┐
                    │                                         │
                    ▼                                         │
            ┌─────────────┐                           ┌───────┴───────┐
            │ MAINTENANCE │                           │    ACTIVE     │
            │             │                           │               │
            └──────┬──────┘                           └───────┬───────┘
                   │                                          │
                   │ set_meter_status(Active)                 │
                   └──────────────────────────────────────────┘
                                      │
                                      │ set_meter_status(Inactive)
                                      │ OR deactivate_meter()
                                      ▼
                            ┌─────────────────┐
                            │    INACTIVE     │
                            │  (Permanent)    │
                            │  No Recovery    │
                            └─────────────────┘
```

### 7.2 Active Meter Count Tracking

The `active_meter_count` is automatically updated on status changes:

| Transition | Count Change |
|------------|--------------|
| `Active → Maintenance` | -1 |
| `Active → Inactive` | -1 |
| `Maintenance → Active` | +1 |
| `Maintenance → Inactive` | No change (was already not active) |
| Any → `Inactive` via `deactivate_meter` | -1 (if was Active) |

### 7.3 Deactivation vs Status Change

| Aspect | `set_meter_status(Inactive)` | `deactivate_meter()` |
|--------|------------------------------|----------------------|
| Authority | Owner OR Admin | Owner ONLY |
| User meter count | Unchanged | Decremented |
| Reversible | Yes (admin can reactivate) | No |
| Event | `MeterStatusUpdated` | `MeterDeactivated` |
| Use case | Temporary disable | Permanent removal |

---

## Dual-Tracker System

### 8.1 System Overview

The dual-tracker system prevents double-counting while enabling independent use of energy for:

1. **GRID Token Minting** - Based on net energy surplus
2. **ERC Certificate Claiming** - Based on gross renewable generation

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DUAL-TRACKER SYSTEM                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ENERGY FLOW                                                                │
│   ═══════════                                                                │
│                                                                              │
│   Solar Panel ──────┐                                                        │
│   Wind Turbine ─────┼───▶ total_generation (cumulative)                     │
│   Battery ──────────┘                                                        │
│                                                                              │
│   Home Consumption ─────▶ total_consumption (cumulative)                    │
│                                                                              │
│   ─────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│   TRACKER 1: GRID TOKENS (Net Energy - P2P Trading)                         │
│   ═════════════════════════════════════════════════                          │
│                                                                              │
│   net_generation = total_generation - total_consumption                     │
│                                                                              │
│   unsettled_grid = net_generation - settled_net_generation                  │
│                                                                              │
│   On settlement:                                                             │
│       settled_net_generation = net_generation                               │
│       mint GRID tokens for unsettled_grid                                   │
│                                                                              │
│   ─────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│   TRACKER 2: ERC CERTIFICATES (Gross Generation - Regulatory)               │
│   ═══════════════════════════════════════════════════════════                │
│                                                                              │
│   unclaimed_erc = total_generation - claimed_erc_generation                 │
│                                                                              │
│   On ERC issuance (via Governance program):                                  │
│       claimed_erc_generation += issued_amount                               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 8.2 Mathematical Formulation

**GRID Token Calculation:**

$$
\text{Unsettled}_{GRID} = \max\left(0, (G_{total} - C_{total}) - S_{net}\right)
$$

Where:
- $G_{total}$ = `total_generation`
- $C_{total}$ = `total_consumption`
- $S_{net}$ = `settled_net_generation`

**ERC Certificate Calculation:**

$$
\text{Unclaimed}_{ERC} = G_{total} - S_{erc}
$$

Where:
- $S_{erc}$ = `claimed_erc_generation`

### 8.3 Example Scenario

| Step | Generation | Consumption | Net | Settled GRID | Claimed ERC | Mintable | Certifiable |
|------|------------|-------------|-----|--------------|-------------|----------|-------------|
| Initial | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Reading 1 | 500 | 100 | 400 | 0 | 0 | 400 | 500 |
| Settle GRID | 500 | 100 | 400 | 400 | 0 | 0 | 500 |
| Claim ERC (300) | 500 | 100 | 400 | 400 | 300 | 0 | 200 |
| Reading 2 | 800 | 200 | 600 | 400 | 300 | 200 | 500 |

---

## Type Definitions

### 9.1 UserType

Classification of platform participants.

| Type | Value | Description | Can Generate | Can Consume | Can Trade |
|------|-------|-------------|--------------|-------------|-----------|
| Prosumer | 0 | Energy producer/consumer | ✓ | ✓ | ✓ |
| Consumer | 1 | Energy consumer only | ✗ | ✓ | Buy only |

### 9.2 UserStatus

User account lifecycle states.

| Status | Value | Description |
|--------|-------|-------------|
| Active | 0 | Fully operational |
| Suspended | 1 | Temporarily disabled (e.g., payment issues) |
| Inactive | 2 | Permanently disabled |

### 9.3 MeterType

Classification of energy devices.

| Type | Value | Description |
|------|-------|-------------|
| Solar | 0 | Photovoltaic solar installation |
| Wind | 1 | Wind turbine installation |
| Battery | 2 | Energy storage system |
| Grid | 3 | Grid connection meter |

### 9.4 MeterStatus

Meter operational states.

| Status | Value | Description |
|--------|-------|-------------|
| Active | 0 | Recording and reporting readings |
| Inactive | 1 | Not recording readings (permanent after deactivate_meter) |
| Maintenance | 2 | Under service/calibration |

---

## Events

### 10.1 Event Definitions (9 Total)

| Event | Fields | Description |
|-------|--------|-------------|
| `RegistryInitialized` | authority, timestamp | Registry created |
| `OracleAuthoritySet` | old_oracle, new_oracle, timestamp | Oracle configuration changed (NEW) |
| `UserRegistered` | user, user_type, location, timestamp | New user created |
| `MeterRegistered` | meter_id, owner, meter_type, timestamp | New meter created |
| `UserStatusUpdated` | user, old_status, new_status, timestamp | User status changed |
| `MeterReadingUpdated` | meter_id, owner, energy_generated, energy_consumed, timestamp | Reading submitted |
| `MeterStatusUpdated` | meter_id, owner, old_status, new_status, timestamp | Meter status changed (NEW) |
| `MeterDeactivated` | meter_id, owner, final_generation, final_consumption, timestamp | Meter permanently disabled (NEW) |
| `MeterBalanceSettled` | meter_id, owner, tokens_to_mint, total_settled, timestamp | Settlement completed |

### 10.2 Event Usage for Analytics

| Event | Analytics Use Case |
|-------|-------------------|
| `RegistryInitialized` | System bootstrap tracking |
| `OracleAuthoritySet` | Oracle rotation auditing |
| `UserRegistered` | User growth metrics, geographic distribution |
| `MeterRegistered` | DER capacity planning, technology mix |
| `UserStatusUpdated` | User lifecycle analytics |
| `MeterReadingUpdated` | Real-time energy monitoring, forecasting |
| `MeterStatusUpdated` | Meter health monitoring |
| `MeterDeactivated` | Churn analysis, final energy accounting |
| `MeterBalanceSettled` | Token velocity, settlement patterns |

---

## Error Handling

### 11.1 Error Codes (12 Total)

| Code | Name | Message |
|------|------|---------|
| 6000 | `UnauthorizedUser` | Unauthorized user |
| 6001 | `UnauthorizedAuthority` | Unauthorized authority |
| 6002 | `InvalidUserStatus` | Invalid user status |
| 6003 | `InvalidMeterStatus` | Invalid meter status |
| 6004 | `UserNotFound` | User not found |
| 6005 | `MeterNotFound` | Meter not found |
| 6006 | `NoUnsettledBalance` | No unsettled balance to tokenize |
| 6007 | `OracleNotConfigured` | Oracle authority not configured (NEW) |
| 6008 | `UnauthorizedOracle` | Unauthorized oracle - signer is not the configured oracle (NEW) |
| 6009 | `StaleReading` | Stale reading - timestamp must be newer than last reading (NEW) |
| 6010 | `ReadingTooHigh` | Reading too high - exceeds maximum delta limit (NEW) |
| 6011 | `AlreadyInactive` | Meter is already inactive (NEW) |

### 11.2 Error Handling Strategy

| Error Category | Handling Approach | Recovery Action |
|---------------|-------------------|-----------------|
| Authorization | Immediate reject | Verify signer |
| Validation | Immediate reject | Fix input parameters |
| State | Conditional | Wait for state change |
| Oracle | Configuration | Set oracle authority first |
| Overflow | Checked math | Use saturating_* operations |

---

## Security Model

### 12.1 Access Control Matrix

| Instruction | User | Owner | Oracle | Admin |
|-------------|:----:|:-----:|:------:|:-----:|
| `initialize` | ✗ | ✗ | ✗ | ✓ |
| `set_oracle_authority` | ✗ | ✗ | ✗ | ✓ |
| `register_user` | ✓ | - | ✗ | ✗ |
| `register_meter` | ✗ | ✓ | ✗ | ✗ |
| `update_user_status` | ✗ | ✗ | ✗ | ✓ |
| `update_meter_reading` | ✗ | ✗ | ✓ | ✗ |
| `set_meter_status` | ✗ | ✓ | ✗ | ✓ |
| `deactivate_meter` | ✗ | ✓ | ✗ | ✗ |
| `settle_meter_balance` | ✗ | ✓ | ✗ | ✗ |
| `settle_and_mint_tokens` | ✗ | ✓ | ✗ | ✗ |

### 12.2 Key Security Constraints

| Constraint | Description | Error Code |
|------------|-------------|------------|
| Oracle authorization | Only configured oracle can submit readings | `OracleNotConfigured`, `UnauthorizedOracle` |
| Ownership verification | Users can only manage their own meters | `UnauthorizedUser` |
| Authority check | Only admin can configure oracle | `UnauthorizedAuthority` |
| Reading validation | Timestamp must be newer than last reading | `StaleReading` |
| Delta limit validation | Max 1 GWh per reading | `ReadingTooHigh` |

---

## Cross-Program Integration

### 13.1 CPI to Energy Token Program

The Registry calls Energy Token for minting via the `settle_and_mint_tokens` instruction.

**CPI Flow:**
1. Verify meter ownership
2. Verify meter is active
3. Calculate unsettled balance
4. Update settled_net_generation
5. CPI → energy_token::mint_tokens_direct(amount)
6. Emit settlement event

### 13.2 Integration with Governance Program

Governance reads MeterAccount for ERC issuance:

1. Load meter account
2. Calculate unclaimed energy (`total_generation - claimed_erc_generation`)
3. Validate request amount ≤ unclaimed
4. Update tracker via CPI or shared state

### 13.3 Integration Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      CROSS-PROGRAM INTEGRATION                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐     │
│   │    REGISTRY     │      │  ENERGY TOKEN   │      │   GOVERNANCE    │     │
│   │     v2.0        │      │                 │      │                 │     │
│   ├─────────────────┤      ├─────────────────┤      ├─────────────────┤     │
│   │                 │      │                 │      │                 │     │
│   │ settle_and_     │─CPI─▶│ mint_tokens_    │      │                 │     │
│   │ mint_tokens     │      │ direct          │      │                 │     │
│   │                 │      │                 │      │                 │     │
│   │ MeterAccount    │      │                 │      │                 │     │
│   │   .settled_net_ │◀Read─│                 │      │ issue_erc       │     │
│   │   generation    │      │                 │      │                 │     │
│   │                 │      │                 │      │                 │     │
│   │   .claimed_erc_ │◀─────────────────────────────│ (updates        │     │
│   │   generation    │Write │                 │      │  tracker)       │     │
│   │                 │      │                 │      │                 │     │
│   │ Oracle Auth ────│──────│─────────────────│──────│──▶ Validate     │     │
│   │                 │      │                 │      │     readings    │     │
│   └─────────────────┘      └─────────────────┘      └─────────────────┘     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Appendix: Account Space Calculation

| Account | Components | Size (bytes) |
|---------|-----------|--------------|
| **Registry (v2.0)** | Discriminator | 8 |
| | authority (Pubkey) | 32 |
| | oracle_authority (Option<Pubkey>) | 33 |
| | user_count (u64) | 8 |
| | meter_count (u64) | 8 |
| | active_meter_count (u64) | 8 |
| | created_at (i64) | 8 |
| | **Total** | **105** |
| **UserAccount** | Discriminator | 8 |
| | authority (Pubkey) | 32 |
| | user_type (enum) | 1 |
| | location (String) | 4 + 100 |
| | status (enum) | 1 |
| | registered_at (i64) | 8 |
| | meter_count (u32) | 4 |
| | created_at (i64) | 8 |
| | **Total** | **166** |
| **MeterAccount** | Discriminator | 8 |
| | meter_id (String) | 4 + 50 |
| | owner (Pubkey) | 32 |
| | meter_type (enum) | 1 |
| | status (enum) | 1 |
| | registered_at (i64) | 8 |
| | last_reading_at (i64) | 8 |
| | total_generation (u64) | 8 |
| | total_consumption (u64) | 8 |
| | settled_net_generation (u64) | 8 |
| | claimed_erc_generation (u64) | 8 |
| | **Total** | **144** |

---

## Appendix: Migration Guide

### Upgrading from v1.x to v2.0

1. **Deploy new program** - Program ID remains the same
2. **Configure oracle authority** - Call `set_oracle_authority` immediately after upgrade
3. **Update oracle integration** - Oracle must now pass registry account in `update_meter_reading`
4. **Update client code** - New instruction signatures and account requirements

### Breaking Changes Checklist

- [ ] `update_meter_reading` now requires `registry` account
- [ ] Oracle must be configured before any readings can be submitted
- [ ] Timestamp validation enforced (no backdated readings)
- [ ] Delta limit enforced (max 1 GWh per reading)

---

*Last Updated: November 2025*
*Version: 2.0.0*
