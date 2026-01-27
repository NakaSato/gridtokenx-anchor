# GridTokenX Platform Algorithms

> **Technical Documentation**: Comprehensive guide to all algorithms used in the GridTokenX decentralized energy trading platform on Solana blockchain.

---

## Table of Contents

- [GridTokenX Platform Algorithms](#gridtokenx-platform-algorithms)
  - [Table of Contents](#table-of-contents)
  - [1. Trading Algorithms](#1-trading-algorithms)
    - [1.1 Market Price Clearing](#11-market-price-clearing)
    - [1.2 Order Matching Algorithm](#12-order-matching-algorithm)
    - [1.3 Volume-Weighted Average Price (VWAP)](#13-volume-weighted-average-price-vwap)
    - [1.4 Price Discovery Mechanism](#14-price-discovery-mechanism)
    - [1.5 AMM Bonding Curves](#15-amm-bonding-curves)
  - [2. Oracle Algorithms](#2-oracle-algorithms)
    - [2.1 Meter Reading Validation](#21-meter-reading-validation)
    - [2.2 Anomaly Detection](#22-anomaly-detection)
    - [2.3 Quality Scoring](#23-quality-scoring)
    - [2.4 Rate Limiting](#24-rate-limiting)
    - [2.5 Byzantine Fault Tolerance](#25-byzantine-fault-tolerance)
  - [3. Energy Token Algorithms](#3-energy-token-algorithms)
    - [3.1 Token Minting Calculation](#31-token-minting-calculation)
    - [3.2 Token Burning Mechanism](#32-token-burning-mechanism)
    - [3.3 PDA Authority Pattern](#33-pda-authority-pattern)
  - [4. Registry Algorithms](#4-registry-algorithms)
    - [4.1 Dual High-Water Mark System](#41-dual-high-water-mark-system)
    - [4.2 Settlement Calculation](#42-settlement-calculation)
    - [4.3 Temporal Monotonicity Enforcement](#43-temporal-monotonicity-enforcement)
  - [5. Governance Algorithms](#5-governance-algorithms)
    - [5.1 ERC Certificate Lifecycle](#51-erc-certificate-lifecycle)
    - [5.2 Double-Claim Prevention](#52-double-claim-prevention)
    - [5.3 Multi-Signature Authority Transfer](#53-multi-signature-authority-transfer)
  - [6. Benchmark Algorithms](#6-benchmark-algorithms)
    - [6.1 YCSB Workload Generation](#61-ycsb-workload-generation)
    - [6.2 TPC-C Transaction Mix](#62-tpc-c-transaction-mix)
    - [6.3 Concurrency Bottleneck Analysis](#63-concurrency-bottleneck-analysis)
  - [7. Performance Optimizations](#7-performance-optimizations)
    - [7.1 Compute Unit (CU) Optimization](#71-compute-unit-cu-optimization)
    - [7.2 Zero-Copy Data Access](#72-zero-copy-data-access)
  - [Appendix A: Algorithm Complexity Analysis](#appendix-a-algorithm-complexity-analysis)
  - [Appendix B: Security Considerations](#appendix-b-security-considerations)
  - [Appendix C: Future Algorithm Enhancements](#appendix-c-future-algorithm-enhancements)
  - [References](#references)

---

## 1. Trading Algorithms

### 1.1 Market Price Clearing

**Purpose:** Determine fair equilibrium price for energy trading based on supply and demand.

**Algorithm:** Hybrid Mid-Point + Volume-Weighted Average Price (VWAP)

```rust
fn calculate_volume_weighted_price(
    market: &Market,
    buy_price: u64,      // Buyer's bid price
    sell_price: u64,     // Seller's ask price
    volume: u64,         // Trade volume
) -> u64 {
    // Step 1: Calculate Mid-Point Price
    let base_price = (buy_price.saturating_add(sell_price)) / 2;
    
    // Step 2: Calculate Volume Weight (0-100%)
    if market.total_volume > 0 {
        let weight = volume
            .saturating_mul(1000)
            .checked_div(market.total_volume)
            .unwrap_or(1000)
            .min(1000);  // Cap at 100%
        
        // Step 3: Apply weighted adjustment
        let weighted_adjustment = base_price
            .saturating_mul(weight)
            .checked_div(10000)
            .unwrap_or(0);
        
        base_price.saturating_add(weighted_adjustment)
    } else {
        base_price  // First trade uses pure mid-point
    }
}
```

**Mathematical Formula:**

$$
\text{Clearing Price} = \begin{cases}
\frac{P_{buy} + P_{sell}}{2} & \text{if first trade} \\
\frac{P_{buy} + P_{sell}}{2} + \left(\frac{P_{buy} + P_{sell}}{2} \times \frac{V_{current}}{V_{total}} \times 0.1\right) & \text{otherwise}
\end{cases}
$$

**Example Calculation:**

```
Given:
- Buy Price: 5.50 THB/kWh
- Sell Price: 4.50 THB/kWh
- Current Volume: 100 kWh
- Total Market Volume: 10,000 kWh

Step 1: Mid-Point
base_price = (5.50 + 4.50) / 2 = 5.00 THB/kWh

Step 2: Volume Weight
weight = (100 × 1000) / 10,000 = 10 (1%)

Step 3: Adjustment
adjustment = (5.00 × 10) / 10,000 = 0.005 THB/kWh

Step 4: Final Price
clearing_price = 5.00 + 0.005 = 5.005 ≈ 5.00 THB/kWh
```

**Key Features:**
- ✅ **Fair Pricing**: Mid-point ensures fairness to both parties
- ✅ **Market Reflection**: VWAP adjustment reflects real trading volume
- ✅ **Integer Math**: No floating-point errors (blockchain-safe)
- ✅ **Overflow Protection**: Saturation math prevents panics

---

### 1.2 Order Matching Algorithm

**Purpose:** Match buy and sell orders efficiently using Price-Time Priority with Pro-Rata allocation.

**Algorithm:** Continuous Double Auction (CDA)

```rust
pub fn match_orders(
    ctx: Context<MatchOrders>, 
    match_amount: u64
) -> Result<()> {
    let mut market = ctx.accounts.market.load_mut()?;
    let mut buy_order = ctx.accounts.buy_order.load_mut()?;
    let mut sell_order = ctx.accounts.sell_order.load_mut()?;
    
    // Step 1: Validate Order Status
    require!(
        buy_order.status == OrderStatus::Active || 
        buy_order.status == OrderStatus::PartiallyFilled,
        ErrorCode::InactiveBuyOrder
    );
    
    // Step 2: Validate Price Compatibility (bid ≥ ask)
    require!(
        buy_order.price_per_kwh >= sell_order.price_per_kwh,
        ErrorCode::PriceMismatch
    );
    
    // Step 3: Calculate Actual Match Amount
    let buy_remaining = buy_order.amount - buy_order.filled_amount;
    let sell_remaining = sell_order.amount - sell_order.filled_amount;
    let actual_match_amount = match_amount
        .min(buy_remaining)
        .min(sell_remaining);
    
    // Step 4: Calculate Clearing Price
    let clearing_price = calculate_volume_weighted_price(
        &market,
        buy_order.price_per_kwh,
        sell_order.price_per_kwh,
        actual_match_amount,
    );
    
    // Step 5: Calculate Total Value and Fees
    let total_value = actual_match_amount * clearing_price;
    let fee_amount = (total_value * market.market_fee_bps as u64) / 10000;
    
    // Step 6: Update Order Fill Amounts
    buy_order.filled_amount += actual_match_amount;
    sell_order.filled_amount += actual_match_amount;
    
    // Step 7: Update Order Status
    if buy_order.filled_amount >= buy_order.amount {
        buy_order.status = OrderStatus::Completed as u8;
        market.active_orders = market.active_orders.saturating_sub(1);
    } else {
        buy_order.status = OrderStatus::PartiallyFilled as u8;
    }
    
    // Step 8: Update Market Statistics
    market.total_volume += actual_match_amount;
    market.total_trades += 1;
    market.last_clearing_price = clearing_price;
    
    // Step 9: Update Price History for VWAP tracking
    update_price_history(&mut market, clearing_price, actual_match_amount, timestamp)?;
    
    Ok(())
}
```

**Matching Priority:**
1. **Price Priority**: Best bid matched with best ask first
2. **Time Priority**: Earlier orders matched before later ones at same price
3. **Pro-Rata**: Partial fills allowed for large orders

**Example:**

```
Order Book at 14:00:00:
┌─────────────────────────────────────┐
│ BUY ORDERS (Demand)                 │
├─────────────────────────────────────┤
│ #1: 100 kWh @ 5.50 THB (14:00:00)  │
│ #2: 200 kWh @ 5.00 THB (14:00:05)  │
│ #3: 150 kWh @ 4.80 THB (14:00:10)  │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ SELL ORDERS (Supply)                │
├─────────────────────────────────────┤
│ #4: 180 kWh @ 4.50 THB (14:00:02)  │
│ #5: 120 kWh @ 5.00 THB (14:00:07)  │
│ #6: 80 kWh @ 5.20 THB  (14:00:12)  │
└─────────────────────────────────────┘

Matching Process:
1. Match #1 ⟷ #4: 100 kWh @ 5.00 THB (mid-point)
   - Buy #1: Completed
   - Sell #4: PartiallyFilled (80 kWh left)

2. Match #2 ⟷ #4: 80 kWh @ 4.75 THB
   - Sell #4: Completed
   - Buy #2: PartiallyFilled (120 kWh left)

3. Match #2 ⟷ #5: 120 kWh @ 5.00 THB (exact match)
   - Buy #2: Completed
   - Sell #5: Completed
```

---

### 1.3 Volume-Weighted Average Price (VWAP)

**Purpose:** Calculate historical average price weighted by trading volume to reflect true market value.

**Algorithm:** Incremental VWAP with Circular Buffer

```rust
fn update_price_history(
    market: &mut Market,
    price: u64,
    volume: u64,
    timestamp: i64,
) -> Result<()> {
    // Step 1: Lazy Update Strategy (CU Optimization)
    let should_update = 
        market.active_orders % 10 == 0 ||              // Every 10 orders
        market.price_history_count == 0 ||             // First trade
        (timestamp - last_timestamp > 60);             // > 60 seconds
    
    if !should_update {
        return Ok(());  // Skip to save compute units
    }
    
    // Step 2: Add Price Point (Circular Buffer - keep last 24)
    if market.price_history_count >= 24 {
        // Shift array left (discard oldest)
        for i in 0..23 {
            market.price_history[i] = market.price_history[i + 1];
        }
        market.price_history[23] = PricePoint { price, volume, timestamp };
    } else {
        let index = market.price_history_count as usize;
        market.price_history[index] = PricePoint { price, volume, timestamp };
        market.price_history_count += 1;
    }
    
    // Step 3: Recalculate VWAP
    let mut total_volume = 0u64;
    let mut weighted_sum = 0u128;  // Use u128 to prevent overflow
    
    for i in 0..market.price_history_count as usize {
        let point = &market.price_history[i];
        total_volume = total_volume.saturating_add(point.volume);
        weighted_sum = weighted_sum.saturating_add(
            (point.price as u128).saturating_mul(point.volume as u128)
        );
    }
    
    if total_volume > 0 {
        market.volume_weighted_price = (weighted_sum / total_volume as u128) as u64;
    }
    
    Ok(())
}
```

**Mathematical Formula:**

$$
\text{VWAP} = \frac{\sum_{i=1}^{n} (P_i \times V_i)}{\sum_{i=1}^{n} V_i}
$$

Where:
- $P_i$ = Price at trade $i$
- $V_i$ = Volume at trade $i$
- $n$ = Number of trades (max 24)

**Example:**

```
Price History:
Trade 1: 5.00 THB × 100 kWh = 500
Trade 2: 5.13 THB × 80 kWh  = 410.4
Trade 3: 5.33 THB × 120 kWh = 639.6

VWAP Calculation:
weighted_sum = 500 + 410.4 + 639.6 = 1,550
total_volume = 100 + 80 + 120 = 300 kWh

VWAP = 1,550 / 300 = 5.167 THB/kWh
```

---

### 1.4 Price Discovery Mechanism

**Purpose:** Dynamically discover fair market price through continuous order matching.

**Algorithm:** Hybrid Call Market + Continuous Trading

**Process Flow:**

```
1. Order Placement Phase (Continuous)
   ├─ Users submit buy/sell orders
   ├─ Orders stored in order book
   └─ No immediate matching

2. Market Clearing Trigger (Periodic)
   ├─ Oracle.trigger_market_clearing() every 15 minutes
   ├─ Or when threshold met (e.g., 50 pending orders)
   └─ Event emitted: MarketClearingTriggered

3. Matching Phase (Batch)
   ├─ Sort orders by price-time priority
   ├─ Match compatible orders
   ├─ Calculate clearing prices
   └─ Execute trades

4. Settlement Phase
   ├─ Transfer tokens
   ├─ Update order statuses
   ├─ Record trade history
   └─ Update market VWAP
```

**Key Features:**
- **Continuous Order Book**: Always accepting new orders
- **Periodic Clearing**: Reduces gas costs via batching
- **Fair Price Discovery**: All matched orders get same clearing price
- **MEV Resistance**: Batching prevents front-running

---

### 1.5 AMM Bonding Curves

**Purpose:** Provide instant liquidity for energy tokens using automated market maker curves tailored to energy source characteristics.

**Algorithm:** Source-Specific Bonding Curves

```rust
pub enum CurveType {
    LinearSolar,      // Constant rate during sunlight hours
    SteepWind,        // Variable rate based on wind patterns
    FlatBattery,      // Stable pricing for storage
}

fn calculate_amm_price(
    curve_type: CurveType,
    reserve_energy: u64,
    reserve_tokens: u64,
    trade_amount: u64,
) -> u64 {
    match curve_type {
        CurveType::LinearSolar => {
            // y = mx + b (linear pricing)
            let slope = reserve_tokens / reserve_energy;
            slope * trade_amount
        },
        CurveType::SteepWind => {
            // Constant product: x * y = k
            let k = reserve_energy * reserve_tokens;
            let new_energy = reserve_energy - trade_amount;
            let new_tokens = k / new_energy;
            new_tokens - reserve_tokens  // Token output
        },
        CurveType::FlatBattery => {
            // Stablecoin-like curve: y = x
            trade_amount  // 1:1 exchange
        }
    }
}
```

**Curve Characteristics:**

| Curve Type | Formula | Slippage | Use Case |
|------------|---------|----------|----------|
| **LinearSolar** | y = mx + b | Low | Solar production (predictable) |
| **SteepWind** | xy = k | High | Wind production (volatile) |
| **FlatBattery** | y = x | None | Battery storage (stable) |

**Example:**
```
Solar AMM Pool:
- Reserve: 10,000 kWh energy
- Reserve: 50,000 GRX tokens
- Curve: LinearSolar

Trade: Buy 100 kWh
Price = (50,000 / 10,000) × 100 = 500 GRX

Wind AMM Pool:
- Reserve: 5,000 kWh energy  
- Reserve: 25,000 GRX tokens
- k = 5,000 × 25,000 = 125,000,000

Trade: Buy 100 kWh
New energy = 5,000 - 100 = 4,900 kWh
New tokens = 125,000,000 / 4,900 = 25,510 GRX
Price = 25,510 - 25,000 = 510 GRX (2% premium for instant liquidity)
```

---

## 2. Oracle Algorithms

### 2.1 Meter Reading Validation

**Purpose:** Validate smart meter data before accepting into the system.

**Algorithm:** Multi-Layer Validation

```rust
fn validate_meter_reading(
    energy_produced: u64,
    energy_consumed: u64,
    oracle_data: &OracleData,
) -> Result<()> {
    // Layer 1: Range Validation
    require!(
        energy_produced >= oracle_data.min_energy_value && 
        energy_produced <= oracle_data.max_energy_value,
        ErrorCode::EnergyValueOutOfRange
    );
    
    require!(
        energy_consumed >= oracle_data.min_energy_value && 
        energy_consumed <= oracle_data.max_energy_value,
        ErrorCode::EnergyValueOutOfRange
    );
    
    // Layer 2: Anomaly Detection
    if oracle_data.anomaly_detection_enabled == 1 {
        let ratio = if energy_consumed > 0 {
            (energy_produced as f64 / energy_consumed as f64) * 100.0
        } else {
            0.0
        };
        
        // Allow production up to 10x consumption (for solar producers)
        require!(ratio <= 1000.0, ErrorCode::AnomalousReading);
    }
    
    Ok(())
}
```

**Validation Layers:**

1. **Range Check**
   - Min: 0 kWh
   - Max: 1,000,000 kWh (configurable)

2. **Ratio Check**
   - Production/Consumption ≤ 10:1
   - Prevents impossible readings

3. **Timestamp Check** (in submit_meter_reading)
   - No backdated readings
   - No future readings (>1 minute ahead)

---

### 2.2 Anomaly Detection

**Purpose:** Detect and reject abnormal meter readings that may indicate fraud or sensor malfunction.

**Algorithm:** Statistical Outlier Detection

```rust
// In submit_meter_reading function
pub fn submit_meter_reading(
    ctx: Context<SubmitMeterReading>,
    meter_id: String,
    energy_produced: u64,
    energy_consumed: u64,
    reading_timestamp: i64,
) -> Result<()> {
    let mut oracle_data = ctx.accounts.oracle_data.load_mut()?;
    
    // Timestamp Validation
    require!(
        reading_timestamp > oracle_data.last_reading_timestamp,
        ErrorCode::OutdatedReading
    );
    
    let current_time = Clock::get()?.unix_timestamp;
    require!(
        reading_timestamp <= current_time + 60,
        ErrorCode::FutureReading
    );
    
    // Rate Limiting Check
    if oracle_data.last_reading_timestamp > 0 {
        let time_since_last = reading_timestamp - oracle_data.last_reading_timestamp;
        require!(
            time_since_last >= oracle_data.min_reading_interval as i64,
            ErrorCode::RateLimitExceeded
        );
    }
    
    // Anomaly Detection (future enhancement)
    if oracle_data.last_energy_produced > 0 {
        let deviation = calculate_deviation(
            energy_produced,
            oracle_data.last_energy_produced,
            oracle_data.max_reading_deviation_percent,
        );
        
        require!(deviation <= 100, ErrorCode::ExcessiveDeviation);
    }
    
    // ... rest of the function
}

fn calculate_deviation(
    current: u64,
    previous: u64,
    max_percent: u16,
) -> u16 {
    if previous == 0 { return 0; }
    
    let diff = if current > previous {
        current - previous
    } else {
        previous - current
    };
    
    ((diff * 100) / previous) as u16
}
```

**Anomaly Detection Rules:**

| Check Type                   | Threshold              | Action |
| ---------------------------- | ---------------------- | ------ |
| Timestamp                    | Must be > last reading | Reject |
| Future Reading               | ≤ current time + 60s   | Reject |
| Rate Limit                   | ≥ 60 seconds interval  | Reject |
| Production/Consumption Ratio | ≤ 10:1                 | Reject |
| Deviation from Last Reading  | ≤ 50% default          | Reject |

---

### 2.3 Quality Scoring

**Purpose:** Track oracle data quality through success rate metrics.

**Algorithm:** Real-time Success Rate Calculation

```rust
fn update_quality_score(
    oracle_data: &mut OracleData, 
    is_valid: bool
) -> Result<()> {
    let total_readings = oracle_data.total_valid_readings + 
                        oracle_data.total_rejected_readings;
    
    if total_readings > 0 {
        let success_rate = (oracle_data.total_valid_readings as f64 / 
                           total_readings as f64) * 100.0;
        
        oracle_data.last_quality_score = success_rate as u8;  // 0-100
        oracle_data.quality_score_updated_at = Clock::get()?.unix_timestamp;
    }
    
    Ok(())
}
```

**Quality Score Formula:**

$$
\text{Quality Score} = \frac{\text{Valid Readings}}{\text{Total Readings}} \times 100
$$

**Score Interpretation:**
- 95-100: Excellent
- 85-94: Good
- 70-84: Fair
- <70: Poor (requires investigation)

---

### 2.4 Rate Limiting

**Purpose:** Prevent spam attacks and ensure realistic reading intervals.

**Algorithm:** Time-based Rate Limiting with Moving Average

```rust
// In OracleData struct
pub min_reading_interval: u64,        // Minimum seconds between readings (60s default)
pub average_reading_interval: u32,    // Moving average of actual intervals

// Rate limiting check
if oracle_data.last_reading_timestamp > 0 {
    let time_since_last = reading_timestamp - oracle_data.last_reading_timestamp;
    
    require!(
        time_since_last >= oracle_data.min_reading_interval as i64,
        ErrorCode::RateLimitExceeded
    );
    
    // Update moving average (80% old + 20% new)
    update_reading_interval(&mut oracle_data, time_since_last as u32)?;
}

fn update_reading_interval(
    oracle_data: &mut OracleData, 
    new_interval: u32
) -> Result<()> {
    if oracle_data.average_reading_interval > 0 {
        let old_weight = (oracle_data.average_reading_interval as f64 * 0.8) as u32;
        let new_weight = (new_interval as f64 * 0.2) as u32;
        oracle_data.average_reading_interval = old_weight + new_weight;
    } else {
        oracle_data.average_reading_interval = new_interval;
    }
    Ok(())
}
```

**Rate Limit Tiers:**

| Tier      | Min Interval  | Use Case        |
| --------- | ------------- | --------------- |
| Real-time | 60s           | Smart meters    |
| Standard  | 300s (5 min)  | Normal meters   |
| Bulk      | 900s (15 min) | Batch reporting |

---

### 2.5 Byzantine Fault Tolerance

**Purpose:** Achieve consensus among multiple oracle nodes to prevent single point of failure and detect malicious data.

**Algorithm:** Median-Based Consensus with Threshold

```rust
pub fn submit_meter_reading_consensus(
    ctx: Context<SubmitMeterReadingConsensus>,
    readings: Vec<OracleReading>,  // From multiple backup oracles
) -> Result<()> {
    let oracle_data = ctx.accounts.oracle_data.load()?;
    
    // Step 1: Verify minimum consensus threshold
    require!(
        readings.len() >= oracle_data.consensus_threshold as usize,
        ErrorCode::InsufficientConsensus
    );
    
    // Step 2: Verify all oracles are authorized
    for reading in &readings {
        require!(
            is_backup_oracle(&oracle_data, reading.oracle_pubkey),
            ErrorCode::UnauthorizedOracle
        );
    }
    
    // Step 3: Calculate median values (Byzantine-resistant)
    let median_produced = calculate_median(
        readings.iter().map(|r| r.energy_produced).collect()
    );
    let median_consumed = calculate_median(
        readings.iter().map(|r| r.energy_consumed).collect()
    );
    
    // Step 4: Accept median as ground truth
    process_validated_reading(
        median_produced,
        median_consumed,
        Clock::get()?.unix_timestamp
    )?;
    
    Ok(())
}

fn calculate_median(mut values: Vec<u64>) -> u64 {
    values.sort();
    let mid = values.len() / 2;
    
    if values.len() % 2 == 0 {
        (values[mid - 1] + values[mid]) / 2
    } else {
        values[mid]
    }
}
```

**BFT Configuration:**

| Total Oracles (n) | Threshold | Max Faulty Nodes (f) | Fault Tolerance |
|-------------------|-----------|----------------------|-----------------|
| 3 | 2 | 1 | 33% |
| 10 | 7 | 3 | 30% |
| 15 | 11 | 4 | 27% |

**BFT Formula:**
```
f = max faulty nodes
n = total nodes  
threshold = n - f

Byzantine tolerance: f < (n / 3)
```

**Example Consensus:**
```
Meter Reading Submissions:
Oracle 1: 100 kWh produced
Oracle 2: 102 kWh produced  
Oracle 3: 98 kWh produced
Oracle 4: 250 kWh produced (malicious/faulty)

Sorted: [98, 100, 102, 250]
Median: (100 + 102) / 2 = 101 kWh

Accepted value: 101 kWh (outlier 250 kWh rejected)
```

---

## 3. Energy Token Algorithms

### 3.1 Token Minting Calculation

**Purpose:** Mint GRX tokens proportional to energy produced, validated by oracle data.

**Algorithm:** Direct Energy-to-Token Conversion

```rust
pub fn mint_tokens_direct(
    ctx: Context<MintTokensDirect>, 
    amount: u64  // Amount in smallest unit (lamports)
) -> Result<()> {
    let token_info = &ctx.accounts.token_info;
    
    // Authorization Check
    let is_admin = ctx.accounts.authority.key() == token_info.authority;
    require!(is_admin, ErrorCode::UnauthorizedAuthority);
    
    // Mint tokens using PDA authority
    let seeds = &[b"token_info_2022".as_ref(), &[ctx.bumps.token_info]];
    let signer_seeds = &[&seeds[..]];
    
    let cpi_accounts = MintToInterface {
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.user_token_account.to_account_info(),
        authority: ctx.accounts.token_info.to_account_info(),
    };
    
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
        signer_seeds
    );
    
    token_interface::mint_to(cpi_ctx, amount)?;
    
    // Update total supply
    let token_info = &mut ctx.accounts.token_info;
    token_info.total_supply = token_info.total_supply.saturating_add(amount);
    
    emit!(GridTokensMinted {
        meter_owner: ctx.accounts.user_token_account.key(),
        amount,
        timestamp: Clock::get()?.unix_timestamp,
    });
    
    Ok(())
}
```

**Conversion Formula:**

$$
\text{Tokens to Mint} = \text{Energy Produced (Wh)} \times 10^9
$$

Where:
- Energy is measured in Watt-hours (Wh)
- Tokens have 9 decimal places (like SOL)
- 1 kWh = 1,000 Wh = 1,000,000,000,000 tokens (1,000 GRX)

**Example:**

```
Solar panel produces 10 kWh:
10 kWh = 10,000 Wh
Tokens = 10,000 × 10^9 = 10,000,000,000,000 lamports
       = 10,000 GRX tokens
```

---

### 3.2 Token Burning Mechanism

**Purpose:** Burn tokens when energy is consumed, maintaining supply-demand balance.

**Algorithm:** Token Burning with Supply Tracking

```rust
pub fn burn_tokens(
    ctx: Context<BurnTokens>, 
    amount: u64
) -> Result<()> {
    let cpi_accounts = BurnInterface {
        mint: ctx.accounts.mint.to_account_info(),
        from: ctx.accounts.token_account.to_account_info(),
        authority: ctx.accounts.authority.to_account_info(),
    };
    
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts
    );
    
    token_interface::burn(cpi_ctx, amount)?;
    
    // Update total supply
    let token_info = &mut ctx.accounts.token_info;
    token_info.total_supply = token_info.total_supply.saturating_sub(amount);
    
    Ok(())
}
```

**Burn Scenarios:**
1. Energy Consumption: User consumes energy from grid
2. Trading Settlement: Buyer receives energy, seller's tokens burned
3. Fee Collection: Platform fees burned to reduce supply

---

### 3.3 PDA Authority Pattern

**Purpose:** Programmable mint authority using Program Derived Address to enforce on-chain minting rules.

**Algorithm:** PDA-Controlled Minting

```rust
// Derive PDA mint authority
let (token_info_pda, bump) = Pubkey::find_program_address(
    &[b"token_info_2022"],
    &energy_token::ID
);

// Initialize mint with PDA authority
pub fn initialize_token(
    ctx: Context<InitializeToken>,
    registry_program_id: Pubkey,
) -> Result<()> {
    // Step 1: Initialize TokenInfo PDA
    let mut token_info = ctx.accounts.token_info.load_init()?;
    token_info.authority = ctx.accounts.authority.key();
    token_info.registry_program = registry_program_id;
    token_info.mint = ctx.accounts.mint.key();
    
    // Step 2: Mint initialized with PDA as authority
    // No keypair can mint outside program logic
    // Mint authority = token_info PDA
    
    Ok(())
}

// Mint using PDA signature
pub fn mint_tokens_direct(
    ctx: Context<MintTokensDirect>,
    amount: u64
) -> Result<()> {
    // Verify authorization
    let token_info = ctx.accounts.token_info.load()?;
    require!(
        ctx.accounts.authority.key() == token_info.authority,
        ErrorCode::UnauthorizedAuthority
    );
    
    // Generate PDA signature
    let seeds = &[b"token_info_2022".as_ref(), &[ctx.bumps.token_info]];
    let signer_seeds = &[&seeds[..]];
    
    // CPI to Token program with PDA signer
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        MintTo {
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.token_info.to_account_info(),
        },
        signer_seeds
    );
    
    token_interface::mint_to(cpi_ctx, amount)?;
    
    Ok(())
}
```

**Security Properties:**
1. **No Private Key Exposure:** PDA has no corresponding private key
2. **Program-Enforced Rules:** Only program logic can generate valid signatures
3. **Immutable Authority:** Cannot be changed after initialization (by design)
4. **Transparent Minting:** All mints recorded on-chain with events

---

## 4. Registry Algorithms

### 4.1 Dual High-Water Mark System

**Purpose:** Track cumulative energy production with separate counters for token settlement and REC certificate claims.

**Algorithm:** Monotonic Counter Advancement

```rust
pub struct MeterAccount {
    pub total_generation: u64,           // Lifetime production
    pub settled_net_generation: u64,     // High-water mark for token minting
    pub claimed_erc_generation: u64,     // High-water mark for REC certificates
    // ... other fields
}

pub fn settle_energy(
    ctx: Context<SettleEnergy>,
    new_generation: u64,
) -> Result<()> {
    let mut meter = ctx.accounts.meter_account.load_mut()?;
    
    // Step 1: Update total generation
    meter.total_generation = meter.total_generation.saturating_add(new_generation);
    
    // Step 2: Calculate unsettled amount
    let unsettled = meter.total_generation - meter.settled_net_generation;
    
    // Step 3: Advance high-water mark
    meter.settled_net_generation = meter.total_generation;
    
    // Step 4: Mint tokens for unsettled amount
    mint_grx_tokens(unsettled)?;
    
    emit!(EnergySettled {
        meter_id: meter.meter_id,
        amount: unsettled,
        new_high_water_mark: meter.settled_net_generation,
    });
    
    Ok(())
}
```

**High-Water Mark Invariants:**
```
INVARIANT 1: settled_net_generation ≤ total_generation
INVARIANT 2: claimed_erc_generation ≤ total_generation
INVARIANT 3: settled_net_generation and claimed_erc_generation are monotonically increasing
INVARIANT 4: settled_net_generation + claimed_erc_generation ≤ 2 × total_generation
```

**Example:**
```
Initial state:
- total_generation: 1000 kWh
- settled_net_generation: 800 kWh
- claimed_erc_generation: 700 kWh

New reading: +200 kWh

Step 1: total_generation = 1000 + 200 = 1200 kWh
Step 2: unsettled = 1200 - 800 = 400 kWh
Step 3: settled_net_generation = 1200 kWh
Step 4: Mint 400 GRX tokens

Final state:
- total_generation: 1200 kWh
- settled_net_generation: 1200 kWh (advanced)
- claimed_erc_generation: 700 kWh (unchanged - independent counter)
```

---

### 4.2 Settlement Calculation

**Purpose:** Calculate net energy balance for token issuance.

**Algorithm:** Production - Consumption Delta

```rust
fn calculate_settlement_amount(
    meter: &MeterAccount,
    new_production: u64,
    new_consumption: u64,
) -> u64 {
    // Step 1: Update cumulative values
    let total_produced = meter.total_generation.saturating_add(new_production);
    let total_consumed = meter.total_consumption.saturating_add(new_consumption);
    
    // Step 2: Calculate net production
    let net_production = if total_produced > total_consumed {
        total_produced - total_consumed
    } else {
        0  // Consumer, no tokens minted
    };
    
    // Step 3: Subtract already settled amount
    let unsettled = net_production.saturating_sub(meter.settled_net_generation);
    
    unsettled
}
```

**Settlement Matrix:**

| Scenario | Production | Consumption | Net | Tokens Minted |
|----------|------------|-------------|-----|---------------|
| **Producer** | 1000 kWh | 200 kWh | +800 kWh | 800 GRX |
| **Consumer** | 100 kWh | 500 kWh | -400 kWh | 0 GRX |
| **Prosumer** | 800 kWh | 600 kWh | +200 kWh | 200 GRX |
| **Balanced** | 500 kWh | 500 kWh | 0 kWh | 0 GRX |

---

### 4.3 Temporal Monotonicity Enforcement

**Purpose:** Prevent replay attacks and ensure chronological ordering of meter readings.

**Algorithm:** Timestamp Validation with Tolerance

```rust
pub fn update_meter_reading(
    ctx: Context<UpdateMeterReading>,
    reading_timestamp: i64,
    energy_produced: u64,
) -> Result<()> {
    let mut meter = ctx.accounts.meter_account.load_mut()?;
    let current_time = Clock::get()?.unix_timestamp;
    
    // Validation 1: Prevent backdating
    require!(
        reading_timestamp > meter.last_reading_timestamp,
        ErrorCode::OutdatedReading
    );
    
    // Validation 2: Prevent future readings (with 60s clock skew tolerance)
    require!(
        reading_timestamp <= current_time + 60,
        ErrorCode::FutureReading
    );
    
    // Validation 3: Maximum gap detection (prevent stale data)
    let max_gap = 86400;  // 24 hours
    if meter.last_reading_timestamp > 0 {
        let gap = reading_timestamp - meter.last_reading_timestamp;
        require!(gap <= max_gap, ErrorCode::StaleReading);
    }
    
    // Update state
    meter.last_reading_timestamp = reading_timestamp;
    meter.total_generation = meter.total_generation.saturating_add(energy_produced);
    meter.reading_count += 1;
    
    Ok(())
}
```

**Timeline Example:**
```
T0 (09:00): Reading #1 - 100 kWh ✓ Accepted
T1 (09:05): Reading #2 - 120 kWh ✓ Accepted (5 min gap)
T2 (09:03): Reading #3 - 110 kWh ✗ Rejected (backdated, T2 < T1)
T3 (09:10): Reading #4 - 140 kWh ✓ Accepted
T4 (10:15): Reading #5 - 160 kWh ✗ Rejected (65 min gap > 60 min future tolerance)
```

---

## 5. Governance Algorithms

### 5.1 ERC Certificate Lifecycle

### 5.1 ERC Certificate Lifecycle

**Purpose:** Manage the full lifecycle of Renewable Energy Certificates from issuance to retirement.

**Algorithm:** State Machine with Validation Gates

```rust
pub enum ErcStatus {
    Pending = 0,      // Issued, awaiting validation
    Validated = 1,    // Approved for trading
    Transferred = 2,  // Ownership transferred
    Revoked = 3,      // Invalidated (fraud detected)
}

// State transition: Issue
pub fn issue_erc(
    ctx: Context<IssueErc>,
    certificate_id: String,
    energy_amount: u64,
    renewable_source: String,
) -> Result<()> {
    let mut erc_cert = ctx.accounts.erc_certificate.load_init()?;
    
    // Initialize certificate
    erc_cert.certificate_id = certificate_id;
    erc_cert.owner = ctx.accounts.owner.key();
    erc_cert.energy_amount = energy_amount;
    erc_cert.renewable_source = renewable_source;
    erc_cert.status = ErcStatus::Pending as u8;
    erc_cert.issued_at = Clock::get()?.unix_timestamp;
    erc_cert.expiry_date = erc_cert.issued_at + (365 * 86400);  // 1 year validity
    
    emit!(ErcIssued {
        certificate_id: erc_cert.certificate_id.clone(),
        owner: erc_cert.owner,
        amount: energy_amount,
    });
    
    Ok(())
}

// State transition: Validate
pub fn validate_erc(
    ctx: Context<ValidateErc>,
    validation_data: String,
) -> Result<()> {
    let mut erc_cert = ctx.accounts.erc_certificate.load_mut()?;
    
    // Check current status
    require!(
        erc_cert.status == ErcStatus::Pending as u8,
        ErrorCode::InvalidErcStatus
    );
    
    // Perform validation (off-chain verification)
    // validation_data contains cryptographic proof of renewable source
    
    // Update status
    erc_cert.status = ErcStatus::Validated as u8;
    erc_cert.validated_at = Clock::get()?.unix_timestamp;
    erc_cert.validation_data = validation_data;
    
    emit!(ErcValidated {
        certificate_id: erc_cert.certificate_id.clone(),
        validator: ctx.accounts.validator.key(),
    });
    
    Ok(())
}

// State transition: Transfer
pub fn transfer_erc(
    ctx: Context<TransferErc>,
    new_owner: Pubkey,
) -> Result<()> {
    let mut erc_cert = ctx.accounts.erc_certificate.load_mut()?;
    
    // Validation checks
    require!(
        erc_cert.status == ErcStatus::Validated as u8,
        ErrorCode::InvalidErcStatus
    );
    require!(
        ctx.accounts.current_owner.key() == erc_cert.owner,
        ErrorCode::UnauthorizedOwner
    );
    
    // Transfer ownership
    let old_owner = erc_cert.owner;
    erc_cert.owner = new_owner;
    erc_cert.status = ErcStatus::Transferred as u8;
    
    emit!(ErcTransferred {
        certificate_id: erc_cert.certificate_id.clone(),
        from: old_owner,
        to: new_owner,
    });
    
    Ok(())
}
```

**State Transition Diagram:**
```
         issue_erc()
              │
              ▼
        ┌─────────┐
        │ Pending │◄──────┐
        └─────────┘       │
              │           │ revoke_erc()
   validate_erc()         │
              │           │
              ▼           │
        ┌───────────┐     │
        │ Validated │─────┤
        └───────────┘     │
              │           │
   transfer_erc()         │
              │           │
              ▼           │
        ┌─────────────┐   │
        │ Transferred │───┘
        └─────────────┘
              │
              ▼
         ┌─────────┐
         │ Revoked │ (terminal state)
         └─────────┘
```

---

### 5.2 Double-Claim Prevention

**Purpose:** Ensure energy cannot be claimed for both tokens AND certificates (prevents double-spending of environmental attributes).

**Algorithm:** Cross-Program High-Water Mark Verification

```rust
pub fn issue_erc_with_verification(
    ctx: Context<IssueErcWithVerification>,
    energy_amount: u64,
) -> Result<()> {
    // Step 1: Load meter account from Registry (CPI)
    let meter = ctx.accounts.meter_account.load()?;
    
    // Step 2: Calculate available unclaimed generation
    let total_generation = meter.total_generation;
    let already_claimed = meter.claimed_erc_generation;
    let available = total_generation.saturating_sub(already_claimed);
    
    // Step 3: Verify sufficient unclaimed energy
    require!(
        energy_amount <= available,
        ErrorCode::InsufficientUnclaimedEnergy
    );
    
    // Step 4: Issue certificate
    let mut erc_cert = ctx.accounts.erc_certificate.load_init()?;
    erc_cert.energy_amount = energy_amount;
    erc_cert.status = ErcStatus::Pending as u8;
    
    // Step 5: Update Registry high-water mark (via CPI)
    registry::cpi::update_claimed_erc_generation(
        CpiContext::new(
            ctx.accounts.registry_program.to_account_info(),
            registry::cpi::accounts::UpdateClaimedGeneration {
                meter_account: ctx.accounts.meter_account.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
            }
        ),
        energy_amount,
    )?;
    
    Ok(())
}
```

**Invariant Enforcement:**
```
Let:
- T = total_generation (from meter)
- S = settled_net_generation (for tokens)
- C = claimed_erc_generation (for certificates)

INVARIANT: S + C ≤ 2T

Rationale:
- User can mint tokens for all production: S ≤ T
- User can claim certificates for all production: C ≤ T
- But each kWh counted only ONCE per purpose
```

**Example:**
```
Meter Reading:
- total_generation: 1000 kWh
- settled_net_generation: 600 kWh (600 GRX already minted)
- claimed_erc_generation: 200 kWh (200 kWh certificates issued)

Attempt 1: Issue certificate for 300 kWh
Available = 1000 - 200 = 800 kWh
300 ≤ 800 ✓ APPROVED
New claimed_erc_generation = 500 kWh

Attempt 2: Issue certificate for 600 kWh
Available = 1000 - 500 = 500 kWh
600 > 500 ✗ REJECTED (InsufficientUnclaimedEnergy)
```

---

### 5.3 Multi-Signature Authority Transfer

**Purpose:** Securely transfer governance authority using two-step commit-reveal pattern.

**Algorithm:** Time-Locked Transfer with Cancellation

```rust
pub struct AuthorityTransfer {
    pub current_authority: Pubkey,
    pub pending_authority: Pubkey,
    pub initiated_at: i64,
    pub expiry: i64,             // 48-hour window
    pub status: TransferStatus,
}

pub enum TransferStatus {
    None = 0,
    Pending = 1,
    Completed = 2,
    Cancelled = 3,
}

// Step 1: Initiate transfer
pub fn initiate_authority_transfer(
    ctx: Context<InitiateTransfer>,
    new_authority: Pubkey,
) -> Result<()> {
    let poa_config = &mut ctx.accounts.poa_config;
    
    require!(
        ctx.accounts.current_authority.key() == poa_config.rec_authority,
        ErrorCode::UnauthorizedAuthority
    );
    
    let current_time = Clock::get()?.unix_timestamp;
    
    poa_config.authority_transfer = AuthorityTransfer {
        current_authority: poa_config.rec_authority,
        pending_authority: new_authority,
        initiated_at: current_time,
        expiry: current_time + (48 * 3600),  // 48 hours
        status: TransferStatus::Pending,
    };
    
    emit!(AuthorityTransferInitiated {
        from: poa_config.rec_authority,
        to: new_authority,
        expiry: poa_config.authority_transfer.expiry,
    });
    
    Ok(())
}

// Step 2: Accept transfer (by new authority)
pub fn accept_authority_transfer(
    ctx: Context<AcceptTransfer>,
) -> Result<()> {
    let poa_config = &mut ctx.accounts.poa_config;
    let transfer = &poa_config.authority_transfer;
    let current_time = Clock::get()?.unix_timestamp;
    
    // Validation 1: Transfer is pending
    require!(
        transfer.status == TransferStatus::Pending as u8,
        ErrorCode::NoActiveTransfer
    );
    
    // Validation 2: Called by pending authority
    require!(
        ctx.accounts.new_authority.key() == transfer.pending_authority,
        ErrorCode::UnauthorizedAuthority
    );
    
    // Validation 3: Not expired
    require!(
        current_time <= transfer.expiry,
        ErrorCode::TransferExpired
    );
    
    // Execute transfer
    poa_config.rec_authority = transfer.pending_authority;
    poa_config.authority_transfer.status = TransferStatus::Completed as u8;
    
    emit!(AuthorityTransferCompleted {
        old_authority: transfer.current_authority,
        new_authority: transfer.pending_authority,
    });
    
    Ok(())
}

// Step 3: Cancel transfer (emergency)
pub fn cancel_authority_transfer(
    ctx: Context<CancelTransfer>,
) -> Result<()> {
    let poa_config = &mut ctx.accounts.poa_config;
    
    require!(
        ctx.accounts.current_authority.key() == poa_config.rec_authority,
        ErrorCode::UnauthorizedAuthority
    );
    
    poa_config.authority_transfer.status = TransferStatus::Cancelled as u8;
    
    Ok(())
}
```

**Timeline Example:**
```
T0 (Monday 10:00): initiate_authority_transfer(new_authority: Bob)
                    Status: Pending
                    Expiry: Wednesday 10:00

T1 (Monday 14:00): accept_authority_transfer() by Bob
                    Status: Completed
                    Authority transferred

Alternate Timeline (Expiry):
T0 (Monday 10:00): initiate_authority_transfer(new_authority: Bob)
T1 (Wednesday 11:00): accept_authority_transfer() by Bob
                       ✗ REJECTED (TransferExpired)
                       Status: Pending (but unusable)
```

---

### 5.4 Proof of Authority (PoA)

**Purpose:** Centralized governance by trusted REC authority for certificate issuance.

```rust
#[account]
#[derive(InitSpace)]
pub struct PoaConfig {
    pub rec_authority: Pubkey,        // Renewable Energy Certificate authority
    pub emergency_paused: bool,       // Global pause switch
    pub total_erc_issued: u64,        // Statistics
    pub total_erc_revoked: u64,
    pub created_at: i64,
    pub last_updated: i64,
}

// Emergency pause (REC authority only)
pub fn emergency_pause(ctx: Context<EmergencyControl>) -> Result<()> {
    let poa_config = &mut ctx.accounts.poa_config;
    
    require!(
        ctx.accounts.rec_authority.key() == poa_config.rec_authority,
        ErrorCode::UnauthorizedRecAuthority
    );
    
    poa_config.emergency_paused = true;
    poa_config.last_updated = Clock::get()?.unix_timestamp;
    
    emit!(EmergencyPaused {
        authority: ctx.accounts.rec_authority.key(),
        timestamp: poa_config.last_updated,
    });
    
    Ok(())
}
```

**Authority Powers:**
- ✅ Issue ERC certificates
- ✅ Validate certificates
- ✅ Revoke fraudulent certificates
- ✅ Emergency pause system
- ✅ Update validation parameters

---

## 6. Benchmark Algorithms

### 6.1 YCSB Workload Generation

**Purpose:** Generate Yahoo! Cloud Serving Benchmark workloads to test blockchain performance under different access patterns.

**Algorithm:** Probabilistic Workload Mix

```rust
pub enum YcsbWorkload {
    WorkloadA,  // 50% Read, 50% Update
    WorkloadB,  // 95% Read, 5% Update
    WorkloadC,  // 100% Read
    WorkloadD,  // 95% Read, 5% Insert (latest)
    WorkloadE,  // 95% Scan, 5% Insert
    WorkloadF,  // 50% Read, 50% Read-Modify-Write
}

pub fn execute_ycsb_operation(
    ctx: Context<YcsbOperation>,
    workload: YcsbWorkload,
    key: String,
) -> Result<()> {
    let random = Clock::get()?.unix_timestamp % 100;
    
    match workload {
        YcsbWorkload::WorkloadA => {
            if random < 50 {
                read_operation(ctx, key)?;  // 50%
            } else {
                update_operation(ctx, key)?;  // 50%
            }
        },
        YcsbWorkload::WorkloadB => {
            if random < 95 {
                read_operation(ctx, key)?;  // 95%
            } else {
                update_operation(ctx, key)?;  // 5%
            }
        },
        YcsbWorkload::WorkloadC => {
            read_operation(ctx, key)?;  // 100%
        },
        // ... other workloads
    }
    
    Ok(())
}

fn read_operation(ctx: Context<YcsbOperation>, key: String) -> Result<()> {
    let kv_store = &ctx.accounts.kv_store;
    let value = kv_store.get(&key)?;
    
    emit!(YcsbRead { key, value });
    Ok(())
}

fn update_operation(ctx: Context<YcsbOperation>, key: String) -> Result<()> {
    let kv_store = &mut ctx.accounts.kv_store;
    let new_value = generate_random_value();
    kv_store.set(key.clone(), new_value.clone())?;
    
    emit!(YcsbUpdate { key, value: new_value });
    Ok(())
}
```

**Workload Characteristics:**

| Workload | Read% | Update% | Insert% | Scan% | Use Case |
|----------|-------|---------|---------|-------|----------|
| A | 50 | 50 | 0 | 0 | Update heavy (session store) |
| B | 95 | 5 | 0 | 0 | Read heavy (photo tagging) |
| C | 100 | 0 | 0 | 0 | Read only (user profile cache) |
| D | 95 | 0 | 5 | 0 | Read latest (status updates) |
| E | 5 | 0 | 5 | 95 | Range scan (threaded conversations) |
| F | 50 | 0 | 0 | 0 | Read-modify-write (user database) |

---

### 6.2 TPC-C Transaction Mix

**Purpose:** Execute TPC-C (Transaction Processing Performance Council - Benchmark C) transaction mix to measure OLTP performance.

**Algorithm:** Weighted Transaction Scheduling

```rust
pub struct TpcBenchmarkState {
    pub total_transactions: u64,
    pub new_order_count: u64,     // 45% of mix
    pub payment_count: u64,       // 43% of mix
    pub order_status_count: u64,  // 4% of mix
    pub delivery_count: u64,      // 4% of mix
    pub stock_level_count: u64,   // 4% of mix
}

pub fn execute_tpc_transaction(
    ctx: Context<TpcTransaction>,
) -> Result<()> {
    let state = &mut ctx.accounts.benchmark_state;
    let random = (Clock::get()?.unix_timestamp % 100) as u8;
    
    // Transaction mix based on TPC-C specification
    match random {
        0..=44 => {  // 45% - New-Order
            execute_new_order(ctx)?;
            state.new_order_count += 1;
        },
        45..=87 => {  // 43% - Payment
            execute_payment(ctx)?;
            state.payment_count += 1;
        },
        88..=91 => {  // 4% - Order-Status
            execute_order_status(ctx)?;
            state.order_status_count += 1;
        },
        92..=95 => {  // 4% - Delivery
            execute_delivery(ctx)?;
            state.delivery_count += 1;
        },
        96..=99 => {  // 4% - Stock-Level
            execute_stock_level(ctx)?;
            state.stock_level_count += 1;
        },
    }
    
    state.total_transactions += 1;
    Ok(())
}
```

**Transaction Mix Specification:**

| Transaction | Mix% | Accounts Accessed | Write Locks | Complexity |
|-------------|------|-------------------|-------------|------------|
| **New-Order** | 45% | 6-21 (variable) | 2-16 | HIGH |
| **Payment** | 43% | 4 | 3 | MEDIUM |
| **Order-Status** | 4% | 2-3 | 0 (read-only) | LOW |
| **Delivery** | 4% | 40 (10 districts) | 30 | HIGH |
| **Stock-Level** | 4% | 21-41 | 0 (read-only) | MEDIUM |

**Performance Metric: tpmC**
```
tpmC (transactions per minute - C) = New-Order transactions / minute

Example calculation:
Total transactions in 10 minutes: 10,000
New-Order count: 4,500 (45%)
tpmC = 4,500 / 10 = 450 tpmC
```

---

### 6.3 Concurrency Bottleneck Analysis

**Purpose:** Identify serialization points that limit parallel transaction execution.

**Algorithm:** Account Lock Contention Detection

```rust
pub struct ContentionProfile {
    pub account_address: Pubkey,
    pub access_count: u64,
    pub conflict_count: u64,
    pub contention_level: ContentionLevel,
}

pub enum ContentionLevel {
    None = 0,       // 0% conflicts
    Low = 1,        // <10% conflicts
    Moderate = 2,   // 10-30% conflicts
    High = 3,       // 30-50% conflicts
    Critical = 4,   // >50% conflicts
}

// TPC-C New-Order transaction analysis
pub fn analyze_new_order_contention() -> Vec<ContentionProfile> {
    vec![
        ContentionProfile {
            account_address: district_account,
            access_count: 4500,  // 45% of 10,000 transactions
            conflict_count: 4500,  // ALL serialize on District.next_o_id
            contention_level: ContentionLevel::Critical,
        },
        ContentionProfile {
            account_address: warehouse_account,
            access_count: 4500,
            conflict_count: 450,  // ~10% conflict (read w_tax)
            contention_level: ContentionLevel::Low,
        },
        ContentionProfile {
            account_address: stock_accounts[popular_item],
            access_count: 1200,  // Popular items
            conflict_count: 600,  // ~50% conflict
            contention_level: ContentionLevel::Critical,
        },
    ]
}

// Critical section identification
fn identify_critical_section(
    instruction: &str,
    accounts: &[AccountInfo],
) -> CriticalSection {
    match instruction {
        "new_order" => {
            CriticalSection {
                name: "District.next_o_id increment",
                account: accounts[1],  // District account
                operation: "read-modify-write",
                parallelism: "NONE (serializes per district)",
                mitigation: "Scale across 10 districts per warehouse",
            }
        },
        "payment" => {
            CriticalSection {
                name: "District.ytd update",
                account: accounts[1],  // District account
                operation: "accumulate",
                parallelism: "NONE",
                mitigation: "Eventual consistency with batch updates",
            }
        },
        _ => CriticalSection::default(),
    }
}
```

**Bottleneck Analysis Results:**

```
TPC-C Concurrency Profile:

┌─────────────────────────────────────────────────┐
│ Account: District                                │
│ Field: next_o_id                                 │
│ Contention: CRITICAL (100% serialization)        │
│ Impact: Limits parallelism to 10 txs/warehouse   │
│ Mitigation: Shard across warehouses              │
└─────────────────────────────────────────────────┘

Parallelism Calculation:
- 1 warehouse × 10 districts = max 10 concurrent New-Orders
- 10 warehouses × 10 districts = max 100 concurrent New-Orders
- 100 warehouses × 10 districts = max 1,000 concurrent New-Orders

Theoretical throughput:
- Single warehouse: ~200 tpmC (limited by District serialization)
- 10 warehouses: ~2,000 tpmC (10× parallelism)
- 100 warehouses: ~20,000 tpmC (100× parallelism)
```

---

## 7. Performance Optimizations

### 7.1 Compute Unit (CU) Optimization

**Purpose:** Minimize Solana transaction costs by reducing compute unit usage.

**Techniques:**

**Techniques:**

**1. Lazy Updates**
```rust
// Only update price history every 10 orders or 60 seconds
let should_update = 
    market.active_orders % 10 == 0 ||
    timestamp - last_timestamp > 60;

if !should_update {
    return Ok(());  // Skip expensive calculation
}
```

**2. Disable Logging**
```rust
// Logging disabled to save CU - use events instead
// msg!("Order created"); ❌ Expensive
emit!(OrderCreated { ... }); // ✅ Cheaper and indexed
```

**3. Saturation Math**
```rust
// Prevents overflow panics (which cost extra CU)
total_supply = total_supply.saturating_add(amount);
```

**4. Integer-Only Math**
```rust
// ❌ Floating point (expensive and non-deterministic)
let price = (buy_price as f64 + sell_price as f64) / 2.0;

// ✅ Integer math (fast and deterministic)
let price = (buy_price.saturating_add(sell_price)) / 2;
```

**CU Budget Estimates:**

| Operation            | CU Cost         | Optimization        |
| -------------------- | --------------- | ------------------- |
| Token Transfer       | ~5,000          | Use TransferChecked |
| Price Calculation    | ~2,000          | Integer math        |
| msg!() logging       | ~1,000 per call | Use events          |
| Account read         | ~200-500        | Use zero_copy       |
| Price history update | ~3,000          | Lazy updates        |

---

### 7.2 Zero-Copy Data Access

**Purpose:** Access account data directly from memory without deserialization overhead.

**Algorithm:** Direct Memory Access with Pod Trait

```rust
// ❌ Normal account (requires full deserialization)
#[account]
pub struct Market {
    pub authority: Pubkey,
    pub total_volume: u64,
    // ... many fields
}

// ✅ Zero-copy account (direct memory access)
#[account(zero_copy)]
#[repr(C)]
pub struct Market {
    pub authority: Pubkey,              // 32
    pub total_volume: u64,              // 8
    pub last_clearing_price: u64,       // 8
    // ... explicit alignment
    pub _padding: [u8; 4],              // Ensure 8-byte alignment
}

// Usage
let market = ctx.accounts.market.load()?;        // Read-only
let mut market = ctx.accounts.market.load_mut()?; // Mutable
```

**Memory Layout Requirements:**
- All fields must implement `bytemuck::Pod`
- Explicit padding for 8-byte alignment
- No dynamic types (String, Vec without size)
- `#[repr(C)]` for predictable layout

**Performance Gains:**

| Account Size | Normal Deserialize | Zero-Copy Load | Speedup |
| ------------ | ------------------ | -------------- | ------- |
| 1 KB         | ~10,000 CU         | ~500 CU        | 20x     |
| 10 KB        | ~100,000 CU        | ~500 CU        | 200x    |
| 100 KB       | ~1,000,000 CU      | ~500 CU        | 2000x   |

---

## Appendix A: Algorithm Complexity Analysis

**Trading Algorithms**

| Algorithm | Time Complexity | Space Complexity | Notes |
|-----------|-----------------|------------------|-------|
| calculate_volume_weighted_price | O(1) | O(1) | Integer arithmetic only |
| update_price_history | O(n) | O(1) | n = 24 (fixed circular buffer) |
| match_orders | O(1) | O(1) | Single order pair |
| Batch matching | O(n log n) | O(n) | n = batch size, sorting orders |
| AMM bonding curves | O(1) | O(1) | Constant product formula |

**Oracle Algorithms**

| Algorithm | Time Complexity | Space Complexity | Notes |
|-----------|-----------------|------------------|-------|
| validate_meter_reading | O(1) | O(1) | Fixed validation rules |
| update_quality_score | O(1) | O(1) | Simple division |
| update_reading_interval | O(1) | O(1) | Exponential moving average |
| calculate_median (BFT) | O(n log n) | O(n) | n = backup oracle count, sorting |

**Registry Algorithms**

| Algorithm | Time Complexity | Space Complexity | Notes |
|-----------|-----------------|------------------|-------|
| settle_energy | O(1) | O(1) | High-water mark update |
| calculate_settlement_amount | O(1) | O(1) | Subtraction operations |
| temporal_monotonicity_check | O(1) | O(1) | Timestamp comparison |

**Governance Algorithms**

| Algorithm | Time Complexity | Space Complexity | Notes |
|-----------|-----------------|------------------|-------|
| issue_erc | O(1) | O(1) | Account initialization |
| validate_erc | O(1) | O(1) | State transition |
| double_claim_prevention | O(1) | O(1) | Cross-program verification |
| authority_transfer | O(1) | O(1) | Time-locked state update |

**Benchmark Algorithms**

| Algorithm | Time Complexity | Space Complexity | Notes |
|-----------|-----------------|------------------|-------|
| execute_ycsb_operation | O(1) | O(1) | Random operation selection |
| execute_tpc_transaction | O(n) | O(1) | n = order lines (max 15) |
| contention_analysis | O(m) | O(m) | m = account count |

---

## Appendix B: Security Considerations

### Algorithm Security Features

1. **Integer Overflow Protection**
   - All math operations use `saturating_*` methods
   - Prevents panics and unexpected behavior

2. **Division by Zero Protection**
   - All divisions use `checked_div().unwrap_or(default)`
   - Safe fallback values

3. **Reentrancy Protection**
   - All state updates before external CPI calls
   - Follows checks-effects-interactions pattern

4. **Authority Validation**
   - Every privileged operation checks authority
   - Uses has_one constraints where possible

5. **Timestamp Validation**
   - Prevents backdating and future-dating
   - Rate limiting prevents spam

---

## Appendix C: Future Algorithm Enhancements

### Planned Improvements

1. **Machine Learning Anomaly Detection**
   - Train model on historical meter data
   - Detect subtle fraud patterns
   - Implementation: Off-chain ML → On-chain validation

2. **Dynamic Pricing Algorithm**
   - Time-of-use pricing
   - Demand response incentives
   - Peak/off-peak differential pricing

3. **Multi-Signature Certificate Validation**
   - Require consensus from multiple validators
   - Implement in oracle.backup_oracles
   - Byzantine fault tolerance

4. **Automated Market Maker (AMM)**
   - Liquidity pools for instant trading
   - Constant product formula adaptation
   - Reduce slippage for large orders

5. **Advanced Order Types**
   - Stop-loss orders
   - Limit orders with time-in-force
   - Iceberg orders for large trades

---

## References

1. **Solana Documentation**: https://docs.solana.com
2. **Anchor Framework**: https://www.anchor-lang.com
3. **Volume-Weighted Average Price**: https://en.wikipedia.org/wiki/Volume-weighted_average_price
4. **Continuous Double Auction**: Wurman, P. R., et al. "A Parameterization of the Auction Design Space"
5. **Proof of Authority**: https://en.wikipedia.org/wiki/Proof_of_authority

---

**Document Version:** 2.0  
**Last Updated:** January 25, 2026  
**Maintainer:** GridTokenX Development Team

**Related Documentation:**
- [Energy Token Program](./programs/energy-token.md)
- [Oracle Program](./programs/oracle.md)
- [Registry Program](./programs/registry.md)
- [Trading Program](./programs/trading.md)
- [Governance Program](./programs/governance.md)
- [Blockbench Program](./programs/blockbench.md)
- [TPC-Benchmark Program](./programs/tpc-benchmark.md)
