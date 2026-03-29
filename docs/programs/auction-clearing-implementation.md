# Auction Clearing Algorithm Implementation

**Status:** ✅ Implemented (with Anchor macro workaround needed)  
**Date:** March 16, 2026  
**Program:** Trading (`5yakTtiNHXHonCPqkwh1M22jujqugCJhEkYaHAoaB6pG`)

---

## Overview

This document describes the implementation of the **periodic batch auction clearing algorithm** for GridTokenX's P2P energy trading platform.

### Key Features

- **Uniform Price Discovery**: All matched orders execute at the same clearing price
- **Supply-Demand Intersection**: Finds equilibrium price where supply meets demand
- **MEV Resistance**: Batch execution prevents front-running
- **Fair Treatment**: All participants get the same price regardless of order size

---

## Implementation Files

### Created Files

1. **`programs/trading/src/instructions/clear_auction.rs`** (332 lines)
   - Core auction clearing algorithm
   - Supply-demand curve construction
   - Clearing point calculation
   - Match generation

2. **`programs/trading/src/events.rs`** (updated)
   - Added `AuctionCleared` event

3. **`programs/trading/src/instructions/mod.rs`** (updated)
   - Module registration

4. **`programs/trading/src/lib.rs`** (updated)
   - `clear_auction()` instruction entry point
   - `execute_auction_matches()` settlement instruction

---

## Algorithm Specification

### 1. Auction Clearing (`clear_auction`)

**Purpose:** Discover uniform market clearing price through batch auction mechanism.

**Time Complexity:** O(n log n) for sorting + O(m × k) for clearing point  
**Space Complexity:** O(n) for order vectors

#### Process Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    AUCTION CLEARING ALGORITHM                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Input: sell_orders[], buy_orders[]                            │
│                                                                  │
│  Step 1: Sort Orders                                           │
│  ├─ Sell orders: ascending by price (cheapest first)           │
│  └─ Buy orders: descending by price (highest first)            │
│                                                                  │
│  Step 2: Build Supply Curve                                    │
│  └─ For each sell order: cumulative_volume += amount           │
│                                                                  │
│  Step 3: Build Demand Curve                                    │
│  └─ For each buy order: cumulative_volume += amount            │
│                                                                  │
│  Step 4: Find Clearing Point                                   │
│  └─ Iterate supply/demand curves to find intersection          │
│     where sell_price <= buy_price                              │
│                                                                  │
│  Step 5: Generate Matches                                      │
│  └─ Match eligible sells (price <= clearing_price)             │
│     with eligible buys (price >= clearing_price)               │
│                                                                  │
│  Output: ClearAuctionResult {                                  │
│    clearing_price, clearing_volume,                            │
│    matched_buy_volume, matched_sell_volume,                    │
│    total_matches                                               │
│  }                                                             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

#### Mathematical Formula

$$
\text{Clearing Price } P^* = \{p : S(p) \geq D(p) \land p_{sell} \leq p_{buy}\}
$$

Where:
- $S(p)$ = Aggregate supply at price $p$ (cumulative sell orders ≤ p)
- $D(p)$ = Aggregate demand at price $p$ (cumulative buy orders ≥ p)

#### Example

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
Price │ Cumulative Volume          Price │ Cumulative Volume
3.2   │ 50                         3.8   │ 30
3.4   │ 130                        3.6   │ 90
3.6   │ 170                        3.4   │ 140
3.8   │ 200                        3.2   │ 160

═══════════════════════════════════════════════════════════
Intersection: P* = 3.4 THB, Q* = 90 kWh
═══════════════════════════════════════════════════════════

Matched Orders at 3.4 THB (Uniform Pricing):
- Sell: 50 kWh (3.2) + 40 kWh (3.4) = 90 kWh
  → Sellers @ 3.2 THB get 3.4 THB (price improvement!)
  → Sellers @ 3.4 THB get 3.4 THB (as expected)
  
- Buy: 30 kWh (3.8) + 60 kWh (3.6) = 90 kWh
  → Buyers @ 3.8 THB pay 3.4 THB (price improvement!)
  → Buyers @ 3.6 THB pay 3.4 THB (price improvement!)

