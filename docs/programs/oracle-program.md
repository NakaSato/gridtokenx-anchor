````markdown
# Oracle Program - Technical Specification v1.0

> GridTokenX AMI Data Bridge for P2P Energy Trading - API Gateway Authorization Model

## Overview

The Oracle Program serves as the critical bridge between the physical energy grid's Advanced Metering Infrastructure (AMI) and the GridTokenX blockchain platform. It implements a centralized API Gateway authorization model for low-latency data ingestion, configurable multi-stage data validation, quality metrics tracking, and backup oracle redundancy for high availability.

**Program ID:** `HtV8jTeaCVXKZVCQQVWjXcAvmiF6id9QSLVGP5MT5osX`

---

## Architecture

### System Design

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          ORACLE PROGRAM ARCHITECTURE                          │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│   EXTERNAL SYSTEMS                          ON-CHAIN                          │
│   ════════════════                          ════════                          │
│                                                                               │
│   ┌─────────────────┐                                                         │
│   │   Smart Meters  │                                                         │
│   │     (AMI)       │                                                         │
│   │  • Production   │                                                         │
│   │  • Consumption  │                                                         │
│   └────────┬────────┘                                                         │
│            │ MQTT/REST                                                        │
│            ▼                                                                  │
│   ┌─────────────────┐      Solana TX      ┌─────────────────────────────────┐│
│   │   API Gateway   │─────────────────────▶│         Oracle Program         ││
│   │   (Off-chain)   │                      │                                 ││
│   │                 │                      │  ┌─────────────────────────┐   ││
│   │ • Pre-validate  │                      │  │      OracleData PDA     │   ││
│   │ • Batch         │                      │  │                         │   ││
│   │ • Sign & Submit │                      │  │ • authority             │   ││
│   └─────────────────┘                      │  │ • api_gateway           │   ││
│                                            │  │ • validation_config     │   ││
│                                            │  │ • quality_metrics       │   ││
│   ┌─────────────────┐                      │  │ • backup_oracles        │   ││
│   │ Backup Oracles  │                      │  └─────────────────────────┘   ││
│   │   (Up to 10)    │                      │                                 ││
│   │                 │◀─────────────────────│  Seeds: ["oracle_data"]        ││
│   │ • Failover      │   Redundancy         │                                 ││
│   │ • Consensus     │                      └─────────────────────────────────┘│
│   └─────────────────┘                                                         │
│                                                                               │
│   ─────────────────────────────────────────────────────────────────────────── │
│                                                                               │
│   DOWNSTREAM CONSUMERS (via Events)                                           │
│   ═════════════════════════════════                                           │
│                                                                               │
│   ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐            │
│   │    Registry     │   │    Trading      │   │  Energy Token   │            │
│   │    Program      │   │    Program      │   │    Program      │            │
│   │                 │   │                 │   │                 │            │
│   │ MeterReading    │   │ MarketClearing  │   │ Mint trigger    │            │
│   │ Submitted       │   │ Triggered       │   │ from readings   │            │
│   └─────────────────┘   └─────────────────┘   └─────────────────┘            │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Core Components

| Component | Purpose | Key Features |
|-----------|---------|--------------|
| **OracleData** | Singleton configuration PDA | authority, api_gateway, validation, metrics, backups |
| **ValidationConfig** | Data validation parameters | range limits, anomaly detection, consensus settings |
| **QualityMetrics** | Running quality statistics | success rate, quality score, reading intervals |
| **Backup Oracles** | Redundancy mechanism | up to 10 backup addresses for failover |

---

## Program Metadata

