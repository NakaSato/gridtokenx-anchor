# GridTokenX - System Flow & Technical Architecture

## 🎯 Overview

This document explains the **system workflow** and **technical implementation** in detail, providing a comprehensive understanding of how each component works together and what technologies are used in development

---

## 📊 System Architecture Overview

```
┌────────────────────────────────────────────────────────────────┐
│                    GridTokenX P2P Energy Trading               │
└────────────────────────────────────────────────────────────────┘

        ┌─────────────────┐              ┌─────────────────┐
        │   Prosumer A    │◄────────────►│   Consumer B    │
        │   (Seller)      │   P2P Trade  │    (Buyer)      │
        └────────┬────────┘              └────────┬────────┘
                 │                                │
                 │         Blockchain Layer       │
                 └───────────────┬────────────────┘
                                 ▼
        ┌─────────────────────────────────────────────┐
        │      Solana Blockchain (PoA Consensus)      │
        │                                             │
        │  ┌──────────────┐      ┌──────────────┐   │
        │  │   Registry   │      │   Trading    │   │
        │  │   Program    │      │   Program    │   │
        │  │  (Identity)  │      │ (Order Book) │   │
        │  └──────────────┘      └──────────────┘   │
        │           │                     │          │
        │           └──────────┬──────────┘          │
        │                      │                     │
        │             ┌────────────────┐             │
        │             │ Energy Token   │             │
        │             │ Program (SPL)  │             │
        │             └────────────────┘             │
        └─────────────────────────────────────────────┘
                              │
                ┌─────────────┴─────────────┐
                │                           │
                ▼                           ▼
        ┌──────────────┐          ┌──────────────┐
        │  PostgreSQL  │          │    Meter     │
        │   (Cache &   │          │  Simulator   │
        │   History)   │          │ (IoT Mock)   │
        └──────────────┘          └──────────────┘
```

### **Key Components**

1. **Blockchain Layer (Solana)**
   - PoA consensus for fast finality (~400ms)
   - Smart contracts written in Rust using Anchor framework
   - Handles all critical trading operations

2. **Smart Contracts**
   - **Registry Program**: User identity and registration
   - **Trading Program**: Order book and matching engine
   - **Energy Token Program**: SPL token for energy units

3. **Off-Chain Infrastructure**
   - **PostgreSQL**: Query optimization and historical data
   - **Meter Simulator**: Mock IoT devices for energy readings

---

## 🔄 Complete User Flows

### **Flow 1: User Registration**

```
┌─────────────────┐
│  User (Wallet)  │
│  Solana Keypair │
└────────┬────────┘
         │
         │ 1. Submit Registration
         │    - Wallet Address
         │    - User Type (Prosumer/Consumer)
         │    - Profile Info
         ▼
┌──────────────────────────────────┐
│    Registration Handler          │
│    (Dual-Write Pattern)          │
└───────┬─────────────┬────────────┘
        │             │
        │             │ Parallel Operations
        ▼             ▼
┌──────────────┐  ┌────────────────────┐
│  PostgreSQL  │  │  Solana Blockchain │
│              │  │                    │
│ • user_id    │  │  • Create PDA      │
│ • wallet_addr│  │  • Store on-chain  │
│ • user_type  │  │  • Emit event      │
│ • metadata   │  │                    │
└──────────────┘  └────────────────────┘
        │             │
        └──────┬──────┘
               ▼
        ┌─────────────┐
        │   Success   │
        │   Response  │
        └─────────────┘
```

**Technical Details:**

1. **Program Derived Address (PDA)**
   - Deterministic address generation
   - Seeds: `[b"user", wallet_address]`
   - No private key needed (program controlled)

2. **Dual-Write Pattern**
   - PostgreSQL: Fast queries, user metadata
   - Solana: Immutable proof, decentralized
   - Consistency via event-driven sync

3. **User Types**
   - **Prosumer**: Can produce and consume (sell energy)
   - **Consumer**: Only consume (buy energy)

---

### **Flow 2: Energy Production Recording**

