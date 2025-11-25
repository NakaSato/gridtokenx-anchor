# Energy Token Program Documentation

## Overview

The Energy Token Program implements the GRID token - a fungible SPL token that represents tokenized renewable energy on the Solana blockchain. It enables prosumers to convert their net energy generation into tradeable digital assets, creating a liquid market for renewable energy credits.

## Purpose

The Energy Token Program serves as the tokenization layer for the GridTokenX ecosystem:

1. **Energy Tokenization**: Convert verified energy generation into GRID tokens
2. **Token Management**: Mint, transfer, and burn GRID tokens
3. **Settlement Integration**: Coordinate with Registry to prevent double-minting
4. **Metaplex Integration**: Create rich token metadata using Token Metadata standards
5. **Token-2022 Support**: Compatible with modern SPL Token standards

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│              Energy Token Program Architecture                   │
└─────────────────────────────────────────────────────────────────┘

Energy Generation      Energy Token Program       Blockchain
┌──────────────┐      ┌────────────────────┐     ┌──────────┐
│              │      │                    │     │          │
│ Prosumer's   │      │  Token Info        │     │  SPL     │
│ Smart Meter  │      │  - Authority       │     │  Token   │
│              │      │  - Mint Address    │     │  Program │
│ Net Gen:     │      │  - Total Supply    │     │          │
│ 100 kWh      │      └─────────┬──────────┘     └────┬─────┘
│              │                │                     │
└──────┬───────┘                │                     │
       │                        │                     │
       │ Oracle updates         │                     │
       ▼                        │                     │
┌──────────────┐      ┌─────────▼──────────┐         │
│              │      │                    │         │
│ Registry     │◀─────┤  Mint GRID Tokens  │         │
│ Program      │ CPI  │  (Settlement Flow) │         │
│              │      │                    │         │
│ Settlement:  │      │  1. Settle meter   │         │
│ - Net: 100   │      │  2. Get unsettled  │         │
│ - Settled: 0 │      │  3. Mint tokens    │         │
│ - Unsettled  │      │  4. Update supply  │         │
│   = 100      │      └─────────┬──────────┘         │
│              │                │                     │
└──────────────┘                │ Mint 100 GRID      │
                                ├────────────────────▶│
                                │                     │
                                ▼                     ▼
                       ┌────────────────┐    ┌────────────────┐
                       │ User's Token   │    │ GRID Token     │
                       │ Account        │    │ Mint           │
                       │ Balance: 100   │    │ Supply: 100    │
                       └────────────────┘    └────────────────┘
```

## Core Components

### 1. Token Info Account

The central configuration account for GRID token management:

**Configuration:**
- Authority public key (program admin)
- Mint address (GRID token mint)
- Total supply tracker (current circulating supply)
- Created timestamp

**Purpose:** Tracks token state and serves as mint authority via PDA

**PDA Derivation:**
```
Token Info PDA = derive[
  seeds: ["token_info"],
  program: energy_token_program_id
]
```

### 2. GRID Token Mint

The SPL Token mint for GRID tokens:

**Token Specifications:**
- Token Standard: SPL Token / Token-2022
- Decimals: 9 (1 GRID = 1,000,000,000 base units)
- Mint Authority: Token Info PDA
- Freeze Authority: None (tokens are always liquid)
- Supply: Elastic (minted based on energy generation)

**Metadata (via Metaplex):**
- Name: Configurable (e.g., "GridTokenX Energy Token")
- Symbol: Configurable (e.g., "GRID" or "GRX")
- URI: Link to token metadata JSON
- Seller Fee: 0 (no royalties)

**Purpose:** The actual token that users hold, transfer, and trade

### 3. User Token Accounts

Associated Token Accounts (ATAs) for each user:

**Account Type:** SPL Token Account or Token-2022 Account
**Owner:** User's wallet
**Mint:** GRID token mint
**Balance:** User's GRID token holdings

**Purpose:** Store user's GRID token balance

## Data Flow

### Token Initialization Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                Token Program Initialization                      │
└─────────────────────────────────────────────────────────────────┘

   Admin                  Energy Token Program
     │                            │
     │  Initialize Token          │
     ├───────────────────────────▶│
     │                            │
     │                 ┌──────────▼──────────┐
     │                 │ Create Token Info   │
     │                 │ - Set authority     │
     │                 │ - Supply = 0        │
     │                 │ - Record timestamp  │
     │                 └──────────┬──────────┘
     │                            │
     │                 ┌──────────▼──────────┐
     │                 │ Create Mint Account │
     │                 │ - Decimals: 9       │
     │                 │ - Authority: Token  │
     │                 │   Info PDA          │
     │                 └──────────┬──────────┘
     │                            │
     │  ◀──────────────────────────┤
     │  Initialization Complete    │
     │                            │
```

