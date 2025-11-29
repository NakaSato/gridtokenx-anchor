```markdown
# Oracle Program Instructions

## Program ID
```
HtV8jTeaCVXKZVCQQVWjXcAvmiF6id9QSLVGP5MT5osX
```

---

## initialize

Initialize the oracle program with API Gateway configuration.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `oracle_data` | `PDA (init)` | Oracle state account - seeds: `["oracle_data"]` |
| `authority` | `Signer (mut)` | Program authority and payer |
| `system_program` | `Program` | System program |

### Arguments

| Name | Type | Description |
|------|------|-------------|
| `api_gateway` | `Pubkey` | Authorized API gateway public key |

### Example

```typescript
const [oracleDataPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("oracle_data")],
  ORACLE_PROGRAM_ID
);

await program.methods
  .initialize(apiGatewayPubkey)
  .accounts({
    oracleData: oracleDataPda,
    authority: wallet.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

### Initial Configuration

| Setting | Default Value |
|---------|---------------|
| `active` | `true` |
| `total_readings` | `0` |
| `min_energy_value` | `0` |
| `max_energy_value` | `1,000,000` kWh |
| `anomaly_detection_enabled` | `true` |
| `max_reading_deviation_percent` | `50%` |
| `require_consensus` | `false` |
| `consensus_threshold` | `2` |
| `last_quality_score` | `100` |
| `average_reading_interval` | `300` seconds |

---

## submit_meter_reading

Submit validated meter reading data from AMI system. **API Gateway only.**

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `oracle_data` | `Account (mut)` | Oracle state |
| `authority` | `Signer` | Must be the authorized `api_gateway` |

### Arguments

| Name | Type | Description |
|------|------|-------------|
| `meter_id` | `String` | Meter identifier |
| `energy_produced` | `u64` | Energy produced in kWh |
| `energy_consumed` | `u64` | Energy consumed in kWh |
| `reading_timestamp` | `i64` | Unix timestamp of reading |

### Example

```typescript
await program.methods
  .submitMeterReading(
    "METER-001",
    new BN(500),     // 500 kWh produced
    new BN(300),     // 300 kWh consumed
    new BN(Math.floor(Date.now() / 1000))
  )
  .accounts({
    oracleData: oracleDataPda,
    authority: apiGatewayWallet.publicKey,
  })
  .signers([apiGatewayWallet])
  .rpc();
```

### Validation Rules

| Rule | Constraint | Error |
|------|------------|-------|
| Oracle status | Must be active | `OracleInactive` |
| Signer | Must be `api_gateway` | `UnauthorizedGateway` |
| Energy range | 0 ≤ value ≤ `max_energy_value` | `EnergyValueOutOfRange` |
| Anomaly check | ratio ≤ 10:1 (prod/cons) | `AnomalousReading` |

### Events

Emits `MeterReadingSubmitted`:
```typescript
{
  meterId: string,
  energyProduced: u64,
  energyConsumed: u64,
  timestamp: i64,
  submitter: PublicKey
}
```

---

## trigger_market_clearing

Trigger the market clearing process. **API Gateway only.**

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `oracle_data` | `Account (mut)` | Oracle state |
| `authority` | `Signer` | Must be the authorized `api_gateway` |

### Example

```typescript
await program.methods
  .triggerMarketClearing()
  .accounts({
    oracleData: oracleDataPda,
    authority: apiGatewayWallet.publicKey,
  })
  .signers([apiGatewayWallet])
  .rpc();
```

### Events

Emits `MarketClearingTriggered`:
```typescript
{
  authority: PublicKey,
  timestamp: i64
}
```

---

## update_oracle_status

Activate or deactivate the oracle. **Admin only.**

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `oracle_data` | `Account (mut)` | Oracle state (has_one = authority) |
| `authority` | `Signer` | Program authority |

### Arguments

| Name | Type | Description |
|------|------|-------------|
| `active` | `bool` | New oracle status |

### Example

```typescript
// Deactivate oracle
await program.methods
  .updateOracleStatus(false)
  .accounts({
    oracleData: oracleDataPda,
    authority: adminWallet.publicKey,
  })
  .rpc();

// Reactivate oracle
await program.methods
  .updateOracleStatus(true)
  .accounts({
    oracleData: oracleDataPda,
    authority: adminWallet.publicKey,
  })
  .rpc();
```

### Events

Emits `OracleStatusUpdated`:
```typescript
{
  authority: PublicKey,
  active: boolean,
  timestamp: i64
}
```

---

## update_api_gateway

Update the authorized API Gateway address. **Admin only.**

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `oracle_data` | `Account (mut)` | Oracle state (has_one = authority) |
| `authority` | `Signer` | Program authority |

### Arguments

| Name | Type | Description |
|------|------|-------------|
| `new_api_gateway` | `Pubkey` | New gateway address |

### Example

```typescript
await program.methods
  .updateApiGateway(newApiGatewayPubkey)
  .accounts({
    oracleData: oracleDataPda,
    authority: adminWallet.publicKey,
  })
  .rpc();
```

### Events

Emits `ApiGatewayUpdated`:
```typescript
{
  authority: PublicKey,
  oldGateway: PublicKey,
  newGateway: PublicKey,
  timestamp: i64
}
```

---

## update_validation_config

Update the validation configuration. **Admin only.**

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `oracle_data` | `Account (mut)` | Oracle state (has_one = authority) |
| `authority` | `Signer` | Program authority |

### Arguments

| Name | Type | Description |
|------|------|-------------|
| `config` | `ValidationConfig` | New validation configuration |

### ValidationConfig Structure

```typescript
interface ValidationConfig {
  minEnergyValue: BN;              // Minimum valid reading
  maxEnergyValue: BN;              // Maximum valid reading
  anomalyDetectionEnabled: boolean; // Enable anomaly checks
  maxReadingDeviationPercent: number; // Max % deviation (u16)
  requireConsensus: boolean;       // Require multi-oracle consensus
}
```

### Example

```typescript
await program.methods
  .updateValidationConfig({
    minEnergyValue: new BN(0),
    maxEnergyValue: new BN(2000000), // Increase max to 2M kWh
    anomalyDetectionEnabled: true,
    maxReadingDeviationPercent: 75,  // Allow 75% deviation
    requireConsensus: false,
  })
  .accounts({
    oracleData: oracleDataPda,
    authority: adminWallet.publicKey,
  })
  .rpc();
```

### Events

Emits `ValidationConfigUpdated`:
```typescript
{
  authority: PublicKey,
  timestamp: i64
}
```

---

## add_backup_oracle

Add a backup oracle address for redundancy. **Admin only.**

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `oracle_data` | `Account (mut)` | Oracle state (has_one = authority) |
| `authority` | `Signer` | Program authority |

### Arguments

| Name | Type | Description |
|------|------|-------------|
| `backup_oracle` | `Pubkey` | Backup oracle public key |

### Constraints

- Maximum 10 backup oracles allowed
- Exceeding limit returns `MaxBackupOraclesReached` error

### Example

```typescript
await program.methods
  .addBackupOracle(backupOraclePubkey)
  .accounts({
    oracleData: oracleDataPda,
    authority: adminWallet.publicKey,
  })
  .rpc();
```

### Events

Emits `BackupOracleAdded`:
```typescript
{
  authority: PublicKey,
  backupOracle: PublicKey,
  timestamp: i64
}
```

---

## Account Structures

### OracleData

```rust
pub struct OracleData {
    pub authority: Pubkey,
    pub api_gateway: Pubkey,
    pub total_readings: u64,
    pub last_reading_timestamp: i64,
    pub last_clearing: i64,
    pub active: bool,
    pub created_at: i64,
    pub validation_config: ValidationConfig,
    pub quality_metrics: QualityMetrics,
    pub backup_oracles: Vec<Pubkey>,    // Max 10
    pub consensus_threshold: u8,
    pub last_consensus_timestamp: i64,
}
```

### QualityMetrics

```rust
pub struct QualityMetrics {
    pub total_valid_readings: u64,
    pub total_rejected_readings: u64,
    pub average_reading_interval: u32,  // Seconds
    pub last_quality_score: u8,         // 0-100
    pub quality_score_updated_at: i64,
}
```

---

## Error Codes

| Code | Name | Description |
|------|------|-------------|
| 6000 | `UnauthorizedAuthority` | Caller is not the authority |
| 6001 | `UnauthorizedGateway` | Caller is not the API gateway |
| 6002 | `OracleInactive` | Oracle is not active |
| 6003 | `InvalidMeterReading` | Reading failed validation |
| 6004 | `MarketClearingInProgress` | Market clearing already in progress |
| 6005 | `EnergyValueOutOfRange` | Value outside configured range |
| 6006 | `AnomalousReading` | Anomaly detected in reading |
| 6007 | `MaxBackupOraclesReached` | Cannot add more backup oracles |

---

## PDA Derivation

### Oracle Data PDA

```typescript
const [oracleDataPda, bump] = PublicKey.findProgramAddressSync(
  [Buffer.from("oracle_data")],
  ORACLE_PROGRAM_ID
);
```

---

**Document Version**: 1.0

```