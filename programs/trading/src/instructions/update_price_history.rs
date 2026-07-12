use anchor_lang::prelude::*;
use crate::error::TradingError;
use crate::state::*;
use crate::utils::get_governance_config;
use crate::GovernanceConfig;

#[derive(Accounts)]
pub struct UpdatePriceHistoryContext<'info> {
    #[account(mut, has_one = authority)]
    pub market: AccountLoader<'info, Market>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub governance_config: Account<'info, GovernanceConfig>,
}

/// Update price history with new trade data
/// Maintains rolling 24-hour price history and calculates VWAP
pub fn update_price_history(
    ctx: Context<UpdatePriceHistoryContext>,
    trade_price: u64,
    trade_volume: u64,
) -> Result<()> {
    require!(
        get_governance_config(&ctx.accounts.governance_config.to_account_info())?.is_operational(),
        TradingError::MaintenanceMode
    );

    let mut market = ctx.accounts.market.load_mut()?;
    let clock = Clock::get()?;
    let current_timestamp = clock.unix_timestamp;

    // O(1) ring-buffer insertion — no more O(n) left-shift when the buffer is full.
    // price_history_head tracks the next write slot (wraps mod 24).
    // price_history_count tracks how many slots are valid (caps at 24).
    let head = market.price_history_head as usize;
    market.price_history[head] = PricePoint {
        price: trade_price,
        volume: trade_volume,
        timestamp: current_timestamp,
    };
    // Advance head with wrapping — keeps O(1) regardless of buffer state
    market.price_history_head = ((head + 1) % 24) as u8;
    if (market.price_history_count as usize) < 24 {
        market.price_history_count = market.price_history_count.saturating_add(1);
    }

    // Update volume-weighted price (VWAP)
    let mut total_volume: u64 = 0;
    let mut total_value: u64 = 0;

    for i in 0..market.price_history_count as usize {
        let point = market.price_history[i];
        if point.volume > 0 {
            total_volume = total_volume.saturating_add(point.volume);
            total_value = total_value.saturating_add(point.volume.saturating_mul(point.price));
        }
    }

    if total_volume > 0 {
        market.volume_weighted_price = total_value / total_volume;
    }

    market.last_clearing_price = trade_price;

    emit!(crate::events::PriceHistoryUpdated {
        trade_price,
        trade_volume,
        vwap: market.volume_weighted_price,
        timestamp: current_timestamp,
    });

    Ok(())
}