```
┌──────────────────────────┐
│   Smart Meter (IoT)      │
│   Simulated Device       │
└────────┬─────────────────┘
         │
         │ Periodic Reading (1-5 min)
         │ • Production: Solar/Wind
         │ • Consumption: Home usage
         ▼
┌──────────────────────────────┐
│   Meter Data Processor       │
│   (Time-Series Handler)      │
└────────┬─────────────────────┘
         │
         │ Calculate Surplus
         │ surplus = production - consumption
         ▼
┌──────────────────────────────┐
│   PostgreSQL Storage         │
│   (Time-Series Optimized)    │
│                              │
│ • Indexed by user + time     │
│ • Computed surplus column    │
│ • Aggregation for analytics  │
└──────────────────────────────┘
         │
         │ Surplus Available
         ▼
┌──────────────────────────────┐
│   Mint Energy Tokens         │
│   (If surplus > 0)           │
│   1 kWh = 1,000,000 tokens   │
└──────────────────────────────┘
```

**Technical Concepts:**

1. **Time-Series Data Management**
   - High-frequency inserts (~1000 TPS)
   - Index optimization: `(user_id, timestamp)`
   - Computed column for surplus (PostgreSQL)

2. **Energy Token Minting**
   - **Ratio**: 1 kWh = 1 token (6 decimals)
   - **Trigger**: When surplus > 0
   - **SPL Token Standard**: Fungible, transferable

3. **Data Granularity**
   - Reading interval: 1-5 minutes
   - Aggregation: Hourly, daily summaries
   - Retention: Full history for audit

---

### **Flow 2.5: Energy Token Minting Process**

```
┌──────────────────────────────────────────────────────────────┐
│              Energy Token Minting Flow                       │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────┐
│   Meter Reading      │
│   surplus > 0        │
└──────────┬───────────┘
           │
           │ Trigger: Surplus Detected
           │ Example: 15 kWh produced - 8 kWh consumed = 7 kWh surplus
           ▼
┌──────────────────────────────┐
│   Validate Mint Request      │
│   (Backend Service)          │
└──────────┬───────────────────┘
           │
           │ Checks:
           │ • Surplus > 0
           │ • User is Prosumer
           │ • Meter authorized
           │ • No duplicate mint
           ▼
┌──────────────────────────────┐
│   Call Solana Program        │
│   token_program.mint()       │
└──────────┬───────────────────┘
           │
           │ Smart Contract Execution
           ├─────────────────────────────────────┐
           ▼                                     ▼
  ┌────────────────────┐              ┌──────────────────┐
  │  Create Mint TX    │              │  Verify Authority│
  │                    │              │                  │
  │ • Amount: 7 tokens │              │ • Check PDA      │
  │ • To: Prosumer A   │              │ • Verify signer  │
  │ • Decimals: 6      │              │ • Validate limit │
  └────────┬───────────┘              └────────┬─────────┘
           │                                     │
           └──────────────┬──────────────────────┘
                          ▼
           ┌──────────────────────────┐
           │  Mint 7,000,000 tokens   │
           │  (7 kWh × 1M decimals)   │
           └──────────┬───────────────┘
                      │
                      │ Transfer to Prosumer Wallet
                      ▼
           ┌──────────────────────────┐
           │  Update Token Balance    │
           │  Prosumer A: +7 tokens   │
           └──────────┬───────────────┘
                      │
                      │ Emit Event
                      ▼
           ┌──────────────────────────┐
           │  emit!(TokensMinted {    │
           │    user: WalletA,        │
           │    amount: 7_000_000,    │
           │    surplus_kwh: 7.0      │
           │  })                      │
           └──────────┬───────────────┘
                      │
                      │ Sync to Database
                      ▼
           ┌──────────────────────────┐
           │  PostgreSQL Update       │
           │                          │
           │  INSERT token_mints:     │
           │  • user_id: 1            │
           │  • amount: 7_000_000     │
           │  • surplus_kwh: 7.0      │
           │  • tx_sig: "abc123..."   │
           │  • timestamp: NOW()      │
           └──────────┬───────────────┘
                      │
                      ▼
           ┌──────────────────────────┐
           │  Mint Complete ✅        │
           │  Prosumer can now sell   │
           └──────────────────────────┘
```

**Token Minting Details:**

1. **Mint Authority**
   - Controlled by Program PDA
   - Seeds: `[b"mint_authority", program_id]`
   - Only authorized calls can mint
   - Prevents unauthorized token creation

