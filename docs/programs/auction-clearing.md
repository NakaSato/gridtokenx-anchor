# Auction Clearing Algorithm

> **Periodic Batch Auction with Uniform Price Discovery**

**Location:** `programs/trading/src/lib.rs` (inlined in `#[program]` module)

---

## Overview

The Auction Clearing algorithm implements **periodic batch auction** mechanics within the Trading program. Unlike continuous P2P matching, this mechanism collects orders over a fixed window and discovers a **uniform clearing price** where supply intersects demand.

### Key Features

- **Uniform Price Discovery** — All matched orders execute at the same clearing price
- **Supply-Demand Intersection** — Finds equilibrium where cumulative supply meets cumulative demand
- **MEV Resistance** — Batch execution prevents front-running
- **Fair Treatment** — Both buyers and sellers benefit from price improvement
- **Partial Fill Support** — Orders can be partially matched

---

## Data Structures

### AuctionOrder

```rust
pub struct AuctionOrder {
    pub order_key: Pubkey,      // Order account pubkey
    pub price_per_kwh: u64,     // Price (6+ decimals)
    pub amount: u64,            // Volume in kWh (9 decimals for GRX)
    pub filled_amount: u64,     // Already filled amount
    pub user: Pubkey,           // Order creator
    pub is_buy: bool,           // true = buy, false = sell
}
```

### CurvePoint

```rust
pub struct CurvePoint {
    pub price: u64,             // Price level
    pub cumulative_volume: u64, // Cumulative volume at or better than this price
}
```

### AuctionMatch

```rust
pub struct AuctionMatch {
    pub buy_order: Pubkey,      // Buy order account
    pub sell_order: Pubkey,     // Sell order account
    pub amount: u64,            // Matched volume
    pub price: u64,             // Clearing price (uniform)
}
```

### ClearAuctionResult

```rust
pub struct ClearAuctionResult {
    pub clearing_price: u64,
    pub clearing_volume: u64,
    pub matched_buy_volume: u64,
    pub matched_sell_volume: u64,
    pub total_matches: u32,
}
```

---

## Algorithm Specification

### Process Flow

```
Input: sell_orders[], buy_orders[]

Step 1: Sort Orders
  ├─ Sell orders: ascending by price (cheapest first)
  └─ Buy orders: descending by price (highest first)

Step 2: Build Supply Curve
  └─ For each sell order: cumulative_volume += amount

Step 3: Build Demand Curve
  └─ For each buy order: cumulative_volume += amount

Step 4: Find Clearing Point
  └─ Find intersection: sell_price ≤ buy_price, maximize volume

Step 5: Generate Matches
  └─ Match eligible sells (price ≤ clearing_price)
     with eligible buys (price ≥ clearing_price)

Output: ClearAuctionResult { clearing_price, clearing_volume, matches }
```

### find_clearing_point()

The core algorithm iterates through supply and demand curve points to find the optimal intersection:

```rust
fn find_clearing_point(
    supply_curve: &[CurvePoint],
    demand_curve: &[CurvePoint],
) -> Result<(u64, u64)> {
    let mut best_price = 0u64;
    let mut best_volume = 0u64;

    for supply_point in supply_curve {
        for demand_point in demand_curve {
            if supply_point.price <= demand_point.price {
                let volume = supply_point
                    .cumulative_volume
                    .min(demand_point.cumulative_volume);
                if volume > best_volume {
                    best_volume = volume;
                    best_price = supply_point.price;
                }
            }
        }
    }

    require!(best_price > 0, InvalidPrice);
    require!(best_volume > 0, InvalidAmount);
    Ok((best_price, best_volume))
}
```

**Complexity:** O(n × m) where n = supply points, m = demand points
**Space:** O(n + m) for curve vectors

### Concrete Example

```
Auction Window: 15 minutes

Sell Orders (sorted ASC):          Buy Orders (sorted DESC):
┌────────────────────────┐        ┌────────────────────────┐
│ 50 kWh @ 3.2 THB       │        │ 30 kWh @ 3.8 THB       │
│ 80 kWh @ 3.4 THB       │        │ 60 kWh @ 3.6 THB       │
│ 40 kWh @ 3.6 THB       │        │ 50 kWh @ 3.4 THB       │
│ 30 kWh @ 3.8 THB       │        │ 20 kWh @ 3.2 THB       │
└────────────────────────┘        └────────────────────────┘

Supply Curve:                      Demand Curve:
Price │ Cum. Volume                Price │ Cum. Volume
3.2   │ 50                         3.8   │ 30
3.4   │ 130                        3.6   │ 90
3.6   │ 170                        3.4   │ 140
3.8   │ 200                        3.2   │ 160

═══════════════════════════════════════════════════════
Intersection: P* = 3.4 THB, Q* = 90 kWh
═══════════════════════════════════════════════════════

Matched at 3.4 THB (Uniform Pricing):
  Sells: 50 kWh (@ 3.2) + 40 kWh (@ 3.4) = 90 kWh
  → Sellers @ 3.2 THB receive 3.4 THB (price improvement!)
  → Sellers @ 3.4 THB receive 3.4 THB (as expected)

  Buys: 30 kWh (@ 3.8) + 60 kWh (@ 3.6) = 90 kWh
  → Buyers @ 3.8 THB pay 3.4 THB (price improvement!)
  → Buyers @ 3.6 THB pay 3.4 THB (price improvement!)

Unmatched (returned to order book):
  Sell: 40 kWh @ 3.6, 30 kWh @ 3.8 (too expensive)
  Buy: 50 kWh @ 3.4 (partial), 20 kWh @ 3.2 (too cheap)
```

