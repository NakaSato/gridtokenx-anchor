use anchor_lang::prelude::*;
use crate::error::TradingError;
use crate::state::*;
use crate::utils::{get_governance_config, validate_order_expiry};

#[derive(Accounts)]
#[instruction(order_id_val: u64)]
pub struct CreateBuyOrderContext<'info> {
    pub market: AccountLoader<'info, Market>,
    #[account(mut)]
    pub zone_market: AccountLoader<'info, ZoneMarket>,
    #[account(init, payer = authority, space = 8 + std::mem::size_of::<Order>(), seeds = [b"order", authority.key().as_ref(), &order_id_val.to_le_bytes()], bump)]
    pub order: AccountLoader<'info, Order>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: Manual deserialization to handle length mismatch in localnet
    pub governance_config: UncheckedAccount<'info>,
}

pub fn create_buy_order(
    ctx: Context<CreateBuyOrderContext>,
    order_id_val: u64,
    energy_amount: u64,
    max_price_per_kwh: u64,
    expires_at: i64,
) -> Result<()> {
    require!(
        get_governance_config(&ctx.accounts.governance_config.to_account_info())?.is_operational(),
        TradingError::MaintenanceMode
    );
    require!(energy_amount > 0, TradingError::InvalidAmount);
    require!(max_price_per_kwh > 0, TradingError::InvalidPrice);

    {
        let market_ref = ctx.accounts.market.load()?;
        require!(
            max_price_per_kwh >= market_ref.min_price_per_kwh,
            TradingError::PriceBelowMinimum
        );
        if market_ref.max_price_per_kwh > 0 {
            require!(
                max_price_per_kwh <= market_ref.max_price_per_kwh,
                TradingError::PriceAboveMaximum
            );
        }
    }

    // No redundant market load — price bounds already checked above.
    let mut zone_market = ctx.accounts.zone_market.load_mut()?;
    let mut order = ctx.accounts.order.load_init()?;
    let clock = Clock::get()?;

    order.buyer = ctx.accounts.authority.key();
    order.seller = Pubkey::default();
    order.order_id = order_id_val;
    order.amount = energy_amount;
    order.filled_amount = 0;
    order.price_per_kwh = max_price_per_kwh;
    order.order_type = OrderType::Buy as u8;
    order.status = OrderStatus::Active as u8;
    order.created_at = clock.unix_timestamp;
    // Caller-supplied expiry (0 = none). See utils::validate_order_expiry.
    order.expires_at = validate_order_expiry(expires_at, clock.unix_timestamp)?;

    zone_market.active_orders += 1;
    emit!(crate::events::BuyOrderCreated {
        buyer: ctx.accounts.authority.key(),
        order_id: ctx.accounts.order.key(),
        amount: energy_amount,
        price_per_kwh: max_price_per_kwh,
        timestamp: clock.unix_timestamp,
    });
    Ok(())
}