2. **Calculation**
   ```
   Surplus (kWh) = Production - Consumption
   Tokens (base units) = Surplus × 1,000,000 (6 decimals)
   
   Example:
   Production: 25.5 kWh
   Consumption: 10.2 kWh
   Surplus: 15.3 kWh
   Tokens Minted: 15,300,000 base units = 15.3 tokens
   ```

3. **Security Measures**
   - **Authority Check**: Only authorized meter can trigger mint
   - **Duplicate Prevention**: Check if already minted for this reading
   - **Amount Validation**: Surplus must be positive and reasonable
   - **Rate Limiting**: Maximum mints per time period
   - **Audit Trail**: All mints recorded on-chain and database

4. **Token Specification**
   ```
   Token: GridTokenX Energy Token (GRX-E)
   Standard: SPL Token
   Decimals: 6
   Symbol: GRXE
   Ratio: 1 GRXE = 1 kWh energy
   Mint Authority: Program PDA (controlled)
   Freeze Authority: None (tokens freely transferable)
   ```

5. **Minting Scenarios**

   **Scenario A: High Production Day**
   ```
   Time: 12:00 PM (Solar Peak)
   Production: 35 kWh
   Consumption: 8 kWh
   Surplus: 27 kWh
   → Mint 27,000,000 tokens (27 GRXE)
   ```

   **Scenario B: Low Production**
   ```
   Time: 6:00 PM (Evening)
   Production: 2 kWh
   Consumption: 5 kWh
   Surplus: -3 kWh (Deficit)
   → No minting (surplus must be > 0)
   ```

   **Scenario C: Exact Balance**
   ```
   Time: 9:00 AM
   Production: 10 kWh
   Consumption: 10 kWh
   Surplus: 0 kWh
   → No minting (surplus = 0)
   ```

6. **Database Schema for Minting**
   ```sql
   -- Token mints tracking table
   CREATE TABLE token_mints (
       id SERIAL PRIMARY KEY,
       user_id INTEGER REFERENCES users(id),
       meter_reading_id INTEGER REFERENCES meter_readings(id),
       amount_tokens BIGINT NOT NULL,
       surplus_kwh DECIMAL(10, 4) NOT NULL,
       tx_signature VARCHAR(88) UNIQUE NOT NULL,
       mint_authority VARCHAR(44) NOT NULL,
       created_at TIMESTAMP DEFAULT NOW(),
       
       INDEX idx_user_created (user_id, created_at),
       INDEX idx_tx_sig (tx_signature)
   );
   ```

7. **Error Handling**
   ```
   Possible Errors:
   • InsufficientSurplus: Surplus ≤ 0
   • UnauthorizedMeter: Meter not registered
   • DuplicateMint: Already minted for this reading
   • ExcessiveAmount: Mint amount exceeds limit
   • InvalidAuthority: Caller not authorized
   ```

---

### **Flow 3: P2P Energy Trading**

#### **Part A: Create Sell Order (Maker)**

```
┌──────────────────────┐
│   Prosumer A         │
│   Available: 10 kWh  │
└──────────┬───────────┘
           │
           │ Check Available Balance
           │ (Query surplus from DB)
           ▼
┌──────────────────────────────┐
│   Order Creation Process     │
│   (Atomic Operation)         │
└──────────┬───────────────────┘
           │
           │ Dual Write
           ├─────────────────────┬──────────────────────┐
           ▼                     ▼                      ▼
  ┌────────────────┐   ┌──────────────────┐   ┌──────────────┐
  │  Create PDA    │   │  Lock Tokens     │   │  PostgreSQL  │
  │  (Order Acct)  │   │  in Escrow       │   │  Insert Row  │
  │                │   │                  │   │              │
  │ • Seller       │   │  Transfer:       │   │ • order_id   │
  │ • Amount       │   │  Wallet → Escrow │   │ • status     │
  │ • Price (GRX)  │   │  8,000,000 token │   │ • tx_sig     │
  │ • Status       │   │                  │   │              │
  └────────────────┘   └──────────────────┘   └──────────────┘
           │                     │                      │
           └─────────────────────┴──────────────────────┘
                                 ▼
                        ┌────────────────┐
                        │ Order Active   │
                        │ Visible in     │
                        │ Order Book     │
                        └────────────────┘
```

**Technical Mechanisms:**

