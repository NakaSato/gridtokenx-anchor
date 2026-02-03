# Dynamic Pricing Engine: Deep Dive

> **Time-of-Use, Supply/Demand, and Grid Congestion Pricing for Energy Markets**

---

## 1. Executive Summary

The GridTokenX Dynamic Pricing Engine implements **intelligent real-time price determination** that reflects the true cost and value of energy at any given moment. Unlike static pricing models, this engine considers:

- **Time-of-Use (TOU):** Peak, mid-peak, and off-peak periods
- **Supply/Demand Balance:** Real-time market conditions
- **Grid Congestion:** Network constraints affecting delivery
- **Seasonal Factors:** Climate-driven demand patterns
- **External Events:** Weather, maintenance, emergencies

**Key Innovation:** First on-chain implementation of multi-factor energy pricing for Solana-based energy trading.

---

## 2. Pricing Model Architecture

### 2.1 Multi-Factor Price Formula

The final price $P$ is computed as:

$$
P = P_{base} \times M_{TOU} \times M_{season} \times M_{SD} \times M_{congestion}
$$

Where:
- $P_{base}$ = Base price per kWh (configurable per market)
- $M_{TOU}$ = Time-of-Use multiplier (0.5 - 2.0)
- $M_{season}$ = Seasonal adjustment (0.8 - 1.2)
- $M_{SD}$ = Supply/Demand factor (0.7 - 1.5)
- $M_{congestion}$ = Grid congestion factor (1.0 - 1.5)

### 2.2 Price Bounds

To protect market participants, prices are bounded:

$$
P_{min} \leq P \leq P_{max}
$$

Typical configuration:
- $P_{min}$ = 2.00 THB/kWh (floor to prevent producer losses)
- $P_{max}$ = 10.00 THB/kWh (ceiling to protect consumers)

---

## 3. State Architecture

### 3.1 PricingConfig Account

```rust
#[account]
#[derive(Default)]
pub struct PricingConfig {
    pub bump: u8,                           // 1 - PDA bump
    pub market: Pubkey,                     // 32 - Parent market
    pub authority: Pubkey,                  // 32 - Update authority
    
    // Core pricing parameters
    pub enabled: bool,                      // 1 - Enable/disable dynamic pricing
    pub base_price: u64,                    // 8 - Base price (6 decimals, e.g., 4_000_000 = 4.00)
    pub min_price: u64,                     // 8 - Price floor
    pub max_price: u64,                     // 8 - Price ceiling
    
    // Time-of-Use configuration
    pub tou_tiers: [PriceTier; 6],          // 6 × 15 = 90 - Up to 6 price tiers
    pub tou_tier_count: u8,                 // 1 - Active tier count
    
    // Seasonal adjustments
    pub seasonal_multipliers: [u16; 4],     // 8 - Per-season multipliers (100 = 1.0x)
    
    // Market data (updated by oracle)
    pub current_supply: u64,                // 8 - Current energy supply (kWh)
    pub current_demand: u64,                // 8 - Current energy demand (kWh)
    pub supply_demand_sensitivity: u16,     // 2 - Price sensitivity (basis points)
    
    // Grid factors
    pub congestion_factor: u16,             // 2 - Congestion multiplier (100 = normal)
    
    // Metadata
    pub last_update: i64,                   // 8 - Last price update timestamp
    pub update_interval: u32,               // 4 - Minimum update interval (seconds)
    pub timezone_offset: i16,               // 2 - Timezone (hours × 100, e.g., +700 for UTC+7)
    
    pub _reserved: [u8; 32],                // 32 - Future use
}

// Total: 8 (discriminator) + 255 = 263 bytes (padded to 280)
```

### 3.2 PriceTier Structure

```rust
#[derive(Clone, Copy, Default, AnchorSerialize, AnchorDeserialize)]
pub struct PriceTier {
    pub base_price: u64,     // 8 - Override base price for this tier
    pub multiplier: u16,     // 2 - Multiplier (100 = 1.0x, 150 = 1.5x)
    pub start_hour: u8,      // 1 - Start hour (0-23)
    pub end_hour: u8,        // 1 - End hour (0-23, exclusive)
    pub period: u8,          // 1 - TimePeriod enum value
    pub _padding: [u8; 2],   // 2 - Alignment
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum TimePeriod {
    OffPeak = 0,     // Night hours (low demand)
    MidPeak = 1,     // Shoulder hours (moderate demand)
    OnPeak = 2,      // Peak hours (high demand)
    SuperPeak = 3,   // Critical peak (extreme demand events)
}
```

