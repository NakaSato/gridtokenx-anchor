# Oracle Security Model: Deep Dive

> **Byzantine Fault Tolerance and Data Validation for Energy Metering**

---

## 1. Executive Summary

The GridTokenX Oracle system implements a **multi-layered security architecture** for ingesting real-world energy metering data onto the Solana blockchain. As the critical trust bridge between physical infrastructure (smart meters) and on-chain settlement, the oracle must defend against:

- **Data Manipulation**: Falsified meter readings
- **Replay Attacks**: Submitting old readings multiple times
- **Denial of Service**: Overwhelming the oracle with requests
- **Single Point of Failure**: Primary oracle goes offline
- **Byzantine Faults**: Malicious oracle operators

**Security Model:** Permissioned primary oracle with Byzantine Fault Tolerant (BFT) backup consensus.

---

## 2. Threat Model

### 2.1 Attack Surface

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          ORACLE THREAT MODEL                             │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  PHYSICAL LAYER                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Threat: Smart meter tampering                                   │    │
│  │  Attack: Physical modification to report false readings          │    │
│  │  Mitigation: Hardware attestation, anti-tamper seals            │    │
│  │              ⚠️ Out of scope for on-chain oracle                │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                              │                                           │
│                              ▼                                           │
│  COMMUNICATION LAYER                                                     │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Threat: Man-in-the-middle attack                                │    │
│  │  Attack: Intercept and modify readings in transit                │    │
│  │  Mitigation: TLS encryption, signed payloads from meters        │    │
│  │              ✓ Gateway responsibility                           │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                              │                                           │
│                              ▼                                           │
│  GATEWAY LAYER                                                           │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Threat: Compromised API gateway                                 │    │
│  │  Attack: Gateway operator submits false readings                 │    │
│  │  Mitigation: Multi-oracle consensus, anomaly detection          │    │
│  │              ✓ Primary focus of on-chain security               │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                              │                                           │
│                              ▼                                           │
│  ON-CHAIN LAYER                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Threat: Malicious transactions                                  │    │
│  │  Attack: Replay attacks, timestamp manipulation                  │    │
│  │  Mitigation: Monotonic timestamps, sequence numbers, rate limits│    │
│  │              ✓ Enforced by Oracle program                       │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Attacker Capabilities

| Attacker Type | Capabilities | Goal |
|---------------|--------------|------|
| **External** | No special access | Deny service, exploit bugs |
| **Gateway Operator** | Submit readings | Inflate energy credits |
| **Backup Oracle** | Vote on readings | Collude for false consensus |
| **Admin** | Update config | Change validation rules |

---

## 3. Primary Oracle Security

### 3.1 Authorization Model

```rust
// Only the authorized API gateway can submit readings
pub fn submit_meter_reading(ctx: Context<SubmitMeterReading>, ...) -> Result<()> {
    let oracle_data = ctx.accounts.oracle_data.load_mut()?;
    
    // AUTHORIZATION: Must be the designated API gateway
    require!(
        ctx.accounts.authority.key() == oracle_data.api_gateway,
        OracleError::UnauthorizedGateway
    );
    
    // ACTIVE CHECK: Oracle must be operational
    require!(
        oracle_data.active == 1,
        OracleError::OracleInactive
    );
    
    // ... proceed with validation
}
```

### 3.2 Gateway Key Management

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    API GATEWAY KEY ROTATION                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Current Gateway Key: GaTe...wAy1                                      │
│                                                                         │
│  Rotation Process:                                                      │
│  1. Admin calls: update_api_gateway(new_gateway: GaTe...wAy2)          │
│  2. Validation: new_gateway != Pubkey::default()                       │
│  3. Event emitted: ApiGatewayUpdated { old, new, timestamp }           │
│  4. Old key immediately revoked                                        │
│                                                                         │
│  Security Note:                                                         │
│  - Admin key should be hardware wallet (Ledger)                        │
│  - Consider timelock for critical operations                           │
│  - Log all admin actions for audit                                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Temporal Validation

### 4.1 Monotonic Timestamp Enforcement

Readings must be submitted in chronological order:

```rust
pub fn validate_timestamp(
    oracle_data: &OracleData,
    reading_timestamp: i64,
) -> Result<()> {
    let current_time = Clock::get()?.unix_timestamp;
    
    // 1. Must be newer than last reading
    require!(
        reading_timestamp > oracle_data.last_reading_timestamp,
        OracleError::OutdatedReading
    );
    
    // 2. Cannot be in the future (60s tolerance for clock skew)
    require!(
        reading_timestamp <= current_time + 60,
        OracleError::FutureReading
    );
    
    // 3. Cannot be too old (staleness check)
    let max_age = 3600; // 1 hour
    require!(
        reading_timestamp >= current_time - max_age,
        OracleError::StaleReading
    );
    
    Ok(())
}
```

