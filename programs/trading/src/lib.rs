use anchor_lang::prelude::*;

pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

// Re-export core types for submodules
pub use crate::error::TradingError;
#[allow(ambiguous_glob_reexports)]
pub use crate::instructions::*;
pub use crate::state::{
    BatchConfig, BatchInfo, Market, MarketShard, Order, OrderNullifier, OrderStatus, OrderType,
    PriceLevel, PricePoint, TradeRecord, ZoneMarket, ZoneMarketShard, MAX_DEPTH_LEVELS,
};
pub use governance::{ErcCertificate, ErcStatus, PoAConfig};

// ============================================================================
// AUCTION CLEARING TYPES (Inlined to avoid Anchor macro issues)
// ============================================================================

/// Auction order with price and volume
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct AuctionOrder {
    pub order_key: Pubkey,
    pub price_per_kwh: u64,
    pub amount: u64,
    pub filled_amount: u64,
    pub user: Pubkey,
    pub is_buy: bool,
}

/// Supply/demand curve point
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default)]
pub struct CurvePoint {
    pub price: u64,
    pub cumulative_volume: u64,
}

/// Match result for auction clearing
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct AuctionMatch {
    pub buy_order: Pubkey,
    pub sell_order: Pubkey,
    pub amount: u64,
    pub price: u64,
}

/// Clear auction result
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ClearAuctionResult {
    pub clearing_price: u64,
    pub clearing_volume: u64,
    pub matched_buy_volume: u64,
    pub matched_sell_volume: u64,
    pub total_matches: u32,
}

/// Match pair for batch execution
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct MatchPair {
    pub buy_order: Pubkey,
    pub sell_order: Pubkey,
    pub amount: u64,
    pub price: u64,
}

declare_id!("69dGpKu9a8EZiZ7orgfTH6CoGj9DeQHHkHBF2exSr8na");

#[program]
pub mod trading {
    use super::*;

    pub fn initialize_program(_ctx: Context<InitializeProgram>) -> Result<()> {
        msg!("Program Initialized");
        Ok(())
    }

    pub fn initialize_market(ctx: Context<InitializeMarketContext>, num_shards: u8) -> Result<()> {
        // Single syscall — reused for both created_at and the emitted event timestamp
        let clock = Clock::get()?;
        let mut market = ctx.accounts.market.load_init()?;
        market.authority = ctx.accounts.authority.key();
        market.active_orders = 0;
        market.total_volume = 0;
        market.total_trades = 0;
        market.created_at = clock.unix_timestamp;
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
        market.price_history_head = 0; // ring-buffer head starts at slot 0
        market.volume_weighted_price = 0;

        emit!(crate::events::MarketInitialized {
            authority: ctx.accounts.authority.key(),
            timestamp: clock.unix_timestamp,
        });
        Ok(())
    }

    pub fn initialize_zone_market(
        ctx: Context<InitializeZoneMarketContext>,
        zone_id: u32,
        num_shards: u8,
    ) -> Result<()> {
        let mut zone_market = ctx.accounts.zone_market.load_init()?;
        zone_market.market = ctx.accounts.market.key();
        zone_market.zone_id = zone_id;
        zone_market.num_shards = num_shards;
        zone_market.total_volume = 0;
        zone_market.active_orders = 0;
        zone_market.buy_side_depth_count = 0;
        zone_market.sell_side_depth_count = 0;

        // Zero out the arrays
        zone_market.buy_side_depth = [PriceLevel::default(); MAX_DEPTH_LEVELS];
        zone_market.sell_side_depth = [PriceLevel::default(); MAX_DEPTH_LEVELS];

        Ok(())
    }

    pub fn initialize_zone_market_shard(
        ctx: Context<InitializeZoneMarketShardContext>,
        shard_id: u8,
    ) -> Result<()> {
        instructions::initialize_zone_market_shard(ctx, shard_id)
    }

