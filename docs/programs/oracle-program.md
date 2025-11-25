# Oracle Program Documentation

## Overview

The Oracle Program serves as the trusted data gateway for the GridTokenX energy trading system. It acts as a bridge between off-chain Advanced Metering Infrastructure (AMI) smart meters and the on-chain Solana blockchain, ensuring secure and validated energy reading submissions.

## Purpose

The Oracle Program fulfills several critical roles:

1. **Data Gateway**: Provides a secure entry point for AMI meter readings into the blockchain
2. **Validation Engine**: Validates and sanitizes energy readings before they're recorded on-chain
3. **Quality Assurance**: Maintains quality metrics and scoring for data reliability
4. **Market Trigger**: Initiates market clearing processes based on submitted readings
5. **Access Control**: Ensures only authorized API Gateway can submit readings

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Oracle Program Architecture                 │
└─────────────────────────────────────────────────────────────────┘

External World                Blockchain (Oracle Program)
┌──────────────┐             ┌────────────────────────────────┐
│              │             │                                │
│ Smart Meters │────────────▶│  API Gateway Authority         │
│ (AMI System) │   Readings  │  (Authorized Signer)           │
│              │             │         │                      │
└──────────────┘             │         ▼                      │
                             │  ┌──────────────────┐          │
                             │  │ Submit Reading   │          │
                             │  │  Validation      │          │
                             │  └────────┬─────────┘          │
                             │           │                    │
                             │           ▼                    │
                             │  ┌──────────────────┐          │
                             │  │  Oracle Data     │◀─────────┼──── Admin
                             │  │  - Status        │  Update  │     Functions
                             │  │  - Config        │          │
                             │  │  - Quality Score │          │
                             │  └────────┬─────────┘          │
                             │           │                    │
                             │           ▼                    │
                             │  ┌──────────────────┐          │
                             │  │ Reading History  │          │
                             │  │ (Last 10 reads)  │          │
                             │  └──────────────────┘          │
                             │                                │
                             └────────────────────────────────┘
```

## Core Components

### 1. Oracle Data Account

The central state account that stores oracle configuration and operational metrics:

**Key Responsibilities:**
- Track authorized API Gateway address
- Maintain oracle operational status (active/inactive)
- Store validation configuration parameters
- Record quality metrics and reliability scores
- Manage backup oracle addresses for redundancy

**Quality Metrics Tracked:**
- Total submissions received
- Valid submissions count
- Invalid submissions count
- Quality score (calculated percentage)
- Last submission timestamp

### 2. Validation Configuration

Defines the rules and thresholds for validating energy readings:

**Validation Parameters:**
- Maximum energy per reading (prevents unrealistic values)
- Minimum reading interval (prevents spam submissions)
- Maximum future timestamp tolerance
- Maximum historical timestamp tolerance

**Purpose:** Ensures data integrity by rejecting readings that fall outside acceptable ranges.

### 3. Reading History

Maintains a rolling history of the most recent submissions:

**Tracking Details:**
- Stores last 10 meter readings
- Records meter ID, energy values, and timestamps
- Enables trend analysis and anomaly detection
- Supports data quality auditing

## Data Flow

### Meter Reading Submission Flow

```
┌─────────────────────────────────────────────────────────────────┐
│               Meter Reading Submission Process                   │
└─────────────────────────────────────────────────────────────────┘

    API Gateway                    Oracle Program
         │                              │
         │   1. Submit Reading          │
         ├─────────────────────────────▶│
         │   (meter_id, energy_prod,    │
         │    energy_cons, timestamp)   │
         │                              │
         │                              ▼
         │                    ┌──────────────────┐
         │                    │ Verify Signer    │
         │                    │ = API Gateway?   │
         │                    └────────┬─────────┘
         │                             │
         │                             ▼
         │                    ┌──────────────────┐
         │                    │ Validate Reading │
         │                    │ - Range check    │
         │                    │ - Timestamp OK?  │
         │                    │ - Energy values? │
         │                    └────────┬─────────┘
         │                             │
         │                    ┌────────▼─────────┐
         │                    │ Update History   │
         │                    │ Add to last 10   │
         │                    └────────┬─────────┘
         │                             │
         │                    ┌────────▼─────────┐
         │                    │ Update Quality   │
         │                    │ Score (valid/    │
         │                    │ total ratio)     │
         │                    └────────┬─────────┘
         │                             │
         │                    ┌────────▼─────────┐
         │                    │ Emit Event       │
         │   ◀────────────────┤ MeterReading     │
         │   Success          │ Submitted        │
         │                    └──────────────────┘
