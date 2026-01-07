# Oracle Program

**Program ID:** `5z6Qaf6UUv42uCqbxQLfKz7cSXhMABsq73mRMwvHKzFA`

The Oracle program is the bridge between off-chain Advanced Metering Infrastructure (AMI) and the on-chain ledger. It ingests data via an authorized API Gateway and ensures data integrity.

## Account Structures

### OracleData
Stores oracle configuration and aggregate metrics. This account uses `#[account(zero_copy)]` and `#[repr(C)]` for maximum efficiency and direct memory access, minimizing Compute Unit (CU) usage during serialization/deserialization.

**PDA**: `["oracle_data"]`.

```rust
#[account(zero_copy)]
#[repr(C)]
pub struct OracleData {
    // === 32-byte aligned fields (Pubkeys) ===
    pub authority: Pubkey,                      // 32 bytes
    pub api_gateway: Pubkey,                    // 32 bytes
    pub backup_oracles: [Pubkey; 10],           // 320 bytes
    
    // === 8-byte aligned fields (u64, i64) ===
    pub total_readings: u64,                    // 8 bytes
    pub last_reading_timestamp: i64,            // 8 bytes
    pub last_clearing: i64,                     // 8 bytes
    pub created_at: i64,                        // 8 bytes
    pub min_energy_value: u64,                  // 8 bytes
    pub max_energy_value: u64,                  // 8 bytes (Validation Bound)
    pub total_valid_readings: u64,              // 8 bytes
    pub total_rejected_readings: u64,           // 8 bytes
    pub quality_score_updated_at: i64,          // 8 bytes
    pub last_consensus_timestamp: i64,          // 8 bytes
    
    // === 4-byte aligned field ===
    pub average_reading_interval: u32,          // 4 bytes
    
    // === 2-byte aligned field ===
    pub max_reading_deviation_percent: u16,     // 2 bytes
    
    // === 1-byte fields ===
    pub active: u8,                             // 1 byte (Bool)
    pub anomaly_detection_enabled: u8,          // 1 byte (Bool)  
    pub require_consensus: u8,                  // 1 byte (Bool)
    pub last_quality_score: u8,                 // 1 byte (0-100)
    pub backup_oracles_count: u8,               // 1 byte
    pub consensus_threshold: u8,                // 1 byte
    
    // Explicit padding to reach 8-byte alignment
    pub _padding: [u8; 4],                      // 4 bytes
}
```

## Validation Logic

The oracle performs on-chain validation of incoming meter readings:

1.  **Range Check**:
    $$ Min \le E_{produced} \le Max $$
2.  **Anomaly Detection** (if enabled):
    Checks if `energy_produced` or `energy_consumed` deviates by more than `max_reading_deviation_percent` from expected norms (historical average or previous reading).
3.  **Active Status**:
    Requires `oracle_data.active == 1`.

## Instructions

### `initialize`
Initializes the oracle state and sets the `api_gateway`.

### `submit_meter_reading`
Ingests a single reading from a smart meter.
- **Auth**: Only callable by `api_gateway`.
- **Params**: `meter_id`, `energy_produced`, `energy_consumed`, `reading_timestamp`.
- **Metrics**: Updates `total_readings`, `total_valid_readings`, `quality_score`.
- **Events**: Emits `MeterReadingSubmitted`.

### `trigger_market_clearing`
A signal instruction used by the API Gateway to indicate that a market period has closed and clearing should occur.
- **Auth**: Only callable by `api_gateway`.
- **Update**: Sets `last_clearing` timestamp.