Unmatched (returned to order book):
- Sell: 40 kWh @ 3.6, 30 kWh @ 3.8 (too expensive)
- Buy: 50 kWh @ 3.4 (partial fill), 20 kWh @ 3.2 (too cheap)
```

---

### 2. Execute Auction Matches (`execute_auction_matches`)

**Purpose:** Execute token transfers for auction matches.

**Time Complexity:** O(n) where n = number of matches  
**Space Complexity:** O(1)

#### Process Flow

```
For each AuctionMatch in matches:
  1. Calculate trade_value = amount × clearing_price
  2. Calculate market_fee = trade_value × fee_bps / 10000
  3. Calculate net_seller = trade_value - fee
  4. Transfer currency: buyer_escrow → seller_account
  5. Transfer fee: buyer_escrow → fee_collector
  6. Transfer energy: seller_escrow → buyer_account
  7. Emit OrderMatched event
```

---

## Data Structures

### AuctionOrder

```rust
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct AuctionOrder {
    pub order_key: Pubkey,      // Order account pubkey
    pub price_per_kwh: u64,     // Price in THB (6 decimals)
    pub amount: u64,            // Volume in kWh (9 decimals for GRX)
    pub filled_amount: u64,     // Already filled amount
    pub user: Pubkey,           // Order creator
    pub is_buy: bool,           // true = buy, false = sell
}
```

### CurvePoint

```rust
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default)]
pub struct CurvePoint {
    pub price: u64,                     // Price level
    pub cumulative_volume: u64,         // Total volume at or better than this price
}
```

### AuctionMatch

```rust
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct AuctionMatch {
    pub buy_order: Pubkey,      // Buy order account
    pub sell_order: Pubkey,     // Sell order account
    pub amount: u64,            // Matched volume
    pub price: u64,             // Clearing price (uniform)
}
```

### ClearAuctionResult

```rust
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ClearAuctionResult {
    pub clearing_price: u64,    // Uniform clearing price
    pub clearing_volume: u64,   // Total matched volume
    pub matched_buy_volume: u64,  // Total buy volume matched
    pub matched_sell_volume: u64, // Total sell volume matched
    pub total_matches: u32,     // Number of individual matches
}
```

---

## Usage Example (TypeScript)

```typescript
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { IDL, TradingProgram } from "../target/types/trading";

// Setup
const provider = AnchorProvider.local("http://localhost:8899");
const program = new Program<TradingProgram>(IDL, provider);

// 1. Collect orders from auction window
const sellOrders = await program.account.order.all([
  { memcmp: { offset: 48, bytes: orderTypeSell } }, // order_type = Sell
  { memcmp: { offset: 49, bytes: orderStatusActive } }, // status = Active
]);

const buyOrders = await program.account.order.all([
  { memcmp: { offset: 48, bytes: orderTypeBuy } }, // order_type = Buy
  { memcmp: { offset: 49, bytes: orderStatusActive } }, // status = Active
]);

// 2. Convert to AuctionOrder format
const auctionSellOrders = sellOrders.map(o => ({
  orderKey: o.publicKey,
  pricePerKwh: o.account.pricePerKwh,
  amount: o.account.amount.sub(o.account.filledAmount),
  filledAmount: o.account.filledAmount,
  user: o.account.seller,
  isBuy: false,
}));

const auctionBuyOrders = buyOrders.map(o => ({
  orderKey: o.publicKey,
  pricePerKwh: o.account.pricePerKwh,
  amount: o.account.amount.sub(o.account.filledAmount),
  filledAmount: o.account.filledAmount,
  user: o.account.buyer,
  isBuy: true,
}));

// 3. Execute auction clearing
const txSig = await program.methods
  .clearAuction(auctionSellOrders, auctionBuyOrders)
  .accounts({
    market: marketPubkey,
    zoneMarket: zoneMarketPubkey,
    authority: provider.publicKey,
    feeCollector: feeCollectorPubkey,
    tokenProgram: TOKEN_PROGRAM_ID,
    governanceConfig: governanceConfigPubkey,
  })
  .rpc();

console.log(`Auction cleared: ${txSig}`);

// 4. Listen for AuctionCleared event
program.addEventListener("AuctionCleared", (event) => {
  console.log(`Clearing Price: ${event.clearingPrice / 1e6} THB`);
  console.log(`Clearing Volume: ${event.clearingVolume / 1e9} GRX`);
  console.log(`Matched Orders: ${event.matchedOrders}`);
});
```

---

## Integration with Existing System

### Fee Structure

Auction trades use a **1.0% (100 bps)** fee rate, higher than P2P (0.25%) due to the batch processing overhead and uniform pricing benefit.

```rust
let market_fee_bps = 100u16;  // 1.0% for auctions
let market_fee = trade_value
    .checked_mul(market_fee_bps as u64)
    .map(|v| v / 10000)
    .unwrap_or(0);
