# Registry Program

> **Academic Documentation - User and Meter Registration System**

Program ID: `9XS8uUEVErcA8LABrJQAdohWMXTToBwhFN7Rvur6dC5`

---

## Overview

The Registry Program serves as the identity and asset management layer for the GridTokenX platform. It manages user accounts, meter registrations, and implements the dual-tracker system for energy tokenization.

---

## Theoretical Foundation

### Identity Management in Decentralized Systems

Traditional energy markets rely on centralized identity providers. The Registry Program implements a self-sovereign identity model where:

- Users control their own accounts via wallet ownership
- Meters are cryptographically bound to owner wallets
- No central authority can revoke access unilaterally

### The Dual-Tracker Innovation

The program introduces a novel dual-tracker system that separates two distinct energy accounting concepts:

| Tracker | Purpose | Use Case |
|---------|---------|----------|
| **GRID Tracker** | Net energy surplus | Token minting and P2P trading |
| **ERC Tracker** | Gross generation | Renewable energy certification |

This separation enables users to:
1. Trade their net surplus as GRID tokens
2. Claim renewable energy certificates for total generation
3. Without double-counting or regulatory conflicts

---

## Account Architecture

### Registry Account (Singleton)

The global configuration account storing platform-wide settings.

| Field | Type | Description |
|-------|------|-------------|
| `authority` | PublicKey | Administrative authority |
| `user_count` | u64 | Total registered users |
| `meter_count` | u64 | Total registered meters |
| `created_at` | i64 | Registry creation timestamp |
| `bump` | u8 | PDA bump seed |

**PDA Derivation**: Seeds = `["registry"]`

### User Account

Individual user profiles linked to wallet addresses.

| Field | Type | Description |
|-------|------|-------------|
| `wallet` | PublicKey | User's Solana wallet |
| `user_type` | UserType | Prosumer or Consumer |
| `location` | String | Geographic location |
| `registered_at` | i64 | Registration timestamp |
| `is_active` | bool | Account status |
| `bump` | u8 | PDA bump seed |

**PDA Derivation**: Seeds = `["user", wallet.key()]`

### Meter Account

Smart meter registration with dual-tracker state.

| Field | Type | Description |
|-------|------|-------------|
| `meter_id` | String | Unique meter identifier |
| `owner` | PublicKey | Meter owner's wallet |
| `meter_type` | MeterType | Solar, Wind, or Hybrid |
| `location` | String | Installation location |
| `capacity_kw` | u64 | Rated capacity in kW |
| `total_generation` | u64 | Cumulative generation (kWh) |
| `total_consumption` | u64 | Cumulative consumption (kWh) |
| `settled_net_generation` | u64 | **GRID Tracker** - Already minted |
| `claimed_erc_generation` | u64 | **ERC Tracker** - Already certified |
| `status` | MeterStatus | Active, Inactive, or Suspended |
| `registered_at` | i64 | Registration timestamp |
| `last_reading_at` | i64 | Last update timestamp |
| `bump` | u8 | PDA bump seed |

**PDA Derivation**: Seeds = `["meter", meter_id.as_bytes()]`

---

## State Machine Model

### Meter Status Transitions

The meter follows a defined state machine:

**States:**
- `Pending` → Initial registration state
- `Active` → Operational, can submit readings
- `Inactive` → Temporarily disabled
- `Suspended` → Administrative suspension

**Transitions:**
- Pending → Active (via `activate_meter`)
- Active → Inactive (via `deactivate_meter`)
- Inactive → Active (via `activate_meter`)
- Any → Suspended (via `suspend_meter`, authority only)
- Suspended → Active (via `unsuspend_meter`, authority only)

---

## Instructions

### Administrative Instructions

| Instruction | Authority | Description |
|-------------|-----------|-------------|
| `initialize_registry` | Deployer | Create global registry account |
| `update_registry_authority` | Current Authority | Transfer administrative control |

### User Management Instructions

