# Governance Program Documentation

## Overview

The Governance Program implements a Proof of Authority (PoA) governance model for the GridTokenX ecosystem, with a focus on Energy Renewable Certificate (ERC) issuance and validation. It provides centralized authority for certification while maintaining transparency and auditability through blockchain records.

## Purpose

The Governance Program fulfills critical certification and control functions:

1. **ERC Certification**: Issue Energy Renewable Certificates for renewable energy
2. **Authority Management**: Maintain single authority (REC certifying entity)
3. **Renewable Verification**: Validate that traded energy comes from renewable sources
4. **Emergency Controls**: Provide system-wide pause/unpause capabilities
5. **Governance Configuration**: Manage ERC issuance rules and limits
6. **Audit Trail**: Maintain transparent record of all certifications

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                 Governance Program Architecture                  │
└─────────────────────────────────────────────────────────────────┘

Authority                 Governance Program              Other Programs
┌──────────────┐         ┌────────────────┐              ┌──────────┐
│              │         │                │              │          │
│ REC          │─Config─▶│  PoA Config    │              │          │
│ Authority    │         │  - Authority   │              │          │
│ (Certifier)  │         │  - Rules       │              │          │
│              │         │  - Stats       │              │          │
└──────┬───────┘         └───────┬────────┘              │          │
       │                         │                       │          │
       │ Issue ERC              │                       │          │
       │                         │                       │          │
       ▼                 ┌───────▼────────┐              │          │
┌──────────────┐         │ ERC Certificate│              │  Trading │
│ Renewable     │────────▶│  - ID          │◀────Verify───│  Program │
│ Energy Source │  Claim  │  - Amount      │    Before   │          │
│ (Meter)       │         │  - Source      │    Trading  │          │
└──────────────┘         │  - Status      │              └──────────┘
                         │  - Validation  │
                         └───────┬────────┘
                                 │
                        ┌────────▼────────┐
                        │  Anti-Double    │
                        │  Claim Logic    │
                        │  - Track claimed│
                        │  - Prevent reuse│
                        └─────────────────┘
```

## Core Components

### 1. PoA Configuration Account

The central governance configuration controlling the entire system:

**Authority Configuration:**
- Authority public key (REC certifying entity)
- Authority name (e.g., "REC" or organization name)
- Contact information
- Governance version number

**Emergency Controls:**
- Emergency paused flag
- Emergency timestamp (when paused)
- Emergency reason (explanation)
- Maintenance mode flag

**ERC Certificate Configuration:**
- ERC validation enabled/disabled
- Minimum energy amount for issuance (kWh)
- Maximum ERC amount per certificate (kWh)
- Certificate validity period (seconds)
- Auto-revoke expired certificates flag
- Require oracle validation flag

**Advanced Features:**
- Delegation enabled (future: sub-authorities)
- Oracle authority for AMI validation
- Minimum oracle confidence score (0-100)
- Allow certificate transfers flag

**Statistics & Tracking:**
- Total ERCs issued (lifetime count)
- Total ERCs validated for trading
- Total ERCs revoked
- Total energy certified (lifetime kWh)

**Timestamps:**
- Created at
- Last updated
- Last ERC issued timestamp

### 2. ERC Certificate Account

Individual certificate for renewable energy:

**Certificate Identity:**
- Certificate ID (unique identifier)
- Authority who issued it
- Energy amount (kWh)
- Renewable source (Solar, Wind, etc.)
- Validation data (metadata, proof)

**Certificate Lifecycle:**
- Issued timestamp
- Expires timestamp
- Current status (Valid, Expired, Revoked, Pending)
- Validated for trading flag
- Trading validation timestamp

**Purpose:** Proves that specific energy amount came from renewable sources, enabling green energy trading.

### 3. Meter Account (from Registry)

Referenced for anti-double-claiming:

**Claimed Tracking:**
- `claimed_erc_generation`: Total kWh already certified
- Prevents issuing multiple ERCs for same energy

**Integration:** Governance reads and updates this field in Registry program's meter accounts.

## Data Flow

### PoA Initialization Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                  PoA Initialization Process                      │
└─────────────────────────────────────────────────────────────────┘

  REC Authority            Governance Program
       │                           │
       │  Initialize PoA           │
       ├──────────────────────────▶│
       │                           │
       │                ┌──────────▼──────────┐
       │                │ Create PoA Config   │
       │                │ - Set authority     │
       │                │ - Name = "REC"      │
       │                │ - Default limits    │
       │                │ - Enable validation │
       │                └──────────┬──────────┘
       │                           │
       │                ┌──────────▼──────────┐
       │                │ Set Default Config  │
       │                │ - Min: 1 kWh        │
       │                │ - Max: 1M kWh       │
       │                │ - Validity: 1 year  │
       │                │ - Auto-revoke: true │
       │                └──────────┬──────────┘
       │                           │
       │  ◀─────────────────────────┤
       │  PoA Initialized Event     │
       │                           │
```

