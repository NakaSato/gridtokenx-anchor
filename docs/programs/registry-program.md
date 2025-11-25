# Registry Program Documentation

## Overview

The Registry Program serves as the identity and asset management system for the GridTokenX ecosystem. It maintains a comprehensive registry of all participants (users) and their energy assets (smart meters), providing the foundational layer of trust and verification for the entire P2P energy trading platform.

## Purpose

The Registry Program provides essential infrastructure services:

1. **User Management**: Register and manage prosumers and consumers
2. **Meter Registry**: Track and validate smart meters for energy measurement
3. **Identity Verification**: Ensure only authorized participants can trade
4. **Energy Accounting**: Track energy generation and consumption per meter
5. **Settlement Tracking**: Prevent double-spending of energy credits

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                  Registry Program Architecture                   │
└─────────────────────────────────────────────────────────────────┘

Users & Assets              Registry Program              Other Programs
┌──────────────┐           ┌────────────────┐            ┌──────────┐
│              │           │                │            │          │
│  Prosumers   │──Register─▶│  User Account  │◀──Verify──│  Trading │
│  Consumers   │   User    │  - Type        │   User    │          │
│              │           │  - Status      │            └──────────┘
└──────────────┘           │  - Location    │
                           └────────┬───────┘
                                    │
┌──────────────┐                    │                    ┌──────────┐
│              │           ┌────────▼───────┐            │          │
│ Smart Meters │──Register─▶│ Meter Account  │◀──Read────│  Oracle  │
│ (Solar, Wind,│   Meter   │  - Meter ID    │  Energy   │          │
│  Battery)    │           │  - Owner       │  Data     └──────────┘
│              │           │  - Type        │
└──────────────┘           │  - Readings    │            ┌──────────┐
                           │  - Balances    │            │          │
                           └────────┬───────┘            │Governance│
                                    │                    │          │
                           ┌────────▼───────┐            │          │
                           │  Settlement    │◀───────────│  ERC     │
                           │  Tracking      │  Prevent   │  Issuance│
                           │  - Net Gen     │  Double    │          │
                           │  - Claimed     │  Claim     └──────────┘
                           └────────────────┘
```

## Core Components

### 1. Registry Account

The root configuration account for the registry system:

**Configuration:**
- REC Authority public key (for ERC issuance coordination)
- Total registered users count
- Total registered meters count
- Registry version for upgrades

**Purpose:** Central configuration and statistics tracking

### 2. User Account

Individual account for each registered participant:

**User Identity:**
- Owner public key (wallet address)
- User type (Prosumer or Consumer)
- Location identifier (for geographic tracking)
- Registration timestamp

**User Status:**
- Active: Can participate in trading
- Inactive: Temporarily disabled
- Suspended: Blocked from all activities

**Purpose:** Establishes identity and eligibility for trading

### 3. Meter Account

Detailed account for each registered smart meter:

**Meter Identity:**
- Meter ID (unique identifier from AMI system)
- Owner public key (references user account)
- Meter type (Solar, Wind, Battery, Grid)
- Registration timestamp

**Meter Status:**
- Active: Operational and reporting
- Inactive: Temporarily offline
- Maintenance: Under service

**Energy Tracking:**
- Total energy generated (lifetime kWh)
- Total energy consumed (lifetime kWh)
- Last reading timestamp
- Last reported values

**Settlement Prevention (Critical for Double-Claim Prevention):**
- Net generation (total generated - total consumed)
- Settled net generation (amount already minted as tokens)
- Claimed ERC generation (amount issued as ERC certificates)

**Balance Calculation:**
```
Unsettled Balance = Net Generation - Settled Net Generation
Available for Tokenization = Unsettled Balance

