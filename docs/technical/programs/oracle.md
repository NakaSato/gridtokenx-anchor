```markdown
# Oracle Program - Technical Reference

> **Implementation reference for the Oracle Program**

Program ID: `HtV8jTeaCVXKZVCQQVWjXcAvmiF6id9QSLVGP5MT5osX`

Source: [`programs/oracle/src/lib.rs`](../../../programs/oracle/src/lib.rs)

---

## Overview

The Oracle Program serves as the AMI (Advanced Metering Infrastructure) data bridge for the GridTokenX P2P energy trading platform. It receives smart meter readings through an authorized API Gateway, validates data integrity using configurable validation rules, maintains quality metrics, and supports backup oracle redundancy.

---

## Instructions

### `initialize`

Creates the oracle configuration account with initial settings.

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `oracle_data` | PDA (init, mut) | Oracle state account |
| `authority` | Signer (mut) | Initial authority and payer |
| `system_program` | Program | System program |

**Arguments:**
| Name | Type | Description |
|------|------|-------------|
| `api_gateway` | Pubkey | Authorized API gateway address |

**PDA Seeds:** `["oracle_data"]`

**Initial State:**
- `active` = true
- `total_readings` = 0
- `validation_config` = default (0-1M kWh range, anomaly detection enabled)
- `quality_metrics` = initialized (100% quality score)
- `backup_oracles` = empty vector
- `consensus_threshold` = 2

---

### `submit_meter_reading`

Submits validated meter reading data from AMI system. **Only callable by API Gateway.**

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `oracle_data` | Account (mut) | Oracle state |
| `authority` | Signer | Must be `api_gateway` address |

**Arguments:**
| Name | Type | Description |
|------|------|-------------|
| `meter_id` | String | Target meter identifier |
| `energy_produced` | u64 | Energy produced (kWh) |
| `energy_consumed` | u64 | Energy consumed (kWh) |
| `reading_timestamp` | i64 | Reading timestamp |

**Validation:**
- Oracle must be active
- Signer must match `oracle_data.api_gateway`
- Energy values must be within configured range (0 to `max_energy_value`)
- Anomaly detection: production/consumption ratio ≤ 10:1

**Events Emitted:** `MeterReadingSubmitted`

**Output:** Base64-encoded meter data logged for external systems

---

### `trigger_market_clearing`

Triggers the market clearing process. **Only callable by API Gateway.**

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `oracle_data` | Account (mut) | Oracle state |
| `authority` | Signer | Must be `api_gateway` address |

**State Changes:**
- Updates `last_clearing` to current timestamp

**Events Emitted:** `MarketClearingTriggered`

---

### `update_oracle_status`

Activates or deactivates the oracle. **Admin only.**

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `oracle_data` | Account (mut) | Oracle state (has_one = authority) |
| `authority` | Signer | Must match `oracle_data.authority` |

**Arguments:**
| Name | Type | Description |
|------|------|-------------|
| `active` | bool | New oracle status |

**Events Emitted:** `OracleStatusUpdated`

---

### `update_api_gateway`

Updates the authorized API Gateway address. **Admin only.**

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `oracle_data` | Account (mut) | Oracle state (has_one = authority) |
| `authority` | Signer | Must match `oracle_data.authority` |

**Arguments:**
| Name | Type | Description |
|------|------|-------------|
| `new_api_gateway` | Pubkey | New gateway address |

**Events Emitted:** `ApiGatewayUpdated`

---

### `update_validation_config`

Updates the validation configuration. **Admin only.**

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `oracle_data` | Account (mut) | Oracle state (has_one = authority) |
| `authority` | Signer | Must match `oracle_data.authority` |

**Arguments:**
| Name | Type | Description |
|------|------|-------------|
| `config` | ValidationConfig | New validation configuration |

**Events Emitted:** `ValidationConfigUpdated`

---

### `add_backup_oracle`

Adds a backup oracle address for redundancy. **Admin only.**

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `oracle_data` | Account (mut) | Oracle state (has_one = authority) |
| `authority` | Signer | Must match `oracle_data.authority` |

**Arguments:**
| Name | Type | Description |
|------|------|-------------|
| `backup_oracle` | Pubkey | Backup oracle address |

**Constraints:**
- Maximum 10 backup oracles allowed

**Events Emitted:** `BackupOracleAdded`

---

## Account Structures

### OracleData

Main oracle configuration and metrics account.

```rust
#[account]
pub struct OracleData {
    pub authority: Pubkey,              // Admin authority
    pub api_gateway: Pubkey,            // Authorized data submitter
    pub total_readings: u64,            // Total readings processed
    pub last_reading_timestamp: i64,    // Most recent reading time
    pub last_clearing: i64,             // Last market clearing time
    pub active: bool,                   // Oracle operational status
    pub created_at: i64,                // Initialization timestamp
    