### ERC Issuance Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    ERC Issuance Process                          │
└─────────────────────────────────────────────────────────────────┘

REC Authority         Governance Program         Registry Program
      │                      │                          │
      │  Issue ERC           │                          │
      ├─────────────────────▶│                          │
      │  (certificate_id,    │                          │
      │   energy_amount,     │                          │
      │   renewable_source,  │                          │
      │   validation_data)   │                          │
      │                      │                          │
      │           ┌──────────▼──────────┐               │
      │           │ Verify Authority    │               │
      │           │ (only REC can issue)│               │
      │           └──────────┬──────────┘               │
      │                      │                          │
      │           ┌──────────▼──────────┐               │
      │           │ Check System Status │               │
      │           │ - Not paused?       │               │
      │           │ - Not maintenance?  │               │
      │           │ - Validation enabled│               │
      │           └──────────┬──────────┘               │
      │                      │                          │
      │           ┌──────────▼──────────┐               │
      │           │ Validate Parameters │               │
      │           │ - Amount ≥ min?     │               │
      │           │ - Amount ≤ max?     │               │
      │           │ - Valid source?     │               │
      │           └──────────┬──────────┘               │
      │                      │                          │
      │                      │  Load Meter Account      │
      │                      ├─────────────────────────▶│
      │                      │                          │
      │                      │  Return Meter Data       │
      │                      │◀─────────────────────────┤
      │                      │                          │
      │           ┌──────────▼──────────┐               │
      │           │ Anti-Double-Claim   │               │
      │           │ Check:              │               │
      │           │ available =         │               │
      │           │   meter.net_gen -   │               │
      │           │   meter.claimed_erc │               │
      │           │                     │               │
      │           │ Require:            │               │
      │           │ available ≥ amount  │               │
      │           └──────────┬──────────┘               │
      │                      │                          │
      │           ┌──────────▼──────────┐               │
      │           │ Create ERC Cert     │               │
      │           │ - Set ID            │               │
      │           │ - Record amount     │               │
      │           │ - Set source        │               │
      │           │ - Status = Valid    │               │
      │           │ - Calculate expiry  │               │
      │           └──────────┬──────────┘               │
      │                      │                          │
      │                      │  Update Meter Claimed    │
      │                      ├─────────────────────────▶│
      │                      │  claimed_erc += amount   │
      │                      │                          │
      │           ┌──────────▼──────────┐               │
      │           │ Update PoA Stats    │               │
      │           │ - total_issued++    │               │
      │           │ - total_energy +=   │               │
      │           │ - last_issued_at    │               │
      │           └──────────┬──────────┘               │
      │                      │                          │
      │  ◀───────────────────┤                          │
      │  ERC Issued Event    │                          │
      │  (cert_id, amount,   │                          │
      │   source, expires)   │                          │
      │                      │                          │
