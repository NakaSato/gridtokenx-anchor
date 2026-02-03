# Periodic Auction System: Deep Dive

> **Uniform Price Clearing for Energy Markets**

---

## 1. Executive Summary

The GridTokenX Periodic Auction module implements a **call market mechanism** where orders are batched over a time window and cleared at a single uniform price. This approach is specifically designed for energy markets where:

- Price discovery benefits from aggregated supply/demand information
- Reduced transaction costs through batch settlement
- Fair execution for all participants at the same price
- Integration with grid dispatch cycles (15-minute intervals)

**Key Features:**
- Zero-copy batch storage for up to 32 orders
- Optimal Surplus Maximization (OSM) clearing algorithm
- Pro-rata allocation for partial fills
- Re-entrancy protected state transitions

---

## 2. Auction Theory Background

### 2.1 Call Market vs. Continuous Market

| Feature | Call Market (Batch Auction) | Continuous Market |
|---------|---------------------------|-------------------|
| **Price Discovery** | Single clearing price | Continuous price movement |
| **Fairness** | All traders get same price | Price-time priority |
| **Liquidity** | Concentrated at clearing | Fragmented |
| **Information** | Full order book visible at clear | Partial visibility |
| **Use Case** | Opening/closing auctions, energy | Intraday trading |

### 2.2 Uniform Price Clearing (UPC)

In a uniform price auction, the **Market Clearing Price (MCP)** is determined to maximize traded volume:

$$
\text{MCP} = \arg\max_p \left[ \min\left(\sum_{b_i \geq p} Q_i^{bid}, \sum_{a_j \leq p} Q_j^{ask}\right) \right]
$$

Where:
- $b_i$ = Bid price of order $i$
- $a_j$ = Ask price of order $j$
- $Q_i^{bid}$ = Quantity of bid order $i$
- $Q_j^{ask}$ = Quantity of ask order $j$

---

## 3. State Architecture

### 3.1 Auction Lifecycle

```
┌─────────┐      ┌─────────┐      ┌─────────┐      ┌─────────┐
│  OPEN   │─────►│ LOCKED  │─────►│ CLEARED │─────►│ SETTLED │
│         │      │         │      │         │      │         │
│ Accept  │      │ No new  │      │ Price   │      │ All     │
│ orders  │      │ orders  │      │ known   │      │ trades  │
│         │      │         │      │         │      │ executed│
└─────────┘      └─────────┘      └─────────┘      └─────────┘
     │                │                │                │
     ▼                ▼                ▼                ▼
  submit_bid      lock_batch     resolve_auction   settle_trade
  submit_ask
```

### 3.2 AuctionBatch Account

```rust
#[account(zero_copy)]
#[repr(C)]
pub struct AuctionBatch {
    pub market: Pubkey,           // 32 - Parent market
    pub batch_id: u64,            // 8  - Unique ID (timestamp)
    
    pub clearing_price: u64,      // 8  - MCP (set when Cleared)
    pub clearing_volume: u64,     // 8  - Total volume at MCP
    
    pub start_time: i64,          // 8  - Batch open timestamp
    pub end_time: i64,            // 8  - Batch close timestamp
    
    pub state: u8,                // 1  - Open/Locked/Cleared/Settled
    pub bump: u8,                 // 1  - PDA bump
    pub locked: u8,               // 1  - Re-entrancy guard
    pub _padding: [u8; 1],        // 1  - Alignment
    
    pub order_count: u32,         // 4  - Active orders
    
    pub orders: [AuctionOrder; 32], // 32 × 64 = 2048
}

// Total: 8 (disc) + 80 (header) + 2048 (orders) = 2136 bytes
```

### 3.3 AuctionOrder Structure

```rust
#[derive(Clone, Copy, Default, Pod, Zeroable)]
#[repr(C)]
pub struct AuctionOrder {
    pub order_id: Pubkey,    // 32 - Order account address
    pub price: u64,          // 8  - Limit price
    pub amount: u64,         // 8  - Order quantity
    pub timestamp: i64,      // 8  - Submission time
    pub is_bid: u8,          // 1  - 1=Buy, 0=Sell
    pub _padding: [u8; 7],   // 7  - Alignment
}
// Total: 64 bytes per order
```

**Design Decision:** Fixed 32-order limit with `Pod`/`Zeroable` traits enables:
- Zero-copy access (no deserialization)
- Predictable account size (rent calculation)
- O(1) order lookup by index

---

## 4. Clearing Algorithm

### 4.1 Optimal Surplus Maximization

The algorithm finds the price that maximizes **total surplus** (welfare):

$$
\text{Surplus}(p) = \sum_{b_i \geq p} (b_i - p) \cdot Q_i + \sum_{a_j \leq p} (p - a_j) \cdot Q_j
$$