| Property | Value |
|----------|-------|
| **Program ID** | `HtV8jTeaCVXKZVCQQVWjXcAvmiF6id9QSLVGP5MT5osX` |
| **Framework** | Anchor v0.32.1 |
| **Language** | Rust |
| **Network** | Solana (Private Network) |
| **Version** | 0.1.0 |
| **Description** | Oracle program for P2P Energy Trading - AMI data bridge |
| **Instructions** | 7 |
| **Accounts** | 1 (OracleData PDA) |
| **Events** | 6 |
| **Errors** | 8 |
| **Dependencies** | anchor-lang, anchor-spl, base64 |

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Theoretical Foundation](#theoretical-foundation)
4. [Account Structures](#account-structures)
5. [Instructions](#instructions)
6. [Data Validation Pipeline](#data-validation-pipeline)
7. [Quality Metrics System](#quality-metrics-system)
8. [Redundancy & Consensus](#redundancy--consensus)
9. [Events](#events)
10. [Error Handling](#error-handling)
11. [Security Model](#security-model)
12. [Cross-Program Integration](#cross-program-integration)
13. [Performance Characteristics](#performance-characteristics)

---

## Theoretical Foundation

### The Oracle Problem in Energy Markets

Blockchain systems require external data to make informed decisions, creating the "oracle problem"—how to trustworthily bring off-chain data on-chain. For P2P energy trading, this challenge is particularly acute:

| Challenge | Description | Impact |
|-----------|-------------|--------|
| **High frequency** | Meters report every 1-15 minutes | Data volume and latency requirements |
| **Financial coupling** | Data determines token minting | Economic incentives for manipulation |
| **Physical backing** | Data represents real energy flows | Must reflect physical reality |
| **Regulatory compliance** | Energy data must be auditable | Legal and compliance requirements |

### Design Decision: API Gateway Model

The GridTokenX Oracle implements a **centralized API Gateway model** with provisions for future decentralization:

| Approach | Latency | Trust Model | Cost | Implementation |
|----------|---------|-------------|------|----------------|
| Centralized Gateway | ~10ms | Single entity | Low | ✓ **Primary** |
| Backup Oracles | ~50ms | N-of-M failover | Medium | ✓ **Implemented** |
| Decentralized Consensus | ~500ms | Byzantine fault tolerant | High | ◐ **Planned** |

**Why Centralized Gateway?**

1. **Operational simplicity**: Single authorized gateway minimizes key management complexity
2. **Low latency**: Critical for real-time energy market operations
3. **Clear accountability**: Single point of contact for data quality issues
4. **Cost efficiency**: No multi-signature overhead for each reading
5. **Upgrade path**: `backup_oracles` and `require_consensus` fields enable seamless transition to decentralization

### Data Flow Model

```
Smart Meter → AMI Collector → API Gateway → Oracle Program → On-chain Events
                                   ↓
                           Validation Pipeline
                           ┌─────────────────┐
                           │ 1. Auth Check   │
                           │ 2. Range Check  │
                           │ 3. Anomaly Check│
                           │ 4. Quality Update│
                           └─────────────────┘
```

---

## Account Structures

### OracleData Account (Singleton PDA)

The main configuration and state account for the oracle.

| Field | Type | Size | Description |
|-------|------|------|-------------|
| `authority` | Pubkey | 32 bytes | Administrative authority for configuration |
| `api_gateway` | Pubkey | 32 bytes | Only address authorized to submit data |
| `total_readings` | u64 | 8 bytes | Total meter readings processed |
| `last_reading_timestamp` | i64 | 8 bytes | Timestamp of most recent reading |
| `last_clearing` | i64 | 8 bytes | Last market clearing timestamp |
| `active` | bool | 1 byte | Oracle operational status |
| `created_at` | i64 | 8 bytes | Initialization timestamp |
| `validation_config` | ValidationConfig | ~22 bytes | Validation parameters |
| `quality_metrics` | QualityMetrics | ~29 bytes | Quality tracking |
| `backup_oracles` | Vec<Pubkey> | 4 + (32 × n) bytes | Up to 10 backup addresses |
| `consensus_threshold` | u8 | 1 byte | Min oracles for consensus |
| `last_consensus_timestamp` | i64 | 8 bytes | Last consensus timestamp |

**PDA Seeds:** `[b"oracle_data"]`

**Rust Definition:**
```rust
#[account]
#[derive(InitSpace)]
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
    #[max_len(10)]
    pub backup_oracles: Vec<Pubkey>,
    pub consensus_threshold: u8,
    pub last_consensus_timestamp: i64,
}
```

---

### ValidationConfig

Configurable parameters for meter reading validation.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `min_energy_value` | u64 | 0 | Minimum valid energy reading (kWh) |
| `max_energy_value` | u64 | 1,000,000 | Maximum valid energy reading (kWh) |
| `anomaly_detection_enabled` | bool | true | Enable ratio-based anomaly detection |
| `max_reading_deviation_percent` | u16 | 50 | Max % deviation from historical average |
| `require_consensus` | bool | false | Require multi-oracle consensus |

**Rust Definition:**
```rust
#[account]
#[derive(InitSpace)]
pub struct ValidationConfig {
    pub min_energy_value: u64,
    pub max_energy_value: u64,
    pub anomaly_detection_enabled: bool,
    pub max_reading_deviation_percent: u16,
    pub require_consensus: bool,
}
```

---

### QualityMetrics

Running statistics for data quality monitoring and scoring.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `total_valid_readings` | u64 | 0 | Readings passing all validation |
| `total_rejected_readings` | u64 | 0 | Readings failing validation |
| `average_reading_interval` | u32 | 300 | Average seconds between readings |
| `last_quality_score` | u8 | 100 | Quality score (0-100) |
| `quality_score_updated_at` | i64 | 0 | Last score update timestamp |

**Quality Score Formula:**

$$Q = \frac{V}{V + R} \times 100$$

Where:
- $Q$ = Quality score (0-100)
- $V$ = `total_valid_readings`
- $R$ = `total_rejected_readings`

**Rust Definition:**
```rust
#[account]
#[derive(InitSpace)]
pub struct QualityMetrics {
    pub total_valid_readings: u64,
    pub total_rejected_readings: u64,
    pub average_reading_interval: u32,
    pub last_quality_score: u8,
    pub quality_score_updated_at: i64,
}
```

---

### HistoricalReading (Defined but not stored on-chain)

Structure for trend analysis and anomaly detection.

```rust
#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct HistoricalReading {
    pub energy_produced: u64,
    pub energy_consumed: u64,
    pub timestamp: i64,
    pub quality_score: u8,
}
```

---

## Instructions

### Instruction Summary (7 Total)

| # | Instruction | Type | Authority | Description |
|---|-------------|------|-----------|-------------|
| 1 | `initialize` | Write | Any | Create OracleData PDA with initial config |
| 2 | `submit_meter_reading` | Write | API Gateway | Submit validated AMI data |
| 3 | `trigger_market_clearing` | Write | API Gateway | Initiate market settlement |
| 4 | `update_oracle_status` | Write | Authority | Pause/resume oracle operations |
| 5 | `update_api_gateway` | Write | Authority | Change authorized gateway address |
| 6 | `update_validation_config` | Write | Authority | Modify validation parameters |
| 7 | `add_backup_oracle` | Write | Authority | Add redundancy (max 10) |

---

### 1. initialize

Creates the OracleData PDA with initial configuration.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `oracle_data` | PDA (init, mut) | Oracle state - seeds: `[b"oracle_data"]` |
| `authority` | Signer (mut) | Initial authority and payer |
| `system_program` | Program | System program |

**Arguments:**

| Argument | Type | Description |
|----------|------|-------------|
| `api_gateway` | Pubkey | Authorized API gateway address |

**Initial State Created:**
```
active = true
total_readings = 0
validation_config = {
    min_energy_value: 0,
    max_energy_value: 1,000,000,
    anomaly_detection_enabled: true,
    max_reading_deviation_percent: 50,
    require_consensus: false
}
quality_metrics = {
    total_valid_readings: 0,
    total_rejected_readings: 0,
    average_reading_interval: 300,
    last_quality_score: 100,
    quality_score_updated_at: <now>
}
backup_oracles = []
consensus_threshold = 2
```

**Events Emitted:** None (logs initialization message)

---

### 2. submit_meter_reading

Submits validated meter reading data from AMI system. **Only callable by API Gateway.**

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `oracle_data` | Account (mut) | Oracle state |
| `authority` | Signer | Must equal `oracle_data.api_gateway` |

**Arguments:**

| Argument | Type | Unit | Description |
|----------|------|------|-------------|
| `meter_id` | String | - | Meter identifier |
| `energy_produced` | u64 | kWh | Energy produced |
| `energy_consumed` | u64 | kWh | Energy consumed |
| `reading_timestamp` | i64 | Unix | Reading timestamp |

**Validation Pipeline:**
1. **Active Check:** `require!(oracle_data.active, OracleInactive)`
2. **Authorization:** `require!(authority == api_gateway, UnauthorizedGateway)`
3. **Range Check:** Values within `min_energy_value` to `max_energy_value`
4. **Anomaly Check:** Production/consumption ratio ≤ 10:1

**State Changes:**
- Increments `total_readings`
- Updates `last_reading_timestamp`
- Increments `quality_metrics.total_valid_readings`
- Recalculates `last_quality_score`

**Output Format (Base64):**
```
meter_id:energy_produced:energy_consumed:reading_timestamp
```
Example: `METER-001:500:300:1701234567` → `TUVURVItMDAxOjUwMDozMDA6MTcwMTIzNDU2Nw==`

**Events Emitted:** `MeterReadingSubmitted`

---

### 3. trigger_market_clearing

Triggers the market clearing process for energy settlement. **Only callable by API Gateway.**

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `oracle_data` | Account (mut) | Oracle state |
| `authority` | Signer | Must equal `oracle_data.api_gateway` |

**Validation:**
- Oracle must be active
- Signer must be api_gateway

**State Changes:**
- Updates `last_clearing` to current timestamp

**Events Emitted:** `MarketClearingTriggered`

---

### 4. update_oracle_status

Activates or deactivates the oracle. **Admin only.**

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `oracle_data` | Account (mut) | Oracle state (has_one = authority) |
| `authority` | Signer | Must equal `oracle_data.authority` |

**Arguments:**

| Argument | Type | Description |
|----------|------|-------------|
| `active` | bool | New oracle status |

**Use Cases:**
- Pause oracle during maintenance
- Emergency shutdown on detected anomalies
- Resume operations after fixes

**Events Emitted:** `OracleStatusUpdated`

---

### 5. update_api_gateway

Updates the authorized API Gateway address. **Admin only.**

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `oracle_data` | Account (mut) | Oracle state (has_one = authority) |
| `authority` | Signer | Must equal `oracle_data.authority` |

**Arguments:**

| Argument | Type | Description |
|----------|------|-------------|
| `new_api_gateway` | Pubkey | New gateway address |

**Use Cases:**
- Gateway key rotation
- Failover to backup infrastructure
- Security incident response

**Events Emitted:** `ApiGatewayUpdated`

---

### 6. update_validation_config

Updates the validation configuration parameters. **Admin only.**

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `oracle_data` | Account (mut) | Oracle state (has_one = authority) |
| `authority` | Signer | Must equal `oracle_data.authority` |

**Arguments:**

| Argument | Type | Description |
|----------|------|-------------|
| `config` | ValidationConfig | New validation configuration |

**Configurable Parameters:**
- `min_energy_value` - Lower bound for valid readings
- `max_energy_value` - Upper bound for valid readings
- `anomaly_detection_enabled` - Toggle anomaly checking
- `max_reading_deviation_percent` - Deviation threshold
- `require_consensus` - Enable multi-oracle mode

**Events Emitted:** `ValidationConfigUpdated`

---

### 7. add_backup_oracle

Adds a backup oracle address for redundancy. **Admin only.**

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `oracle_data` | Account (mut) | Oracle state (has_one = authority) |
| `authority` | Signer | Must equal `oracle_data.authority` |

**Arguments:**

| Argument | Type | Description |
|----------|------|-------------|
| `backup_oracle` | Pubkey | Backup oracle public key |

**Constraints:**
- Maximum 10 backup oracles
- Exceeding limit returns `MaxBackupOraclesReached`

**Events Emitted:** `BackupOracleAdded`

---

## Data Validation Pipeline

### Validation Stages

```
┌─────────────────┐
│  Meter Reading  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐          ┌────────────────────┐
│ Stage 1: Active │──FAIL───▶│ Error: OracleInactive│
│     Check       │          └────────────────────┘
└────────┬────────┘
         │ PASS
         ▼
┌─────────────────┐          ┌────────────────────┐
│ Stage 2: Auth   │──FAIL───▶│ Error: Unauthorized │
│     Check       │          │        Gateway      │
└────────┬────────┘          └────────────────────┘
         │ PASS
         ▼
┌─────────────────┐          ┌────────────────────┐
│ Stage 3: Range  │──FAIL───▶│ Error: EnergyValue │
│     Check       │          │    OutOfRange      │
└────────┬────────┘          └────────────────────┘
         │ PASS
         ▼
┌─────────────────┐          ┌────────────────────┐
│ Stage 4: Anomaly│──FAIL───▶│ Error: Anomalous   │
│     Check       │          │      Reading       │
└────────┬────────┘          └────────────────────┘
         │ PASS
         ▼
┌─────────────────┐
│ Update Metrics  │
│ Emit Event      │
│ Log Base64 Data │
└─────────────────┘
```

### Validation Implementation

```rust
fn validate_meter_reading(
    energy_produced: u64,
    energy_consumed: u64,
    config: &ValidationConfig,
) -> Result<()> {
    // Range validation
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
        // Allow production up to 10x consumption (solar producers)
        require!(ratio <= 1000.0, ErrorCode::AnomalousReading);
    }

    Ok(())
}
```

### Validation Parameters

| Check | Default Config | Trigger |
|-------|----------------|---------|
| Range (min) | 0 kWh | `energy < min_energy_value` |
| Range (max) | 1,000,000 kWh | `energy > max_energy_value` |
| Anomaly ratio | 10:1 max | `produced/consumed > 10` |
| Deviation | 50% | Historical comparison (future) |

---

## Quality Metrics System

### Metrics Tracked

| Metric | Calculation | Purpose |
|--------|-------------|---------|
| Total Valid | Count of successful submissions | Data volume tracking |
| Total Rejected | Count of failed validations | Error monitoring |
| Quality Score | `valid / (valid + rejected) × 100` | Overall health indicator |
| Avg Interval | Rolling average of reading gaps | Frequency monitoring |

### Quality Score Update Logic

```rust
fn update_quality_score(oracle_data: &mut OracleData, is_valid: bool) -> Result<()> {
    let metrics = &mut oracle_data.quality_metrics;
    let total_readings = metrics.total_valid_readings + metrics.total_rejected_readings;

    if total_readings > 0 {
        let success_rate = (metrics.total_valid_readings as f64 / total_readings as f64) * 100.0;
        metrics.last_quality_score = success_rate as u8;
        metrics.quality_score_updated_at = Clock::get()?.unix_timestamp;
    }

    Ok(())
}
```

### Quality Monitoring Use Cases

| Score Range | Status | Action |
|-------------|--------|--------|
| 95-100 | Excellent | Normal operations |
| 85-94 | Good | Monitor trends |
| 70-84 | Warning | Investigate gateway |
| <70 | Critical | Pause and investigate |

---

## Redundancy & Consensus

### Backup Oracle Design

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        BACKUP ORACLE ARCHITECTURE                             │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│   PRIMARY OPERATION (Current)                                                 │
│   ═══════════════════════════                                                 │
│                                                                               │
│   ┌─────────────────┐                                                         │
│   │  API Gateway    │ ◀── Single authorized submitter                        │
│   │   (Primary)     │                                                         │
│   └────────┬────────┘                                                         │
│            │                                                                  │
│            ▼                                                                  │
│   ┌─────────────────┐                                                         │
│   │  Oracle Program │                                                         │
│   └─────────────────┘                                                         │
│                                                                               │
│   FAILOVER OPERATION (Supported)                                              │
│   ══════════════════════════════                                              │
│                                                                               │
│   If primary fails → Authority calls update_api_gateway()                     │
│   to promote backup oracle to primary                                         │
│                                                                               │
│   ┌───────────┐  ┌───────────┐  ┌───────────┐                                │
│   │ Backup 1  │  │ Backup 2  │  │ Backup 10 │  ◀── Max 10 backups            │
│   └─────┬─────┘  └─────┬─────┘  └─────┬─────┘                                │
│         └──────────────┴──────────────┘                                       │
│                        │                                                      │
│               Promote one to api_gateway                                      │
│                                                                               │
│   CONSENSUS OPERATION (Future)                                                │
│   ════════════════════════════                                                │
│                                                                               │
│   When require_consensus = true:                                              │
│   - Multiple oracles submit same reading                                      │
│   - consensus_threshold oracles must agree                                    │
│   - Byzantine fault tolerant (planned)                                        │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Backup Oracle Limits

| Constraint | Value | Rationale |
|------------|-------|-----------|
| Max backups | 10 | Account space / gas efficiency |
| Consensus threshold | 2 (default) | Simple majority starting point |

---

## Events

### Event Summary (6 Total)

| Event | Trigger | Key Fields |
|-------|---------|------------|
| `MeterReadingSubmitted` | Valid reading | meter_id, produced, consumed, timestamp, submitter |
| `MarketClearingTriggered` | Clearing initiated | authority, timestamp |
| `OracleStatusUpdated` | Status change | authority, active, timestamp |
| `ApiGatewayUpdated` | Gateway change | authority, old_gateway, new_gateway, timestamp |
| `ValidationConfigUpdated` | Config change | authority, timestamp |
| `BackupOracleAdded` | Backup added | authority, backup_oracle, timestamp |

### Event Definitions

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

## Error Handling

### Error Codes (8 Total)

| Code | Name | Message | Trigger Scenario |
|------|------|---------|------------------|
| 6000 | `UnauthorizedAuthority` | Unauthorized authority | Non-authority calls admin function |
| 6001 | `UnauthorizedGateway` | Unauthorized API Gateway | Non-gateway submits data |
| 6002 | `OracleInactive` | Oracle is inactive | Submit to paused oracle |
| 6003 | `InvalidMeterReading` | Invalid meter reading | Generic validation failure |
| 6004 | `MarketClearingInProgress` | Market clearing in progress | Concurrent clearing attempt |
| 6005 | `EnergyValueOutOfRange` | Energy value out of range | Value > max or < min |
| 6006 | `AnomalousReading` | Anomalous reading detected | Ratio > 10:1 |
| 6007 | `MaxBackupOraclesReached` | Maximum backup oracles reached | > 10 backups |

### Error Definition

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

## Security Model

### Access Control Matrix

| Operation | Public | API Gateway | Authority |
|-----------|:------:|:-----------:|:---------:|
| Read oracle state | ✓ | ✓ | ✓ |
| Submit meter reading | | ✓ | |
| Trigger market clearing | | ✓ | |
| Update oracle status | | | ✓ |
| Update API gateway | | | ✓ |
| Update validation config | | | ✓ |
| Add backup oracle | | | ✓ |

### Dual Authorization Model

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         DUAL AUTHORIZATION MODEL                              │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│   AUTHORITY (Administrative)          API_GATEWAY (Operational)               │
│   ══════════════════════════          ═════════════════════════               │
│                                                                               │
│   ┌───────────────────────┐           ┌───────────────────────┐              │
│   │ • update_oracle_status│           │ • submit_meter_reading│              │
│   │ • update_api_gateway  │           │ • trigger_market_     │              │
│   │ • update_validation_  │           │   clearing            │              │
│   │   config              │           │                       │              │
│   │ • add_backup_oracle   │           │                       │              │
│   └───────────────────────┘           └───────────────────────┘              │
│                                                                               │
│   Constraint: has_one = authority     Constraint: == api_gateway             │
│                                                                               │
│   Purpose: Configuration &            Purpose: Data operations only          │
│   governance                                                                  │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Anchor Constraints

```rust
// Authority-only constraint
#[derive(Accounts)]
pub struct UpdateOracleStatus<'info> {
    #[account(mut, has_one = authority @ ErrorCode::UnauthorizedAuthority)]
    pub oracle_data: Account<'info, OracleData>,
    pub authority: Signer<'info>,
}

// API Gateway constraint (manual check)
pub fn submit_meter_reading(ctx: Context<SubmitMeterReading>, ...) -> Result<()> {
    require!(
        ctx.accounts.authority.key() == oracle_data.api_gateway,
        ErrorCode::UnauthorizedGateway
    );
    // ...
}
```

### Threat Model

| Threat | Vector | Mitigation |
|--------|--------|------------|
| Unauthorized submission | Rogue actor | Only api_gateway can submit |
| Data manipulation | Compromised gateway | Backup oracles + audit events |
| DoS attack | Flood submissions | Rate limiting at gateway |
| Oracle unavailability | Gateway failure | 10 backup oracles |
| Stale data | Gateway offline | `active` flag pause capability |
| Configuration tampering | Authority compromise | On-chain event audit trail |

---

## Cross-Program Integration

### Integration Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                      CROSS-PROGRAM INTEGRATION                                │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│                         ┌─────────────────┐                                   │
│                         │  Oracle Program │                                   │
│                         │                 │                                   │
│                         │ • Meter data    │                                   │
│                         │ • Market signals│                                   │
│                         └────────┬────────┘                                   │
│                                  │                                            │
│                          Events emitted                                       │
│                                  │                                            │
│          ┌───────────────────────┼───────────────────────┐                   │
│          │                       │                       │                    │
│          ▼                       ▼                       ▼                    │
│   ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐            │
│   │    REGISTRY     │   │    TRADING      │   │  ENERGY TOKEN   │            │
│   │    Program      │   │    Program      │   │    Program      │            │
│   ├─────────────────┤   ├─────────────────┤   ├─────────────────┤            │
│   │                 │   │                 │   │                 │            │
│   │ Listens to:     │   │ Listens to:     │   │ Triggered by:   │            │
│   │ MeterReading    │   │ MarketClearing  │   │ Registry        │            │
│   │ Submitted       │   │ Triggered       │   │ settlement      │            │
│   │                 │   │                 │   │                 │            │
│   │ Updates:        │   │ Executes:       │   │ Mints:          │            │
│   │ Meter accounts  │   │ Trade matching  │   │ GRID tokens     │            │
│   │ Net generation  │   │ Price discovery │   │ per kWh         │            │
│   │                 │   │ Settlement      │   │                 │            │
│   └─────────────────┘   └─────────────────┘   └─────────────────┘            │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Event Consumption Pattern

```typescript
// Registry program listens for meter readings
client.oracle.onMeterReadingSubmitted(async (event) => {
  // Update meter account with new reading
  await registry.updateMeterReading({
    meterId: event.meterId,
    produced: event.energyProduced,
    consumed: event.energyConsumed,
    timestamp: event.timestamp,
  });
});

// Trading program listens for market clearing
client.oracle.onMarketClearingTriggered(async (event) => {
  // Execute matching and settlement
  await trading.executeMarketClearing({
    clearingTimestamp: event.timestamp,
  });
});
```

---

## Performance Characteristics

### Compute Units by Instruction

| Instruction | Compute Units | Accounts | Notes |
|-------------|---------------|----------|-------|
| `initialize` | ~35,000 | 3 | PDA creation |
| `submit_meter_reading` | ~25,000 | 2 | Validation + event |
| `trigger_market_clearing` | ~15,000 | 2 | Simple state update |
| `update_oracle_status` | ~12,000 | 2 | Bool update |
| `update_api_gateway` | ~15,000 | 2 | Pubkey update + event |
| `update_validation_config` | ~18,000 | 2 | Struct update |
| `add_backup_oracle` | ~20,000 | 2 | Vec push |

### Account Size

| Component | Base Size | Variable | Max Size |
|-----------|-----------|----------|----------|
| OracleData (no backups) | ~170 bytes | - | ~170 bytes |
| OracleData (10 backups) | ~170 bytes | +320 bytes | ~490 bytes |

### Throughput Estimates

| Metric | Value | Notes |
|--------|-------|-------|
| Max readings/block | ~100 | Based on compute limits |
| Reading latency | ~400ms | Block confirmation |
| Default interval | 5 min | Configurable |
| Daily capacity | ~288 readings/meter | At 5 min intervals |

---

## Appendix: TypeScript SDK Usage

### Initialization

```typescript
import { Program, AnchorProvider, web3 } from "@coral-xyz/anchor";
import { Oracle } from "./types/oracle";

const ORACLE_PROGRAM_ID = new web3.PublicKey(
  "HtV8jTeaCVXKZVCQQVWjXcAvmiF6id9QSLVGP5MT5osX"
);

// Find OracleData PDA
const [oracleDataPda] = web3.PublicKey.findProgramAddressSync(
  [Buffer.from("oracle_data")],
  ORACLE_PROGRAM_ID
);

// Initialize oracle
await program.methods
  .initialize(apiGatewayPubkey)
  .accounts({
    oracleData: oracleDataPda,
    authority: wallet.publicKey,
    systemProgram: web3.SystemProgram.programId,
  })
  .rpc();
```

### Submit Meter Reading (API Gateway)

```typescript
await program.methods
  .submitMeterReading(
    "METER-001",           // meter_id
    new BN(500),           // energy_produced (kWh)
    new BN(300),           // energy_consumed (kWh)
    new BN(timestamp)      // reading_timestamp
  )
  .accounts({
    oracleData: oracleDataPda,
    authority: apiGatewayWallet.publicKey,
  })
  .signers([apiGatewayWallet])
  .rpc();
```

### Fetch Oracle State

```typescript
const oracleData = await program.account.oracleData.fetch(oracleDataPda);

console.log("Authority:", oracleData.authority.toBase58());
console.log("API Gateway:", oracleData.apiGateway.toBase58());
console.log("Active:", oracleData.active);
console.log("Total Readings:", oracleData.totalReadings.toString());
console.log("Quality Score:", oracleData.qualityMetrics.lastQualityScore);
console.log("Backup Oracles:", oracleData.backupOracles.length);
```

### Update Validation Config (Admin)

```typescript
await program.methods
  .updateValidationConfig({
    minEnergyValue: new BN(0),
    maxEnergyValue: new BN(2000000), // 2M kWh
    anomalyDetectionEnabled: true,
    maxReadingDeviationPercent: 75,
    requireConsensus: false,
  })
  .accounts({
    oracleData: oracleDataPda,
    authority: adminWallet.publicKey,
  })
  .rpc();
```

---

## Changelog

### v0.1.0 (Current)
- Initial release
- API Gateway authorization model
- Configurable ValidationConfig
- QualityMetrics tracking
- Backup oracle support (up to 10)
- 7 instructions
- 6 events
- Base64 data output for external systems

### Planned for v0.2.0
- Implement `require_consensus` functionality
- Historical reading storage for trend analysis
- Enhanced anomaly detection with ML scoring
- Cross-program CPI for direct meter updates

---

*Last Updated: November 2025*
*Version: 0.1.0*

````