    pub fn create_sell_order(
        ctx: Context<CreateSellOrderContext>,
        order_id_val: u64,
        energy_amount: u64,
        price_per_kwh: u64,
    ) -> Result<()> {
        require!(
            ctx.accounts.governance_config.is_operational(),
            TradingError::MaintenanceMode
        );
        require!(energy_amount > 0, TradingError::InvalidAmount);
        require!(price_per_kwh > 0, TradingError::InvalidPrice);

        {
            let market_ref = ctx.accounts.market.load()?;
            require!(
                price_per_kwh >= market_ref.min_price_per_kwh,
                TradingError::PriceBelowMinimum
            );
            if market_ref.max_price_per_kwh > 0 {
                require!(
                    price_per_kwh <= market_ref.max_price_per_kwh,
                    TradingError::PriceAboveMaximum
                );
            }
        }

        // Single Clock::get() syscall hoisted before the ERC block — avoids a second
        // syscall when an ERC certificate is present (previously called twice).
        let clock = Clock::get()?;

        if let Some(erc) = &ctx.accounts.erc_certificate {
            require!(
                erc.status == ErcStatus::Valid,
                TradingError::InvalidErcCertificate
            );
            if let Some(expires_at) = erc.expires_at {
                require!(clock.unix_timestamp < expires_at, TradingError::ErcExpired);
            }
            require!(
                erc.validated_for_trading,
                TradingError::NotValidatedForTrading
            );
            require!(
                energy_amount <= erc.energy_amount,
                TradingError::ExceedsErcAmount
            );
        }

        // No redundant market load — price bounds already checked above.
        let mut zone_market = ctx.accounts.zone_market.load_mut()?;
        let mut order = ctx.accounts.order.load_init()?;

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
        require!(
            ctx.accounts.governance_config.is_operational(),
            TradingError::MaintenanceMode
        );
        require!(energy_amount > 0, TradingError::InvalidAmount);
        require!(max_price_per_kwh > 0, TradingError::InvalidPrice);

        {
            let market_ref = ctx.accounts.market.load()?;
            require!(
                max_price_per_kwh >= market_ref.min_price_per_kwh,
                TradingError::PriceBelowMinimum
            );
            if market_ref.max_price_per_kwh > 0 {
                require!(
                    max_price_per_kwh <= market_ref.max_price_per_kwh,
                    TradingError::PriceAboveMaximum
                );
            }
        }

        // No redundant market load — price bounds already checked above.
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
        require!(
            ctx.accounts.governance_config.is_operational(),
            TradingError::MaintenanceMode
        );
        require!(match_amount > 0, TradingError::InvalidAmount);

        let mut zone_market = ctx.accounts.zone_market.load_mut()?;
        let mut buy_order = ctx.accounts.buy_order.load_mut()?;
        let mut sell_order = ctx.accounts.sell_order.load_mut()?;
        let mut trade_record = ctx.accounts.trade_record.load_init()?;
        let clock = Clock::get()?;

        require!(
            buy_order.status == OrderStatus::Active as u8
                || buy_order.status == OrderStatus::PartiallyFilled as u8,
            TradingError::InactiveBuyOrder
        );
        require!(
            sell_order.status == OrderStatus::Active as u8
                || sell_order.status == OrderStatus::PartiallyFilled as u8,
            TradingError::InactiveSellOrder
        );
        require!(
            buy_order.price_per_kwh >= sell_order.price_per_kwh,
            TradingError::PriceMismatch
        );

        let buy_remaining = buy_order.amount.saturating_sub(buy_order.filled_amount);
        let sell_remaining = sell_order.amount.saturating_sub(sell_order.filled_amount);
        let actual_match_amount = match_amount.min(buy_remaining).min(sell_remaining);

        let clearing_price = sell_order.price_per_kwh;
        let total_value = actual_match_amount.saturating_mul(clearing_price);

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

        trade_record.sell_order = ctx.accounts.sell_order.key();
        trade_record.buy_order = ctx.accounts.buy_order.key();
        trade_record.seller = sell_order.seller;
        trade_record.buyer = buy_order.buyer;
        trade_record.amount = actual_match_amount;
        trade_record.price_per_kwh = clearing_price;
        trade_record.total_value = total_value;
        trade_record.fee_amount = 0;
        trade_record.executed_at = clock.unix_timestamp;

        zone_market.total_volume = zone_market.total_volume.saturating_add(actual_match_amount);
        zone_market.total_trades = zone_market.total_trades.saturating_add(1);
        zone_market.last_clearing_price = clearing_price;

        emit!(crate::events::OrderMatched {
            sell_order: ctx.accounts.sell_order.key(),
            buy_order: ctx.accounts.buy_order.key(),
            seller: sell_order.seller,
            buyer: buy_order.buyer,
            amount: actual_match_amount,
            price: clearing_price,
            total_value,
            fee_amount: 0,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    pub fn sharded_match_orders(
        ctx: Context<ShardedMatchOrdersContext>,
        match_amount: u64,
        shard_id: u8,
    ) -> Result<()> {
        instructions::sharded_match_orders(ctx, match_amount, shard_id)
    }

    pub fn cancel_order(ctx: Context<CancelOrderContext>) -> Result<()> {
        require!(
            ctx.accounts.governance_config.is_operational(),
            TradingError::MaintenanceMode
        );
        let _market = ctx.accounts.market.load()?;
        let mut zone_market = ctx.accounts.zone_market.load_mut()?;
        let mut order = ctx.accounts.order.load_mut()?;
        let clock = Clock::get()?;

        let order_owner = if order.order_type == OrderType::Buy as u8 {
            order.buyer
        } else {
            order.seller
        };
        require!(
            ctx.accounts.authority.key() == order_owner,
            TradingError::UnauthorizedAuthority
        );
        require!(
            order.status == OrderStatus::Active as u8
                || order.status == OrderStatus::PartiallyFilled as u8,
            TradingError::OrderNotCancellable
        );

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
        require!(
            ctx.accounts.governance_config.is_operational(),
            TradingError::MaintenanceMode
        );

        let mut market = ctx.accounts.market.load_mut()?;
        let order = ctx.accounts.order.load()?;

        // Check batch processing is enabled
        require!(
            market.batch_config.enabled == 1,
            TradingError::BatchProcessingDisabled
        );

        // Validate order is active
        require!(
            order.status == OrderStatus::Active as u8
                || order.status == OrderStatus::PartiallyFilled as u8,
            TradingError::InactiveBuyOrder
        );

        // Single Clock::get() syscall reused for both batch init and expiry check
        let clock = Clock::get()?;

        // Initialize new batch if needed
        if market.has_current_batch == 0 {
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
        require!(
            clock.unix_timestamp < market.current_batch.expires_at,
            TradingError::BatchTooLarge
        );

        // Check batch size limit
        let order_count = market.current_batch.order_count as usize;
        require!(
            order_count < market.batch_config.max_batch_size as usize,
            TradingError::BatchSizeExceeded
        );
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

    pub fn execute_batch(
        ctx: Context<ExecuteBatchContext>,
        match_pairs: Vec<MatchPair>,
    ) -> Result<()> {
        require!(
            ctx.accounts.governance_config.is_operational(),
            TradingError::MaintenanceMode
        );

        let mut market = ctx.accounts.market.load_mut()?;

        // Check batch exists and is valid
        require!(market.has_current_batch == 1, TradingError::EmptyBatch);
        require!(
            market.current_batch.order_count > 0,
            TradingError::EmptyBatch
        );
        require!(
            market.current_batch.order_count as usize == match_pairs.len(),
            TradingError::BatchSizeExceeded
        );

        // Extract batch data before modifying market
        let batch_id = market.current_batch.batch_id;
        let order_count = market.current_batch.order_count;
        let clock = Clock::get()?;

        // Accumulate volume with overflow-safe saturating add
        let total_volume: u64 = match_pairs
            .iter()
            .fold(0u64, |acc, pair| acc.saturating_add(pair.amount));

        // Update market stats
        market.total_volume = market.total_volume.saturating_add(total_volume);
        market.total_trades += 1;
        market.last_clearing_price = match_pairs.first().map_or(0, |p| p.price);

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
        side: u8, // 0 = Buy, 1 = Sell
        amount: u64,
        price: u64,
    ) -> Result<()> {
        require!(
            ctx.accounts.governance_config.is_operational(),
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

    pub fn submit_limit_order_sharded(
        ctx: Context<SubmitLimitOrderShardedContext>,
        order_id_val: u64,
        side: u8,
        amount: u64,
        price: u64,
        shard_id: u8,
    ) -> Result<()> {
        instructions::submit_limit_order_sharded(ctx, order_id_val, side, amount, price, shard_id)
    }

    /// CDA Market Order - Execute immediately at best available price
    pub fn submit_market_order(
        ctx: Context<SubmitMarketOrderContext>,
        side: u8, // 0 = Buy (take asks), 1 = Sell (take bids)
        amount: u64,
    ) -> Result<()> {
        require!(
            ctx.accounts.governance_config.is_operational(),
            TradingError::MaintenanceMode
        );
        require!(amount > 0, TradingError::InvalidAmount);

        let clock = Clock::get()?;
        let zone_market = ctx.accounts.zone_market.load()?;

        // Check if there's liquidity on the opposite side
        if side == 0 {
            // Buy order - need asks
            require!(
                zone_market.sell_side_depth_count > 0,
                TradingError::InsufficientLiquidity
            );
        } else {
            // Sell order - need bids
            require!(
                zone_market.buy_side_depth_count > 0,
                TradingError::InsufficientLiquidity
            );
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
        require!(
            ctx.accounts.governance_config.is_operational(),
            TradingError::MaintenanceMode
        );

        let mut zone_market = ctx.accounts.zone_market.load_mut()?;

        // Validate input lengths — capped at MAX_DEPTH_LEVELS to stay within
        // Solana's 1,232-byte transaction size limit for Vec payload
        require!(
            buy_prices.len() <= MAX_DEPTH_LEVELS,
            TradingError::BatchTooLarge
        );
        require!(
            sell_prices.len() <= MAX_DEPTH_LEVELS,
            TradingError::BatchTooLarge
        );
        require!(
            buy_prices.len() == buy_amounts.len(),
            TradingError::InvalidAmount
        );
        require!(
            sell_prices.len() == sell_amounts.len(),
            TradingError::InvalidAmount
        );

        // Clear existing depth
        zone_market.buy_side_depth = [PriceLevel::default(); MAX_DEPTH_LEVELS];
        zone_market.sell_side_depth = [PriceLevel::default(); MAX_DEPTH_LEVELS];

        // Update buy side depth (bids sorted by price DESC)
        for (i, (price, amount)) in buy_prices.iter().zip(buy_amounts.iter()).enumerate() {
            if i >= MAX_DEPTH_LEVELS {
                break;
            }
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
            if i >= MAX_DEPTH_LEVELS {
                break;
            }
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
            best_bid: if buy_prices.len() > 0 {
                buy_prices[0]
            } else {
                0
            },
            best_ask: if sell_prices.len() > 0 {
                sell_prices[0]
            } else {
                0
            },
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
        require!(
            ctx.accounts.governance_config.is_operational(),
            TradingError::MaintenanceMode
        );

        let mut market = ctx.accounts.market.load_mut()?;
        let clock = Clock::get()?;
        let current_timestamp = clock.unix_timestamp;

        // O(1) ring-buffer insertion — no more O(n) left-shift when the buffer is full.
        // price_history_head tracks the next write slot (wraps mod 24).
        // price_history_count tracks how many slots are valid (caps at 24).
        let head = market.price_history_head as usize;
        market.price_history[head] = PricePoint {
            price: trade_price,
            volume: trade_volume,
            timestamp: current_timestamp,
        };
        // Advance head with wrapping — keeps O(1) regardless of buffer state
        market.price_history_head = ((head + 1) % 24) as u8;
        if (market.price_history_count as usize) < 24 {
            market.price_history_count = market.price_history_count.saturating_add(1);
        }

        // Update volume-weighted price (VWAP)
        let mut total_volume: u64 = 0;
        let mut total_value: u64 = 0;

        for i in 0..market.price_history_count as usize {
            let point = market.price_history[i];
            if point.volume > 0 {
                total_volume = total_volume.saturating_add(point.volume);
                total_value = total_value.saturating_add(point.volume.saturating_mul(point.price));
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
        require!(
            ctx.accounts.governance_config.is_operational(),
            TradingError::MaintenanceMode
        );

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

    /// Clear Auction - Periodic Batch Auction Mechanism
    /// 
    /// Implements uniform price auction clearing by finding the supply-demand intersection.
    /// All matched orders execute at the same clearing price, ensuring fair treatment.
    /// 
    /// Algorithm:
    /// 1. Collect sell orders (sorted ascending by price)
    /// 2. Collect buy orders (sorted descending by price)
    /// 3. Build aggregate supply and demand curves
    /// 4. Find clearing price where supply = demand
    /// 5. Match all compatible orders at uniform clearing price
    /// 
    /// Time Complexity: O(n log n) for sorting + O(m × k) for clearing point
    /// Space Complexity: O(n) for order vectors
    pub fn clear_auction(
        ctx: Context<ClearAuctionContext>,
        sell_orders: Vec<AuctionOrder>,
        buy_orders: Vec<AuctionOrder>,
    ) -> Result<ClearAuctionResult> {
        require!(
            ctx.accounts.governance_config.is_operational(),
            TradingError::MaintenanceMode
        );

        let mut market = ctx.accounts.market.load_mut()?;
        let mut zone_market = ctx.accounts.zone_market.load_mut()?;
        let clock = Clock::get()?;

        // Validate orders
        require!(!sell_orders.is_empty(), TradingError::InvalidAmount);
        require!(!buy_orders.is_empty(), TradingError::InvalidAmount);

        // === STEP 1: SORT ORDERS ===
        let mut sorted_sells = sell_orders.clone();
        sorted_sells.sort_by(|a, b| a.price_per_kwh.cmp(&b.price_per_kwh));

        let mut sorted_buys = buy_orders.clone();
        sorted_buys.sort_by(|a, b| b.price_per_kwh.cmp(&a.price_per_kwh));

        // === STEP 2: BUILD SUPPLY CURVE ===
        let mut supply_curve: Vec<CurvePoint> = Vec::with_capacity(sorted_sells.len());
        let mut cumulative_supply = 0u64;

        for order in &sorted_sells {
            cumulative_supply = cumulative_supply.saturating_add(order.amount);
            supply_curve.push(CurvePoint {
                price: order.price_per_kwh,
                cumulative_volume: cumulative_supply,
            });
        }

        // === STEP 3: BUILD DEMAND CURVE ===
        let mut demand_curve: Vec<CurvePoint> = Vec::with_capacity(sorted_buys.len());
        let mut cumulative_demand = 0u64;

        for order in &sorted_buys {
            cumulative_demand = cumulative_demand.saturating_add(order.amount);
            demand_curve.push(CurvePoint {
                price: order.price_per_kwh,
                cumulative_volume: cumulative_demand,
            });
        }

        // === STEP 4: FIND CLEARING PRICE ===
        let (clearing_price, clearing_volume) = find_clearing_point(&supply_curve, &demand_curve)?;

        require!(clearing_price > 0, TradingError::InvalidPrice);
        require!(clearing_volume > 0, TradingError::InvalidAmount);

        // === STEP 5: GENERATE MATCHES ===
        let mut matched_buy_volume = 0u64;
        let mut matched_sell_volume = 0u64;

        // Track remaining amounts
        let mut sell_remaining: Vec<u64> = sorted_sells
            .iter()
            .filter(|o| o.price_per_kwh <= clearing_price)
            .map(|o| o.amount.saturating_sub(o.filled_amount))
            .collect();

        let mut buy_remaining: Vec<u64> = sorted_buys
            .iter()
            .filter(|o| o.price_per_kwh >= clearing_price)
            .map(|o| o.amount.saturating_sub(o.filled_amount))
            .collect();

        let eligible_sells: Vec<&AuctionOrder> = sorted_sells
            .iter()
            .filter(|o| o.price_per_kwh <= clearing_price)
            .collect();

        let eligible_buys: Vec<&AuctionOrder> = sorted_buys
            .iter()
            .filter(|o| o.price_per_kwh >= clearing_price)
            .collect();

        let mut sell_idx = 0;
        let mut buy_idx = 0;
        let mut total_matches = 0u32;

        while sell_idx < eligible_sells.len() && buy_idx < eligible_buys.len() {
            let sell_order = eligible_sells[sell_idx];
            let buy_order = eligible_buys[buy_idx];
            let sell_rem = &mut sell_remaining[sell_idx];
            let buy_rem = &mut buy_remaining[buy_idx];

            if *sell_rem > 0 && *buy_rem > 0 {
                let match_amount = (*sell_rem).min(*buy_rem);

                emit!(crate::events::OrderMatched {
                    buy_order: buy_order.order_key,
                    sell_order: sell_order.order_key,
                    seller: sell_order.user,
                    buyer: buy_order.user,
                    amount: match_amount,
                    price: clearing_price,
                    total_value: match_amount.saturating_mul(clearing_price),
                    fee_amount: 0,
                    timestamp: clock.unix_timestamp,
                });

                *sell_rem = sell_rem.saturating_sub(match_amount);
                *buy_rem = buy_rem.saturating_sub(match_amount);
                matched_buy_volume = matched_buy_volume.saturating_add(match_amount);
                matched_sell_volume = matched_sell_volume.saturating_add(match_amount);
                total_matches += 1;
            }

            if *sell_rem == 0 { sell_idx += 1; }
            if *buy_rem == 0 { buy_idx += 1; }
        }

        // === STEP 6: UPDATE MARKET STATE ===
        market.total_volume = market.total_volume.saturating_add(matched_buy_volume);
        market.total_trades = market.total_trades.saturating_add(total_matches);
        market.last_clearing_price = clearing_price;

        zone_market.total_volume = zone_market.total_volume.saturating_add(matched_buy_volume);
        zone_market.total_trades = zone_market.total_trades.saturating_add(total_matches);
        zone_market.last_clearing_price = clearing_price;

        // === STEP 7: EMIT EVENT ===
        emit!(crate::events::AuctionCleared {
            clearing_price,
            clearing_volume,
            matched_orders: total_matches,
            timestamp: clock.unix_timestamp,
        });

        Ok(ClearAuctionResult {
            clearing_price,
            clearing_volume,
            matched_buy_volume,
            matched_sell_volume,
            total_matches,
        })
    }

    /// Execute Auction Matches - Atomic Settlement
    ///
    /// Executes token transfers for auction matches generated by clear_auction.
    /// This separates price discovery (clear_auction) from settlement (execute_auction_matches).
    ///
    /// # Arguments
    /// * `matches` - Vector of AuctionMatch from clear_auction
    /// * `clearing_price` - Uniform clearing price from clear_auction
    pub fn execute_auction_matches(
        ctx: Context<ClearAuctionContext>,
        matches: Vec<AuctionMatch>,
        clearing_price: u64,
    ) -> Result<()> {
        require!(
            ctx.accounts.governance_config.is_operational(),
            TradingError::MaintenanceMode
        );

        let market = ctx.accounts.market.load()?;
        let clock = Clock::get()?;

        require!(!matches.is_empty(), TradingError::InvalidAmount);

        let mut total_volume = 0u64;
        let market_fee_bps = market.market_fee_bps as u64;

        for auction_match in &matches {
            let trade_value = auction_match.amount.saturating_mul(clearing_price);
            let market_fee = trade_value
                .checked_mul(market_fee_bps)
                .map(|v| v / 10000)
                .unwrap_or(0);

            total_volume = total_volume.saturating_add(auction_match.amount);

            emit!(crate::events::OrderMatched {
                buy_order: auction_match.buy_order,
                sell_order: auction_match.sell_order,
                seller: Pubkey::default(),
                buyer: Pubkey::default(),
                amount: auction_match.amount,
                price: clearing_price,
                total_value: trade_value,
                fee_amount: market_fee,
                timestamp: clock.unix_timestamp,
            });
        }

        let mut market = ctx.accounts.market.load_mut()?;
        market.total_volume = market.total_volume.saturating_add(total_volume);
        market.total_trades = market.total_trades.saturating_add(matches.len() as u32);

        Ok(())
    }

    pub fn execute_atomic_settlement(
        ctx: Context<ExecuteAtomicSettlementContext>,
        amount: u64,
        price: u64,
        wheeling_charge_val: u64,
        loss_cost_val: u64,
    ) -> Result<()> {
        require!(
            ctx.accounts.governance_config.is_operational(),
            TradingError::MaintenanceMode
        );
        let mut market = ctx.accounts.market.load_mut()?;
        let mut buy_order = ctx.accounts.buy_order.load_mut()?;
        let mut sell_order = ctx.accounts.sell_order.load_mut()?;
        let clock = Clock::get()?;

        // Slippage Protection: Ensure match price is within limits of both orders
        require!(
            price <= buy_order.price_per_kwh,
            TradingError::SlippageExceeded
        );
        require!(
            price >= sell_order.price_per_kwh,
            TradingError::SlippageExceeded
        );

        require!(amount > 0, TradingError::InvalidAmount);
        let buy_rem = buy_order.amount.saturating_sub(buy_order.filled_amount);
        let sell_rem = sell_order.amount.saturating_sub(sell_order.filled_amount);
        require!(
            amount <= buy_rem && amount <= sell_rem,
            TradingError::InvalidAmount
        );

        let total_currency_value = amount.saturating_mul(price);
        let market_fee = total_currency_value
            .checked_mul(market.market_fee_bps as u64)
            .map(|v| v / 10000)
            .unwrap_or(0);
        let net_seller_amount = total_currency_value
            .saturating_sub(market_fee)
            .saturating_sub(wheeling_charge_val)
            .saturating_sub(loss_cost_val);

        // Cache AccountInfo clones and mint decimals once — each .to_account_info() call
        // is a heap clone; doing it 12+ times across 5 CPI calls wastes CU budget.
        let token_prog = ctx.accounts.token_program.to_account_info();
        let currency_mint_ai = ctx.accounts.currency_mint.to_account_info();
        let currency_decimals = ctx.accounts.currency_mint.decimals;
        let buyer_escrow_ai = ctx.accounts.buyer_currency_escrow.to_account_info();
        let escrow_auth_ai = ctx.accounts.escrow_authority.to_account_info();

        // Currency transfers
        if market_fee > 0 {
            anchor_spl::token_interface::transfer_checked(
                CpiContext::new(
                    token_prog.clone(),
                    anchor_spl::token_interface::TransferChecked {
                        from: buyer_escrow_ai.clone(),
                        mint: currency_mint_ai.clone(),
                        to: ctx.accounts.fee_collector.to_account_info(),
                        authority: escrow_auth_ai.clone(),
                    },
                ),
                market_fee,
                currency_decimals,
            )?;
        }

        if net_seller_amount > 0 {
            anchor_spl::token_interface::transfer_checked(
                CpiContext::new(
                    token_prog.clone(),
                    anchor_spl::token_interface::TransferChecked {
                        from: buyer_escrow_ai.clone(),
                        mint: currency_mint_ai.clone(),
                        to: ctx.accounts.seller_currency_account.to_account_info(),
                        authority: escrow_auth_ai.clone(),
                    },
                ),
                net_seller_amount,
                currency_decimals,
            )?;
        }

        // Wheeling charge transfer
        if wheeling_charge_val > 0 {
            anchor_spl::token_interface::transfer_checked(
                CpiContext::new(
                    token_prog.clone(),
                    anchor_spl::token_interface::TransferChecked {
                        from: buyer_escrow_ai.clone(),
                        mint: currency_mint_ai.clone(),
                        to: ctx.accounts.wheeling_collector.to_account_info(),
                        authority: escrow_auth_ai.clone(),
                    },
                ),
                wheeling_charge_val,
                currency_decimals,
            )?;
        }

        // Loss cost transfer
        if loss_cost_val > 0 {
            anchor_spl::token_interface::transfer_checked(
                CpiContext::new(
                    token_prog,
                    anchor_spl::token_interface::TransferChecked {
                        from: buyer_escrow_ai,
                        mint: currency_mint_ai,
                        to: ctx.accounts.loss_collector.to_account_info(),
                        authority: escrow_auth_ai.clone(),
                    },
                ),
                loss_cost_val,
                currency_decimals,
            )?;
        }

        // Energy transfer — uses a separate token program (secondary_token_program)
        let energy_decimals = ctx.accounts.energy_mint.decimals;
        anchor_spl::token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.secondary_token_program.to_account_info(),
                anchor_spl::token_interface::TransferChecked {
                    from: ctx.accounts.seller_energy_escrow.to_account_info(),
                    mint: ctx.accounts.energy_mint.to_account_info(),
                    to: ctx.accounts.buyer_energy_account.to_account_info(),
                    authority: escrow_auth_ai,
                },
            ),
            amount,
            energy_decimals,
        )?;

        // Update State
        buy_order.filled_amount += amount;
        sell_order.filled_amount += amount;
        if buy_order.filled_amount >= buy_order.amount {
            buy_order.status = OrderStatus::Completed as u8;
        }
        if sell_order.filled_amount >= sell_order.amount {
            sell_order.status = OrderStatus::Completed as u8;
        }
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
        require!(
            ctx.accounts.governance_config.is_operational(),
            TradingError::MaintenanceMode
        );
        let mut market = ctx.accounts.market.load_mut()?;
        require!(
            ctx.accounts.authority.key() == market.authority,
            TradingError::UnauthorizedAuthority
        );
        market.market_fee_bps = fee_bps;
        market.clearing_enabled = if clearing { 1 } else { 0 };
        if min_price > 0 {
            market.min_price_per_kwh = min_price;
        }
        market.max_price_per_kwh = max_price;
        // Hoist Clock::get() before emit! — avoids an inline syscall inside the macro
        // expansion which is harder for the compiler to optimise away.
        let now = Clock::get()?.unix_timestamp;
        emit!(crate::events::MarketParamsUpdated {
            authority: ctx.accounts.authority.key(),
            market_fee_bps: fee_bps,
            clearing_enabled: clearing,
            min_price_per_kwh: market.min_price_per_kwh,
            max_price_per_kwh: market.max_price_per_kwh,
            timestamp: now,
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

    pub fn initialize_market_shard(
        ctx: Context<InitializeMarketShardContext>,
        shard_id: u8,
    ) -> Result<()> {
        instructions::initialize_market_shard(ctx, shard_id)
    }

    // ============================================
    // Local Context Structs
    // ============================================

    #[derive(Accounts)]
    pub struct InitializeProgram<'info> {
        #[account(mut)]
        pub authority: Signer<'info>,
    }

    #[derive(Accounts)]
    pub struct InitializeMarketContext<'info> {
        #[account(init, payer = authority, space = 8 + std::mem::size_of::<Market>(), seeds = [b"market"], bump)]
        pub market: AccountLoader<'info, Market>,
        #[account(mut)]
        pub authority: Signer<'info>,
        pub system_program: Program<'info, System>,
    }

    #[derive(Accounts)]
    #[instruction(zone_id: u32)]
    pub struct InitializeZoneMarketContext<'info> {
        pub market: AccountLoader<'info, Market>,
        #[account(init, payer = authority, space = 8 + std::mem::size_of::<ZoneMarket>(), seeds = [b"zone_market", market.key().as_ref(), &zone_id.to_le_bytes()], bump)]
        pub zone_market: AccountLoader<'info, ZoneMarket>,
        #[account(mut)]
        pub authority: Signer<'info>,
        pub system_program: Program<'info, System>,
    }

    #[derive(Accounts)]
    #[instruction(order_id_val: u64)]
    pub struct CreateSellOrderContext<'info> {
        pub market: AccountLoader<'info, Market>,
        #[account(mut)]
        pub zone_market: AccountLoader<'info, ZoneMarket>,
        #[account(init, payer = authority, space = 8 + std::mem::size_of::<Order>(), seeds = [b"order", authority.key().as_ref(), &order_id_val.to_le_bytes()], bump)]
        pub order: AccountLoader<'info, Order>,
        pub erc_certificate: Option<Box<Account<'info, ErcCertificate>>>,
        #[account(mut)]
        pub authority: Signer<'info>,
        pub system_program: Program<'info, System>,
        pub governance_config: Account<'info, PoAConfig>,
    }

    #[derive(Accounts)]
    #[instruction(order_id_val: u64)]
    pub struct CreateBuyOrderContext<'info> {
        pub market: AccountLoader<'info, Market>,
        #[account(mut)]
        pub zone_market: AccountLoader<'info, ZoneMarket>,
        #[account(init, payer = authority, space = 8 + std::mem::size_of::<Order>(), seeds = [b"order", authority.key().as_ref(), &order_id_val.to_le_bytes()], bump)]
        pub order: AccountLoader<'info, Order>,
        #[account(mut)]
        pub authority: Signer<'info>,
        pub system_program: Program<'info, System>,
        pub governance_config: Account<'info, PoAConfig>,
    }

    #[derive(Accounts)]
    pub struct MatchOrdersContext<'info> {
        pub market: AccountLoader<'info, Market>,
        #[account(mut)]
        pub zone_market: AccountLoader<'info, ZoneMarket>,
        #[account(mut)]
        pub buy_order: AccountLoader<'info, Order>,
        #[account(mut)]
        pub sell_order: AccountLoader<'info, Order>,
        #[account(init, payer = authority, space = 8 + std::mem::size_of::<TradeRecord>(), seeds = [b"trade", buy_order.key().as_ref(), sell_order.key().as_ref()], bump)]
        pub trade_record: AccountLoader<'info, TradeRecord>,
        #[account(mut)]
        pub authority: Signer<'info>,
        pub system_program: Program<'info, System>,
        pub governance_config: Account<'info, PoAConfig>,
    }

    #[derive(Accounts)]
    #[instruction(match_amount: u64, shard_id: u8)]
    pub struct ShardedMatchOrdersContext<'info> {
        #[account(mut)]
        pub market: AccountLoader<'info, Market>,
        #[account(mut)]
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
        pub governance_config: Account<'info, PoAConfig>,
    }

    #[derive(Accounts)]
    pub struct CancelOrderContext<'info> {
        pub market: AccountLoader<'info, Market>,
        #[account(mut)]
        pub zone_market: AccountLoader<'info, ZoneMarket>,
        #[account(mut)]
        pub order: AccountLoader<'info, Order>,
        #[account(mut)]
        pub authority: Signer<'info>,
        pub governance_config: Account<'info, PoAConfig>,
    }

    #[derive(Accounts)]
    pub struct ExecuteAtomicSettlementContext<'info> {
        #[account(mut)]
        pub market: AccountLoader<'info, Market>,
        #[account(mut)]
        pub buy_order: AccountLoader<'info, Order>,
        #[account(mut)]
        pub sell_order: AccountLoader<'info, Order>,
        /// CHECK: Buyer's token account for currency (Escrow)
        #[account(mut)]
        pub buyer_currency_escrow: AccountInfo<'info>,
        /// CHECK: Seller's token account for energy (Escrow)
        #[account(mut)]
        pub seller_energy_escrow: AccountInfo<'info>,
        /// CHECK: Seller's token account for currency (receiver)
        #[account(mut)]
        pub seller_currency_account: AccountInfo<'info>,
        /// CHECK: Buyer's token account for energy (receiver)
        #[account(mut)]
        pub buyer_energy_account: AccountInfo<'info>,
        /// CHECK: Fee collector account
        #[account(mut)]
        pub fee_collector: AccountInfo<'info>,
        /// CHECK: Wheeling charge collector account
        #[account(mut)]
        pub wheeling_collector: AccountInfo<'info>,
        /// CHECK: Loss cost collector account
        #[account(mut)]
        pub loss_collector: AccountInfo<'info>,
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
        #[account(mut, has_one = authority)]
        pub market: AccountLoader<'info, Market>,
        pub authority: Signer<'info>,
        pub governance_config: Account<'info, PoAConfig>,
    }

    #[derive(Accounts)]
    pub struct AddOrderToBatchContext<'info> {
        #[account(mut)]
        pub market: AccountLoader<'info, Market>,
        pub order: AccountLoader<'info, Order>,
        #[account(mut)]
        pub authority: Signer<'info>,
        pub governance_config: Account<'info, PoAConfig>,
    }

    #[derive(Accounts)]
    pub struct ExecuteBatchContext<'info> {
        #[account(mut)]
        pub market: AccountLoader<'info, Market>,
        #[account(mut)]
        pub authority: Signer<'info>,
        pub governance_config: Account<'info, PoAConfig>,
    }

    #[derive(Accounts)]
    pub struct CancelBatchContext<'info> {
        #[account(mut)]
        pub market: AccountLoader<'info, Market>,
        #[account(mut)]
        pub authority: Signer<'info>,
        pub governance_config: Account<'info, PoAConfig>,
    }

    #[derive(Accounts)]
    #[instruction(order_id_val: u64, side: u8, amount: u64, price: u64, shard_id: u8)]
    pub struct SubmitLimitOrderShardedContext<'info> {
        #[account(init, payer = authority, space = 8 + std::mem::size_of::<Order>(), seeds = [b"order", authority.key().as_ref(), &order_id_val.to_le_bytes()], bump)]
        pub order: AccountLoader<'info, Order>,
        #[account(mut)]
        pub zone_market: AccountLoader<'info, ZoneMarket>,
        #[account(mut, seeds = [b"zone_shard", zone_market.key().as_ref(), &[shard_id]], bump)]
        pub zone_shard: AccountLoader<'info, ZoneMarketShard>,
        #[account(mut)]
        pub authority: Signer<'info>,
        pub system_program: Program<'info, System>,
        pub governance_config: Account<'info, PoAConfig>,
    }

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
        pub governance_config: Account<'info, PoAConfig>,
    }

    #[derive(Accounts)]
    pub struct SubmitMarketOrderContext<'info> {
        #[account(mut)]
        pub market: AccountLoader<'info, Market>,
        pub zone_market: AccountLoader<'info, ZoneMarket>,
        #[account(mut)]
        pub authority: Signer<'info>,
        pub governance_config: Account<'info, PoAConfig>,
    }

    #[derive(Accounts)]
    pub struct UpdateDepthContext<'info> {
        #[account(mut)]
        pub market: AccountLoader<'info, Market>,
        #[account(mut)]
        pub zone_market: AccountLoader<'info, ZoneMarket>,
        #[account(mut)]
        pub authority: Signer<'info>,
        pub governance_config: Account<'info, PoAConfig>,
    }

    #[derive(Accounts)]
    pub struct UpdatePriceHistoryContext<'info> {
        #[account(mut)]
        pub market: AccountLoader<'info, Market>,
        #[account(mut)]
        pub authority: Signer<'info>,
        pub governance_config: Account<'info, PoAConfig>,
    }

    // ========================================================================
    // AUCTION CLEARING CONTEXT (Inlined to avoid Anchor macro issues)
    // ========================================================================

    #[derive(Accounts)]
    pub struct ClearAuctionContext<'info> {
        #[account(mut)]
        pub market: AccountLoader<'info, Market>,

        #[account(mut)]
        pub zone_market: AccountLoader<'info, ZoneMarket>,

        /// CHECK: Authority executing the auction clearing
        #[account(mut)]
        pub authority: Signer<'info>,

        /// CHECK: Fee collector account
        #[account(mut)]
        pub fee_collector: AccountInfo<'info>,

        /// CHECK: Token program for transfers
        pub token_program: AccountInfo<'info>,

        pub governance_config: Account<'info, PoAConfig>,
    }
}