---

## 4. Time-of-Use (TOU) Pricing

### 4.1 Thailand Energy Market Pattern

Default TOU configuration aligned with Thailand's Provincial Electricity Authority (PEA):

```rust
fn create_default_thailand_tou() -> [PriceTier; 6] {
    [
        // Off-Peak: 22:00 - 09:00 (multiplier: 0.65x)
        PriceTier {
            multiplier: 65,
            start_hour: 22,
            end_hour: 9, // Wraps past midnight
            period: TimePeriod::OffPeak as u8,
            ..Default::default()
        },
        // Mid-Peak: 09:00 - 18:00 (multiplier: 1.0x)
        PriceTier {
            multiplier: 100,
            start_hour: 9,
            end_hour: 18,
            period: TimePeriod::MidPeak as u8,
            ..Default::default()
        },
        // On-Peak: 18:00 - 22:00 (multiplier: 1.5x)
        PriceTier {
            multiplier: 150,
            start_hour: 18,
            end_hour: 22,
            period: TimePeriod::OnPeak as u8,
            ..Default::default()
        },
        // Remaining slots unused
        PriceTier::default(),
        PriceTier::default(),
        PriceTier::default(),
    ]
}
```

### 4.2 TOU Multiplier Calculation

```rust
pub fn get_tou_multiplier(config: &PricingConfig, timestamp: i64) -> u16 {
    let hour = get_local_hour(timestamp, config.timezone_offset);
    
    for i in 0..config.tou_tier_count as usize {
        let tier = &config.tou_tiers[i];
        
        // Handle wrap-around (e.g., 22:00 - 09:00)
        let in_range = if tier.start_hour <= tier.end_hour {
            hour >= tier.start_hour && hour < tier.end_hour
        } else {
            hour >= tier.start_hour || hour < tier.end_hour
        };
        
        if in_range {
            return tier.multiplier;
        }
    }
    
    100 // Default: 1.0x multiplier
}

fn get_local_hour(timestamp: i64, timezone_offset: i16) -> u8 {
    // timezone_offset is hours × 100 (e.g., +700 for UTC+7)
    let offset_seconds = (timezone_offset as i64 * 36) as i64; // hours * 100 * 36 = seconds
    let local_timestamp = timestamp + offset_seconds;
    let hours_since_midnight = (local_timestamp % 86400) / 3600;
    hours_since_midnight as u8
}
```

### 4.3 Visual TOU Schedule

```
Price Multiplier (Thailand, UTC+7)
│
2.0x │                               ┌──────┐
     │                               │      │ Super Peak
1.5x │                          ┌────┤      │ (Event-Based)
     │                          │    │  On  │
1.0x │       ┌──────────────────┤ Mid│ Peak │
     │       │    Mid-Peak      │Peak│      │
0.65x│───────┤                  │    │      │
     │Off-Pk │                  │    │      │ Off-Peak
     └───────┴──────────────────┴────┴──────┴─────────► Hour
     0    6   9                 18   22     24

Legend:
■ Off-Peak (22:00-09:00):  0.65x - Overnight, low demand
■ Mid-Peak (09:00-18:00):  1.00x - Business hours
■ On-Peak (18:00-22:00):   1.50x - Evening peak
■ Super-Peak:              2.00x - Emergency events (manual trigger)
```

---

## 5. Seasonal Pricing

### 5.1 Season Detection

```rust
#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Season {
    Winter = 0,  // Nov - Feb (cool, lower AC demand)
    Spring = 1,  // Mar - May (hot, rising demand)
    Summer = 2,  // Jun - Aug (monsoon, moderate)
    Autumn = 3,  // Sep - Oct (transition)
}

fn get_current_season(timestamp: i64) -> Season {
    // Get month (1-12) from timestamp
    let days_since_epoch = timestamp / 86400;
    let month = ((days_since_epoch % 365) / 30 + 1).min(12) as u8;
    
    match month {
        11 | 12 | 1 | 2 => Season::Winter,
        3 | 4 | 5 => Season::Spring,      // Hot season in Thailand
        6 | 7 | 8 => Season::Summer,      // Monsoon
        _ => Season::Autumn,
    }
}
```

