#![allow(deprecated)]

use anchor_lang::prelude::*;
use base64::{engine::general_purpose, Engine as _};
use governance::{ErcCertificate, ErcStatus};

declare_id!("GZnqNTJsre6qB4pWCQRE9FiJU2GUeBtBDPp6s7zosctk");

#[program]
pub mod trading {
    use super::*;

    pub fn initialize(_ctx: Context<Initialize>) -> Result<()> {
        msg!("Trading program initialized");
        Ok(())
    }
    
    /// Initialize the trading market
    pub fn initialize_market(ctx: Context<InitializeMarket>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        market.authority = ctx.accounts.authority.key();
        market.active_orders = 0;
        market.total_volume = 0;
        market.total_trades = 0;
        market.created_at = Clock::get()?.unix_timestamp;
        market.clearing_enabled = true;
        market.market_fee_bps = 25; // 0.25% fee
        
        emit!(MarketInitialized {
            authority: ctx.accounts.authority.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }
    
    /// Create a sell order for energy
    /// Validates that the seller has a valid ERC certificate before allowing the order
    pub fn create_sell_order(
        ctx: Context<CreateSellOrder>,
        energy_amount: u64,
        price_per_kwh: u64,
    ) -> Result<()> {
        require!(energy_amount > 0, ErrorCode::InvalidAmount);
        require!(price_per_kwh > 0, ErrorCode::InvalidPrice);
        
        // === ERC VALIDATION ===
        // Only allow sell orders if the seller has a valid ERC certificate
        if let Some(erc_certificate) = &ctx.accounts.erc_certificate {
            let clock = Clock::get()?;
            
            // Check certificate status
            require!(
                erc_certificate.status == ErcStatus::Valid,
                ErrorCode::InvalidErcCertificate
            );
            
            // Check expiration
            if let Some(expires_at) = erc_certificate.expires_at {
                require!(
                    clock.unix_timestamp < expires_at,
                    ErrorCode::ErcCertificateExpired
                );
            }
            
            // Check if validated for trading
            require!(
                erc_certificate.validated_for_trading,
                ErrorCode::ErcNotValidatedForTrading
            );
            
            // Verify energy amount doesn't exceed certificate amount
            require!(
                energy_amount <= erc_certificate.energy_amount,
                ErrorCode::ExceedsErcAmount
            );
            
            msg!("ERC validation passed - Certificate ID: {}, Available: {} kWh, Requested: {} kWh",
                erc_certificate.certificate_id,
                erc_certificate.energy_amount,
                energy_amount
            );
        } else {
            msg!("Warning: No ERC certificate provided - order allowed but may fail validation");
        }
        
        let market = &mut ctx.accounts.market;
        let order = &mut ctx.accounts.order;
        let clock = Clock::get()?;
        
        // Initialize order
        order.seller = ctx.accounts.authority.key();
        order.buyer = Pubkey::default(); // Not yet matched
        order.amount = energy_amount;
        order.filled_amount = 0;
        order.price_per_kwh = price_per_kwh;
        order.order_type = OrderType::Sell;
        order.status = OrderStatus::Active;
        order.created_at = clock.unix_timestamp;
        order.expires_at = clock.unix_timestamp + 86400; // 24 hours
        
        // Update market stats
        market.active_orders += 1;
        
        // Encode sell order data as base64 for external systems
        let order_data = format!("SELL:{}:{}:{}", 
            energy_amount,
            price_per_kwh,
            ctx.accounts.authority.key()
        );
        let encoded_data = general_purpose::STANDARD.encode(order_data.as_bytes());
        msg!("Sell order data (base64): {}", encoded_data);
        
        emit!(SellOrderCreated {
            seller: ctx.accounts.authority.key(),
            order_id: order.key(),
            amount: energy_amount,
            price_per_kwh,
            timestamp: clock.unix_timestamp,
        });
        
        msg!(
            "Sell order created - ID: {}, Amount: {} kWh, Price: {} tokens/kWh",
            order.key(),
            energy_amount,
            price_per_kwh
        );
        
        Ok(())
    }
    
    /// Create a buy order for energy
    pub fn create_buy_order(
        ctx: Context<CreateBuyOrder>,
        energy_amount: u64,
        max_price_per_kwh: u64,
    ) -> Result<()> {
        require!(energy_amount > 0, ErrorCode::InvalidAmount);
        require!(max_price_per_kwh > 0, ErrorCode::InvalidPrice);
        
        let market = &mut ctx.accounts.market;
        let order = &mut ctx.accounts.order;
        let clock = Clock::get()?;
        
        // Initialize order
        order.buyer = ctx.accounts.authority.key();
        order.seller = Pubkey::default(); // Not yet matched
        order.amount = energy_amount;
        order.filled_amount = 0;
        order.price_per_kwh = max_price_per_kwh;
        order.order_type = OrderType::Buy;
        order.status = OrderStatus::Active;
        order.created_at = clock.unix_timestamp;
        order.expires_at = clock.unix_timestamp + 86400; // 24 hours
        
        // Update market stats
        market.active_orders += 1;
        
        // Encode buy order data as base64 for external systems
        let order_data = format!("BUY:{}:{}:{}", 
            energy_amount,
            max_price_per_kwh,
            ctx.accounts.authority.key()
        );
        let encoded_data = general_purpose::STANDARD.encode(order_data.as_bytes());
        msg!("Buy order data (base64): {}", encoded_data);
        
        emit!(BuyOrderCreated {
            buyer: ctx.accounts.authority.key(),
            order_id: order.key(),
            amount: energy_amount,
            price_per_kwh: max_price_per_kwh,
            timestamp: clock.unix_timestamp,
        });
        
        msg!(
            "Buy order created - ID: {}, Amount: {} kWh, Max Price: {} tokens/kWh",
            order.key(),
            energy_amount,
            max_price_per_kwh
        );
        
        Ok(())
    }
    
    /// Match a buy order with a sell order
    pub fn match_orders(ctx: Context<MatchOrders>, match_amount: u64) -> Result<()> {
        require!(match_amount > 0, ErrorCode::InvalidAmount);
        
        let market = &mut ctx.accounts.market;
        let buy_order = &mut ctx.accounts.buy_order;
        let sell_order = &mut ctx.accounts.sell_order;
        let trade_record = &mut ctx.accounts.trade_record;
        let clock = Clock::get()?;
        
        // Validate orders
        require!(buy_order.status == OrderStatus::Active || buy_order.status == OrderStatus::PartiallyFilled, ErrorCode::InactiveBuyOrder);
        require!(sell_order.status == OrderStatus::Active || sell_order.status == OrderStatus::PartiallyFilled, ErrorCode::InactiveSellOrder);
        require!(buy_order.price_per_kwh >= sell_order.price_per_kwh, ErrorCode::PriceMismatch);
        
        // Calculate match details
        let buy_remaining = buy_order.amount - buy_order.filled_amount;
        let sell_remaining = sell_order.amount - sell_order.filled_amount;
        let actual_match_amount = match_amount.min(buy_remaining).min(sell_remaining);
        
        // Clearing price (average of bid and ask)
        let clearing_price = (buy_order.price_per_kwh + sell_order.price_per_kwh) / 2;
        let total_value = actual_match_amount * clearing_price;
        let fee_amount = (total_value * market.market_fee_bps as u64) / 10000;
        
        // Update orders
        buy_order.filled_amount += actual_match_amount;
        sell_order.filled_amount += actual_match_amount;
        
        // Update order statuses
        if buy_order.filled_amount >= buy_order.amount {
            buy_order.status = OrderStatus::Completed;
            market.active_orders = market.active_orders.saturating_sub(1);
        } else {
            buy_order.status = OrderStatus::PartiallyFilled;
        }
        
        if sell_order.filled_amount >= sell_order.amount {
            sell_order.status = OrderStatus::Completed;
            market.active_orders = market.active_orders.saturating_sub(1);
        } else {
            sell_order.status = OrderStatus::PartiallyFilled;
        }
        
        // Create trade record
        trade_record.buy_order = buy_order.key();
        trade_record.sell_order = sell_order.key();
        trade_record.buyer = buy_order.buyer;
        trade_record.seller = sell_order.seller;
        trade_record.amount = actual_match_amount;
        trade_record.price_per_kwh = clearing_price;
        trade_record.total_value = total_value;
        trade_record.fee_amount = fee_amount;
        trade_record.executed_at = clock.unix_timestamp;
        
        // Update market stats
        market.total_volume += actual_match_amount;
        market.total_trades += 1;
        
        emit!(OrderMatched {
            buy_order: buy_order.key(),
            sell_order: sell_order.key(),
            buyer: buy_order.buyer,
            seller: sell_order.seller,
            amount: actual_match_amount,
            price: clearing_price,
            total_value,
            fee_amount,
            timestamp: clock.unix_timestamp,
        });
        
        msg!(
            "Orders matched - Amount: {} kWh, Price: {}, Buyer: {}, Seller: {}",
            actual_match_amount,
            clearing_price,
            buy_order.buyer,
            sell_order.seller
        );
        
        Ok(())
    }
    
    /// Cancel an active order
    pub fn cancel_order(ctx: Context<CancelOrder>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        let order = &mut ctx.accounts.order;
        let clock = Clock::get()?;
        
        // Validate order ownership
        let order_owner = if order.order_type == OrderType::Buy {
            order.buyer
        } else {
            order.seller
        };
        
        require!(
            ctx.accounts.authority.key() == order_owner,
            ErrorCode::UnauthorizedAuthority
        );
        
        // Validate order can be cancelled
        require!(
            order.status == OrderStatus::Active || order.status == OrderStatus::PartiallyFilled,
            ErrorCode::OrderNotCancellable
        );
        
        // Update order status
        order.status = OrderStatus::Cancelled;
        
        // Update market stats (only if order was active)
        if order.status == OrderStatus::Active || order.status == OrderStatus::PartiallyFilled {
            market.active_orders = market.active_orders.saturating_sub(1);
        }
        
        emit!(OrderCancelled {
            order_id: order.key(),
            user: ctx.accounts.authority.key(),
            timestamp: clock.unix_timestamp,
        });
        
        msg!("Order cancelled - ID: {}", order.key());
        
        Ok(())
    }
    
    /// Update market parameters (admin only)
    pub fn update_market_params(
        ctx: Context<UpdateMarketParams>,
        market_fee_bps: u16,
        clearing_enabled: bool,
    ) -> Result<()> {
        let market = &mut ctx.accounts.market;
        
        require!(
            ctx.accounts.authority.key() == market.authority,
            ErrorCode::UnauthorizedAuthority
        );
        
        market.market_fee_bps = market_fee_bps;
        market.clearing_enabled = clearing_enabled;
        
        emit!(MarketParamsUpdated {
            authority: ctx.accounts.authority.key(),
            market_fee_bps,
            clearing_enabled,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }
}

// Account structs
#[derive(Accounts)]
pub struct Initialize<'info> {
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct InitializeMarket<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Market::INIT_SPACE,
        seeds = [b"market"],
        bump
    )]
    pub market: Account<'info, Market>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateSellOrder<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    
    #[account(
        init,
        payer = authority,
        space = 8 + Order::INIT_SPACE,
        seeds = [b"order", authority.key().as_ref(), market.active_orders.to_le_bytes().as_ref()],
        bump
    )]
    pub order: Account<'info, Order>,
    
    /// Optional: ERC certificate for prosumers
    /// When provided, validates the seller has certified renewable energy
    pub erc_certificate: Option<Account<'info, ErcCertificate>>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateBuyOrder<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    
    #[account(
        init,
        payer = authority,
        space = 8 + Order::INIT_SPACE,
        seeds = [b"order", authority.key().as_ref(), market.active_orders.to_le_bytes().as_ref()],
        bump
    )]
    pub order: Account<'info, Order>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MatchOrders<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    
    #[account(mut)]
    pub buy_order: Account<'info, Order>,
    
    #[account(mut)]
    pub sell_order: Account<'info, Order>,
    
    #[account(
        init,
        payer = authority,
        space = 8 + TradeRecord::INIT_SPACE,
        seeds = [b"trade", buy_order.key().as_ref(), sell_order.key().as_ref()],
        bump
    )]
    pub trade_record: Account<'info, TradeRecord>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelOrder<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    
    #[account(mut)]
    pub order: Account<'info, Order>,
    
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateMarketParams<'info> {
    #[account(mut, has_one = authority @ ErrorCode::UnauthorizedAuthority)]
    pub market: Account<'info, Market>,
    
    pub authority: Signer<'info>,
}

