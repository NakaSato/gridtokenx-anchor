# Oracle Program

> **Trusted Data Ingestion for Smart Meter Readings**

**Program ID:** `JDUVXMkeGi4oxLp8njBaGScAFaVBBg7iGoiqcY1LxKop`

---

## Overview

The Oracle Program is the trusted data ingestion layer for GridTokenX. It receives signed meter readings from an authorized API Gateway, validates them through a multi-stage pipeline, and triggers market clearing for the Trading program.

### Key Features

1. **Permissioned Gateway** — Only the authorized API Gateway can submit readings
2. **On-Chain Validation** — Range checks, anomaly detection, temporal monotonicity
3. **Backup Oracle Network** — Up to 10 redundant oracles for failover consensus
4. **Market Clearing Triggers** — Signals Trading program for batch auction execution
5. **Quality Score** — Real-time oracle reliability metric (0-100)
6. **Per-Meter State** — `MeterState` accounts created on first reading submission

---

## State Accounts

### OracleData

**PDA Seeds:** `["oracle_data"]`
**Layout:** `zero_copy`, `AccountLoader`

#### Configuration

| Field | Type | Description |
|-------|------|-------------|
| `authority` | `Pubkey` | Admin authority |
| `api_gateway` | `Pubkey` | Authorized data submission gateway |
| `backup_oracles` | `[Pubkey; 10]` | Redundant oracle pubkeys |
| `backup_oracles_count` | `u8` | Active backup count (0-10) |
| `consensus_threshold` | `u8` | Min backup oracles for consensus (default: 2) |

#### Validation Parameters

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `min_energy_value` | `u64` | 0 | Minimum valid reading |
| `max_energy_value` | `u64` | 1,000,000 | Maximum valid reading (kWh) |
| `max_reading_deviation_percent` | `u16` | 50 | Max % deviation from previous reading |
| `min_reading_interval` | `u16` | 60 | Min seconds between readings (rate limit) |
| `max_production_consumption_ratio` | `u16` | 1000 | Max ratio (10x) — solar allows high production |
| `anomaly_detection_enabled` | `u8` | 1 (true) | Statistical validation toggle |
| `require_consensus` | `u8` | 0 (false) | Require backup oracle confirmation |

#### Metrics

| Field | Type | Description |
|-------|------|-------------|
| `total_readings` | `u64` | Total submissions (valid + rejected) |
| `total_valid_readings` | `u64` | Accepted readings |
| `total_rejected_readings` | `u64` | Rejected readings |
| `last_quality_score` | `u8` | Current quality score (0-100) |
| `last_reading_timestamp` | `i64` | Most recent reading timestamp |
| `last_clearing` | `i64` | Last market clearing timestamp |
| `last_cleared_epoch` | `i64` | Last finalized epoch |
| `last_energy_produced` | `u64` | Previous production (deviation check) |
| `last_energy_consumed` | `u64` | Previous consumption (deviation check) |
| `total_global_energy_produced` | `u64` | Cumulative global production |
| `total_global_energy_consumed` | `u64` | Cumulative global consumption |
| `average_reading_interval` | `u32` | Weighted moving average of intervals |
| `last_consensus_timestamp` | `i64` | Last consensus agreement |
| `active` | `u8` | 1 = active, 0 = paused |

### MeterState

**PDA Seeds:** `["meter", meter_id.as_bytes()]`
**Layout:** Standard `#[account]` (created on first reading via `init_if_needed`)

| Field | Type | Description |
|-------|------|-------------|
| `meter_id` | `[u8; 32]` | Fixed-size meter identifier |
| `meter_id_len` | `u8` | Actual length of meter_id string |
| `bump` | `u8` | PDA bump seed |
| `zone_id` | `i32` | Regional/zone identifier |
| `energy_produced` | `u64` | Latest production reading |
| `energy_consumed` | `u64` | Latest consumption reading |
| `total_energy_produced` | `u64` | Cumulative production |
| `total_energy_consumed` | `u64` | Cumulative consumption |
| `last_reading_timestamp` | `i64` | Last reading timestamp |
| `total_readings` | `u64` | Total readings for this meter |
| `created_at` | `i64` | Account creation timestamp |

### Constants

```rust
pub const MAX_METER_ID_LEN: usize = 32;
```

---

## Instructions

### initialize

Bootstraps the oracle system.

