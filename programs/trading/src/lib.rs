use anchor_lang::prelude::*;

pub mod error;
pub mod events;
pub mod state;

// Re-export core types for submodules
pub use crate::error::TradingError;
pub use crate::state::{Market, Order, TradeRecord, OrderType, OrderStatus, PriceLevel, PricePoint, BatchConfig, BatchInfo};
pub use ::governance::{ErcCertificate, ErcStatus, PoAConfig};

declare_id!("3LXbBJ7sWYYrveHvLoLtwuVYbYd27HPcbpF1DQ8rK1Bo");

#[program]
pub mod trading {
    use super::*;

    pub fn initialize_program(_ctx: Context<InitializeProgram>) -> Result<()> {
        msg!("Program Initialized");
        Ok(())
    }

    pub fn initialize_market(ctx: Context<InitializeMarketContext>) -> Result<()> {
        let mut market = ctx.accounts.market.load_init()?;
        market.authority = ctx.accounts.authority.key();
        market.active_orders = 0;
        market.total_volume = 0;
        market.total_trades = 0;
        market.created_at = Clock::get()?.unix_timestamp;
        market.clearing_enabled = 1;
        market.market_fee_bps = 25;

        market.batch_config = BatchConfig {
            enabled: 0,
            _padding1: [0; 3],
            max_batch_size: 100,
            batch_timeout_seconds: 300,
            min_batch_size: 5,
            price_improvement_threshold: 5,
            _padding2: [0; 6],
        };

        market.buy_side_depth = [PriceLevel::default(); 20];
        market.sell_side_depth = [PriceLevel::default(); 20];
        market.buy_side_depth_count = 0;
        market.sell_side_depth_count = 0;

        market.last_clearing_price = 0;
        market.price_history = [PricePoint::default(); 24];
        market.price_history_count = 0;
        market.volume_weighted_price = 0;

        emit!(crate::events::MarketInitialized {
            authority: ctx.accounts.authority.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }

    pub fn create_sell_order(
        ctx: Context<CreateSellOrderContext>,
        order_id_val: u64,
        energy_amount: u64,
        price_per_kwh: u64,
    ) -> Result<()> {
        require!(ctx.accounts.governance_config.is_operational(), TradingError::MaintenanceMode);
        require!(energy_amount > 0, TradingError::InvalidAmount);
        require!(price_per_kwh > 0, TradingError::InvalidPrice);

        if let Some(erc) = &ctx.accounts.erc_certificate {
            let clock = Clock::get()?;
            require!(erc.status == ErcStatus::Valid, TradingError::InvalidErcCertificate);
            if let Some(expires_at) = erc.expires_at {
                require!(clock.unix_timestamp < expires_at, TradingError::ErcExpired);
            }
            require!(erc.validated_for_trading, TradingError::NotValidatedForTrading);
            require!(energy_amount <= erc.energy_amount, TradingError::ExceedsErcAmount);
        }

        let mut market = ctx.accounts.market.load_mut()?;
        let mut order = ctx.accounts.order.load_init()?;
        let clock = Clock::get()?;

        order.seller = ctx.accounts.authority.key();
        order.buyer = Pubkey::default();
        order.order_id = order_id_val;
        order.amount = energy_amount;
        order.filled_amount = 0;
        order.price_per_kwh = price_per_kwh;
        order.order_type = OrderType::Sell as u8;
        order.status = OrderStatus::Active as u8;
        order.created_at = clock.unix_timestamp;
        order.expires_at = clock.unix_timestamp + 86400;

        market.active_orders += 1;
        emit!(crate::events::SellOrderCreated {
            seller: ctx.accounts.authority.key(),
            order_id: ctx.accounts.order.key(),
            amount: energy_amount,
            price_per_kwh,
            timestamp: clock.unix_timestamp,
        });
        Ok(())
    }

    pub fn create_buy_order(
        ctx: Context<CreateBuyOrderContext>,
        order_id_val: u64,
        energy_amount: u64,
        max_price_per_kwh: u64,
    ) -> Result<()> {
        require!(ctx.accounts.governance_config.is_operational(), TradingError::MaintenanceMode);
        require!(energy_amount > 0, TradingError::InvalidAmount);
        require!(max_price_per_kwh > 0, TradingError::InvalidPrice);

        let mut market = ctx.accounts.market.load_mut()?;
        let mut order = ctx.accounts.order.load_init()?;
        let clock = Clock::get()?;

        order.buyer = ctx.accounts.authority.key();
        order.seller = Pubkey::default();
        order.order_id = order_id_val;
        order.amount = energy_amount;
        order.filled_amount = 0;
        order.price_per_kwh = max_price_per_kwh;
        order.order_type = OrderType::Buy as u8;
        order.status = OrderStatus::Active as u8;
        order.created_at = clock.unix_timestamp;
        order.expires_at = clock.unix_timestamp + 86400;

        market.active_orders += 1;
        emit!(crate::events::BuyOrderCreated {
            buyer: ctx.accounts.authority.key(),
            order_id: ctx.accounts.order.key(),
            amount: energy_amount,
            price_per_kwh: max_price_per_kwh,
            timestamp: clock.unix_timestamp,
        });
        Ok(())
    }

    pub fn match_orders(ctx: Context<MatchOrdersContext>, match_amount: u64) -> Result<()> {
        require!(ctx.accounts.governance_config.is_operational(), TradingError::MaintenanceMode);
        require!(match_amount > 0, TradingError::InvalidAmount);

        let mut market = ctx.accounts.market.load_mut()?;
        let mut buy_order = ctx.accounts.buy_order.load_mut()?;
        let mut sell_order = ctx.accounts.sell_order.load_mut()?;
        let trade_record = &mut ctx.accounts.trade_record;
        let clock = Clock::get()?;

        require!(buy_order.status == OrderStatus::Active as u8 || buy_order.status == OrderStatus::PartiallyFilled as u8, TradingError::InactiveBuyOrder);
        require!(sell_order.status == OrderStatus::Active as u8 || sell_order.status == OrderStatus::PartiallyFilled as u8, TradingError::InactiveSellOrder);
        require!(buy_order.price_per_kwh >= sell_order.price_per_kwh, TradingError::PriceMismatch);

        let buy_remaining = buy_order.amount.saturating_sub(buy_order.filled_amount);
        let sell_remaining = sell_order.amount.saturating_sub(sell_order.filled_amount);
        let actual_match_amount = match_amount.min(buy_remaining).min(sell_remaining);

        let clearing_price = sell_order.price_per_kwh;
        let total_value = actual_match_amount.saturating_mul(clearing_price);
        let fee_amount = total_value.checked_mul(market.market_fee_bps as u64).map(|v| v / 10000).unwrap_or(0);

        buy_order.filled_amount += actual_match_amount;
        sell_order.filled_amount += actual_match_amount;

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

        trade_record.buy_order = ctx.accounts.buy_order.key();
        trade_record.sell_order = ctx.accounts.sell_order.key();
        trade_record.buyer = buy_order.buyer;
        trade_record.seller = sell_order.seller;
        trade_record.amount = actual_match_amount;
        trade_record.price_per_kwh = clearing_price;
        trade_record.total_value = total_value;
        trade_record.fee_amount = fee_amount;
        trade_record.executed_at = clock.unix_timestamp;

        market.total_volume += actual_match_amount;
        market.total_trades += 1;
        market.last_clearing_price = clearing_price;

        emit!(crate::events::OrderMatched {
            buy_order: ctx.accounts.buy_order.key(),
            sell_order: ctx.accounts.sell_order.key(),
            buyer: buy_order.buyer,
            seller: sell_order.seller,
            amount: actual_match_amount,
            price: clearing_price,
            total_value,
            fee_amount,
            timestamp: clock.unix_timestamp,
        });
        Ok(())
    }

    pub fn cancel_order(ctx: Context<CancelOrderContext>) -> Result<()> {
        require!(ctx.accounts.governance_config.is_operational(), TradingError::MaintenanceMode);
        let mut market = ctx.accounts.market.load_mut()?;
        let mut order = ctx.accounts.order.load_mut()?;
        let clock = Clock::get()?;

        let order_owner = if order.order_type == OrderType::Buy as u8 {
            order.buyer
        } else {
            order.seller
        };
        require!(ctx.accounts.authority.key() == order_owner, TradingError::UnauthorizedAuthority);
        require!(order.status == OrderStatus::Active as u8 || order.status == OrderStatus::PartiallyFilled as u8, TradingError::OrderNotCancellable);

        order.status = OrderStatus::Cancelled as u8;
        market.active_orders = market.active_orders.saturating_sub(1);

        emit!(crate::events::OrderCancelled {
            order_id: ctx.accounts.order.key(),
            user: ctx.accounts.authority.key(),
            timestamp: clock.unix_timestamp,
        });
        Ok(())
    }

    pub fn execute_atomic_settlement(
        ctx: Context<ExecuteAtomicSettlementContext>,
        amount: u64,
        price: u64,
        wheeling_charge_val: u64,
        loss_cost_val: u64,
    ) -> Result<()> {
        require!(ctx.accounts.governance_config.is_operational(), TradingError::MaintenanceMode);
        let mut market = ctx.accounts.market.load_mut()?;
        let mut buy_order = ctx.accounts.buy_order.load_mut()?;
        let mut sell_order = ctx.accounts.sell_order.load_mut()?;
        let clock = Clock::get()?;

        require!(amount > 0, TradingError::InvalidAmount);
        let buy_rem = buy_order.amount.saturating_sub(buy_order.filled_amount);
        let sell_rem = sell_order.amount.saturating_sub(sell_order.filled_amount);
        require!(amount <= buy_rem && amount <= sell_rem, TradingError::InvalidAmount);

        let total_currency_value = amount.saturating_mul(price);
        let market_fee = total_currency_value.checked_mul(market.market_fee_bps as u64).map(|v| v / 10000).unwrap_or(0);
        let net_seller_amount = total_currency_value.saturating_sub(market_fee).saturating_sub(wheeling_charge_val).saturating_sub(loss_cost_val);

        // Currency transfers
        if market_fee > 0 {
            anchor_spl::token_interface::transfer_checked(
                CpiContext::new(ctx.accounts.token_program.to_account_info(), anchor_spl::token_interface::TransferChecked {
                    from: ctx.accounts.buyer_currency_escrow.to_account_info(),
                    mint: ctx.accounts.currency_mint.to_account_info(),
                    to: ctx.accounts.fee_collector.to_account_info(),
                    authority: ctx.accounts.escrow_authority.to_account_info(),
                }),
                market_fee,
                ctx.accounts.currency_mint.decimals
            )?;
        }

        if net_seller_amount > 0 {
            anchor_spl::token_interface::transfer_checked(
                CpiContext::new(ctx.accounts.token_program.to_account_info(), anchor_spl::token_interface::TransferChecked {
                    from: ctx.accounts.buyer_currency_escrow.to_account_info(),
                    mint: ctx.accounts.currency_mint.to_account_info(),
                    to: ctx.accounts.seller_currency_account.to_account_info(),
                    authority: ctx.accounts.escrow_authority.to_account_info(),
                }),
                net_seller_amount,
                ctx.accounts.currency_mint.decimals
            )?;
        }

        // Energy transfer
        anchor_spl::token_interface::transfer_checked(
            CpiContext::new(ctx.accounts.secondary_token_program.to_account_info(), anchor_spl::token_interface::TransferChecked {
                from: ctx.accounts.seller_energy_escrow.to_account_info(),
                mint: ctx.accounts.energy_mint.to_account_info(),
                to: ctx.accounts.buyer_energy_account.to_account_info(),
                authority: ctx.accounts.escrow_authority.to_account_info(),
            }),
            amount,
            ctx.accounts.energy_mint.decimals
        )?;

        // Update State
        buy_order.filled_amount += amount;
        sell_order.filled_amount += amount;
        if buy_order.filled_amount >= buy_order.amount { buy_order.status = OrderStatus::Completed as u8; }
        if sell_order.filled_amount >= sell_order.amount { sell_order.status = OrderStatus::Completed as u8; }
        market.total_volume += amount;
        market.total_trades += 1;

        emit!(crate::events::OrderMatched {
            sell_order: ctx.accounts.sell_order.key(),
            buy_order: ctx.accounts.buy_order.key(),
            seller: sell_order.seller,
            buyer: buy_order.buyer,
            amount,
            price,
            total_value: total_currency_value,
            fee_amount: market_fee,
            timestamp: clock.unix_timestamp,
        });
        Ok(())
    }

    pub fn update_market_params(ctx: Context<UpdateMarketParamsContext>, fee_bps: u16, clearing: bool) -> Result<()> {
        require!(ctx.accounts.governance_config.is_operational(), TradingError::MaintenanceMode);
        let mut market = ctx.accounts.market.load_mut()?;
        require!(ctx.accounts.authority.key() == market.authority, TradingError::UnauthorizedAuthority);
        market.market_fee_bps = fee_bps;
        market.clearing_enabled = if clearing { 1 } else { 0 };
        emit!(crate::events::MarketParamsUpdated {
            authority: ctx.accounts.authority.key(),
            market_fee_bps: fee_bps,
            clearing_enabled: clearing,
            timestamp: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }

    // ============================================
    // Local Context Structs
    // ============================================

    #[derive(Accounts)]
    pub struct InitializeProgram<'info> {
        #[account(mut)] pub authority: Signer<'info>,
    }

    #[derive(Accounts)]
    pub struct InitializeMarketContext<'info> {
        #[account(init, payer = authority, space = 8 + std::mem::size_of::<Market>(), seeds = [b"market"], bump)]
        pub market: AccountLoader<'info, Market>,
        #[account(mut)] pub authority: Signer<'info>,
        pub system_program: Program<'info, System>,
    }

    #[derive(Accounts)]
    #[instruction(order_id_val: u64)]
    pub struct CreateSellOrderContext<'info> {
        #[account(mut)] pub market: AccountLoader<'info, Market>,
        #[account(init, payer = authority, space = 8 + std::mem::size_of::<Order>(), seeds = [b"order", authority.key().as_ref(), &order_id_val.to_le_bytes()], bump)]
        pub order: AccountLoader<'info, Order>,
        pub erc_certificate: Option<Box<Account<'info, ErcCertificate>>>,
        #[account(mut)] pub authority: Signer<'info>,
        pub system_program: Program<'info, System>,
        pub governance_config: Account<'info, PoAConfig>,
    }

    #[derive(Accounts)]
    #[instruction(order_id_val: u64)]
    pub struct CreateBuyOrderContext<'info> {
        #[account(mut)] pub market: AccountLoader<'info, Market>,
        #[account(init, payer = authority, space = 8 + std::mem::size_of::<Order>(), seeds = [b"order", authority.key().as_ref(), &order_id_val.to_le_bytes()], bump)]
        pub order: AccountLoader<'info, Order>,
        #[account(mut)] pub authority: Signer<'info>,
        pub system_program: Program<'info, System>,
        pub governance_config: Account<'info, PoAConfig>,
    }