1. **Escrow Pattern**
   - Tokens locked in program-controlled account
   - Prevents double-spending
   - Automatic release on match/cancel

2. **Program Derived Address (Order)**
   - Seeds: `[b"order", seller.key(), order_id]`
   - Stores order metadata on-chain
   - Immutable proof of intent

3. **Dual-Write Consistency**
   - Blockchain: Source of truth
   - PostgreSQL: Fast query layer
   - Event-driven sync for consistency

#### **Part B: Order Book Query (Taker)**

```
┌──────────────────────┐
│   Consumer B         │
│   Looking to Buy     │
└──────────┬───────────┘
           │
           │ Query Active Orders
           ▼
┌────────────────────────────────┐
│   Hybrid Query Strategy        │
│   (Performance Optimization)   │
└──────────┬─────────────────────┘
           │
           ├─────────────────┬────────────────┐
           ▼                 ▼                ▼
  ┌────────────────┐  ┌──────────────┐  ┌─────────────┐
  │  PostgreSQL    │  │  Solana RPC  │  │  Combine    │
  │  Fast Query    │  │  Verification│  │  & Format   │
  │                │  │              │  │             │
  │ • Filter       │  │ • Verify     │  │ • Enrich    │
  │ • Sort         │  │ • Validate   │  │ • Present   │
  │ • Paginate     │  │ • Confirm    │  │             │
  └────────────────┘  └──────────────┘  └─────────────┘
           │                 │                │
           └─────────────────┴────────────────┘
                             ▼
                    ┌──────────────────┐
                    │  Order Book      │
                    │  • Price levels  │
                    │  • Depth         │
                    │  • Liquidity     │
                    └──────────────────┘
```

**Query Optimization:**

1. **Hybrid Data Source**
   - **Primary**: PostgreSQL (fast, indexed)
   - **Verification**: Solana RPC (truth source)
   - **Cache**: In-memory for hot data

2. **Index Strategy**
   - Composite: `(status, price, created_at)`
   - Covering index for common queries
   - Partial index on active orders only

3. **Real-time Updates**
   - WebSocket for live order book
   - Event-driven cache invalidation
   - Eventual consistency acceptable (<1s)

#### **Part C: Order Matching & Settlement**

```
┌──────────────────────┐
│   Consumer B         │
│   Accept Order #1    │
└──────────┬───────────┘
           │
           │ Initiate Match
           ▼
┌────────────────────────────────────────────┐
│   Atomic Transaction (All-or-Nothing)      │
│   trading.match_order()                    │
└──────────┬─────────────────────────────────┘
           │
           │ Pre-flight Checks
           ├──────────────────────────────────┐
           ▼                                  ▼
  ┌──────────────────┐            ┌──────────────────┐
  │  Validations     │            │  Balance Checks  │
  │                  │            │                  │
  │ ✓ Order active   │            │ ✓ Buyer has SOL  │
  │ ✓ Amounts match  │            │ ✓ Escrow has     │
  │ ✓ Not self-trade │            │   tokens         │
  └──────────────────┘            └──────────────────┘
           │                                  │
           └────────────┬─────────────────────┘
                        ▼
           ┌────────────────────────┐
           │  Atomic Swap (2-Phase) │
           └────────────┬───────────┘
                        │
        ┌───────────────┴───────────────┐
        ▼                               ▼
┌────────────────────┐        ┌────────────────────┐
│  Phase 1: Tokens   │        │  Phase 2: Payment  │
│                    │        │                    │
│  Escrow → Buyer    │        │  Buyer → Seller    │
│  8,000,000 tokens  │        │  24 GRX            │
│  (8 kWh)           │        │  (8 × 3 GRX)       │
└────────────────────┘        └────────────────────┘
        │                               │
        └───────────────┬───────────────┘
                        ▼
           ┌────────────────────────┐
           │  Finalize              │
           │  • Update order status │
           │  • Emit trade event    │
           │  • Close order PDA     │
           └────────────┬───────────┘
                        ▼
           ┌────────────────────────┐
           │  Settlement Complete   │
           │  TX confirmed on-chain │
           └────────────────────────┘
```

**Critical Technical Concepts:**

1. **Atomic Transaction**
   - All operations succeed or all fail
   - No partial state possible
   - Prevents fund loss

