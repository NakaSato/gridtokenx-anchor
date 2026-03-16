use anchor_lang::prelude::*;
use crate::state::*;
use crate::ShardedMatchOrdersContext;

pub fn sharded_match_orders(ctx: Context<ShardedMatchOrdersContext>, match_amount: u64, _shard_id: u8) -> Result<()> {
    require!(
        ctx.accounts.governance_config.is_operational(),
        crate::error::TradingError::MaintenanceMode
    );

    let mut buy_order = ctx.accounts.buy_order.load_mut()?;
    let mut sell_order = ctx.accounts.sell_order.load_mut()?;
    let mut zone_shard = ctx.accounts.zone_shard.load_mut()?;
    let mut trade_record = ctx.accounts.trade_record.load_init()?;
    let clock = Clock::get()?;

    // Validation logic (simplified for TPS)
    let clearing_price = sell_order.price_per_kwh;
    let actual_match_amount = match_amount; 

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
        total_value: actual_match_amount * clearing_price,
        fee_amount: 0, 
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