### 5.2 Thailand Seasonal Multipliers

```rust
fn create_default_thailand_seasons() -> [u16; 4] {
    [
        90,   // Winter: 0.9x (cooler, less AC)
        120,  // Spring: 1.2x (hot season, peak AC)
        100,  // Summer: 1.0x (monsoon, moderate)
        95,   // Autumn: 0.95x (transition)
    ]
}
```

---

## 6. Supply/Demand Pricing

### 6.1 Economic Model

The supply/demand multiplier reflects market equilibrium:

$$
M_{SD} = 1 + \alpha \times \frac{D - S}{D + S}
$$

Where:
- $D$ = Current demand
- $S$ = Current supply
- $\alpha$ = Sensitivity parameter (0 - 1)

**Behavior:**
- $D > S$ (shortage): Price increases
- $D < S$ (surplus): Price decreases
- $D = S$ (balanced): Price unchanged

### 6.2 Implementation

```rust
pub fn calculate_supply_demand_multiplier(
    supply: u64,
    demand: u64,
    sensitivity_bps: u16,  // Basis points (e.g., 500 = 5%)
) -> u16 {
    if supply == 0 && demand == 0 {
        return 100; // Default 1.0x
    }
    
    let total = supply.saturating_add(demand);
    
    // Calculate imbalance: (demand - supply) / total
    // Use signed arithmetic for direction
    let imbalance = if demand > supply {
        // Shortage: positive adjustment
        let delta = demand - supply;
        (delta as u128 * 10000 / total as u128) as i64
    } else {
        // Surplus: negative adjustment
        let delta = supply - demand;
        -((delta as u128 * 10000 / total as u128) as i64)
    };
    
    // Apply sensitivity
    // adjustment = imbalance * sensitivity / 10000
    let adjustment = imbalance * sensitivity_bps as i64 / 10000;
    
    // Clamp to reasonable bounds (70% - 150%)
    let multiplier = 100i64 + adjustment;
    multiplier.clamp(70, 150) as u16
}
```

### 6.3 Example Calculations

| Supply | Demand | Imbalance | Sensitivity | Multiplier |
|--------|--------|-----------|-------------|------------|
| 1000 | 1000 | 0% | 5% | 100 (1.0x) |
| 800 | 1200 | +20% | 5% | 110 (1.1x) |
| 1500 | 500 | -50% | 5% | 85 (0.85x) |
| 100 | 900 | +80% | 5% | 140 (1.4x) |
| 900 | 100 | -80% | 5% | 70 (0.7x, capped) |

---

## 7. Grid Congestion Pricing

### 7.1 Congestion Factor Model

Grid congestion increases delivery costs and reflects transmission constraints:

$$
M_{congestion} = \frac{\text{congestion\_factor}}{100}
$$

| Congestion Factor | Interpretation |
|-------------------|----------------|
| 100 | Normal operation |
| 110 | Light congestion (+10%) |
| 125 | Moderate congestion (+25%) |
| 150 | Heavy congestion (+50%, max) |

### 7.2 Integration with Oracle

```rust
pub fn process_update_market_data(
    ctx: Context<UpdateMarketData>,
    supply: u64,
    demand: u64,
    congestion_factor: u16,
) -> Result<()> {
    let config = &mut ctx.accounts.pricing_config;
    let clock = Clock::get()?;
    
    // Rate limiting: Only update if interval has passed
    require!(
        clock.unix_timestamp >= config.last_update + config.update_interval as i64,
        PricingError::UpdateTooFrequent
    );
    
    // Validate congestion factor bounds
    let clamped_congestion = congestion_factor.clamp(100, 150);
    
    // Calculate price before and after for event
    let old_price = calculate_price(config, clock.unix_timestamp);
    
    // Update state
    config.current_supply = supply;
    config.current_demand = demand;
    config.congestion_factor = clamped_congestion;
    config.last_update = clock.unix_timestamp;
    
    let new_price = calculate_price(config, clock.unix_timestamp);
    
    emit!(PriceUpdated {
        market: config.market,
        old_price,
        new_price,
        time_period: get_time_period(config, clock.unix_timestamp) as u8,
        supply,
        demand,
        congestion: clamped_congestion,
        timestamp: clock.unix_timestamp,
    });
    
    Ok(())
}
```

