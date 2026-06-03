# GridTokenX Anchor — Complete Equation Inventory

> **Auto-generated reference** — every mathematical equation, formula, and arithmetic computation across all 5 Anchor programs.  
> Last updated: 2026-06-01

---

## Table of Contents

- [Overview](#overview)
- [1. Trading Program](#1-trading-program)
  - [1.1 Order Remaining Amount](#11-order-remaining-amount)
  - [1.2 Trade Value (CDA Match)](#12-trade-value-cda-match)
  - [1.3 Sharded Trade Value](#13-sharded-trade-value)
  - [1.4 Order Expiry Time](#14-order-expiry-time)
  - [1.5 Batch Timeout](#15-batch-timeout)
  - [1.6 Batch Volume Accumulation](#16-batch-volume-accumulation)
  - [1.7 Market Fee (Basis Points)](#17-market-fee-basis-points)
  - [1.8 Net Seller Amount (Atomic Settlement)](#18-net-seller-amount-atomic-settlement)
  - [1.9 Offchain Settlement Fee & Net](#19-offchain-settlement-fee--net)
  - [1.10 Batch Offchain Settlement (Per-Pair)](#110-batch-offchain-settlement-per-pair)
  - [1.11 Volume-Weighted Average Price (VWAP)](#111-volume-weighted-average-price-vwap)
  - [1.12 Ring-Buffer Head Advance](#112-ring-buffer-head-advance)
  - [1.13 Auction Supply Curve](#113-auction-supply-curve)
  - [1.14 Auction Demand Curve](#114-auction-demand-curve)
  - [1.15 Clearing Price Discovery](#115-clearing-price-discovery)
  - [1.16 Auction Match Generation](#116-auction-match-generation)
  - [1.17 Order Remaining for Nullifier (Offchain)](#117-order-remaining-for-nullifier-offchain)
  - [1.18 Zone Capacity Check](#118-zone-capacity-check)
  - [1.19 Sharding Assignment](#119-sharding-assignment)
- [2. Oracle Program](#2-oracle-program)
  - [2.1 Production/Consumption Ratio Validation](#21-productionconsumption-ratio-validation)
  - [2.2 Oracle Quality Score](#22-oracle-quality-score)
  - [2.3 Weighted Moving Average (Reading Interval)](#23-weighted-moving-average-reading-interval)
  - [2.4 Rate Limiting](#24-rate-limiting)
  - [2.5 Cumulative Energy Tracking](#25-cumulative-energy-tracking)
  - [2.6 Global Aggregation](#26-global-aggregation)
- [3. Registry Program](#3-registry-program)
  - [3.1 Net Generation (Settlement)](#31-net-generation-settlement)
  - [3.2 Airdrop Amount](#32-airdrop-amount)
  - [3.3 Minimum Validator Stake](#33-minimum-validator-stake)
  - [3.4 Meter Energy Delta Limit](#34-meter-energy-delta-limit)
  - [3.5 ERC Claim Tracking](#35-erc-claim-tracking)
  - [3.6 Shard Aggregation](#36-shard-aggregation)
- [4. Governance Program](#4-governance-program)
  - [4.1 DAO Voting Weight](#41-dao-voting-weight)
  - [4.2 Quorum Check](#42-quorum-check)
  - [4.3 Proposal Expiry](#43-proposal-expiry)
  - [4.4 Incentive Multiplier (Scaled)](#44-incentive-multiplier-scaled)
  - [4.5 Loss Factor (Scaled)](#45-loss-factor-scaled)
  - [4.6 ERC Validity Period Max](#46-erc-validity-period-max)
  - [4.7 ERC Unclaimed Generation](#47-erc-unclaimed-generation)
- [5. Energy Token Program](#5-energy-token-program)
  - [5.1 Token Decimals](#51-token-decimals)
  - [5.2 Total Supply Sync](#52-total-supply-sync)
- [Summary Table](#summary-table)

---

## Overview

GridTokenX Anchor consists of **5 Solana programs** containing **40 equations** spanning:

| Program | Equations | Categories |
|---------|-----------|------------|
| **Trading** | 19 | CDA matching, auction clearing, fee calculation, settlement, VWAP, sharding |
| **Oracle** | 6 | Anomaly detection, quality scoring, smoothing, rate limiting, aggregation |
| **Registry** | 6 | Tokenization, staking, double-counting prevention, distributed counting |
| **Governance** | 7 | DAO voting, quorum, zone parameters, REC lifecycle |
| **Energy Token** | 2 | Token configuration, supply tracking |

All on-chain arithmetic uses **integer math** (no floating-point). Safety mechanisms include `checked_mul`, `checked_add`, `saturating_sub`, and explicit overflow guards.

---

## 1. Trading Program

`programs/trading/` — Continuous Double Auction engine, order book, batch processing, and settlement.

### 1.1 Order Remaining Amount

**File:** `trading/src/lib.rs:307-309`

```text
buy_remaining  = buy_order.amount − buy_order.filled_amount
sell_remaining = sell_order.amount − sell_order.filled_amount
actual_match   = min(match_amount, buy_remaining, sell_remaining)
```

**Source code:**

```rust
let buy_remaining = buy_order.amount.saturating_sub(buy_order.filled_amount);
let sell_remaining = sell_order.amount.saturating_sub(sell_order.filled_amount);
let actual_match_amount = match_amount.min(buy_remaining).min(sell_remaining);
```

**Technical details:**

- Computes the **unfilled quantity** for each order in the CDA matching engine.
- Uses `saturating_sub` to prevent underflow when `filled_amount > amount` (defensive edge case).
- The match amount is capped at the **minimum of the three values** — ensuring no order is over-filled.
- The `actual_match_amount` is the true settlement quantity, which may be less than the requested `match_amount`.

---

### 1.2 Trade Value (CDA Match)

**File:** `trading/src/lib.rs:311-312`

```text
clearing_price = sell_order.price_per_kwh
total_value    = actual_match_amount × clearing_price
```

**Source code:**

```rust
let clearing_price = sell_order.price_per_kwh;
let total_value = actual_match_amount.saturating_mul(clearing_price);
```

**Technical details:**

- In the CDA `match_orders` instruction, the **clearing price is the seller's ask price** (price-taker convention — the passive side sets the price).
- The prerequisite check `buy_order.price_per_kwh >= sell_order.price_per_kwh` ensures the buyer is willing to pay at least the seller's asking price (bid ≥ ask).
- `saturating_mul` prevents overflow; both operands are `u64`.
- This is the **continuous matching** variant — matches execute immediately when compatible orders cross.

---

### 1.3 Sharded Trade Value

**File:** `trading/src/instructions/sharded_match_orders.rs:73`

```text
total_value = actual_match_amount × clearing_price
```

**Source code:**

```rust
total_value: actual_match_amount * clearing_price,
```

**Technical details:**

- Identical formula to [1.2](#12-trade-value-cda-match) but executed in the **sharded path**.
- Uses unchecked `*` (non-saturating) since both operands are already validated bounds from the matching logic.
- Shard updates go to `ZoneMarketShard` instead of `ZoneMarket`, avoiding write-lock contention on the main market account.
- The shard records `volume_accumulated`, `trade_count`, and `last_clearing_price` independently.

---

### 1.4 Order Expiry Time

**File:** `trading/src/lib.rs:212, 266`

```text
expires_at = created_at + 86,400
```

**Source code:**

```rust
order.expires_at = clock.unix_timestamp + 86400;
```

**Technical details:**

- All orders (buy and sell) expire **24 hours** (86,400 seconds) after creation.
- Hardcoded TTL — prevents stale orders from lingering in the order book.
- Orders can be explicitly cancelled before expiry via `cancel_order`.
- After expiry, orders are not automatically removed; off-chain agents should skip expired orders during matching.

---

### 1.5 Batch Timeout

**File:** `trading/src/lib.rs:438`

```text
batch.expires_at = clock.unix_timestamp + batch_config.batch_timeout_seconds
```

**Source code:**

```rust
expires_at: clock.unix_timestamp + market.batch_config.batch_timeout_seconds as i64,
```

**Technical details:**

- Batch orders have a **configurable timeout** (default: 300 seconds / 5 minutes).
- If the batch isn't executed before this deadline, subsequent `add_order_to_batch` calls are rejected with `BatchTooLarge`.
- A single `Clock::get()` syscall is hoisted before both the batch initialization and expiry check to save compute units.
- Batches can be cancelled via `cancel_batch` before timeout.

---

### 1.6 Batch Volume Accumulation

**File:** `trading/src/lib.rs:462, 501-503`

```text
batch.total_volume += (order.amount − order.filled_amount)

total_volume = Σᵢ pairᵢ.amount    (saturating fold)
```

**Source code:**

```rust
// When adding to batch:
market.current_batch.total_volume += order.amount.saturating_sub(order.filled_amount);

// When executing batch:
let total_volume: u64 = match_pairs
    .iter()
    .fold(0u64, |acc, pair| acc.saturating_add(pair.amount));
```

**Technical details:**

- When adding an order to a batch, only the **unfilled remainder** (`amount − filled_amount`) is counted toward batch volume.
- On execution, all match pair amounts are **folded** into a total volume with overflow-safe `saturating_add`.
- The batch is limited to **32 orders** (fixed-size `order_ids: [Pubkey; 32]` array) and `max_batch_size` (default: 100, capped by array size).

---

### 1.7 Market Fee (Basis Points)

**File:** `trading/src/lib.rs:1039-1043`, `1107-1110`

```text
trade_value = amount × clearing_price
market_fee  = ⌊(trade_value × market_fee_bps) / 10,000⌋
```

**Default:** `market_fee_bps = 25` → **0.25% fee**

**Source code:**

```rust
let trade_value = auction_match.amount.saturating_mul(clearing_price);
let market_fee = trade_value
    .checked_mul(market_fee_bps)
    .map(|v| v / 10000)
    .ok_or(TradingError::Overflow)?;
```

**Technical details:**

- **Basis-point fee** calculation. One basis point = 0.01%, so 25 bps = 0.25%.
- Uses `checked_mul` to detect overflow before the division. If the multiplication overflows `u64`, the transaction fails with `TradingError::Overflow`.
- Integer division by 10,000 truncates (floors) — the fee is rounded down, favoring the trader.
- The fee is deducted from the buyer's total payment; the seller receives the remainder.

---

### 1.8 Net Seller Amount (Atomic Settlement)

**File:** `trading/src/lib.rs:1106-1114`

```text
total_currency_value = amount × price
net_seller_amount    = total_currency_value − market_fee − wheeling_charge − loss_cost
```

**Source code:**

```rust
let total_currency_value = amount.saturating_mul(price);
let market_fee = total_currency_value
    .checked_mul(market.market_fee_bps as u64)
    .map(|v| v / 10000)
    .ok_or(TradingError::Overflow)?;
let net_seller_amount = total_currency_value
    .saturating_sub(market_fee)
    .saturating_sub(wheeling_charge_val)
    .saturating_sub(loss_cost_val);
```

**Technical details:**

- **Full settlement equation** — the buyer's currency payment is split four ways:
  1. **Market fee** → `fee_collector` treasury (0.25% default)
  2. **Seller proceeds** → `seller_currency_account`
  3. **Wheeling charge** → `wheeling_collector` (grid operator transmission fee)
  4. **Loss cost** → `loss_collector` (transmission loss compensation)
- Each deduction uses `saturating_sub` so the net never goes negative.
- Slippage protection ensures: `sell_order.price_per_kwh ≤ price ≤ buy_order.price_per_kwh`.
- Five separate CPI `transfer_checked` calls execute the token movements atomically.

---

### 1.9 Offchain Settlement Fee & Net

**File:** `trading/src/instructions/settle_offchain.rs:251-253`

```text
total_currency_value = match_amount × match_price
market_fee          = ⌊(total_currency_value × market_fee_bps) / 10,000⌋
net_seller_amount   = total_currency_value − market_fee − wheeling_charge − loss_cost
```

**Source code:**

```rust
let total_currency_value = match_amount.saturating_mul(match_price);
let market_fee = total_currency_value
    .checked_mul(market.market_fee_bps as u64)
    .map(|v| v / 10000)
    .ok_or(TradingError::Overflow)?;
let net_seller_amount = total_currency_value
    .saturating_sub(market_fee)
    .saturating_sub(wheeling_charge_val)
    .saturating_sub(loss_cost_val);
```

**Technical details:**

- Identical fee formula to [1.7](#17-market-fee-basis-points) and [1.8](#18-net-seller-amount-atomic-settlement), applied in the **Ed25519-signed off-chain matching path**.
- Both buyer and seller must pre-sign their order payload with Ed25519; signatures are verified on-chain via the Solana instruction introspection sysvar.
- Nullifier PDAs (instead of Order accounts) track partial fills: `seeds = [b"nullifier", user.as_ref(), &order_id]`.

---

### 1.10 Batch Offchain Settlement (Per-Pair)

**File:** `trading/src/instructions/settle_offchain.rs:363-365`

```text
total_value = match_amount × match_price
market_fee  = ⌊(total_value × market_fee_bps) / 10,000⌋
net_seller  = total_value − market_fee − wheeling_charge − loss_cost
```

**Source code:**

```rust
let total_value = m.match_amount.saturating_mul(m.match_price);
let market_fee = total_value
    .checked_mul(market.market_fee_bps as u64)
    .map(|v| v / 10000)
    .ok_or(TradingError::Overflow)?;
let net_seller = total_value
    .saturating_sub(market_fee)
    .saturating_sub(m.wheeling_charge)
    .saturating_sub(m.loss_cost);
```

**Technical details:**

- Same as [1.9](#19-offchain-settlement-fee--net) but inside a loop processing **up to 4 match pairs atomically**.
- Ed25519 signature indices are computed as `i * 2` (buyer) and `i * 2 + 1` (seller) for the i-th pair.
- Remaining accounts must number exactly `match_count × 6` (buyer_nullifier, seller_nullifier, buyer_currency, seller_currency, seller_energy, buyer_energy per pair).

---

### 1.11 Volume-Weighted Average Price (VWAP)

**File:** `trading/src/lib.rs:798-811`

```text
total_volume = Σᵢ pointᵢ.volume
total_value  = Σᵢ (pointᵢ.volume × pointᵢ.price)

         total_value
VWAP = ───────────────     if total_volume > 0
        total_volume
```

**Source code:**

```rust
let mut total_volume: u64 = 0;
let mut total_value: u64 = 0;

for i in 0..market.price_history_count as usize {
    let point = market.price_history[i];
    if point.volume > 0 {
        total_volume = total_volume.saturating_add(point.volume);
        total_value = total_value.saturating_add(
            point.volume.saturating_mul(point.price)
        );
    }
}

if total_volume > 0 {
    market.volume_weighted_price = total_value / total_volume;
}
```

**Technical details:**

- **Rolling 24-hour VWAP** computed over the ring-buffer price history.
- Each trade records a `PricePoint { price, volume, timestamp }`.
- VWAP weights each price by its traded volume, giving a more accurate market price than a simple arithmetic mean.
- Integer division truncates (floors) — acceptable for on-chain display; off-chain consumers can apply rounding.
- The ring buffer holds at most 24 entries, so the loop is bounded at O(24) = O(1).
- Uses `saturating_add` and `saturating_mul` throughout to prevent overflow on high-volume markets.

---

### 1.12 Ring-Buffer Head Advance

**File:** `trading/src/lib.rs:792`

```text
price_history_head = (head + 1) mod 24
```

**Source code:**

```rust
market.price_history_head = ((head + 1) % 24) as u8;
```

**Technical details:**

- **Circular buffer** index advance for the 24-slot price history.
- O(1) insertion — no array shifting required. The head wraps at 24.
- `price_history_count` tracks how many slots are valid (caps at 24).
- The oldest entry is overwritten when the buffer is full.

---

### 1.13 Auction Supply Curve

**File:** `trading/src/lib.rs:893-901`

```text
cumulative_supplyⱼ = Σₖ₌₀ʲ sell_orderₖ.amount    (sorted by price ASC)
```

**Source code:**

```rust
let mut sorted_sells = sell_orders.clone();
sorted_sells.sort_by(|a, b| a.price_per_kwh.cmp(&b.price_per_kwh));

let mut cumulative_supply = 0u64;
for order in &sorted_sells {
    cumulative_supply = cumulative_supply.saturating_add(order.amount);
    supply_curve.push(CurvePoint {
        price: order.price_per_kwh,
        cumulative_volume: cumulative_supply,
    });
}
```

**Technical details:**

- Builds the **aggregate supply curve** for uniform-price auction clearing.
- Sell orders are sorted **ascending by price** — cheapest sellers first.
- Each curve point stores the cumulative volume available at or below that price.
- The supply curve monotonically increases in both price and volume.

---

### 1.14 Auction Demand Curve

**File:** `trading/src/lib.rs:905-913`

```text
cumulative_demandⱼ = Σₖ₌₀ʲ buy_orderₖ.amount    (sorted by price DESC)
```

**Source code:**

```rust
let mut sorted_buys = buy_orders.clone();
sorted_buys.sort_by(|a, b| b.price_per_kwh.cmp(&a.price_per_kwh));

let mut cumulative_demand = 0u64;
for order in &sorted_buys {
    cumulative_demand = cumulative_demand.saturating_add(order.amount);
    demand_curve.push(CurvePoint {
        price: order.price_per_kwh,
        cumulative_volume: cumulative_demand,
    });
}
```

**Technical details:**

- Builds the **aggregate demand curve** for uniform-price auction clearing.
- Buy orders are sorted **descending by price** — highest bidders first.
- Each curve point stores the cumulative volume demanded at or above that price.
- The demand curve monotonically decreases in price but increases in volume.

---

### 1.15 Clearing Price Discovery

**File:** `trading/src/lib.rs:1576-1599`

```text
best_price  = 0
best_volume = 0

For each supply_pointᵢ, demand_pointⱼ:
    if supply_pointᵢ.price ≤ demand_pointⱼ.price:
        volume = min(supply_pointᵢ.cumulative_volume, demand_pointⱼ.cumulative_volume)
        if volume > best_volume:
            best_volume = volume
            best_price  = supply_pointᵢ.price
```

**Source code:**

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
                let volume = supply_point.cumulative_volume
                    .min(demand_point.cumulative_volume);
                if volume > best_volume {
                    best_volume = volume;
                    best_price = supply_point.price;
                }
            }
        }
    }

    require!(best_price > 0, TradingError::InvalidPrice);
    require!(best_volume > 0, TradingError::InvalidAmount);

    Ok((best_price, best_volume))
}
```

**Technical details:**

- Finds the **uniform clearing price** — the price that maximizes traded volume where supply ≤ demand.
- This is a **grid search** over all supply-demand curve intersections.
- The clearing price is set at the **marginal seller's price**, ensuring all matched buyers pay the same price (uniform price auction).
- **Time complexity:** O(n × m) where n = supply points, m = demand points.
- **Space complexity:** O(n) for order vectors.
- If no intersection exists (all supply prices > all demand prices), returns error `InvalidPrice`.

---

### 1.16 Auction Match Generation

**File:** `trading/src/lib.rs:952-981`

```text
match_amount = min(sell_remaining, buy_remaining)
total_value  = match_amount × clearing_price
```

**Source code:**

```rust
let match_amount = (*sell_rem).min(*buy_rem);

emit!(crate::events::OrderMatched {
    // ...
    amount: match_amount,
    price: clearing_price,
    total_value: match_amount.saturating_mul(clearing_price),
    // ...
});
```

**Technical details:**

- After finding the clearing price, **eligible orders** are identified:
  - Sellers with `price_per_kwh ≤ clearing_price`
  - Buyers with `price_per_kwh ≥ clearing_price`
- Orders are matched **greedily** in sorted order.
- The match amount is the minimum of remaining quantities.
- All matches execute at the **uniform clearing price** — buyers who bid higher receive a price improvement (surplus).

---

### 1.17 Order Remaining for Nullifier (Offchain)

**File:** `trading/src/instructions/settle_offchain.rs:246-248`

```text
buyer_remaining  = buyer_payload.energy_amount − buyer_nullifier.filled_amount
seller_remaining = seller_payload.energy_amount − seller_nullifier.filled_amount
```

**Source code:**

```rust
let buyer_remaining = buyer_payload.energy_amount
    .saturating_sub(ctx.accounts.buyer_nullifier.filled_amount);
let seller_remaining = seller_payload.energy_amount
    .saturating_sub(ctx.accounts.seller_nullifier.filled_amount);
require!(
    match_amount <= buyer_remaining && match_amount <= seller_remaining,
    TradingError::InvalidAmount
);
```

**Technical details:**

- Off-chain matching uses **nullifier accounts** to track partial fills instead of on-chain Order PDAs.
- Nullifier PDA seeds: `[b"nullifier", user.as_ref(), &order_id]`.
- Each nullifier stores `filled_amount` — cumulative energy matched so far.
- The remaining amount is computed as `energy_amount − filled_amount` using `saturating_sub`.

---

### 1.18 Zone Capacity Check

**File:** `trading/src/instructions/settle_offchain.rs:241-243`

```text
new_total_flow = committed_flow + match_amount
require(new_total_flow ≤ capacity)
committed_flow = new_total_flow
```

**Source code:**

```rust
if zone_market.capacity > 0 && seller_payload.zone_id != zone_market.zone_id {
    let new_total_flow = zone_market.committed_flow
        .checked_add(match_amount)
        .ok_or(TradingError::Overflow)?;
    require!(new_total_flow <= zone_market.capacity, TradingError::CapacityExceeded);
    zone_market.committed_flow = new_total_flow;
}
```

**Technical details:**

- **Transmission capacity constraint** for cross-zone trades.
- Only applies when the seller's zone differs from the zone market's zone.
- The match amount is checked against the zone's maximum capacity to prevent overcommitting grid transmission lines.
- Uses `checked_add` to detect overflow before comparison.
- Intra-zone trades (same zone) bypass this check.

---

### 1.19 Sharding Assignment

**File:** `trading/src/state/market.rs:144-147`

```text
shard_id = Pubkey.bytes[0] mod num_shards
```

**Source code:**

```rust
pub fn get_shard_id(authority: &Pubkey, num_shards: u8) -> u8 {
    authority.to_bytes()[0] % num_shards
}
```

**Technical details:**

- Simple **hash-based shard assignment** using the first byte of the user's public key.
- Distributes load across shards for parallel execution on Solana's **Sealevel runtime**.
- Each shard has its own `MarketShard` / `ZoneMarketShard` PDA, allowing concurrent writes without MVCC conflicts.
- The modulo operation ensures even distribution across `num_shards` shards (0 to `num_shards − 1`).

---

## 2. Oracle Program

`programs/oracle/` — AMI meter data ingestion, validation, and aggregation.

### 2.1 Production/Consumption Ratio Validation

**File:** `oracle/src/lib.rs:493-508`

```text
energy_produced × 100 ≤ max_production_consumption_ratio × energy_consumed
```

**Source code:**

```rust
if energy_consumed > 0 {
    require!(
        energy_produced
            .checked_mul(100)
            .ok_or(OracleError::InvalidConfiguration)?
            <= (oracle_data.max_production_consumption_ratio as u64)
                .checked_mul(energy_consumed)
                .ok_or(OracleError::InvalidConfiguration)?,
        OracleError::AnomalousReading
    );
}
```

**Technical details:**

- **Anomaly detection** — rejects readings where production is wildly disproportionate to consumption.
- Uses **integer cross-multiplication** to avoid floating-point arithmetic on-chain.
- Instead of computing `produced / consumed` (which loses precision and requires division), the code computes `produced × 100 ≤ max_ratio × consumed`.
- **Default:** `max_production_consumption_ratio = 1000` (10.0×).
- **Example:** A meter reports 1,000 kWh produced but only 50 kWh consumed:
  - LHS: `1,000 × 100 = 100,000`
  - RHS: `1,000 × 50 = 50,000`
  - `100,000 ≤ 50,000` → **false** → **rejected** (ratio is 20×, exceeds 10× limit)
- Skipped when `energy_consumed == 0` to avoid division by zero (a solar farm may produce without consuming).
- Both `checked_mul` calls detect `u64` overflow and return `InvalidConfiguration`.

---

### 2.2 Oracle Quality Score

**File:** `oracle/src/lib.rs:439-447`

```text
                          total_valid_readings
success_rate = ⌊ ─────────────────────────────────────── × 100 ⌋
                total_valid_readings + total_rejected_readings

quality_score = min(success_rate, 100)
```

**Source code:**

```rust
let total = oracle_data.total_valid_readings + oracle_data.total_rejected_readings;
if total > 0 {
    let success_rate = oracle_data.total_valid_readings
        .saturating_mul(100)
        .checked_div(total)
        .unwrap_or(0);
    oracle_data.last_quality_score = success_rate.min(100) as u8;
    oracle_data.quality_score_updated_at = current_time;
}
```

**Technical details:**

- Percentage of valid readings out of total readings, scaled 0–100.
- Stored as `u8` — sufficient granularity for a quality metric.
- `min(success_rate, 100)` caps the score at 100 (defensive against edge cases).
- Computed during `aggregate_readings` batch updates, not per-reading (reduces compute).
- Used to assess oracle/meter reliability; off-chain agents may use this to weight readings.

---

### 2.3 Weighted Moving Average (Reading Interval)

**File:** `oracle/src/lib.rs:551-563`

```text
            old_average × 4 + new_interval
WMA = ⌊ ───────────────────────────────────── ⌋
                      5
```

Which is mathematically equivalent to:

```text
WMA = 0.8 × old_average + 0.2 × new_interval
```

**Source code:**

```rust
let weighted_sum = (oracle_data.average_reading_interval as u64)
    .checked_mul(4)
    .ok_or(ProgramError::ArithmeticOverflow)?
    .checked_add(new_interval as u64)
    .ok_or(ProgramError::ArithmeticOverflow)?
    .checked_div(5)
    .ok_or(ProgramError::ArithmeticOverflow)?;

oracle_data.average_reading_interval = weighted_sum as u32;
```

**Technical details:**

- **Exponential smoothing** for meter reading intervals — a form of Weighted Moving Average (WMA).
- The **80/20 weighting** dampens transient spikes (e.g., a single delayed reading) while still tracking gradual trend changes.
- Integer approximation of `(old × 0.8) + (new × 0.2)` using `(old × 4 + new) / 5`.
- **Example:** If average was 300s and new reading is 600s:
  - WMA = (300 × 4 + 600) / 5 = 1,800 / 5 = 360s
  - Gradual adjustment (not a sudden jump to 600s)
- On first reading (`average_reading_interval == 0`), the interval is used directly (initialization).
- All arithmetic uses `checked_*` to detect overflow.

---

### 2.4 Rate Limiting

**File:** `oracle/src/lib.rs:119-121`

```text
require(reading_timestamp ≥ last_reading_timestamp + min_reading_interval)
```

**Source code:**

```rust
require!(
    reading_timestamp >= ctx.accounts.meter_state.last_reading_timestamp
        .saturating_add(oracle_data.min_reading_interval as i64),
    OracleError::RateLimitExceeded
);
```

**Technical details:**

- **Default:** `min_reading_interval = 60` seconds.
- Prevents **meter flooding** — each meter must wait at least 60 seconds between readings.
- Combined with the timestamp monotonicity check (`reading_timestamp > last_reading_timestamp`), this provides both rate limiting and replay protection.
- Per-meter enforcement (each meter has its own `MeterState` PDA with independent `last_reading_timestamp`).
- The `saturating_add` prevents overflow when `last_reading_timestamp` is near `i64::MAX`.

---

### 2.5 Cumulative Energy Tracking

**File:** `oracle/src/lib.rs:164-167`

```text
total_energy_produced  ← total_energy_produced  + energy_produced
total_energy_consumed  ← total_energy_consumed  + energy_consumed
total_readings         ← total_readings          + 1
```

**Source code:**

```rust
meter_state.total_energy_produced = meter_state.total_energy_produced
    .saturating_add(energy_produced);
meter_state.total_energy_consumed = meter_state.total_energy_consumed
    .saturating_add(energy_consumed);
meter_state.total_readings = meter_state.total_readings.saturating_add(1);
```

**Technical details:**

- **Per-meter cumulative counters** — each `MeterState` PDA tracks lifetime production and consumption.
- `saturating_add` prevents overflow (counter saturates at `u64::MAX` instead of wrapping).
- These cumulative values are the **raw inputs** for settlement calculations (see [3.1](#31-net-generation-settlement)).
- Latest reading values (`energy_produced`, `energy_consumed`) are also stored for anomaly detection (deviation check against previous reading).

---

### 2.6 Global Aggregation

**File:** `oracle/src/lib.rs:431-435`

```text
total_global_energy_produced  += total_produced
total_global_energy_consumed  += total_consumed
total_valid_readings          += valid_count
total_rejected_readings       += rejected_count
total_readings                = total_valid_readings + total_rejected_readings
```

**Source code:**

```rust
oracle_data.total_global_energy_produced = oracle_data.total_global_energy_produced
    .saturating_add(total_produced);
oracle_data.total_global_energy_consumed = oracle_data.total_global_energy_consumed
    .saturating_add(total_consumed);
oracle_data.total_valid_readings = oracle_data.total_valid_readings
    .saturating_add(valid_count);
oracle_data.total_rejected_readings = oracle_data.total_rejected_readings
    .saturating_add(rejected_count);
oracle_data.total_readings = oracle_data.total_readings
    .saturating_add(valid_count)
    .saturating_add(rejected_count);
```

**Technical details:**

- **Periodic batch aggregation** of meter data into global counters.
- Called by the **API Gateway** (chain bridge), not per-reading — avoids write-lock contention on `OracleData` during high-frequency submissions.
- The quality score is recomputed inline after each aggregation (see [2.2](#22-oracle-quality-score)).
- `total_readings` is computed as the sum of valid + rejected (double-counting is intentional — it tracks total processing attempts).

---

## 3. Registry Program

`programs/registry/` — User/meter registration, energy settlement, tokenization, and staking.

### 3.1 Net Generation (Settlement)

**File:** `registry/src/lib.rs:470-477`, `614-619`

```text
current_net_generation = total_generation − total_consumption
unsettled_balance      = current_net_generation − settled_net_generation
new_tokens_to_mint     = unsettled_balance
```

**Source code:**

```rust
// View function:
let current_net_gen = meter.total_generation.saturating_sub(meter.total_consumption);
let unsettled = current_net_gen.saturating_sub(meter.settled_net_generation);
Ok(unsettled)

// Settlement function:
let current_net_gen = meter.total_generation.saturating_sub(meter.total_consumption);
let new_tokens_to_mint = current_net_gen.saturating_sub(meter.settled_net_generation);
require!(new_tokens_to_mint > 0, RegistryError::NoUnsettledBalance);
meter.settled_net_generation = current_net_gen;
```

**Technical details:**

- **Core tokenization equation** — a meter's net generation (total produced minus total consumed) minus what's already been settled gives the amount eligible for GRID token minting.
- **Prevents double-minting:** `settled_net_generation` is monotonically increasing and always ≤ `current_net_generation`.
- If a meter consumes more than it produces overall (net consumer), `current_net_generation = 0` (via `saturating_sub`), and no tokens are minted.
- The `settle_and_mint_tokens` instruction combines settlement with a CPI to `mint_tokens_direct` for atomic minting.
- **Invariant:** `settled_net_generation ≤ current_net_generation` (enforced by `saturating_sub`)

---

### 3.2 Airdrop Amount

**File:** `registry/src/lib.rs:17`

```text
AIRDROP_AMOUNT = 20,000,000,000    (20 GRX with 9 decimals)
```

**Source code:**

```rust
pub const AIRDROP_AMOUNT: u64 = 20_000_000_000; // 20 GRX tokens
```

**Technical details:**

- Fixed airdrop of **20 GRX tokens** to newly registered users.
- Automatically minted via CPI to the energy-token program's `mint_tokens_direct` instruction.
- The Registry PDA signs the CPI using its `[b"registry"]` seeds.
- Airdrop failure is **non-critical** — user registration succeeds even if minting fails (logged as a warning).

---

### 3.3 Minimum Validator Stake

**File:** `registry/src/lib.rs:589`

```text
MIN_VALIDATOR_STAKE = 10,000,000,000,000    (10,000 GRX with 9 decimals)
```

**Source code:**

```rust
const MIN_VALIDATOR_STAKE: u64 = 10_000_000_000_000;
require!(
    user_account.staked_grx >= MIN_VALIDATOR_STAKE,
    RegistryError::MinStakeNotMet
);
```

**Technical details:**

- **Proof-of-stake threshold** — users must stake at least 10,000 GRX before registering as a validator.
- Staking is done via `stake_grx`, which transfers tokens from the user's ATA to the `grx_vault` PDA.
- The staked amount is tracked in `UserAccount.staked_grx` for on-chain verification.

---

### 3.4 Meter Energy Delta Limit

**File:** `registry/src/lib.rs:363-364`

```text
require(energy_generated ≤ 1,000,000,000,000)
require(energy_consumed  ≤ 1,000,000,000,000)
```

**Source code:**

```rust
const MAX_READING_DELTA: u64 = 1_000_000_000_000;
require!(energy_generated <= MAX_READING_DELTA, RegistryError::ReadingTooHigh);
require!(energy_consumed <= MAX_READING_DELTA, RegistryError::ReadingTooHigh);
```

**Technical details:**

- **Sanity check cap** of 1 TWh (10¹² Wh) per reading update.
- Prevents overflow or compromised oracle from injecting impossible values.
- The cap is per-reading (delta), not cumulative — cumulative totals can exceed this over time via `checked_add`.
- Applied in `update_meter_reading` (oracle-authorized path), not in the oracle's `submit_meter_reading` (which has its own `max_energy_value` check).

---

### 3.5 ERC Claim Tracking

**File:** `registry/src/lib.rs:537-542`

```text
unclaimed = total_generation − claimed_erc_generation
require(amount ≤ unclaimed)
claimed_erc_generation += amount
```

**Source code:**

```rust
let unclaimed = meter.total_generation
    .saturating_sub(meter.claimed_erc_generation);
require!(amount <= unclaimed, RegistryError::NoUnsettledBalance);
meter.claimed_erc_generation = meter.claimed_erc_generation
    .saturating_add(amount);
```

**Technical details:**

- **Double-counting prevention** — ensures the same energy generation cannot be certified twice.
- Each meter tracks `claimed_erc_generation` — the cumulative amount already used for ERC issuance.
- The claimable amount is the difference: `total_generation − claimed_erc_generation`.
- Called by the governance program's `issue_erc` instruction via CPI for atomic claim + certification.
- This is a separate tracker from `settled_net_generation` (tokenization) — the same energy can be both tokenized and certified, but neither can double-count within its own domain.

---

### 3.6 Shard Aggregation

**File:** `registry/src/lib.rs:139-161`

```text
total_users  = Σⱼ shardⱼ.user_count     (j = 0..15)
total_meters = Σⱼ shardⱼ.meter_count    (j = 0..15)
```

**Source code:**

```rust
let mut total_users = 0u64;
let mut total_meters = 0u64;

for account_info in ctx.remaining_accounts.iter() {
    // ... validate PDA ...
    total_users = total_users
        .checked_add(shard.user_count)
        .ok_or(RegistryError::MathOverflow)?;
    total_meters = total_meters
        .checked_add(shard.meter_count)
        .ok_or(RegistryError::MathOverflow)?;
}

registry.user_count = total_users;
registry.meter_count = total_meters;
```

**Technical details:**

- **Distributed counting** — each of the 16 registry shards independently tracks user and meter counts.
- The `aggregate_shards` admin instruction sums all shard counts into the global registry.
- Shard PDAs are validated: `seeds = [b"registry_shard", &[shard_id]]` and verified against expected address.
- Uses `checked_add` to detect overflow — fails the transaction if global count exceeds `u64::MAX`.
- Avoids write-lock contention on a single `Registry` account during high-frequency registrations.

---

## 4. Governance Program

`programs/governance/` — Proof-of-Authority config, ERC lifecycle, and DAO governance.

### 4.1 DAO Voting Weight

**File:** `governance/src/handlers/dao.rs:78-91`

```text
weight = max(100, ⌊ total_generation / 1,000 ⌋)
```

**Source code:**

```rust
let weight: u64 = {
    let meter_data = ctx.accounts.meter_account.try_borrow_data()?;
    let meter = bytemuck::from_bytes::<MeterAccount>(&meter_data[8..]);
    let meter_owner = Pubkey::new_from_array(meter.owner);
    require!(
        meter_owner == ctx.accounts.voter.key(),
        GovernanceError::MeterOwnerMismatch
    );
    (meter.total_generation / 1_000).max(100)
};
```

**Technical details:**

- **Proof-of-generation voting** — each voter's weight is proportional to their meter's lifetime energy generation.
- 1 weight unit per 1,000 kWh of lifetime generation.
- **Minimum floor of 100 weight** ensures all participants have a voice regardless of generation size.
- **Example:** A meter with 500,000 kWh lifetime generation: weight = max(100, 500) = **500 votes**.
- The voter must own the meter account they're voting with (validated via PDA ownership check).
- This creates a **sybil-resistant** voting mechanism — creating new meters doesn't increase weight (weight is based on proven generation).

---

### 4.2 Quorum Check

**File:** `governance/src/handlers/dao.rs:136-144`

```text
total_votes = votes_for + votes_against

if total_votes < min_quorum:     → Rejected  (insufficient participation)
else if votes_for > votes_against: → Passed
else:                               → Rejected
```

**Source code:**

```rust
let total_votes = proposal.votes_for.saturating_add(proposal.votes_against);
if total_votes < min_quorum {
    proposal.status = ProposalStatus::Rejected;
} else if proposal.votes_for > proposal.votes_against {
    proposal.status = ProposalStatus::Passed;
} else {
    proposal.status = ProposalStatus::Rejected;
}
```

**Technical details:**

- **Two-stage proposal finalization:**
  1. **Quorum check** — enough participation? (configurable `min_quorum_votes` in `PoAConfig`)
  2. **Majority check** — more for than against? (simple majority, no supermajority)
- Ties are resolved as **rejected** (conservative default).
- Auto-finalization happens at execution time (`execute_proposal`), not at expiry — proposals remain `Active` until someone calls execute.
- `saturating_add` prevents overflow when summing vote tallies.

---

### 4.3 Proposal Expiry

**File:** `governance/src/handlers/dao.rs:42`

```text
expires_at = clock.unix_timestamp + voting_period_seconds
```

**Source code:**

```rust
proposal.expires_at = clock.unix_timestamp + voting_period_seconds;
```

**Technical details:**

- Each proposal has a **configurable voting period** (`voting_period_seconds` parameter).
- After expiry, no more votes can be cast (`ProposalExpired` error).
- The proposal is then eligible for execution via `execute_proposal`.
- The expiry timestamp is stored on-chain, enabling trustless verification.

---

### 4.4 Incentive Multiplier (Scaled)

**File:** `governance/src/state/zone_config.rs:7`

```text
incentive_multiplier = stored_value / 1000
```

| Stored Value | Actual Multiplier |
|:---:|:---:|
| 1000 | 1.00× (no incentive) |
| 1150 | 1.15× (15% incentive) |
| 2000 | 2.00× (2× incentive) |

**Technical details:**

- **Fixed-point representation** — stored as integer × 1000 to avoid floating-point on-chain.
- Applied off-chain when computing generation rewards for a zone.
- Adjustable via DAO governance (`GridParameter::IncentiveMultiplier`).
- Higher multipliers incentivize renewable generation in specific zones (e.g., remote islands with high solar potential).

---

### 4.5 Loss Factor (Scaled)

**File:** `governance/src/state/zone_config.rs:10`

```text
loss_factor = stored_value / 1000
```

| Stored Value | Actual Factor | Meaning |
|:---:|:---:|:---|
| 1000 | 1.00× | No adjustment (default) |
| 1050 | 1.05× | 5% transmission loss |
| 1200 | 1.20× | 20% transmission loss |

**Technical details:**

- **Fixed-point representation** — stored as integer × 1000.
- The `require(new_value > 0)` guard in `execute_proposal` ensures the divisor is never zero.
- Adjustable via DAO governance (`GridParameter::LossFactor`).
- Used to compute `loss_cost` in settlement equations [1.8](#18-net-seller-amount-atomic-settlement) and [1.9](#19-offchain-settlement-fee--net).
- **Default:** `1_000` (no loss adjustment) — set during `initialize_zone_config`.

---

### 4.6 ERC Validity Period Max

**File:** `governance/src/state/poa_config.rs:129`

```text
max_erc_validity = 31,536,000 × 2 = 63,072,000 seconds (≈ 2 years)
```

**Source code:**

```rust
require!(
    self.erc_validity_period > 0 && self.erc_validity_period <= 31_536_000 * 2,
    GovernanceError::InvalidValidityPeriod
);
```

**Technical details:**

- ERC certificates cannot have a validity period exceeding **2 years** (2 × 365.25 days in seconds).
- `31,536,000` seconds = 365 days (non-leap year). Multiplied by 2 = 730 days ≈ 2 years.
- The minimum is > 0 (no zero-period certificates).
- When an ERC certificate is issued, its expiry is computed as: `expires_at = issued_at + erc_validity_period`.

---

### 4.7 ERC Unclaimed Generation

**File:** `governance/src/handlers/erc.rs:25-27`

```text
unclaimed = meter.total_generation − meter.claimed_erc_generation
```

**Source code:**

```rust
let unclaimed = meter.total_generation
    .saturating_sub(meter.claimed_erc_generation);
```

**Technical details:**

- Same double-counting prevention as Registry [3.5](#35-erc-claim-tracking), but checked in the **governance program** before issuing an ERC certificate.
- The subsequent CPI to `mark_erc_claimed` atomically updates the registry's `claimed_erc_generation`.
- This two-step (check + update) is atomic within a single transaction.
- The check happens in the governance program because it's the ERC-issuing authority, while the registry owns the meter data.

---

## 5. Energy Token Program

`programs/energy-token/` — GRID token minting, burning, transfers, and REC validation.

### 5.1 Token Decimals

**File:** `energy-token/src/lib.rs:87, 202`

```text
decimals = 9
```

**Source code:**

```rust
// Mint initialization:
mint::decimals = 9,

// Transfer:
token_interface::transfer_checked(cpi_ctx, amount, 9)?;
```

**Technical details:**

- GRID tokens use **9 decimal places** (matching SOL/lamports convention).
- 1 GRX = 1,000,000,000 base units.
- `transfer_checked` explicitly specifies decimals for on-chain verification.
- All amounts in the system are expressed in base units (not human-readable).

---

### 5.2 Total Supply Sync

**File:** `energy-token/src/lib.rs:297-317`

```text
token_info.total_supply ← mint.supply
```

**Source code:**

```rust
let canonical_supply = ctx.accounts.mint.supply;
token_info.total_supply = canonical_supply;
```

**Technical details:**

- Rather than updating `total_supply` on every mint/burn (which would cause **write-lock contention** on `token_info`), the supply is read directly from the **SPL Mint account's canonical `supply` field**.
- Called periodically by an admin via `sync_total_supply`.
- The SPL Mint's `supply` is the **authoritative source** — `token_info.total_supply` is a cached mirror for query convenience.
- This design enables high-frequency minting (`mint_tokens_direct`) without serializing through a single account.

---

## Summary Table

| # | Equation | Program | Category | File |
|---|----------|---------|----------|------|
| 1.1 | Order remaining amount | Trading | Order matching | `lib.rs:307-309` |
| 1.2 | CDA trade value | Trading | Price discovery | `lib.rs:311-312` |
| 1.3 | Sharded trade value | Trading | Sharded execution | `sharded_match_orders.rs:73` |
| 1.4 | Order expiry (24h TTL) | Trading | Order lifecycle | `lib.rs:212,266` |
| 1.5 | Batch timeout | Trading | Batch processing | `lib.rs:438` |
| 1.6 | Batch volume accumulation | Trading | Batch processing | `lib.rs:462,501-503` |
| 1.7 | Market fee (BPS) | Trading | Fee calculation | `lib.rs:1039-1043,1107-1110` |
| 1.8 | Net seller amount | Trading | Settlement | `lib.rs:1106-1114` |
| 1.9 | Offchain fee & net | Trading | Off-chain settlement | `settle_offchain.rs:251-253` |
| 1.10 | Batch offchain per-pair | Trading | Batch off-chain | `settle_offchain.rs:363-365` |
| 1.11 | VWAP (24h rolling) | Trading | Price discovery | `lib.rs:798-811` |
| 1.12 | Ring-buffer advance | Trading | Data structure | `lib.rs:792` |
| 1.13 | Supply curve | Trading | Auction clearing | `lib.rs:893-901` |
| 1.14 | Demand curve | Trading | Auction clearing | `lib.rs:905-913` |
| 1.15 | Clearing price discovery | Trading | Auction clearing | `lib.rs:1576-1599` |
| 1.16 | Auction match generation | Trading | Auction clearing | `lib.rs:952-981` |
| 1.17 | Nullifier remaining | Trading | Off-chain settlement | `settle_offchain.rs:246-248` |
| 1.18 | Zone capacity check | Trading | Grid constraint | `settle_offchain.rs:241-243` |
| 1.19 | Shard ID assignment | Trading | Sharding | `market.rs:144-147` |
| 2.1 | Production/consumption ratio | Oracle | Anomaly detection | `lib.rs:493-508` |
| 2.2 | Quality score | Oracle | Data quality | `lib.rs:439-447` |
| 2.3 | Weighted moving average | Oracle | Smoothing | `lib.rs:551-563` |
| 2.4 | Rate limiting | Oracle | Anti-spam | `lib.rs:119-121` |
| 2.5 | Cumulative energy tracking | Oracle | Meter state | `lib.rs:164-167` |
| 2.6 | Global aggregation | Oracle | Batch aggregation | `lib.rs:431-435` |
| 3.1 | Net generation → tokens | Registry | Tokenization | `lib.rs:470-477,614-619` |
| 3.2 | Airdrop (20 GRX) | Registry | User onboarding | `lib.rs:17` |
| 3.3 | Min validator stake (10K GRX) | Registry | Staking | `lib.rs:589` |
| 3.4 | Reading delta cap (1 TWh) | Registry | Sanity check | `lib.rs:363-364` |
| 3.5 | ERC double-counting prevention | Registry | REC integrity | `lib.rs:537-542` |
| 3.6 | Shard count aggregation | Registry | Distributed counting | `lib.rs:139-161` |
| 4.1 | Voting weight | Governance | DAO | `dao.rs:78-91` |
| 4.2 | Quorum + majority | Governance | DAO | `dao.rs:136-144` |
| 4.3 | Proposal expiry | Governance | DAO | `dao.rs:42` |
| 4.4 | Incentive multiplier (×1000) | Governance | Zone config | `zone_config.rs:7` |
| 4.5 | Loss factor (×1000) | Governance | Zone config | `zone_config.rs:10` |
| 4.6 | ERC max validity (2 years) | Governance | REC lifecycle | `poa_config.rs:129` |
| 4.7 | Unclaimed generation | Governance | REC issuance | `erc.rs:25-27` |
| 5.1 | Token decimals (9) | Energy Token | Token config | `lib.rs:87,202` |
| 5.2 | Supply sync | Energy Token | Supply tracking | `lib.rs:297-317` |

**Total: 40 equations** across 5 Anchor programs.