2. **Escrow Release Pattern**
   - Tokens held by program (PDA)
   - Released atomically on match
   - Returned if cancelled

3. **Cross-Program Invocation (CPI)**
   - Trading program calls Token program
   - Signed with PDA (program authority)
   - Maintains composability

4. **Event Emission**
   - `TradeExecuted` event published
   - Event listeners update PostgreSQL
   - Ensures eventual consistency

---

### **Flow 4: Complete End-to-End Trading Journey**

```
┌────────────────────────────────────────────────────────────────┐
│         Complete P2P Energy Trading Journey (Day 1)           │
└────────────────────────────────────────────────────────────────┘

Time: 06:00 AM
┌──────────────────────────────────────┐
│  Morning - System Preparation        │
└──────────┬───────────────────────────┘
           │
           ▼
    Prosumer A registers
    Consumer B registers
    → Both have wallets
    → Both have PDAs created
    → Database updated

Time: 08:00 AM - 12:00 PM
┌──────────────────────────────────────┐
│  Daytime - Energy Production         │
└──────────┬───────────────────────────┘
           │
           ▼
    Smart Meter Reading #1 (08:00)
    ├─ Production: 5 kWh (morning sun)
    ├─ Consumption: 3 kWh
    └─ Surplus: 2 kWh
    → Mint 2,000,000 tokens to Prosumer A
           │
           ▼
    Smart Meter Reading #2 (10:00)
    ├─ Production: 12 kWh (increasing)
    ├─ Consumption: 4 kWh
    └─ Surplus: 8 kWh
    → Mint 8,000,000 tokens to Prosumer A
           │
           ▼
    Smart Meter Reading #3 (12:00)
    ├─ Production: 18 kWh (solar peak)
    ├─ Consumption: 5 kWh
    └─ Surplus: 13 kWh
    → Mint 13,000,000 tokens to Prosumer A

    Total Energy Tokens: 23 GRXE (23,000,000 base units)

Time: 12:30 PM
┌──────────────────────────────────────┐
│  Midday - Order Creation             │
└──────────┬───────────────────────────┘
           │
           ▼
    Prosumer A decides to sell:
    ├─ Available: 23 GRXE
    ├─ Wants to sell: 15 GRXE
    ├─ Keep for self: 8 GRXE
    └─ Price: 3 GRX per kWh
           │
           ▼
    Create Sell Order:
    ┌──────────────────────────────┐
    │ Order #1                     │
    │ Seller: Prosumer A           │
    │ Amount: 15 GRXE (15 kWh)     │
    │ Price: 3 GRX/kWh             │
    │ Total: 45 GRX                │
    │ Status: Active               │
    └──────────┬───────────────────┘
               │
               ▼
    Lock 15 GRXE in Escrow
    ├─ Escrow holds: 15,000,000 tokens
    ├─ Prosumer A remaining: 8 GRXE
    └─ Order visible in order book

Time: 01:00 PM
┌──────────────────────────────────────┐
│  Afternoon - Order Discovery         │
└──────────┬───────────────────────────┘
           │
           ▼
    Consumer B browses order book:
    ┌────────────────────────────────┐
    │ Available Orders:              │
    │                                │
    │ [1] Prosumer A                 │
    │     15 kWh @ 3 GRX/kWh        │
    │     Total: 45 GRX             │
    │     (≈450 THB)                │
    │                                │
    │ [ Buy Now ]                    │
    └────────┬───────────────────────┘
             │
             ▼
    Consumer B selects payment:
    ├─ Option 1: Pay 45 GRX (native)
    └─ Option 2: Pay 450 THB (via Thai Baht Chain)
    
    Consumer B chooses: Pay 450 THB

Time: 01:05 PM
┌──────────────────────────────────────┐
│  Afternoon - Payment & Settlement    │
└──────────┬───────────────────────────┘
           │
           ▼
    Payment Processing:
    ┌──────────────────────────────────┐
    │ Thai Baht Chain                  │
    │ Consumer B → 450 THBC            │
    └──────────┬───────────────────────┘
               │
               ▼
    Bridge Confirmation
    ├─ THB payment verified
    ├─ Create bridge proof
    └─ Send to Solana
               │
               ▼
    Atomic Settlement (Solana):
    ┌──────────────────────────────────┐
    │ Phase 1: Transfer Energy Tokens  │
    │ Escrow → Consumer B              │
    │ Amount: 15,000,000 tokens        │
    └──────────┬───────────────────────┘
               │
               ▼
    ┌──────────────────────────────────┐
    │ Phase 2: Settlement to Seller    │
    │ Convert: 450 THB → 45 GRX        │
    │ Transfer: 45 GRX → Prosumer A    │
    └──────────┬───────────────────────┘
               │
               ▼
    ┌──────────────────────────────────┐
    │ Phase 3: Update States           │
    │ • Order status: Filled           │
    │ • Close order PDA                │
    │ • Emit TradeExecuted event       │
    └──────────┬───────────────────────┘
               │
               ▼
    Transaction Complete ✅

Time: 01:06 PM
┌──────────────────────────────────────┐
│  Post-Trade - Verification           │
└──────────┬───────────────────────────┘
           │
           ▼
    Final Balances:
    
    Prosumer A:
    ├─ Energy Tokens: 8 GRXE (kept for self)
    ├─ GRX Balance: +45 GRX (from sale)
    ├─ THB Equivalent: +450 THB earned
    └─ Can create new orders with remaining 8 GRXE
    
    Consumer B:
    ├─ Energy Tokens: 15 GRXE (purchased)
    ├─ THB Spent: -450 THB
    ├─ Can use energy or resell
    └─ Energy available for consumption

Time: 02:00 PM - 06:00 PM
┌──────────────────────────────────────┐
│  Afternoon - Continued Production    │
└──────────┬───────────────────────────┘
           │
           ▼
    More meter readings...
    ├─ 02:00 PM: +10 kWh surplus → Mint 10 GRXE
    ├─ 04:00 PM: +7 kWh surplus → Mint 7 GRXE
    └─ 06:00 PM: +2 kWh surplus → Mint 2 GRXE
    
    Prosumer A creates another order:
    └─ Sell 12 GRXE @ 3.5 GRX/kWh
    
    Cycle continues... 🔄

┌──────────────────────────────────────────────────────────┐
│              Daily Summary (End of Day 1)                │
└──────────────────────────────────────────────────────────┘

Prosumer A:
├─ Total Production: 65 kWh
├─ Total Consumption: 20 kWh
├─ Total Surplus: 45 kWh
├─ Tokens Minted: 45 GRXE
├─ Tokens Sold: 15 GRXE
├─ Tokens Remaining: 30 GRXE
├─ GRX Earned: 45 GRX
└─ THB Equivalent: 450 THB

Consumer B:
├─ Total Consumption: 25 kWh
├─ Tokens Purchased: 15 GRXE
├─ THB Spent: 450 THB
└─ Energy Available: 15 kWh

System Stats:
├─ Total Trades: 1
├─ Total Energy Traded: 15 kWh
├─ Total Value: 45 GRX (450 THB)
├─ Transaction Time: < 1 minute
└─ All parties satisfied ✅
```