    #[derive(Accounts)]
    pub struct MatchOrdersContext<'info> {
        #[account(mut)] pub market: AccountLoader<'info, Market>,
        #[account(mut)] pub buy_order: AccountLoader<'info, Order>,
        #[account(mut)] pub sell_order: AccountLoader<'info, Order>,
        #[account(init, payer = authority, space = 8 + TradeRecord::INIT_SPACE, seeds = [b"trade", buy_order.key().as_ref(), sell_order.key().as_ref()], bump)]
        pub trade_record: Account<'info, TradeRecord>,
        #[account(mut)] pub authority: Signer<'info>,
        pub system_program: Program<'info, System>,
        pub governance_config: Account<'info, PoAConfig>,
    }

    #[derive(Accounts)]
    pub struct CancelOrderContext<'info> {
        #[account(mut)] pub market: AccountLoader<'info, Market>,
        #[account(mut)] pub order: AccountLoader<'info, Order>,
        #[account(mut)] pub authority: Signer<'info>,
        pub governance_config: Account<'info, PoAConfig>,
    }

    #[derive(Accounts)]
    pub struct ExecuteAtomicSettlementContext<'info> {
        #[account(mut)] pub market: AccountLoader<'info, Market>,
        #[account(mut)] pub buy_order: AccountLoader<'info, Order>,
        #[account(mut)] pub sell_order: AccountLoader<'info, Order>,
        /// CHECK: Buyer's token account for currency (Escrow)
        #[account(mut)] pub buyer_currency_escrow: AccountInfo<'info>,
        /// CHECK: Seller's token account for energy (Escrow)
        #[account(mut)] pub seller_energy_escrow: AccountInfo<'info>,
        /// CHECK: Seller's token account for currency (receiver)
        #[account(mut)] pub seller_currency_account: AccountInfo<'info>,
        /// CHECK: Buyer's token account for energy (receiver)
        #[account(mut)] pub buyer_energy_account: AccountInfo<'info>,
        /// CHECK: Fee collector account
        #[account(mut)] pub fee_collector: AccountInfo<'info>,
        /// CHECK: Wheeling charge collector account
        #[account(mut)] pub wheeling_collector: AccountInfo<'info>,
        /// CHECK: Loss cost collector account
        #[account(mut)] pub loss_collector: AccountInfo<'info>,
        pub energy_mint: InterfaceAccount<'info, anchor_spl::token_interface::Mint>,
        pub currency_mint: InterfaceAccount<'info, anchor_spl::token_interface::Mint>,
        pub escrow_authority: Signer<'info>,
        pub market_authority: Signer<'info>,
        pub token_program: Interface<'info, anchor_spl::token_interface::TokenInterface>,
        pub system_program: Program<'info, System>,
        pub secondary_token_program: Interface<'info, anchor_spl::token_interface::TokenInterface>,
        pub governance_config: Account<'info, PoAConfig>,
    }

    #[derive(Accounts)]
    pub struct UpdateMarketParamsContext<'info> {
        #[account(mut, has_one = authority)] pub market: AccountLoader<'info, Market>,
        pub authority: Signer<'info>,
        pub governance_config: Account<'info, PoAConfig>,
    }
}