// Data structs
#[account]
#[derive(InitSpace)]
pub struct Market {
    pub authority: Pubkey,
    pub active_orders: u64,
    pub total_volume: u64,
    pub total_trades: u64,
    pub created_at: i64,
    pub clearing_enabled: bool,
    pub market_fee_bps: u16,
}

#[account]
#[derive(InitSpace)]
pub struct Order {
    pub seller: Pubkey,
    pub buyer: Pubkey,
    pub amount: u64,
    pub filled_amount: u64,
    pub price_per_kwh: u64,
    pub order_type: OrderType,
    pub status: OrderStatus,
    pub created_at: i64,
    pub expires_at: i64,
}

#[account]
#[derive(InitSpace)]
pub struct TradeRecord {
    pub sell_order: Pubkey,
    pub buy_order: Pubkey,
    pub seller: Pubkey,
    pub buyer: Pubkey,
    pub amount: u64,
    pub price_per_kwh: u64,
    pub total_value: u64,
    pub fee_amount: u64,
    pub executed_at: i64,
}

// Enums
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, InitSpace)]
pub enum OrderType {
    Sell,
    Buy,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, InitSpace)]
pub enum OrderStatus {
    Active,
    PartiallyFilled,
    Completed,
    Cancelled,
    Expired,
}

