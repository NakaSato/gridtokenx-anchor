# Registry Program

**Program ID:** `HWoKSbNy4jJBFJ7g7drxZgAfTmjFqvg1Sx6vXosfJNAi`

The Registry program serves as the directory for all participants in the GridTokenX ecosystem. It maps user identities to on-chain accounts and manages smart meter registrations.

## State Accounts

### Registry
Global registry state.
**PDA**: `["registry"]`.

```rust
#[account]
pub struct Registry {
    pub authority: Pubkey,         // Program admin
    pub oracle_authority: Option<Pubkey>, // Authorized oracle
    pub user_count: u64,
    pub meter_count: u64,
    pub active_meter_count: u64,
    pub created_at: i64,
}
```

### UserAccount
Represents a participant (Consumer, Producer, Prosumer).
**PDA**: `["user", user_authority]`.

```rust
#[account]
pub struct UserAccount {
    pub authority: Pubkey,
    pub user_type: UserType,       // Enum
    pub location: String,
    pub status: UserStatus,        // Enum
    pub meter_count: u32,
    pub registered_at: i64,
    pub created_at: i64,
}
```

### MeterAccount
Represents a physical or virtual smart meter.
**PDA**: `["meter", meter_id]`.

```rust
#[account]
pub struct MeterAccount {
    pub meter_id: String,
    pub user: Pubkey,              // Owner reference
    pub meter_type: MeterType,     // Consumption, Production, Bidirectional
    pub accumulated_production: u64,
    pub accumulated_consumption: u64,
    pub last_reading_at: i64,
    pub status: MeterStatus,
    pub registered_at: i64,
}
```

## Instructions

### `initialize`
Initializes the global registry.
- **Seeds**: `["registry"]`

### `set_oracle_authority`
Sets the address of the Oracle program/authority that is allowed to write meter data.
- **Auth**: Admin only.
- **Validation**: Current authority check.

### `register_user`
Registers a new participant.
- **Params**: `user_type`, `location`.
- **Seeds**: `["user", authority_key]`.
- **Events**: Emits `UserRegistered`.

### `register_meter`
Registers a smart meter for an existing user.
- **Check**: Verifies `user_authority` matches the `user_account`.
- **Params**: `meter_id`, `meter_type`.
- **Seeds**: `["meter", meter_id]`.
- **State**: Increments user and global meter counts.
