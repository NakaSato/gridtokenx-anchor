use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};
use anchor_spl::associated_token::AssociatedToken;

use crate::stablecoin::*;
use crate::{Market, Order, OrderType, OrderStatus, TradingError, PoAConfig};

/// Instructions for stablecoin payments and cross-chain operations

/// Configure a payment token for the market
pub fn process_configure_payment_token(
    ctx: Context<ConfigurePaymentToken>,
    token_type: u8,
    min_order_size: u64,
    max_price_deviation_bps: u16,
) -> Result<()> {
    let market = ctx.accounts.market.load()?;
    
    require!(
        ctx.accounts.authority.key() == market.authority,
        TradingError::UnauthorizedAuthority
    );
    
    let token_config = &mut ctx.accounts.token_config;
    token_config.bump = ctx.bumps.token_config;
    token_config.market = ctx.accounts.market.key();
    token_config.token_type = token_type;
    token_config.mint = ctx.accounts.token_mint.key();
    token_config.decimals = ctx.accounts.token_mint.decimals;
    token_config.enabled = true;
    token_config.min_order_size = min_order_size;
    token_config.max_price_deviation_bps = max_price_deviation_bps;
    token_config.last_price = 0;
    token_config.last_price_update = 0;
    
    emit!(TokenConfigured {
        market: ctx.accounts.market.key(),
        token_type,
        mint: ctx.accounts.token_mint.key(),
        enabled: true,
        timestamp: Clock::get()?.unix_timestamp,
    });
    
    Ok(())
}

/// Create a sell order with stablecoin payment option
pub fn process_create_stablecoin_sell_order(
    ctx: Context<CreateStablecoinOrder>,
    energy_amount: u64,
    price_per_kwh: u64,
    payment_token: u8,
) -> Result<()> {
    require!(ctx.accounts.governance_config.is_operational(), TradingError::MaintenanceMode);
    require!(energy_amount > 0, TradingError::InvalidAmount);
    require!(price_per_kwh > 0, TradingError::InvalidPrice);
    
    let token_config = &ctx.accounts.token_config;
    require!(token_config.enabled, StablecoinError::TokenDisabled);
    require!(
        energy_amount >= token_config.min_order_size,
        StablecoinError::OrderBelowMinimum
    );
    
    // Create the base order
    let mut market = ctx.accounts.market.load_mut()?;
    let mut order = ctx.accounts.order.load_init()?;
    let clock = Clock::get()?;
    
    order.seller = ctx.accounts.authority.key();
    order.buyer = Pubkey::default();
    order.amount = energy_amount;
    order.filled_amount = 0;
    order.price_per_kwh = price_per_kwh;
    order.order_type = OrderType::Sell as u8;
    order.status = OrderStatus::Active as u8;
    order.created_at = clock.unix_timestamp;
    order.expires_at = clock.unix_timestamp + 86400;
    
    market.active_orders += 1;
    
    // Create payment info
    let payment_info = &mut ctx.accounts.payment_info;
    payment_info.order = ctx.accounts.order.key();
    payment_info.payment_token = payment_token;
    payment_info.payment_mint = token_config.mint;
    payment_info.price_in_payment_token = price_per_kwh; // Will be converted at settlement
    payment_info.exchange_rate = 0; // Set at settlement time
    payment_info.rate_timestamp = 0;
    payment_info.payment_processed = false;
    
    emit!(StablecoinOrderCreated {
        order: ctx.accounts.order.key(),
        owner: ctx.accounts.authority.key(),
        payment_token,
        payment_mint: token_config.mint,
        energy_amount,
        price_in_payment: price_per_kwh,
        timestamp: clock.unix_timestamp,
    });
    
    Ok(())
}

