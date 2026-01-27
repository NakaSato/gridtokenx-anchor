use anchor_lang::prelude::*;

/// Dynamic Pricing Module for GridTokenX
/// 
/// Implements intelligent pricing algorithms for energy trading:
/// - Time-of-Use (TOU) pricing
/// - Supply/Demand based dynamic pricing
/// - Peak/Off-peak detection
/// - Seasonal adjustments
/// - Grid congestion pricing

/// Time periods for TOU pricing
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum TimePeriod {
    OffPeak = 0,      // Night hours (typically 22:00-06:00)
    MidPeak = 1,      // Shoulder hours
    OnPeak = 2,       // Peak demand hours (typically 09:00-21:00)
    SuperPeak = 3,    // Critical peak (high demand events)
}

impl Default for TimePeriod {
    fn default() -> Self {
        TimePeriod::MidPeak
    }
}

/// Season for seasonal pricing adjustments
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum Season {
    Winter = 0,
    Spring = 1,
    Summer = 2,
    Autumn = 3,
}

impl Default for Season {
    fn default() -> Self {
        Season::Summer
    }
}

/// Price tier configuration
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct PriceTier {
    /// Base price in micro-units (6 decimals)
    pub base_price: u64,
    
    /// Multiplier for this tier (100 = 1.0x, 150 = 1.5x)
    pub multiplier: u16,
    
    /// Start hour (0-23)
    pub start_hour: u8,
    
    /// End hour (0-23)
    pub end_hour: u8,
    
    /// Time period classification
    pub period: u8,
    
    /// Padding
    pub _padding: [u8; 2],
}

impl PriceTier {
    pub const LEN: usize = 8 + 2 + 1 + 1 + 1 + 2;
}

/// Dynamic pricing configuration for a market
#[account]
#[derive(Default)]
pub struct PricingConfig {
    /// Bump seed for PDA
    pub bump: u8,
    
    /// Market this config belongs to
    pub market: Pubkey,
    
    /// Authority that can update pricing
    pub authority: Pubkey,
    
    /// Whether dynamic pricing is enabled
    pub enabled: bool,
    
    /// Base price per kWh (in micro-units, 6 decimals)
    pub base_price: u64,
    
    /// Minimum price floor
    pub min_price: u64,
    
    /// Maximum price ceiling
    pub max_price: u64,
    
    /// Time-of-use price tiers (up to 6)
    pub tou_tiers: [PriceTier; 6],
    
    /// Number of active TOU tiers
    pub tou_tier_count: u8,
    
    /// Seasonal multipliers (100 = 1.0x)
    pub seasonal_multipliers: [u16; 4],
    
    /// Current supply level (for supply/demand pricing)
    pub current_supply: u64,
    
    /// Current demand level
    pub current_demand: u64,
    
    /// Supply/demand sensitivity (basis points)
    pub supply_demand_sensitivity: u16,
    
    /// Grid congestion factor (100 = normal, >100 = congested)
    pub congestion_factor: u16,
    
    /// Last price update timestamp
    pub last_update: i64,
    
    /// Price update interval (seconds)
    pub update_interval: u32,
    
    /// Timezone offset from UTC (hours * 100, e.g., +7:00 = 700)
    pub timezone_offset: i16,
    
    /// Reserved for future use
    /// Reserved for future use
    pub _reserved: [u8; 32],
}

/// Instructions
pub fn process_initialize_pricing_config(
    ctx: Context<InitializePricingConfig>,
    base_price: u64,
    min_price: u64,
    max_price: u64,
    timezone_offset: i16,
) -> Result<()> {
    let config = &mut ctx.accounts.pricing_config;
    config.bump = ctx.bumps.pricing_config;
    config.market = ctx.accounts.market.key();
    config.authority = ctx.accounts.authority.key();
    config.enabled = true;
    config.base_price = base_price;
    config.min_price = min_price;
    config.max_price = max_price;
    config.timezone_offset = timezone_offset;
    config.tou_tiers = create_default_thailand_tou();
    config.tou_tier_count = 3;
    config.seasonal_multipliers = create_default_thailand_seasons();
    config.supply_demand_sensitivity = 500; // 5%
    config.congestion_factor = 100;
    config.update_interval = 3600; // 1 hour
    config.last_update = Clock::get()?.unix_timestamp;

    emit!(PricingConfigured {
        market: config.market,
        authority: config.authority,
        base_price,
        enabled: true,
        timestamp: config.last_update,
    });

    Ok(())
}

