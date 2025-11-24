# GridTokenX - P2P Energy Trading Architecture

## 🎯 Executive Summary

ระบบ **Peer-to-Peer (P2P) Energy Trading** บน Solana blockchain ที่ใช้ **Proof of Authority (PoA)** consensus โดยเน้นความเรียบง่าย สามารถทำได้จริง และสาธิตได้ชัดเจน

---

## 🏗️ System Architecture

### **High-Level Overview**

```
┌────────────────────────────────────────────────────────────────┐
│                      P2P Energy Trading System                  │
└────────────────────────────────────────────────────────────────┘

┌─────────────┐                                    ┌─────────────┐
│  Prosumer A │ ◄─────────────────────────────────►│ Consumer B  │
│ (Seller)    │         Direct P2P Trade           │  (Buyer)    │
└──────┬──────┘                                    └──────┬──────┘
       │                                                  │
       │                                                  │
       └──────────────────────┬───────────────────────────┘
                              │
                    Settlement & Clearing
                              │
                              ▼
        ┌─────────────────────────────────────────┐
        │      Solana Blockchain (PoA Local)      │
        │                                         │
        │  ┌────────────┐  ┌────────────┐       │
        │  │  Registry  │  │  Trading   │       │
        │  │  Program   │  │  Program   │       │
        │  └────────────┘  └────────────┘       │
        │         ▲              ▲               │
        │         │              │               │
        │         └──────┬───────┘               │
        │                │                       │
        │         ┌──────────────┐              │
        │         │ Energy Token │              │
        │         │   Program    │              │
        │         └──────────────┘              │
        └─────────────────────────────────────────┘
                              │
                              │
                ┌─────────────┴─────────────┐
                │                           │
                ▼                           ▼
        ┌──────────────┐          ┌──────────────┐
        │  PostgreSQL  │          │    Meter     │
        │   Database   │          │  Simulator   │
        └──────────────┘          └──────────────┘
```

---

## 🔐 Proof of Authority (PoA) Architecture

### **Why PoA?**

| Feature | PoA (Our Choice) | PoW | PoS |
|---------|------------------|-----|-----|
| **Setup Time** | ⚡ Minutes | 🐌 Hours | 🐌 Hours |
| **Resource Usage** | 💚 Very Low | 🔴 Very High | 🟡 Medium |
| **Transaction Speed** | ⚡ < 1 second | 🐌 Minutes | 🟡 Seconds |
| **Cost** | 💰 Free (Local) | 💸 Expensive | 💰 Medium |
| **Control** | ✅ Full Control | ❌ Distributed | ❌ Distributed |
| **Demo Suitability** | ✅ Perfect | ❌ Impractical | 🟡 Complex |

### **PoA Node Configuration**

```yaml
# Solana PoA Validator Configuration
Network Type: Local (Private)
Consensus: Proof of Authority
Authority Nodes: 1 (can scale to 3-5)
Block Time: ~400ms
Transaction Finality: Immediate
Gas Fees: None (Local)

Validator Setup:
- Single authority node runs locally
- No mining/staking required
- Immediate block production
- Full control over network state
```

### **PoA vs Traditional Consensus**

```
┌─────────────────────────────────────────────────────────────┐
│                    Transaction Flow                         │
└─────────────────────────────────────────────────────────────┘

Traditional PoW/PoS:
User → Submit TX → Mempool → Wait for Miner → Block → Confirm
                              (Minutes)        (6 blocks)
       ├──────────────────────────────────────────────┤
                     5-60 minutes

Our PoA:
User → Submit TX → Authority Node → Block → Confirmed
                   (< 1 second)     (Immediate)
       ├───────────────────┤
            < 1 second
```

---

## 🏦 Order Book Architecture

### **Decentralized Order Book on Solana**