### Token Mint Creation with Metadata

```
┌─────────────────────────────────────────────────────────────────┐
│              Token Mint with Metadata Creation                   │
└─────────────────────────────────────────────────────────────────┘

   Admin                Energy Token         Metaplex Token
                        Program              Metadata Program
     │                      │                        │
     │  Create Token Mint   │                        │
     ├─────────────────────▶│                        │
     │  (name, symbol, uri) │                        │
     │                      │                        │
     │           ┌──────────▼──────────┐             │
     │           │ Create Mint Account │             │
     │           │ via Token-2022      │             │
     │           └──────────┬──────────┘             │
     │                      │                        │
     │                      │  Create Metadata CPI   │
     │                      ├───────────────────────▶│
     │                      │                        │
     │                      │         ┌──────────────▼─────────┐
     │                      │         │ Create Metadata Account│
     │                      │         │ - Name                 │
     │                      │         │ - Symbol               │
     │                      │         │ - URI                  │
     │                      │         │ - Standard: Fungible   │
     │                      │         └──────────────┬─────────┘
     │                      │                        │
     │                      │  Metadata Created      │
     │                      │◀───────────────────────┤
     │                      │                        │
     │  ◀────────────────────┤                        │
     │  Mint Created         │                        │
     │  with Rich Metadata   │                        │
     │                      │                        │
```

### GRID Token Minting Flow (Primary Method)

```
┌─────────────────────────────────────────────────────────────────┐
│                 GRID Token Minting Process                       │
│           (Integrated with Registry Settlement)                  │
└─────────────────────────────────────────────────────────────────┘

Prosumer          Energy Token Program      Registry Program
   │                      │                         │
   │  Mint GRID Tokens    │                         │
   ├─────────────────────▶│                         │
   │                      │                         │
   │           ┌──────────▼──────────┐              │
   │           │ Prepare CPI to      │              │
   │           │ Registry Program    │              │
   │           └──────────┬──────────┘              │
   │                      │                         │
   │                      │  settle_meter_balance() │
   │                      ├────────────────────────▶│
   │                      │                         │
   │                      │         ┌───────────────▼──────────┐
   │                      │         │ Calculate Unsettled:     │
   │                      │         │ unsettled = net_gen -    │
   │                      │         │             settled      │
   │                      │         │                          │
   │                      │         │ Update Meter:            │
   │                      │         │ settled += unsettled     │
   │                      │         └───────────────┬──────────┘
   │                      │                         │
   │                      │  Return: settled amount │
   │                      │◀────────────────────────┤
   │                      │                         │
   │           ┌──────────▼──────────┐              │
   │           │ Read Meter Account  │              │
   │           │ Parse settled data  │              │
   │           │ tokens_to_mint =    │              │
   │           │ parsed amount       │              │
   │           └──────────┬──────────┘              │
   │                      │                         │
   │           ┌──────────▼──────────┐              │
   │           │ Mint GRID Tokens    │              │
   │           │ via SPL Token       │              │
   │           │ - Amount: tokens_   │              │
   │           │   to_mint           │              │
   │           │ - To: user's ATA    │              │
   │           │ - Authority: Token  │              │
   │           │   Info PDA          │              │
   │           └──────────┬──────────┘              │
   │                      │                         │
   │           ┌──────────▼──────────┐              │
   │           │ Update Total Supply │              │
   │           │ supply += amount    │              │
   │           └──────────┬──────────┘              │
   │                      │                         │
   │  ◀────────────────────┤                         │
   │  GRID Tokens Minted   │                         │
   │  GridTokensMinted     │                         │
   │  Event Emitted        │                         │
   │                      │                         │
```

### Direct Token Minting Flow

