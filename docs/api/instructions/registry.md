# Registry Program Instructions v2.0

## Program ID
```
FQYhgNRRWDCvy9WPeZPo5oZw63iHpJZToi1uUp25jE4a
```

---

## Table of Contents

1. [initialize](#initialize)
2. [set_oracle_authority](#set_oracle_authority) (NEW)
3. [register_user](#register_user)
4. [register_meter](#register_meter)
5. [update_user_status](#update_user_status)
6. [update_meter_reading](#update_meter_reading) (ENHANCED)
7. [set_meter_status](#set_meter_status) (NEW)
8. [deactivate_meter](#deactivate_meter) (NEW)
9. [is_valid_user](#is_valid_user)
10. [is_valid_meter](#is_valid_meter)
11. [get_unsettled_balance](#get_unsettled_balance)
12. [settle_meter_balance](#settle_meter_balance)
13. [settle_and_mint_tokens](#settle_and_mint_tokens)

---

## initialize

Initialize the registry program state.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `registry` | `PDA` (init) | Registry singleton account |
| `authority` | `Signer` | Program authority (becomes admin) |
| `system_program` | `Program` | System program |

### PDA Seeds

```
["registry"]
```

### Example

```typescript
const [registryPda] = PublicKey.findProgramAddressSync(
  [Buffer.from('registry')],
  REGISTRY_PROGRAM_ID
);

await program.methods
  .initialize()
  .accounts({
    registry: registryPda,
    authority: wallet.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

### State After Initialization

```typescript
{
  authority: wallet.publicKey,
  oracleAuthority: null,        // Must be set via set_oracle_authority
  userCount: 0,
  meterCount: 0,
  activeMeterCount: 0,
  createdAt: <timestamp>
}
```

---

## set_oracle_authority

Configure the authorized oracle for meter readings. **NEW in v2.0**

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `registry` | `Account` (mut) | Registry singleton |
| `authority` | `Signer` | Must be registry authority |

### Arguments

| Name | Type | Description |
|------|------|-------------|
| `oracle` | `Pubkey` | Authorized oracle wallet |

### Example

```typescript
await program.methods
  .setOracleAuthority(oracleWallet.publicKey)
  .accounts({
    registry: registryPda,
    authority: adminWallet.publicKey,
  })
  .signers([adminWallet])
  .rpc();
```

### Errors

| Code | Description |
|------|-------------|
| `UnauthorizedAuthority` | Signer is not registry authority |

### Events Emitted

```typescript
OracleAuthoritySet {
  oldOracle: null | Pubkey,
  newOracle: Pubkey,
  timestamp: i64
}
```

---

## register_user

Register a new user in the system.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `registry` | `Account` (mut) | Registry singleton |
| `user_account` | `PDA` (init) | User account to create |
| `user_authority` | `Signer` | User's wallet |
| `system_program` | `Program` | System program |

### Arguments

| Name | Type | Description |
|------|------|-------------|
| `user_type` | `UserType` | `{ prosumer: {} }` or `{ consumer: {} }` |
| `location` | `String` | Geographic location (max 100 chars) |

### PDA Seeds

```
["user", user_authority.key()]
```

### Example

```typescript
const [userPda] = PublicKey.findProgramAddressSync(
  [Buffer.from('user'), wallet.publicKey.toBuffer()],
  REGISTRY_PROGRAM_ID
);

await program.methods
  .registerUser({ prosumer: {} }, 'Bangkok, Thailand')
  .accounts({
    registry: registryPda,
    userAccount: userPda,
    userAuthority: wallet.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

### Events Emitted

```typescript
UserRegistered {
  user: Pubkey,
  userType: UserType,
  location: string,
  timestamp: i64
}
```

---

## register_meter

Register a smart meter for a user.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `registry` | `Account` (mut) | Registry singleton |
| `user_account` | `Account` (mut) | Owner's user account |
| `meter_account` | `PDA` (init) | Meter account to create |
| `user_authority` | `Signer` | Meter owner's wallet |
| `system_program` | `Program` | System program |

### Arguments

| Name | Type | Description |
|------|------|-------------|
| `meter_id` | `String` | Unique meter identifier (max 50 chars) |
| `meter_type` | `MeterType` | `{ solar: {} }`, `{ wind: {} }`, `{ battery: {} }`, or `{ grid: {} }` |

### PDA Seeds

```
["meter", meter_id]
```

### Example

```typescript
const meterId = 'MTR-2024-001';
const [meterPda] = PublicKey.findProgramAddressSync(
  [Buffer.from('meter'), Buffer.from(meterId)],
  REGISTRY_PROGRAM_ID
);

await program.methods
  .registerMeter(meterId, { solar: {} })
  .accounts({
    registry: registryPda,
    userAccount: userPda,
    meterAccount: meterPda,
    userAuthority: wallet.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

### State Changes

- `registry.meterCount += 1`
- `registry.activeMeterCount += 1`
- `userAccount.meterCount += 1`

### Errors

| Code | Description |
|------|-------------|
| `UnauthorizedUser` | Signer doesn't match user_account.authority |

### Events Emitted

```typescript
MeterRegistered {
  meterId: string,
  owner: Pubkey,
  meterType: MeterType,
  timestamp: i64
}
```

---

## update_user_status

Update user status (admin only).

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `registry` | `Account` | Registry singleton (has_one = authority) |
| `user_account` | `Account` (mut) | User account to update |
| `authority` | `Signer` | Must be registry authority |

### Arguments

| Name | Type | Description |
|------|------|-------------|
| `new_status` | `UserStatus` | `{ active: {} }`, `{ suspended: {} }`, or `{ inactive: {} }` |

### Example

```typescript
await program.methods
  .updateUserStatus({ suspended: {} })
  .accounts({
    registry: registryPda,
    userAccount: userPda,
    authority: adminWallet.publicKey,
  })
  .signers([adminWallet])
  .rpc();
```

### Events Emitted

```typescript
UserStatusUpdated {
  user: Pubkey,
  oldStatus: UserStatus,
  newStatus: UserStatus,
  timestamp: i64
}
```

---

## update_meter_reading

Record a new meter reading. **ENHANCED in v2.0** with oracle authorization and validation.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `registry` | `Account` | Registry (for oracle validation) |
| `meter_account` | `Account` (mut) | Meter account to update |
| `oracle_authority` | `Signer` | Must match registry.oracle_authority |

### Arguments

| Name | Type | Description |
|------|------|-------------|
| `energy_generated` | `u64` | Energy generated in Wh (max 1 GWh) |
| `energy_consumed` | `u64` | Energy consumed in Wh (max 1 GWh) |
| `reading_timestamp` | `i64` | Reading timestamp (must be > last reading) |

### Validation Rules (v2.0)

1. ✅ Oracle authority must be configured
2. ✅ Signer must match `registry.oracle_authority`
3. ✅ Meter status must be `Active`
4. ✅ Timestamp must be > `meter.last_reading_at`
5. ✅ Energy deltas must be ≤ 1,000,000,000,000 Wh (1 GWh)

### Example

```typescript
await program.methods
  .updateMeterReading(
    new BN(15_500_000),      // 15.5 kWh generated
    new BN(5_200_000),       // 5.2 kWh consumed
    new BN(Math.floor(Date.now() / 1000))
  )
  .accounts({
    registry: registryPda,
    meterAccount: meterPda,
    oracleAuthority: oracleWallet.publicKey,
  })
  .signers([oracleWallet])
  .rpc();
```

### Errors

| Code | Description |
|------|-------------|
| `OracleNotConfigured` | Oracle authority not set |
| `UnauthorizedOracle` | Signer ≠ configured oracle |
| `InvalidMeterStatus` | Meter not active |
| `StaleReading` | Timestamp ≤ last reading |
| `ReadingTooHigh` | Exceeds 1 GWh delta limit |

### Events Emitted

```typescript
MeterReadingUpdated {
  meterId: string,
  owner: Pubkey,
  energyGenerated: u64,
  energyConsumed: u64,
  timestamp: i64
}
```

---

## set_meter_status

Change meter operational status. **NEW in v2.0**

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `registry` | `Account` (mut) | Registry singleton |
| `meter_account` | `Account` (mut) | Meter to update |
| `authority` | `Signer` | Meter owner OR registry authority |

### Arguments

| Name | Type | Description |
|------|------|-------------|
| `new_status` | `MeterStatus` | `{ active: {} }`, `{ inactive: {} }`, or `{ maintenance: {} }` |

### Example

```typescript
// Owner setting meter to maintenance
await program.methods
  .setMeterStatus({ maintenance: {} })
  .accounts({
    registry: registryPda,
    meterAccount: meterPda,
    authority: ownerWallet.publicKey,
  })
  .rpc();

// Admin reactivating meter
await program.methods
  .setMeterStatus({ active: {} })
  .accounts({
    registry: registryPda,
    meterAccount: meterPda,
    authority: adminWallet.publicKey,
  })
  .signers([adminWallet])
  .rpc();
```

### Active Count Updates

| Transition | Effect |
|------------|--------|
| Active → Maintenance | `activeMeterCount -= 1` |
| Active → Inactive | `activeMeterCount -= 1` |
| Maintenance → Active | `activeMeterCount += 1` |
| Inactive → Active | `activeMeterCount += 1` |

### Events Emitted

```typescript
MeterStatusUpdated {
  meterId: string,
  owner: Pubkey,
  oldStatus: MeterStatus,
  newStatus: MeterStatus,
  timestamp: i64
}
```

---

## deactivate_meter

Permanently deactivate a meter. **NEW in v2.0**

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `registry` | `Account` (mut) | Registry singleton |
| `user_account` | `Account` (mut) | Owner's user account |
| `meter_account` | `Account` (mut) | Meter to deactivate |
| `owner` | `Signer` | Must be meter owner (admin cannot deactivate) |

### Example

```typescript
await program.methods
  .deactivateMeter()
  .accounts({
    registry: registryPda,
    userAccount: userPda,
    meterAccount: meterPda,
    owner: ownerWallet.publicKey,
  })
  .rpc();
```

### State Changes

- `meter.status = Inactive`
- `userAccount.meterCount -= 1`
- `registry.activeMeterCount -= 1` (if was active)

### Errors

| Code | Description |
|------|-------------|
| `UnauthorizedUser` | Signer ≠ meter.owner |
| `AlreadyInactive` | Meter already deactivated |

### Events Emitted

```typescript
MeterDeactivated {
  meterId: string,
  owner: Pubkey,
  finalGeneration: u64,
  finalConsumption: u64,
  timestamp: i64
}
```

---

## is_valid_user

Check if a user is valid and active.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `user_account` | `Account` | User account to check |

### Returns

`bool` - `true` if user status is `Active`

### Example

```typescript
const isValid = await program.methods
  .isValidUser()
  .accounts({
    userAccount: userPda,
  })
  .view();

console.log('User is valid:', isValid);
```

---

## is_valid_meter

Check if a meter is valid and active.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `meter_account` | `Account` | Meter account to check |

### Returns

`bool` - `true` if meter status is `Active`

### Example

```typescript
const isValid = await program.methods
  .isValidMeter()
  .accounts({
    meterAccount: meterPda,
  })
  .view();

console.log('Meter is valid:', isValid);
```

---

## get_unsettled_balance

Calculate unsettled net generation ready for tokenization.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `meter_account` | `Account` | Meter account |

### Returns

`u64` - Amount of energy available for GRID token minting (in Wh)

### Formula

```
net_generation = total_generation - total_consumption
unsettled = max(0, net_generation - settled_net_generation)
```

### Example

```typescript
const unsettled = await program.methods
  .getUnsettledBalance()
  .accounts({
    meterAccount: meterPda,
  })
  .view();

console.log('Unsettled balance:', unsettled.toString(), 'Wh');
```

---

## settle_meter_balance

Settle meter balance and prepare for GRID token minting.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `meter_account` | `Account` (mut) | Meter account |
| `meter_owner` | `Signer` | Must be meter owner |

### Returns

`u64` - Amount of energy settled (in Wh)

### Example

```typescript
const settledAmount = await program.methods
  .settleMeterBalance()
  .accounts({
    meterAccount: meterPda,
    meterOwner: ownerWallet.publicKey,
  })
  .rpc();
```

### Errors

| Code | Description |
|------|-------------|
| `InvalidMeterStatus` | Meter not active |
| `NoUnsettledBalance` | No energy to settle |

### Events Emitted

```typescript
MeterBalanceSettled {
  meterId: string,
  owner: Pubkey,
  tokensToMint: u64,
  totalSettled: u64,
  timestamp: i64
}
```

---

## settle_and_mint_tokens

Combined settlement and token minting via CPI to Energy Token program.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `meter_account` | `Account` (mut) | Meter account |
| `meter_owner` | `Signer` | Must be meter owner |
| `token_info` | `AccountInfo` (mut) | Energy token's token_info PDA |
| `mint` | `AccountInfo` (mut) | GRID token mint |
| `user_token_account` | `AccountInfo` (mut) | User's token account |
| `authority` | `AccountInfo` | Token mint authority |
| `energy_token_program` | `AccountInfo` | Energy token program |
| `token_program` | `AccountInfo` | SPL Token program |

### Example

```typescript
await program.methods
  .settleAndMintTokens()
  .accounts({
    meterAccount: meterPda,
    meterOwner: ownerWallet.publicKey,
    tokenInfo: tokenInfoPda,
    mint: gridMint,
    userTokenAccount: userGridTokenAccount,
    authority: energyTokenAuthority,
    energyTokenProgram: ENERGY_TOKEN_PROGRAM_ID,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .rpc();
```

### Errors

| Code | Description |
|------|-------------|
| `InvalidMeterStatus` | Meter not active |
| `UnauthorizedUser` | Signer ≠ meter.owner |
| `NoUnsettledBalance` | No energy to settle |

---

## Account Structures

### Registry (v2.0)

```rust
pub struct Registry {
    pub authority: Pubkey,              // 32 bytes
    pub oracle_authority: Option<Pubkey>, // 33 bytes (NEW)
    pub user_count: u64,                // 8 bytes
    pub meter_count: u64,               // 8 bytes
    pub active_meter_count: u64,        // 8 bytes (NEW)
    pub created_at: i64,                // 8 bytes
}
// Total: 105 bytes
```

### UserAccount

```rust
pub struct UserAccount {
    pub authority: Pubkey,      // 32 bytes
    pub user_type: UserType,    // 1 byte
    pub location: String,       // 4 + 100 bytes
    pub status: UserStatus,     // 1 byte
    pub registered_at: i64,     // 8 bytes
    pub meter_count: u32,       // 4 bytes
    pub created_at: i64,        // 8 bytes
}
// Total: 166 bytes
```

### MeterAccount

```rust
pub struct MeterAccount {
    pub meter_id: String,           // 4 + 50 bytes
    pub owner: Pubkey,              // 32 bytes
    pub meter_type: MeterType,      // 1 byte
    pub status: MeterStatus,        // 1 byte
    pub registered_at: i64,         // 8 bytes
    pub last_reading_at: i64,       // 8 bytes
    pub total_generation: u64,      // 8 bytes
    pub total_consumption: u64,     // 8 bytes
    pub settled_net_generation: u64, // 8 bytes
    pub claimed_erc_generation: u64, // 8 bytes
}
// Total: 144 bytes
```

---

## Type Definitions

### UserType

```typescript
type UserType = { prosumer: {} } | { consumer: {} };
```

### UserStatus

```typescript
type UserStatus = { active: {} } | { suspended: {} } | { inactive: {} };
```

### MeterType

```typescript
type MeterType = { solar: {} } | { wind: {} } | { battery: {} } | { grid: {} };
```

### MeterStatus

```typescript
type MeterStatus = { active: {} } | { inactive: {} } | { maintenance: {} };
```

---

## Events Summary

| Event | Trigger | Key Fields |
|-------|---------|------------|
| `RegistryInitialized` | initialize | authority |
| `OracleAuthoritySet` | set_oracle_authority | oldOracle, newOracle |
| `UserRegistered` | register_user | user, userType, location |
| `MeterRegistered` | register_meter | meterId, owner, meterType |
| `UserStatusUpdated` | update_user_status | oldStatus, newStatus |
| `MeterReadingUpdated` | update_meter_reading | energyGenerated, energyConsumed |
| `MeterStatusUpdated` | set_meter_status | oldStatus, newStatus |
| `MeterDeactivated` | deactivate_meter | finalGeneration, finalConsumption |
| `MeterBalanceSettled` | settle_meter_balance | tokensToMint, totalSettled |

---

## Error Codes

| Code | Name | Description |
|------|------|-------------|
| 6000 | `UnauthorizedUser` | Signer doesn't own the account |
| 6001 | `UnauthorizedAuthority` | Signer is not registry admin |
| 6002 | `InvalidUserStatus` | Invalid user status value |
| 6003 | `InvalidMeterStatus` | Invalid meter status or not active |
| 6004 | `UserNotFound` | User account doesn't exist |
| 6005 | `MeterNotFound` | Meter account doesn't exist |
| 6006 | `NoUnsettledBalance` | No energy to settle |
| 6007 | `OracleNotConfigured` | Oracle authority not set |
| 6008 | `UnauthorizedOracle` | Signer ≠ configured oracle |
| 6009 | `StaleReading` | Timestamp ≤ last reading |
| 6010 | `ReadingTooHigh` | Exceeds 1 GWh delta limit |
| 6011 | `AlreadyInactive` | Meter already deactivated |

---

**Document Version**: 2.0.0  
**Last Updated**: November 2025