```
┌────────────────────────────────────────────────────────────┐
│                    Order Book Structure                    │
└────────────────────────────────────────────────────────────┘

On-Chain State (Solana):
┌──────────────────────────────────────────┐
│           Order PDAs (Accounts)          │
│                                          │
│  Order #1: ┌──────────────────────┐    │
│            │ Seller: PubkeyA      │    │
│            │ Amount: 10 kWh       │    │
│            │ Price: 3 GRX/kWh     │    │
│            │ Status: Active       │    │
│            │ Escrow: TokenAccount │    │
│            └──────────────────────┘    │
│                                          │
│  Order #2: ┌──────────────────────┐    │
│            │ Seller: PubkeyB      │    │
│            │ Amount: 5 kWh        │    │
│            │ Price: 3.2 GRX/kWh   │    │
│            │ Status: Active       │    │
│            │ Escrow: TokenAccount │    │
│            └──────────────────────┘    │
└──────────────────────────────────────────┘

Off-Chain Index (PostgreSQL):
┌──────────────────────────────────────────┐
│        Order Book Cache & History        │
│                                          │
│  • Active orders (for fast query)       │
│  • Historical trades                     │
│  • User transaction history              │
│  • Market statistics                     │
└──────────────────────────────────────────┘
```

### **Order Lifecycle**

```
┌──────────┐
│ Created  │ ─── Prosumer creates order
└────┬─────┘     • Lock tokens in escrow
     │           • Publish to order book
     │
     ▼
┌──────────┐
│ Active   │ ─── Order visible in order book
└────┬─────┘     • Can be matched by buyers
     │           • Can be cancelled by seller
     │
     ├─────► Match Found
     │
     ▼
┌──────────┐
│ Matching │ ─── Smart contract executing
└────┬─────┘     • Transfer tokens
     │           • Transfer SOL
     │           • Update states
     │
     ▼
┌──────────┐
│ Filled   │ ─── Trade completed
└──────────┘     • Tokens transferred
                 • Payment settled
                 • Order closed

Alternative Path:
Active ──► Cancelled ──► Tokens returned to seller
```

---

## 💱 P2P Trading Mechanism

### **Price Discovery (P2P Agreement)**

```
┌────────────────────────────────────────────────────────────┐
│           P2P Price Discovery (No Oracle Needed)           │
└────────────────────────────────────────────────────────────┘

Method 1: Seller Sets Price
┌─────────────────────────────────────────────────────────┐
│ Prosumer A:                                             │
│  "I have 10 kWh to sell"                               │
│  "My price: 3 GRX/kWh"                                 │
│  "Total: 30 GRX"                                       │
│                                                         │
│ Consumer B views order book:                           │
│  [1] 10 kWh @ 3.0 GRX/kWh = 30 GRX  ← Accept/Reject  │
│  [2] 5 kWh @ 3.2 GRX/kWh = 16 GRX   ← Accept/Reject  │
│                                                         │
│ Consumer B: "I accept order #1"                        │
└─────────────────────────────────────────────────────────┘

Method 2: Buyer Makes Offer (Optional)
┌─────────────────────────────────────────────────────────┐
│ Consumer B:                                             │
│  "I want to buy 10 kWh"                                │
│  "My offer: 2.8 GRX/kWh"                               │
│                                                         │
│ Prosumer A views buy offers:                           │
│  [1] 10 kWh @ 2.8 GRX/kWh = 28 GRX  ← Accept/Reject  │
│                                                         │
│ Prosumer A: "I accept this offer"                      │
└─────────────────────────────────────────────────────────┘

Our Implementation: Method 1 (Simpler)
✅ Seller sets price (like listing on marketplace)
✅ Buyer accepts or rejects (like shopping)
✅ No complex negotiation needed
```

### **Token Economics**