**Key Insights from Complete Flow:**

1. **Multiple Minting Events**
   - Tokens minted throughout the day as surplus accumulates
   - Each meter reading can trigger minting if surplus > 0
   - Cumulative token balance grows with production

2. **Flexible Selling**
   - Prosumer can choose how much to sell vs keep
   - Can create multiple orders at different prices
   - Remaining tokens available for future sales

3. **Payment Options**
   - Native GRX payment (instant)
   - Thai Baht Chain payment (cross-chain)
   - Both methods equally secure and fast

4. **Real-time Settlement**
   - Complete trade in < 1 minute
   - Atomic execution prevents failures
   - All updates synchronized across systems

5. **Continuous Operation**
   - System operates 24/7
   - New readings every 1-5 minutes
   - Orders can be created/matched anytime
   - No downtime for maintenance

---

## 🔐 Security Architecture

### **Smart Contract Security Layers**

```
┌────────────────────────────────────────────────┐
│            Security Validation Layers                │
└────────────────────────────────────────────────┘

 Layer 1: Input Validation
 ┌──────────────────────────────────────────┐
 │ • Type checking                          │
 │ • Range validation                       │
 │ • Format verification                    │
 └──────────────────────────────────────────┘
                    │
                    ▼
 Layer 2: Business Logic Checks
 ┌──────────────────────────────────────────┐
 │ • Self-trading prevention              │
 │ • Order status validation               │
 │ • Amount matching                       │
 └──────────────────────────────────────────┘
                    │
                    ▼
 Layer 3: Balance & Authority
 ┌──────────────────────────────────────────┐
 │ • Sufficient balance check             │
 │ • Authority verification                │
 │ • Signature validation                  │
 └──────────────────────────────────────────┘
                    │
                    ▼
 Layer 4: Atomic Operations
 ┌──────────────────────────────────────────┐
 │ • State updates before CPI             │
 │ • Re-entrancy guards                    │
 │ • Overflow protection (checked_*)       │
 └──────────────────────────────────────────┘
```