---

## 8. Final Price Calculation

### 8.1 Complete Algorithm

```rust
pub mod calculator {
    use super::*;
    
    pub fn calculate_price(config: &PricingConfig, timestamp: i64) -> u64 {
        if !config.enabled {
            return config.base_price;
        }
        
        // 1. Get TOU multiplier (100 = 1.0x)
        let tou_mult = get_tou_multiplier(config, timestamp);
        
        // 2. Get seasonal multiplier
        let season = get_current_season(timestamp);
        let season_mult = config.seasonal_multipliers[season as usize];
        
        // 3. Calculate supply/demand multiplier
        let sd_mult = calculate_supply_demand_multiplier(
            config.current_supply,
            config.current_demand,
            config.supply_demand_sensitivity,
        );
        
        // 4. Get congestion factor
        let congestion_mult = config.congestion_factor;
        
        // 5. Compute final price
        // price = base × (tou/100) × (season/100) × (sd/100) × (congestion/100)
        // To avoid precision loss, multiply first, then divide
        let price = (config.base_price as u128)
            .saturating_mul(tou_mult as u128)
            .saturating_mul(season_mult as u128)
            .saturating_mul(sd_mult as u128)
            .saturating_mul(congestion_mult as u128)
            / 100_000_000  // Divide by 100^4
            as u64;
        
        // 6. Clamp to bounds
        price.clamp(config.min_price, config.max_price)
    }
    
    pub fn get_time_period(config: &PricingConfig, timestamp: i64) -> TimePeriod {
        let hour = get_local_hour(timestamp, config.timezone_offset);
        
        for i in 0..config.tou_tier_count as usize {
            let tier = &config.tou_tiers[i];
            let in_range = if tier.start_hour <= tier.end_hour {
                hour >= tier.start_hour && hour < tier.end_hour
            } else {
                hour >= tier.start_hour || hour < tier.end_hour
            };
            
            if in_range {
                return match tier.period {
                    0 => TimePeriod::OffPeak,
                    1 => TimePeriod::MidPeak,
                    2 => TimePeriod::OnPeak,
                    3 => TimePeriod::SuperPeak,
                    _ => TimePeriod::MidPeak,
                };
            }
        }
        
        TimePeriod::MidPeak
    }
}
```

### 8.2 Example Price Calculation

**Scenario:** Evening peak in hot season with moderate shortage

```
Inputs:
- Base price: 4.00 THB/kWh (4_000_000 in 6-decimal)
- Time: 19:00 (On-Peak)
- Season: Spring (Hot)
- Supply: 800 kWh
- Demand: 1000 kWh
- Congestion: 110 (light)

Calculation:
1. TOU multiplier: 150 (1.5x for On-Peak)
2. Season multiplier: 120 (1.2x for Spring)
3. S/D multiplier: 
   imbalance = (1000-800)/(1000+800) = 11.1%
   adjustment = 11.1% × 5% = 0.56%
   multiplier = 100 + 5.6 ≈ 106

4. Congestion: 110 (1.1x)

5. Final:
   price = 4.00 × 1.5 × 1.2 × 1.06 × 1.1
         = 4.00 × 2.097
         = 8.39 THB/kWh

Bounded: max(2.00, min(8.39, 10.00)) = 8.39 THB/kWh ✓
```

---

## 9. Price Snapshots

### 9.1 Historical Price Storage

```rust
#[account]
pub struct PriceSnapshot {
    pub config: Pubkey,      // Parent pricing config
    pub timestamp: i64,      // Snapshot timestamp
    pub price: u64,          // Calculated price
    pub time_period: u8,     // TOU period
    pub supply: u64,         // Supply at snapshot
    pub demand: u64,         // Demand at snapshot
    pub congestion: u16,     // Congestion at snapshot
    pub bump: u8,            // PDA bump
}

impl PriceSnapshot {
    pub const LEN: usize = 8 + 32 + 8 + 8 + 1 + 8 + 8 + 2 + 1 + 16; // ~92 bytes
}
```