pub fn process_update_market_data(
    ctx: Context<UpdateMarketData>,
    supply: u64,
    demand: u64,
    congestion_factor: u16,
) -> Result<()> {
    let config = &mut ctx.accounts.pricing_config;
    let clock = Clock::get()?;
    
    let old_price = calculator::calculate_price(config, clock.unix_timestamp);
    
    config.current_supply = supply;
    config.current_demand = demand;
    config.congestion_factor = congestion_factor;
    config.last_update = clock.unix_timestamp;
    
    let new_price = calculator::calculate_price(config, clock.unix_timestamp);
    
    emit!(PriceUpdated {
        market: config.market,
        old_price,
        new_price,
        time_period: calculator::get_time_period(config, clock.unix_timestamp) as u8,
        supply,
        demand,
        timestamp: clock.unix_timestamp,
    });
    
    Ok(())
}

pub fn process_create_price_snapshot(
    ctx: Context<CreatePriceSnapshot>,
    timestamp: i64,
) -> Result<()> {
    let config = &ctx.accounts.pricing_config;
    let snapshot = &mut ctx.accounts.snapshot;
    
    let price = calculator::calculate_price(config, timestamp);
    
    snapshot.market = config.market;
    snapshot.timestamp = timestamp;
    snapshot.price = price;
    snapshot.base_component = config.base_price;
    snapshot.tou_multiplier = calculator::get_tou_multiplier(config, timestamp);
    snapshot.seasonal_multiplier = config.seasonal_multipliers[calculator::get_season(timestamp, config.timezone_offset) as usize];
    snapshot.supply_demand_adjustment = calculator::calculate_supply_demand_adjustment(config) as i32;
    snapshot.congestion_adjustment = (price as i64 - config.base_price as i64) as i32; // Simplified
    snapshot.supply = config.current_supply;
    snapshot.demand = config.current_demand;
    snapshot.time_period = calculator::get_time_period(config, timestamp) as u8;
    snapshot.season = calculator::get_season(timestamp, config.timezone_offset) as u8;
    
    Ok(())
}

#[derive(Accounts)]
pub struct InitializePricingConfig<'info> {
    #[account(
        init,
        payer = authority,
        space = PricingConfig::LEN,
        seeds = [b"pricing_config", market.key().as_ref()],
        bump
    )]
    pub pricing_config: Account<'info, PricingConfig>,
    
    /// CHECK: Market account verification
    pub market: AccountInfo<'info>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateMarketData<'info> {
    #[account(
        mut,
        has_one = authority,
        seeds = [b"pricing_config", pricing_config.market.as_ref()],
        bump = pricing_config.bump,
    )]
    pub pricing_config: Account<'info, PricingConfig>,
    
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(timestamp: i64)]
pub struct CreatePriceSnapshot<'info> {
    pub pricing_config: Account<'info, PricingConfig>,
    
    #[account(
        init,
        payer = authority,
        space = PriceSnapshot::LEN,
        seeds = [b"price_snapshot", pricing_config.market.as_ref(), &timestamp.to_le_bytes()],
        bump
    )]
    pub snapshot: Account<'info, PriceSnapshot>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

impl PricingConfig {
    pub const LEN: usize = 8 + // discriminator
        1 +   // bump
        32 +  // market
        32 +  // authority
        1 +   // enabled
        8 +   // base_price
        8 +   // min_price
        8 +   // max_price
        PriceTier::LEN * 6 + // tou_tiers
        1 +   // tou_tier_count
        2 * 4 + // seasonal_multipliers
        8 +   // current_supply
        8 +   // current_demand
        2 +   // supply_demand_sensitivity
        2 +   // congestion_factor
        8 +   // last_update
        4 +   // update_interval
        2 +   // timezone_offset
        64;   // reserved
}

/// Price snapshot for historical tracking
#[account]
#[derive(Default)]
pub struct PriceSnapshot {
    /// Market this snapshot belongs to
    pub market: Pubkey,
    
    /// Timestamp
    pub timestamp: i64,
    