Unclaimed ERC Energy = Net Generation - Claimed ERC Generation
Available for ERC Issuance = Unclaimed ERC Energy
```

This dual-tracking mechanism prevents:
- Double-minting of GRID tokens
- Double-claiming of ERC certificates
- Ensures energy credits are only used once

## Data Flow

### User Registration Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                   User Registration Process                      │
└─────────────────────────────────────────────────────────────────┘

    New User                 Registry Program
       │                           │
       │  Register User            │
       ├──────────────────────────▶│
       │  (user_type, location)    │
       │                           │
       │                ┌──────────▼──────────┐
       │                │ Check Not Already   │
       │                │ Registered          │
       │                │ (prevent duplicates)│
       │                └──────────┬──────────┘
       │                           │
       │                ┌──────────▼──────────┐
       │                │ Create User Account │
       │                │ - Set owner         │
       │                │ - Set type          │
       │                │ - Status = Active   │
       │                │ - Record location   │
       │                └──────────┬──────────┘
       │                           │
       │                ┌──────────▼──────────┐
       │                │ Update Registry     │
       │                │ - Increment user    │
       │                │   counter           │
       │                └──────────┬──────────┘
       │                           │
       │  ◀─────────────────────────┤
       │  User Registered Event     │
       │  (Pubkey, Type, Location)  │
       │                           │
```

### Meter Registration Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                  Meter Registration Process                      │
└─────────────────────────────────────────────────────────────────┘

  Meter Owner              Registry Program
       │                           │
       │  Register Meter           │
       ├──────────────────────────▶│
       │  (meter_id, meter_type)   │
       │                           │
       │                ┌──────────▼──────────┐
       │                │ Verify User Account │
       │                │ Exists & Active?    │
       │                └──────────┬──────────┘
       │                           │
       │                ┌──────────▼──────────┐
       │                │ Check Meter Not     │
       │                │ Already Registered  │
       │                └──────────┬──────────┘
       │                           │
       │                ┌──────────▼──────────┐
       │                │ Validate Meter ID   │
       │                │ Format (Base64)     │
       │                └──────────┬──────────┘
       │                           │
       │                ┌──────────▼──────────┐
       │                │ Create Meter Account│
       │                │ - Set meter_id      │
       │                │ - Link to owner     │
       │                │ - Set type          │
       │                │ - Status = Active   │
       │                │ - Initialize        │
       │                │   counters to 0     │
       │                └──────────┬──────────┘
       │                           │
       │                ┌──────────▼──────────┐
       │                │ Update Registry     │
       │                │ - Increment meter   │
       │                │   counter           │
       │                └──────────┬──────────┘
       │                           │
       │  ◀─────────────────────────┤
       │  Meter Registered Event    │
       │  (Meter ID, Owner, Type)   │
       │                           │
```

### Meter Reading Update Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                 Meter Reading Update Process                     │
└─────────────────────────────────────────────────────────────────┘

  Oracle / Service          Registry Program
       │                           │
       │  Update Meter Reading     │
       ├──────────────────────────▶│
       │  (energy_generated,       │
       │   energy_consumed,        │
       │   reading_timestamp)      │
       │                           │
       │                ┌──────────▼──────────┐
       │                │ Verify Meter Exists │
       │                │ & Active?           │
       │                └──────────┬──────────┘
       │                           │
       │                ┌──────────▼──────────┐
       │                │ Validate Energy Vals│
       │                │ - Not negative?     │
       │                │ - Reasonable?       │
       │                └──────────┬──────────┘
       │                           │
       │                ┌──────────▼──────────┐
       │                │ Update Totals       │
       │                │ - Add to total_gen  │
       │                │ - Add to total_cons │
       │                │ - Update timestamp  │
       │                └──────────┬──────────┘
       │                           │
       │                ┌──────────▼──────────┐
       │                │ Recalculate Net Gen │
       │                │ net = total_gen -   │
       │                │       total_cons    │
       │                └──────────┬──────────┘
       │                           │
       │  ◀─────────────────────────┤
       │  Reading Updated Event     │
       │  (Meter, Energy Values)    │
       │                           │
```

### Settlement Balance Flow