```

### Trading Validation Flow

```
┌─────────────────────────────────────────────────────────────────┐
│               ERC Trading Validation Process                     │
└─────────────────────────────────────────────────────────────────┘

Trading Program         Governance Program
      │                        │
      │  Create Sell Order     │
      │  (references ERC_ID)   │
      ├───────────────────────▶│
      │                        │
      │             ┌──────────▼──────────┐
      │             │ Load ERC Certificate│
      │             │ from PDA            │
      │             └──────────┬──────────┘
      │                        │
      │             ┌──────────▼──────────┐
      │             │ Validate ERC Status │
      │             │ - Status == Valid?  │
      │             │ - Not expired?      │
      │             │ - Amount sufficient?│
      │             └──────────┬──────────┘
      │                        │
      │  ◀──────────────────────┤
      │  Validation Result      │
      │  (Accept/Reject order)  │
      │                        │
      │                        │
      │  Validate for Trading  │
      │  (REC marks as valid)  │
      ├───────────────────────▶│
      │                        │
      │             ┌──────────▼──────────┐
      │             │ Verify Authority    │
      │             │ (only REC can do)   │
      │             └──────────┬──────────┘
      │                        │
      │             ┌──────────▼──────────┐
      │             │ Mark ERC as:        │
      │             │ validated_for_      │
      │             │ trading = true      │
      │             │ Set timestamp       │
      │             └──────────┬──────────┘
      │                        │
      │             ┌──────────▼──────────┐
      │             │ Update Stats        │
      │             │ total_validated++   │
      │             └──────────┬──────────┘
      │                        │
      │  ◀──────────────────────┤
      │  ERC Validated Event    │
      │                        │
```

### Emergency Control Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    Emergency Pause Process                       │
└─────────────────────────────────────────────────────────────────┘

REC Authority         Governance Program
      │                      │
      │  Emergency Pause     │
      ├─────────────────────▶│
      │                      │
      │           ┌──────────▼──────────┐
      │           │ Verify Authority    │
      │           │ (only REC can pause)│
      │           └──────────┬──────────┘
      │                      │
      │           ┌──────────▼──────────┐
      │           │ Set Flags:          │
      │           │ emergency_paused =  │
      │           │   true              │
      │           │ emergency_timestamp │
      │           │ emergency_reason    │
      │           └──────────┬──────────┘
      │                      │
      │  ◀───────────────────┤
      │  System Paused Event │
      │                      │
      │                      │
      ▼                      ▼
┌──────────────────────────────────────┐
│  All ERC issuance operations         │
│  are now BLOCKED until unpause       │
└──────────────────────────────────────┘
```

## Instructions

### Initialization

#### 1. Initialize PoA
**Purpose:** Set up governance for the first time

**Authority:** Deployer becomes REC Authority

**Process:**
- Creates PoA Config account with PDA
- Sets authority to initializer
- Configures default ERC parameters:
  - Min energy: 1 kWh
  - Max energy: 1,000,000 kWh
  - Validity: 31,536,000 seconds (1 year)
- Enables ERC validation
- Initializes all counters to zero

**PDA Derivation:**
```
PoA Config PDA = derive[
  seeds: ["poa_config"],
  program: governance_program_id
]
```

### Emergency Controls

#### 2. Emergency Pause
**Purpose:** Immediately halt all ERC issuance

**Authority Required:** REC Authority only

**Use Cases:**
- Security incident detected
- System compromise suspected
- Critical bug discovered
- Regulatory compliance requirement

**Effects:**
- Sets `emergency_paused = true`
- Records timestamp and reason
- Blocks all `issue_erc` calls
- Does NOT affect existing certificates
- Does NOT block validation or queries

**On Success:**
- SystemPaused event emitted
- All issuance operations fail with error

#### 3. Emergency Unpause
**Purpose:** Resume normal operations