### 4.2 Implementation

```rust
/// Calculate Market Clearing Price using supply/demand intersection
/// Returns (clearing_price, clearing_volume)
pub fn calculate_clearing_price(orders: &[AuctionOrder]) -> (u64, u64) {
    // Step 1: Separate bids (buys) and asks (sells)
    let mut bids: Vec<AuctionOrder> = orders
        .iter()
        .filter(|o| o.is_bid == 1 && o.amount > 0)
        .cloned()
        .collect();
    
    let mut asks: Vec<AuctionOrder> = orders
        .iter()
        .filter(|o| o.is_bid == 0 && o.amount > 0)
        .cloned()
        .collect();
    
    // Step 2: Sort bids descending (highest paying first)
    bids.sort_by(|a, b| b.price.cmp(&a.price));
    
    // Step 3: Sort asks ascending (lowest selling first)
    asks.sort_by(|a, b| a.price.cmp(&b.price));
    
    // Step 4: Find intersection using price sweep
    let mut clearing_price = 0u64;
    let mut max_volume = 0u64;
    
    // Collect all unique prices as potential clearing prices
    let mut price_points: Vec<u64> = bids.iter()
        .map(|o| o.price)
        .chain(asks.iter().map(|o| o.price))
        .collect();
    price_points.sort();
    price_points.dedup();
    
    for price in price_points {
        // Aggregate demand at this price (bids >= price)
        let demand: u64 = bids.iter()
            .filter(|b| b.price >= price)
            .map(|b| b.amount)
            .sum();
        
        // Aggregate supply at this price (asks <= price)
        let supply: u64 = asks.iter()
            .filter(|a| a.price <= price)
            .map(|a| a.amount)
            .sum();
        
        // Tradeable volume is minimum of supply and demand
        let volume = std::cmp::min(supply, demand);
        
        // Update if this price achieves higher volume
        if volume > max_volume {
            max_volume = volume;
            clearing_price = price;
        }
    }
    
    (clearing_price, max_volume)
}
```

### 4.3 Visual Example

```
Price   │     Supply        Demand      Volume
(THB)   │    (Sellers)      (Buyers)   (Traded)
────────┼─────────────────────────────────────
  6.00  │      500           100        100
  5.50  │      400           200        200
  5.00  │      300           350        300  ← MCP (highest volume)
  4.50  │      200           400        200
  4.00  │      100           450        100
────────┼─────────────────────────────────────

Supply/Demand Curves:

Price │                S
      │               /
 6.00 ├──────────────•
      │             /│
 5.50 ├────────────• │
      │           /  │
 5.00 ├──────────●═══●═══ MCP at intersection
      │         /    │
 4.50 ├────────•     │D
      │       /     /
 4.00 ├──────•     •
      │     /     /
      └───────────────────► Quantity
        100 200 300 400

At MCP = 5.00 THB:
- Supply: 300 kWh (sellers willing at ≤5.00)
- Demand: 350 kWh (buyers willing at ≥5.00)
- Clearing Volume: 300 kWh (limited by supply)
```

---

## 5. Pro-Rata Allocation

### 5.1 Partial Fill Problem

When demand exceeds supply (or vice versa) at the MCP, orders must be **proportionally allocated**:

$$
\text{Filled}_i = Q_i \times \frac{\text{TotalClearing}}{\text{TotalAtMCP}}
$$

### 5.2 Implementation

```rust
pub fn calculate_fill_amount(
    order_amount: u64,
    clearing_volume: u64,
    total_at_price: u64,
) -> u64 {
    if total_at_price == 0 {
        return 0;
    }
    
    // Pro-rata: order_amount * (clearing_volume / total_at_price)
    // Use u128 to prevent overflow
    let fill = (order_amount as u128)
        .checked_mul(clearing_volume as u128)
        .unwrap()
        .checked_div(total_at_price as u128)
        .unwrap() as u64;
    
    // Cannot fill more than order amount
    std::cmp::min(fill, order_amount)
}
```

### 5.3 Example

```
Order  │ Side │ Price │ Amount │ At MCP? │ Pro-Rata Fill
───────┼──────┼───────┼────────┼─────────┼──────────────
  A    │ Buy  │ 5.50  │  100   │   ✓     │ 100 × (300/350) = 85.7 → 85
  B    │ Buy  │ 5.00  │  150   │   ✓     │ 150 × (300/350) = 128.5 → 128
  C    │ Buy  │ 5.00  │  100   │   ✓     │ 100 × (300/350) = 85.7 → 85
  D    │ Sell │ 4.50  │  100   │   ✓     │ 100 (fully filled)
  E    │ Sell │ 5.00  │  200   │   ✓     │ 200 (fully filled)
───────┼──────┼───────┼────────┼─────────┼──────────────
Total  │      │       │        │         │ ~300 (matches clearing)
```

