# Registry Program Instructions

## Program ID
```
2XPQmRp1wz9ZdVxGLdgBEJjKL7gaV7g7ScvhzSGBV2ek
```

---

## initialize

Initialize the registry program state.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `authority` | `Signer` | Program authority |
| `registry_state` | `PDA` | Registry state account |
| `system_program` | `Program` | System program |

### Arguments

| Name | Type | Description |
|------|------|-------------|
| `admin` | `Pubkey` | Admin public key |

### Example

```typescript
await program.methods
  .initialize(adminPubkey)
  .accounts({
    authority: wallet.publicKey,
    registryState: registryPda,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

---

## register_user

Register a new user in the system.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `user` | `Signer` | User wallet |
| `user_account` | `PDA` | User account to create |
| `registry_state` | `PDA` | Registry state |
| `system_program` | `Program` | System program |

### Arguments

| Name | Type | Description |
|------|------|-------------|
| `user_type` | `UserType` | `Prosumer` or `Consumer` |
| `name` | `String` | User name (max 50 chars) |
| `location` | `String` | Geographic location |

### PDA Seeds

```
["user", user_wallet]
```

### Example

```typescript
const [userPda] = PublicKey.findProgramAddressSync(
  [Buffer.from('user'), wallet.publicKey.toBuffer()],
  REGISTRY_PROGRAM_ID
);

await program.methods
  .registerUser({ prosumer: {} }, 'John Doe', 'Bangkok')
  .accounts({
    user: wallet.publicKey,
    userAccount: userPda,
    registryState: registryStatePda,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

### Errors

| Code | Description |
|------|-------------|
| `UserAlreadyRegistered` | User account already exists |
| `InvalidName` | Name too long or empty |

---

## update_user

Update existing user details.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `user` | `Signer` | User wallet |
| `user_account` | `PDA` | User account |

### Arguments

| Name | Type | Description |
|------|------|-------------|
| `name` | `Option<String>` | New name (optional) |
| `location` | `Option<String>` | New location (optional) |

### Example

```typescript
await program.methods
  .updateUser('Jane Doe', null)
  .accounts({
    user: wallet.publicKey,
    userAccount: userPda,
  })
  .rpc();
```

---

## register_meter

Register a smart meter for a user.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `owner` | `Signer` | Meter owner |
| `user_account` | `PDA` | Owner's user account |
| `meter_account` | `PDA` | Meter account to create |
| `registry_state` | `PDA` | Registry state |
| `system_program` | `Program` | System program |

### Arguments

| Name | Type | Description |
|------|------|-------------|
| `serial_number` | `String` | Unique meter serial (max 32 chars) |
| `meter_type` | `MeterType` | `Production` or `Consumption` or `Bidirectional` |
| `capacity_kw` | `u32` | Maximum capacity in kW |
| `location` | `String` | Installation location |

### PDA Seeds

```
["meter", serial_number]
```

### Example

```typescript
const serialNumber = 'MTR-2024-001';
const [meterPda] = PublicKey.findProgramAddressSync(
  [Buffer.from('meter'), Buffer.from(serialNumber)],
  REGISTRY_PROGRAM_ID
);

await program.methods
  .registerMeter(
    serialNumber,
    { production: {} },
    10, // 10 kW
    'Bangkok, Thailand'
  )
  .accounts({
    owner: wallet.publicKey,
    userAccount: userPda,
    meterAccount: meterPda,
    registryState: registryStatePda,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

### Errors

| Code | Description |
|------|-------------|
| `MeterAlreadyRegistered` | Serial number exists |
| `UserNotRegistered` | Owner not registered |
| `InvalidSerialNumber` | Invalid serial format |
| `InvalidCapacity` | Capacity out of range |

---

## update_meter

Update meter status or details.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `authority` | `Signer` | Owner or admin |
| `meter_account` | `PDA` | Meter account |
| `user_account` | `PDA` | Owner's user account |

### Arguments

| Name | Type | Description |
|------|------|-------------|
| `status` | `Option<MeterStatus>` | New status |
| `capacity_kw` | `Option<u32>` | New capacity |
| `location` | `Option<String>` | New location |

### MeterStatus Values

| Status | Description |
|--------|-------------|
| `Active` | Meter operational |
| `Inactive` | Meter disabled |
| `Maintenance` | Under maintenance |
| `Decommissioned` | Permanently removed |

### Example

```typescript
await program.methods
  .updateMeter({ inactive: {} }, null, null)
  .accounts({
    authority: wallet.publicKey,
    meterAccount: meterPda,
    userAccount: userPda,
  })
  .rpc();
```

---

## update_meter_reading

Record a new meter reading.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `authority` | `Signer` | Oracle or owner |
| `meter_account` | `PDA` | Meter account |
| `oracle_state` | `PDA` | Oracle state (for validation) |

### Arguments

| Name | Type | Description |
|------|------|-------------|
| `reading` | `u64` | Current reading (9 decimals) |
| `timestamp` | `i64` | Reading timestamp |

### Example

```typescript
await program.methods
  .updateMeterReading(
    new BN(15_500_000_000), // 15.5 kWh
    new BN(Math.floor(Date.now() / 1000))
  )
  .accounts({
    authority: oracleWallet.publicKey,
    meterAccount: meterPda,
    oracleState: oraclePda,
  })
  .rpc();
```

### Validation

1. Reading must be ≥ previous reading
2. Timestamp must be > last reading timestamp
3. Rate of change must be within acceptable range

### Errors

| Code | Description |
|------|-------------|
| `MeterNotActive` | Meter is not active |
| `InvalidReading` | Reading validation failed |
| `ReadingTooHigh` | Exceeds maximum rate |
| `ReadingDecreased` | Cannot decrease |
| `Unauthorized` | Caller not authorized |

---

## Account Structures

### RegistryState

```rust
pub struct RegistryState {
    pub authority: Pubkey,
    pub admin: Pubkey,
    pub total_users: u64,
    pub total_meters: u64,
    pub initialized_at: i64,
}
```

### UserAccount

```rust
pub struct UserAccount {
    pub wallet: Pubkey,
    pub user_type: UserType,
    pub name: String,
    pub location: String,
    pub meters: Vec<Pubkey>,
    pub is_active: bool,
    pub registered_at: i64,
    pub updated_at: i64,
}
```

### MeterAccount

```rust
pub struct MeterAccount {
    pub owner: Pubkey,
    pub serial_number: String,
    pub meter_type: MeterType,
    pub status: MeterStatus,
    pub capacity_kw: u32,
    pub location: String,
    pub last_reading: u64,
    pub last_reading_timestamp: i64,
    pub total_production: u64,
    pub total_consumption: u64,
    pub registered_at: i64,
    pub updated_at: i64,
}
```

---

## Events

### UserRegistered

```rust
#[event]
pub struct UserRegistered {
    pub user: Pubkey,
    pub user_type: UserType,
    pub name: String,
    pub timestamp: i64,
}
```

### MeterRegistered

```rust
#[event]
pub struct MeterRegistered {
    pub meter: Pubkey,
    pub owner: Pubkey,
    pub serial_number: String,
    pub meter_type: MeterType,
    pub timestamp: i64,
}
```

### MeterReadingUpdated

```rust
#[event]
pub struct MeterReadingUpdated {
    pub meter: Pubkey,
    pub reading: u64,
    pub previous_reading: u64,
    pub timestamp: i64,
}
```

---

**Document Version**: 1.0