```
┌─────────────────────────────────────────────────────────────────┐
│            Settlement Balance Query & Update Process             │
└─────────────────────────────────────────────────────────────────┘

Energy Token Program         Registry Program
(or other consumer)
       │                           │
       │  Get Unsettled Balance    │
       ├──────────────────────────▶│
       │  (query only)             │
       │                           │
       │                ┌──────────▼──────────┐
       │                │ Calculate:          │
       │                │ unsettled =         │
       │                │   net_generation -  │
       │                │   settled_net_gen   │
       │                └──────────┬──────────┘
       │                           │
       │  ◀─────────────────────────┤
       │  Return: unsettled amount  │
       │                           │
       │                           │
       │  Settle Meter Balance     │
       ├──────────────────────────▶│
       │  (prepares for minting)   │
       │                           │
       │                ┌──────────▼──────────┐
       │                │ Verify meter active │
       │                └──────────┬──────────┘
       │                           │
       │                ┌──────────▼──────────┐
       │                │ Calculate unsettled │
       │                │ amount again        │
       │                └──────────┬──────────┘
       │                           │
       │                ┌──────────▼──────────┐
       │                │ Error if unsettled  │
       │                │ amount is zero      │
       │                │ (nothing to settle) │
       │                └──────────┬──────────┘
       │                           │
       │                ┌──────────▼──────────┐
       │                │ Update Meter:       │
       │                │ settled_net_gen +=  │
       │                │ unsettled_amount    │
       │                └──────────┬──────────┘
       │                           │
       │  ◀─────────────────────────┤
       │  Return: settled amount    │
       │  (amount to mint as tokens)│
       │                           │
       │                           │
       │  [Token minting happens    │
       │   in Energy Token Program  │
       │   using this amount]       │
       │                           │
```

## Instructions

### Registry Initialization

#### 1. Initialize
**Purpose:** Set up the registry for the first time

**Process:**
- Creates Registry root account
- Sets REC authority for ERC coordination
- Initializes counters to zero

**Authority:** Deployer becomes admin

### User Management Instructions

#### 2. Register User
**Purpose:** Add a new participant to the system

**Authority Required:** Any user (self-registration)

**Parameters:**
- `user_type`: Prosumer or Consumer
  - **Prosumer**: Generates and consumes energy (can sell excess)
  - **Consumer**: Only consumes energy (can only buy)
- `location`: String identifier for geographic area

**Validation:**
- User must not already be registered
- User type must be valid enum value
- Location string within size limits

**On Success:**
- User Account created with Active status
- User is eligible to register meters
- User can participate in trading
- UserRegistered event emitted

**PDA Derivation:**
```
User Account PDA = derive[
  seeds: ["user_account", owner_pubkey],
  program: registry_program_id
]
```

#### 3. Update User Status
**Purpose:** Change user's operational status

**Authority Required:** Admin only

**Parameters:**
- `new_status`: Active, Inactive, or Suspended

**Use Cases:**
- Suspend users violating terms
- Temporarily disable during verification
- Reactivate after review

**Effects:**
- Inactive/Suspended users cannot trade
- Existing orders may be cancelled
- Meters remain registered but disabled

### Meter Management Instructions

#### 4. Register Meter
**Purpose:** Add a smart meter to a user's account

**Authority Required:** User must be registered and active

**Parameters:**
- `meter_id`: Unique identifier from AMI system
- `meter_type`: Solar, Wind, Battery, or Grid

**Validation:**
- Caller must have registered user account
- User account must be Active
- Meter ID must be unique (not already registered)
- Meter ID must be valid Base64 format
- Meter type must be valid enum

**Energy Tracking Initialization:**
- `total_energy_generated`: 0
- `total_energy_consumed`: 0
- `settled_net_generation`: 0
- `claimed_erc_generation`: 0

**On Success:**
- Meter Account created with Active status
- Meter can receive reading updates
- Meter eligible for ERC issuance
- MeterRegistered event emitted

**PDA Derivation:**
```
Meter Account PDA = derive[
  seeds: ["meter_account", meter_id.as_bytes()],
  program: registry_program_id
]
```

#### 5. Update Meter Reading
**Purpose:** Record latest energy production/consumption

**Authority Required:** Oracle or authorized service

