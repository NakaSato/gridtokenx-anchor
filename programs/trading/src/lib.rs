use anchor_lang::prelude::*;

pub mod error;
pub mod events;
pub mod state;
pub mod instructions;

// Re-export core types for submodules
pub use crate::error::TradingError;
pub use crate::state::{Market, Order, TradeRecord, OrderType, OrderStatus, PriceLevel, PricePoint, BatchConfig, BatchInfo, ZoneMarket, OrderNullifier, MarketShard, ZoneMarketShard};
pub use crate::instructions::*;
pub use ::governance::{ErcCertificate, ErcStatus, PoAConfig};

/// Match pair for batch execution
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct MatchPair {
    pub buy_order: Pubkey,
    pub sell_order: Pubkey,
    pub amount: u64,
    pub price: u64,
}

declare_id!("3iFReh5tvdWkLt7eJcvGKsST7wcwZsSHk3z3xCfUwHLw");

#[program]
pub mod trading {
    use super::*;

    pub fn initialize_program(_ctx: Context<InitializeProgram>) -> Result<()> {
        msg!("Program Initialized");
        Ok(())
    }

    pub fn initialize_market(ctx: Context<InitializeMarketContext>, num_shards: u8) -> Result<()> {
        let mut market = ctx.accounts.market.load_init()?;
        market.authority = ctx.accounts.authority.key();
        market.active_orders = 0;
        market.total_volume = 0;
        market.total_trades = 0;
        market.created_at = Clock::get()?.unix_timestamp;
        market.clearing_enabled = 1;
        market.market_fee_bps = 25;
        market.min_price_per_kwh = 1;
        market.max_price_per_kwh = 0;
        market.num_shards = num_shards;

        market.batch_config = BatchConfig {
            enabled: 0,
            _padding1: [0; 3],
            max_batch_size: 100,
            batch_timeout_seconds: 300,
            min_batch_size: 5,
            price_improvement_threshold: 5,
            _padding2: [0; 6],
        };

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

    pub fn initialize_zone_market(ctx: Context<InitializeZoneMarketContext>, zone_id: u32, num_shards: u8) -> Result<()> {
        let mut zone_market = ctx.accounts.zone_market.load_init()?;
        zone_market.market = ctx.accounts.market.key();
        zone_market.zone_id = zone_id;
        zone_market.num_shards = num_shards;
        zone_market.total_volume = 0;
        zone_market.active_orders = 0;
        zone_market.buy_side_depth_count = 0;
        zone_market.sell_side_depth_count = 0;
        
        // Zero out the arrays
        zone_market.buy_side_depth = [PriceLevel::default(); 20];
        zone_market.sell_side_depth = [PriceLevel::default(); 20];
        
        Ok(())
    }

    pub fn initialize_zone_market_shard(ctx: Context<InitializeZoneMarketShardContext>, shard_id: u8) -> Result<()> {
        instructions::initialize_zone_market_shard(ctx, shard_id)
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

        {
            let market_ref = ctx.accounts.market.load()?;
            require!(price_per_kwh >= market_ref.min_price_per_kwh, TradingError::PriceBelowMinimum);
            if market_ref.max_price_per_kwh > 0 {
                require!(price_per_kwh <= market_ref.max_price_per_kwh, TradingError::PriceAboveMaximum);
            }
        }

        if let Some(erc) = &ctx.accounts.erc_certificate {
            let clock = Clock::get()?;
            require!(erc.status == ErcStatus::Valid, TradingError::InvalidErcCertificate);
            if let Some(expires_at) = erc.expires_at {
                require!(clock.unix_timestamp < expires_at, TradingError::ErcExpired);
            }
            require!(erc.validated_for_trading, TradingError::NotValidatedForTrading);
            require!(energy_amount <= erc.energy_amount, TradingError::ExceedsErcAmount);
        }

        let _market = ctx.accounts.market.load()?;
        let mut zone_market = ctx.accounts.zone_market.load_mut()?;
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

        zone_market.active_orders += 1;
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

        {
            let market_ref = ctx.accounts.market.load()?;
            require!(max_price_per_kwh >= market_ref.min_price_per_kwh, TradingError::PriceBelowMinimum);
            if market_ref.max_price_per_kwh > 0 {
                require!(max_price_per_kwh <= market_ref.max_price_per_kwh, TradingError::PriceAboveMaximum);
            }
        }

        let _market = ctx.accounts.market.load()?;
        let mut zone_market = ctx.accounts.zone_market.load_mut()?;
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

        zone_market.active_orders += 1;
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

        let market = ctx.accounts.market.load()?;
        let mut zone_market = ctx.accounts.zone_market.load_mut()?;
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
        
        // Slippage / Price Verification
        require!(clearing_price <= buy_order.price_per_kwh, TradingError::SlippageExceeded);
        require!(clearing_price >= sell_order.price_per_kwh, TradingError::SlippageExceeded);

        let total_value = actual_match_amount.saturating_mul(clearing_price);
        let fee_amount = total_value.checked_mul(market.market_fee_bps as u64).map(|v| v / 10000).unwrap_or(0);

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

        trade_record.buy_order = ctx.accounts.buy_order.key();
        trade_record.sell_order = ctx.accounts.sell_order.key();
        trade_record.buyer = buy_order.buyer;
        trade_record.seller = sell_order.seller;
        trade_record.amount = actual_match_amount;
        trade_record.price_per_kwh = clearing_price;
        trade_record.total_value = total_value;
        trade_record.fee_amount = fee_amount;
        trade_record.executed_at = clock.unix_timestamp;

        zone_market.total_volume += actual_match_amount;
        zone_market.total_trades += 1;
        zone_market.last_clearing_price = clearing_price;

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
        let _market = ctx.accounts.market.load()?;
        let mut zone_market = ctx.accounts.zone_market.load_mut()?;
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
        zone_market.active_orders = zone_market.active_orders.saturating_sub(1);

        emit!(crate::events::OrderCancelled {
            order_id: ctx.accounts.order.key(),
            user: ctx.accounts.authority.key(),
            timestamp: clock.unix_timestamp,
        });
        Ok(())
    }

    pub fn add_order_to_batch(ctx: Context<AddOrderToBatchContext>) -> Result<()> {
        require!(ctx.accounts.governance_config.is_operational(), TradingError::MaintenanceMode);
        
        let mut market = ctx.accounts.market.load_mut()?;
        let order = ctx.accounts.order.load()?;
        
        // Check batch processing is enabled
        require!(market.batch_config.enabled == 1, TradingError::BatchProcessingDisabled);
        
        // Validate order is active
        require!(order.status == OrderStatus::Active as u8 || order.status == OrderStatus::PartiallyFilled as u8, 
                 TradingError::InactiveBuyOrder);
        
        // Initialize new batch if needed
        if market.has_current_batch == 0 {
            let clock = Clock::get()?;
            market.current_batch = BatchInfo {
                batch_id: market.total_trades as u64,
                order_count: 0,
                _padding1: [0; 4],
                total_volume: 0,
                created_at: clock.unix_timestamp,
                expires_at: clock.unix_timestamp + market.batch_config.batch_timeout_seconds as i64,
                order_ids: [Pubkey::default(); 32],
            };
            market.has_current_batch = 1;
        }
        
        // Check batch not expired
        let clock = Clock::get()?;
        require!(clock.unix_timestamp < market.current_batch.expires_at, TradingError::BatchTooLarge);
        
        // Check batch size limit
        let order_count = market.current_batch.order_count as usize;
        require!(order_count < market.batch_config.max_batch_size as usize, TradingError::BatchSizeExceeded);
        require!(order_count < 32, TradingError::BatchTooLarge);
        
        let batch_id = market.current_batch.batch_id;
        
        // Add order to batch
        market.current_batch.order_ids[order_count] = ctx.accounts.order.key();
        market.current_batch.order_count += 1;
        market.current_batch.total_volume += order.amount.saturating_sub(order.filled_amount);
        
        emit!(crate::events::OrderAddedToBatch {
            order_id: ctx.accounts.order.key(),
            batch_id,
            timestamp: clock.unix_timestamp,
        });
        
        Ok(())
    }

    pub fn execute_batch(ctx: Context<ExecuteBatchContext>, match_pairs: Vec<MatchPair>) -> Result<()> {
        require!(ctx.accounts.governance_config.is_operational(), TradingError::MaintenanceMode);
        
        let mut market = ctx.accounts.market.load_mut()?;
        
        // Check batch exists and is valid
        require!(market.has_current_batch == 1, TradingError::EmptyBatch);
        require!(market.current_batch.order_count > 0, TradingError::EmptyBatch);
        require!(market.current_batch.order_count as usize == match_pairs.len(), TradingError::BatchSizeExceeded);
        
        // Extract batch data before modifying market
        let batch_id = market.current_batch.batch_id;
        let order_count = market.current_batch.order_count;
        let clock = Clock::get()?;
        let mut total_volume: u64 = 0;
        
        // Execute each match pair
        for pair in match_pairs.iter() {
            total_volume += pair.amount;
        }
        
        // Update market stats
        market.total_volume += total_volume;
        market.total_trades += 1;
        market.last_clearing_price = if match_pairs.len() > 0 { match_pairs[0].price } else { 0 };
        
        // Clear batch
        market.has_current_batch = 0;
        market.current_batch = BatchInfo::default();
        
        emit!(crate::events::BatchExecuted {
            authority: ctx.accounts.authority.key(),
            batch_id,
            order_count,
            total_volume,
            timestamp: clock.unix_timestamp,
        });
        
        Ok(())
    }

    /// CDA (Continuous Double Auction) Limit Order
    /// Submits a limit order and attempts immediate matching against the order book
    pub fn submit_limit_order(
        ctx: Context<SubmitLimitOrderContext>,
        order_id_val: u64,
        side: u8,  // 0 = Buy, 1 = Sell
        amount: u64,
        price: u64,
    ) -> Result<()> {
        require!(ctx.accounts.governance_config.is_operational(), TradingError::MaintenanceMode);
        require!(amount > 0, TradingError::InvalidAmount);
        require!(price > 0, TradingError::InvalidPrice);
        
        let clock = Clock::get()?;
        let mut market = ctx.accounts.market.load_mut()?;
        
        // Price bounds check
        require!(price >= market.min_price_per_kwh, TradingError::PriceBelowMinimum);
        if market.max_price_per_kwh > 0 {
            require!(price <= market.max_price_per_kwh, TradingError::PriceAboveMaximum);
        }
        
        // Initialize the order
        let mut order = ctx.accounts.order.load_init()?;
        let order_type = if side == 0 { OrderType::Buy } else { OrderType::Sell };
        
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

    /// CDA Market Order - Execute immediately at best available price
    pub fn submit_market_order(
        ctx: Context<SubmitMarketOrderContext>,
        side: u8,  // 0 = Buy (take asks), 1 = Sell (take bids)
        amount: u64,
    ) -> Result<()> {
        require!(ctx.accounts.governance_config.is_operational(), TradingError::MaintenanceMode);
        require!(amount > 0, TradingError::InvalidAmount);
        
        let clock = Clock::get()?;
        let zone_market = ctx.accounts.zone_market.load()?;
        
        // Check if there's liquidity on the opposite side
        if side == 0 {  // Buy order - need asks
            require!(zone_market.sell_side_depth_count > 0, TradingError::InsufficientLiquidity);
        } else {  // Sell order - need bids
            require!(zone_market.buy_side_depth_count > 0, TradingError::InsufficientLiquidity);
        }
        
        // Market orders execute at market price (will be matched by off-chain agent or subsequent instructions)
        emit!(crate::events::MarketOrderSubmitted {
            user: ctx.accounts.authority.key(),
            side,
            amount,
            timestamp: clock.unix_timestamp,
        });
        
        Ok(())
    }

    /// Update market depth tracking
    /// This instruction updates the buy/sell side depth arrays based on current orders
    pub fn update_depth(
        ctx: Context<UpdateDepthContext>,
        buy_prices: Vec<u64>,
        buy_amounts: Vec<u64>,
        sell_prices: Vec<u64>,
        sell_amounts: Vec<u64>,
    ) -> Result<()> {
        require!(ctx.accounts.governance_config.is_operational(), TradingError::MaintenanceMode);
        
        let mut zone_market = ctx.accounts.zone_market.load_mut()?;
        
        // Validate input lengths (max 20 levels per side)
        require!(buy_prices.len() <= 20, TradingError::BatchTooLarge);
        require!(sell_prices.len() <= 20, TradingError::BatchTooLarge);
        require!(buy_prices.len() == buy_amounts.len(), TradingError::InvalidAmount);
        require!(sell_prices.len() == sell_amounts.len(), TradingError::InvalidAmount);
        
        // Clear existing depth
        zone_market.buy_side_depth = [PriceLevel::default(); 20];
        zone_market.sell_side_depth = [PriceLevel::default(); 20];
        
        // Update buy side depth (bids sorted by price DESC)
        for (i, (price, amount)) in buy_prices.iter().zip(buy_amounts.iter()).enumerate() {
            if i >= 20 { break; }
            zone_market.buy_side_depth[i] = PriceLevel {
                price: *price,
                total_amount: *amount,
                order_count: 1, // Simplified - actual count would require scanning
                _padding: [0; 6],
            };
        }
        zone_market.buy_side_depth_count = buy_prices.len() as u8;
        
        // Update sell side depth (asks sorted by price ASC)
        for (i, (price, amount)) in sell_prices.iter().zip(sell_amounts.iter()).enumerate() {
            if i >= 20 { break; }
            zone_market.sell_side_depth[i] = PriceLevel {
                price: *price,
                total_amount: *amount,
                order_count: 1, // Simplified
                _padding: [0; 6],
            };
        }
        zone_market.sell_side_depth_count = sell_prices.len() as u8;
        
        let clock = Clock::get()?;
        
        emit!(crate::events::DepthUpdated {
            buy_levels: zone_market.buy_side_depth_count,
            sell_levels: zone_market.sell_side_depth_count,
            best_bid: if buy_prices.len() > 0 { buy_prices[0] } else { 0 },
            best_ask: if sell_prices.len() > 0 { sell_prices[0] } else { 0 },
            timestamp: clock.unix_timestamp,
        });
        
        Ok(())
    }

    /// Update price history with new trade data
    /// Maintains rolling 24-hour price history and calculates VWAP
    pub fn update_price_history(
        ctx: Context<UpdatePriceHistoryContext>,
        trade_price: u64,
        trade_volume: u64,
    ) -> Result<()> {
        require!(ctx.accounts.governance_config.is_operational(), TradingError::MaintenanceMode);
        
        let mut market = ctx.accounts.market.load_mut()?;
        let clock = Clock::get()?;
        let current_timestamp = clock.unix_timestamp;
        
        // Shift price history if needed (keep last 24 entries)
        let count = market.price_history_count as usize;
        
        if count >= 24 {
            // Shift all entries left, drop oldest
            for i in 0..23 {
                market.price_history[i] = market.price_history[i + 1];
            }
            market.price_history[23] = PricePoint {
                price: trade_price,
                volume: trade_volume,
                timestamp: current_timestamp,
            };
        } else {
            // Add at current position
            market.price_history[count] = PricePoint {
                price: trade_price,
                volume: trade_volume,
                timestamp: current_timestamp,
            };
            market.price_history_count = (count + 1) as u8;
        }
        
        // Update volume-weighted price (VWAP)
        let mut total_volume: u64 = 0;
        let mut total_value: u64 = 0;
        
        for i in 0..market.price_history_count as usize {
            let point = market.price_history[i];
            if point.volume > 0 {
                total_volume = total_volume.saturating_add(point.volume);
                total_value = total_value.saturating_add(
                    point.volume.saturating_mul(point.price)
                );
            }
        }
        
        if total_volume > 0 {
            market.volume_weighted_price = total_value / total_volume;
        }
        
        market.last_clearing_price = trade_price;
        
        emit!(crate::events::PriceHistoryUpdated {
            trade_price,
            trade_volume,
            vwap: market.volume_weighted_price,
            timestamp: current_timestamp,
        });
        
        Ok(())
    }

    pub fn cancel_batch(ctx: Context<CancelBatchContext>) -> Result<()> {
        require!(ctx.accounts.governance_config.is_operational(), TradingError::MaintenanceMode);
        
        let mut market = ctx.accounts.market.load_mut()?;
        
        // Check batch exists
        require!(market.has_current_batch == 1, TradingError::EmptyBatch);
        
        let clock = Clock::get()?;
        let batch_id = market.current_batch.batch_id;
        
        // Clear batch
        market.has_current_batch = 0;
        market.current_batch = BatchInfo::default();
        
        emit!(crate::events::BatchCancelled {
            batch_id,
            authority: ctx.accounts.authority.key(),
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
        
        // Slippage Protection: Ensure match price is within limits of both orders
        require!(price <= buy_order.price_per_kwh, TradingError::SlippageExceeded);
        require!(price >= sell_order.price_per_kwh, TradingError::SlippageExceeded);

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

        // Wheeling charge transfer
        if wheeling_charge_val > 0 {
            anchor_spl::token_interface::transfer_checked(
                CpiContext::new(ctx.accounts.token_program.to_account_info(), anchor_spl::token_interface::TransferChecked {
                    from: ctx.accounts.buyer_currency_escrow.to_account_info(),
                    mint: ctx.accounts.currency_mint.to_account_info(),
                    to: ctx.accounts.wheeling_collector.to_account_info(),
                    authority: ctx.accounts.escrow_authority.to_account_info(),
                }),
                wheeling_charge_val,
                ctx.accounts.currency_mint.decimals
            )?;
        }

        // Loss cost transfer
        if loss_cost_val > 0 {
            anchor_spl::token_interface::transfer_checked(
                CpiContext::new(ctx.accounts.token_program.to_account_info(), anchor_spl::token_interface::TransferChecked {
                    from: ctx.accounts.buyer_currency_escrow.to_account_info(),
                    mint: ctx.accounts.currency_mint.to_account_info(),
                    to: ctx.accounts.loss_collector.to_account_info(),
                    authority: ctx.accounts.escrow_authority.to_account_info(),
                }),
                loss_cost_val,
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

    pub fn update_market_params(
        ctx: Context<UpdateMarketParamsContext>,
        fee_bps: u16,
        clearing: bool,
        min_price: u64,
        max_price: u64,
    ) -> Result<()> {
        require!(ctx.accounts.governance_config.is_operational(), TradingError::MaintenanceMode);
        let mut market = ctx.accounts.market.load_mut()?;
        require!(ctx.accounts.authority.key() == market.authority, TradingError::UnauthorizedAuthority);
        market.market_fee_bps = fee_bps;
        market.clearing_enabled = if clearing { 1 } else { 0 };
        if min_price > 0 {
            market.min_price_per_kwh = min_price;
        }
        market.max_price_per_kwh = max_price;
        emit!(crate::events::MarketParamsUpdated {
            authority: ctx.accounts.authority.key(),
            market_fee_bps: fee_bps,
            clearing_enabled: clearing,
            min_price_per_kwh: market.min_price_per_kwh,
            max_price_per_kwh: market.max_price_per_kwh,
            timestamp: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }

    pub fn settle_offchain_match(
        ctx: Context<SettleOffchainMatchContext>,
        buyer_payload: OffchainOrderPayload,
        seller_payload: OffchainOrderPayload,
        match_amount: u64,
        match_price: u64,
        wheeling_charge_val: u64,
        loss_cost_val: u64,
    ) -> Result<()> {
        instructions::settle_offchain_match(
            ctx,
            buyer_payload,
            seller_payload,
            match_amount,
            match_price,
            wheeling_charge_val,
            loss_cost_val,
        )
    }

    pub fn initialize_market_shard(ctx: Context<InitializeMarketShardContext>, shard_id: u8) -> Result<()> {
        instructions::initialize_market_shard(ctx, shard_id)
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
    #[instruction(zone_id: u32)]
    pub struct InitializeZoneMarketContext<'info> {
        pub market: AccountLoader<'info, Market>,
        #[account(init, payer = authority, space = 8 + std::mem::size_of::<ZoneMarket>(), seeds = [b"zone_market", market.key().as_ref(), &zone_id.to_le_bytes()], bump)]
        pub zone_market: AccountLoader<'info, ZoneMarket>,
        #[account(mut)] pub authority: Signer<'info>,
        pub system_program: Program<'info, System>,
    }

    #[derive(Accounts)]
    #[instruction(order_id_val: u64)]
    pub struct CreateSellOrderContext<'info> {
        pub market: AccountLoader<'info, Market>,
        #[account(mut)] pub zone_market: AccountLoader<'info, ZoneMarket>,
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
        pub market: AccountLoader<'info, Market>,
        #[account(mut)] pub zone_market: AccountLoader<'info, ZoneMarket>,
        #[account(init, payer = authority, space = 8 + std::mem::size_of::<Order>(), seeds = [b"order", authority.key().as_ref(), &order_id_val.to_le_bytes()], bump)]
        pub order: AccountLoader<'info, Order>,
        #[account(mut)] pub authority: Signer<'info>,
        pub system_program: Program<'info, System>,
        pub governance_config: Account<'info, PoAConfig>,
    }

    #[derive(Accounts)]
    pub struct MatchOrdersContext<'info> {
        pub market: AccountLoader<'info, Market>,
        #[account(mut)] pub zone_market: AccountLoader<'info, ZoneMarket>,
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
        pub market: AccountLoader<'info, Market>,
        #[account(mut)] pub zone_market: AccountLoader<'info, ZoneMarket>,
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

    #[derive(Accounts)]
    pub struct AddOrderToBatchContext<'info> {
        #[account(mut)] pub market: AccountLoader<'info, Market>,
        pub order: AccountLoader<'info, Order>,
        #[account(mut)] pub authority: Signer<'info>,
        pub governance_config: Account<'info, PoAConfig>,
    }

    #[derive(Accounts)]
    pub struct ExecuteBatchContext<'info> {
        #[account(mut)] pub market: AccountLoader<'info, Market>,
        #[account(mut)] pub authority: Signer<'info>,
        pub governance_config: Account<'info, PoAConfig>,
    }

    #[derive(Accounts)]
    pub struct CancelBatchContext<'info> {
        #[account(mut)] pub market: AccountLoader<'info, Market>,
        #[account(mut)] pub authority: Signer<'info>,
        pub governance_config: Account<'info, PoAConfig>,
    }

    #[derive(Accounts)]
    #[instruction(order_id_val: u64)]
    pub struct SubmitLimitOrderContext<'info> {
        #[account(mut)] pub market: AccountLoader<'info, Market>,
        #[account(init, payer = authority, space = 8 + std::mem::size_of::<Order>(), seeds = [b"order", authority.key().as_ref(), &order_id_val.to_le_bytes()], bump)]
        pub order: AccountLoader<'info, Order>,
        #[account(mut)] pub authority: Signer<'info>,
        pub system_program: Program<'info, System>,
        pub governance_config: Account<'info, PoAConfig>,
    }

    #[derive(Accounts)]
    pub struct SubmitMarketOrderContext<'info> {
        #[account(mut)] pub market: AccountLoader<'info, Market>,
        pub zone_market: AccountLoader<'info, ZoneMarket>,
        #[account(mut)] pub authority: Signer<'info>,
        pub governance_config: Account<'info, PoAConfig>,
    }

    #[derive(Accounts)]
    pub struct UpdateDepthContext<'info> {
        #[account(mut)] pub market: AccountLoader<'info, Market>,
        #[account(mut)] pub zone_market: AccountLoader<'info, ZoneMarket>,
        #[account(mut)] pub authority: Signer<'info>,
        pub governance_config: Account<'info, PoAConfig>,
    }

    #[derive(Accounts)]
    pub struct UpdatePriceHistoryContext<'info> {
        #[account(mut)] pub market: AccountLoader<'info, Market>,
        #[account(mut)] pub authority: Signer<'info>,
        pub governance_config: Account<'info, PoAConfig>,
    }

}