**Arguments:**
- `api_gateway: Pubkey` — Authorized off-chain gateway

**Accounts:**
- `oracle_data` (init, PDA `["oracle_data"]`)
- `authority` (Signer, mut)

**Defaults:**
- `active = 1`, `anomaly_detection_enabled = 1`
- `min_energy_value = 0`, `max_energy_value = 1,000,000`
- `max_reading_deviation_percent = 50`
- `max_production_consumption_ratio = 1000` (10x)
- `min_reading_interval = 60` seconds
- `average_reading_interval = 300`
- `last_quality_score = 100`
- `consensus_threshold = 2`

---

### submit_meter_reading

**Core data ingestion endpoint.** Validates and records a smart meter reading.

**Arguments:**
- `meter_id: String` — Unique meter identifier (≤ 32 bytes)
- `energy_produced: u64` — kWh produced (nano-kWh precision)
- `energy_consumed: u64` — kWh consumed
- `reading_timestamp: i64` — Unix timestamp of measurement
- `zone_id: i32` — Zone/region (updated on every submission, allows meter relocation)

**Accounts:**
- `oracle_data` (readonly, PDA)
- `meter_state` (init_if_needed, PDA `["meter", meter_id.as_bytes()]`)
- `authority` (Signer, mut) — Must be `api_gateway`
- `system_program`

**Validation Pipeline:**

```
1. AUTHORIZATION
   oracle_data.active == 1
   authority.key() == oracle_data.api_gateway

2. TEMPORAL VALIDATION
   reading_timestamp <= current_time + 60 (no future readings >60s)

3. RATE LIMITING
   reading_timestamp >= last_reading_timestamp + min_reading_interval

4. RANGE VALIDATION
   min_energy_value ≤ energy_produced, energy_consumed ≤ max_energy_value

5. ANOMALY DETECTION (if enabled)
   If energy_consumed > 0:
     energy_produced × 100 ≤ max_production_consumption_ratio × energy_consumed
   (Integer cross-multiplication avoids floating-point)
```

**State Updates:**
- On first use: Initializes `meter_id`, `meter_id_len`, `bump`, `created_at`
- On every call: Updates `zone_id`, energy values (latest + cumulative), `total_readings`

**Events:**
- `MeterReadingSubmitted` (valid reading)
- `MeterReadingRejected` (invalid, includes `reason` string)

---

### trigger_market_clearing

Signals Trading program to execute batch clearing of open orders.

**Arguments:**
- `epoch_timestamp: i64` — Must be > `last_cleared_epoch`

**Accounts:**
- `oracle_data` (mut, PDA)
- `authority` (Signer) — Must be `api_gateway`

**Logic:**
1. Verify oracle active and authority
2. Ensure `epoch_timestamp > last_cleared_epoch` (no duplicate clearing)
3. Update `last_clearing` and `last_cleared_epoch`

**Event:** `MarketClearingTriggered { authority, timestamp, epoch_number }`

---

### aggregate_readings

Aggregates global energy totals and recalculates quality score.

**Arguments:**
- `total_produced: u64`
- `total_consumed: u64`
- `valid_count: u64`
- `rejected_count: u64`

**Accounts:**
- `oracle_data` (mut, PDA)
- `authority` (Signer) — Must be `api_gateway`

**Logic:**
1. Add to global totals (`saturating_add`)
2. Update `total_readings = valid + rejected`
3. Recalculate quality score: `(total_valid_readings × 100) / total_readings` (capped at 100)

**Event:** `ReadingsAggregated`

---

### update_oracle_status

Pause/resume oracle operations.

**Arguments:**
- `active: bool`

**Accounts:**
- `oracle_data` (mut)
- `authority` (Signer) — Admin only

**Event:** `OracleStatusUpdated`

---

### update_api_gateway

Transfer gateway authorization to new address.

**Arguments:**
- `new_api_gateway: Pubkey`

**Accounts:**
- `oracle_data` (mut)
- `authority` (Signer) — Admin only

**Event:** `ApiGatewayUpdated { authority, old_gateway, new_gateway, timestamp }`

---

### update_validation_config

Modifies validation parameters.

**Arguments:**
- `min_energy_value: u64`
- `max_energy_value: u64`
- `anomaly_detection_enabled: bool`
- `max_reading_deviation_percent: u16`
- `require_consensus: bool`

**Event:** `ValidationConfigUpdated`

---

### update_production_ratio_config