**Key Security Techniques:**

1. **Self-Trading Prevention**
   - Prevents wash trading attacks
   - Validates `buyer != seller`
   - Maintains market integrity

2. **Escrow Pattern**
   - Tokens locked until settlement
   - Program-controlled release
   - Prevents double-spending

3. **Atomic Transactions**
   - All-or-nothing execution
   - No partial state possible
   - Prevents fund loss scenarios

4. **Overflow Protection**
   - Use `checked_mul()`, `checked_add()`
   - Prevents integer overflow attacks
   - Validates all arithmetic

5. **Re-entrancy Guards**
   - State updates before external calls
   - Prevents recursive exploitation
   - Follows checks-effects-interactions pattern

---

## 🗄️ Data Architecture

### **Database Design Principles**

**PostgreSQL Schema Strategy:**

1. **Users Table**
   - Stores wallet addresses and user profiles
   - Links to Solana PDA for on-chain identity
   - Indexed by wallet address for fast lookups

2. **Meter Readings Table**
   - Time-series data with high insert frequency
   - Computed surplus column (generated)
   - Composite index: `(user_id, timestamp)`
   - Enables efficient range queries

3. **Orders Table**
   - Tracks active and historical orders
   - References Solana order PDA
   - Partial index on active orders only
   - Status transitions: active → filled/cancelled

4. **Transactions Table**
   - Immutable trade records
   - Foreign keys to buyers and sellers
   - Indexed for historical queries
   - Synced from blockchain events

**Index Strategy:**
```
Composite Indexes:
- (user_id, timestamp) for meter readings
- (status, price, created_at) for order book
- (seller_id, timestamp) for trade history
- (buyer_id, timestamp) for purchase history

Partial Indexes:
- WHERE status = 'active' for orders
- WHERE timestamp > NOW() - INTERVAL '30 days'
```

**Data Retention:**
- Meter readings: Full history (audit trail)
- Orders: Archive after 90 days
- Transactions: Permanent retention
- User profiles: Active until account closure

---

## 📊 Data Synchronization Architecture

### **Event-Driven Sync Pattern**

```
┌────────────────────────────────────────────────┐
│         Blockchain-Database Synchronization         │
└────────────────────────────────────────────────┘

┌────────────────────────────────────────────────┐
│              Solana Programs                      │
│                                                    │
│  emit!(UserRegistered { ... })                   │
│  emit!(OrderCreated { ... })                     │
│  emit!(TradeExecuted { ... })                    │
└─────────────────────┬───────────────────────────┘
                     │
                     │ Event Stream
                     ▼
┌────────────────────────────────────────────────┐
│           Event Listener Service                  │
│           (WebSocket Connection)                  │
│                                                    │
│  • Subscribe to program logs                     │
│  • Parse event data                              │
│  • Transform to DB format                        │
└─────────────────────┬───────────────────────────┘
                     │
                     │ Database Operations
                     ▼
┌────────────────────────────────────────────────┐
│              PostgreSQL                           │
│                                                    │
│  UserRegistered → INSERT users                   │
│  OrderCreated   → INSERT orders                  │
│  TradeExecuted  → INSERT transactions           │
│                    UPDATE orders.status           │
└────────────────────────────────────────────────┘
```

**Sync Mechanisms:**

1. **Event Sourcing**
   - Blockchain as source of truth
   - Events published on-chain
   - Immutable audit trail

2. **Eventual Consistency**
   - Acceptable lag (<1 second)
   - Idempotent operations
   - Retry logic for failures

3. **Conflict Resolution**
   - Blockchain always wins
   - Database as cache/query layer
   - Periodic reconciliation

---