```
┌────────────────────────────────────────────────────────────┐
│                    Energy Token Model                      │
└────────────────────────────────────────────────────────────┘

Token Specification:
- Name: GridTokenX Energy (GRX)
- Standard: SPL Token (Solana)
- Decimals: 6
- 1 Token = 1 kWh energy
- Example: 10.5 kWh = 10,500,000 base units

Token Flow:
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  Prosumer Production         Token Lifecycle            │
│        │                                                │
│        ▼                                                │
│  ┌──────────┐                                          │
│  │  Meter   │ ──► 15 kWh produced                     │
│  │ Reading  │     -8 kWh consumed                      │
│  └──────────┘     = 7 kWh surplus                      │
│        │                                                │
│        ▼                                                │
│  ┌──────────┐                                          │
│  │  Mint    │ ──► Mint 7,000,000 tokens               │
│  │  Tokens  │     to Prosumer wallet                   │
│  └──────────┘                                          │
│        │                                                │
│        ▼                                                │
│  ┌──────────┐                                          │
│  │  Sell    │ ──► Create order: 5 kWh @ 3 GRX        │
│  │  Order   │     Lock 5,000,000 tokens in escrow     │
│  └──────────┘                                          │
│        │                                                │
│        ▼                                                │
│  ┌──────────┐                                          │
│  │  Trade   │ ──► Transfer 5,000,000 tokens → Buyer  │
│  │ Execute  │     Transfer 15 GRX → Seller            │
│  └──────────┘                                          │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

---

## 🔄 Complete Trading Flow (Detailed)

### **Step-by-Step P2P Trading Process**

```
┌────────────────────────────────────────────────────────────┐
│                    Step 1: Preparation                     │
└────────────────────────────────────────────────────────────┘

Prosumer A:
├─ Has Solana wallet: WalletA
├─ Registered in system: UserID = 1
├─ Meter reading: 20 kWh produced, 8 kWh consumed
├─ Energy tokens: 12,000,000 tokens (12 kWh)
└─ Wants to sell: 10 kWh @ 3 GRX/kWh

Consumer B:
├─ Has Solana wallet: WalletB
├─ Registered in system: UserID = 2
├─ GRX balance: 100 GRX
├─ Energy tokens: 0 tokens
└─ Wants to buy: 10 kWh of energy

┌────────────────────────────────────────────────────────────┐
│              Step 2: Create Sell Order (On-Chain)          │
└────────────────────────────────────────────────────────────┘

Prosumer A executes:
POST /api/trading/orders/create
{
  "seller_wallet": "WalletA",
  "amount_kwh": 10.0,
  "price_per_kwh": 3.0
}

Backend calls Solana program:
┌──────────────────────────────────────────┐
│  trading_program.create_order()          │
│                                          │
│  1. Create Order PDA                     │
│     ├─ Address: OrderPDA_1               │
│     ├─ Seller: WalletA                   │
│     ├─ Amount: 10,000,000 tokens         │
│     ├─ Price: 3 GRX/kWh                  │
│     └─ Status: Active                    │
│                                          │
│  2. Lock Tokens in Escrow                │
│     ├─ Transfer from: WalletA token acct │
│     ├─ Transfer to: Escrow token acct    │
│     └─ Amount: 10,000,000 tokens         │
│                                          │
│  3. Emit Event: OrderCreated             │
│     └─ order_id: OrderPDA_1              │
└──────────────────────────────────────────┘

Result:
✅ Order created on-chain
✅ 10 kWh locked in escrow
✅ Prosumer A has 2 kWh remaining

┌────────────────────────────────────────────────────────────┐
│              Step 3: View Order Book (Query)               │
└────────────────────────────────────────────────────────────┘

Consumer B queries:
GET /api/trading/orders/active

Backend fetches:
1. Query Solana: Get all active Order PDAs
2. Query PostgreSQL: Get seller info
3. Combine and format

Response:
{
  "orders": [
    {
      "order_id": "OrderPDA_1",
      "seller": {
        "wallet": "WalletA",
        "name": "Solar Home A",
        "user_type": "prosumer"
      },
      "amount_kwh": 10.0,
      "price_per_kwh": 3.0,
      "total_price_grx": 30.0,
      "created_at": "2025-11-24T10:30:00Z"
    }
  ]
}