---

## Instructions

### clear_auction

**Core auction clearing instruction.** Discovers uniform market clearing price through batch auction mechanism.

**Arguments:**
- `sell_orders: Vec<AuctionOrder>` — Eligible sell orders
- `buy_orders: Vec<AuctionOrder>` — Eligible buy orders

**Accounts:**
- `market` (mut) — Global market state
- `zone_market` (mut) — Zone-specific market
- `governance_config` (readonly) — Must be operational
- `authority` (Signer) — Auction executor

**Steps:**
1. **Sort** sell orders ascending, buy orders descending
2. **Build supply curve** — cumulative volumes at each price
3. **Build demand curve** — cumulative volumes at each price
4. **Find clearing point** — `find_clearing_point()` intersection
5. **Generate matches** — Pair eligible orders at clearing price
6. **Update market state** — Volume, trades, last clearing price
7. **Emit events** — `OrderMatched` for each pair, `AuctionCleared` summary

**Returns:** `ClearAuctionResult`

**Constraints:**
- Governance must be operational (not in maintenance mode)
- Both order lists non-empty
- Clearing price > 0 and volume > 0

**Event:** `AuctionCleared { clearing_price, clearing_volume, matched_orders, timestamp }`

---

### execute_auction_matches

**Execute token transfers for auction matches.** Separates price discovery from settlement.

**Arguments:**
- `matches: Vec<AuctionMatch>` — Match pairs from `clear_auction`
- `clearing_price: u64` — Uniform clearing price

**Accounts:**
- `market` (readonly)
- `governance_config` (readonly)
- `authority` (Signer)

**Logic:**
1. For each match: calculate `trade_value = amount × clearing_price`
2. Calculate `market_fee = trade_value × fee_bps / 10000`
3. Emit `OrderMatched` event with fee details
4. Update market total volume and trade count

---

## Comparison with P2P Trading

| Feature | P2P (Continuous) | Auction (Periodic) |
|---------|------------------|-------------------|
| **Pricing** | Pay-as-bid (sell order price) | Uniform clearing price |
| **Execution** | Immediate | Batch (5-15 min window) |
| **Fee Rate** | `market_fee_bps` (default 25 bps) | Same (`market_fee_bps`) |
| **MEV Risk** | Moderate | Low (batch hides intent) |
| **Price Discovery** | Bilateral | Market-wide |
| **Fill Certainty** | Needs specific match | Aggregated liquidity |
| **Price Improvement** | None | Both sides benefit |

---

## Performance Characteristics

### Compute Units

| Operation | Estimated CU | Notes |
|-----------|--------------|-------|
| `clear_auction` (10 orders) | ~50,000 | Sorting + curve building + matching |
| `clear_auction` (50 orders) | ~150,000+ | O(n×m) clearing point search |
| `execute_auction_matches` (10 matches) | ~25,000 | Fee calc + events |

**Recommendation:** Limit auction batches to 20-30 orders for reliable block inclusion. The O(n×m) clearing point search can become expensive with large order sets.

### Memory Usage

- Order vectors: 96 bytes × (sell_count + buy_count)
- Curve vectors: 16 bytes × (sell_count + buy_count)
- Remaining arrays: 8 bytes × eligible orders

**Example:** 50 sells + 50 buys = ~10 KB heap for orders + ~1.6 KB for curves

---

## Test Coverage

The algorithm includes unit tests for:

| Test | Coverage |
|------|----------|
| `test_find_clearing_point_basic` | Standard supply/demand intersection |
| `test_find_clearing_point_no_intersection` | No valid clearing (supply prices > demand prices) |
| Full auction flow with order sorting | End-to-end clearing with match generation |

```bash
# Run auction clearing tests
cd programs/trading
cargo test --lib clear_auction
cargo test --lib find_clearing_point
```

---

## Future Enhancements

- **Dynamic Auction Windows** — Adjust window size based on order volume
- **Partial Clearing** — Allow multiple clearing points for better fill rates
- **Dutch Auction Support** — Descending price auction for surplus energy
- **Cross-Zone Clearing** — Aggregate liquidity across geographic zones

---

**Related:** [Trading Program](./trading.md) — Core marketplace · [Transaction Settlement](./transaction-settlement.md) — Settlement flows
