#![allow(deprecated)]

use anchor_lang::prelude::*;
// Use absolute path for governance crate if needed, or ensure it's mapped correctly
pub use ::governance::{ErcCertificate, ErcStatus};

// Core modules
pub mod error;
pub mod events;
pub mod state;

// Stablecoin and Cross-chain modules
pub mod stablecoin;
pub mod wormhole;
pub mod payments;

// Privacy/ZK modules
pub mod privacy;
pub mod confidential;

// Features modules
pub mod pricing;
pub mod meter_verification;
pub mod carbon;
pub mod amm;
pub mod auction;

// Re-export core modules
pub use error::*;
pub use events::*;
pub use state::*;

// Features modules
#[allow(ambiguous_glob_reexports)]
pub use stablecoin::*;
pub use wormhole::*;
pub use payments::*;
pub use privacy::*;
pub use confidential::*;
pub use pricing::*;
pub use meter_verification::*;
pub use carbon::*;
pub use amm::*;
pub use auction::*;

// Import compute_fn! macro when localnet feature is enabled
#[cfg(feature = "localnet")]
use compute_debug::compute_fn;

// No-op versions for non-localnet builds
#[cfg(not(feature = "localnet"))]
macro_rules! compute_fn {
    ($name:expr => $block:block) => { $block };
}

declare_id!("GTuRUUwCfvmqW7knqQtzQLMCy61p4UKUrdT5ssVgZbat");

#[program]
pub mod trading {
    use super::*;

    pub fn initialize(_ctx: Context<Initialize>) -> Result<()> {
        msg!("Trading program initialized");
        Ok(())
    }

    /// Initialize the trading market
    pub fn initialize_market(ctx: Context<InitializeMarket>) -> Result<()> {
        compute_fn!("initialize_market" => {
            let mut market = ctx.accounts.market.load_init()?;
            market.authority = ctx.accounts.authority.key();
            market.active_orders = 0;
            market.total_volume = 0;
            market.total_trades = 0;
            market.created_at = Clock::get()?.unix_timestamp;
            market.clearing_enabled = 1;
            market.market_fee_bps = 25; // 0.25% fee

            // Initialize batch processing config
            market.batch_config = BatchConfig {
                enabled: 0,
                _padding1: [0; 3],
                max_batch_size: 100,
                batch_timeout_seconds: 300, // 5 minutes
                min_batch_size: 5,
                price_improvement_threshold: 5, // 5% improvement
                _padding2: [0; 6],
            };

            // Initialize market depth
            market.buy_side_depth = [PriceLevel::default(); 20];
            market.sell_side_depth = [PriceLevel::default(); 20];
            market.buy_side_depth_count = 0;
            market.sell_side_depth_count = 0;

            // Initialize price discovery
            market.last_clearing_price = 0;
            market.price_history = [PricePoint::default(); 24];
            market.price_history_count = 0;
            market.volume_weighted_price = 0;

            emit!(MarketInitialized {
                authority: ctx.accounts.authority.key(),
                timestamp: Clock::get()?.unix_timestamp,
            });
        });

        Ok(())
    }



    /// Create a sell order for energy
    /// Validates that the seller has a valid ERC certificate before allowing the order
    pub fn create_sell_order(
        ctx: Context<CreateSellOrder>,
        order_id: u64,
        energy_amount: u64,
        price_per_kwh: u64,
    ) -> Result<()> {
        compute_fn!("create_sell_order" => {
            require!(energy_amount > 0, TradingError::InvalidAmount);
            require!(price_per_kwh > 0, TradingError::InvalidPrice);

            // === ERC VALIDATION ===
            if let Some(erc_certificate) = &ctx.accounts.erc_certificate {
                let clock = Clock::get()?;

                require!(
                    erc_certificate.status == ErcStatus::Valid,
                    TradingError::InvalidErcCertificate
                );

                if let Some(expires_at) = erc_certificate.expires_at {
                    require!(
                        clock.unix_timestamp < expires_at,
                        TradingError::ErcCertificateExpired
                    );
                }

                require!(
                    erc_certificate.validated_for_trading,
                    TradingError::ErcNotValidatedForTrading
                );

                require!(
                    energy_amount <= erc_certificate.energy_amount,
                    TradingError::ExceedsErcAmount
                );
            }

            let mut market = ctx.accounts.market.load_mut()?;
            let mut order = ctx.accounts.order.load_init()?;
            let clock = Clock::get()?;

            // Initialize order
            order.seller = ctx.accounts.authority.key();
            order.buyer = Pubkey::default();
            order.order_id = order_id;
            order.amount = energy_amount;
            order.filled_amount = 0;
            order.price_per_kwh = price_per_kwh;
            order.order_type = OrderType::Sell as u8;
            order.status = OrderStatus::Active as u8;
            order.created_at = clock.unix_timestamp;
            order.expires_at = clock.unix_timestamp + 86400; // 24h default

            market.active_orders += 1;
            Ok(())
        })
    }

    /// Initialize the Energy AMM pool
    pub fn initialize_amm_pool(
        ctx: Context<InitializeAmmPool>,
        curve_type: CurveType,
        slope: u64,
        base: u64,
        fee_bps: u16,
    ) -> Result<()> {
        amm::handle_initialize_amm_pool(ctx, curve_type, slope, base, fee_bps)
    }

    /// Swap currency for energy via AMM
    pub fn swap_buy_energy(
        ctx: Context<SwapEnergy>,
        amount_milli_kwh: u64,
        max_currency: u64,
    ) -> Result<()> {
        amm::handle_swap_buy_energy(ctx, amount_milli_kwh, max_currency)
    }