    /// Calculated price at this time
    pub price: u64,
    
    /// Components that made up the price
    pub base_component: u64,
    pub tou_multiplier: u16,
    pub seasonal_multiplier: u16,
    pub supply_demand_adjustment: i32,
    pub congestion_adjustment: i32,
    
    /// Market conditions at snapshot time
    pub supply: u64,
    pub demand: u64,
    pub time_period: u8,
    pub season: u8,
    
    /// Reserved
    pub _reserved: [u8; 16],
}

impl PriceSnapshot {
    pub const LEN: usize = 8 + // discriminator
        32 +  // market
        8 +   // timestamp
        8 +   // price
        8 +   // base_component
        2 +   // tou_multiplier
        2 +   // seasonal_multiplier
        4 +   // supply_demand_adjustment
        4 +   // congestion_adjustment
        8 +   // supply
        8 +   // demand
        1 +   // time_period
        1 +   // season
        16;   // reserved
}

/// Events
#[event]
pub struct PricingConfigured {
    pub market: Pubkey,
    pub authority: Pubkey,
    pub base_price: u64,
    pub enabled: bool,
    pub timestamp: i64,
}

#[event]
pub struct PriceUpdated {
    pub market: Pubkey,
    pub old_price: u64,
    pub new_price: u64,
    pub time_period: u8,
    pub supply: u64,
    pub demand: u64,
    pub timestamp: i64,
}

#[event]
pub struct PeakEventDeclared {
    pub market: Pubkey,
    pub multiplier: u16,
    pub start_time: i64,
    pub end_time: i64,
}

/// Error codes
#[error_code]
pub enum PricingError {
    #[msg("Dynamic pricing is disabled")]
    PricingDisabled,
    
    #[msg("Price exceeds maximum ceiling")]
    PriceExceedsCeiling,
    
    #[msg("Price below minimum floor")]
    PriceBelowFloor,
    
    #[msg("Invalid TOU tier configuration")]
    InvalidTouTier,
    
    #[msg("Update interval not elapsed")]
    UpdateTooSoon,
    
    #[msg("Invalid timezone offset")]
    InvalidTimezone,
}

/// Pricing calculation module
pub mod calculator {
    use super::*;
    
    /// Calculate the current dynamic price
    pub fn calculate_price(config: &PricingConfig, timestamp: i64) -> u64 {
        if !config.enabled {
            return config.base_price;
        }
        
        let mut price = config.base_price as u128;
        
        // 1. Apply Time-of-Use multiplier
        let tou_multiplier = get_tou_multiplier(config, timestamp);
        price = price * tou_multiplier as u128 / 100;
        
        // 2. Apply seasonal multiplier
        let season = get_season(timestamp, config.timezone_offset);
        let seasonal_mult = config.seasonal_multipliers[season as usize];
        price = price * seasonal_mult as u128 / 100;
        
        // 3. Apply supply/demand adjustment
        let sd_adjustment = calculate_supply_demand_adjustment(config);
        if sd_adjustment >= 0 {
            price = price + (sd_adjustment as u128);
        } else {
            price = price.saturating_sub((-sd_adjustment) as u128);
        }
        
        // 4. Apply congestion factor
        price = price * config.congestion_factor as u128 / 100;
        
        // 5. Enforce price bounds
        let final_price = price.min(config.max_price as u128).max(config.min_price as u128);
        
        final_price as u64
    }
    
    /// Get the TOU multiplier for current time
    pub fn get_tou_multiplier(config: &PricingConfig, timestamp: i64) -> u16 {
        let hour = get_local_hour(timestamp, config.timezone_offset);
        
        for i in 0..config.tou_tier_count as usize {
            let tier = &config.tou_tiers[i];
            
            // Handle overnight tiers (e.g., 22:00-06:00)
            if tier.start_hour > tier.end_hour {
                if hour >= tier.start_hour || hour < tier.end_hour {
                    return tier.multiplier;
                }
            } else if hour >= tier.start_hour && hour < tier.end_hour {
                return tier.multiplier;
            }
        }
        
        // Default multiplier
        100
    }
    