Consumer B sees:
┌────────────────────────────────────────────┐
│         Available Orders                   │
│                                            │
│  [1] Solar Home A                         │
│      Amount: 10 kWh                       │
│      Price: 3.0 GRX/kWh                   │
│      Total: 30 GRX                        │
│      Created: 5 mins ago                  │
│                                            │
│      [ Buy Now ]  [ Details ]             │
└────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│            Step 4: Match Order (Trade Execution)           │
└────────────────────────────────────────────────────────────┘

Consumer B accepts:
POST /api/trading/orders/match
{
  "buyer_wallet": "WalletB",
  "order_id": "OrderPDA_1"
}

Backend calls Solana program:
┌──────────────────────────────────────────────────────────┐
│  trading_program.match_order()                           │
│                                                          │
│  Pre-checks:                                            │
│  ✓ Order exists and active                             │
│  ✓ Buyer has sufficient GRX (30 GRX)                   │
│  ✓ Escrow has tokens (10,000,000 tokens)               │
│  ✓ Buyer != Seller (no self-trading)                   │
│                                                          │
│  Atomic Transaction (All or Nothing):                   │
│                                                          │
│  1. Transfer Energy Tokens                              │
│     ┌─────────────────────────────────────┐            │
│     │ From: Escrow Account                │            │
│     │ To: WalletB Token Account           │            │
│     │ Amount: 10,000,000 tokens (10 kWh)  │            │
│     └─────────────────────────────────────┘            │
│                                                          │
│  2. Transfer GRX Payment                                │
│     ┌─────────────────────────────────────┐            │
│     │ From: WalletB                       │            │
│     │ To: WalletA                         │            │
│     │ Amount: 30,000,000 base units       │            │
│     │         (30 GRX)                    │            │
│     └─────────────────────────────────────┘            │
│                                                          │
│  3. Update Order Status                                 │
│     ┌─────────────────────────────────────┐            │
│     │ OrderPDA_1.status = Filled          │            │
│     │ OrderPDA_1.filled_at = timestamp    │            │
│     │ OrderPDA_1.buyer = WalletB          │            │
│     └─────────────────────────────────────┘            │
│                                                          │
│  4. Emit Event: TradeExecuted                           │
│     ┌─────────────────────────────────────┐            │
│     │ order_id: OrderPDA_1                │            │
│     │ seller: WalletA                     │            │
│     │ buyer: WalletB                      │            │
│     │ amount: 10 kWh                      │            │
│     │ price: 30 GRX                       │            │
│     └─────────────────────────────────────┘            │
└──────────────────────────────────────────────────────────┘