**Authority Required:** REC Authority only

**Process:**
- Sets `emergency_paused = false`
- Clears emergency timestamp and reason
- Resumes ERC issuance

**Validation:**
- Must currently be paused
- Only authority can unpause

**On Success:**
- SystemUnpaused event emitted
- Issuance operations resume

### ERC Certificate Management

#### 4. Issue ERC
**Purpose:** Create renewable energy certificate

**Authority Required:** REC Authority only

**Parameters:**
- `certificate_id`: Unique identifier (e.g., "SOLAR-2024-001")
- `energy_amount`: kWh to certify
- `renewable_source`: Source type (Solar, Wind, Hydro, etc.)
- `validation_data`: Additional metadata or proof

**Requirements:**
- System must be operational (not paused, not maintenance)
- ERC validation must be enabled
- Energy amount within min/max limits
- Certificate ID must be unique
- Meter must have unclaimed generation

**Anti-Double-Claim Logic:**
```
Step 1: Load meter account from Registry
Step 2: Calculate available energy
  available = meter.net_generation - meter.claimed_erc_generation
  
Step 3: Verify sufficient energy
  require!(available >= energy_amount, "Insufficient unclaimed energy")
  
Step 4: Update claimed tracker
  meter.claimed_erc_generation += energy_amount
  
Step 5: Create ERC certificate
  - Links to meter
  - Records energy amount
  - CANNOT be issued again for same energy
```

**Certificate Expiry:**
```
expires_at = current_timestamp + poa_config.erc_validity_period
```

**On Success:**
- ERC Certificate account created
- Meter's claimed counter updated
- PoA statistics incremented
- ErcIssued event emitted

**PDA Derivation:**
```
ERC Certificate PDA = derive[
  seeds: ["erc_certificate", certificate_id.as_bytes()],
  program: governance_program_id
]
```

#### 5. Validate ERC for Trading
**Purpose:** Mark certificate as approved for trading

**Authority Required:** REC Authority only

**Use Case:**
- Additional approval step before allowing trades
- Verify certificate authenticity
- Check compliance with regulations

**Process:**
- Loads ERC certificate
- Verifies current status is Valid (not Expired/Revoked)
- Sets `validated_for_trading = true`
- Records validation timestamp
- Increments `total_ercs_validated` counter

**On Success:**
- Trading program can accept sell orders with this ERC
- ErcValidatedForTrading event emitted

### Configuration Management

#### 6. Update Governance Config
**Purpose:** Enable or disable ERC validation

**Authority Required:** REC Authority (Engineering Department role)

**Parameters:**
- `erc_validation_enabled`: Boolean

**Use Cases:**
- Temporarily disable ERC requirements for testing
- Enable strict mode for production
- Compliance requirement changes

**Effects:**
- When disabled: ERC issuance blocked
- When enabled: Normal operations resume

#### 7. Set Maintenance Mode
**Purpose:** Signal system maintenance without full pause

**Authority Required:** REC Authority

**Parameters:**
- `maintenance_enabled`: Boolean

**Difference from Emergency Pause:**
- Maintenance is planned, pause is emergency
- Maintenance allows queries, pause blocks everything
- Maintenance can be scheduled, pause is immediate

**Effects:**
- Blocks ERC issuance
- Allows status queries
- Does not affect existing certificates

#### 8. Update ERC Limits
**Purpose:** Adjust certificate size constraints

**Authority Required:** REC Authority

**Parameters:**
- `min_energy_amount`: Minimum kWh per certificate
- `max_erc_amount`: Maximum kWh per certificate
- `erc_validity_period`: Certificate lifetime in seconds

**Validation:**
- Min must be > 0
- Max must be > Min
- Validity period must be > 0 and ≤ 2 years
- Changes apply to new certificates only

**Use Cases:**
- Adjust for market conditions
- Prevent micro-certificates (increase min)
- Prevent mega-certificates (decrease max)
- Extend/shorten validity for compliance

