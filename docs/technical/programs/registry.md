# Registry Program - Technical Reference

> **Implementation reference for the Registry Program**

Program ID: `9XS8uUEVErcA8LABrJQAdohWMXTToBwhFN7Rvur6dC5`

Source: [`programs/registry/src/lib.rs`](../../../programs/registry/src/lib.rs)

---

## Instructions

### `initialize_registry`

Creates the global registry configuration account.

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `registry` | PDA (mut) | Registry state account |
| `authority` | Signer | Initial authority |
| `system_program` | Program | System program |

**PDA Seeds:** `["registry"]`

---

### `register_user`

Registers a new user account.

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `user_account` | PDA (mut) | User state account |
| `wallet` | Signer | User's wallet |
| `registry` | Account | Registry for counter |
| `system_program` | Program | System program |

**Arguments:**
| Name | Type | Description |
|------|------|-------------|
| `user_type` | UserType | Prosumer or Consumer |
| `location` | String | User location |

**PDA Seeds:** `["user", wallet.key()]`

---

### `register_meter`

Registers a new smart meter.

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `meter_account` | PDA (mut) | Meter state account |
| `owner` | Signer | Meter owner |
| `user_account` | Account | Owner's user account |
| `registry` | Account (mut) | Registry for counter |
| `system_program` | Program | System program |

**Arguments:**
| Name | Type | Description |
|------|------|-------------|
| `meter_id` | String | Unique meter identifier |
| `meter_type` | MeterType | Solar, Wind, or Hybrid |
| `location` | String | Installation location |
| `capacity_kw` | u64 | Rated capacity |

**PDA Seeds:** `["meter", meter_id.as_bytes()]`

---

### `update_meter_reading`

Updates meter with new energy reading.

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `meter_account` | PDA (mut) | Meter to update |
| `oracle_gateway` | Signer | Authorized gateway |
| `oracle_data` | Account | Oracle configuration |

**Arguments:**
| Name | Type | Description |
|------|------|-------------|
| `generation` | u64 | New total generation (kWh) |
| `consumption` | u64 | New total consumption (kWh) |

---

### `settle_meter_balance`

Calculates and returns mintable token amount.

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `meter_account` | PDA (mut) | Meter to settle |
| `owner` | Signer | Meter owner |

**Returns:** `u64` - Amount of tokens to mint

---

### `settle_and_mint_tokens`

Atomically settles meter and mints tokens via CPI.

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `meter_account` | PDA (mut) | Meter to settle |
| `owner` | Signer | Meter owner |
| `token_info` | Account (mut) | Energy Token config |
| `mint` | Account (mut) | Token mint |
| `user_token_account` | Account (mut) | Recipient token account |
| `token_info_authority` | PDA | Mint authority |
| `energy_token_program` | Program | Energy Token program |
| `token_program` | Program | SPL Token program |

---

## Account Structures

### Registry

```rust
#[account]
pub struct Registry {
    pub authority: Pubkey,
    pub user_count: u64,
    pub meter_count: u64,
    pub created_at: i64,
    pub bump: u8,
}
```

### UserAccount

```rust
#[account]
pub struct UserAccount {
    pub wallet: Pubkey,
    pub user_type: UserType,
    pub location: String,
    pub registered_at: i64,
    pub is_active: bool,
    pub bump: u8,
}
```

### MeterAccount

```rust
#[account]
pub struct MeterAccount {
    pub meter_id: String,
    pub owner: Pubkey,
    pub meter_type: MeterType,
    pub location: String,
    pub capacity_kw: u64,
    pub total_generation: u64,
    pub total_consumption: u64,
    pub settled_net_generation: u64,
    pub claimed_erc_generation: u64,
    pub status: MeterStatus,
    pub registered_at: i64,
    pub last_reading_at: i64,
    pub bump: u8,
}
```

---

## Enums

### UserType

```rust
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum UserType {
    Prosumer,
    Consumer,
}
```

### MeterType

```rust
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum MeterType {
    Solar,
    Wind,
    Hybrid,
}
```

### MeterStatus

```rust
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum MeterStatus {
    Pending,
    Active,
    Inactive,
    Suspended,
}
```

---

## Events

```rust
#[event]
pub struct RegistryInitialized {
    pub authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct UserRegistered {
    pub wallet: Pubkey,
    pub user_type: UserType,
    pub location: String,
    pub timestamp: i64,
}

#[event]
pub struct MeterRegistered {
    pub meter_id: String,
    pub owner: Pubkey,
    pub meter_type: MeterType,
    pub timestamp: i64,
}

#[event]
pub struct MeterReadingUpdated {
    pub meter_id: String,
    pub generation: u64,
    pub consumption: u64,
    pub timestamp: i64,
}

#[event]
pub struct MeterBalanceSettled {
    pub meter_id: String,
    pub amount: u64,
    pub new_settled: u64,
    pub timestamp: i64,
}
```

---

## Errors

```rust
#[error_code]
pub enum RegistryError {
    #[msg("Unauthorized access")]
    Unauthorized,
    #[msg("Invalid meter status")]
    InvalidMeterStatus,
    #[msg("Insufficient balance to mint")]
    InsufficientBalance,
    #[msg("Meter is not active")]
    MeterNotActive,
    #[msg("Invalid meter owner")]
    InvalidOwner,
    #[msg("Meter ID already exists")]
    DuplicateMeter,
    #[msg("Invalid user type")]
    InvalidUserType,
}
```

---

*For academic documentation, see [Academic Registry Documentation](../../academic/programs/registry.md)*
