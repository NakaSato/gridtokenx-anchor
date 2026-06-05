use anchor_lang::prelude::*;
use crate::state::*;
use crate::ShardedMatchOrdersContext;
use crate::utils::get_governance_config;

#[cfg(feature = "localnet")]
use compute_debug::compute_fn;
#[cfg(not(feature = "localnet"))]
use crate::compute_fn;

pub fn sharded_match_orders(ctx: Context<ShardedMatchOrdersContext>, match_amount: u64, _shard_id: u8) -> Result<()> {
    compute_fn!("sharded_match_orders" => {
    require!(
        get_governance_config(&ctx.accounts.governance_config.to_account_info())?.is_operational(),
        crate::error::TradingError::MaintenanceMode
    );

    let mut buy_order = ctx.accounts.buy_order.load_mut()?;
    let mut sell_order = ctx.accounts.sell_order.load_mut()?;
    let mut zone_shard = ctx.accounts.zone_shard.load_mut()?;
    let mut trade_record = ctx.accounts.trade_record.load_init()?;
    let clock = Clock::get()?;

    // Validate order statuses
    require!(
        buy_order.status == OrderStatus::Active as u8
            || buy_order.status == OrderStatus::PartiallyFilled as u8,
        crate::error::TradingError::InactiveBuyOrder
    );
    require!(
        sell_order.status == OrderStatus::Active as u8
            || sell_order.status == OrderStatus::PartiallyFilled as u8,
        crate::error::TradingError::InactiveSellOrder
    );
    require!(
        buy_order.price_per_kwh >= sell_order.price_per_kwh,
        crate::error::TradingError::PriceMismatch
    );

    let clearing_price = sell_order.price_per_kwh;
    let buy_remaining = buy_order.amount.saturating_sub(buy_order.filled_amount);
    let sell_remaining = sell_order.amount.saturating_sub(sell_order.filled_amount);
    let actual_match_amount = match_amount.min(buy_remaining).min(sell_remaining);

    buy_order.filled_amount += actual_match_amount;
    sell_order.filled_amount += actual_match_amount;

    if buy_order.filled_amount >= buy_order.amount {
        buy_order.status = OrderStatus::Completed as u8;
    } else {
        buy_order.status = OrderStatus::PartiallyFilled as u8;
    }

    if sell_order.filled_amount >= sell_order.amount {
        sell_order.status = OrderStatus::Completed as u8;
    } else {
        sell_order.status = OrderStatus::PartiallyFilled as u8;
    }

    // Update SHARD instead of ZoneMarket
    zone_shard.volume_accumulated += actual_match_amount;
    zone_shard.trade_count += 1;
    zone_shard.last_clearing_price = clearing_price;
    zone_shard.last_update = clock.unix_timestamp;

    trade_record.buy_order = ctx.accounts.buy_order.key();
    trade_record.sell_order = ctx.accounts.sell_order.key();
    trade_record.amount = actual_match_amount;
    trade_record.price_per_kwh = clearing_price;
    trade_record.executed_at = clock.unix_timestamp;

    emit!(crate::events::OrderMatched {
        buy_order: ctx.accounts.buy_order.key(),
        sell_order: ctx.accounts.sell_order.key(),
        buyer: buy_order.buyer,
        seller: sell_order.seller,
        amount: actual_match_amount,
        price: clearing_price,
        total_value: actual_match_amount.saturating_mul(clearing_price),
        fee_amount: 0,
        timestamp: clock.unix_timestamp,
    });
    });

    Ok(())
}
