use anchor_lang::prelude::*;
use crate::error::TradingError;
use crate::state::*;
use crate::utils::get_governance_config;

#[derive(Accounts)]
#[instruction(order_id_val: u64)]
pub struct SubmitLimitOrderContext<'info> {
    #[account(mut)]
    pub market: AccountLoader<'info, Market>,
    #[account(init, payer = authority, space = 8 + std::mem::size_of::<Order>(), seeds = [b"order", authority.key().as_ref(), &order_id_val.to_le_bytes()], bump)]
    pub order: AccountLoader<'info, Order>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: Manual deserialization to handle length mismatch in localnet
    pub governance_config: UncheckedAccount<'info>,
}

/// CDA (Continuous Double Auction) Limit Order
/// Submits a limit order and attempts immediate matching against the order book
pub fn submit_limit_order(
    ctx: Context<SubmitLimitOrderContext>,
    order_id_val: u64,
    side: u8, // 0 = Buy, 1 = Sell
    amount: u64,
    price: u64,
) -> Result<()> {
    require!(
        get_governance_config(&ctx.accounts.governance_config.to_account_info())?.is_operational(),
        TradingError::MaintenanceMode
    );
    require!(amount > 0, TradingError::InvalidAmount);
    require!(price > 0, TradingError::InvalidPrice);

    let clock = Clock::get()?;
    let mut market = ctx.accounts.market.load_mut()?;

    // Price bounds check
    require!(
        price >= market.min_price_per_kwh,
        TradingError::PriceBelowMinimum
    );
    if market.max_price_per_kwh > 0 {
        require!(
            price <= market.max_price_per_kwh,
            TradingError::PriceAboveMaximum
        );
    }

    // Initialize the order
    let mut order = ctx.accounts.order.load_init()?;
    let order_type = if side == 0 {
        OrderType::Buy
    } else {
        OrderType::Sell
    };

    if order_type == OrderType::Buy {
        order.buyer = ctx.accounts.authority.key();
        order.price_per_kwh = price;
    } else {
        order.seller = ctx.accounts.authority.key();
        order.price_per_kwh = price;
    }

    order.order_id = order_id_val;
    order.amount = amount;
    order.filled_amount = 0;
    order.order_type = order_type as u8;
    order.status = OrderStatus::Active as u8;
    order.created_at = clock.unix_timestamp;
    order.expires_at = clock.unix_timestamp + 86400;

    market.active_orders += 1;

    // CDA: Check for immediate match against opposite side
    // For a buy order: check if price >= best_ask (lowest sell price)
    // For a sell order: check if price <= best_bid (highest buy price)

    // Note: In a full CDA implementation, we would scan through all opposite orders
    // For now, we emit an event indicating the order is ready for matching

    if order_type == OrderType::Buy {
        emit!(crate::events::BuyOrderCreated {
            buyer: ctx.accounts.authority.key(),
            order_id: ctx.accounts.order.key(),
            amount,
            price_per_kwh: price,
            timestamp: clock.unix_timestamp,
        });
    } else {
        emit!(crate::events::SellOrderCreated {
            seller: ctx.accounts.authority.key(),
            order_id: ctx.accounts.order.key(),
            amount,
            price_per_kwh: price,
            timestamp: clock.unix_timestamp,
        });
    }

    // Emit CDA-specific event for off-chain matching agents
    emit!(crate::events::LimitOrderSubmitted {
        order_id: ctx.accounts.order.key(),
        side,
        price,
        amount,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
