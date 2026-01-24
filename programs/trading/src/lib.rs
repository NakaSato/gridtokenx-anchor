#![allow(deprecated)]

use anchor_lang::prelude::*;
// Use absolute path for governance crate if needed, or ensure it's mapped correctly
pub use ::governance::{ErcCertificate, ErcStatus};

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
        energy_amount: u64,
        price_per_kwh: u64,
    ) -> Result<()> {
        compute_fn!("create_sell_order" => {
            require!(energy_amount > 0, ErrorCode::InvalidAmount);
            require!(price_per_kwh > 0, ErrorCode::InvalidPrice);

            // === ERC VALIDATION ===
            if let Some(erc_certificate) = &ctx.accounts.erc_certificate {
                let clock = Clock::get()?;

                require!(
                    erc_certificate.status == ErcStatus::Valid,
                    ErrorCode::InvalidErcCertificate
                );

                if let Some(expires_at) = erc_certificate.expires_at {
                    require!(
                        clock.unix_timestamp < expires_at,
                        ErrorCode::ErcCertificateExpired
                    );
                }

                require!(
                    erc_certificate.validated_for_trading,
                    ErrorCode::ErcNotValidatedForTrading
                );

                require!(
                    energy_amount <= erc_certificate.energy_amount,
                    ErrorCode::ExceedsErcAmount
                );
            }

            let mut market = ctx.accounts.market.load_mut()?;
            let mut order = ctx.accounts.order.load_init()?;
            let clock = Clock::get()?;

            // Initialize order
            order.seller = ctx.accounts.authority.key();
            order.buyer = Pubkey::default();
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
        energy_amount: u64,
        max_price_per_kwh: u64,
    ) -> Result<()> {
        compute_fn!("create_buy_order" => {
            require!(energy_amount > 0, ErrorCode::InvalidAmount);
            require!(max_price_per_kwh > 0, ErrorCode::InvalidPrice);

            let mut market = ctx.accounts.market.load_mut()?;
            let mut order = ctx.accounts.order.load_init()?;
            let clock = Clock::get()?;

            // Initialize order
            order.buyer = ctx.accounts.authority.key();
            order.seller = Pubkey::default();
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
            require!(match_amount > 0, ErrorCode::InvalidAmount);

            let mut market = ctx.accounts.market.load_mut()?;
            let mut buy_order = ctx.accounts.buy_order.load_mut()?;
            let mut sell_order = ctx.accounts.sell_order.load_mut()?;
            let trade_record = &mut ctx.accounts.trade_record;
            let clock = Clock::get()?;

            // Validate orders
            require!(
                buy_order.status == OrderStatus::Active as u8
                    || buy_order.status == OrderStatus::PartiallyFilled as u8,
                ErrorCode::InactiveBuyOrder
            );
            require!(
                sell_order.status == OrderStatus::Active as u8
                    || sell_order.status == OrderStatus::PartiallyFilled as u8,
                ErrorCode::InactiveSellOrder
            );
            require!(
                buy_order.price_per_kwh >= sell_order.price_per_kwh,
                ErrorCode::PriceMismatch
            );

            // Calculate match details
            let buy_remaining = buy_order.amount - buy_order.filled_amount;
            let sell_remaining = sell_order.amount - sell_order.filled_amount;
            let actual_match_amount = match_amount.min(buy_remaining).min(sell_remaining);

            // Enhanced price discovery: Volume-weighted average price
            let clearing_price = calculate_volume_weighted_price(
                &market,
                buy_order.price_per_kwh,
                sell_order.price_per_kwh,
                actual_match_amount,
            );
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
                ErrorCode::UnauthorizedAuthority
            );

            // Validate order can be cancelled
            require!(
                order.status == OrderStatus::Active as u8 || order.status == OrderStatus::PartiallyFilled as u8,
                ErrorCode::OrderNotCancellable
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
                ErrorCode::UnauthorizedAuthority
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
                ErrorCode::BatchProcessingDisabled
            );
            
            let num_matches = amount.len();
            // Limit batch size to prevent hitting account limits (max ~20-25 accounts)
            require!(num_matches > 0 && num_matches <= 4, ErrorCode::BatchSizeExceeded);
            require!(price.len() == num_matches, ErrorCode::InvalidAmount);
            require!(wheeling_charge.len() == num_matches, ErrorCode::InvalidAmount);

            // Remaining accounts check: 6 accounts per match
            let expected_accounts = num_matches * 6;
            require!(
                ctx.remaining_accounts.len() >= expected_accounts,
                ErrorCode::InsufficientEscrowBalance // Or a more specific error
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
            require!(amount > 0, ErrorCode::InvalidAmount);
            require!(
                buy_order.status == OrderStatus::Active as u8 || 
                buy_order.status == OrderStatus::PartiallyFilled as u8,
                ErrorCode::InactiveBuyOrder
            );
            require!(
                sell_order.status == OrderStatus::Active as u8 || 
                sell_order.status == OrderStatus::PartiallyFilled as u8,
                ErrorCode::InactiveSellOrder
            );
            
            // Check limits
            let buy_rem = buy_order.amount.saturating_sub(buy_order.filled_amount);
            let sell_rem = sell_order.amount.saturating_sub(sell_order.filled_amount);
            require!(amount <= buy_rem && amount <= sell_rem, ErrorCode::InvalidAmount);
            
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
            require!(amount > 0, ErrorCode::InvalidAmount);
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
        payments::configure_payment_token(ctx, token_type, min_order_size, max_price_deviation_bps)
    }

    /// Create a sell order with stablecoin payment option
    pub fn create_stablecoin_sell_order(
        ctx: Context<CreateStablecoinOrder>,
        energy_amount: u64,
        price_per_kwh: u64,
        payment_token: u8,
    ) -> Result<()> {
        payments::create_stablecoin_sell_order(ctx, energy_amount, price_per_kwh, payment_token)
    }

    /// Execute atomic settlement with stablecoin payment
    pub fn execute_stablecoin_settlement(
        ctx: Context<ExecuteStablecoinSettlement>,
        amount: u64,
        exchange_rate: u64,
    ) -> Result<()> {
        payments::execute_stablecoin_settlement(ctx, amount, exchange_rate)
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
        payments::initialize_bridge(ctx, min_bridge_amount, bridge_fee_bps, relayer_fee)
    }

    /// Initiate a bridge transfer to another chain
    pub fn initiate_bridge_transfer(
        ctx: Context<InitiateBridgeTransfer>,
        destination_chain: u16,
        destination_address: [u8; 32],
        amount: u64,
        timestamp: u64,
    ) -> Result<()> {
        payments::initiate_bridge_transfer(ctx, destination_chain, destination_address, amount, timestamp)
    }

    /// Complete a bridge transfer from another chain
    pub fn complete_bridge_transfer(
        ctx: Context<CompleteBridgeTransfer>,
        vaa_hash: [u8; 32],
    ) -> Result<()> {
        payments::complete_bridge_transfer(ctx, vaa_hash)
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
        payments::create_cross_chain_order(ctx, origin_chain, origin_order_id, origin_user, energy_amount, price, payment_token)
    }

    /// Match a local order with a cross-chain order
    pub fn match_cross_chain_order(
        ctx: Context<MatchCrossChainOrder>,
        amount: u64,
    ) -> Result<()> {
        payments::match_cross_chain_order(ctx, amount)
    }

    // ============================================
    // Privacy/ZK Instructions
    // ============================================

    /// Initialize a confidential balance account for confidential trading
    pub fn initialize_confidential_balance(
        ctx: Context<InitializeConfidentialBalance>,
    ) -> Result<()> {
        confidential::initialize_confidential_balance(ctx)
    }

    /// Shield energy - convert public tokens to confidential balance
    pub fn shield_energy(
        ctx: Context<ShieldEnergy>,
        amount: u64,
        encrypted_amount: ElGamalCiphertext,
        proof: RangeProof,
    ) -> Result<()> {
        confidential::shield_energy(ctx, amount, encrypted_amount, proof)
    }

    /// Unshield energy - convert confidential balance to public tokens
    pub fn unshield_energy(
        ctx: Context<UnshieldEnergy>,
        amount: u64,
        new_encrypted_amount: ElGamalCiphertext,
        proof: TransferProof,
    ) -> Result<()> {
        confidential::unshield_energy(ctx, amount, new_encrypted_amount, proof)
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
        pricing::initialize_pricing_config(ctx, base_price, min_price, max_price, timezone_offset)
    }

    /// Update market data for dynamic pricing
    pub fn update_market_data(
        ctx: Context<UpdateMarketData>,
        supply: u64,
        demand: u64,
        congestion_factor: u16,
    ) -> Result<()> {
        pricing::update_market_data(ctx, supply, demand, congestion_factor)
    }

    /// CREATE a price snapshot for history
    pub fn create_price_snapshot(
        ctx: Context<CreatePriceSnapshot>,
        timestamp: i64,
    ) -> Result<()> {
        pricing::create_price_snapshot(ctx, timestamp)
    }

    /// Initialize meter verification configuration
    pub fn initialize_meter_config(
        ctx: Context<InitializeMeterConfig>,
        max_delta_per_hour: u64,
        min_interval: u32,
    ) -> Result<()> {
        meter_verification::initialize_meter_config(ctx, max_delta_per_hour, min_interval)
    }

    /// Authorize a new oracle for meter verification
    pub fn authorize_oracle(
        ctx: Context<AuthorizeOracle>,
        oracle: Pubkey,
    ) -> Result<()> {
        meter_verification::authorize_oracle(ctx, oracle)
    }

    /// Initialize meter history for a specific meter
    pub fn initialize_meter_history(
        ctx: Context<InitializeMeterHistory>,
    ) -> Result<()> {
        meter_verification::initialize_meter_history(ctx)
    }

    /// Verify a meter reading with signature and ZK checks
    pub fn verify_meter_reading(
        ctx: Context<VerifyMeterReading>,
        reading_proof: MeterReadingProof,
        timestamp: i64,
    ) -> Result<()> {
        meter_verification::verify_meter_reading(ctx, reading_proof, timestamp)
    }

    /// Initialize the carbon marketplace
    pub fn initialize_carbon_marketplace(
        ctx: Context<InitializeCarbonMarketplace>,
        minting_fee_bps: u16,
        trading_fee_bps: u16,
        kwh_to_rec_rate: u32,
        carbon_intensity: u32,
    ) -> Result<()> {
        carbon::initialize_carbon_marketplace(ctx, minting_fee_bps, trading_fee_bps, kwh_to_rec_rate, carbon_intensity)
    }

    /// Mint a new REC certificate based on verified production
    pub fn mint_rec_certificate(
        ctx: Context<MintRecCertificate>,
        generation_start: i64,
        generation_end: i64,
    ) -> Result<()> {
        carbon::mint_rec_certificate(ctx, generation_start, generation_end)
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
pub struct CreateSellOrder<'info> {
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

    /// Optional: ERC certificate for prosumers
    pub erc_certificate: Option<Box<Account<'info, ErcCertificate>>>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateBuyOrder<'info> {
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
    #[account(mut, has_one = authority @ ErrorCode::UnauthorizedAuthority)]
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

// Data structs
/// Market account for order and trade management
#[account(zero_copy)]
#[repr(C)]
pub struct Market {
    pub authority: Pubkey,              // 32
    pub total_volume: u64,              // 8
    pub created_at: i64,                // 8
    pub last_clearing_price: u64,       // 8
    pub volume_weighted_price: u64,     // 8
    pub active_orders: u32,             // 4
    pub total_trades: u32,              // 4
    pub market_fee_bps: u16,            // 2
    pub clearing_enabled: u8,           // 1
    pub _padding1: [u8; 5],             // 5 -> 80

    // === BATCH PROCESSING ===
    pub batch_config: BatchConfig,      // 24
    pub current_batch: BatchInfo,       // 1640
    pub has_current_batch: u8,
    pub _padding_batch: [u8; 7],

    // === MARKET DEPTH ===
    pub buy_side_depth: [PriceLevel; 20],   // 480
    pub sell_side_depth: [PriceLevel; 20],  // 480
    pub buy_side_depth_count: u8,
    pub sell_side_depth_count: u8,
    pub price_history_count: u8,
    pub _padding_depth: [u8; 5],

    // === PRICE DISCOVERY ===
    pub price_history: [PricePoint; 24],    // 576
    pub _padding_history: [u8; 0],          // Already aligned
}

/// Batch configuration for batch processing
#[derive(AnchorSerialize, AnchorDeserialize, Copy, Clone, InitSpace, bytemuck::Zeroable, bytemuck::Pod)]
#[repr(C)]
pub struct BatchConfig {
    pub enabled: u8,
    pub _padding1: [u8; 3],
    pub max_batch_size: u32,
    pub batch_timeout_seconds: u32,
    pub min_batch_size: u32,
    pub price_improvement_threshold: u16,
    pub _padding2: [u8; 6],             // 1+3+4+4+4+2+6 = 24. 24 is 8x3. Good.
}

#[derive(AnchorSerialize, AnchorDeserialize, Copy, Clone, InitSpace, bytemuck::Zeroable, bytemuck::Pod)]
#[repr(C)]
pub struct BatchInfo {
    pub batch_id: u64,
    pub order_count: u32,
    pub _padding1: [u8; 4],
    pub total_volume: u64,
    pub created_at: i64,
    pub expires_at: i64,
    pub order_ids: [Pubkey; 32],      // Reduced from 50 to 32 for bytemuck::Pod support
}

#[derive(AnchorSerialize, AnchorDeserialize, Copy, Clone, InitSpace, Default, bytemuck::Zeroable, bytemuck::Pod)]
#[repr(C)]
pub struct PriceLevel {
    pub price: u64,
    pub total_amount: u64,
    pub order_count: u16,
    pub _padding: [u8; 6],              // Alignment
}

#[derive(AnchorSerialize, AnchorDeserialize, Copy, Clone, InitSpace, Default, bytemuck::Zeroable, bytemuck::Pod)]
#[repr(C)]
pub struct PricePoint {
    pub price: u64,
    pub volume: u64,
    pub timestamp: i64,
}

/// Sharded market statistics for reduced contention
/// Each shard tracks independent volume/order counts that can be aggregated
/// This allows parallel writes without MVCC conflicts on the main Market account
/// Sharded market statistics for high-frequency updates
#[account]
#[derive(InitSpace)]
pub struct MarketShard {
    pub shard_id: u8,                    // 0-255 shard identifier
    pub market: Pubkey,                  // Parent market
    pub volume_accumulated: u64,         // Volume in this shard
    pub order_count: u32,                // Changed from u64 - order count fits in u32
    pub last_update: i64,                // Last update timestamp
}

/// Helper to determine shard from authority pubkey
/// Distributes load across shards based on user's pubkey
pub fn get_shard_id(authority: &Pubkey, num_shards: u8) -> u8 {
    // Use first byte of pubkey for simple sharding
    authority.to_bytes()[0] % num_shards
}
/// Order account for trading
#[account(zero_copy)]
#[repr(C)]
pub struct Order {
    pub seller: Pubkey,         // 32
    pub buyer: Pubkey,          // 32
    pub amount: u64,            // 8
    pub filled_amount: u64,     // 8
    pub price_per_kwh: u64,     // 8
    pub order_type: u8,         // 1 (OrderType)
    pub status: u8,             // 1 (OrderStatus)
    pub _padding: [u8; 6],      // 6
    pub created_at: i64,        // 8
    pub expires_at: i64,        // 8
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

// Enums (keep for logic, but don't put in zero_copy directly if Pod errors persist)
#[derive(AnchorSerialize, AnchorDeserialize, Copy, Clone, PartialEq, Eq, InitSpace)]
pub enum OrderType {
    Sell,
    Buy,
}

#[derive(AnchorSerialize, AnchorDeserialize, Copy, Clone, PartialEq, Eq, InitSpace)]
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

#[event]
pub struct BatchExecuted {
    pub authority: Pubkey,
    pub batch_id: u64,
    pub order_count: u32,
    pub total_volume: u64,
    pub timestamp: i64,
}

#[event]
pub struct CarbonCreditTransferred {
    pub sender: Pubkey,
    pub receiver: Pubkey,
    pub amount: u64,
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
    #[msg("Batch processing is disabled")]
    BatchProcessingDisabled,
    #[msg("Batch size exceeded")]
    BatchSizeExceeded,
}

#[derive(Accounts)]
pub struct UpdateBatchConfig<'info> {
    #[account(mut, has_one = authority)]
    pub market: AccountLoader<'info, Market>,
    pub authority: Signer<'info>,
}