```
┌─────────────────────────────────────────────────────────────────┐
│              Direct Token Minting (Authority Only)               │
└─────────────────────────────────────────────────────────────────┘

   Admin               Energy Token Program
     │                         │
     │  Mint Tokens Direct     │
     ├────────────────────────▶│
     │  (recipient, amount)    │
     │                         │
     │              ┌──────────▼──────────┐
     │              │ Verify Authority    │
     │              │ (only admin can)    │
     │              └──────────┬──────────┘
     │                         │
     │              ┌──────────▼──────────┐
     │              │ Mint SPL Tokens     │
     │              │ - Use Token Info    │
     │              │   PDA as signer     │
     │              │ - Mint to recipient │
     │              └──────────┬──────────┘
     │                         │
     │              ┌──────────▼──────────┐
     │              │ Update Supply       │
     │              │ supply += amount    │
     │              └──────────┬──────────┘
     │                         │
     │  ◀──────────────────────┤
     │  TokensMintedDirect     │
     │  Event                  │
     │                         │

Use Case: Off-chain verified generation (backup method)
```

### Token Transfer Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     Token Transfer Process                       │
└─────────────────────────────────────────────────────────────────┘

  Sender                Energy Token Program      SPL Token Program
    │                           │                         │
    │  Transfer Tokens          │                         │
    ├──────────────────────────▶│                         │
    │  (recipient, amount)      │                         │
    │                           │                         │
    │                ┌──────────▼──────────┐              │
    │                │ Verify Sender Has   │              │
    │                │ Sufficient Balance  │              │
    │                └──────────┬──────────┘              │
    │                           │                         │
    │                           │  Transfer CPI           │
    │                           ├────────────────────────▶│
    │                           │                         │
    │                           │         ┌───────────────▼────────┐
    │                           │         │ - Deduct from sender   │
    │                           │         │ - Credit to recipient  │
    │                           │         └───────────────┬────────┘
    │                           │                         │
    │                           │  Transfer Complete      │
    │                           │◀────────────────────────┤
    │                           │                         │
    │  ◀────────────────────────┤                         │
    │  Transfer Success         │                         │
    │                           │                         │
```

### Token Burn Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                      Token Burn Process                          │
└─────────────────────────────────────────────────────────────────┘

  Token Holder          Energy Token Program      SPL Token Program
      │                         │                         │
      │  Burn Tokens            │                         │
      ├────────────────────────▶│                         │
      │  (amount)               │                         │
      │                         │                         │
      │              ┌──────────▼──────────┐              │
      │              │ Verify Account Has  │              │
      │              │ Sufficient Tokens   │              │
      │              └──────────┬──────────┘              │
      │                         │                         │
      │                         │  Burn CPI               │
      │                         ├────────────────────────▶│
      │                         │                         │
      │                         │         ┌───────────────▼────────┐
      │                         │         │ - Deduct from account  │
      │                         │         │ - Reduce total supply  │
      │                         │         │ - Destroy tokens       │
      │                         │         └───────────────┬────────┘
      │                         │                         │
      │                         │  Burn Complete          │
      │                         │◀────────────────────────┤
      │                         │                         │
      │              ┌──────────▼──────────┐              │
      │              │ Update Total Supply │              │
      │              │ supply -= amount    │              │
      │              └──────────┬──────────┘              │
      │                         │                         │
      │  ◀──────────────────────┤                         │
      │  Tokens Burned          │                         │
      │                         │                         │

Purpose: Retire energy credits (consumption or retirement)
```

## Instructions

### System Initialization

#### 1. Initialize
**Purpose:** Basic program initialization

**Authority:** Any user

**Process:**
- Logs initialization message
- No state changes (legacy instruction)

#### 2. Initialize Token
**Purpose:** Set up the GRID token system

**Authority:** Admin (becomes token authority)

**Process:**
- Creates Token Info PDA account
- Creates GRID token mint with 9 decimals
- Sets Token Info PDA as mint authority
- Records admin as program authority
- Initializes total supply to 0

**Accounts Created:**
- Token Info (configuration and authority)
- Mint (GRID token mint)

**On Success:**
- Token system ready for minting
- Admin has full control

#### 3. Create Token Mint
**Purpose:** Create GRID mint with rich metadata

**Authority:** Any user (typically admin)

**Parameters:**
- `name`: Token name (e.g., "GridTokenX Energy Token")
- `symbol`: Token symbol (e.g., "GRID", "GRX")
- `uri`: Metadata URI (JSON with token details)

**Metaplex Integration:**
- Creates Token-2022 mint
- Adds Metaplex metadata account
- Sets token as Fungible standard
- No seller fees (0%)
- Decimals: 9