Adjusts the production/consumption anomaly ratio.

**Arguments:**
- `max_production_consumption_ratio: u16` — Must be > 0

**Event:** `ProductionRatioConfigUpdated`

---

### add_backup_oracle

Registers redundant oracle node for failover.

**Arguments:**
- `backup_oracle: Pubkey`

**Accounts:**
- `oracle_data` (mut)
- `authority` (Signer) — Admin only

**Constraints:** Max 10, no duplicates.

**Event:** `BackupOracleAdded`

---

### remove_backup_oracle

Deregisters a backup oracle.

**Arguments:**
- `backup_oracle: Pubkey`

**Algorithm:** Linear search, shift array left, zero last element, decrement count.

**Event:** `BackupOracleRemoved`

---

## Error Codes

| Discriminant | Error | Condition |
|--------------|-------|-----------|
| 0 | `UnauthorizedAuthority` | Caller ≠ admin authority |
| 1 | `UnauthorizedGateway` | Caller ≠ `api_gateway` |
| 2 | `OracleInactive` | `active = 0` |
| 3 | `InvalidMeterReading` | Meter reading validation failed |
| 4 | `MarketClearingInProgress` | Clearing already in progress |
| 5 | `EnergyValueOutOfRange` | Reading outside `[min, max]` |
| 6 | `AnomalousReading` | Production/consumption ratio exceeded |
| 7 | `MaxBackupOraclesReached` | Attempting to add 11th oracle |
| 8 | `OutdatedReading` | `reading_timestamp ≤ last_reading_timestamp` |
| 9 | `FutureReading` | `reading_timestamp > now + 60s` |
| 10 | `RateLimitExceeded` | Readings too frequent |
| 11 | `BackupOracleAlreadyExists` | Duplicate oracle pubkey |
| 12 | `BackupOracleNotFound` | Removing non-existent oracle |
| 13 | `InvalidConfiguration` | Invalid config parameter |
| 14 | `InvalidEpoch` | Epoch ≤ last cleared epoch |
| 15 | `MeterIdTooLong` | Meter ID > 32 bytes |

---

## Events

| Event | Fields |
|-------|--------|
| `MeterReadingSubmitted` | `meter_id`, `energy_produced`, `energy_consumed`, `timestamp`, `zone_id`, `submitter` |
| `MeterReadingRejected` | `meter_id`, `energy_produced`, `energy_consumed`, `timestamp`, `zone_id`, `reason` |
| `MarketClearingTriggered` | `authority`, `timestamp`, `epoch_number` |
| `OracleStatusUpdated` | `authority`, `active`, `timestamp` |
| `ApiGatewayUpdated` | `authority`, `old_gateway`, `new_gateway`, `timestamp` |
| `ValidationConfigUpdated` | `authority`, `timestamp` |
| `BackupOracleAdded` | `authority`, `backup_oracle`, `timestamp` |
| `BackupOracleRemoved` | `authority`, `backup_oracle`, `timestamp` |
| `ProductionRatioConfigUpdated` | `authority`, `max_production_consumption_ratio`, `timestamp` |
| `ReadingsAggregated` | `authority`, `total_produced`, `total_consumed`, `valid_count`, `rejected_count`, `timestamp` |

---

## Anomaly Detection

The oracle uses **integer cross-multiplication** to avoid floating-point imprecision:

```rust
// Check: produced / consumed ≤ max_ratio (e.g., 10x)
// Equivalent: produced × 100 ≤ max_ratio × consumed
energy_produced
    .checked_mul(100)
    .ok_or(InvalidConfiguration)?
    <= oracle_data.max_production_consumption_ratio as u64
        .checked_mul(energy_consumed)
        .ok_or(InvalidConfiguration)?
```

This allows solar producers (high production, minimal consumption) while catching truly anomalous readings.

---

## Quality Score

```
quality_score = (total_valid_readings × 100) / total_readings
```

Capped at 100. Updated via `aggregate_readings`. Can trigger automatic failover if score drops below governance-defined threshold.

---

## Byzantine Fault Tolerance

With N backup oracles and threshold T:
- **f = N - T** faulty nodes tolerated
- Default: 0 backups, threshold 2 (development mode)
- Production recommended: 10 backups, threshold 7 (tolerates 3 faulty)

---

**Related:** [Registry](./registry.md) — Meter reading settlement · [Trading](./trading.md) — Market clearing