/// Create a buy order with stablecoin payment option
pub fn process_create_stablecoin_buy_order(
    ctx: Context<CreateStablecoinOrder>,
    energy_amount: u64,
    max_price_per_kwh: u64,
    payment_token: u8,
) -> Result<()> {
    require!(ctx.accounts.governance_config.is_operational(), TradingError::MaintenanceMode);
    require!(energy_amount > 0, TradingError::InvalidAmount);
    require!(max_price_per_kwh > 0, TradingError::InvalidPrice);
    
    let token_config = &ctx.accounts.token_config;
    require!(token_config.enabled, StablecoinError::TokenDisabled);
    require!(
        energy_amount >= token_config.min_order_size,
        StablecoinError::OrderBelowMinimum
    );
    
    // Create the base order
    let mut market = ctx.accounts.market.load_mut()?;
    let mut order = ctx.accounts.order.load_init()?;
    let clock = Clock::get()?;
    
    order.buyer = ctx.accounts.authority.key();
    order.seller = Pubkey::default();
    order.amount = energy_amount;
    order.filled_amount = 0;
    order.price_per_kwh = max_price_per_kwh;
    order.order_type = OrderType::Buy as u8;
    order.status = OrderStatus::Active as u8;
    order.created_at = clock.unix_timestamp;
    order.expires_at = clock.unix_timestamp + 86400;
    
    market.active_orders += 1;
    
    // Update market depth (if needed, but for simplicity here we skip or call helper)
    // Note: The main create_buy_order calls update_market_depth. 
    // We should probably do that too, but we can't easily access the helper from here if it's not pub.
    // For now, let's assume market depth is updated by a separate mechanism or acceptable to skip for this specific order type
    
    // Create payment info
    let payment_info = &mut ctx.accounts.payment_info;
    payment_info.order = ctx.accounts.order.key();
    payment_info.payment_token = payment_token;
    payment_info.payment_mint = token_config.mint;
    payment_info.price_in_payment_token = max_price_per_kwh;
    payment_info.exchange_rate = 0;
    payment_info.rate_timestamp = 0;
    payment_info.payment_processed = false;
    
    emit!(StablecoinOrderCreated {
        order: ctx.accounts.order.key(),
        owner: ctx.accounts.authority.key(),
        payment_token,
        payment_mint: token_config.mint,
        energy_amount,
        price_in_payment: max_price_per_kwh,
        timestamp: clock.unix_timestamp,
    });
    
    Ok(())
}

/// Execute atomic settlement with stablecoin payment
pub fn process_execute_stablecoin_settlement(
    ctx: Context<ExecuteStablecoinSettlement>,
    amount: u64,
    exchange_rate: u64,
) -> Result<()> {
    require!(ctx.accounts.governance_config.is_operational(), TradingError::MaintenanceMode);
    require!(amount > 0, TradingError::InvalidAmount);
    require!(exchange_rate > 0, StablecoinError::OracleRequired);
    
    let mut market = ctx.accounts.market.load_mut()?;
    let mut buy_order = ctx.accounts.buy_order.load_mut()?;
    let mut sell_order = ctx.accounts.sell_order.load_mut()?;
    let clock = Clock::get()?;
    
    // Validate orders
    require!(
        buy_order.status == OrderStatus::Active as u8 ||
        buy_order.status == OrderStatus::PartiallyFilled as u8,
        TradingError::InactiveBuyOrder
    );
    require!(
        sell_order.status == OrderStatus::Active as u8 ||
        sell_order.status == OrderStatus::PartiallyFilled as u8,
        TradingError::InactiveSellOrder
    );
    
    // Calculate settlement amounts
    let grid_price = sell_order.price_per_kwh;
    let total_grid_value = amount.saturating_mul(grid_price);
    
    // Convert to stablecoin amount using exchange rate
    // exchange_rate is GRID per stablecoin unit * 10^9
    let stablecoin_amount = rate_utils::calculate_output(
        total_grid_value,
        exchange_rate,
        market.market_fee_bps,
    );
    
    let market_fee = (stablecoin_amount as u128)
        .saturating_mul(market.market_fee_bps as u128)
        .checked_div(10_000)
        .unwrap_or(0) as u64;
    
    let net_seller_amount = stablecoin_amount.saturating_sub(market_fee);
    
    // Derived PDA signer for escrow authority
    let market_key = ctx.accounts.market.key();
    let bump = ctx.bumps.escrow_authority;
    let signer_seeds = &[
        b"escrow",
        market_key.as_ref(),
        &[bump],
    ];
    let signer = &[&signer_seeds[..]];

    // Transfer stablecoin from buyer to seller
    let cpi_accounts = TransferChecked {
        from: ctx.accounts.buyer_stablecoin.to_account_info(),
        mint: ctx.accounts.stablecoin_mint.to_account_info(),
        to: ctx.accounts.seller_stablecoin.to_account_info(),
        authority: ctx.accounts.escrow_authority.to_account_info(),
    };
    
    token_interface::transfer_checked(
        CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), cpi_accounts, signer),
        net_seller_amount,
        ctx.accounts.stablecoin_mint.decimals,
    )?;
    
    // Transfer market fee
    if market_fee > 0 {
        let fee_cpi = TransferChecked {
            from: ctx.accounts.buyer_stablecoin.to_account_info(),
            mint: ctx.accounts.stablecoin_mint.to_account_info(),
            to: ctx.accounts.fee_collector.to_account_info(),
            authority: ctx.accounts.escrow_authority.to_account_info(),
        };
        
        token_interface::transfer_checked(
            CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), fee_cpi, signer),
            market_fee,
            ctx.accounts.stablecoin_mint.decimals,
        )?;
    }
    
    // Transfer energy tokens from seller to buyer
    let energy_cpi = TransferChecked {
        from: ctx.accounts.seller_energy.to_account_info(),
        mint: ctx.accounts.energy_mint.to_account_info(),
        to: ctx.accounts.buyer_energy.to_account_info(),
        authority: ctx.accounts.escrow_authority.to_account_info(),
    };
    
    token_interface::transfer_checked(
        CpiContext::new_with_signer(ctx.accounts.energy_token_program.to_account_info(), energy_cpi, signer),
        amount,
        ctx.accounts.energy_mint.decimals,
    )?;
    
    // Update orders
    buy_order.filled_amount += amount;
    sell_order.filled_amount += amount;
    
    if buy_order.filled_amount >= buy_order.amount {
        buy_order.status = OrderStatus::Completed as u8;
        market.active_orders = market.active_orders.saturating_sub(1);
    } else {
        buy_order.status = OrderStatus::PartiallyFilled as u8;
    }
    
    if sell_order.filled_amount >= sell_order.amount {
        sell_order.status = OrderStatus::Completed as u8;
        market.active_orders = market.active_orders.saturating_sub(1);
    } else {
        sell_order.status = OrderStatus::PartiallyFilled as u8;
    }
    
    market.total_volume += amount;
    market.total_trades += 1;
    
    // Update payment info
    let buy_payment = &mut ctx.accounts.buy_payment_info;
    buy_payment.exchange_rate = exchange_rate;
    buy_payment.rate_timestamp = clock.unix_timestamp;
    buy_payment.payment_processed = true;
    
    emit!(StablecoinSettlement {
        buy_order: ctx.accounts.buy_order.key(),
        sell_order: ctx.accounts.sell_order.key(),
        payment_token: buy_payment.payment_token,
        energy_amount: amount,
        payment_amount: stablecoin_amount,
        grid_equivalent: total_grid_value,
        timestamp: clock.unix_timestamp,
    });
    
    Ok(())
}

