# Continuous Double Auction (CDA): Deep Dive

> **On-Chain Order Book & Client-Side Matching Engine for P2P Energy Trading**

---

## 1. Executive Summary

The GridTokenX trading system implements a **Continuous Double Auction (CDA)** — the industry-standard mechanism for real-time price discovery. Unlike periodic batch auctions, the CDA matches orders **immediately** as they arrive, providing instant liquidity and transparent price formation.

The CDA is implemented across two layers:

- **Anchor On-Chain Program** (`trading/`): The authoritative settlement layer — creates orders, validates matches, and executes atomic token swaps on Solana.
- **WASM Client-Side Engine** (`gridtokenx-wasm/modules/orderbook.rs`): A high-performance preview engine compiled to WebAssembly for real-time order book visualization, depth charts, and match previews in the browser.

---

## 2. CDA Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│                    Frontend (React)                   │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │ Order Entry  │  │ Depth Chart  │  │ Trade Feed  │ │
│  └──────┬──────┘  └──────┬───────┘  └──────┬──────┘ │
│         │                │                  │         │
│  ┌──────▼──────────────▼──────────────────▼──────┐  │
│  │         WASM OrderBook Engine (Rust)            │  │
│  │  • Price-time priority sorting                  │  │
│  │  • Client-side match preview                    │  │
│  │  • Depth aggregation                            │  │
│  │  • Spread / mid-price calculation               │  │
│  └─────────────────────┬──────────────────────────┘  │
└────────────────────────┼─────────────────────────────┘
                         │ Submit order TX
                         ▼
┌──────────────────────────────────────────────────────┐
│              Solana Blockchain (Anchor)               │
│  ┌──────────────────────────────────────────────────┐│
│  │              Trading Program                      ││
│  │  • create_sell_order (post ask)                   ││
│  │  • create_buy_order  (post bid)                   ││
│  │  • match_orders      (validate & record match)    ││
│  │  • execute_atomic_settlement (token swap)         ││
│  │  • cancel_order      (remove from book)           ││
│  └──────────────────────────────────────────────────┘│
│  ┌────────────┐  ┌────────────┐  ┌────────────────┐ │
│  │   Market    │  │   Order    │  │  TradeRecord   │ │
│  │  (zero_copy)│  │ (zero_copy)│  │   (regular)    │ │
│  └────────────┘  └────────────┘  └────────────────┘ │
└──────────────────────────────────────────────────────┘
```

---

## 3. Anchor On-Chain Program

### 3.1 Market State

The `Market` account uses **zero-copy deserialization** to avoid heap allocation costs for the large order book structures:

```rust
#[account(zero_copy)]
#[repr(C)]
pub struct Market {
    pub authority: Pubkey,              // 32 - Market operator
    pub total_volume: u64,              // 8  - Cumulative traded volume
    pub created_at: i64,                // 8  - Creation timestamp
    pub last_clearing_price: u64,       // 8  - Most recent trade price
    pub volume_weighted_price: u64,     // 8  - VWAP tracker
    pub active_orders: u32,             // 4  - Current open order count
    pub total_trades: u32,              // 4  - Lifetime trade count
    pub market_fee_bps: u16,            // 2  - Fee in basis points (default: 25 = 0.25%)
    pub clearing_enabled: u8,           // 1  - Trading enabled flag
    pub locked: u8,                     // 1  - Re-entrancy guard
    pub _padding1: [u8; 4],             // 4  - Alignment → 80 bytes

    // === BATCH PROCESSING ===
    pub batch_config: BatchConfig,      // 24
    pub current_batch: BatchInfo,       // 1640
    pub has_current_batch: u8,          // 1
    pub _padding_batch: [u8; 7],        // 7  - Alignment