| Instruction | Signer | Description |
|-------------|--------|-------------|
| `register_user` | User Wallet | Create new user account |
| `update_user_profile` | User Wallet | Modify user information |
| `deactivate_user` | User Wallet | Disable user account |

### Meter Management Instructions

| Instruction | Signer | Description |
|-------------|--------|-------------|
| `register_meter` | Meter Owner | Register new smart meter |
| `update_meter_reading` | Oracle Gateway | Submit energy readings |
| `activate_meter` | Meter Owner | Enable meter operations |
| `deactivate_meter` | Meter Owner | Disable meter temporarily |

### Settlement Instructions

| Instruction | Signer | Description |
|-------------|--------|-------------|
| `settle_meter_balance` | Meter Owner | Calculate mintable tokens |
| `settle_and_mint_tokens` | Meter Owner | Settle and mint via CPI |

---

## Settlement Mechanics

### Net Generation Calculation

The settlement process calculates mintable tokens using:

$$\text{Mintable} = (\text{total\_generation} - \text{total\_consumption}) - \text{settled\_net\_generation}$$

Where:
- `total_generation`: Cumulative energy produced (kWh)
- `total_consumption`: Cumulative energy consumed (kWh)
- `settled_net_generation`: Previously minted amount

### Settlement Constraints

1. **Non-negative requirement**: Mintable amount must be positive
2. **Monotonic increase**: `settled_net_generation` only increases
3. **Ownership verification**: Only meter owner can settle
4. **Status check**: Meter must be in Active status

### Cross-Program Invocation

The `settle_and_mint_tokens` instruction performs atomic settlement:

1. Calculate unsettled balance
2. Update `settled_net_generation` tracker
3. Invoke Energy Token program via CPI
4. Mint tokens to user's wallet

This ensures settlement and minting occur atomically—both succeed or both fail.

---

## Security Model

### Access Control Matrix

| Operation | Public | User | Meter Owner | Authority |
|-----------|:------:|:----:|:-----------:|:---------:|
| Register user | ✓ | | | |
| Register meter | | ✓ | | |
| Update readings | | | | Gateway |
| Settle balance | | | ✓ | |
| Suspend meter | | | | ✓ |

### Threat Mitigations

| Threat | Mitigation |
|--------|------------|
| Unauthorized registration | Wallet signature required |
| Double-minting | `settled_net_generation` tracker |
| Reading manipulation | Gateway authorization |
| Account takeover | PDA ownership model |

---

## Events

| Event | Trigger | Key Fields |
|-------|---------|------------|
| `RegistryInitialized` | Registry creation | authority, timestamp |
| `UserRegistered` | User registration | wallet, user_type, location |
| `MeterRegistered` | Meter registration | meter_id, owner, meter_type |
| `MeterReadingUpdated` | New reading | meter_id, generation, consumption |
| `MeterBalanceSettled` | Settlement | meter_id, amount, new_settled |

---

## Errors

| Error Code | Name | Description |
|------------|------|-------------|
| 6000 | `Unauthorized` | Caller lacks required authority |
| 6001 | `InvalidMeterStatus` | Meter not in required state |
| 6002 | `InsufficientBalance` | No tokens available to mint |
| 6003 | `MeterNotActive` | Meter must be active |
| 6004 | `InvalidOwner` | Caller is not meter owner |
| 6005 | `DuplicateMeter` | Meter ID already registered |
| 6006 | `InvalidUserType` | Unknown user type specified |

---

## Research Implications

### Contribution to Literature

The Registry Program demonstrates practical implementation of:

1. **Self-sovereign energy identity**: Users maintain control without intermediaries
2. **Dual-accounting systems**: Separate tracking for different asset classes
3. **Atomic cross-program operations**: Ensuring consistency across program boundaries

### Performance Characteristics

| Metric | Value |
|--------|-------|
| Account creation cost | ~0.002 SOL |
| Settlement compute units | ~50,000 CU |
| CPI overhead | ~20,000 CU |

---

*For implementation details, see [Technical Registry Documentation](../../technical/programs/registry.md)*