    // Data Validation & Quality
    pub validation_config: ValidationConfig,
    pub quality_metrics: QualityMetrics,
    
    // Redundancy & Consensus
    pub backup_oracles: Vec<Pubkey>,    // Up to 10 backup oracles
    pub consensus_threshold: u8,        // Min oracles for consensus
    pub last_consensus_timestamp: i64,
}
```

**PDA Derivation:** Seeds = `["oracle_data"]`

---

### ValidationConfig

Configurable validation parameters.

```rust
#[account]
pub struct ValidationConfig {
    pub min_energy_value: u64,              // Minimum valid energy (default: 0)
    pub max_energy_value: u64,              // Maximum valid energy (default: 1,000,000 kWh)
    pub anomaly_detection_enabled: bool,    // Enable anomaly checks (default: true)
    pub max_reading_deviation_percent: u16, // Max deviation from average (default: 50%)
    pub require_consensus: bool,            // Require multi-oracle consensus (default: false)
}
```

---

### QualityMetrics

Running quality statistics.

```rust
#[account]
pub struct QualityMetrics {
    pub total_valid_readings: u64,      // Readings passing validation
    pub total_rejected_readings: u64,   // Readings failing validation
    pub average_reading_interval: u32,  // Avg seconds between readings (default: 300)
    pub last_quality_score: u8,         // 0-100 quality score
    pub quality_score_updated_at: i64,  // Last score update time
}
```

**Quality Score Calculation:**
```
quality_score = (total_valid_readings / (total_valid_readings + total_rejected_readings)) × 100
```

---

### HistoricalReading (Defined, not stored)

Structure for trend analysis.

```rust
pub struct HistoricalReading {
    pub energy_produced: u64,
    pub energy_consumed: u64,
    pub timestamp: i64,
    pub quality_score: u8,
}
```

---

## Events

```rust
#[event]
pub struct MeterReadingSubmitted {
    pub meter_id: String,
    pub energy_produced: u64,
    pub energy_consumed: u64,
    pub timestamp: i64,
    pub submitter: Pubkey,
}

#[event]
pub struct MarketClearingTriggered {
    pub authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct OracleStatusUpdated {
    pub authority: Pubkey,
    pub active: bool,
    pub timestamp: i64,
}

#[event]
pub struct ApiGatewayUpdated {
    pub authority: Pubkey,
    pub old_gateway: Pubkey,
    pub new_gateway: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct ValidationConfigUpdated {
    pub authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct BackupOracleAdded {
    pub authority: Pubkey,
    pub backup_oracle: Pubkey,
    pub timestamp: i64,
}
```

---

## Errors

```rust
#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized authority")]
    UnauthorizedAuthority,          // 6000
    #[msg("Unauthorized API Gateway")]
    UnauthorizedGateway,            // 6001
    #[msg("Oracle is inactive")]
    OracleInactive,                 // 6002
    #[msg("Invalid meter reading")]
    InvalidMeterReading,            // 6003
    #[msg("Market clearing in progress")]
    MarketClearingInProgress,       // 6004
    #[msg("Energy value out of range")]
    EnergyValueOutOfRange,          // 6005
    #[msg("Anomalous reading detected")]
    AnomalousReading,               // 6006
    #[msg("Maximum backup oracles reached")]
    MaxBackupOraclesReached,        // 6007
}
```

---

## Validation Logic

### Range Validation

```rust
fn validate_meter_reading(
    energy_produced: u64,
    energy_consumed: u64,
    config: &ValidationConfig,
) -> Result<()> {
    // Range check
    require!(
        energy_produced >= config.min_energy_value 
            && energy_produced <= config.max_energy_value,
        ErrorCode::EnergyValueOutOfRange
    );
    require!(
        energy_consumed >= config.min_energy_value 
            && energy_consumed <= config.max_energy_value,
        ErrorCode::EnergyValueOutOfRange
    );
    
    // Anomaly detection - ratio check
    if config.anomaly_detection_enabled && energy_consumed > 0 {
        let ratio = (energy_produced as f64 / energy_consumed as f64) * 100.0;
        require!(ratio <= 1000.0, ErrorCode::AnomalousReading); // Max 10:1 ratio
    }
    
    Ok(())
}
```

---

*For academic documentation, see [Academic Oracle Documentation](../../academic/programs/oracle.md)*

```