// Events
#[event]
pub struct MarketInitialized {
    pub authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct SellOrderCreated {
    pub seller: Pubkey,
    pub order_id: Pubkey,
    pub amount: u64,
    pub price_per_kwh: u64,
    pub timestamp: i64,
}

#[event]
pub struct BuyOrderCreated {
    pub buyer: Pubkey,
    pub order_id: Pubkey,
    pub amount: u64,
    pub price_per_kwh: u64,
    pub timestamp: i64,
}

#[event]
pub struct OrderMatched {
    pub sell_order: Pubkey,
    pub buy_order: Pubkey,
    pub seller: Pubkey,
    pub buyer: Pubkey,
    pub amount: u64,
    pub price: u64,
    pub total_value: u64,
    pub fee_amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct OrderCancelled {
    pub order_id: Pubkey,
    pub user: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct MarketParamsUpdated {
    pub authority: Pubkey,
    pub market_fee_bps: u16,
    pub clearing_enabled: bool,
    pub timestamp: i64,
}

// Errors
#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized authority")]
    UnauthorizedAuthority,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Invalid price")]
    InvalidPrice,
    #[msg("Inactive sell order")]
    InactiveSellOrder,
    #[msg("Inactive buy order")]
    InactiveBuyOrder,
    #[msg("Price mismatch")]
    PriceMismatch,
    #[msg("Order not cancellable")]
    OrderNotCancellable,
    #[msg("Insufficient escrow balance")]
    InsufficientEscrowBalance,
    #[msg("Invalid ERC certificate status")]
    InvalidErcCertificate,
    #[msg("ERC certificate has expired")]
    ErcCertificateExpired,
    #[msg("ERC certificate not validated for trading")]
    ErcNotValidatedForTrading,
    #[msg("Order amount exceeds available ERC certificate amount")]
    ExceedsErcAmount,
}