### 4.2 Rate Limiting

```rust
pub fn check_rate_limit(
    oracle_data: &OracleData,
    reading_timestamp: i64,
) -> Result<()> {
    // Only enforce if we have a previous reading
    if oracle_data.last_reading_timestamp > 0 {
        let time_since_last = reading_timestamp - oracle_data.last_reading_timestamp;
        
        require!(
            time_since_last >= oracle_data.min_reading_interval as i64,
            OracleError::RateLimitExceeded
        );
    }
    
    Ok(())
}
```

**Configuration:**
| Parameter | Default | Purpose |
|-----------|---------|---------|
| `min_reading_interval` | 60 seconds | Prevent spam |
| `max_age` | 3600 seconds | Reject stale data |
| `future_tolerance` | 60 seconds | Handle clock skew |

---

## 5. Data Validation

### 5.1 Range Validation

```rust
pub fn validate_range(
    oracle_data: &OracleData,
    energy_produced: u64,
    energy_consumed: u64,
) -> Result<()> {
    // Production within bounds
    require!(
        energy_produced >= oracle_data.min_energy_value &&
        energy_produced <= oracle_data.max_energy_value,
        OracleError::ProductionOutOfRange
    );
    
    // Consumption within bounds
    require!(
        energy_consumed >= oracle_data.min_energy_value &&
        energy_consumed <= oracle_data.max_energy_value,
        OracleError::ConsumptionOutOfRange
    );
    
    Ok(())
}
```

**Default Bounds:**
| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `min_energy_value` | 0 | Allow zero readings |
| `max_energy_value` | 1,000,000 kWh | Prevent overflow attacks |

### 5.2 Anomaly Detection

```rust
pub fn detect_anomaly(
    oracle_data: &OracleData,
    energy_produced: u64,
    energy_consumed: u64,
) -> Result<()> {
    // Skip if anomaly detection is disabled
    if oracle_data.anomaly_detection_enabled != 1 {
        return Ok(());
    }
    
    // Check production/consumption ratio
    // Solar panels typically produce 3-10x their consumption
    // Allow up to 10x ratio
    if energy_consumed > 0 {
        let ratio = energy_produced.saturating_mul(100) / energy_consumed;
        require!(
            ratio <= 1000, // 10x
            OracleError::AnomalousRatio
        );
    }
    
    // Check deviation from previous reading
    if oracle_data.last_energy_produced > 0 {
        let deviation = calculate_deviation(
            oracle_data.last_energy_produced,
            energy_produced,
        );
        
        require!(
            deviation <= oracle_data.max_reading_deviation_percent as u64,
            OracleError::ExcessiveDeviation
        );
    }
    
    Ok(())
}

fn calculate_deviation(previous: u64, current: u64) -> u64 {
    let diff = if current > previous {
        current - previous
    } else {
        previous - current
    };
    
    (diff.saturating_mul(100)) / previous
}
```

**Anomaly Thresholds:**
| Check | Threshold | Action |
|-------|-----------|--------|
| Production/Consumption ratio | 10:1 | Reject |
| Reading-to-reading deviation | 50% | Reject |
| Zero production (solar, daytime) | Configurable | Warning |

---

## 6. Backup Oracle Consensus

### 6.1 Byzantine Fault Tolerance

The system supports up to 10 backup oracles with configurable consensus threshold:

```rust
// BFT consensus: f = (n-1)/3 faults tolerated
// With 10 oracles, can tolerate 3 Byzantine nodes
// Requiring 7 honest nodes for consensus

pub struct OracleData {
    // ...
    pub backup_oracles: [Pubkey; 10],     // Backup oracle addresses
    pub backup_oracles_count: u8,         // Active backup count
    pub consensus_threshold: u8,          // Required confirmations
    pub require_consensus: u8,            // Enable consensus mode
}
```

### 6.2 Consensus Flow

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    BACKUP ORACLE CONSENSUS FLOW                          │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Step 1: Primary Oracle Submits Reading                                  │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Primary: submit_meter_reading(meter_id, produced, consumed)    │    │
│  │  Result: Reading marked as PENDING_CONSENSUS                     │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                              │                                           │
│                              ▼                                           │
│  Step 2: Backup Oracles Confirm (off-chain coordination)                │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Backup #1: confirm_reading(reading_id, produced, consumed) ✓   │    │
│  │  Backup #2: confirm_reading(reading_id, produced, consumed) ✓   │    │
│  │  Backup #3: (offline)                                    ✗      │    │
│  │  Backup #4: confirm_reading(reading_id, produced, consumed) ✓   │    │
│  │                                                                 │    │
│  │  Confirmations: 3/2 required ✓                                  │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                              │                                           │
│                              ▼                                           │
│  Step 3: Finalize Reading                                               │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  finalize_reading(reading_id)                                   │    │
│  │  - Verify consensus threshold met                               │    │
│  │  - Mark reading as CONFIRMED                                    │    │
│  │  - Update oracle statistics                                     │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### 6.3 Consensus Implementation

