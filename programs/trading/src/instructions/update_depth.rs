use anchor_lang::prelude::*;
use crate::error::TradingError;
use crate::state::*;
use crate::utils::get_governance_config;
use crate::GovernanceConfig;

#[derive(Accounts)]
pub struct UpdateDepthContext<'info> {
    #[account(mut, has_one = authority)]
    pub market: AccountLoader<'info, Market>,
    #[account(mut, constraint = zone_market.load()?.market == market.key())]
    pub zone_market: AccountLoader<'info, ZoneMarket>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub governance_config: Account<'info, GovernanceConfig>,
}

/// Update market depth tracking
/// This instruction updates the buy/sell side depth arrays based on current orders
pub fn update_depth(
    ctx: Context<UpdateDepthContext>,
    buy_prices: Vec<u64>,
    buy_amounts: Vec<u64>,
    sell_prices: Vec<u64>,
    sell_amounts: Vec<u64>,
) -> Result<()> {
    require!(
        get_governance_config(&ctx.accounts.governance_config.to_account_info())?.is_operational(),
        TradingError::MaintenanceMode
    );

    let mut zone_market = ctx.accounts.zone_market.load_mut()?;

    // Validate input lengths — capped at MAX_DEPTH_LEVELS to stay within
    // Solana's 1,232-byte transaction size limit for Vec payload
    require!(
        buy_prices.len() <= MAX_DEPTH_LEVELS,
        TradingError::BatchTooLarge
    );
    require!(
        sell_prices.len() <= MAX_DEPTH_LEVELS,
        TradingError::BatchTooLarge
    );
    require!(
        buy_prices.len() == buy_amounts.len(),
        TradingError::InvalidAmount
    );
    require!(
        sell_prices.len() == sell_amounts.len(),
        TradingError::InvalidAmount
    );

    // Clear existing depth
    zone_market.buy_side_depth = [PriceLevel::default(); MAX_DEPTH_LEVELS];
    zone_market.sell_side_depth = [PriceLevel::default(); MAX_DEPTH_LEVELS];

    // Update buy side depth (bids sorted by price DESC)
    for (i, (price, amount)) in buy_prices.iter().zip(buy_amounts.iter()).enumerate() {
        if i >= MAX_DEPTH_LEVELS {
            break;
        }
        zone_market.buy_side_depth[i] = PriceLevel {
            price: *price,
            total_amount: *amount,
            order_count: 1, // Simplified - actual count would require scanning
            _padding: [0; 6],
        };
    }
    zone_market.buy_side_depth_count = buy_prices.len() as u8;

    // Update sell side depth (asks sorted by price ASC)
    for (i, (price, amount)) in sell_prices.iter().zip(sell_amounts.iter()).enumerate() {
        if i >= MAX_DEPTH_LEVELS {
            break;
        }
        zone_market.sell_side_depth[i] = PriceLevel {
            price: *price,
            total_amount: *amount,
            order_count: 1, // Simplified
            _padding: [0; 6],
        };
    }
    zone_market.sell_side_depth_count = sell_prices.len() as u8;

    let clock = Clock::get()?;

    emit!(crate::events::DepthUpdated {
        buy_levels: zone_market.buy_side_depth_count,
        sell_levels: zone_market.sell_side_depth_count,
        best_bid: if !buy_prices.is_empty() {
            buy_prices[0]
        } else {
            0
        },
        best_ask: if !sell_prices.is_empty() {
            sell_prices[0]
        } else {
            0
        },
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