**Fallback Behavior:**
- If Metaplex not available (localnet): Creates basic mint
- Does not fail if metadata creation fails
- Ensures compatibility across environments

**On Success:**
- Rich token with wallet-friendly display
- Compatible with all SPL Token wallets
- Ready for exchange listings

### Token Minting Operations

#### 4. Mint GRID Tokens
**Purpose:** Convert verified energy generation into tokens

**Authority:** Meter owner (prosumer)

**Requirements:**
- User must own a registered meter in Registry
- Meter must have unsettled net generation
- Meter account must be active

**Process (Atomic Transaction):**
1. **CPI to Registry:** Calls `settle_meter_balance()`
2. **Registry Calculates:** `unsettled = net_gen - settled_net_gen`
3. **Registry Updates:** `settled_net_gen += unsettled`
4. **Energy Token Reads:** Parses meter account data
5. **Energy Token Mints:** Creates GRID tokens = unsettled amount
6. **Supply Updated:** Increments total supply

**Double-Mint Prevention:**
- Registry tracks settled amount
- Cannot mint for already-settled energy
- Atomicity ensures consistency

**On Success:**
- GRID tokens created in user's ATA
- Total supply increased
- GridTokensMinted event emitted

**Example:**
```
Meter State Before:
  - Net Generation: 100 kWh
  - Settled: 0 kWh
  - Unsettled: 100 kWh

After Mint GRID Tokens:
  - Net Generation: 100 kWh (unchanged)
  - Settled: 100 kWh (updated)
  - Unsettled: 0 kWh
  - GRID Tokens Minted: 100
  - User Balance: 100 GRID

Later, new generation:
  - Net Generation: 150 kWh (new readings)
  - Settled: 100 kWh (from before)
  - Unsettled: 50 kWh
  - Can mint: 50 more GRID
```

#### 5. Mint Tokens Direct
**Purpose:** Mint tokens without Registry integration

**Authority Required:** Program authority only

**Parameters:**
- `amount`: Number of tokens to mint

**Use Cases:**
- Emergency minting
- Off-chain verified generation
- Testing and development
- Airdrops or rewards

**Validation:**
- Only program authority can execute
- No meter account checks
- No settlement tracking

**On Success:**
- Tokens minted directly to specified account
- Total supply updated
- TokensMintedDirect event emitted

**WARNING:** Bypasses Registry settlement - use carefully!

#### 6. Mint to Wallet
**Purpose:** Simple token minting to any wallet

**Authority Required:** Mint authority

**Parameters:**
- `amount`: Tokens to mint

**Features:**
- Auto-creates ATA if doesn't exist
- Uses Token-2022 interface
- Generic minting operation

**Use Cases:**
- Initial distribution
- Rewards and incentives
- Testing

### Token Operations

#### 7. Transfer Tokens
**Purpose:** Send GRID tokens to another user

**Authority Required:** Token account owner

**Parameters:**
- `amount`: Tokens to transfer

**Accounts Required:**
- Sender's token account
- Recipient's token account
- Sender as signer

**Standard SPL Transfer:**
- Uses SPL Token program
- Atomic operation
- No fees on transfer (gas only)

**On Success:**
- Tokens moved from sender to recipient
- Both balances updated

#### 8. Burn Tokens
**Purpose:** Permanently destroy GRID tokens

**Authority Required:** Token account owner

**Parameters:**
- `amount`: Tokens to burn

**Use Cases:**
- Retire energy credits after consumption
- Remove tokens from circulation
- Compliance requirements
- Deflationary mechanisms

**Process:**
- Burns tokens via SPL Token program
- Reduces total supply in Token Info
- Tokens permanently removed

**On Success:**
- User's balance decreased
- Total supply decreased
- Tokens cannot be recovered

### Administrative Operations

#### 9. Add REC Validator
**Purpose:** Register REC validators (future feature)

**Authority Required:** Program authority only

**Parameters:**
- `validator_pubkey`: Public key of validator
- `authority_name`: Validator organization name

**Current Status:** Placeholder for future multi-validator support

**Purpose:** Enable decentralized validation in future versions

## Events

### GridTokensMinted
Emitted when tokens are minted via Registry settlement

**Data:**
- `meter_owner`: Prosumer's public key
- `amount`: GRID tokens minted
- `timestamp`: Minting time