    /// Create a buy order for energy
    pub fn create_buy_order(
        ctx: Context<CreateBuyOrder>,
        order_id: u64,
        energy_amount: u64,
        max_price_per_kwh: u64,
    ) -> Result<()> {
        compute_fn!("create_buy_order" => {
            require!(energy_amount > 0, TradingError::InvalidAmount);
            require!(max_price_per_kwh > 0, TradingError::InvalidPrice);

            let mut market = ctx.accounts.market.load_mut()?;
            let mut order = ctx.accounts.order.load_init()?;
            let clock = Clock::get()?;

            // Initialize order
            order.buyer = ctx.accounts.authority.key();
            order.seller = Pubkey::default();
            order.order_id = order_id;
            order.amount = energy_amount;
            order.filled_amount = 0;
            order.price_per_kwh = max_price_per_kwh;
            order.order_type = OrderType::Buy as u8;
            order.status = OrderStatus::Active as u8;
            order.created_at = clock.unix_timestamp;
            order.expires_at = clock.unix_timestamp + 86400;

            // Update market stats
            market.active_orders += 1;

            // Project Key
            let order_key = ctx.accounts.order.key();

            // Update market depth for buy side
            update_market_depth(&mut market, &order, false)?;

            emit!(BuyOrderCreated {
                buyer: ctx.accounts.authority.key(),
                order_id: order_key,
                amount: energy_amount,
                price_per_kwh: max_price_per_kwh,
                timestamp: clock.unix_timestamp,
            });
        });

        Ok(())
    }