```rust
#[account]
pub struct PendingReading {
    pub reading_id: u64,
    pub meter_id: [u8; 32],
    pub energy_produced: u64,
    pub energy_consumed: u64,
    pub submitted_by: Pubkey,
    pub submitted_at: i64,
    pub confirmations: [Confirmation; 10],
    pub confirmation_count: u8,
    pub status: ReadingStatus,
}

#[derive(Clone, Copy, Default)]
pub struct Confirmation {
    pub oracle: Pubkey,
    pub confirmed_at: i64,
    pub agrees: bool,  // true = confirms values, false = disputes
}

pub fn process_confirm_reading(
    ctx: Context<ConfirmReading>,
    reading_id: u64,
    produced: u64,
    consumed: u64,
) -> Result<()> {
    let oracle_data = ctx.accounts.oracle_data.load()?;
    let pending = &mut ctx.accounts.pending_reading;
    
    // Verify caller is a backup oracle
    let caller = ctx.accounts.authority.key();
    let oracle_idx = oracle_data.backup_oracles
        .iter()
        .position(|o| *o == caller)
        .ok_or(OracleError::NotBackupOracle)?;
    
    // Prevent double confirmation
    require!(
        !pending.confirmations.iter()
            .any(|c| c.oracle == caller),
        OracleError::AlreadyConfirmed
    );
    
    // Check if values match
    let agrees = produced == pending.energy_produced &&
                 consumed == pending.energy_consumed;
    
    // Record confirmation
    let idx = pending.confirmation_count as usize;
    pending.confirmations[idx] = Confirmation {
        oracle: caller,
        confirmed_at: Clock::get()?.unix_timestamp,
        agrees,
    };
    pending.confirmation_count += 1;
    
    emit!(ReadingConfirmed {
        reading_id,
        oracle: caller,
        agrees,
        confirmation_count: pending.confirmation_count,
    });
    
    Ok(())
}

pub fn process_finalize_reading(
    ctx: Context<FinalizeReading>,
    reading_id: u64,
) -> Result<()> {
    let oracle_data = ctx.accounts.oracle_data.load()?;
    let pending = &mut ctx.accounts.pending_reading;
    
    // Count agreeing confirmations
    let agreements = pending.confirmations
        .iter()
        .filter(|c| c.agrees && c.oracle != Pubkey::default())
        .count();
    
    require!(
        agreements as u8 >= oracle_data.consensus_threshold,
        OracleError::InsufficientConsensus
    );
    
    pending.status = ReadingStatus::Confirmed;
    
    // Forward to registry for settlement
    // ... CPI to registry program
    
    emit!(ReadingFinalized {
        reading_id,
        agreements: agreements as u8,
        timestamp: Clock::get()?.unix_timestamp,
    });
    
    Ok(())
}
```

---

## 7. Quality Scoring

### 7.1 Oracle Reliability Metric

```rust
pub fn update_quality_score(
    oracle_data: &mut OracleData,
    is_valid: bool,
) {
    // Update counters
    oracle_data.total_readings += 1;
    if is_valid {
        oracle_data.total_valid_readings += 1;
    } else {
        oracle_data.total_rejected_readings += 1;
    }
    
    // Calculate score (0-100)
    let total = oracle_data.total_valid_readings + 
                oracle_data.total_rejected_readings;
    
    if total > 0 {
        let score = (oracle_data.total_valid_readings * 100) / total;
        oracle_data.last_quality_score = score as u8;
    }
    
    oracle_data.quality_score_updated_at = Clock::get()?.unix_timestamp;
}
```

### 7.2 Quality Score Actions

| Score | Status | Action |
|-------|--------|--------|
| 90-100 | Excellent | Normal operation |
| 70-89 | Good | Increased monitoring |
| 50-69 | Warning | Alert admin, consider backup |
| <50 | Critical | Pause primary, failover to backup |

```rust
pub fn check_quality_threshold(
    oracle_data: &OracleData,
) -> Result<()> {
    const CRITICAL_THRESHOLD: u8 = 50;
    
    if oracle_data.last_quality_score < CRITICAL_THRESHOLD {
        emit!(OracleQualityAlert {
            score: oracle_data.last_quality_score,
            total_readings: oracle_data.total_readings,
            rejected: oracle_data.total_rejected_readings,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        // In production: trigger automatic failover
        // return Err(OracleError::QualityBelowThreshold.into());
    }
    
    Ok(())
}
```

---

## 8. Emergency Controls

### 8.1 Oracle Pause