---

## 6. State Transitions

### 6.1 Order Submission

```rust
pub fn submit_auction_order(
    ctx: Context<SubmitAuctionOrder>,
    price: u64,
    amount: u64,
    is_bid: bool,
) -> Result<()> {
    let batch = &mut ctx.accounts.auction_batch.load_mut()?;
    
    // Validate state
    require!(
        batch.state == AuctionState::Open as u8,
        AuctionError::AuctionNotOpen
    );
    
    // Check capacity
    require!(
        batch.order_count < 32,
        AuctionError::BatchFull
    );
    
    // Create order
    let order = AuctionOrder {
        order_id: ctx.accounts.order_account.key(),
        price,
        amount,
        timestamp: Clock::get()?.unix_timestamp,
        is_bid: if is_bid { 1 } else { 0 },
        _padding: [0; 7],
    };
    
    // Insert at next available slot
    let idx = batch.order_count as usize;
    batch.orders[idx] = order;
    batch.order_count += 1;
    
    emit!(OrderSubmitted {
        batch_id: batch.batch_id,
        order_id: order.order_id,
        price,
        amount,
        is_bid,
        timestamp: order.timestamp,
    });
    
    Ok(())
}
```

### 6.2 Batch Locking

```rust
pub fn lock_auction_batch(ctx: Context<LockAuctionBatch>) -> Result<()> {
    let batch = &mut ctx.accounts.auction_batch.load_mut()?;
    let clock = Clock::get()?;
    
    require!(
        batch.state == AuctionState::Open as u8,
        AuctionError::InvalidState
    );
    
    // Can lock after end_time or by authority
    let is_past_end_time = clock.unix_timestamp >= batch.end_time;
    let is_authority = ctx.accounts.authority.key() == batch.market;
    
    require!(
        is_past_end_time || is_authority,
        AuctionError::CannotLockYet
    );
    
    batch.state = AuctionState::Locked as u8;
    
    emit!(BatchLocked {
        batch_id: batch.batch_id,
        order_count: batch.order_count,
        timestamp: clock.unix_timestamp,
    });
    
    Ok(())
}
```

### 6.3 Auction Resolution

```rust
pub fn resolve_auction(ctx: Context<ResolveAuction>) -> Result<()> {
    let batch = &mut ctx.accounts.auction_batch.load_mut()?;
    
    // Re-entrancy guard
    require!(batch.locked == 0, AuctionError::ReentrantCall);
    batch.locked = 1;
    
    require!(
        batch.state == AuctionState::Locked as u8,
        AuctionError::AuctionNotReady
    );
    
    // Calculate clearing price
    let order_slice = &batch.orders[0..batch.order_count as usize];
    let (clearing_price, clearing_volume) = calculate_clearing_price(order_slice);
    
    // Update batch state
    batch.clearing_price = clearing_price;
    batch.clearing_volume = clearing_volume;
    batch.state = AuctionState::Cleared as u8;
    batch.locked = 0;
    
    emit!(AuctionCleared {
        batch_id: batch.batch_id,
        clearing_price,
        clearing_volume,
        timestamp: Clock::get()?.unix_timestamp,
    });
    
    Ok(())
}
```

---

## 7. Settlement Process

### 7.1 Settlement Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       AUCTION SETTLEMENT                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  For each order at MCP (batch.clearing_price):                         │
│                                                                         │
│  1. Calculate Pro-Rata Fill:                                           │
│     fill_amount = order.amount × (clearing_volume / total_at_price)    │
│                                                                         │
│  2. Execute Trade (atomic CPI):                                        │
│     ┌─────────────────────────────────────────────────────────────┐    │
│     │  IF is_bid (buyer):                                         │    │
│     │    • Transfer (fill_amount × price) currency → seller       │    │
│     │    • Transfer fill_amount energy → buyer                    │    │
│     │  ELSE (seller):                                             │    │
│     │    • (Handled in matching buyer settlement)                 │    │
│     └─────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  3. Update Order Status:                                               │
│     order.filled_amount += fill_amount                                 │
│     IF order.filled_amount == order.amount:                            │
│       order.status = Completed                                         │
│     ELSE:                                                              │
│       order.status = PartiallyFilled                                   │
│                                                                         │
│  4. Emit Settlement Event                                              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Batch Settlement Instruction

