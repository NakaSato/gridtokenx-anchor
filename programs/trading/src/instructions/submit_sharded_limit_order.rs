use anchor_lang::prelude::*;
use crate::SubmitLimitOrderShardedContext;
use crate::state::*;

pub fn submit_limit_order_sharded(
    ctx: Context<SubmitLimitOrderShardedContext>,
    order_id_val: u64,
    side: u8,
    amount: u64,
    price: u64,
    _shard_id: u8,
) -> Result<()> {
    let clock = Clock::get()?;
    let mut order = ctx.accounts.order.load_init()?;
    let mut zone_shard = ctx.accounts.zone_shard.load_mut()?;
    
    // Order initialization logic
    let order_type = if side == 0 { OrderType::Buy } else { OrderType::Sell };
    
    order.order_id = order_id_val;
    order.amount = amount;
    order.filled_amount = 0;
    order.price_per_kwh = price;
    order.order_type = order_type as u8;
    order.status = OrderStatus::Active as u8;
    order.created_at = clock.unix_timestamp;
    order.expires_at = clock.unix_timestamp + 86400;
    
    if side == 0 {
        order.buyer = ctx.accounts.authority.key();
    } else {
        order.seller = ctx.accounts.authority.key();
    }

    // Update SHARD stats instead of MARKET stats
    zone_shard.trade_count += 1;
    zone_shard.volume_accumulated = zone_shard.volume_accumulated.saturating_add(amount);
    zone_shard.last_update = clock.unix_timestamp;
    zone_shard.last_clearing_price = price;

    emit!(crate::events::LimitOrderSubmitted {
        order_id: ctx.accounts.order.key(),
        side,
        price,
        amount,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
