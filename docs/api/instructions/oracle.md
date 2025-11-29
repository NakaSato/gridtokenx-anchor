# Oracle Program Instructions

## Program ID
```
DvdtU4quEbuxUY2FckmvcXwTpC9qp4HLJKb1PMLaqAoE
```

---

## initialize

Initialize the oracle program state.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `authority` | `Signer` | Program authority |
| `oracle_state` | `PDA` | Oracle state account |
| `system_program` | `Program` | System program |

### Arguments

| Name | Type | Description |
|------|------|-------------|
| `initial_price` | `u64` | Initial GRX price (9 decimals) |

### Example

```typescript
await program.methods
  .initialize(new BN(3_000_000_000)) // 3 GRX/kWh
  .accounts({
    authority: wallet.publicKey,
    oracleState: oraclePda,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

---

## update_price_feed

Update the GRX price feed.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `oracle` | `Signer` | Authorized oracle operator |
| `oracle_state` | `PDA` | Oracle state |
| `price_feed` | `PDA` | Price feed account |

### Arguments

| Name | Type | Description |
|------|------|-------------|
| `price` | `u64` | New price (9 decimals) |
| `confidence` | `u8` | Confidence level (0-100) |
| `source` | `String` | Data source identifier |

### PDA Seeds

```
["price_feed"]
```

### Example

```typescript
await program.methods
  .updatePriceFeed(
    new BN(3_500_000_000), // 3.5 GRX/kWh
    95,                     // 95% confidence
    'MEA_TARIFF'           // Source
  )
  .accounts({
    oracle: oracleWallet.publicKey,
    oracleState: oracleStatePda,
    priceFeed: priceFeedPda,
  })
  .rpc();
```

### Validation

- Price must be > 0
- Confidence must be 0-100
- Oracle must be authorized

### Errors

| Code | Description |
|------|-------------|
| `Unauthorized` | Oracle not authorized |
| `InvalidPrice` | Price is zero or negative |
| `InvalidConfidence` | Confidence out of range |

---

## validate_meter_reading

Validate a meter reading from the registry.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `oracle` | `Signer` | Authorized oracle |
| `oracle_state` | `PDA` | Oracle state |
| `meter_account` | `PDA` | Meter to validate |
| `validation_result` | `PDA` | Validation result account |
| `system_program` | `Program` | System program |

### Arguments

| Name | Type | Description |
|------|------|-------------|
| `reading` | `u64` | Meter reading to validate |
| `timestamp` | `i64` | Reading timestamp |
| `signature` | `Option<[u8; 64]>` | Optional cryptographic signature |

### PDA Seeds

```
["validation", meter_pubkey, timestamp]
```

### Example

```typescript
const timestamp = Math.floor(Date.now() / 1000);
const [validationPda] = PublicKey.findProgramAddressSync(
  [
    Buffer.from('validation'),
    meterPda.toBuffer(),
    new BN(timestamp).toArrayLike(Buffer, 'le', 8),
  ],
  ORACLE_PROGRAM_ID
);

