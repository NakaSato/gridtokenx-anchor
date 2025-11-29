# Oracle Program - Technical Reference

> **Implementation reference for the Oracle Program**

Program ID: `DvdtU4quEbuxUY2FckmvcXwTpC9qp4HLJKb1PMLaqAoE`

Source: [`programs/oracle/src/lib.rs`](../../../programs/oracle/src/lib.rs)

---

## Instructions

### `initialize_oracle`

Creates the oracle configuration account.

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `oracle_data` | PDA (mut) | Oracle state account |
| `authority` | Signer | Initial authority |
| `system_program` | Program | System program |

**Arguments:**
| Name | Type | Description |
|------|------|-------------|
| `api_gateway` | Pubkey | Authorized gateway address |

**PDA Seeds:** `["oracle_data"]`

---

### `set_api_gateway`

Updates the authorized API gateway.

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `oracle_data` | PDA (mut) | Oracle state |
| `authority` | Signer | Oracle authority |

**Arguments:**
| Name | Type | Description |
|------|------|-------------|
| `new_gateway` | Pubkey | New gateway address |

---

### `submit_meter_reading`

Submits validated meter reading data.

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `oracle_data` | PDA (mut) | Oracle state |
| `api_gateway` | Signer | Authorized gateway |

**Arguments:**
| Name | Type | Description |
|------|------|-------------|
| `meter_id` | String | Target meter |
| `generation` | u64 | Generation value (kWh) |
| `consumption` | u64 | Consumption value (kWh) |
| `timestamp` | i64 | Reading timestamp |

---

### `add_backup_oracle`

Adds a backup oracle address.

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `oracle_data` | PDA (mut) | Oracle state |
| `authority` | Signer | Oracle authority |

**Arguments:**
| Name | Type | Description |
|------|------|-------------|
| `backup_oracle` | Pubkey | Backup oracle address |

---

### `pause_oracle` / `resume_oracle`

Pauses or resumes oracle operations.

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `oracle_data` | PDA (mut) | Oracle state |
| `authority` | Signer | Oracle authority |

---

## Account Structures

### OracleData

```rust
#[account]
pub struct OracleData {
    pub authority: Pubkey,
    pub api_gateway: Pubkey,
    pub backup_oracles: Vec<Pubkey>,
    pub is_active: bool,
    pub total_readings: u64,
    pub valid_readings: u64,
    pub rejected_readings: u64,
    pub last_reading_at: i64,
    pub quality_score: u8,
    pub created_at: i64,
    pub bump: u8,
}
```

---

## Events

```rust
#[event]
pub struct OracleInitialized {
    pub authority: Pubkey,
    pub api_gateway: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct MeterReadingReceived {
    pub meter_id: String,
    pub generation: u64,
    pub consumption: u64,
    pub quality_score: u8,
    pub timestamp: i64,
}

#[event]
pub struct ValidationFailed {
    pub meter_id: String,
    pub reason: String,
    pub timestamp: i64,
}

#[event]
pub struct GatewayUpdated {
    pub old_gateway: Pubkey,
    pub new_gateway: Pubkey,
    pub timestamp: i64,
}
```

---

## Errors

```rust
#[error_code]
pub enum OracleError {
    #[msg("Unauthorized gateway")]
    UnauthorizedGateway,
    #[msg("Oracle is paused")]
    OraclePaused,
    #[msg("Invalid timestamp")]
    InvalidTimestamp,
    #[msg("Duplicate reading")]
    DuplicateReading,
    #[msg("Invalid meter data")]
    InvalidMeterData,
    #[msg("Rate limit exceeded")]
    RateLimitExceeded,
    #[msg("Backup oracles at capacity")]
    BackupOraclesFull,
}
```

---

*For academic documentation, see [Academic Oracle Documentation](../../academic/programs/oracle.md)*
