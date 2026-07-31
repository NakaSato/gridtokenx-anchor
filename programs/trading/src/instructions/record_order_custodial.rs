use anchor_lang::prelude::*;
use crate::error::TradingError;
use crate::state::*;
use crate::utils::{get_governance_config, validate_order_expiry};

#[derive(Accounts)]
#[instruction(order_id_val: u64, user: Pubkey)]
pub struct RecordOrderCustodialContext<'info> {
    pub market: AccountLoader<'info, Market>,
    #[account(mut)]
    pub zone_market: AccountLoader<'info, ZoneMarket>,
    #[account(init, payer = funder, space = 8 + std::mem::size_of::<Order>(), seeds = [b"order", user.as_ref(), &order_id_val.to_le_bytes()], bump)]
    pub order: AccountLoader<'info, Order>,
    #[account(mut)]
    pub funder: Signer<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: Manual deserialization to handle length mismatch in localnet
    pub governance_config: UncheckedAccount<'info>,
}

/// Custodial order record (Option A): platform records a buy/sell order PDA on a
/// user's behalf. The order PDA is seed-bound to [b"order", user, order_id] with
/// `user` stored as the non-signing authority; the platform `funder` signs + pays
/// rent. Mirrors create_{buy,sell}_order validation. Off-chain authorization is
/// enforced by Chain Bridge RBAC (trading-service role only).
pub fn record_order_custodial(
    ctx: Context<RecordOrderCustodialContext>,
    order_id_val: u64,
    user: Pubkey,
    is_buy: bool,
    energy_amount: u64,
    price_per_kwh: u64,
    expires_at: i64,
) -> Result<()> {
    require!(
        get_governance_config(&ctx.accounts.governance_config.to_account_info())?.is_operational(),
        TradingError::MaintenanceMode
    );
    require!(energy_amount > 0, TradingError::InvalidAmount);
    require!(price_per_kwh > 0, TradingError::InvalidPrice);

    {
        let market_ref = ctx.accounts.market.load()?;
        require!(
            price_per_kwh >= market_ref.min_price_per_kwh,
            TradingError::PriceBelowMinimum
        );
        if market_ref.max_price_per_kwh > 0 {
            require!(
                price_per_kwh <= market_ref.max_price_per_kwh,
                TradingError::PriceAboveMaximum
            );
        }
    }

    let mut zone_market = ctx.accounts.zone_market.load_mut()?;
    let mut order = ctx.accounts.order.load_init()?;
    let clock = Clock::get()?;

    if is_buy {
        order.buyer = user;
        order.seller = Pubkey::default();
        order.order_type = OrderType::Buy as u8;
    } else {
        order.seller = user;
        order.buyer = Pubkey::default();
        order.order_type = OrderType::Sell as u8;
    }
    order.order_id = order_id_val;
    order.amount = energy_amount;
    order.filled_amount = 0;
    order.price_per_kwh = price_per_kwh;
    order.status = OrderStatus::Active as u8;
    order.created_at = clock.unix_timestamp;
    // The expiry the trading service resolved for this order off-chain (0 = none),
    // not a hardcoded 24h — this PDA is what `trading_orders.order_pda` points at,
    // so a reader comparing the two must not see two different lifetimes.
    order.expires_at = validate_order_expiry(expires_at, clock.unix_timestamp)?;

    zone_market.active_orders += 1;
    Ok(())
}