**Use Cases:**
- Track tokenization activity
- Analytics and dashboards
- Settlement verification

### TokensMintedDirect
Emitted when authority mints tokens directly

**Data:**
- `recipient`: Token account that received tokens
- `amount`: Tokens minted
- `timestamp`: Minting time

**Use Cases:**
- Audit authority minting
- Track emergency issuance
- Compliance reporting

### TokensMinted
Emitted for generic minting operations

**Data:**
- `recipient`: Token account public key
- `amount`: Tokens minted
- `timestamp`: Minting time

**Use Cases:**
- General minting notifications
- Wallet integrations
- Block explorers

## Token Economics

### Supply Dynamics

```
┌─────────────────────────────────────────────────────────────────┐
│                    GRID Token Supply Model                       │
└─────────────────────────────────────────────────────────────────┘

SUPPLY SOURCES:                           SUPPLY SINKS:

┌──────────────────────┐                 ┌──────────────────────┐
│ Energy Generation    │                 │ Token Burns          │
│ - Mint via meter     │                 │ - User burning       │
│ - 1 kWh = 1 GRID     │                 │ - Energy retirement  │
└──────────┬───────────┘                 └───────▲──────────────┘
           │                                     │
           │ Minting                             │ Burning
           ▼                                     │
┌──────────────────────────────────────────────┐
│                                               │
│         TOTAL GRID TOKEN SUPPLY               │
│                                               │
│  = Sum of all minted tokens                   │
│  - Sum of all burned tokens                   │
│                                               │
└───────────────────────────────────────────────┘

SUPPLY EQUATION:

Total Supply = Minted from Meters 
             + Direct Mints (admin)
             - Burned Tokens
```

### Token-to-Energy Ratio

**Standard Ratio:** 1 GRID = 1 kWh net generation

**Example Scenarios:**

1. **Solar Prosumer:**
   - Generated: 150 kWh
   - Consumed: 50 kWh
   - Net: 100 kWh
   - Can mint: 100 GRID

2. **Wind Farm:**
   - Generated: 10,000 kWh
   - Consumed: 100 kWh
   - Net: 9,900 kWh
   - Can mint: 9,900 GRID

3. **Battery Storage:**
   - Discharged (generated): 200 kWh
   - Charged (consumed): 220 kWh
   - Net: -20 kWh
   - Cannot mint (negative net)

### Token Utility

**Primary Uses:**
1. **Trading:** Sell GRID tokens on markets
2. **Collateral:** Use as collateral for energy trades
3. **Rewards:** Earn tokens for generation
4. **Governance:** Future DAO voting
5. **Staking:** Future staking rewards

**Secondary Uses:**
1. **Carbon Credits:** Convert to carbon offsets
2. **Proof of Green Energy:** Verifiable renewable generation
3. **Incentives:** Utility rebates and incentives
4. **Cross-chain:** Bridge to other blockchains

## Security Model

### Access Control

```
┌─────────────────────────────────────────────────────────────────┐
│              Energy Token Access Control                         │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────┐
│  Program Authority (Admin)  │  ← Full administrative control
│  - Initialize token          │
│  - Mint direct               │
│  - Add validators            │
│  - Emergency operations      │
└─────────────────────────────┘

┌─────────────────────────────┐
│  Token Info PDA             │  ← Mint authority for SPL tokens
│  (Program-controlled)        │    Signs minting operations
└─────────────────────────────┘

┌─────────────────────────────┐
│  Meter Owners (Prosumers)   │  ← Can mint their own tokens
│  - Mint GRID tokens          │    based on meter balance
│  - Transfer tokens           │
│  - Burn own tokens           │
└─────────────────────────────┘

┌─────────────────────────────┐
│  Token Holders (Anyone)     │  ← Standard token operations
│  - Transfer tokens           │
│  - Burn own tokens           │
│  - Query balance             │
└─────────────────────────────┘
```

### Validation Layers

**Layer 1: Authority Validation**
- Direct minting requires program authority
- PDA ensures only program can mint via settlement

**Layer 2: Registry Integration**
- Minting checks meter ownership
- CPI ensures atomic settlement
- Prevents minting without meter

**Layer 3: Double-Mint Prevention**
- Registry tracks settled amounts
- Cannot mint same energy twice
- Mathematically enforced

**Layer 4: SPL Token Security**
- Standard SPL Token validation
- Balance checks on transfer/burn
- Signature verification

