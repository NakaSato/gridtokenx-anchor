use anchor_lang::prelude::*;
use crate::state::*;
use crate::utils::get_governance_config;

#[cfg(feature = "localnet")]
use compute_debug::compute_fn;
#[cfg(not(feature = "localnet"))]
use crate::compute_fn;

#[derive(Accounts)]
#[instruction(match_amount: u64, shard_id: u8)]
pub struct ShardedMatchOrdersContext<'info> {
    // Read-only: handler never writes market/zone_market (only zone_shard).
    // `mut` here would take write-locks on the shared zone accounts and
    // serialize every "sharded" match, defeating the shard's purpose.
    pub market: AccountLoader<'info, Market>,
    pub zone_market: AccountLoader<'info, ZoneMarket>,
    #[account(mut, seeds = [b"zone_shard", zone_market.key().as_ref(), &[shard_id]], bump)]
    pub zone_shard: AccountLoader<'info, ZoneMarketShard>,
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

pub fn sharded_match_orders(ctx: Context<ShardedMatchOrdersContext>, match_amount: u64, _shard_id: u8) -> Result<()> {
    compute_fn!("sharded_match_orders" => {
    require!(
        get_governance_config(&ctx.accounts.governance_config.to_account_info())?.is_operational(),
        crate::error::TradingError::MaintenanceMode
    );
    // Same guard as match_orders: a zero-amount call must not init a zero-trade
    // TradeRecord, bump trade_count, or flip an Active order to PartiallyFilled.
    require!(match_amount > 0, crate::error::TradingError::InvalidAmount);

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
    // Same guard as match_orders: a user may never trade with themselves.
    require_keys_neq!(
        buy_order.buyer,
        sell_order.seller,
        crate::error::TradingError::SelfTradeNotAllowed
    );
    // Same guard as match_orders: a lapsed order must not match.
    crate::utils::require_orders_live(
        buy_order.expires_at,
        sell_order.expires_at,
        clock.unix_timestamp,
    )?;

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
    trade_record.seller = sell_order.seller;
    trade_record.buyer = buy_order.buyer;
    trade_record.amount = actual_match_amount;
    trade_record.price_per_kwh = clearing_price;
    // Discovery-path total_value: raw amount·price (NO /1e9), informational only —
    // same scale as match_orders. See events.rs::OrderMatched for the dual-scale contract.
    trade_record.total_value = actual_match_amount.saturating_mul(clearing_price);
    trade_record.fee_amount = 0;
    trade_record.executed_at = clock.unix_timestamp;

    emit!(crate::events::OrderMatched {
        buy_order: ctx.accounts.buy_order.key(),
        sell_order: ctx.accounts.sell_order.key(),
        buyer: buy_order.buyer,
        seller: sell_order.seller,
        amount: actual_match_amount,
        price: clearing_price,
        // Discovery-path raw amount·price (NO /1e9), informational — see events.rs::OrderMatched.
        total_value: actual_match_amount.saturating_mul(clearing_price),
        fee_amount: 0,
        timestamp: clock.unix_timestamp,
    });
    });

    Ok(())
}
