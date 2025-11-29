# Oracle Program

> **Academic Documentation - Smart Meter Data Validation System**

Program ID: `DvdtU4quEbuxUY2FckmvcXwTpC9qp4HLJKb1PMLaqAoE`

---

## Overview

The Oracle Program serves as the data validation layer for the GridTokenX platform. It receives smart meter readings through an authorized API gateway, validates data integrity, and maintains quality metrics for the energy data pipeline.

---

## Theoretical Foundation

### The Oracle Problem in Energy Markets

Blockchain systems require external data to make decisions, creating the "oracle problem"—how to trustworthily bring off-chain data on-chain. For energy trading, this challenge is acute:

- **High frequency**: Meters report every 1-5 minutes
- **Financial impact**: Data directly determines token minting
- **Physical coupling**: Data represents real-world energy flows

### Design Trade-offs

| Approach | Latency | Trust | Cost | Chosen |
|----------|---------|-------|------|--------|
| Centralized Gateway | Low (~ms) | Single entity | Low | ✓ Primary |
| Decentralized Oracles | High (~sec) | Distributed | High | Backup |
| TEE-based | Medium | Hardware | Medium | Future |

The GridTokenX Oracle implements a **hybrid design**:
- Primary: Centralized gateway for low-latency operation
- Backup: Configurable backup oracles for failover
- Future: Path to decentralization as ecosystem matures

---

## Account Architecture

### Oracle Data Account (Singleton)

Global oracle configuration and aggregate metrics.

| Field | Type | Description |
|-------|------|-------------|
| `authority` | PublicKey | Oracle administrative authority |
| `api_gateway` | PublicKey | Authorized data submission gateway |
| `backup_oracles` | Vec<PublicKey> | Backup oracle addresses (up to 5) |
| `is_active` | bool | Oracle operational status |
| `total_readings` | u64 | Total readings processed |
| `valid_readings` | u64 | Readings passing validation |
| `rejected_readings` | u64 | Readings failing validation |
| `last_reading_at` | i64 | Most recent reading timestamp |
| `quality_score` | u8 | Aggregate quality metric (0-100) |
| `created_at` | i64 | Oracle initialization timestamp |
| `bump` | u8 | PDA bump seed |

**PDA Derivation**: Seeds = `["oracle_data"]`

---

## Data Validation Pipeline

### Validation Stages

The oracle implements a multi-stage validation pipeline:

**Stage 1: Authentication**
- Verify signer is authorized gateway
- Check gateway status is active

**Stage 2: Format Validation**
- Meter ID format verification
- Timestamp within acceptable range
- Non-negative energy values

**Stage 3: Range Validation**
- Generation within meter capacity limits
- Consumption within reasonable bounds
- Net values mathematically consistent

**Stage 4: Temporal Validation**
- Reading timestamp after previous reading
- Time gap within expected interval
- No future-dated readings

**Stage 5: Anomaly Detection**
- Statistical deviation from historical pattern
- Sudden spikes flagged for review
- Seasonal adjustment considerations

### Quality Scoring

Each reading receives a quality score based on validation results:

$$Q = \frac{\sum_{i=1}^{n} w_i \cdot v_i}{\sum_{i=1}^{n} w_i}$$

Where:
- $Q$ = Quality score (0-100)
- $w_i$ = Weight of validation check $i$
- $v_i$ = Pass/fail status (1 or 0)

| Validation Check | Weight |
|------------------|--------|
| Authentication | 30 |
| Format | 20 |
| Range | 25 |
| Temporal | 15 |
| Anomaly | 10 |

---

## Instructions

### Administrative Instructions

| Instruction | Authority | Description |
|-------------|-----------|-------------|
| `initialize_oracle` | Deployer | Create oracle configuration |
| `update_oracle_authority` | Authority | Transfer administrative control |
| `set_api_gateway` | Authority | Configure authorized gateway |
| `add_backup_oracle` | Authority | Add backup oracle address |
| `remove_backup_oracle` | Authority | Remove backup oracle |
| `pause_oracle` | Authority | Temporarily halt data ingestion |
| `resume_oracle` | Authority | Resume oracle operations |

### Data Ingestion Instructions

| Instruction | Signer | Description |
|-------------|--------|-------------|
| `submit_meter_reading` | API Gateway | Submit validated meter data |
| `batch_submit_readings` | API Gateway | Submit multiple readings |

### Query Instructions

| Instruction | Access | Description |
|-------------|--------|-------------|
| `get_oracle_stats` | Public | Retrieve aggregate statistics |

---