    // === MARKET DEPTH ===
    pub buy_side_depth: [PriceLevel; 20],   // 480
    pub sell_side_depth: [PriceLevel; 20],  // 480
    pub buy_side_depth_count: u8,       // 1
    pub sell_side_depth_count: u8,      // 1
    pub price_history_count: u8,        // 1
    pub _padding_depth: [u8; 5],        // 5  - Alignment

    // === PRICE DISCOVERY ===
    pub price_history: [PricePoint; 24],    // 576
}
```

**Key structures:**

```rust
pub struct PriceLevel {
    pub price: u64,          // Price at this level
    pub total_amount: u64,   // Aggregate quantity
    pub order_count: u16,    // Number of orders
}

pub struct PricePoint {
    pub price: u64,          // Clearing price
    pub volume: u64,         // Volume at this price
    pub timestamp: i64,      // When the trade occurred
}
```

### 3.2 Order State

```rust
#[account(zero_copy)]
#[repr(C)]
pub struct Order {
    pub seller: Pubkey,         // 32
    pub buyer: Pubkey,          // 32
    pub order_id: u64,          // 8
    pub amount: u64,            // 8  - Energy amount (kWh)
    pub filled_amount: u64,     // 8  - Partially filled tracking
    pub price_per_kwh: u64,     // 8  - Limit price
    pub order_type: u8,         // 1  - Buy or Sell (OrderType enum)
    pub status: u8,             // 1  - Active/PartiallyFilled/Completed/Cancelled/Expired
    pub _padding: [u8; 6],      // 6  - Alignment
    pub created_at: i64,        // 8
    pub expires_at: i64,        // 8  - Auto-expiry (default: +24h)
}
```

**Order lifecycle:**
```
Active → PartiallyFilled → Completed
  │                            ↑
  └──── Cancelled ─────────────┘
         (by owner)
```

### 3.3 Order Creation

**Sell Order** (Post an Ask):
```rust
pub fn create_sell_order(
    ctx: Context<CreateSellOrderContext>,
    order_id_val: u64,
    energy_amount: u64,
    price_per_kwh: u64,        // Minimum acceptable price
) -> Result<()>
```

Validations:
- Governance: system must not be in maintenance mode
- `energy_amount > 0`, `price_per_kwh > 0`
- Optional ERC certificate: must be `Valid`, not expired, validated for trading, and amount ≤ certificate amount
- Order PDA: `seeds = [b"order", authority, &order_id.to_le_bytes()]`

**Buy Order** (Post a Bid):
```rust
pub fn create_buy_order(
    ctx: Context<CreateBuyOrderContext>,
    order_id_val: u64,
    energy_amount: u64,
    max_price_per_kwh: u64,    // Maximum willingness to pay
) -> Result<()>
```

Both orders expire after **24 hours** by default (`expires_at = now + 86400`).

### 3.4 Matching Rule

```rust
pub fn match_orders(
    ctx: Context<MatchOrdersContext>,
    match_amount: u64,
) -> Result<()>
```

**Matching condition:**
```
buy_order.price_per_kwh >= sell_order.price_per_kwh
```

**Clearing price determination:**
```
clearing_price = sell_order.price_per_kwh
```

The seller's ask price is used as the clearing price. Since the buyer is willing to pay up to `max_price_per_kwh` but only pays the seller's (lower) ask, this is **buyer-favorable** — buyers get price improvement when their bid exceeds the ask.

**Partial fill logic:**
```
actual_match = min(match_amount, buy_remaining, sell_remaining)
```

After matching:
- `filled_amount` incremented on both orders
- Status transitions: `Active → PartiallyFilled → Completed`
- `TradeRecord` created with full audit trail
- Market stats updated: `total_volume`, `total_trades`, `last_clearing_price`

**Fee calculation:**
```
total_value = actual_match_amount × clearing_price
fee = total_value × market_fee_bps / 10,000     (default: 0.25%)
```

### 3.5 Atomic Settlement

The `execute_atomic_settlement` instruction performs the full trade in a single transaction:

```rust
pub fn execute_atomic_settlement(
    ctx: Context<ExecuteAtomicSettlementContext>,
    amount: u64,
    price: u64,
    wheeling_charge_val: u64,    // Grid usage fee
    loss_cost_val: u64,          // Transmission loss cost
) -> Result<()>
```

**Settlement flow:**

```
total_value    = amount × price
market_fee     = total_value × fee_bps / 10,000
net_to_seller  = total_value - market_fee - wheeling_charge - loss_cost