### 9.2 Snapshot Creation

```rust
pub fn process_create_price_snapshot(
    ctx: Context<CreatePriceSnapshot>,
    timestamp: i64,
) -> Result<()> {
    let config = &ctx.accounts.pricing_config;
    let snapshot = &mut ctx.accounts.snapshot;
    
    // Calculate current price
    let price = calculator::calculate_price(config, timestamp);
    let period = calculator::get_time_period(config, timestamp);
    
    snapshot.config = config.key();
    snapshot.timestamp = timestamp;
    snapshot.price = price;
    snapshot.time_period = period as u8;
    snapshot.supply = config.current_supply;
    snapshot.demand = config.current_demand;
    snapshot.congestion = config.congestion_factor;
    snapshot.bump = ctx.bumps.snapshot;
    
    emit!(PriceSnapshotCreated {
        config: config.key(),
        timestamp,
        price,
        period: period as u8,
    });
    
    Ok(())
}
```

---

## 10. Integration with Trading

### 10.1 Order Pricing

Orders can reference the pricing config for dynamic limit prices:

```rust
pub fn create_dynamic_order(
    ctx: Context<CreateOrder>,
    amount: u64,
    price_mode: PriceMode,
) -> Result<()> {
    let price = match price_mode {
        PriceMode::Fixed(p) => p,
        PriceMode::Dynamic => {
            // Use current dynamic price
            let config = &ctx.accounts.pricing_config;
            let timestamp = Clock::get()?.unix_timestamp;
            calculator::calculate_price(config, timestamp)
        }
        PriceMode::DynamicWithBuffer(buffer_bps) => {
            // Dynamic price + buffer (for buyers ensuring fill)
            let config = &ctx.accounts.pricing_config;
            let timestamp = Clock::get()?.unix_timestamp;
            let base = calculator::calculate_price(config, timestamp);
            base.saturating_mul(10000 + buffer_bps as u64) / 10000
        }
    };
    
    // ... create order with calculated price
    Ok(())
}
```

### 10.2 Settlement Price Selection

```rust
pub fn get_settlement_price(
    market: &Market,
    pricing_config: &PricingConfig,
    buy_price: u64,
    sell_price: u64,
    timestamp: i64,
) -> u64 {
    // Option 1: Use dynamic price if within bid-ask spread
    let dynamic_price = calculator::calculate_price(pricing_config, timestamp);
    
    if dynamic_price >= sell_price && dynamic_price <= buy_price {
        return dynamic_price;
    }
    
    // Option 2: Fall back to midpoint
    (buy_price.saturating_add(sell_price)) / 2
}
```

---

## 11. Security Considerations

### 11.1 Price Manipulation

**Threat:** Oracle operator manipulates supply/demand data.

**Mitigations:**
- Rate limiting: `update_interval` enforces minimum time between updates
- Bounds: All multipliers clamped to reasonable ranges
- Multi-oracle: Support for multiple data sources (future)
- Historical validation: Large deviations trigger alerts

### 11.2 Front-Running

**Threat:** Observer sees price update and front-runs trades.

**Mitigations:**
- Price changes are bounded (max ±50% from base)
- TOU changes are predictable (public schedule)
- Batch auctions aggregate trades (optional mode)

---

## 12. Compute Unit Profile

| Operation | CU Cost | Notes |
|-----------|---------|-------|
| `calculate_price` | ~3,000 | Pure computation |
| `update_market_data` | ~8,000 | State update + event |
| `create_price_snapshot` | ~12,000 | Account creation |
| TOU lookup | ~500 | Loop over 6 tiers |

---

## 13. Future Enhancements

1. **Machine Learning Integration**: Predict demand patterns
2. **Locational Marginal Pricing (LMP)**: Geographic price variations
3. **Real-Time Grid Frequency**: Price based on grid stability
4. **Weather API Integration**: Forecast-based pricing
5. **Carbon Price Integration**: Include emission costs

---

## 14. References

1. Provincial Electricity Authority (PEA) Thailand. "Time-of-Use Tariff Structure"
2. Cramton, P. (2017). "Electricity Market Design"
3. Solana. "Clock Sysvar Documentation"