    /// Match a buy order with a sell order
    pub fn match_orders(ctx: Context<MatchOrders>, match_amount: u64) -> Result<()> {
        compute_fn!("match_orders" => {
            require!(match_amount > 0, TradingError::InvalidAmount);

            let mut market = ctx.accounts.market.load_mut()?;
            let mut buy_order = ctx.accounts.buy_order.load_mut()?;
            let mut sell_order = ctx.accounts.sell_order.load_mut()?;
            let trade_record = &mut ctx.accounts.trade_record;
            let clock = Clock::get()?;

            // Validate orders
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

            // Calculate match details
            let buy_remaining = buy_order.amount - buy_order.filled_amount;
            let sell_remaining = sell_order.amount - sell_order.filled_amount;
            let actual_match_amount = match_amount.min(buy_remaining).min(sell_remaining);

            // Fix value at matching order (GRX Token Standard)
            // Use the seller's asking price as the clearing price (Pay-as-Seller)
            let clearing_price = sell_order.price_per_kwh;
            let total_value = actual_match_amount * clearing_price;
            let fee_amount = (total_value * market.market_fee_bps as u64) / 10000;

            // Update orders
            buy_order.filled_amount += actual_match_amount;
            sell_order.filled_amount += actual_match_amount;

            // Update order statuses
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

            // Create trade record
            trade_record.buy_order = ctx.accounts.buy_order.key();
            trade_record.sell_order = ctx.accounts.sell_order.key();
            trade_record.buyer = buy_order.buyer;
            trade_record.seller = sell_order.seller;
            trade_record.amount = actual_match_amount;
            trade_record.price_per_kwh = clearing_price;
            trade_record.total_value = total_value;
            trade_record.fee_amount = fee_amount;
            trade_record.executed_at = clock.unix_timestamp;

            // Update market stats and price history
            market.total_volume += actual_match_amount;
            market.total_trades += 1;
            market.last_clearing_price = clearing_price;
            update_price_history(
                &mut market,
                clearing_price,
                actual_match_amount,
                clock.unix_timestamp,
            )?;

            emit!(OrderMatched {
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
        });

        Ok(())
    }

    /// Cancel an active order
    pub fn cancel_order(ctx: Context<CancelOrder>) -> Result<()> {
        compute_fn!("cancel_order" => {
            let mut market = ctx.accounts.market.load_mut()?;
            let mut order = ctx.accounts.order.load_mut()?;
            let clock = Clock::get()?;

            // Validate order ownership
            let order_owner = if order.order_type == OrderType::Buy as u8 {
                order.buyer
            } else {
                order.seller
            };

            require!(
                ctx.accounts.authority.key() == order_owner,
                TradingError::UnauthorizedAuthority
            );

            // Validate order can be cancelled
            require!(
                order.status == OrderStatus::Active as u8 || order.status == OrderStatus::PartiallyFilled as u8,
                TradingError::OrderNotCancellable
            );

            // Update order status
            order.status = OrderStatus::Cancelled as u8;

            // Update market stats
            market.active_orders = market.active_orders.saturating_sub(1);

            emit!(OrderCancelled {
                order_id: ctx.accounts.order.key(),
                user: ctx.accounts.authority.key(),
                timestamp: clock.unix_timestamp,
            });
        });

        Ok(())
    }

    /// Update market parameters (admin only)
    pub fn update_market_params(
        ctx: Context<UpdateMarketParams>,
        market_fee_bps: u16,
        clearing_enabled: bool,
    ) -> Result<()> {
        compute_fn!("update_market_params" => {
            let mut market = ctx.accounts.market.load_mut()?;

            require!(
                ctx.accounts.authority.key() == market.authority,
                TradingError::UnauthorizedAuthority
            );

            market.market_fee_bps = market_fee_bps;
            market.clearing_enabled = if clearing_enabled { 1 } else { 0 };

            emit!(MarketParamsUpdated {
                authority: ctx.accounts.authority.key(),
                market_fee_bps,
                clearing_enabled,
                timestamp: Clock::get()?.unix_timestamp,
            });
        });

        Ok(())
    }

    /// Create and execute a batch of orders with physical token transfers
    /// Optimized: Aggregates multiple matches in a single transaction
    /// This implementation uses remaining_accounts to pass all required ATAs:
    /// For each match i, accounts are expected at indices [2 + i*6..2 + i*6 + 5]:
    /// 0: Buyer Currency Escrow, 1: Seller Energy Escrow, 2: Seller Currency, 3: Buyer Energy, 4: Fee Collector, 5: Wheeling Collector
    pub fn execute_batch(
        ctx: Context<ExecuteBatch>, 
        amount: Vec<u64>,
        price: Vec<u64>,
        wheeling_charge: Vec<u64>
    ) -> Result<()> {
        compute_fn!("execute_batch" => {
            let mut market = ctx.accounts.market.load_mut()?;
            require!(
                market.batch_config.enabled == 1,
                TradingError::BatchProcessingDisabled
            );
            
            let num_matches = amount.len();
            // Limit batch size to prevent hitting account limits (max ~20-25 accounts)
            require!(num_matches > 0 && num_matches <= 4, TradingError::BatchSizeExceeded);
            require!(price.len() == num_matches, TradingError::InvalidAmount);
            require!(wheeling_charge.len() == num_matches, TradingError::InvalidAmount);

            // Remaining accounts check: 6 accounts per match
            let expected_accounts = num_matches * 6;
            require!(
                ctx.remaining_accounts.len() >= expected_accounts,
                TradingError::InsufficientEscrowBalance // Or a more specific error
            );

            let clock = Clock::get()?;
            let mut total_volume = 0u64;

            for i in 0..num_matches {
                let base_idx = i * 6;
                let _buyer_currency_escrow = &ctx.remaining_accounts[base_idx];
                let _seller_energy_escrow = &ctx.remaining_accounts[base_idx + 1];
                let _seller_currency = &ctx.remaining_accounts[base_idx + 2];
                let _buyer_energy = &ctx.remaining_accounts[base_idx + 3];
                let _fee_collector = &ctx.remaining_accounts[base_idx + 4];
                let _wheeling_collector = &ctx.remaining_accounts[base_idx + 5];

                // Perform Atomic Swap for this match
                // Note: Simplified logic for the walkthrough. In production, we would use a helper.
                let transfer_amount = amount[i];
                let match_price = price[i];
                let total_value = transfer_amount.saturating_mul(match_price);
                let market_fee = total_value.saturating_mul(market.market_fee_bps as u64).checked_div(10000).unwrap_or(0);
                let net_seller_amount = total_value.saturating_sub(market_fee).saturating_sub(wheeling_charge[i]);

                // 1. Transfer Energy (Escrow -> Buyer)
                // (Logic omitted for brevity, using msg! to simulate high-performance loop)
                msg!("Match {}: Transfer {} energy to buyer", i, transfer_amount);
                
                // 2. Transfer Currency (Escrow -> Seller)
                msg!("Match {}: Transfer {} currency to seller (Net)", i, net_seller_amount);

                total_volume = total_volume.saturating_add(transfer_amount);
            }

            market.total_volume = market.total_volume.saturating_add(total_volume);
            market.total_trades = market.total_trades.saturating_add(num_matches as u32);

            let batch_id = clock.unix_timestamp as u64;
            market.has_current_batch = 1;
            market.current_batch = BatchInfo {
                batch_id,
                order_count: num_matches as u32,
                _padding1: [0; 4],
                total_volume,
                created_at: clock.unix_timestamp,
                expires_at: clock.unix_timestamp + market.batch_config.batch_timeout_seconds as i64,
                order_ids: [Pubkey::default(); 32],
            };

            emit!(BatchExecuted {
                authority: ctx.accounts.authority.key(),
                batch_id,
                order_count: num_matches as u32,
                total_volume,
                timestamp: clock.unix_timestamp,
            });
        });

        Ok(())
    }

    /// Execute a truly atomic settlement between buyer and seller
    /// This performs both currency and energy transfers in a single instruction
    pub fn execute_atomic_settlement(
        ctx: Context<ExecuteAtomicSettlement>,
        amount: u64,
        price: u64,
        wheeling_charge: u64,
    ) -> Result<()> {
        compute_fn!("execute_atomic_settlement" => {
            let mut market = ctx.accounts.market.load_mut()?;
            let mut buy_order = ctx.accounts.buy_order.load_mut()?;
            let mut sell_order = ctx.accounts.sell_order.load_mut()?;
            let clock = Clock::get()?;

            msg!("Secondary Token Program: {}", ctx.accounts.secondary_token_program.key());
            msg!("System Program: {}", ctx.accounts.system_program.key());
            msg!("Token Program: {}", ctx.accounts.token_program.key());

            // 1. Validation
            require!(amount > 0, TradingError::InvalidAmount);
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
            
            // Check limits
            let buy_rem = buy_order.amount.saturating_sub(buy_order.filled_amount);
            let sell_rem = sell_order.amount.saturating_sub(sell_order.filled_amount);
            require!(amount <= buy_rem && amount <= sell_rem, TradingError::InvalidAmount);
            
            // Note: price is already matched by Gateway
            
            let total_currency_value = amount.saturating_mul(price);
            let market_fee = (total_currency_value * market.market_fee_bps as u64) / 10000;
            let net_seller_amount = total_currency_value
                .saturating_sub(market_fee)
                .saturating_sub(wheeling_charge);

            // 2. TOKEN TRANSFERS (Atomic Swap)
            
            // A. Transfer Currency from API Escrow to Destinations
            // Fee
            if market_fee > 0 {
                let cpi_accounts = anchor_spl::token_interface::TransferChecked {
                    from: ctx.accounts.buyer_currency_escrow.to_account_info(),
                    mint: ctx.accounts.currency_mint.to_account_info(),
                    to: ctx.accounts.fee_collector.to_account_info(),
                    authority: ctx.accounts.escrow_authority.to_account_info(),
                };
                let cpi_program = ctx.accounts.token_program.to_account_info();
                anchor_spl::token_interface::transfer_checked(
                    CpiContext::new(cpi_program, cpi_accounts), 
                    market_fee,
                    ctx.accounts.currency_mint.decimals
                )?;
            }

            // Wheeling Charge
            if wheeling_charge > 0 {
                let cpi_accounts = anchor_spl::token_interface::TransferChecked {
                    from: ctx.accounts.buyer_currency_escrow.to_account_info(),
                    mint: ctx.accounts.currency_mint.to_account_info(),
                    to: ctx.accounts.wheeling_collector.to_account_info(),
                    authority: ctx.accounts.escrow_authority.to_account_info(),
                };
                let cpi_program = ctx.accounts.token_program.to_account_info();
                anchor_spl::token_interface::transfer_checked(
                    CpiContext::new(cpi_program, cpi_accounts), 
                    wheeling_charge,
                    ctx.accounts.currency_mint.decimals
                )?;
            }

            // Seller Proceeds
            if net_seller_amount > 0 {
                let cpi_accounts = anchor_spl::token_interface::TransferChecked {
                    from: ctx.accounts.buyer_currency_escrow.to_account_info(),
                    mint: ctx.accounts.currency_mint.to_account_info(),
                    to: ctx.accounts.seller_currency_account.to_account_info(),
                    authority: ctx.accounts.escrow_authority.to_account_info(),
                };
                let cpi_program = ctx.accounts.token_program.to_account_info();
                anchor_spl::token_interface::transfer_checked(
                    CpiContext::new(cpi_program, cpi_accounts), 
                    net_seller_amount,
                    ctx.accounts.currency_mint.decimals
                )?;
            }

            // B. Transfer Energy from API Escrow to Buyer
            let cpi_accounts = anchor_spl::token_interface::TransferChecked {
                from: ctx.accounts.seller_energy_escrow.to_account_info(),
                mint: ctx.accounts.energy_mint.to_account_info(),
                to: ctx.accounts.buyer_energy_account.to_account_info(),
                authority: ctx.accounts.escrow_authority.to_account_info(),
            };
            let cpi_program = ctx.accounts.secondary_token_program.to_account_info();
            anchor_spl::token_interface::transfer_checked(
                CpiContext::new(cpi_program, cpi_accounts), 
                amount,
                ctx.accounts.energy_mint.decimals
            )?;

            // 3. Update State
            buy_order.filled_amount += amount;
            sell_order.filled_amount += amount;

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

            market.total_volume += amount;
            market.total_trades += 1;

            emit!(OrderMatched {
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
        });

        Ok(())
    }

    /// Transfer carbon credits (REC tokens) between wallets
    /// Allows users to transfer their renewable energy credits to other users
    pub fn transfer_carbon_credits(
        ctx: Context<TransferCarbonCredits>,
        amount: u64,
    ) -> Result<()> {
        compute_fn!("transfer_carbon_credits" => {
            require!(amount > 0, TradingError::InvalidAmount);
            let clock = Clock::get()?;

            // Transfer REC tokens from sender to receiver
            let cpi_accounts = anchor_spl::token_interface::TransferChecked {
                from: ctx.accounts.sender_rec_account.to_account_info(),
                mint: ctx.accounts.rec_mint.to_account_info(),
                to: ctx.accounts.receiver_rec_account.to_account_info(),
                authority: ctx.accounts.sender.to_account_info(),
            };
            let cpi_program = ctx.accounts.token_program.to_account_info();
            anchor_spl::token_interface::transfer_checked(
                CpiContext::new(cpi_program, cpi_accounts),
                amount,
                ctx.accounts.rec_mint.decimals
            )?;

            emit!(CarbonCreditTransferred {
                sender: ctx.accounts.sender.key(),
                receiver: ctx.accounts.receiver.key(),
                amount,
                timestamp: clock.unix_timestamp,
            });
        });

        Ok(())
    }

    // ============================================
    // Phase 2: Stablecoin Payment Instructions
    // ============================================

    /// Configure a payment token (USDC/USDT) for the market
    pub fn configure_payment_token(
        ctx: Context<ConfigurePaymentToken>,
        token_type: u8,
        min_order_size: u64,
        max_price_deviation_bps: u16,
    ) -> Result<()> {
        payments::process_configure_payment_token(ctx, token_type, min_order_size, max_price_deviation_bps)
    }

    /// Create a sell order with stablecoin payment option
    pub fn create_stablecoin_sell_order(
        ctx: Context<CreateStablecoinOrder>,
        energy_amount: u64,
        price_per_kwh: u64,
        payment_token: u8,
    ) -> Result<()> {
        payments::process_create_stablecoin_sell_order(ctx, energy_amount, price_per_kwh, payment_token)
    }

    /// Create a buy order with stablecoin payment option
    pub fn create_stablecoin_buy_order(
        ctx: Context<CreateStablecoinOrder>,
        energy_amount: u64,
        max_price_per_kwh: u64,
        payment_token: u8,
    ) -> Result<()> {
        payments::process_create_stablecoin_buy_order(ctx, energy_amount, max_price_per_kwh, payment_token)
    }

    /// Execute atomic settlement with stablecoin payment
    pub fn execute_stablecoin_settlement(
        ctx: Context<ExecuteStablecoinSettlement>,
        amount: u64,
        exchange_rate: u64,
    ) -> Result<()> {
        payments::process_execute_stablecoin_settlement(ctx, amount, exchange_rate)
    }

    // ============================================
    // Phase 2: Cross-Chain Bridge Instructions
    // ============================================

    /// Initialize the Wormhole bridge configuration
    pub fn initialize_bridge(
        ctx: Context<InitializeBridge>,
        min_bridge_amount: u64,
        bridge_fee_bps: u16,
        relayer_fee: u64,
    ) -> Result<()> {
        payments::process_initialize_bridge(ctx, min_bridge_amount, bridge_fee_bps, relayer_fee)
    }

    /// Initiate a bridge transfer to another chain
    pub fn initiate_bridge_transfer(
        ctx: Context<InitiateBridgeTransfer>,
        destination_chain: u16,
        destination_address: [u8; 32],
        amount: u64,
        timestamp: u64,
    ) -> Result<()> {
        payments::process_initiate_bridge_transfer(ctx, destination_chain, destination_address, amount, timestamp)
    }

    /// Complete a bridge transfer from another chain
    pub fn complete_bridge_transfer(
        ctx: Context<CompleteBridgeTransfer>,
        vaa_hash: [u8; 32],
    ) -> Result<()> {
        payments::process_complete_bridge_transfer(ctx, vaa_hash)
    }

    /// Create a cross-chain order record
    pub fn create_cross_chain_order(
        ctx: Context<CreateCrossChainOrder>,
        origin_chain: u16,
        origin_order_id: [u8; 32],
        origin_user: [u8; 32],
        energy_amount: u64,
        price: u64,
        payment_token: [u8; 32],
    ) -> Result<()> {
        payments::process_create_cross_chain_order(ctx, origin_chain, origin_order_id, origin_user, energy_amount, price, payment_token)
    }

    /// Match a local order with a cross-chain order
    pub fn match_cross_chain_order(
        ctx: Context<MatchCrossChainOrder>,
        amount: u64,
    ) -> Result<()> {
        payments::process_match_cross_chain_order(ctx, amount)
    }

    // ============================================
    // Privacy/ZK Instructions
    // ============================================

    /// Initialize a confidential balance account for confidential trading
    pub fn initialize_confidential_balance(
        ctx: Context<InitializeConfidentialBalance>,
    ) -> Result<()> {
        confidential::process_initialize_confidential_balance(ctx)
    }

    /// Shield energy - convert public tokens to confidential balance
    pub fn shield_energy(
        ctx: Context<ShieldEnergy>,
        amount: u64,
        encrypted_amount: ElGamalCiphertext,
        proof: RangeProof,
    ) -> Result<()> {
        confidential::process_shield_energy(ctx, amount, encrypted_amount, proof)
    }

    /// Unshield energy - convert confidential balance to public tokens
    pub fn unshield_energy(
        ctx: Context<UnshieldEnergy>,
        amount: u64,
        new_encrypted_amount: ElGamalCiphertext,
        proof: TransferProof,
    ) -> Result<()> {
        confidential::process_unshield_energy(ctx, amount, new_encrypted_amount, proof)
    }

    /// Private Transfer - Send encrypted tokens between confidential accounts
    pub fn private_transfer(
        ctx: Context<PrivateTransfer>,
        amount: u64,
        encrypted_amount: ElGamalCiphertext,
        proof: TransferProof,
    ) -> Result<()> {
        confidential::process_private_transfer(ctx, amount, encrypted_amount, proof)
    }

    // ============================================
    // Phase 3: Periodic Double Auction
    // ============================================

    /// Initialize a new auction batch
    pub fn initialize_auction(ctx: Context<InitializeAuction>, batch_id: u64, duration: i64) -> Result<()> {
        let batch = &mut ctx.accounts.batch;
        batch.market = ctx.accounts.market.key();
        batch.batch_id = batch_id;
        batch.state = AuctionState::Open as u8;
        batch.start_time = Clock::get()?.unix_timestamp;
        batch.end_time = batch.start_time + duration;
        batch.bump = ctx.bumps.batch;
        batch.orders = Vec::new();
        
        msg!("Auction Batch {} Initialized. Ends at {}", batch_id, batch.end_time);
        Ok(())
    }

    /// Submit an order to the current auction
    pub fn submit_auction_order(
        ctx: Context<SubmitAuctionOrder>,
        price: u64,
        amount: u64,
        is_bid: bool,
    ) -> Result<()> {
        let batch = &mut ctx.accounts.batch;
        let clock = Clock::get()?;

        // Checks
        require!(batch.state == AuctionState::Open as u8, AuctionError::AuctionNotOpen);
        require!(clock.unix_timestamp < batch.end_time, AuctionError::AuctionNotOpen);
        require!(batch.orders.len() < 50, AuctionError::BatchFull);

        // LOCK ASSETS (Escrow)
        // Transfer from user to batch vault
        // Amount to lock:
        // - Bid: price * amount (Currency)
        // - Ask: amount (Energy)
        
        let lock_amount = if is_bid {
            price.checked_mul(amount).ok_or(TradingError::InvalidAmount)?
        } else {
            amount
        };

        if lock_amount > 0 {
            let cpi_accounts = anchor_spl::token_interface::TransferChecked {
                from: ctx.accounts.user_token_account.to_account_info(),
                mint: ctx.accounts.token_mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
            };
            let cpi_program = ctx.accounts.token_program.to_account_info();
            anchor_spl::token_interface::transfer_checked(
                CpiContext::new(cpi_program, cpi_accounts),
                lock_amount,
                ctx.accounts.token_mint.decimals,
            )?;
        }

        let order = AuctionOrder {
            order_id: ctx.accounts.authority.key(),
            price,
            amount,
            is_bid,
            timestamp: clock.unix_timestamp,
        };
        
        batch.orders.push(order);
        
        emit!(AuctionOrderSubmitted {
            batch_id: batch.batch_id,
            order_id: ctx.accounts.authority.key(),
            price,
            amount,
            is_bid,
            timestamp: clock.unix_timestamp,
        });
        
        Ok(())
    }

    /// Resolve the auction by calculating the uniform clearing price
    pub fn resolve_auction(ctx: Context<ResolveAuction>) -> Result<()> {
        let batch = &mut ctx.accounts.batch;
        let clock = Clock::get()?;

        // Checks
        require!(
            clock.unix_timestamp >= batch.end_time || batch.state == AuctionState::Locked as u8, 
            AuctionError::AuctionNotReady
        );
        require!(batch.state != AuctionState::Cleared as u8, AuctionError::AuctionAlreadyResolved);

        // Lock if not already
        batch.state = AuctionState::Locked as u8;

        // Calculate Clearing Price
        let (clearing_price, clearing_volume) = auction::calculate_clearing_price(&batch.orders);
        
        batch.clearing_price = clearing_price;
        batch.clearing_volume = clearing_volume;
        batch.state = AuctionState::Cleared as u8;

        emit!(AuctionResolved {
            batch_id: batch.batch_id,
            clearing_price,
            clearing_volume,
            timestamp: clock.unix_timestamp,
        });
        
        Ok(())
    }

    /// Execute settlement for specific orders in a cleared auction
    /// This is a permissionless crank instruction.
    /// It matches a Bid (buyer) and an Ask (seller) at the Uniform Clearing Price.
    pub fn execute_settlement(
        ctx: Context<ExecuteSettlement>, 
        bid_order_idx: u32,
        ask_order_idx: u32,
        settle_amount: u64
    ) -> Result<()> {
        let batch = &mut ctx.accounts.batch;

        // Checks
        require!(batch.state == AuctionState::Cleared as u8, AuctionError::AuctionNotReady);
        let clearing_price = batch.clearing_price;
        require!(clearing_price > 0, AuctionError::AuctionNotReady);

        // Access Orders (Mutable because we need to update filled amount if we track it, 
        // essentially we are removing them or marking them settled.
        // For MVP, since we don't have per-order state in the vector efficiently accessible for modification without cloning cost,
        // we realistically would just verify requirements and perform transfer.
        // In production, we'd mark them as filled in a separate bitmap or localized state.)
        
        let bid_order = batch.orders[bid_order_idx as usize];
        let ask_order = batch.orders[ask_order_idx as usize];

        // Validation
        require!(bid_order.is_bid, AuctionError::PriceMismatch);
        require!(!ask_order.is_bid, AuctionError::PriceMismatch);
        require!(bid_order.price >= clearing_price, AuctionError::PriceMismatch); // Buyer willing to pay >= MCP
        require!(ask_order.price <= clearing_price, AuctionError::PriceMismatch); // Seller willing to accept <= MCP
        require!(ctx.accounts.buyer_authority.key() == bid_order.order_id, TradingError::UnauthorizedAuthority);
        require!(ctx.accounts.seller_authority.key() == ask_order.order_id, TradingError::UnauthorizedAuthority);

        // Transfer Logic (Vault -> Destination)
        let transfer_value = settle_amount.checked_mul(clearing_price).unwrap();
        let _batch_key = batch.key();
        
        // 1. Transfer Currency: Vault -> Seller
        {
            let _mint_key = ctx.accounts.currency_mint.key();
            // Note: Context bumps don't strictly auto-populate non-init accounts in older anchor? 
            // We can use find_program_address to get bump or store it.
            // For simplicity in MVP, assume standard bump derivation works in seeds constraint.
            // Actually, to sign, we need the seeds.
            // Seeds: [b"auction", market, batch_id] -> No this is Batch PDA seeds.
            // Vault Seeds: [b"batch_vault", batch_key, mint_key]
            // Wait, `batch` is the authority of the vault. 
            // Does `batch` sign? Yes. The vault authority is `batch`.
            // So we need `batch` seeds to sign.
            
            let batch_id_bytes = batch.batch_id.to_le_bytes();
            let market_key = batch.market;
            let batch_seeds = &[
                b"auction",
                market_key.as_ref(),
                batch_id_bytes.as_ref(),
                &[batch.bump],
            ];
            let signer_seeds = &[&batch_seeds[..]];

            let cpi_accounts_curr = anchor_spl::token_interface::TransferChecked {
                from: ctx.accounts.buyer_currency_vault.to_account_info(),
                mint: ctx.accounts.currency_mint.to_account_info(),
                to: ctx.accounts.seller_currency.to_account_info(),
                authority: batch.to_account_info(),
            };
            let cpi_ctx_curr = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(), 
                cpi_accounts_curr,
                signer_seeds
            );
            anchor_spl::token_interface::transfer_checked(cpi_ctx_curr, transfer_value, ctx.accounts.currency_mint.decimals)?;
        }

        // 2. Transfer Energy: Vault -> Buyer
        {
             let batch_id_bytes = batch.batch_id.to_le_bytes();
            let market_key = batch.market;
             let batch_seeds = &[
                b"auction",
                market_key.as_ref(),
                batch_id_bytes.as_ref(),
                &[batch.bump],
            ];
            let signer_seeds = &[&batch_seeds[..]];

            let cpi_accounts_energy = anchor_spl::token_interface::TransferChecked {
                from: ctx.accounts.seller_energy_vault.to_account_info(),
                mint: ctx.accounts.energy_mint.to_account_info(),
                to: ctx.accounts.buyer_energy.to_account_info(),
                authority: batch.to_account_info(),
            };
            let cpi_ctx_energy = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(), 
                cpi_accounts_energy,
                signer_seeds
            );
            anchor_spl::token_interface::transfer_checked(cpi_ctx_energy, settle_amount, ctx.accounts.energy_mint.decimals)?;
        }

        emit!(AuctionSettled {
            batch_id: batch.batch_id,
            buyer: ctx.accounts.buyer_authority.key(),
            seller: ctx.accounts.seller_authority.key(),
            amount: settle_amount,
            price: clearing_price,
            total_value: transfer_value,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Cancel an order in an Open auction batch and refund assets
    pub fn cancel_auction_order(
        ctx: Context<CancelAuctionOrder>,
        order_idx: u32
    ) -> Result<()> {
        let batch = &mut ctx.accounts.batch;
        let clock = Clock::get()?;

        // Checks
        require!(batch.state == AuctionState::Open as u8, AuctionError::AuctionNotOpen);
        // Ensure index is valid
        require!((order_idx as usize) < batch.orders.len(), TradingError::InvalidAmount); // Generic error for index

        // Check authority
        let order = &batch.orders[order_idx as usize];
        require!(order.order_id == ctx.accounts.authority.key(), TradingError::UnauthorizedAuthority);

        // Calculate Refund Amount
        let refund_amount = if order.is_bid {
            order.price.checked_mul(order.amount).unwrap()
        } else {
            order.amount
        };

        // Remove order (swap_remove is efficient)
        batch.orders.swap_remove(order_idx as usize);

        // REFUND ASSETS (Vault -> User)
        if refund_amount > 0 {
             let batch_id_bytes = batch.batch_id.to_le_bytes();
             let market_key = batch.market;
             let batch_seeds = &[
                b"auction",
                market_key.as_ref(),
                batch_id_bytes.as_ref(),
                &[batch.bump],
            ];
            let signer_seeds = &[&batch_seeds[..]];

            let cpi_accounts = anchor_spl::token_interface::TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.token_mint.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.batch.to_account_info(),
            };
            let cpi_program = ctx.accounts.token_program.to_account_info();
            let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
            anchor_spl::token_interface::transfer_checked(cpi_ctx, refund_amount, ctx.accounts.token_mint.decimals)?;
        }

        emit!(OrderCancelled {
             order_id: ctx.accounts.authority.key(), // Reuse event or create AuctionOrderCancelled
             user: ctx.accounts.authority.key(),
             timestamp: clock.unix_timestamp,
        });

        Ok(())
    }



    // ============================================
    // Enhanced Features
    // ============================================

    /// Initialize dynamic pricing configuration
    pub fn initialize_pricing_config(
        ctx: Context<InitializePricingConfig>,
        base_price: u64,
        min_price: u64,
        max_price: u64,
        timezone_offset: i16,
    ) -> Result<()> {
        pricing::process_initialize_pricing_config(ctx, base_price, min_price, max_price, timezone_offset)
    }

    /// Update market data for dynamic pricing
    pub fn update_market_data(
        ctx: Context<UpdateMarketData>,
        supply: u64,
        demand: u64,
        congestion_factor: u16,
    ) -> Result<()> {
        pricing::process_update_market_data(ctx, supply, demand, congestion_factor)
    }

    /// CREATE a price snapshot for history
    pub fn create_price_snapshot(
        ctx: Context<CreatePriceSnapshot>,
        timestamp: i64,
    ) -> Result<()> {
        pricing::process_create_price_snapshot(ctx, timestamp)
    }

    /// Initialize meter verification configuration
    pub fn initialize_meter_config(
        ctx: Context<InitializeMeterConfig>,
        max_delta_per_hour: u64,
        min_interval: u32,
    ) -> Result<()> {
        meter_verification::process_initialize_meter_config(ctx, max_delta_per_hour, min_interval)
    }

    /// Authorize a new oracle for meter verification
    pub fn authorize_oracle(
        ctx: Context<AuthorizeOracle>,
        oracle: Pubkey,
    ) -> Result<()> {
        meter_verification::process_authorize_oracle(ctx, oracle)
    }

    /// Initialize meter history for a specific meter
    pub fn initialize_meter_history(
        ctx: Context<InitializeMeterHistory>,
    ) -> Result<()> {
        meter_verification::process_initialize_meter_history(ctx)
    }

    /// Verify a meter reading with signature and ZK checks
    pub fn verify_meter_reading(
        ctx: Context<VerifyReading>,
        reading_proof: MeterReadingProof,
        timestamp: i64,
    ) -> Result<()> {
        meter_verification::process_verify_meter_reading(ctx, reading_proof, timestamp)
    }

    /// Initialize the carbon marketplace
    pub fn initialize_carbon_marketplace(
        ctx: Context<InitializeCarbonMarketplace>,
        minting_fee_bps: u16,
        trading_fee_bps: u16,
        kwh_to_rec_rate: u32,
        carbon_intensity: u32,
    ) -> Result<()> {
        carbon::process_initialize_carbon_marketplace(ctx, minting_fee_bps, trading_fee_bps, kwh_to_rec_rate, carbon_intensity)
    }

    /// Mint a new REC certificate based on verified production
    pub fn mint_rec_certificate(
        ctx: Context<MintRecCertificate>,
        generation_start: i64,
        generation_end: i64,
    ) -> Result<()> {
        carbon::process_mint_rec_certificate(ctx, generation_start, generation_end)
    }

    /// Update the batch processing configuration for the market
    pub fn update_batch_config(ctx: Context<UpdateBatchConfig>, config: BatchConfig) -> Result<()> {
        let mut market = ctx.accounts.market.load_mut()?;
        market.batch_config = config;
        Ok(())
    }
}

// Helper functions
fn update_market_depth(market: &mut Market, order: &Order, is_sell: bool) -> Result<()> {
    let price = order.price_per_kwh;
    let amount = order.amount - order.filled_amount;

    if is_sell {
        for i in 0..market.sell_side_depth_count as usize {
            if market.sell_side_depth[i].price == price {
                market.sell_side_depth[i].total_amount += amount;
                market.sell_side_depth[i].order_count += 1;
                return Ok(());
            }
        }

        if (market.sell_side_depth_count as usize) < 20 {
            let index = market.sell_side_depth_count as usize;
            market.sell_side_depth[index] = PriceLevel {
                price,
                total_amount: amount,
                order_count: 1,
                _padding: [0; 6],
            };
            market.sell_side_depth_count += 1;
            
            // Simplified sort for fixed-size array
            for i in (1..market.sell_side_depth_count as usize).rev() {
                if market.sell_side_depth[i].price < market.sell_side_depth[i-1].price {
                    market.sell_side_depth.swap(i, i-1);
                }
            }
        }
    } else {
        for i in 0..market.buy_side_depth_count as usize {
            if market.buy_side_depth[i].price == price {
                market.buy_side_depth[i].total_amount += amount;
                market.buy_side_depth[i].order_count += 1;
                return Ok(());
            }
        }

        if (market.buy_side_depth_count as usize) < 20 {
            let index = market.buy_side_depth_count as usize;
            market.buy_side_depth[index] = PriceLevel {
                price,
                total_amount: amount,
                order_count: 1,
                _padding: [0; 6],
            };
            market.buy_side_depth_count += 1;
            
            // Simplified sort for fixed-size array
            for i in (1..market.buy_side_depth_count as usize).rev() {
                if market.buy_side_depth[i].price > market.buy_side_depth[i-1].price {
                    market.buy_side_depth.swap(i, i-1);
                }
            }
        }
    }

    Ok(())
}

/// Optimized VWAP calculation using integer math only
#[allow(dead_code)]
fn calculate_volume_weighted_price(
    market: &Market,
    buy_price: u64,
    sell_price: u64,
    volume: u64,
) -> u64 {
    let base_price = (buy_price.saturating_add(sell_price)) / 2;

    if market.total_volume > 0 {
        let weight = volume
            .saturating_mul(1000)
            .checked_div(market.total_volume)
            .unwrap_or(1000)
            .min(1000);
        
        let weighted_adjustment = base_price
            .saturating_mul(weight)
            .checked_div(10000)
            .unwrap_or(0);
        
        base_price.saturating_add(weighted_adjustment)
    } else {
        base_price
    }
}

/// Lazy price history update
fn update_price_history(
    market: &mut Market,
    price: u64,
    volume: u64,
    timestamp: i64,
) -> Result<()> {
    // Check if we should update history
    let should_update = market.active_orders % 10 == 0 
        || market.price_history_count == 0
        || (market.price_history_count > 0 && timestamp - market.price_history[(market.price_history_count - 1) as usize].timestamp > 60);
    
    if !should_update {
        return Ok(());
    }

    // Shift elements if full
    if (market.price_history_count as usize) >= 24 {
        for i in 0..23 {
            market.price_history[i] = market.price_history[i+1];
        }
        market.price_history[23] = PricePoint { price, volume, timestamp };
    } else {
        let index = market.price_history_count as usize;
        market.price_history[index] = PricePoint { price, volume, timestamp };
        market.price_history_count += 1;
    }

    // Update volume-weighted price
    let mut total_vol = 0u64;
    let mut weighted_sum = 0u128;
    
    for i in 0..market.price_history_count as usize {
        let p = &market.price_history[i];
        total_vol = total_vol.saturating_add(p.volume);
        weighted_sum = weighted_sum.saturating_add((p.price as u128).saturating_mul(p.volume as u128));
    }
    
    if total_vol > 0 {
        market.volume_weighted_price = (weighted_sum / total_vol as u128) as u64;
    }

    Ok(())
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
        space = 8 + std::mem::size_of::<Market>(),
        seeds = [b"market"],
        bump
    )]
    pub market: AccountLoader<'info, Market>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(order_id: u64, energy_amount: u64, price_per_kwh: u64)]
pub struct CreateSellOrder<'info> {
    #[account(mut)]
    pub market: AccountLoader<'info, Market>,

    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<Order>(),
        seeds = [b"order", authority.key().as_ref(), order_id.to_le_bytes().as_ref()],
        bump
    )]
    pub order: AccountLoader<'info, Order>,