## Integration Points

### With Registry Program

**Settlement Integration:**
- Energy Token calls `settle_meter_balance()` via CPI
- Registry returns settled amount
- Energy Token reads meter data
- Atomic transaction ensures consistency

**CPI Flow:**
```
Energy Token Program
  │
  ├─ CPI ──▶ Registry.settle_meter_balance()
  │              │
  │              ├─ Calculate unsettled
  │              ├─ Update meter.settled_net_gen
  │              └─ Return (implicit in account update)
  │
  ├─ Read meter account data
  ├─ Parse settlement info
  └─ Mint tokens based on settled amount
```

**Anti-Double-Mint:**
- First mint: settled 0 → 100, mint 100 GRID
- Cannot mint again until new generation
- Second mint: settled 100 → 150, mint 50 GRID

### With SPL Token Program

**Standard Token Operations:**
- Minting via MintTo instruction
- Transfers via Transfer instruction
- Burning via Burn instruction
- All operations atomic and secure

### With Metaplex Token Metadata

**Rich Token Metadata:**
- Creates metadata account for GRID token
- Displays nicely in wallets (name, symbol, image)
- Standard NFT/Fungible metadata format
- Optional graceful fallback

## Best Practices

### For Prosumers

**Token Minting:**
1. Wait for sufficient generation before minting
2. Check unsettled balance first
3. Mint regularly to maintain liquidity
4. Monitor gas costs vs token value
5. Keep track of minting for tax purposes

**Token Management:**
1. Secure your wallet private keys
2. Use hardware wallets for large holdings
3. Understand token transfers are irreversible
4. Verify recipient addresses before sending
5. Consider token burns for consumed energy

### For Developers

**Integration:**
1. Always use `mint_grid_tokens` for standard minting
2. Handle Registry CPI errors gracefully
3. Parse meter data correctly (byte offsets)
4. Subscribe to GridTokensMinted events
5. Cache Token Info for efficiency

**Testing:**
1. Test double-mint prevention thoroughly
2. Verify atomic settlement + minting
3. Test with various meter states
4. Validate token metadata display
5. Test burn operations

**Error Handling:**
1. Handle NoUnsettledBalance errors
2. Check for meter account validity
3. Verify sufficient token balance
4. Handle CPI failures gracefully
5. Provide clear user feedback

### For Administrators

**Token Management:**
1. Use direct minting sparingly
2. Document all direct mint operations
3. Monitor total supply vs actual generation
4. Regular audits of minting activity
5. Keep authority keys extremely secure

**System Operations:**
1. Test metadata creation in devnet first
2. Verify Metaplex program deployment
3. Monitor token distribution
4. Track minting vs burning ratios
5. Maintain emergency procedures

## Limitations and Considerations

### Current Limitations

1. **Manual Minting:**
   - Users must manually trigger minting
   - Not automatic on energy generation
   - Requires transaction and gas

2. **Raw Data Parsing:**
   - Reads Registry meter data as raw bytes
   - Fragile to Registry account structure changes
   - No type safety across programs

3. **Single Authority:**
   - One program authority
   - No multi-sig support built-in
   - Centralized admin control

4. **No Fractional Generation:**
   - Token decimals 9, but 1 GRID = 1 kWh
   - Cannot represent < 1 kWh generation
   - Rounding may discard small amounts

5. **Metaplex Dependency:**
   - Requires Metaplex program deployment
   - Fallback to basic mint if unavailable
   - May not work in all environments

### Design Considerations

**Registry Coupling:**
- Tight integration with Registry program
- Changes to Registry struct break parsing
- Trade-off: Security vs flexibility

**Token Standard:**
- Chose SPL Token for maximum compatibility
- Token-2022 for advanced features
- Standard ensures wallet support

**Decimal Precision:**
- 9 decimals standard for Solana tokens
- Enables fractional trading
- But core ratio is 1:1 with kWh

**Minting Timing:**
- Pull-based (user initiates)
- vs Push-based (auto-mint on generation)
- Trade-off: User control vs convenience

## Future Enhancements

Potential improvements for future versions:

1. **Automated Minting:**
   - Cron-based auto-minting
   - Threshold-triggered minting
   - Batch minting for multiple meters
   - Reduce manual intervention