await program.methods
  .validateMeterReading(
    new BN(15_500_000_000),
    new BN(timestamp),
    null // No signature
  )
  .accounts({
    oracle: oracleWallet.publicKey,
    oracleState: oracleStatePda,
    meterAccount: meterPda,
    validationResult: validationPda,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

### Validation Checks

1. **Threshold Check**: Reading ≤ max daily capacity
2. **Regression Check**: Reading ≥ previous reading
3. **Rate Check**: kWh/hour within acceptable range
4. **Anomaly Detection**: Statistical analysis

### Errors

| Code | Description |
|------|-------------|
| `InvalidMeter` | Meter not found |
| `MeterNotActive` | Meter is inactive |
| `InvalidReading` | Reading failed validation |
| `ReadingTooHigh` | Exceeds threshold |
| `ReadingDecreased` | Cannot go backwards |
| `AnomalyDetected` | Statistical anomaly |
| `SignatureInvalid` | Bad cryptographic signature |

---

## add_authorized_oracle

Add an authorized oracle operator.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `authority` | `Signer` | Program authority |
| `oracle_state` | `PDA` | Oracle state |

### Arguments

| Name | Type | Description |
|------|------|-------------|
| `oracle` | `Pubkey` | Oracle to authorize |
| `name` | `String` | Oracle identifier |

### Example

```typescript
await program.methods
  .addAuthorizedOracle(newOraclePubkey, 'Oracle-MEA')
  .accounts({
    authority: adminWallet.publicKey,
    oracleState: oracleStatePda,
  })
  .rpc();
```

### Errors

| Code | Description |
|------|-------------|
| `Unauthorized` | Caller not authority |
| `OracleAlreadyAuthorized` | Already authorized |
| `MaxOraclesReached` | Too many oracles |

---

## remove_authorized_oracle

Remove an authorized oracle operator.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `authority` | `Signer` | Program authority |
| `oracle_state` | `PDA` | Oracle state |

### Arguments

| Name | Type | Description |
|------|------|-------------|
| `oracle` | `Pubkey` | Oracle to remove |

### Example

```typescript
await program.methods
  .removeAuthorizedOracle(oraclePubkey)
  .accounts({
    authority: adminWallet.publicKey,
    oracleState: oracleStatePda,
  })
  .rpc();
```

---

## Account Structures

### OracleState

```rust
pub struct OracleState {
    pub authority: Pubkey,
    pub price_feed: PriceFeed,
    pub authorized_oracles: Vec<AuthorizedOracle>,
    pub min_confidence: u8,
    pub max_staleness: i64,      // Max age in seconds
    pub validation_count: u64,
    pub initialized_at: i64,
    pub last_update: i64,
}
```

### PriceFeed

```rust
pub struct PriceFeed {
    pub value: u64,             // 9 decimals
    pub confidence: u8,
    pub source: String,
    pub timestamp: i64,
    pub exponent: i8,           // -9
}
```

### AuthorizedOracle

```rust
pub struct AuthorizedOracle {
    pub pubkey: Pubkey,
    pub name: String,
    pub added_at: i64,
    pub updates_count: u64,
}
```

### ValidationResult

```rust
pub struct ValidationResult {
    pub meter: Pubkey,
    pub reading: u64,
    pub previous_reading: u64,
    pub is_valid: bool,
    pub anomaly_score: u8,      // 0-100
    pub validated_by: Pubkey,
    pub timestamp: i64,
}
```

---

## Events

### PriceFeedUpdated

```rust
#[event]
pub struct PriceFeedUpdated {
    pub price: u64,
    pub confidence: u8,
    pub source: String,
    pub updated_by: Pubkey,
    pub timestamp: i64,
}
```

### MeterValidated

```rust
#[event]
pub struct MeterValidated {
    pub meter: Pubkey,
    pub reading: u64,
    pub is_valid: bool,
    pub anomaly_score: u8,
    pub validated_by: Pubkey,
    pub timestamp: i64,
}
```

### OracleAuthorized

```rust
#[event]
pub struct OracleAuthorized {
    pub oracle: Pubkey,
    pub name: String,
    pub authorized_by: Pubkey,
    pub timestamp: i64,
}
```

---

## Anomaly Detection Algorithm

```rust
pub fn calculate_anomaly_score(
    current: u64,
    previous: u64,
    capacity: u32,
    time_delta: i64,
) -> u8 {
    // Calculate production rate (kWh/hour)
    let delta = current - previous;
    let hours = time_delta as f64 / 3600.0;
    let rate = delta as f64 / hours;
    
    // Compare against max theoretical production
    let max_rate = capacity as f64 * 1.0; // 100% capacity
    
    // Score based on deviation
    if rate > max_rate * 1.5 {
        100 // Definite anomaly
    } else if rate > max_rate * 1.2 {
        75  // Likely anomaly
    } else if rate > max_rate {
        50  // Possible anomaly
    } else {
        0   // Normal
    }
}
```

---

**Document Version**: 1.0