Transfers (all in one TX):
1. Buyer escrow → Fee collector     : market_fee (currency)
2. Buyer escrow → Seller account    : net_to_seller (currency)
3. Seller escrow → Buyer account    : amount (energy tokens)
```

This ensures **atomicity** — if any transfer fails, the entire settlement reverts.

**Note:** Fee and seller transfers are conditional — they only execute if the respective amounts are > 0.

### 3.6 Market Parameter Updates

```rust
pub fn update_market_params(
    ctx: Context<UpdateMarketParamsContext>,
    fee_bps: u16,
    clearing: bool,
) -> Result<()>
```

Allows the market authority to update the fee rate and enable/disable clearing. Emits `MarketParamsUpdated` event.

### 3.7 Compute Unit Profile

| Instruction | CU Cost | Notes |
|---|---|---|
| `create_sell_order` | ~15,000 | Account init + ERC validation |
| `create_buy_order` | ~12,000 | Account init |
| `match_orders` | ~35,200 | Zero-copy market update + trade record |
| `execute_atomic_settlement` | ~45,000 | 3 CPI token transfers |
| `cancel_order` | ~8,000 | Status update |

---

## 4. WASM Client-Side Engine

### 4.1 Purpose

The WASM `OrderBook` provides **real-time order book operations in the browser** without network roundtrips. It mirrors the on-chain state for instant UI updates.

### 4.2 Order Book Structure

```rust
#[wasm_bindgen]
pub struct OrderBook {
    bids: Vec<Order>,  // Sorted: price DESC, timestamp ASC
    asks: Vec<Order>,  // Sorted: price ASC,  timestamp ASC
}
```

**Sorting = Price-Time Priority:**
- Bids: highest price first, then earliest arrival (aggressive buyers prioritized)
- Asks: lowest price first, then earliest arrival (competitive sellers prioritized)

Orders are inserted using **binary search** for O(log n) insertion into the sorted vector.

### 4.3 Matching Algorithm

```rust
pub fn match_orders(&mut self) -> Result<JsValue, JsValue> {
    while !bids.empty() && !asks.empty() {
        if best_bid.price >= best_ask.price {
            // Execution price: resting order's price wins
            exec_price = if bid arrived first { bid.price }
                         else { ask.price };

            exec_qty = min(bid.qty, ask.qty);

            // Record match, update/remove filled orders
        } else {
            break;  // No more crossable orders
        }
    }
}
```

**Key difference from Anchor:** The WASM engine uses **price-time priority** — the resting (earlier) order sets the execution price. The Anchor program always uses the seller's price.

### 4.4 API Surface

| Method | Signature | Description |
|---|---|---|
| `new()` | `() → OrderBook` | Create empty book (1,000/side capacity) |
| `add_order()` | `(id, side, price, qty, ts)` | Insert with binary search |
| `load_orders()` | `(JsValue) → ()` | Bulk load from JSON array |
| `cancel_order()` | `(id) → bool` | Remove by ID |
| `match_orders()` | `() → Vec<Match>` | Execute CDA matching |
| `get_depth()` | `(levels) → DepthResult` | Aggregated depth for charts |
| `best_bid_price()` | `() → f64` | Top of bid book |
| `best_ask_price()` | `() → f64` | Top of ask book |
| `spread()` | `() → f64` | Best ask − best bid |
| `mid_price()` | `() → f64` | (Best bid + best ask) / 2 |

### 4.5 Depth Chart Data

```rust
pub fn get_depth(&self, levels: usize) -> DepthResult {
    // Returns aggregated cumulative quantity at each price level
    // { bids: [[price, cum_qty], ...], asks: [[price, cum_qty], ...] }
}
```

Used by the frontend to render the order book depth visualization.

---

## 5. CDA Price Formation

### 5.1 How Prices Are Discovered

In a CDA, prices emerge from the intersection of supply and demand:

```
Price
  ▲
  │   Asks (sellers)
  │   ┌───┐
  │   │   │  ← Best Ask (lowest seller)
  │   │   │
  │ ──┤   ├── ← Spread
  │   │   │
  │   │   │  ← Best Bid (highest buyer)
  │   └───┘
  │   Bids (buyers)
  └──────────────────► Quantity