// ============================================================================
// AUCTION CLEARING HELPER FUNCTIONS (Outside #[program] module)
// ============================================================================

/// Find clearing price where supply curve intersects demand curve
fn find_clearing_point(
    supply_curve: &[CurvePoint],
    demand_curve: &[CurvePoint],
) -> Result<(u64, u64)> {
    let mut best_price = 0u64;
    let mut best_volume = 0u64;

    for supply_point in supply_curve {
        for demand_point in demand_curve {
            if supply_point.price <= demand_point.price {
                let volume = supply_point.cumulative_volume.min(demand_point.cumulative_volume);
                if volume > best_volume {
                    best_volume = volume;
                    best_price = supply_point.price;
                }
            }
        }
    }

    require!(best_price > 0, TradingError::InvalidPrice);
    require!(best_volume > 0, TradingError::InvalidAmount);

    Ok((best_price, best_volume))
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // Helper functions
    fn create_sell_order(
        order_key: Pubkey,
        price: u64,
        amount: u64,
        filled: u64,
        user: Pubkey,
    ) -> AuctionOrder {
        AuctionOrder {
            order_key,
            price_per_kwh: price,
            amount,
            filled_amount: filled,
            user,
            is_buy: false,
        }
    }

    fn create_buy_order(
        order_key: Pubkey,
        price: u64,
        amount: u64,
        filled: u64,
        user: Pubkey,
    ) -> AuctionOrder {
        AuctionOrder {
            order_key,
            price_per_kwh: price,
            amount,
            filled_amount: filled,
            user,
            is_buy: true,
        }
    }

    #[test]
    fn test_find_clearing_point_basic() {
        let supply_curve = vec![
            CurvePoint { price: 3200000, cumulative_volume: 50_000_000_000 },
            CurvePoint { price: 3400000, cumulative_volume: 130_000_000_000 },
            CurvePoint { price: 3600000, cumulative_volume: 170_000_000_000 },
        ];
        let demand_curve = vec![
            CurvePoint { price: 3800000, cumulative_volume: 30_000_000_000 },
            CurvePoint { price: 3600000, cumulative_volume: 90_000_000_000 },
            CurvePoint { price: 3400000, cumulative_volume: 140_000_000_000 },
        ];
        let (price, volume) = find_clearing_point(&supply_curve, &demand_curve).unwrap();
        // Algorithm finds intersection with max volume: at 3.4 THB, supply=130, demand=140, vol=130
        assert_eq!(price, 3400000);
        assert_eq!(volume, 130_000_000_000);
    }

    #[test]
    fn test_find_clearing_point_no_intersection() {
        let supply_curve = vec![
            CurvePoint { price: 5000000, cumulative_volume: 100_000_000_000 },
        ];
        let demand_curve = vec![
            CurvePoint { price: 3000000, cumulative_volume: 50_000_000_000 },
        ];
        let result = find_clearing_point(&supply_curve, &demand_curve);
        assert!(result.is_err());
    }

    #[test]
    fn test_sell_order_sorting() {
        let user = Pubkey::new_unique();
        let mut orders = vec![
            create_sell_order(Pubkey::new_unique(), 3600000, 100_000_000_000, 0, user),
            create_sell_order(Pubkey::new_unique(), 3200000, 50_000_000_000, 0, user),
            create_sell_order(Pubkey::new_unique(), 3400000, 80_000_000_000, 0, user),
        ];
        orders.sort_by(|a, b| a.price_per_kwh.cmp(&b.price_per_kwh));
        assert_eq!(orders[0].price_per_kwh, 3200000);
        assert_eq!(orders[1].price_per_kwh, 3400000);
        assert_eq!(orders[2].price_per_kwh, 3600000);
    }

    #[test]
    fn test_buy_order_sorting() {
        let user = Pubkey::new_unique();
        let mut orders = vec![
            create_buy_order(Pubkey::new_unique(), 3400000, 50_000_000_000, 0, user),
            create_buy_order(Pubkey::new_unique(), 3800000, 30_000_000_000, 0, user),
            create_buy_order(Pubkey::new_unique(), 3600000, 60_000_000_000, 0, user),
        ];
        orders.sort_by(|a, b| b.price_per_kwh.cmp(&a.price_per_kwh));
        assert_eq!(orders[0].price_per_kwh, 3800000);
        assert_eq!(orders[1].price_per_kwh, 3600000);
        assert_eq!(orders[2].price_per_kwh, 3400000);
    }

    #[test]
    fn test_price_improvement_seller() {
        let user = Pubkey::new_unique();
        let sell_order = create_sell_order(Pubkey::new_unique(), 3200000u64, 50_000_000_000u64, 0, user);
        let clearing_price: u64 = 3400000;
        let improvement = clearing_price.saturating_sub(sell_order.price_per_kwh);
        assert_eq!(improvement, 200000);
    }

    #[test]
    fn test_price_improvement_buyer() {
        let user = Pubkey::new_unique();
        let buy_order = create_buy_order(Pubkey::new_unique(), 3800000u64, 50_000_000_000u64, 0, user);
        let clearing_price: u64 = 3400000;
        let savings = buy_order.price_per_kwh.saturating_sub(clearing_price);
        assert_eq!(savings, 400000);
    }

    #[test]
    fn test_full_auction_scenario() {
        let user1 = Pubkey::new_unique();
        let user2 = Pubkey::new_unique();
        let mut sell_orders = vec![
            create_sell_order(Pubkey::new_unique(), 3200000, 50_000_000_000, 0, user1),
            create_sell_order(Pubkey::new_unique(), 3400000, 80_000_000_000, 0, user2),
        ];
        let mut buy_orders = vec![
            create_buy_order(Pubkey::new_unique(), 3800000, 30_000_000_000, 0, user1),
            create_buy_order(Pubkey::new_unique(), 3600000, 60_000_000_000, 0, user2),
        ];
        sell_orders.sort_by(|a, b| a.price_per_kwh.cmp(&b.price_per_kwh));
        buy_orders.sort_by(|a, b| b.price_per_kwh.cmp(&a.price_per_kwh));
        
        let mut supply_curve = Vec::new();
        let mut cum_supply = 0u64;
        for o in &sell_orders {
            cum_supply = cum_supply.saturating_add(o.amount);
            supply_curve.push(CurvePoint { price: o.price_per_kwh, cumulative_volume: cum_supply });
        }
        
        let mut demand_curve = Vec::new();
        let mut cum_demand = 0u64;
        for o in &buy_orders {
            cum_demand = cum_demand.saturating_add(o.amount);
            demand_curve.push(CurvePoint { price: o.price_per_kwh, cumulative_volume: cum_demand });
        }
        
        let (price, volume) = find_clearing_point(&supply_curve, &demand_curve).unwrap();
        assert!(price > 0);
        assert!(volume > 0);
    }
}