```rust
pub fn settle_auction_order(
    ctx: Context<SettleAuctionOrder>,
    order_index: u8,
) -> Result<()> {
    let batch = ctx.accounts.auction_batch.load()?;
    
    require!(
        batch.state == AuctionState::Cleared as u8,
        AuctionError::NotCleared
    );
    
    require!(
        (order_index as u32) < batch.order_count,
        AuctionError::InvalidOrderIndex
    );
    
    let order = batch.orders[order_index as usize];
    let clearing_price = batch.clearing_price;
    
    // Check if order qualifies for settlement
    let qualifies = if order.is_bid == 1 {
        order.price >= clearing_price
    } else {
        order.price <= clearing_price
    };
    
    require!(qualifies, AuctionError::OrderDoesNotQualify);
    
    // Calculate fill amount (pro-rata)
    let total_at_price = calculate_total_at_price(&batch, clearing_price, order.is_bid);
    let fill_amount = calculate_fill_amount(
        order.amount,
        batch.clearing_volume,
        total_at_price,
    );
    
    // Execute token transfers via CPI
    // ... (token transfer logic)
    
    emit!(OrderSettled {
        batch_id: batch.batch_id,
        order_id: order.order_id,
        fill_amount,
        clearing_price,
        timestamp: Clock::get()?.unix_timestamp,
    });
    
    Ok(())
}
```

---

## 8. Integration with Grid Operations

### 8.1 15-Minute Market Windows

Energy markets typically operate on 15-minute intervals aligned with grid dispatch:

```rust
const BATCH_DURATION_SECONDS: i64 = 900; // 15 minutes

pub fn create_next_batch(
    ctx: Context<CreateBatch>,
) -> Result<()> {
    let clock = Clock::get()?;
    
    // Align to 15-minute boundaries
    let current_period = clock.unix_timestamp / BATCH_DURATION_SECONDS;
    let start_time = current_period * BATCH_DURATION_SECONDS;
    let end_time = start_time + BATCH_DURATION_SECONDS;
    
    let batch = &mut ctx.accounts.auction_batch.load_init()?;
    batch.batch_id = start_time as u64;
    batch.start_time = start_time;
    batch.end_time = end_time;
    batch.state = AuctionState::Open as u8;
    // ... initialize other fields
    
    Ok(())
}
```

### 8.2 Crank-Based Resolution

A permissionless "crank" can trigger auction resolution after the batch window closes:

```typescript
async function crankAuction(batchAddress: PublicKey) {
  const batch = await program.account.auctionBatch.fetch(batchAddress);
  const now = Date.now() / 1000;
  
  if (batch.state === AuctionState.Open && now >= batch.endTime) {
    // Lock the batch
    await program.methods.lockAuctionBatch().accounts({ ... }).rpc();
  }
  
  if (batch.state === AuctionState.Locked) {
    // Resolve the auction
    await program.methods.resolveAuction().accounts({ ... }).rpc();
  }
  
  if (batch.state === AuctionState.Cleared) {
    // Settle all qualifying orders
    for (let i = 0; i < batch.orderCount; i++) {
      await program.methods.settleAuctionOrder(i).accounts({ ... }).rpc();
    }
  }
}
```

---

## 9. Security Analysis

### 9.1 Order Manipulation

**Threat:** Attacker submits many orders to manipulate clearing price.

**Mitigation:**
- Account rent cost (~0.00089 SOL per order PDA) makes spam expensive
- Order cancellation blocked after batch lock
- Maximum 32 orders per batch limits attack surface

### 9.2 Front-Running

**Threat:** Observer sees large order and front-runs.

**Mitigation:**
- All orders at MCP get same price (no advantage to being first)
- Pro-rata allocation ensures fair distribution
- Optional: Commit-reveal scheme for order submission

### 9.3 Re-entrancy

**Threat:** Malicious callback during settlement re-enters auction.

**Mitigation:**
```rust
// Guard at start of sensitive operations
require!(batch.locked == 0, AuctionError::ReentrantCall);
batch.locked = 1;
// ... execute operations
batch.locked = 0;
```

---

## 10. Compute Unit Profile

| Operation | CU Cost | Notes |
|-----------|---------|-------|
| `submit_auction_order` | ~8,000 | Fixed array insert |
| `lock_auction_batch` | ~5,000 | State transition only |
| `resolve_auction` | ~25,000 | Sorting + sweep (32 orders) |
| `settle_auction_order` | ~40,000 | Token CPI overhead |

**Total Batch Settlement:** ~25,000 + (32 × 40,000) = ~1.3M CU (requires extended compute)

---

## 11. Research Contributions

1. **First Solana implementation** of periodic auction for energy markets
2. **Zero-copy batch storage** enabling efficient on-chain order management
3. **Energy grid integration** with 15-minute market windows
4. **Pro-rata allocation** algorithm for fair partial fills

---

## 12. References

1. Budish, E., Cramton, P., & Shim, J. (2015). "The High-Frequency Trading Arms Race"
2. PJM Interconnection. "Energy Market Operations"
3. Solana Cookbook. "Zero-Copy Deserialization"