## ⚡ Performance Optimization

### **Multi-Layer Performance Strategy**

```
┌────────────────────────────────────────────────┐
│           Performance Metrics (Target)              │
└────────────────────────────────────────────────┘

Blockchain Layer (PoA)
┌──────────────────────────────────────────┐
│ Block Time:        ~400ms              │
│ Tx Finality:       Immediate           │
│ Registry TPS:      ~200                │
│ Trading TPS:       ~50-100             │
│ Meter TPS:         ~1000               │
└──────────────────────────────────────────┘

Database Layer (PostgreSQL)
┌──────────────────────────────────────────┐
│ Query Time:        <100ms (P95)        │
│ Index Strategy:    Composite + Partial │
│ Connection Pool:   20-50 connections   │
│ Cache Hit Rate:    >80%                │
└──────────────────────────────────────────┘

End-to-End Latency
┌──────────────────────────────────────────┐
│ User Request:      ~50ms               │
│ API Processing:    ~100ms              │
│ Blockchain:        ~400ms              │
│ Event Processing:  ~50ms               │
│ Total:             ~600ms              │
└──────────────────────────────────────────┘
```

**Optimization Techniques:**

1. **Smart Contract Optimization**
   - Minimize compute units
   - Efficient account packing
   - Zero-copy deserialization

2. **Database Optimization**
   - Composite indexes on hot queries
   - Partial indexes for active data
   - Connection pooling
   - Query result caching

3. **Caching Strategy**
   - In-memory cache (Redis optional)
   - Order book cache with TTL
   - User profile cache

---

## 🔍 Monitoring & Observability

### **Key Metrics Dashboard**

**Blockchain Metrics:**
- Block production rate
- Transaction success rate (target: >99%)
- Account creation rate
- Token mint/burn events

**Trading Metrics:**
- Active orders count
- Match rate (orders filled / orders created)
- Average order lifetime
- Price discovery (spread analysis)
- Trading volume (kWh & SOL)

**System Health:**
- API response time (P50, P95, P99)
- Database query performance
- Event listener lag
- Error rate by endpoint

**Business Metrics:**
- Daily active users
- Energy traded (kWh)
- Value transferred (GRX)
- Prosumer vs Consumer ratio

---

## 🎯 Design Philosophy

### **Core Principles**

1. **Simplicity Over Complexity**
   - PoA instead of complex consensus
   - Order book instead of AMM
   - Direct price agreement (no oracle)

2. **Hybrid Architecture**
   - Blockchain for critical data
   - PostgreSQL for fast queries
   - Best of both worlds

3. **Security First**
   - Multiple validation layers
   - Atomic transactions
   - Escrow patterns

4. **Demo-Friendly**
   - Fast execution (<1s trades)
   - Visual feedback
   - Reproducible setup

5. **Production-Ready Path**
   - Scalable to multi-validator
   - Migrable to mainnet
   - Modular architecture

---

## 📦 Technology Stack

### **Blockchain Layer**
```
Solana v1.18+
├─ Consensus: Proof of Authority (PoA)
├─ Smart Contracts: Anchor Framework v0.32.1
├─ Token Standard: SPL Token Program
└─ Language: Rust

Thai Baht Chain (Payment Layer)
├─ Network: Thai Baht Chain (Ethereum-compatible)
├─ Payment Token: THBC (Thai Baht Coin)
├─ Bridge Protocol: Cross-chain message passing
└─ Settlement: Instant THB payment confirmation
```

### **Payment Integration**
```
Thai Baht Chain Integration
├─ Bridge: Cross-chain connector
├─ Payment Token: THBC (Thai Baht Coin)
├─ Settlement: Real-time THB settlement
└─ Exchange Rate: Dynamic GRX ↔ THB conversion
```

### **Infrastructure**
```
Development
├─ Validator: solana-test-validator (local)
├─ Database: PostgreSQL (local)
└─ Meter Simulator

Production (Future)
├─ Validator: Solana devnet/mainnet
├─ Database: PostgreSQL
├─ Cache: Redis (optional)
└─ Monitoring: Prometheus + Grafana
```

---

**Summary**: This document explains the **system flows and technical approaches** used in the GridTokenX P2P Energy Trading Platform, focusing on architectural understanding and operational mechanisms rather than step-by-step implementation guide ✅