```

- **Spread** = Best Ask − Best Bid
- **Mid Price** = (Best Bid + Best Ask) / 2
- **Trade occurs** when Bid ≥ Ask (spread crosses zero)

### 5.2 Price Rules Comparison

| Aspect | Anchor (On-Chain) | WASM (Client) |
|---|---|---|
| **Clearing price** | Seller's ask price | Resting order's price |
| **Priority** | First valid match submitted | Price-time priority |
| **Partial fills** | ✅ Yes | ✅ Yes |
| **Fee** | 0.25% (configurable) | N/A (preview only) |

### 5.3 Fee Distribution

```
Total Trade Value
    │
    ├── 40% → Grid Maintenance Fund (DSO)
    ├── 40% → Platform Development (Treasury)
    └── 20% → Insurance Fund (Default protection)
```

---

## 6. Batch Processing Extension

The Market supports an optional **batch auction** mode via `BatchConfig`:

```rust
#[repr(C)]  // 24 bytes total
pub struct BatchConfig {
    pub enabled: u8,                       // Toggle batch mode
    pub _padding1: [u8; 3],                // Alignment
    pub max_batch_size: u32,               // Max orders per batch (default: 100)
    pub batch_timeout_seconds: u32,        // Batch window (default: 300s)
    pub min_batch_size: u32,               // Minimum to trigger (default: 5)
    pub price_improvement_threshold: u16,  // Min improvement in bps (default: 5)
    pub _padding2: [u8; 6],                // Alignment
}

#[repr(C)]  // 1640 bytes total
pub struct BatchInfo {
    pub batch_id: u64,                     // Batch identifier
    pub order_count: u32,                  // Orders in this batch
    pub _padding1: [u8; 4],                // Alignment
    pub total_volume: u64,                 // Aggregate volume
    pub created_at: i64,                   // Batch creation time
    pub expires_at: i64,                   // Batch expiry time
    pub order_ids: [Pubkey; 32],           // Order pubkeys (max 32)
}
```

When enabled, orders accumulate in `BatchInfo` (up to 32 order pubkeys) and are cleared together, providing fairer price discovery for lower-frequency markets.

---

## 7. Security Considerations

### 7.1 Re-Entrancy Guard
The `Market.locked` field prevents re-entrant calls during settlement.

### 7.2 Governance Gate
All trading instructions check `governance_config.is_operational()` — the market authority can halt trading via maintenance mode.

### 7.3 ERC Validation
Sell orders optionally require a valid, non-expired Energy Renewable Certificate to prove energy provenance.

### 7.4 Order Authorization
Only the order owner (buyer for buy orders, seller for sell orders) can cancel their order.

### 7.5 Atomic Settlement
The 3-legged token transfer in `execute_atomic_settlement` ensures no partial states — either the full trade settles or nothing happens.

---

## 8. References

1. Friedman, D. (1993). "The Double Auction Market: Institutions, Theories, and Evidence"
2. Gode, D.K. & Sunder, S. (1993). "Allocative Efficiency of Markets with Zero-Intelligence Traders"
3. Solana. "Zero-Copy Deserialization for Large Accounts"