```rust
pub fn process_update_oracle_status(
    ctx: Context<UpdateOracleStatus>,
    active: bool,
) -> Result<()> {
    let oracle_data = &mut ctx.accounts.oracle_data.load_mut()?;
    
    // Only admin can pause/unpause
    require!(
        ctx.accounts.authority.key() == oracle_data.authority,
        OracleError::UnauthorizedAuthority
    );
    
    let was_active = oracle_data.active == 1;
    oracle_data.active = if active { 1 } else { 0 };
    
    emit!(OracleStatusUpdated {
        was_active,
        is_active: active,
        updated_by: ctx.accounts.authority.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });
    
    Ok(())
}
```

### 8.2 Emergency Scenarios

| Scenario | Detection | Response |
|----------|-----------|----------|
| Gateway compromise | Anomaly spike | Pause oracle, rotate key |
| DDoS attack | Rate limit hits | Temporary pause, increase limits |
| Data corruption | Validation failures | Roll back, investigate |
| Guardian offline | Consensus timeout | Reduce threshold, alert |

---

## 9. Audit Trail

### 9.1 Event Logging

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
pub struct MeterReadingRejected {
    pub meter_id: String,
    pub reason: String,
    pub timestamp: i64,
    pub submitter: Pubkey,
}

#[event]
pub struct OracleStatusUpdated {
    pub was_active: bool,
    pub is_active: bool,
    pub updated_by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct ApiGatewayUpdated {
    pub old_gateway: Pubkey,
    pub new_gateway: Pubkey,
    pub updated_by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct OracleQualityAlert {
    pub score: u8,
    pub total_readings: u64,
    pub rejected: u64,
    pub timestamp: i64,
}
```

### 9.2 Compliance Reporting

```typescript
// Event indexing for compliance reports
async function generateOracleAuditReport(
  startDate: Date,
  endDate: Date,
): Promise<AuditReport> {
  const events = await fetchEvents(
    program,
    ['MeterReadingSubmitted', 'MeterReadingRejected', 'OracleStatusUpdated'],
    startDate,
    endDate,
  );
  
  return {
    totalReadings: events.filter(e => e.name === 'MeterReadingSubmitted').length,
    rejectedReadings: events.filter(e => e.name === 'MeterReadingRejected').length,
    statusChanges: events.filter(e => e.name === 'OracleStatusUpdated'),
    qualityScore: calculateAverageQuality(events),
    anomalies: detectAnomalousPatterns(events),
  };
}
```

---

## 10. Security Configuration

### 10.1 Recommended Settings

| Parameter | Production | Development | Rationale |
|-----------|------------|-------------|-----------|
| `min_reading_interval` | 60s | 5s | Spam prevention |
| `max_reading_deviation_percent` | 30% | 100% | Anomaly sensitivity |
| `anomaly_detection_enabled` | true | false | Strict validation |
| `require_consensus` | true | false | BFT security |
| `consensus_threshold` | 3 | 1 | f = (n-1)/3 |
| `backup_oracles_count` | 5+ | 1 | Redundancy |

### 10.2 Security Hardening Checklist

```
✅ API Gateway
   □ Hardware security module (HSM) for key storage
   □ TLS 1.3 for all communications
   □ IP whitelisting for meter connections
   □ Rate limiting at application layer

✅ Oracle Program
   □ All instructions require authorization
   □ Monotonic timestamp enforcement
   □ Range validation on all inputs
   □ Anomaly detection enabled
   □ Quality scoring active

✅ Backup System
   □ Geographically distributed backups
   □ Independent infrastructure
   □ Regular failover testing
   □ Consensus threshold configured

✅ Monitoring
   □ Real-time event streaming
   □ Quality score alerting
   □ Anomaly detection alerts
   □ Admin action logging
```

---

## 11. Compute Unit Profile

| Operation | CU Cost | Security Checks |
|-----------|---------|-----------------|
| `submit_meter_reading` | ~12,000 | Auth, temporal, range, anomaly |
| `confirm_reading` | ~8,000 | Backup auth, duplicate check |
| `finalize_reading` | ~15,000 | Consensus verification |
| `update_oracle_status` | ~5,000 | Admin auth |
| Quality score update | ~1,000 | Internal calculation |

---

## 12. Future Enhancements

1. **Zero-Knowledge Proofs**: Verify readings without revealing exact values
2. **Decentralized Oracle Network**: Full DAO governance of oracle set
3. **Economic Incentives**: Slashing for malicious oracles
4. **Hardware Attestation**: TEE integration for meter authentication
5. **ML Anomaly Detection**: On-chain lightweight anomaly scoring

---

## 13. References

1. Chainlink. "Decentralized Oracle Networks"
2. Castro, M. & Liskov, B. (1999). "Practical Byzantine Fault Tolerance"
3. Solana. "Clock Sysvar and Timestamp Handling"
4. NIST. "Smart Grid Cybersecurity Guidelines"
