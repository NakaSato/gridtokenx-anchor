```markdown
# Oracle Program

> **Academic Documentation - AMI Data Bridge for P2P Energy Trading**

Program ID: `HtV8jTeaCVXKZVCQQVWjXcAvmiF6id9QSLVGP5MT5osX`

---

## Overview

The Oracle Program serves as the critical data bridge between the physical energy grid (via Advanced Metering Infrastructure) and the GridTokenX blockchain platform. It implements a centralized gateway authorization model with configurable data validation, quality metrics tracking, and redundancy support through backup oracles.

---

## Theoretical Foundation

### The Oracle Problem in Energy Markets

Blockchain systems require external data to make decisions, creating the "oracle problem"—how to trustworthily bring off-chain data on-chain. For P2P energy trading, this challenge is particularly acute:

- **High frequency**: Smart meters report every 1-15 minutes (default: 5 min)
- **Financial impact**: Data directly determines token minting eligibility
- **Physical coupling**: Data represents real-world energy flows
- **Regulatory requirements**: Energy data must be auditable and verifiable

### Design Philosophy: API Gateway Model

The GridTokenX Oracle implements a **centralized API Gateway model** with provisions for decentralization:

| Approach | Latency | Trust | Cost | GridTokenX Implementation |
|----------|---------|-------|------|---------------------------|
| Centralized Gateway | Low (~ms) | Single entity | Low | ✓ **Primary** |
| Backup Oracles | Medium | N-of-M | Medium | ✓ **Failover** |
| Decentralized Consensus | High (~sec) | Distributed | High | ◐ **Planned** |

**Rationale:**
1. **Operational simplicity**: Single authorized gateway minimizes key management
2. **Low latency**: Critical for real-time energy market operations
3. **Clear accountability**: Single point of contact for data quality issues
4. **Upgrade path**: `backup_oracles` and `require_consensus` fields enable future decentralization

---

## Architecture

### System Context

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          ORACLE PROGRAM ARCHITECTURE                          │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│   ┌─────────────────┐         ┌─────────────────┐                            │
│   │   Smart Meters  │         │    API Gateway  │                            │
│   │      (AMI)      │────────▶│    (Off-chain)  │                            │
│   └─────────────────┘  MQTT/  └────────┬────────┘                            │
│                        REST             │                                     │
│                                         │ Solana TX                           │
│                                         ▼                                     │
│                              ┌─────────────────┐                             │
│                              │  Oracle Program │                             │
│                              │    (On-chain)   │                             │
│                              └────────┬────────┘                             │
│                                       │                                       │
│            ┌──────────────────────────┼──────────────────────────┐           │
│            │                          │                          │           │
│            ▼                          ▼                          ▼           │
│   ┌─────────────────┐       ┌─────────────────┐        ┌─────────────────┐  │
│   │    Registry     │       │    Trading      │        │   Energy Token  │  │
│   │    Program      │       │    Program      │        │    Program      │  │
│   │                 │       │                 │        │                 │  │
│   │ • Meter state   │       │ • Market data   │        │ • Mint trigger  │  │
│   │ • Settlement    │       │ • Clearing      │        │ • Token backing │  │
│   └─────────────────┘       └─────────────────┘        └─────────────────┘  │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Authorization Model

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         DUAL AUTHORIZATION MODEL                              │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│   ┌─────────────────────────────────────────────────────────────────────────┐│
│   │                         AUTHORITY (Admin)                                ││
│   │                                                                          ││
│   │  Permissions:                                                            ││
│   │  • update_oracle_status()     - Pause/resume oracle                     ││
│   │  • update_api_gateway()       - Change gateway address                  ││
│   │  • update_validation_config() - Modify validation rules                 ││
│   │  • add_backup_oracle()        - Add redundancy                          ││
│   │                                                                          ││
│   └─────────────────────────────────────────────────────────────────────────┘│
│                                                                               │
│   ┌─────────────────────────────────────────────────────────────────────────┐│
│   │                       API_GATEWAY (Operational)                          ││
│   │                                                                          ││
│   │  Permissions:                                                            ││
│   │  • submit_meter_reading()     - Submit validated AMI data               ││
│   │  • trigger_market_clearing()  - Initiate market settlement              ││
│   │                                                                          ││
│   │  Security:                                                               ││
│   │  • Only single designated address can submit data                        ││
│   │  • Immediate revocation via update_api_gateway()                        ││
│   │  • Backup oracles for failover (up to 10)                               ││
│   │                                                                          ││
│   └─────────────────────────────────────────────────────────────────────────┘│
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Account Architecture

### OracleData Account (Singleton PDA)

Global oracle configuration, metrics, and redundancy settings.

| Field | Type | Size | Description |
|-------|------|------|-------------|
| `authority` | Pubkey | 32 | Administrative authority |
| `api_gateway` | Pubkey | 32 | Authorized data submission gateway |
| `total_readings` | u64 | 8 | Total readings processed |
| `last_reading_timestamp` | i64 | 8 | Most recent reading time |
| `last_clearing` | i64 | 8 | Last market clearing time |
| `active` | bool | 1 | Oracle operational status |
| `created_at` | i64 | 8 | Initialization timestamp |
| `validation_config` | ValidationConfig | ~22 | Validation parameters |
| `quality_metrics` | QualityMetrics | ~29 | Quality tracking |
| `backup_oracles` | Vec<Pubkey> | 4 + (32 × n) | Up to 10 backup addresses |
| `consensus_threshold` | u8 | 1 | Min oracles for consensus |
| `last_consensus_timestamp` | i64 | 8 | Last consensus time |

**PDA Derivation:** Seeds = `["oracle_data"]`

---

### ValidationConfig

Configurable validation parameters for meter readings.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `min_energy_value` | u64 | 0 | Minimum valid energy reading |
| `max_energy_value` | u64 | 1,000,000 | Maximum valid energy reading (kWh) |
| `anomaly_detection_enabled` | bool | true | Enable ratio-based anomaly detection |
| `max_reading_deviation_percent` | u16 | 50 | Maximum % deviation from historical average |
| `require_consensus` | bool | false | Require multi-oracle consensus (future) |

---

### QualityMetrics

Running statistics for data quality monitoring.

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

---

## Data Validation Pipeline

### Validation Stages

The oracle implements a multi-stage validation pipeline:

**Stage 1: Authorization Check**
```rust
require!(oracle_data.active, ErrorCode::OracleInactive);
require!(
    authority.key() == oracle_data.api_gateway,
    ErrorCode::UnauthorizedGateway
);
```

**Stage 2: Range Validation**
```rust
require!(
    energy_produced >= config.min_energy_value 
        && energy_produced <= config.max_energy_value,
    ErrorCode::EnergyValueOutOfRange
);
```

**Stage 3: Anomaly Detection**
```rust
if config.anomaly_detection_enabled && energy_consumed > 0 {
    let ratio = (energy_produced as f64 / energy_consumed as f64) * 100.0;
    require!(ratio <= 1000.0, ErrorCode::AnomalousReading); // Max 10:1 ratio
}
```

### Validation Flow Diagram

```
┌─────────────────┐
│  Meter Reading  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│ Active Check    │────▶│ OracleInactive  │
└────────┬────────┘ NO  └─────────────────┘
         │ YES
         ▼
