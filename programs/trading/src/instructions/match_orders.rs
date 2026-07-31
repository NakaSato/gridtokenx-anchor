use anchor_lang::prelude::*;
use crate::error::TradingError;
use crate::state::*;
use crate::utils::get_governance_config;

#[cfg(feature = "localnet")]
use compute_debug::compute_fn;
#[cfg(not(feature = "localnet"))]
use crate::compute_fn;

#[derive(Accounts)]
pub struct MatchOrdersContext<'info> {
    pub market: AccountLoader<'info, Market>,
    #[account(mut)]
    pub zone_market: AccountLoader<'info, ZoneMarket>,
    #[account(mut)]
    pub buy_order: AccountLoader<'info, Order>,
    #[account(mut)]
    pub sell_order: AccountLoader<'info, Order>,
    #[account(init, payer = authority, space = 8 + std::mem::size_of::<TradeRecord>(), seeds = [b"trade", buy_order.key().as_ref(), sell_order.key().as_ref()], bump)]
    pub trade_record: AccountLoader<'info, TradeRecord>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: Manual deserialization to handle length mismatch in localnet
    pub governance_config: UncheckedAccount<'info>,
}

pub fn match_orders(ctx: Context<MatchOrdersContext>, match_amount: u64) -> Result<()> {
    compute_fn!("match_orders" => {
    require!(
        get_governance_config(&ctx.accounts.governance_config.to_account_info())?.is_operational(),
        TradingError::MaintenanceMode
    );
    require!(match_amount > 0, TradingError::InvalidAmount);

    let mut zone_market = ctx.accounts.zone_market.load_mut()?;
    let mut buy_order = ctx.accounts.buy_order.load_mut()?;
    let mut sell_order = ctx.accounts.sell_order.load_mut()?;
    let mut trade_record = ctx.accounts.trade_record.load_init()?;
    let clock = Clock::get()?;

    require!(
        buy_order.status == OrderStatus::Active as u8
            || buy_order.status == OrderStatus::PartiallyFilled as u8,
        TradingError::InactiveBuyOrder
    );
    require!(
        sell_order.status == OrderStatus::Active as u8
            || sell_order.status == OrderStatus::PartiallyFilled as u8,
        TradingError::InactiveSellOrder
    );
    require!(
        buy_order.price_per_kwh >= sell_order.price_per_kwh,
        TradingError::PriceMismatch
    );
    // A user may never trade with themselves. The off-chain matcher already skips
    // self-crosses (trading-engine: `priced_candidate` / `uniform_auction`), but that
    // is a courtesy of one client — this program must not accept a pair it is handed
    // where both legs belong to the same wallet. Both fields are the REAL user even on
    // the custodial path: `record_order_custodial` stores `user` in buyer/seller and
    // only the platform signs.
    require_keys_neq!(
        buy_order.buyer,
        sell_order.seller,
        TradingError::SelfTradeNotAllowed
    );
    // A lapsed order must not match. `Order.expires_at` was validated when the order was
    // created and then never read back, so a TTL stopped meaning anything the moment the
    // PDA existed. Same 0-is-no-expiry, strict-`<` reading as the signed-payload path.
    crate::utils::require_orders_live(
        buy_order.expires_at,
        sell_order.expires_at,
        clock.unix_timestamp,
    )?;

    let buy_remaining = buy_order.amount.saturating_sub(buy_order.filled_amount);
    let sell_remaining = sell_order.amount.saturating_sub(sell_order.filled_amount);
    let actual_match_amount = match_amount.min(buy_remaining).min(sell_remaining);

    let clearing_price = sell_order.price_per_kwh;
    // Discovery-path total_value: raw amount·price (NO /1e9), informational only — the verifier depends on
    // this scale. See events.rs::OrderMatched for the dual-scale contract; do not normalize here.
    let total_value = actual_match_amount.saturating_mul(clearing_price);

    buy_order.filled_amount += actual_match_amount;
    sell_order.filled_amount += actual_match_amount;

    if buy_order.filled_amount >= buy_order.amount {
        buy_order.status = OrderStatus::Completed as u8;
        zone_market.active_orders = zone_market.active_orders.saturating_sub(1);
    } else {
        buy_order.status = OrderStatus::PartiallyFilled as u8;
    }

    if sell_order.filled_amount >= sell_order.amount {
        sell_order.status = OrderStatus::Completed as u8;
        zone_market.active_orders = zone_market.active_orders.saturating_sub(1);
    } else {
        sell_order.status = OrderStatus::PartiallyFilled as u8;
    }

    trade_record.sell_order = ctx.accounts.sell_order.key();
    trade_record.buy_order = ctx.accounts.buy_order.key();
    trade_record.seller = sell_order.seller;
    trade_record.buyer = buy_order.buyer;
    trade_record.amount = actual_match_amount;
    trade_record.price_per_kwh = clearing_price;
    trade_record.total_value = total_value;
    trade_record.fee_amount = 0;
    trade_record.executed_at = clock.unix_timestamp;

    zone_market.total_volume = zone_market.total_volume.saturating_add(actual_match_amount);
    zone_market.total_trades = zone_market.total_trades.saturating_add(1);
    zone_market.last_clearing_price = clearing_price;

    emit!(crate::events::OrderMatched {
        sell_order: ctx.accounts.sell_order.key(),
        buy_order: ctx.accounts.buy_order.key(),
        seller: sell_order.seller,
        buyer: buy_order.buyer,
        amount: actual_match_amount,
        price: clearing_price,
        total_value,
        fee_amount: 0,
        timestamp: clock.unix_timestamp,
    });
    });

    Ok(())
}