    /// Get current time period based on hour
    pub fn get_time_period(config: &PricingConfig, timestamp: i64) -> TimePeriod {
        let hour = get_local_hour(timestamp, config.timezone_offset);
        
        for i in 0..config.tou_tier_count as usize {
            let tier = &config.tou_tiers[i];
            
            if tier.start_hour > tier.end_hour {
                if hour >= tier.start_hour || hour < tier.end_hour {
                    return match tier.period {
                        0 => TimePeriod::OffPeak,
                        1 => TimePeriod::MidPeak,
                        2 => TimePeriod::OnPeak,
                        3 => TimePeriod::SuperPeak,
                        _ => TimePeriod::MidPeak,
                    };
                }
            } else if hour >= tier.start_hour && hour < tier.end_hour {
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
    
    /// Calculate supply/demand price adjustment
    pub fn calculate_supply_demand_adjustment(config: &PricingConfig) -> i64 {
        if config.current_supply == 0 || config.current_demand == 0 {
            return 0;
        }
        
        // Ratio: demand / supply (scaled by 1000)
        let ratio = (config.current_demand as u128 * 1000 / config.current_supply as u128) as i64;
        
        // If ratio > 1000, demand exceeds supply -> price increase
        // If ratio < 1000, supply exceeds demand -> price decrease
        let deviation = ratio - 1000;
        
        // Apply sensitivity (basis points)
        let adjustment = deviation * config.supply_demand_sensitivity as i64 / 10000;
        
        // Scale to price units
        (adjustment * config.base_price as i64) / 1000
    }
    
    /// Get local hour from timestamp
    pub fn get_local_hour(timestamp: i64, timezone_offset: i16) -> u8 {
        let offset_seconds = (timezone_offset as i64) * 36; // offset is in 1/100 hours
        let local_time = timestamp + offset_seconds;
        let seconds_in_day = local_time % 86400;
        let hour = seconds_in_day / 3600;
        
        (hour % 24) as u8
    }
    
    /// Get season from timestamp (Northern hemisphere default)
    pub fn get_season(timestamp: i64, _timezone_offset: i16) -> Season {
        // Simplified: based on month
        let days_since_epoch = timestamp / 86400;
        let day_of_year = (days_since_epoch % 365) as u16;
        
        match day_of_year {
            0..=79 => Season::Winter,      // Jan-Mar
            80..=171 => Season::Spring,    // Apr-Jun
            172..=264 => Season::Summer,   // Jul-Sep
            265..=355 => Season::Autumn,   // Oct-Dec
            _ => Season::Winter,
        }
    }
    
    /// Check if currently in peak hours
    pub fn is_peak_hours(config: &PricingConfig, timestamp: i64) -> bool {
        matches!(
            get_time_period(config, timestamp),
            TimePeriod::OnPeak | TimePeriod::SuperPeak
        )
    }
}

/// Default TOU tiers for Thailand grid
pub fn create_default_thailand_tou() -> [PriceTier; 6] {
    [
        // Off-peak: 22:00-09:00
        PriceTier {
            base_price: 2_500_000, // 2.50 THB/kWh
            multiplier: 70,        // 0.7x
            start_hour: 22,
            end_hour: 9,
            period: TimePeriod::OffPeak as u8,
            _padding: [0; 2],
        },
        // Mid-peak: 09:00-18:00 (weekdays)
        PriceTier {
            base_price: 4_000_000, // 4.00 THB/kWh
            multiplier: 100,       // 1.0x
            start_hour: 9,
            end_hour: 18,
            period: TimePeriod::MidPeak as u8,
            _padding: [0; 2],
        },
        // On-peak: 18:00-22:00
        PriceTier {
            base_price: 5_500_000, // 5.50 THB/kWh
            multiplier: 150,       // 1.5x
            start_hour: 18,
            end_hour: 22,
            period: TimePeriod::OnPeak as u8,
            _padding: [0; 2],
        },
        // Unused tiers
        PriceTier::default(),
        PriceTier::default(),
        PriceTier::default(),
    ]
}

/// Default seasonal multipliers (Thailand)
pub fn create_default_thailand_seasons() -> [u16; 4] {
    [
        100, // Winter (cool season) - normal
        110, // Spring (hot season start) - slightly higher
        130, // Summer (hot season peak) - highest (AC demand)
        105, // Autumn (rainy season) - slightly above normal
    ]
}