┌─────────────────┐     ┌─────────────────┐
│ Gateway Auth    │────▶│UnauthorizedGateway│
└────────┬────────┘ NO  └─────────────────┘
         │ YES
         ▼
┌─────────────────┐     ┌─────────────────┐
│ Range Check     │────▶│EnergyValueOutOfRange│
└────────┬────────┘ FAIL└─────────────────┘
         │ PASS
         ▼
┌─────────────────┐     ┌─────────────────┐
│ Anomaly Check   │────▶│ AnomalousReading│
└────────┬────────┘ FAIL└─────────────────┘
         │ PASS
         ▼
┌─────────────────┐
│ Update Metrics  │
│ Emit Event      │
│ Log Base64 Data │
└─────────────────┘
```

---

## Instructions Summary

### Administrative Instructions (Authority Only)

| Instruction | Purpose | Key Constraint |
|-------------|---------|----------------|
| `initialize` | Create oracle PDA | One-time deployment |
| `update_oracle_status` | Pause/resume oracle | has_one = authority |
| `update_api_gateway` | Change gateway address | has_one = authority |
| `update_validation_config` | Modify validation rules | has_one = authority |
| `add_backup_oracle` | Add redundancy (max 10) | has_one = authority |

### Operational Instructions (API Gateway Only)

| Instruction | Purpose | Key Constraint |
|-------------|---------|----------------|
| `submit_meter_reading` | Submit AMI data | signer == api_gateway |
| `trigger_market_clearing` | Initiate settlement | signer == api_gateway |

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

### Threat Model

| Threat | Vector | Mitigation |
|--------|--------|------------|
| Unauthorized data submission | Rogue actor | Only api_gateway can submit |
| Data manipulation | Compromised gateway | Backup oracles for failover |
| DoS attack | Flood submissions | Rate limiting at gateway level |
| Oracle unavailability | Gateway failure | up to 10 backup_oracles |
| Stale data | Gateway offline | `active` flag to pause oracle |
| Configuration tampering | Authority compromise | On-chain audit trail via events |

### Anchor Security Constraints

```rust
#[derive(Accounts)]
pub struct UpdateOracleStatus<'info> {
    #[account(
        mut, 
        has_one = authority @ ErrorCode::UnauthorizedAuthority
    )]
    pub oracle_data: Account<'info, OracleData>,
    pub authority: Signer<'info>,
}
```

---

## Events

| Event | Trigger | Key Fields |
|-------|---------|------------|
| `MeterReadingSubmitted` | Valid reading submission | meter_id, energy_produced, energy_consumed, timestamp, submitter |
| `MarketClearingTriggered` | Market clearing initiated | authority, timestamp |
| `OracleStatusUpdated` | Status change | authority, active, timestamp |
| `ApiGatewayUpdated` | Gateway change | authority, old_gateway, new_gateway, timestamp |
| `ValidationConfigUpdated` | Config change | authority, timestamp |
| `BackupOracleAdded` | Backup added | authority, backup_oracle, timestamp |

---

## Errors

| Code | Name | Message | Trigger |
|------|------|---------|---------|
| 6000 | `UnauthorizedAuthority` | Unauthorized authority | Non-authority admin calls |
| 6001 | `UnauthorizedGateway` | Unauthorized API Gateway | Non-gateway data submission |
| 6002 | `OracleInactive` | Oracle is inactive | Submit to paused oracle |
| 6003 | `InvalidMeterReading` | Invalid meter reading | Generic validation failure |
| 6004 | `MarketClearingInProgress` | Market clearing in progress | Concurrent clearing |
| 6005 | `EnergyValueOutOfRange` | Energy value out of range | Value > max or < min |
| 6006 | `AnomalousReading` | Anomalous reading detected | Ratio > 10:1 |
| 6007 | `MaxBackupOraclesReached` | Maximum backup oracles reached | > 10 backups |

---

## Data Output Format

Meter readings are encoded as Base64 for external system consumption:

```rust
let reading_data = format!(
    "{}:{}:{}:{}",
    meter_id, energy_produced, energy_consumed, reading_timestamp
);
let encoded_data = general_purpose::STANDARD.encode(reading_data.as_bytes());
msg!("Meter reading data (base64): {}", encoded_data);
```

**Example:**
- Input: `METER-001:500:300:1701234567`
- Base64: `TUVURVItMDAxOjUwMDozMDA6MTcwMTIzNDU2Nw==`

---

## Research Implications

### Contribution to Literature

The Oracle Program contributes to research on:

1. **Energy market oracle design**: Balancing centralization and decentralization
2. **Data validation pipelines**: Domain-specific validation for energy data
3. **Quality-aware data ingestion**: Continuous monitoring with feedback loop
4. **Backup oracle patterns**: Redundancy without full decentralization overhead

### Future Research Directions

1. **Multi-oracle consensus**: Implement `require_consensus` with Byzantine fault tolerance
2. **TEE integration**: Hardware-backed data integrity via Trusted Execution Environments
3. **Machine learning anomaly detection**: Replace ratio check with ML-based detection
4. **Cross-chain oracles**: Interoperability with other blockchain networks

---

## Performance Characteristics

| Metric | Value |
|--------|-------|
| Initialize CU | ~35,000 |
| Submit reading CU | ~25,000 |
| Account space | ~500 bytes (base) + 32 × backup_oracles |
| Max backup oracles | 10 |
| Default reading interval | 300 seconds (5 minutes) |

---

*For implementation details, see [Technical Oracle Documentation](../../technical/programs/oracle.md)*

```