use anchor_lang::prelude::*;
use crate::error::TradingError;
use crate::state::*;
use crate::utils::get_governance_config;
use crate::GovernanceConfig;

#[derive(Accounts)]
pub struct SubmitMarketOrderContext<'info> {
    #[account(mut)]
    pub market: AccountLoader<'info, Market>,
    pub zone_market: AccountLoader<'info, ZoneMarket>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub governance_config: Account<'info, GovernanceConfig>,
}

/// CDA Market Order - Execute immediately at best available price
pub fn submit_market_order(
    ctx: Context<SubmitMarketOrderContext>,
    side: u8, // 0 = Buy (take asks), 1 = Sell (take bids)
    amount: u64,
) -> Result<()> {
    require!(
        get_governance_config(&ctx.accounts.governance_config.to_account_info())?.is_operational(),
        TradingError::MaintenanceMode
    );
    require!(amount > 0, TradingError::InvalidAmount);

    let clock = Clock::get()?;
    let zone_market = ctx.accounts.zone_market.load()?;

    // Check if there's liquidity on the opposite side
    if side == 0 {
        // Buy order - need asks
        require!(
            zone_market.sell_side_depth_count > 0,
            TradingError::InsufficientLiquidity
        );
    } else {
        // Sell order - need bids
        require!(
            zone_market.buy_side_depth_count > 0,
            TradingError::InsufficientLiquidity
        );
    }

    // Market orders execute at market price (will be matched by off-chain agent or subsequent instructions)
    emit!(crate::events::MarketOrderSubmitted {
        user: ctx.accounts.authority.key(),
        side,
        amount,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