2. **Enhanced Safety:**
   - Use Anchor CPI with type safety
   - Import Registry types directly
   - Eliminate raw byte parsing
   - Stronger cross-program guarantees

3. **Advanced Features:**
   - Staking rewards for holding GRID
   - Time-locked tokens (vesting)
   - Delegated minting authorization
   - Multi-signature authority

4. **Token Extensions:**
   - Transfer fees (protocol revenue)
   - Transfer hooks (compliance)
   - Confidential transfers (privacy)
   - Interest-bearing tokens

5. **Governance:**
   - DAO voting with GRID tokens
   - Proposal creation and voting
   - Treasury management
   - Protocol parameter updates

6. **Cross-Chain:**
   - Bridge to Ethereum/other chains
   - Wrapped GRID tokens
   - Cross-chain energy markets
   - Interoperability standards

7. **Analytics:**
   - On-chain supply tracking
   - Minting rate analysis
   - Burn rate metrics
   - Token velocity calculations

8. **DeFi Integration:**
   - Liquidity pools (GRID/USDC)
   - Lending protocols (borrow against GRID)
   - Derivatives (energy futures)
   - Automated market makers

## Token Metadata Schema

### Standard Metadata JSON

```
{
  "name": "GridTokenX Energy Token",
  "symbol": "GRID",
  "description": "Tokenized renewable energy credits from verified prosumers on the GridTokenX network.",
  "image": "https://gridtokenx.com/token-logo.png",
  "external_url": "https://gridtokenx.com",
  "attributes": [
    {
      "trait_type": "Token Type",
      "value": "Energy Credit"
    },
    {
      "trait_type": "Renewable Source",
      "value": "Mixed (Solar, Wind, Hydro)"
    },
    {
      "trait_type": "Network",
      "value": "Solana"
    },
    {
      "trait_type": "Standard",
      "value": "SPL Token"
    }
  ],
  "properties": {
    "category": "Fungible Token",
    "files": [
      {
        "uri": "https://gridtokenx.com/token-logo.png",
        "type": "image/png"
      }
    ]
  }
}
```

### Wallet Display

With proper metadata:
- **Name:** GridTokenX Energy Token
- **Symbol:** GRID
- **Logo:** Displayed in wallet
- **Description:** User-friendly explanation
- **Links:** Website and documentation

Without metadata:
- Shows mint address only
- No logo
- Generic token display
- Lower user confidence

## Compliance and Auditing

### Audit Trail

**On-Chain Events:**
- Every mint logged with event
- Direct mints clearly marked
- Timestamp for all operations
- Immutable blockchain record

**Trackable Metrics:**
1. Total GRID minted per user
2. Energy-to-token conversion verification
3. Admin minting activity
4. Burn activity for consumption
5. Transfer patterns

### Regulatory Considerations

**Energy Credits:**
- May be regulated as commodity
- Jurisdiction-specific rules
- Verify renewable energy claims
- Coordinate with REC authorities

**Token Classification:**
- Likely utility token, not security
- Represents actual energy value
- Consult legal counsel
- Follow local regulations

**Tax Implications:**
- Minting may be taxable income
- Trading subject to capital gains
- Burning may affect basis
- Consult tax professional

### Verification

**Renewable Energy Validation:**
1. Meter readings verified by Oracle
2. ERCs issued by Governance
3. Registry prevents double-claiming
4. Energy Token prevents double-minting
5. Multi-layer validation

**Supply Verification:**
```
Verify: Total GRID Supply ≤ Total Net Generation Settled

Check periodically:
  On-chain Total Supply (from Token Info)
  vs
  Sum of all settled_net_generation (from Registry)
  
Should always match (within rounding)
```

---

## Summary

The Energy Token Program is the final piece of the GridTokenX ecosystem, converting verified renewable energy generation into liquid, tradeable GRID tokens. By integrating tightly with the Registry Program for settlement tracking and utilizing standard SPL Token infrastructure, it provides a secure, auditable, and user-friendly tokenization layer.

Key design principles:
- **Security First:** Multi-layer validation prevents double-minting
- **Standard Compliance:** Uses SPL Token for maximum compatibility
- **Rich Metadata:** Metaplex integration for excellent UX
- **Registry Integration:** Atomic settlement ensures correctness
- **Transparent Operations:** All minting logged with events

GRID tokens represent real, verified renewable energy generation, enabling prosumers to monetize their clean energy production in a decentralized, transparent, and efficient marketplace.
