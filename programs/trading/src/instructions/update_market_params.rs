use anchor_lang::prelude::*;
use crate::error::TradingError;
use crate::state::*;
use crate::utils::get_governance_config;
use crate::GovernanceConfig;

#[derive(Accounts)]
pub struct UpdateMarketParamsContext<'info> {
    #[account(mut, has_one = authority)]
    pub market: AccountLoader<'info, Market>,
    pub authority: Signer<'info>,
    pub governance_config: Account<'info, GovernanceConfig>,
}

pub fn update_market_params(
    ctx: Context<UpdateMarketParamsContext>,
    fee_bps: u16,
    clearing: bool,
    min_price: u64,
    max_price: u64,
) -> Result<()> {
    require!(
        get_governance_config(&ctx.accounts.governance_config.to_account_info())?.is_operational(),
        TradingError::MaintenanceMode
    );
    // Authority is enforced by `has_one = authority` on the market account in
    // UpdateMarketParamsContext (fires in account validation, before this body), so an
    // explicit `authority == market.authority` require here is dead — removed.
    let mut market = ctx.accounts.market.load_mut()?;
    market.market_fee_bps = fee_bps;
    market.clearing_enabled = if clearing { 1 } else { 0 };
    if min_price > 0 {
        market.min_price_per_kwh = min_price;
    }
    market.max_price_per_kwh = max_price;
    // Hoist Clock::get() before emit! — avoids an inline syscall inside the macro
    // expansion which is harder for the compiler to optimise away.
    let now = Clock::get()?.unix_timestamp;
    emit!(crate::events::MarketParamsUpdated {
        authority: ctx.accounts.authority.key(),
        market_fee_bps: fee_bps,
        clearing_enabled: clearing,
        min_price_per_kwh: market.min_price_per_kwh,
        max_price_per_kwh: market.max_price_per_kwh,
        timestamp: now,
    });
    Ok(())
}