**Parameters:**
- `energy_generated`: kWh produced since last reading
- `energy_consumed`: kWh used since last reading
- `reading_timestamp`: Unix timestamp of reading

**Validation:**
- Meter must exist and be Active
- Energy values must be non-negative
- Timestamp must be reasonable (not too old/future)

**Processing:**
- Add to `total_energy_generated`
- Add to `total_energy_consumed`
- Update `last_reading_timestamp`
- Update `last_reading_generated` and `last_reading_consumed`
- Recalculate net generation automatically

**Net Generation Formula:**
```
net_generation = total_energy_generated - total_energy_consumed
```

**On Success:**
- Meter totals updated
- Net generation recalculated
- MeterReadingUpdated event emitted

### Verification Instructions

#### 6. Is Valid User
**Purpose:** Check if a user can participate

**Authority Required:** Any program/user (read-only)

**Returns:** Boolean
- `true` if user exists and status is Active
- `false` otherwise

**Use Cases:**
- Trading program validates traders
- External services verify eligibility
- UI displays user status

#### 7. Is Valid Meter
**Purpose:** Check if a meter is operational

**Authority Required:** Any program/user (read-only)

**Returns:** Boolean
- `true` if meter exists and status is Active
- `false` otherwise

**Use Cases:**
- Oracle validates before accepting readings
- Governance checks before ERC issuance
- UI shows meter status

### Settlement Instructions

#### 8. Get Unsettled Balance
**Purpose:** Query how much energy can be tokenized

**Authority Required:** Any program/user (read-only)

**Returns:** u64 (kWh)

**Calculation:**
```
unsettled_balance = net_generation - settled_net_generation
```

**Use Cases:**
- Energy token program checks available amount before minting
- UI displays claimable energy
- Analytics track tokenization rates

#### 9. Settle Meter Balance
**Purpose:** Mark energy as settled (prepare for token minting)

**Authority Required:** Authorized services (Energy Token program)

**Returns:** u64 (amount settled)

**Process:**
1. Calculate current unsettled balance
2. Verify unsettled balance > 0
3. Update `settled_net_generation += unsettled_balance`
4. Return settled amount

**Critical Security:**
- This function DOES NOT mint tokens
- Only updates accounting to prevent re-minting
- Actual token minting happens in separate Energy Token program
- Both operations should be in same transaction (atomic)

**On Success:**
- Settled counter incremented
- Amount returned for token minting
- MeterBalanceSettled event emitted

**Double-Mint Prevention:**
```
First call:
  net_gen = 100, settled = 0
  → settle 100, settled = 100
  
Second call:
  net_gen = 100, settled = 100
  → unsettled = 0, ERROR: nothing to settle
  
After new generation:
  net_gen = 150, settled = 100
  → settle 50, settled = 150
```

## Events

### RegistryInitialized
Emitted when registry is created

**Data:**
- Authority public key
- Initialization timestamp

### UserRegistered
Emitted when new user registers

**Data:**
- User public key
- User type (Prosumer/Consumer)
- Location
- Registration timestamp

### UserStatusUpdated
Emitted when user status changes

**Data:**
- User public key
- Old status
- New status
- Update timestamp

### MeterRegistered
Emitted when new meter is added

**Data:**
- Meter ID
- Owner public key
- Meter type
- Registration timestamp

### MeterReadingUpdated
Emitted when meter reading is recorded

**Data:**
- Meter ID
- Energy generated (incremental)
- Energy consumed (incremental)
- Cumulative totals
- Reading timestamp

### MeterBalanceSettled
Emitted when energy is marked as settled

**Data:**
- Meter ID
- Amount settled (kWh)
- New settled total
- Settlement timestamp

## User and Meter Types

### User Types