```

### Market Clearing Trigger Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                 Market Clearing Trigger Process                  │
└─────────────────────────────────────────────────────────────────┘

    API Gateway                    Oracle Program
         │                              │
         │   Trigger Market Clearing    │
         ├─────────────────────────────▶│
         │                              │
         │                              ▼
         │                    ┌──────────────────┐
         │                    │ Verify Signer    │
         │                    │ = API Gateway?   │
         │                    └────────┬─────────┘
         │                             │
         │                    ┌────────▼─────────┐
         │                    │ Check Oracle     │
         │                    │ is Active?       │
         │                    └────────┬─────────┘
         │                             │
         │                    ┌────────▼─────────┐
         │                    │ Emit Event       │
         │   ◀────────────────┤ MarketClearing   │
         │   Event Signal     │ Triggered        │
         │                    └──────────────────┘
         │                             │
         ▼                             ▼
    ┌──────────────┐        ┌──────────────────┐
    │ Off-chain    │        │ Other programs   │
    │ Services     │        │ listen for       │
    │ trigger      │        │ this event       │
    │ matching     │        │ (Trading, etc.)  │
    └──────────────┘        └──────────────────┘
```

## Instructions

### User Instructions

#### 1. Initialize
**Purpose:** Sets up the Oracle Program for the first time

**Parameters:**
- `api_gateway`: Public key of the authorized API Gateway

**Accounts Required:**
- Oracle Data (to be created)
- Validation Config (to be created)
- Reading History (to be created)
- Quality Metrics (to be created)
- Admin authority (signer, payer)

**Process:**
- Creates all required program data accounts
- Sets API Gateway as authorized submitter
- Initializes validation rules with default values
- Sets oracle status to active

#### 2. Submit Meter Reading
**Purpose:** Records energy production/consumption data from smart meters

**Authority Required:** API Gateway only

**Parameters:**
- `meter_id`: Unique identifier for the smart meter
- `energy_produced`: kWh of energy generated (for prosumers)
- `energy_consumed`: kWh of energy consumed
- `reading_timestamp`: Unix timestamp of the meter reading

**Validation Checks:**
- Caller must be authorized API Gateway
- Oracle must be in active status
- Energy values within configured max limits
- Timestamp within acceptable range (not too old or future)

**On Success:**
- Reading added to history
- Quality score updated
- Event emitted for downstream processing

#### 3. Trigger Market Clearing
**Purpose:** Signals that market clearing process should begin

**Authority Required:** API Gateway only

**Process:**
- Verifies oracle is active
- Emits MarketClearingTriggered event
- Off-chain services and other programs can respond to this signal

### Admin Instructions

#### 4. Update Oracle Status
**Purpose:** Enable or disable the oracle

**Authority Required:** Admin only

**Parameters:**
- `active`: Boolean (true = active, false = inactive)

**Use Cases:**
- Emergency shutdown
- Maintenance mode
- System upgrades

#### 5. Update API Gateway
**Purpose:** Change the authorized API Gateway address

**Authority Required:** Admin only

**Parameters:**
- `new_api_gateway`: Public key of new API Gateway

**Use Cases:**
- Gateway rotation for security
- Upgrading gateway infrastructure
- Disaster recovery

#### 6. Update Validation Config
**Purpose:** Adjust validation rules and thresholds

**Authority Required:** Admin only

**Parameters:**
- Complete ValidationConfig struct with updated values

**Configurable Settings:**
- Maximum energy per reading
- Minimum reading interval
- Timestamp tolerance windows

#### 7. Add Backup Oracle
**Purpose:** Register a backup oracle for redundancy

**Authority Required:** Admin only

**Parameters:**
- `backup_oracle`: Public key of backup oracle

**Purpose:** Ensures system resilience with failover capability

## Events

### MeterReadingSubmitted
Emitted when a meter reading is successfully recorded

**Data Included:**
- Meter ID
- Energy produced and consumed
- Reading timestamp
- Submission timestamp

### MarketClearingTriggered
Emitted when market clearing is initiated

**Data Included:**
- Trigger timestamp
- Oracle address

### OracleStatusUpdated
Emitted when oracle status changes

**Data Included:**
- Previous status
- New status
- Update timestamp

### ApiGatewayUpdated
Emitted when API Gateway address is changed