#### 9. Update Authority Info
**Purpose:** Change contact information

**Authority Required:** REC Authority

**Parameters:**
- `contact_info`: String with updated contact details

**Use Cases:**
- Organization rebranding
- Contact person changes
- Updated communication channels

### Statistics

#### 10. Get Governance Stats
**Purpose:** Query current governance metrics

**Authority Required:** Anyone (read-only)

**Returns:** GovernanceStats structure containing:
- Total ERCs issued
- Total ERCs validated for trading
- Total ERCs revoked
- Total energy certified (kWh)
- Current configuration settings
- Feature flags
- Timestamps

**Use Cases:**
- Dashboard displays
- Analytics and reporting
- Compliance audits
- System monitoring

## Events

### PoaInitialized
Emitted when governance is initialized

**Data:**
- Authority public key
- Authority name
- Initialization timestamp

### SystemPaused
Emitted when emergency pause activated

**Data:**
- Pause timestamp
- Pause reason
- Authority who paused

### SystemUnpaused
Emitted when emergency pause lifted

**Data:**
- Unpause timestamp
- Authority who unpaused

### ErcIssued
Emitted when new certificate created

**Data:**
- Certificate ID
- Meter public key
- Energy amount (kWh)
- Renewable source
- Issued timestamp
- Expires timestamp

### ErcValidatedForTrading
Emitted when certificate approved for trading

**Data:**
- Certificate ID
- Validation timestamp
- Authority

### ErcRevoked
Emitted when certificate is revoked (future feature)

**Data:**
- Certificate ID
- Revocation reason
- Revoked timestamp

### GovernanceConfigUpdated
Emitted when configuration changes

**Data:**
- Updated parameters
- Change timestamp
- Authority who updated

## ERC Certificate Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                  ERC Certificate State Machine                   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────┐
│   PENDING   │  ← Initial state (if pending approval implemented)
└──────┬──────┘
       │
       │ REC Authority approves
       │
       ▼
┌─────────────┐
│    VALID    │  ← Normal operational state
└──────┬──────┘    (Can be used for trading)
       │
       │
       ├──────────── Time passes ──────────▶ ┌─────────────┐
       │             (exceeds validity)      │   EXPIRED   │
       │                                     └─────────────┘
       │                                      (No longer valid
       │                                       for trading)
       │
       │
       │──── REC Authority revokes ─────────▶ ┌─────────────┐
              (fraud detected)                 │   REVOKED   │
                                               └─────────────┘
                                                (Permanently
                                                 invalid)

Status Transitions:

1. Pending → Valid: REC approves certificate
2. Valid → Expired: Time exceeds validity period
3. Valid → Revoked: Authority manually revokes
4. Expired → Valid: NOT ALLOWED (must reissue)
5. Revoked → Valid: NOT ALLOWED (permanent)
```

## Security Model

### Access Control Hierarchy

```
┌─────────────────────────────────────────────────────────────────┐
│                 Governance Access Control                        │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────┐
│   REC Authority (Single Entity)      │  ← Full control
│   - Issue ERCs                        │
│   - Validate for trading              │
│   - Emergency pause/unpause           │
│   - Update configuration              │
│   - Update limits                     │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│   Trading Program (Automated)        │  ← Read ERC certificates
│   - Verify ERC status                 │    to validate sell orders
│   - Check expiry                      │
│   - Read validation flag              │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│   Registry Program (Automated)       │  ← Track claimed energy
│   - Update claimed_erc_generation     │    (called by Governance)
│   - Prevent double-claiming           │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│   Anyone (Public)                    │  ← Read-only queries
│   - Get governance stats              │
│   - View ERC certificates             │
│   - Check system status               │
└──────────────────────────────────────┘
```

### Validation Layers

**Layer 1: Authority Verification**
- All write operations require REC Authority signature
- PDA seeds ensure account authenticity
- Prevents unauthorized ERC issuance

**Layer 2: System State Validation**
- Operations blocked if emergency paused
- Maintenance mode prevents new issuance
- ERC validation must be enabled

**Layer 3: Parameter Validation**
- Energy amounts within configured limits
- Certificate IDs must be unique
- Validity period within acceptable range

**Layer 4: Double-Claim Prevention**
- Check meter's unclaimed generation
- Update claimed tracker atomically
- Mathematically impossible to claim twice

**Layer 5: Expiry Management**
- Certificates have defined validity period
- Expired certificates cannot be used for trading
- Optional auto-revoke for expired certs

## Integration Points

### With Registry Program

**Meter Account Integration:**
- Governance reads meter data to validate claims
- Updates `claimed_erc_generation` to prevent double-claiming
- Cross-program invocation (CPI) for atomic updates

**Anti-Double-Claim Flow:**
```
Transaction {
  1. Governance: Check meter.net_gen - meter.claimed_erc ≥ amount
  2. Governance: Create ERC certificate
  3. Governance → Registry CPI: Update meter.claimed_erc += amount
}
All steps atomic (succeed or fail together)
```

### With Trading Program

**Sell Order Validation:**
- Trading loads ERC certificate when creating sell order
- Verifies ERC status is Valid
- Checks ERC energy amount covers sell amount
- Ensures renewable energy authenticity

**Validation Check:**
```
Trading Program creates sell order:
  1. Load ERC certificate by ID
  2. Require ERC.status == Valid
  3. Require current_time < ERC.expires_at
  4. Require ERC.energy_amount ≥ sell_order.amount
  5. If all pass: Allow sell order
  Otherwise: Reject with error