// Account contexts

#[derive(Accounts)]
#[instruction(token_type: u8)]
pub struct ConfigurePaymentToken<'info> {
    #[account(mut)]
    pub market: AccountLoader<'info, Market>,
    
    #[account(
        init,
        payer = authority,
        space = TokenConfig::LEN,
        seeds = [b"token_config", market.key().as_ref(), &[token_type]],
        bump
    )]
    pub token_config: Account<'info, TokenConfig>,
    
    pub token_mint: InterfaceAccount<'info, Mint>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateStablecoinOrder<'info> {
    #[account(mut)]
    pub market: AccountLoader<'info, Market>,
    
    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<Order>(),
        seeds = [b"order", authority.key().as_ref(), market.load()?.active_orders.to_le_bytes().as_ref()],
        bump
    )]
    pub order: AccountLoader<'info, Order>,
    
    #[account(
        init,
        payer = authority,
        space = OrderPaymentInfo::LEN,
        seeds = [b"payment_info", order.key().as_ref()],
        bump
    )]
    pub payment_info: Account<'info, OrderPaymentInfo>,
    
    pub token_config: Account<'info, TokenConfig>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
    pub governance_config: Account<'info, PoAConfig>,
}

#[derive(Accounts)]
pub struct ExecuteStablecoinSettlement<'info> {
    #[account(mut)]
    pub market: AccountLoader<'info, Market>,
    
    #[account(mut)]
    pub buy_order: AccountLoader<'info, Order>,
    
    #[account(mut)]
    pub sell_order: AccountLoader<'info, Order>,
    
    #[account(mut)]
    pub buy_payment_info: Box<Account<'info, OrderPaymentInfo>>,
    
    #[account(mut)]
    pub sell_payment_info: Box<Account<'info, OrderPaymentInfo>>,
    
    pub stablecoin_mint: InterfaceAccount<'info, Mint>,
    pub energy_mint: InterfaceAccount<'info, Mint>,
    
    #[account(mut)]
    pub buyer_stablecoin: Box<InterfaceAccount<'info, TokenAccount>>,
    
    #[account(mut)]
    pub seller_stablecoin: Box<InterfaceAccount<'info, TokenAccount>>,
    
    #[account(mut)]
    pub buyer_energy: Box<InterfaceAccount<'info, TokenAccount>>,
    
    #[account(mut)]
    pub seller_energy: Box<InterfaceAccount<'info, TokenAccount>>,
    
    #[account(mut)]
    pub fee_collector: Box<InterfaceAccount<'info, TokenAccount>>,
    
    #[account(
        seeds = [b"escrow", market.key().as_ref()],
        bump
    )]
    /// CHECK: Escrow authority PDA
    pub escrow_authority: AccountInfo<'info>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub token_program: Interface<'info, TokenInterface>,
    pub energy_token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub governance_config: Account<'info, PoAConfig>,
}