**Data Included:**
- Old API Gateway address
- New API Gateway address

### ValidationConfigUpdated
Emitted when validation rules are updated

**Data Included:**
- New configuration parameters

## Security Model

### Access Control Hierarchy

```
┌─────────────────────────────────────────────────────────────────┐
│                    Oracle Access Control                         │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────────┐
│   Admin Authority    │  ← Full control over configuration
│   (Initial deployer) │     and operational status
└──────────┬───────────┘
           │
           │ Can configure
           ▼
┌──────────────────────┐
│   API Gateway        │  ← Authorized to submit readings
│   (Single authority) │     and trigger market clearing
└──────────┬───────────┘
           │
           │ Submits data from
           ▼
┌──────────────────────┐
│   Smart Meters       │  ← External data sources
│   (Off-chain)        │     (not direct blockchain access)
└──────────────────────┘
```

### Validation Layers

**Layer 1: Authority Verification**
- Only API Gateway can submit readings
- Only Admin can modify configuration

**Layer 2: Data Validation**
- Energy values must be within realistic ranges
- Timestamps must be recent and reasonable
- Meter IDs must follow expected format (Base64)

**Layer 3: State Validation**
- Oracle must be active to accept readings
- Quality metrics must be updated atomically
- History must maintain correct ordering

## Integration Points

### With Smart Meters (Off-chain)
- Smart meters send readings to API Gateway
- API Gateway processes and authenticates readings
- API Gateway calls Oracle Program's submit_meter_reading

### With Trading Program
- Oracle emits market clearing trigger events
- Trading program listens for these events
- Triggers matching engine and settlement processes

### With Registry Program
- Readings reference meters registered in Registry
- Oracle validates meter existence through Registry
- Energy data used for REC (Renewable Energy Certificate) issuance

## Best Practices

### For Operators

1. **Regular Monitoring:**
   - Track quality score metrics
   - Monitor submission success rates
   - Watch for validation failures

2. **Configuration Tuning:**
   - Adjust validation thresholds based on actual meter behavior
   - Set appropriate interval minimums to prevent spam
   - Configure timestamp tolerances for network latency

3. **Security Maintenance:**
   - Rotate API Gateway keys periodically
   - Maintain backup oracle configuration
   - Test emergency shutdown procedures

### For Developers

1. **Error Handling:**
   - Handle validation errors gracefully in API Gateway
   - Log all submission attempts for auditing
   - Implement retry logic with exponential backoff

2. **Event Monitoring:**
   - Subscribe to Oracle events for real-time tracking
   - Build dashboards around quality metrics
   - Alert on quality score degradation

3. **Testing:**
   - Test with realistic meter data ranges
   - Verify timestamp handling across time zones
   - Simulate network delays and clock skew

## Limitations and Considerations

### Current Limitations:

1. **Single API Gateway:**
   - Only one authorized gateway at a time
   - Backup oracles are registered but not automatically activated
   - Manual intervention required for failover

2. **History Size:**
   - Limited to 10 most recent readings per oracle
   - Older data must be stored off-chain
   - No built-in archival mechanism

3. **No Meter-Specific Validation:**
   - Same validation rules apply to all meters
   - Cannot customize thresholds per meter type
   - No meter-specific quality tracking

### Design Considerations:

1. **Centralization Trade-off:**
   - Single API Gateway provides clear authority
   - Reduces attack surface
   - Simplifies key management
   - But creates single point of failure

2. **On-chain vs Off-chain:**
   - Minimal data stored on-chain (cost optimization)
   - Detailed historical data should be in off-chain database
   - Events provide audit trail without bloating storage

3. **Quality Scoring:**
   - Simple valid/total ratio
   - Could be enhanced with weighted factors
   - Consider time-decay for old invalid submissions

## Future Enhancements

Potential improvements for future versions:

1. **Multi-Oracle Support:**
   - Multiple authorized oracles with quorum consensus
   - Automatic failover to backup oracles
   - Oracle reputation system

2. **Advanced Validation:**
   - Per-meter type validation rules
   - Statistical anomaly detection
   - Machine learning-based outlier identification

3. **Performance Optimizations:**
   - Batch reading submissions
   - Compressed data formats
   - Zero-knowledge proofs for sensitive meter data

4. **Integration Features:**
   - Direct integration with popular AMI platforms
   - Support for multiple market clearing strategies
   - Real-time meter status monitoring