```

### With Oracle Program

**Future Integration:**
- Oracle validates meter readings
- Governance can require oracle confidence threshold
- High-confidence readings eligible for ERC faster
- Automated validation pipeline

## Best Practices

### For REC Authority

**ERC Issuance:**
1. Verify meter data authenticity before issuing
2. Cross-check with off-chain records
3. Use descriptive certificate IDs (include date, type)
4. Document validation data thoroughly
5. Regular audits of issued certificates

**Configuration Management:**
1. Test parameter changes in devnet first
2. Communicate changes to stakeholders
3. Document reasons for configuration updates
4. Monitor impact of limit changes
5. Keep contact information current

**Emergency Procedures:**
1. Have documented criteria for emergency pause
2. Communicate pause reasons promptly
3. Investigate root cause before unpause
4. Test unpause in devnet if possible
5. Document all emergency actions

### For Developers

**Integration:**
1. Always check ERC status before relying on it
2. Handle all ERC status enum values
3. Account for certificate expiry in UX
4. Cache ERC data appropriately
5. Subscribe to governance events

**Error Handling:**
1. Handle InsufficientUnclaimedEnergy gracefully
2. Check system pause status before operations
3. Validate certificate before trading
4. Provide clear error messages to users
5. Log all validation failures

**Testing:**
1. Test with various ERC states
2. Simulate certificate expiry
3. Test double-claim prevention
4. Verify emergency pause works
5. Load test with many certificates

### For Traders

**Understanding ERCs:**
1. Check certificate expiry before creating sell orders
2. Understand renewable source types
3. Verify certificates are validated for trading
4. Monitor certificate status
5. Plan for certificate expiry

## Limitations and Considerations

### Current Limitations

1. **Single Authority:**
   - Only one REC authority
   - No multi-sig or DAO governance
   - Centralized trust model

2. **No Certificate Revocation:**
   - Once issued, cannot be revoked (status change not implemented)
   - No fraud reversal mechanism
   - Permanent records only

3. **No Partial Certificates:**
   - Cannot split certificate into smaller ones
   - Cannot combine multiple certificates
   - Fixed amount per certificate

4. **No Transfer Between Accounts:**
   - Certificates tied to original meter
   - Cannot transfer ownership
   - No secondary certificate market

5. **Simple Expiry:**
   - Only time-based expiry
   - No conditional expiry (e.g., after trade)
   - No renewal mechanism

### Design Considerations

**Centralization vs Efficiency:**
- PoA provides clear authority and fast decisions
- Enables regulatory compliance and accountability
- Trade-off: Trust in authority vs decentralization benefits

**On-chain vs Off-chain Validation:**
- Validation data on-chain (transparency)
- Detailed proof may be off-chain (cost)
- Balance: Enough data for audit, not too expensive

**Renewable Energy Types:**
- Currently free-form string
- Could be enum for standardization
- Consider regional certification standards

## Future Enhancements

Potential improvements for future versions:

1. **Multi-Authority Governance:**
   - Multiple certifying authorities
   - Quorum-based decisions
   - Regional authorities for local compliance
   - Delegated sub-authorities

2. **Advanced Certificate Features:**
   - Certificate splitting (partial allocations)
   - Certificate merging (combine multiple)
   - Certificate transfers between accounts
   - Certificate marketplace

3. **Revocation System:**
   - Manual revocation with reason
   - Fraud detection and reversal
   - Blacklist mechanisms
   - Appeals process

4. **Enhanced Validation:**
   - Oracle integration for automated validation
   - Multi-factor verification
   - Confidence scoring
   - Third-party auditor support

5. **Compliance Features:**
   - Regional compliance rules
   - Regulatory reporting
   - Certification standards (e.g., I-REC, TIGR)
   - Audit trail export

6. **DAO Transition:**
   - Gradual transition from PoA to DAO
   - Token-weighted voting
   - Proposal and voting system
   - On-chain governance

7. **Analytics and Reporting:**
   - Certificate lifecycle tracking
   - Energy source breakdown
   - Issuance trends
   - Compliance dashboards

8. **Performance Optimizations:**
   - Compressed certificate storage
   - Batch issuance
   - Merkle tree for certificate proofs
   - Zero-knowledge certificate verification

## Renewable Energy Sources

Common renewable sources certified:

**Solar:**
- Photovoltaic (PV) panels
- Concentrated solar power (CSP)
- Most common in distributed systems

**Wind:**
- Onshore wind turbines
- Offshore wind farms
- Variable generation patterns

**Hydro:**
- Run-of-river hydroelectric
- Small-scale hydro
- Pumped storage (if renewably charged)

**Geothermal:**
- Geothermal heat pumps
- Geothermal power plants
- Consistent baseline generation

**Biomass:**
- Organic waste energy
- Biogas from anaerobic digestion
- Sustainable forestry residues

**Other:**
- Tidal and wave energy
- Waste-to-energy (if sustainable)
- Hybrid renewable systems

Each source has different certification requirements and may need specific validation data.

## Compliance and Standards

### International Standards

**I-REC (International REC Standard):**
- Global framework for REC tracking
- Attribute tracking (source, location, vintage)
- Registry requirements

**TIGR (The International Greenhouse Gas Registry):**
- Carbon offset tracking
- Renewable energy certificates
- Third-party verification

### Regional Standards

**Europe - GO (Guarantees of Origin):**
- EU directive compliance
- Cross-border trading
- National registries

**North America - REC:**
- State renewable portfolio standards (RPS)
- NERC region compliance
- WREGIS, M-RETS tracking systems

**Other Regions:**
- Various national standards
- Bilateral recognition agreements
- Custom validation requirements

### GridTokenX Approach

The Governance Program provides:
- **Flexible Framework**: Adaptable to various standards
- **Transparent Records**: Blockchain-based audit trail
- **Authority Model**: Recognizes certified authorities
- **Data Standards**: Extensible validation data field

Integration with existing certification systems can be achieved through off-chain bridges and authority delegation.