```
┌─────────────────────────────────────────────────────────────────┐
│                         User Taxonomy                            │
└─────────────────────────────────────────────────────────────────┘

 Prosumer                                Consumer
┌──────────────────────┐              ┌──────────────────────┐
│ - Generates energy   │              │ - Only consumes      │
│ - Consumes energy    │              │ - No generation      │
│ - Can SELL excess    │              │ - Can only BUY       │
│ - Can BUY deficit    │              │ - No ERC eligibility │
│                      │              │                      │
│ Meter Types:         │              │ Meter Types:         │
│ - Solar              │              │ - Grid (consumption) │
│ - Wind               │              │                      │
│ - Battery            │              │                      │
│ - Grid (consumption) │              │                      │
└──────────────────────┘              └──────────────────────┘
```

### Meter Types

**Solar:**
- Photovoltaic panels
- Generates during daylight
- Renewable energy source
- Eligible for ERC issuance

**Wind:**
- Wind turbines
- Generates when wind blows
- Renewable energy source
- Eligible for ERC issuance

**Battery:**
- Energy storage systems
- Can generate (discharge) and consume (charge)
- Not a renewable source (stores renewable energy)
- Not directly eligible for ERC (but can store ERC-certified energy)

**Grid:**
- Connection to utility grid
- Typically consumption only
- Not renewable
- Not eligible for ERC

### Status Values

**User Status:**
- **Active**: Normal operation, can trade and register meters
- **Inactive**: Temporarily disabled, cannot trade but data preserved
- **Suspended**: Administrative hold, all activities blocked

**Meter Status:**
- **Active**: Operational, accepting readings, can issue ERCs
- **Inactive**: Temporarily offline, no readings accepted
- **Maintenance**: Under service, readings may be unreliable

## Security Model

### Access Control

```
┌─────────────────────────────────────────────────────────────────┐
│                   Registry Access Control                        │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────────┐
│  Admin / REC Auth    │  ← Update user status
│                      │    Configure registry
└──────────────────────┘

┌──────────────────────┐
│  Users (Self)        │  ← Register themselves
│                      │    Register own meters
└──────────────────────┘

┌──────────────────────┐
│  Oracle / Services   │  ← Update meter readings
│  (Authorized)        │    Settlement operations
└──────────────────────┘

┌──────────────────────┐
│  Any Program/User    │  ← Query user validity
│  (Read-only)         │    Query meter status
│                      │    Read balances
└──────────────────────┘
```

### Validation Layers

**Layer 1: Identity Validation**
- Each user PDA derived from their public key
- Ensures one account per user
- Prevents impersonation

**Layer 2: Ownership Validation**
- Only meter owner can register meters
- User must be Active to register
- Meter linked permanently to owner

**Layer 3: Data Integrity**
- Energy values must be non-negative
- Timestamps must be reasonable
- Meter IDs must be unique and valid format

**Layer 4: Settlement Protection**
- Unsettled balance cannot be negative
- Settled amount cannot exceed net generation
- Prevents double-minting through accounting

## Integration Points

### With Oracle Program
**Meter Reading Updates:**
- Oracle submits validated readings
- Registry updates meter totals
- Net generation recalculated automatically

**Flow:**
```
Oracle validates reading
       │
       ▼
Registry.update_meter_reading()
       │
       ▼
Meter totals updated
       │
       ▼
Other programs can query new balances
```

### With Governance Program
**ERC Issuance Coordination:**
- Governance checks meter's unclaimed ERC energy
- Registry tracks claimed amounts
- Prevents double-claiming

**Anti-Double-Claim Flow:**
```
Governance: Issue ERC for 100 kWh
       │
       ▼
Check: meter.net_gen - meter.claimed_erc_gen ≥ 100?
       │
       ▼
If yes: Issue ERC
       Update meter.claimed_erc_gen += 100
       │
       ▼
Future ERC requests see reduced available energy
```

### With Trading Program
**Trader Validation:**
- Trading checks user is Active
- Validates meters for sell orders
- Ensures authenticity

### With Energy Token Program
**Tokenization:**
- Energy tokens query unsettled balance
- Settlement marks energy as minted
- Prevents double-minting

**Atomic Operation:**
```
Transaction {
  1. Registry.settle_meter_balance() → returns amount
  2. EnergyToken.mint(amount) → creates tokens
}
Both succeed or both fail (atomicity)
```