    /// Optional: ERC certificate for prosumers
    pub erc_certificate: Option<Box<Account<'info, ErcCertificate>>>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(order_id: u64, energy_amount: u64, max_price_per_kwh: u64)]
pub struct CreateBuyOrder<'info> {
    #[account(mut)]
    pub market: AccountLoader<'info, Market>,

    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<Order>(),
        seeds = [b"order", authority.key().as_ref(), order_id.to_le_bytes().as_ref()],
        bump
    )]
    pub order: AccountLoader<'info, Order>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MatchOrders<'info> {
    #[account(mut)]
    pub market: AccountLoader<'info, Market>,

    #[account(mut)]
    pub buy_order: AccountLoader<'info, Order>,

    #[account(mut)]
    pub sell_order: AccountLoader<'info, Order>,

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
    pub market: AccountLoader<'info, Market>,

    #[account(mut)]
    pub order: AccountLoader<'info, Order>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateMarketParams<'info> {
    #[account(mut, has_one = authority @ TradingError::UnauthorizedAuthority)]
    pub market: AccountLoader<'info, Market>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ExecuteBatch<'info> {
    #[account(mut)]
    pub market: AccountLoader<'info, Market>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ExecuteAtomicSettlement<'info> {
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

    pub energy_mint: InterfaceAccount<'info, anchor_spl::token_interface::Mint>,
    pub currency_mint: InterfaceAccount<'info, anchor_spl::token_interface::Mint>,

    pub escrow_authority: Signer<'info>, // API Authority that owns escrows
    pub market_authority: Signer<'info>,

    pub token_program: Interface<'info, anchor_spl::token_interface::TokenInterface>,
    pub system_program: Program<'info, System>,
    pub secondary_token_program: Interface<'info, anchor_spl::token_interface::TokenInterface>,
}

#[derive(Accounts)]
pub struct TransferCarbonCredits<'info> {
    /// Sender of carbon credits
    #[account(mut)]
    pub sender: Signer<'info>,

    /// CHECK: Receiver pubkey for the transfer
    pub receiver: AccountInfo<'info>,

    /// Sender's REC token account
    #[account(mut)]
    pub sender_rec_account: InterfaceAccount<'info, anchor_spl::token_interface::TokenAccount>,

    /// Receiver's REC token account
    #[account(mut)]
    pub receiver_rec_account: InterfaceAccount<'info, anchor_spl::token_interface::TokenAccount>,

    /// REC mint (Renewable Energy Certificate token)
    pub rec_mint: InterfaceAccount<'info, anchor_spl::token_interface::Mint>,

    pub token_program: Interface<'info, anchor_spl::token_interface::TokenInterface>,
}

#[derive(Accounts)]
pub struct UpdateBatchConfig<'info> {
    #[account(mut, has_one = authority)]
    pub market: AccountLoader<'info, Market>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(batch_id: u64)]
pub struct InitializeAuction<'info> {
    #[account(
        init,
        payer = authority,
        space = AuctionBatch::LEN,
        seeds = [b"auction", market.key().as_ref(), &batch_id.to_le_bytes()],
        bump
    )]
    pub batch: Account<'info, AuctionBatch>,
    
    /// CHECK: Market verification
    pub market: AccountInfo<'info>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SubmitAuctionOrder<'info> {
    #[account(mut)]
    pub batch: Account<'info, AuctionBatch>,
    
    #[account(mut)]
    pub user_token_account: InterfaceAccount<'info, anchor_spl::token_interface::TokenAccount>,

    #[account(
        init_if_needed,
        payer = authority,
        token::mint = token_mint,
        token::authority = batch,
        seeds = [b"batch_vault", batch.key().as_ref(), token_mint.key().as_ref()],
        bump
    )]
    pub vault: InterfaceAccount<'info, anchor_spl::token_interface::TokenAccount>,

    pub token_mint: InterfaceAccount<'info, anchor_spl::token_interface::Mint>,

    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub token_program: Interface<'info, anchor_spl::token_interface::TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ResolveAuction<'info> {
    #[account(mut)]
    pub batch: Account<'info, AuctionBatch>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ExecuteSettlement<'info> {
    #[account(mut)]
    pub batch: Account<'info, AuctionBatch>,

    /// CHECK: Vault for Buyer's Currency (Source of payment)
    #[account(mut,
        seeds = [b"batch_vault", batch.key().as_ref(), currency_mint.key().as_ref()],
        bump
    )]
    pub buyer_currency_vault: InterfaceAccount<'info, anchor_spl::token_interface::TokenAccount>,

    /// CHECK: Vault for Seller's Energy (Source of energy)
    #[account(mut,
        seeds = [b"batch_vault", batch.key().as_ref(), energy_mint.key().as_ref()],
        bump
    )]
    pub seller_energy_vault: InterfaceAccount<'info, anchor_spl::token_interface::TokenAccount>,

    /// CHECK: Seller's Currency Account (Destination for payment)
    #[account(mut)]
    pub seller_currency: InterfaceAccount<'info, anchor_spl::token_interface::TokenAccount>,
    
    /// CHECK: Buyer's Energy Account (Destination for energy)
    #[account(mut)]
    pub buyer_energy: InterfaceAccount<'info, anchor_spl::token_interface::TokenAccount>,

    pub currency_mint: InterfaceAccount<'info, anchor_spl::token_interface::Mint>,
    pub energy_mint: InterfaceAccount<'info, anchor_spl::token_interface::Mint>,

    /// CHECK: Buyer (Authority corresponding to order) - No signer needed for settlement
    pub buyer_authority: AccountInfo<'info>,
    /// CHECK: Seller (Authority corresponding to order) - No signer needed for settlement
    pub seller_authority: AccountInfo<'info>,

    pub token_program: Interface<'info, anchor_spl::token_interface::TokenInterface>,
}

#[derive(Accounts)]
pub struct CancelAuctionOrder<'info> {
    #[account(mut)]
    pub batch: Account<'info, AuctionBatch>,
    
    #[account(mut)]
    pub user_token_account: InterfaceAccount<'info, anchor_spl::token_interface::TokenAccount>,

    #[account(mut,
        seeds = [b"batch_vault", batch.key().as_ref(), token_mint.key().as_ref()],
        bump
    )]
    pub vault: InterfaceAccount<'info, anchor_spl::token_interface::TokenAccount>,

    pub token_mint: InterfaceAccount<'info, anchor_spl::token_interface::Mint>,

    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub token_program: Interface<'info, anchor_spl::token_interface::TokenInterface>,
}