## Gateway Authorization Pattern

### Single Gateway Model

The current implementation uses a single authorized gateway:

**Advantages:**
- Minimal latency (~10ms processing)
- Simple key management
- Predictable costs
- Easy debugging

**Limitations:**
- Single point of failure
- Trust concentration
- No redundancy

### Backup Oracle Mechanism

The `backup_oracles` field enables failover:

1. Primary gateway submits normally
2. If primary unavailable, backup oracles can submit
3. Authority can rotate gateways without downtime
4. Maximum 5 backup oracles configured

---

## Data Flow

### Reading Submission Flow

1. **Smart Meter** generates reading with Ed25519 signature
2. **API Gateway** receives and pre-validates
3. **Gateway** submits to Oracle Program
4. **Oracle** performs on-chain validation
5. **Oracle** updates metrics and emits event
6. **Registry** receives validated data via event

### Event-Driven Architecture

The Oracle emits events consumed by other system components:

| Event | Consumer | Purpose |
|-------|----------|---------|
| `MeterReadingReceived` | Registry | Trigger meter account update |
| `ValidationFailed` | Monitoring | Alert on data quality issues |
| `OracleStatusChanged` | All | System status notification |

---

## Security Model

### Access Control

| Operation | Public | Gateway | Authority |
|-----------|:------:|:-------:|:---------:|
| Submit reading | | ✓ | |
| View stats | ✓ | ✓ | ✓ |
| Configure gateway | | | ✓ |
| Pause/Resume | | | ✓ |

### Threat Model

| Threat | Vector | Mitigation |
|--------|--------|------------|
| Data manipulation | Compromised gateway | Backup oracles, audit logs |
| DoS attack | Flood submissions | Rate limiting, compute budget |
| Replay attack | Resubmit old readings | Timestamp validation |
| Collusion | Gateway + meter | Multi-oracle consensus (future) |

### Rate Limiting

| Constraint | Limit | Purpose |
|------------|-------|---------|
| Per-meter interval | 1 reading / 5 min | Prevent spam |
| Per-gateway batch | 50 readings / tx | Compute budget |
| Daily per-meter | 288 readings | Storage management |

---

## Quality Metrics

### Aggregate Statistics

The Oracle maintains running statistics:

| Metric | Calculation | Purpose |
|--------|-------------|---------|
| Acceptance Rate | valid / total × 100 | Data quality indicator |
| Rejection Rate | rejected / total × 100 | Gateway health |
| Quality Score | Weighted validation average | Overall confidence |

### Monitoring Integration

Quality metrics enable:
- Automated alerting on degradation
- Gateway performance tracking
- Anomaly trend analysis
- Regulatory reporting

---

## Events

| Event | Trigger | Key Fields |
|-------|---------|------------|
| `OracleInitialized` | Initialization | authority, gateway |
| `MeterReadingReceived` | Valid submission | meter_id, values, quality |
| `ValidationFailed` | Invalid submission | meter_id, reason |
| `GatewayUpdated` | Gateway change | old_gateway, new_gateway |
| `OraclePaused` | Pause action | authority, timestamp |
| `OracleResumed` | Resume action | authority, timestamp |

---

## Errors

| Error Code | Name | Description |
|------------|------|-------------|
| 6100 | `UnauthorizedGateway` | Signer not authorized gateway |
| 6101 | `OraclePaused` | Oracle not accepting data |
| 6102 | `InvalidTimestamp` | Reading timestamp out of range |
| 6103 | `DuplicateReading` | Reading already processed |
| 6104 | `InvalidMeterData` | Data fails validation |
| 6105 | `RateLimitExceeded` | Too many submissions |
| 6106 | `BackupOraclesFull` | Maximum backup oracles reached |

---

## Research Implications

### Contribution to Literature

The Oracle Program contributes to research on:

1. **Hybrid oracle architectures**: Balancing centralization and decentralization
2. **Energy data validation**: Domain-specific validation pipelines
3. **Quality-aware data ingestion**: Continuous monitoring and scoring

### Future Research Directions

1. **Decentralized validation**: Multi-oracle consensus mechanisms
2. **TEE integration**: Hardware-backed data integrity
3. **Machine learning**: Advanced anomaly detection
4. **Cross-chain oracles**: Interoperability with other networks

### Performance Characteristics

| Metric | Value |
|--------|-------|
| Validation latency | <50ms |
| Compute units | ~30,000 CU |
| Storage per reading | ~200 bytes |

---

*For implementation details, see [Technical Oracle Documentation](../../technical/programs/oracle.md)*