## Best Practices

### For Users

**Registration:**
1. Register as correct user type:
   - Prosumer if you have generation capacity
   - Consumer if only consuming
2. Provide accurate location for market segmentation
3. Verify registration confirmation before proceeding

**Meter Management:**
1. Register meters immediately after installation
2. Use official meter IDs from AMI system
3. Choose correct meter type (affects ERC eligibility)
4. Monitor meter status regularly
5. Report maintenance periods promptly

### For Operators

**User Management:**
1. Verify user authenticity before activation
2. Document status change reasons
3. Communicate with users about suspensions
4. Regular audits of active users

**Meter Monitoring:**
1. Track unusual reading patterns
2. Validate meter ID formats
3. Monitor settlement rates
4. Alert on anomalies (negative net gen swings)
5. Cross-reference with Oracle quality scores

**Settlement Operations:**
1. Always settle and mint atomically
2. Monitor unsettled balances system-wide
3. Alert on large unsettled amounts (may indicate issues)
4. Regular reconciliation against off-chain records

### For Developers

**Integration:**
1. Always check user/meter validity before operations
2. Handle status transitions gracefully
3. Subscribe to events for real-time tracking
4. Cache user/meter data appropriately
5. Implement retry logic for transient failures

**Testing:**
1. Test all status combinations
2. Verify double-mint prevention
3. Simulate various energy generation patterns
4. Test meter type specific behaviors
5. Load test with many users/meters

## Limitations and Considerations

### Current Limitations

1. **No Meter Transfer:**
   - Meters permanently linked to original owner
   - Cannot transfer ownership
   - Requires re-registration if owner changes

2. **No Multi-Ownership:**
   - Each meter has single owner
   - Cannot represent shared installations
   - No consortium or community ownership models

3. **Limited Meter Data:**
   - Only cumulative totals stored
   - No historical time-series on-chain
   - Detailed history must be off-chain

4. **No Geographic Verification:**
   - Location is self-reported string
   - No verification of actual location
   - Trust-based geographic claims

5. **Single Status Field:**
   - Cannot represent complex states
   - No gradations (e.g., "partially operational")
   - Binary active/inactive only

### Design Considerations

**Centralized vs Decentralized:**
- Admin can suspend users (centralized control)
- Necessary for compliance and fraud prevention
- Trade-off: Trust in admin vs system integrity

**On-chain Storage Costs:**
- Minimal data on-chain (cost optimization)
- Cumulative totals only
- Detailed historical data should be off-chain

**Settlement Timing:**
- Settlement is pull-based (user initiates)
- Not automatic (saves transaction costs)
- User decides when to tokenize

**Double-Claim Prevention:**
- Two separate trackers: settled (for tokens) and claimed (for ERCs)
- Both prevent re-use of same energy
- Requires careful coordination between programs

## Future Enhancements

Potential improvements for future versions:

1. **Enhanced User Types:**
   - Grid operators
   - Energy cooperatives
   - Multi-sig consortium owners
   - Automated trading agents

2. **Advanced Meter Features:**
   - Meter transfer capabilities
   - Multi-owner meters
   - Meter groups (aggregated readings)
   - Sub-meters for detailed tracking

3. **Geographic Features:**
   - Verified location (oracle-based)
   - Geographic market restrictions
   - Regional compliance rules
   - Distance-based trading constraints

4. **Historical Data:**
   - On-chain time-series (compressed)
   - Interval data (15-min, hourly)
   - Seasonal patterns
   - Anomaly detection

5. **Advanced Settlement:**
   - Automatic settlement based on thresholds
   - Scheduled settlement (daily, weekly)
   - Partial settlements
   - Settlement reversal (with admin approval)

6. **Reputation System:**
   - User reliability scores
   - Meter quality ratings
   - Trading history tracking
   - Compliance records

7. **Integration Features:**
   - Multi-chain meter registry
   - Cross-registry lookups
   - Standardized meter data formats
   - API for off-chain services
