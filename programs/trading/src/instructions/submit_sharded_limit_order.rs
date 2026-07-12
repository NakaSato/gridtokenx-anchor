use anchor_lang::prelude::*;
use crate::state::*;

#[cfg(feature = "localnet")]
use compute_debug::compute_fn;
#[cfg(not(feature = "localnet"))]
use crate::compute_fn;

#[derive(Accounts)]
#[instruction(order_id_val: u64, side: u8, amount: u64, price: u64, shard_id: u8)]
pub struct SubmitLimitOrderShardedContext<'info> {
    #[account(init, payer = authority, space = 8 + std::mem::size_of::<Order>(), seeds = [b"order", authority.key().as_ref(), &order_id_val.to_le_bytes()], bump)]
    pub order: AccountLoader<'info, Order>,
    // Read-only: handler never writes zone_market (only order + zone_shard); it is
    // used solely to derive/validate the zone_shard PDA seed. `mut` here would take a
    // write-lock on the shared parent and serialize every "sharded" submit across all
    // shards in the zone, defeating the shard's purpose (same rule as ShardedMatchOrdersContext).
    pub zone_market: AccountLoader<'info, ZoneMarket>,
    #[account(mut, seeds = [b"zone_shard", zone_market.key().as_ref(), &[shard_id]], bump)]
    pub zone_shard: AccountLoader<'info, ZoneMarketShard>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: Manual deserialization to handle length mismatch in localnet
    pub governance_config: UncheckedAccount<'info>,
}

pub fn submit_limit_order_sharded(
    ctx: Context<SubmitLimitOrderShardedContext>,
    order_id_val: u64,
    side: u8,
    amount: u64,
    price: u64,
    _shard_id: u8,
) -> Result<()> {
    compute_fn!("submit_limit_order_sharded" => {
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

    // Track last activity time (trade stats updated during matching, not submission)
    zone_shard.last_update = clock.unix_timestamp;

    emit!(crate::events::LimitOrderSubmitted {
        order_id: ctx.accounts.order.key(),
        side,
        price,
        amount,
        timestamp: clock.unix_timestamp,
    });
    });

    Ok(())
}