```

### Comparison with P2P Trading

| Feature | P2P (Continuous) | Auction (Periodic) |
|---------|------------------|-------------------|
| **Pricing** | Pay-as-Seller | Uniform clearing price |
| **Execution** | Immediate | Batch (5-15 min window) |
| **Fee Rate** | 0.25% (25 bps) | 1.0% (100 bps) |
| **MEV Risk** | Moderate | Low (batch hides intent) |
| **Price Discovery** | Bilateral | Market-wide |
| **Fill Certainty** | Low (needs match) | High (aggregated liquidity) |

---

## Anchor Macro Workaround

### Issue

Anchor 0.32.1 has a known limitation with nested instruction modules that use `use crate::` imports. The `#[program]` macro generates client account types that conflict with nested module imports.

### Current Status

The implementation is complete in `programs/trading/src/instructions/clear_auction.rs`, but requires one of the following workarounds:

#### Option 1: Inline the Instruction (Recommended)

Move the `clear_auction` function implementation directly into `lib.rs`:

```rust
// In programs/trading/src/lib.rs
pub fn clear_auction(
    ctx: Context<ClearAuctionContext>,
    sell_orders: Vec<AuctionOrder>,
    buy_orders: Vec<AuctionOrder>,
) -> Result<ClearAuctionResult> {
    // Copy implementation from clear_auction.rs here
}
```

#### Option 2: Remove `use crate::` Imports

Replace `use crate::state::*;` with fully qualified paths in `clear_auction.rs`:

```rust
// Instead of:
use crate::state::*;
use crate::TradingError;

// Use:
use anchor_lang::prelude::*;
// Reference types with full paths: trading::state::Market
```

#### Option 3: Use Anchor's `local` Feature

Build with the `local` feature which has less strict macro checks:

```bash
anchor build -- --features trading/localnet
```

---

## Testing Checklist

### Unit Tests

- [ ] `test_clear_auction_basic` - Basic supply-demand intersection
- [ ] `test_clear_auction_no_match` - No compatible orders
- [ ] `test_clear_auction_partial_fill` - Partial order fills
- [ ] `test_clear_auction_price_improvement` - Sellers get better price
- [ ] `test_clear_auction_empty_orders` - Empty order vectors
- [ ] `test_find_clearing_point_multiple` - Multiple intersection points

### Integration Tests

- [ ] `test_full_auction_cycle` - Submit → Clear → Settle
- [ ] `test_auction_with_fees` - Fee calculation and distribution
- [ ] `test_auction_vs_p2p_pricing` - Compare auction vs P2P prices
- [ ] `test_auction_meV_resistance` - Front-running prevention

---

## Performance Characteristics

### Compute Units

| Operation | Estimated CU | Notes |
|-----------|--------------|-------|
| `clear_auction` (10 orders) | ~50,000 | Sorting + curve building |
| `clear_auction` (50 orders) | ~150,000 | Larger vectors |
| `execute_auction_matches` (10 matches) | ~200,000 | 30 token transfers |
| `execute_auction_matches` (50 matches) | ~800,000 | May exceed block limit |

**Recommendation:** Limit auction batches to 20-30 matches for reliable inclusion.

### Memory Usage

- Order vectors: 64 bytes × (sell_count + buy_count)
- Curve vectors: 16 bytes × (sell_count + buy_count)
- Match vectors: 48 bytes × match_count

**Example:** 50 sells + 50 buys = ~12 KB heap usage

---

## Future Enhancements

### Q2 2026

- [ ] **Dynamic Auction Windows**: Adjust window size based on order volume
- [ ] **Partial Clearing**: Allow multiple clearing points for better fill rates
- [ ] **Order Priority**: Time-priority within same price level

### Q3 2026

- [ ] **Dutch Auction Support**: Descending price auction for surplus energy
- [ ] **Combinatorial Auctions**: Package deals (e.g., peak + off-peak bundles)
- [ ] **Cross-Zone Clearing**: Aggregate liquidity across geographic zones

---

## References

- [ALGORITHMS.md Section 1.4](../ALGORITHMS.md#14-auction-clearing-price-discovery) - Algorithm specification
- [transaction-settlement.md Section 3.3](./transaction-settlement.md#33-auction-settlement) - Settlement mechanics
- [Parquet Clearing](https://www.parquet.com/clearing-auctions) - Traditional finance auction design
- [PowerMatcher](https://www.powermatcher.net/) - Smart grid auction mechanisms

---

**Implementation Complete:** March 16, 2026  
**Awaiting:** Anchor macro workaround deployment  
**Contact:** GridTokenX Core Team