Transaction Result:
┌────────────────────────────────────────────────────────┐
│  TX Signature: 5KL9mN2pQ3rS4tU5vW6xY7zA8bC9dE0f...   │
│                                                        │
│  Changes:                                             │
│  ├─ Prosumer A:                                       │
│  │  └─ GRX: +30 GRX                                  │
│  │  └─ Energy Tokens: -10 kWh                        │
│  │                                                    │
│  └─ Consumer B:                                       │
│     └─ GRX: -30 GRX                                  │
│     └─ Energy Tokens: +10 kWh                        │
│                                                        │
│  Status: ✅ Confirmed (Block #12345)                  │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│              Step 5: Record Transaction (Off-Chain)        │
└────────────────────────────────────────────────────────────┘

Backend saves to PostgreSQL:
INSERT INTO transactions (
  seller_id,
  buyer_id,
  amount_kwh,
  price_per_kwh,
  total_sol,
  tx_signature,
  timestamp
) VALUES (
  1,                                  -- Prosumer A
  2,                                  -- Consumer B
  10.0,
  3.0,
  30.0,
  '5KL9mN2pQ3rS4tU5vW6xY7zA8b...',
  '2025-11-24 10:35:00'
);

UPDATE orders SET
  status = 'filled',
  filled_at = NOW()
WHERE id = 'OrderPDA_1';

┌────────────────────────────────────────────────────────────┐
│              Step 6: Confirmation & Verification           │
└────────────────────────────────────────────────────────────┘

Both users can verify:

Prosumer A checks:
GET /api/trading/history?user_id=1
└─ Shows: Sold 10 kWh to Consumer B for 30 GRX

Consumer B checks:
GET /api/trading/history?user_id=2
└─ Shows: Bought 10 kWh from Prosumer A for 30 GRX

On-chain verification:
solana account WalletA
└─ GRX Balance: Previous + 30 GRX

solana account WalletB
└─ Token balance: 10,000,000 tokens (10 kWh)

Final Balances:
┌──────────────┬─────────────┬──────────────────┐
│ User         │ GRX         │ Energy Tokens    │
├──────────────┼─────────────┼──────────────────┤
│ Prosumer A   │ +30 GRX     │ 2 kWh (2M)      │
│ Consumer B   │ -30 GRX     │ 10 kWh (10M)    │
└──────────────┴─────────────┴──────────────────┘
```

---

## 🛡️ Security & Safety Mechanisms

### **Smart Contract Security**

```
┌────────────────────────────────────────────────────────────┐
│                    Security Checks                         │
└────────────────────────────────────────────────────────────┘

1. Authority Validation
   ✓ Only order owner can cancel
   ✓ Only authorized addresses can match

2. Self-Trading Prevention
   ✓ require!(buyer != seller)
   ✓ Prevents wash trading

3. Balance Checks
   ✓ Verify buyer has sufficient GRX
   ✓ Verify escrow has tokens
   ✓ Verify amounts match

4. Re-entrancy Protection
   ✓ State updates before external calls
   ✓ Reentrancy guard flags

5. Overflow Protection
   ✓ Use checked_mul, checked_add
   ✓ Prevent integer overflow attacks

6. Atomic Transactions
   ✓ All or nothing execution
   ✓ Rollback on any failure
```

### **Error Handling**

```rust
// Example error codes
#[error_code]
pub enum ErrorCode {
    #[msg("Insufficient balance")]
    InsufficientBalance,
    
    #[msg("Order not found or inactive")]
    InvalidOrder,
    
    #[msg("Self-trading not allowed")]
    SelfTradingNotAllowed,
    
    #[msg("Amount mismatch")]
    AmountMismatch,
    
    #[msg("Unauthorized")]
    Unauthorized,
    
    #[msg("Re-entrancy detected")]
    ReentrancyDetected,
}
```

---

## 📊 Data Architecture

### **On-Chain vs Off-Chain Data**

```
┌────────────────────────────────────────────────────────────┐
│                    Data Distribution                       │
└────────────────────────────────────────────────────────────┘

On-Chain (Solana):
┌─────────────────────────────────────────┐
│ Critical Trading Data                   │
│                                         │
│ ✓ Order details (PDA)                  │
│ ✓ Token balances                       │
│ ✓ Escrow accounts                      │
│ ✓ Trade execution records              │
│ ✓ User registration PDAs               │
│                                         │
│ Why: Immutable, verifiable, secure     │
└─────────────────────────────────────────┘

Off-Chain (PostgreSQL):
┌─────────────────────────────────────────┐
│ Supplementary Data                      │
│                                         │
│ ✓ User profiles (name, type)          │
│ ✓ Meter readings (historical)          │
│ ✓ Transaction history (cache)          │
│ ✓ Market statistics                    │
│ ✓ Search indexes                       │
│                                         │
│ Why: Fast queries, flexible schema     │
└─────────────────────────────────────────┘

Synchronization:
Backend monitors Solana events → Updates PostgreSQL
```

### **Database-Blockchain Sync**

```
Event-Driven Synchronization:

Solana Event                PostgreSQL Update
─────────────              ──────────────────
OrderCreated     ────►     INSERT into orders
TradeExecuted    ────►     INSERT into transactions
                           UPDATE orders.status
OrderCancelled   ────►     UPDATE orders.status
UserRegistered   ────►     INSERT into users

Flow:
┌──────────────┐         ┌──────────────┐
│   Solana     │ Events  │   Backend    │
│   Program    │────────►│   Listener   │
└──────────────┘         └──────┬───────┘
                                │
                                │ Update
                                ▼
                         ┌──────────────┐
                         │  PostgreSQL  │
                         │   Database   │
                         └──────────────┘
```

---

## 🚀 Scalability Considerations

### **Current Design (MVP)**

```
Throughput:
- Orders per second: ~100
- Matches per second: ~50
- Meter readings per second: ~1000

Limitations:
- Single validator node
- Local network only
- No network latency
```

### **Future Scaling Path**

```
Phase 1 (Current):
└─ Single PoA validator
   └─ Local network
      └─ ~100 TPS

Phase 2 (Scale Up):
└─ 3-5 PoA validators
   └─ Private network
      └─ ~500 TPS

Phase 3 (Production):
└─ Migrate to Solana devnet/mainnet
   └─ Public network
      └─ ~3000 TPS (Solana capacity)
```

---

## 🎯 Design Decisions & Rationale

### **Key Architectural Choices**

| Decision | Rationale | Trade-offs |
|----------|-----------|------------|
| **PoA Consensus** | Fast, simple, full control | Centralized (acceptable for demo) |
| **Order Book Model** | Familiar, transparent pricing | More complex than AMM |
| **P2P Price Agreement** | No oracle needed, saves cost | Manual pricing (acceptable for MVP) |
| **Hybrid Storage** | Best of both worlds | Sync complexity |
| **SPL Token Standard** | Battle-tested, compatible | Standard features only |
| **Single Validator** | Simplest setup | Single point of failure |

### **What We Optimized For**

```
✅ Demo-ability: Easy to show and explain
✅ Development Speed: Can finish in 4 weeks
✅ Cost: Free to run locally
✅ Simplicity: Understandable by non-technical audience
✅ Reliability: Proven technologies
```

### **What We Sacrificed**

```
❌ Full Decentralization: Using PoA
❌ Real-time Metering: Using batch data
❌ Advanced Features: No AMM, no derivatives
❌ Production Scale: Local only for now
❌ Oracle Integration: Manual pricing
```

---

## 📈 Performance Characteristics

### **Transaction Times**

```
Typical Transaction Latency:

User Request ──► Backend API ──► Solana ──► Confirmation
     ~50ms          ~100ms       ~400ms      ~50ms
     
Total: ~600ms end-to-end

Breakdown:
├─ Network latency: ~50ms (local)
├─ API processing: ~100ms
├─ Blockchain consensus: ~400ms (1 slot)
└─ Event processing: ~50ms
```

### **Throughput Estimates**

```
Component              Capacity
──────────────────────────────────
Registry (register)    ~200 TPS
Trading (create order) ~100 TPS
Trading (match order)  ~50 TPS
Meter (readings)       ~1000 TPS

Bottleneck: Trading program (compute-intensive)
```

---

## 🔍 Monitoring & Observability

### **Key Metrics to Track**

```
Blockchain Metrics:
├─ Block time
├─ Transaction success rate
├─ Account creation rate
└─ Token supply

Trading Metrics:
├─ Active orders count
├─ Match rate
├─ Average trade size (kWh & GRX)
├─ Price range (GRX/kWh)
└─ Trading volume

System Metrics:
├─ API response time
├─ Database query time
├─ Error rate
└─ Meter reading frequency
```

---

## 🎓 Demo Considerations

### **What Makes This Architecture Demo-Friendly**

```
✅ Visual Flow: Easy to diagram and explain
✅ Fast Execution: Trades complete in < 1 second
✅ Transparent: All data visible on-chain
✅ Interactive: Can demonstrate live trading
✅ Reproducible: Reset and demo again easily
✅ Self-Contained: Everything runs locally
```

### **Demo Talking Points**

```
1. "This is a Proof of Authority blockchain running locally"
   → Show validator logs

2. "Users register and get blockchain accounts"
   → Show Solana Explorer

3. "Smart meters send energy data"
   → Show simulator logs + database

4. "Prosumers create sell orders on-chain"
   → Show order creation transaction

5. "Consumers browse and buy energy peer-to-peer"
   → Show order book + match transaction

6. "Settlement is automatic and instant"
   → Show balance changes

7. "All transactions are auditable and immutable"
   → Show transaction history
```

---

## 💳 Thai Baht Chain Integration

### **Payment Architecture**

```
┌────────────────────────────────────────────────────────────┐
│              Cross-Chain Payment Flow                      │
└────────────────────────────────────────────────────────────┘

GridTokenX (Solana)                Thai Baht Chain
┌─────────────────┐                ┌─────────────────┐
│  Energy Trading │                │   THB Payment   │
│                 │                │                 │
│  • Order Book   │                │  • THBC Token   │
│  • Energy Token │◄──────────────►│  • Bridge       │
│  • Escrow       │   Cross-Chain  │  • Settlement   │
│                 │   Bridge       │                 │
└─────────────────┘                └─────────────────┘
         │                                  │
         │                                  │
         ▼                                  ▼
    PostgreSQL ◄──────Sync──────────► Price Oracle
    (Trade Data)                      (GRX/THB Rate)
```

### **How It Works**

**Step 1: Price Conversion**
```
Energy Price (GRX) ──► Oracle ──► Thai Baht (THB)

Example:
• Seller sets: 10 kWh @ 3 GRX/kWh = 30 GRX
• Oracle rate: 1 GRX = 10 THB
• Display price: 10 kWh @ 30 THB/kWh = 300 THB
```

**Step 2: Payment Flow**
```
┌──────────────────────────────────────────────────────────┐
│  1. Buyer Views Order                                    │
│     • Price shown in both GRX and THB                    │
│     • Example: 30 GRX (≈300 THB)                         │
└──────────────────────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│  2. Buyer Chooses Payment Method                         │
│     ✓ Pay with GRX (native token)                        │
│     ✓ Pay with THB (via Thai Baht Chain)                 │
└──────────────────────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│  3. If THB Selected:                                     │
│     a. Lock Energy Tokens in Escrow (Solana)             │
│     b. Initiate THB payment (Thai Baht Chain)            │
│     c. Bridge listens for THB confirmation               │
│     d. Upon confirmation: Release tokens to buyer        │
│     e. Convert THB to GRX and send to seller             │
└──────────────────────────────────────────────────────────┘
```

**Step 3: Settlement**
```
Thai Baht Chain                          Solana
─────────────                           ─────────

Buyer sends 300 THBC
       │
       ▼
Bridge Contract
   (Lock THBC)
       │
       │ Emit Event: THBPaid
       ▼                                    │
Oracle Confirms ─────────────────────────►│
                                           │
                                           ▼
                                   Release Energy Tokens
                                           │
                                           ▼
                                   Convert 300 THB → 30 GRX
                                           │
                                           ▼
                                   Send 30 GRX to Seller
```

### **Integration Components**

**1. Cross-Chain Bridge**
```
Bridge Contract (Solana Side):
• Listen for Thai Baht Chain events
• Verify payment confirmations
• Release escrowed tokens
• Handle GRX ↔ THB conversion

Bridge Contract (Thai Baht Chain Side):
• Accept THBC payments
• Lock funds during settlement
• Emit payment events
• Release funds after confirmation
```

**2. Price Oracle**
```
Oracle Service:
• Real-time GRX/THB exchange rate
• Update frequency: Every 1 minute
• Source: Market data aggregator
• Fallback: Manual rate setting

Example Rates:
┌────────────────────────────────────┐
│ 1 GRX = 10 THB                     │
│ 1 kWh Energy = 1 Energy Token      │
│ Energy Token → GRX (for payment)   │
└────────────────────────────────────┘
```

**3. Payment Options UI**
```
Order Details:
┌──────────────────────────────────────────┐
│ Solar Home A                             │
│ Amount: 10 kWh                           │
│                                          │
│ Price:                                   │
│   • 30 GRX                              │
│   • ≈300 THB (1 GRX = 10 THB)          │
│                                          │
│ Payment Method:                          │
│   ○ Pay with GRX (native)               │
│   ● Pay with Thai Baht (THBC)           │
│                                          │
│ [ Confirm Purchase ]                     │
└──────────────────────────────────────────┘
```

### **Benefits of Thai Baht Integration**

```
✅ Local Currency: Users pay in familiar THB
✅ Compliance: Aligns with Thai financial regulations
✅ Accessibility: No need to buy crypto first
✅ Transparency: Clear pricing in local currency
✅ Lower Barrier: Easier for non-crypto users
```

### **Technical Implementation**

**Smart Contract (Solana)**
```rust
// Enhanced trading program with THB support

pub struct OrderWithThb {
    pub price_grx: u64,        // Price in GRX
    pub price_thb: u64,        // Price in THB (for display)
    pub payment_method: PaymentMethod,
    // ... other fields
}

pub enum PaymentMethod {
    GRX,              // Direct GRX payment
    ThaibahtChain,    // Cross-chain THB payment
}

pub fn match_order_with_thb(
    ctx: Context<MatchOrder>,
    payment_method: PaymentMethod,
) -> Result<()> {
    match payment_method {
        PaymentMethod::GRX => {
            // Normal GRX payment flow
            transfer_grx(ctx)?;
        }
        PaymentMethod::ThaibahtChain => {
            // Wait for bridge confirmation
            require!(
                ctx.accounts.bridge_proof.is_valid(),
                ErrorCode::InvalidBridgeProof
            );
            // Release tokens after THB payment confirmed
            release_from_escrow(ctx)?;
        }
    }
    Ok(())
}
```

**Bridge Service (Backend)**
```typescript
// Thai Baht Chain bridge listener

class ThaibahtBridge {
    async listenForPayments() {
        // Listen to Thai Baht Chain events
        thbChain.on('PaymentReceived', async (event) => {
            const { orderId, buyer, amount, txHash } = event;
            
            // Verify payment on Thai Baht Chain
            const isValid = await this.verifyThbPayment(txHash);
            
            if (isValid) {
                // Create proof for Solana
                const proof = await this.createBridgeProof(event);
                
                // Execute order matching on Solana
                await solana.matchOrderWithThb(orderId, proof);
                
                // Convert THB to GRX for seller
                await this.settleSeller(orderId, amount);
            }
        });
    }
}
```

## 📚 Technical References

### **Technologies Used**

```
Blockchain:
- Solana v1.18+
- Anchor Framework v0.32.1
- SPL Token Program
- Thai Baht Chain (Ethereum-compatible)

Backend:
- Node.js v20+
- TypeScript v5+
- PostgreSQL v14+
- Cross-chain Bridge Service

Libraries:
- @solana/web3.js
- @coral-xyz/anchor
- ethers.js (for Thai Baht Chain)
- pg (PostgreSQL client)
- express/fastify
```

### **Further Reading**

- [Solana Documentation](https://docs.solana.com/)
- [Anchor Book](https://book.anchor-lang.com/)
- [P2P Energy Trading Research](https://www.sciencedirect.com/topics/engineering/peer-to-peer-energy-trading)
- [Order Book Design Patterns](https://en.wikipedia.org/wiki/Order_book)

---

## ✅ Architecture Validation

### **Design Checklist**

- [x] Meets all functional requirements
- [x] Achievable within timeline (4 weeks)
- [x] Can be demonstrated effectively
- [x] Uses proven technologies
- [x] Cost-effective (free local setup)
- [x] Scalable design (can migrate to production)
- [x] Secure by design
- [x] Simple enough to explain
- [x] Complex enough to be interesting
- [x] Solves real P2P trading problem

---

**สรุป**: Architecture นี้ออกแบบมาเพื่อความ **ง่าย ชัดเจน และทำได้จริง** โดยเน้น P2P trading เป็นหลัก ใช้ PoA เพื่อความรวดเร็ว และแยก concerns ระหว่าง on-chain/off-chain อย่างชัดเจน 🎯
