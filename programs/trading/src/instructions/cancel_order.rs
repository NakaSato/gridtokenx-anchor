use anchor_lang::prelude::*;
use crate::error::TradingError;
use crate::state::*;
use crate::utils::get_governance_config;
use crate::GovernanceConfig;

#[derive(Accounts)]
pub struct CancelOrderContext<'info> {
    pub market: AccountLoader<'info, Market>,
    #[account(mut, constraint = zone_market.load()?.market == market.key())]
    pub zone_market: AccountLoader<'info, ZoneMarket>,
    #[account(mut)]
    pub order: AccountLoader<'info, Order>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub governance_config: Account<'info, GovernanceConfig>,
}

pub fn cancel_order(ctx: Context<CancelOrderContext>) -> Result<()> {
    require!(
        get_governance_config(&ctx.accounts.governance_config.to_account_info())?.is_operational(),
        TradingError::MaintenanceMode
    );
    let _market = ctx.accounts.market.load()?;
    let mut zone_market = ctx.accounts.zone_market.load_mut()?;
    let mut order = ctx.accounts.order.load_mut()?;
    let clock = Clock::get()?;

    let order_owner = if order.order_type == OrderType::Buy as u8 {
        order.buyer
    } else {
        order.seller
    };
    require!(
        ctx.accounts.authority.key() == order_owner,
        TradingError::UnauthorizedAuthority
    );
    require!(
        order.status == OrderStatus::Active as u8
            || order.status == OrderStatus::PartiallyFilled as u8,
        TradingError::OrderNotCancellable
    );

    order.status = OrderStatus::Cancelled as u8;
    zone_market.active_orders = zone_market.active_orders.saturating_sub(1);

    emit!(crate::events::OrderCancelled {
        order_id: ctx.accounts.order.key(),
        user: ctx.accounts.authority.key(),
        timestamp: clock.unix_timestamp,
    });
    Ok(())
}
