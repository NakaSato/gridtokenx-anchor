use anchor_lang::prelude::*;

pub mod error;
pub mod events;
pub mod instructions;
pub mod state;
pub mod utils;
#[cfg(feature = "privacy")]
pub mod zk_verify;

// Re-export core types for submodules
pub use crate::error::TradingError;
#[allow(ambiguous_glob_reexports)]
pub use crate::instructions::*;
pub use crate::state::{
    BalanceProof, BatchConfig, BatchInfo, Market, MarketShard, Order, OrderNullifier, OrderStatus,
    OrderType, PriceLevel, PricePoint, TariffConfig, TradeNullifier, TradeRecord, ZoneCapacity,
    ZoneMarket, ZoneMarketShard, ZoneConfig, MAX_DEPTH_LEVELS,
};
pub use crate::utils::get_governance_config;
pub use governance::{ErcCertificate, ErcStatus, GovernanceConfig};

/// Divisor that normalizes an energy `amount` (9-decimal atomic, kWh * 1e9)
/// multiplied by a 6-decimal currency `price` back down to 6-decimal currency
/// base units: `amount * price / 1e9`. Equals the energy mint's decimal factor
/// (10^9). Used by every settlement currency-value computation so the seller is
/// paid the true trade value, not 1e9x it.
pub const ENERGY_AMOUNT_DECIMALS_DIVISOR: u128 = 1_000_000_000;

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

declare_id!("CnWDEUhTvSixeLSyViWgAnnu9YouBAYVGcrrFm1s9WcX");

// ============================================================================
// COMPUTE-UNIT PROFILING MACROS
// ============================================================================
// The real `compute_fn!` / `compute_checkpoint!` live in the `compute-debug`
// crate, which is an optional dependency pulled in only by the `localnet`
// feature (where the macros also emit `sol_log_compute_units` logs). When
// `localnet` is off, that crate is absent, so define crate-wide no-op fallbacks.
// `#[macro_export]` hoists them to the crate root so the `instructions/`
// submodules (declared above this point) can `use crate::{compute_fn, compute_checkpoint}`.
#[cfg(not(feature = "localnet"))]
#[macro_export]
macro_rules! compute_fn {
    ($name:expr => $block:block) => {{ $block }};
}
#[cfg(not(feature = "localnet"))]
#[macro_export]
macro_rules! compute_checkpoint {
    ($name:expr) => {{}};
}

#[cfg(feature = "localnet")]
use compute_debug::{compute_checkpoint, compute_fn};

#[program]
pub mod trading {
    use super::*;

    pub fn initialize_zone_config(
        ctx: Context<InitializeZoneConfig>,
        zone_id: u32,
        incentive_multiplier_bps: u64,
    ) -> Result<()> {
        compute_fn!("initialize_zone_config" => {
            instructions::initialize_zone_config(ctx, zone_id, incentive_multiplier_bps)
        })
    }

    pub fn initialize_program(ctx: Context<InitializeProgram>) -> Result<()> {
        compute_fn!("initialize_program" => {
            instructions::initialize_program(ctx)
        })
    }

    pub fn initialize_market(ctx: Context<InitializeMarketContext>, num_shards: u8) -> Result<()> {
        compute_fn!("initialize_market" => {
            instructions::initialize_market(ctx, num_shards)
        })
    }

    pub fn initialize_zone_market(
        ctx: Context<InitializeZoneMarketContext>,
        zone_id: u32,
        num_shards: u8,
        capacity: u64,
        segment: u8,
    ) -> Result<()> {
        compute_fn!("initialize_zone_market" => {
            instructions::initialize_zone_market(ctx, zone_id, num_shards, capacity, segment)
        })
    }

    pub fn initialize_zone_market_shard(
        ctx: Context<InitializeZoneMarketShardContext>,
        shard_id: u8,
    ) -> Result<()> {
        instructions::initialize_zone_market_shard(ctx, shard_id)
    }

    /// One-time creation of the per-zone `ZoneCapacity` PDA (Tier-A). Holds the cross-zone
    /// `committed_flow` counter moved off `ZoneMarket` so the settle hot path can keep
    /// `ZoneMarket` read-only on intra-zone batches. Idempotent per zone_market.
    pub fn initialize_zone_capacity(ctx: Context<InitializeZoneCapacityContext>) -> Result<()> {
        compute_fn!("initialize_zone_capacity" => {
            instructions::initialize_zone_capacity(ctx)
        })
    }

    pub fn create_sell_order(
        ctx: Context<CreateSellOrderContext>,
        order_id_val: u64,
        energy_amount: u64,
        price_per_kwh: u64,
    ) -> Result<()> {
        compute_fn!("create_sell_order" => {
            instructions::create_sell_order(ctx, order_id_val, energy_amount, price_per_kwh)
        })
    }

    pub fn create_buy_order(
        ctx: Context<CreateBuyOrderContext>,
        order_id_val: u64,
        energy_amount: u64,
        max_price_per_kwh: u64,
    ) -> Result<()> {
        compute_fn!("create_buy_order" => {
            instructions::create_buy_order(ctx, order_id_val, energy_amount, max_price_per_kwh)
        })
    }

    /// Custodial order record (Option A): platform records a buy/sell order PDA on a
    /// user's behalf. The order PDA is seed-bound to [b"order", user, order_id] with
    /// `user` stored as the non-signing authority; the platform `funder` signs + pays
    /// rent. Mirrors create_{buy,sell}_order validation. Off-chain authorization is
    /// enforced by Chain Bridge RBAC (trading-service role only).
    pub fn record_order_custodial(
        ctx: Context<RecordOrderCustodialContext>,
        order_id_val: u64,
        user: Pubkey,
        is_buy: bool,
        energy_amount: u64,
        price_per_kwh: u64,
    ) -> Result<()> {
        compute_fn!("record_order_custodial" => {
            instructions::record_order_custodial(ctx, order_id_val, user, is_buy, energy_amount, price_per_kwh)
        })
    }

    pub fn match_orders(ctx: Context<MatchOrdersContext>, match_amount: u64) -> Result<()> {
        compute_fn!("match_orders" => {
            instructions::match_orders(ctx, match_amount)
        })
    }

    pub fn sharded_match_orders(
        ctx: Context<ShardedMatchOrdersContext>,
        match_amount: u64,
        shard_id: u8,
    ) -> Result<()> {
        instructions::sharded_match_orders(ctx, match_amount, shard_id)
    }

    pub fn cancel_order(ctx: Context<CancelOrderContext>) -> Result<()> {
        compute_fn!("cancel_order" => {
            instructions::cancel_order(ctx)
        })
    }

    /// Move public tokens INTO a shielded balance (amount is public).
    /// FEATURE-GATED (`privacy`).
    #[cfg(feature = "privacy")]
    pub fn shield(ctx: Context<ShieldContext>, amount: u64) -> Result<()> {
        instructions::shield(ctx, amount)
    }

    /// Move tokens OUT of a shielded balance back to public (amount is public).
    /// FEATURE-GATED (`privacy`) — underflow-unsound without Phase-2 range
    /// proofs; see instructions/private_shield.rs.
    #[cfg(feature = "privacy")]
    pub fn unshield(ctx: Context<UnshieldContext>, amount: u64) -> Result<()> {
        instructions::unshield(ctx, amount)
    }

    /// Shielded transfer of a hidden amount between private balances.
    /// FEATURE-GATED (`privacy`) — Phase 1 verifies conservation + balance PoK
    /// but NOT range proofs; not mainnet-sound yet (see zk_verify.rs).
    #[cfg(feature = "privacy")]
    pub fn private_transfer(
        ctx: Context<PrivateTransferContext>,
        nullifier: [u8; 32],
        amount_commitment: [u8; 32],
        sender_new_commitment: [u8; 32],
        balance_proof: BalanceProof,
    ) -> Result<()> {
        instructions::private_transfer(
            ctx,
            nullifier,
            amount_commitment,
            sender_new_commitment,
            balance_proof,
        )
    }

    pub fn batch_settle_offchain_match<'info>(
        ctx: Context<'info, SettleOffchainMatchBatchContext<'info>>,
        matches: Vec<BatchMatchPair>,
        merkle_root: [u8; 32],
        vat_amount: u64,
        vat_rate_bps: u16,
        batch_id: u64,
        settle_shard_id: u8,
    ) -> Result<()> {
        instructions::batch_settle_offchain_match(
            ctx,
            matches,
            merkle_root,
            vat_amount,
            vat_rate_bps,
            batch_id,
            settle_shard_id,
        )
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
        compute_fn!("submit_limit_order" => {
            instructions::submit_limit_order(ctx, order_id_val, side, amount, price)
        })
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
        compute_fn!("submit_market_order" => {
            instructions::submit_market_order(ctx, side, amount)
        })
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
        compute_fn!("update_depth" => {
            instructions::update_depth(ctx, buy_prices, buy_amounts, sell_prices, sell_amounts)
        })
    }

    /// Update price history with new trade data
    /// Maintains rolling 24-hour price history and calculates VWAP
    pub fn update_price_history(
        ctx: Context<UpdatePriceHistoryContext>,
        trade_price: u64,
        trade_volume: u64,
    ) -> Result<()> {
        compute_fn!("update_price_history" => {
            instructions::update_price_history(ctx, trade_price, trade_volume)
        })
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
    // NOTE: kept inline (not moved to instructions/) on purpose — the auction arg/return
    // types (AuctionOrder / ClearAuctionResult / …) live at crate root to avoid an Anchor
    // IDL macro issue with instruction types defined in submodules.
    pub fn clear_auction(
        ctx: Context<ClearAuctionContext>,
        sell_orders: Vec<AuctionOrder>,
        buy_orders: Vec<AuctionOrder>,
    ) -> Result<ClearAuctionResult> {
        let res = compute_fn!("clear_auction" => {
        require!(
            get_governance_config(&ctx.accounts.governance_config.to_account_info())?.is_operational(),
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
                    // Discovery-path raw amount·price (NO /1e9), informational — see events.rs::OrderMatched.
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

        ClearAuctionResult {
            clearing_price,
            clearing_volume,
            matched_buy_volume,
            matched_sell_volume,
            total_matches,
        }
        });
        Ok(res)
    }

    /// Execute Auction Matches - discovery bookkeeping only (NOT settlement).
    ///
    /// Emits one `OrderMatched` per auction match from `clear_auction` and bumps
    /// market aggregates. It moves NO tokens: its context is `ClearAuctionContext`,
    /// which carries no escrow/mint/token accounts, so settlement is structurally
    /// impossible here. `total_value` and `fee_amount` in the emitted events are the
    /// discovery-path RAW `amount * price` scale (no /1e9) and are informational only
    /// (see events.rs::OrderMatched for the dual-scale contract).
    ///
    /// Actual token settlement of a uniform-auction match goes through the offchain
    /// settlement path (`settle_offchain_match` / `execute_atomic_settlement`), which
    /// carry the escrow contexts and apply the real 6-dec tariff. This instruction
    /// currently has no on-chain/test/client caller.
    ///
    /// # Arguments
    /// * `matches` - Vector of AuctionMatch from clear_auction
    /// * `clearing_price` - Uniform clearing price from clear_auction
    // NOTE: kept inline for the same reason as `clear_auction` (auction types at crate root).
    pub fn execute_auction_matches(
        ctx: Context<ClearAuctionContext>,
        matches: Vec<AuctionMatch>,
        clearing_price: u64,
    ) -> Result<()> {
        compute_fn!("execute_auction_matches" => {
        require!(
            get_governance_config(&ctx.accounts.governance_config.to_account_info())?.is_operational(),
            TradingError::MaintenanceMode
        );

        let market_fee_bps = {
            let market = ctx.accounts.market.load()?;
            market.market_fee_bps as u64
        };
        let clock = Clock::get()?;

        require!(!matches.is_empty(), TradingError::InvalidAmount);

        let mut total_volume = 0u64;

        for auction_match in &matches {
            // Discovery-path raw amount·price (NO /1e9); this ix moves NO tokens — trade_value + market_fee
            // below are informational event fields only. See events.rs::OrderMatched for the dual-scale contract.
            let trade_value = auction_match.amount.saturating_mul(clearing_price);
            let market_fee = trade_value
                .checked_mul(market_fee_bps)
                .map(|v| v / 10000)
                .ok_or(TradingError::Overflow)?;

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
        });

        Ok(())
    }

    // NOTE: kept inline (not moved to instructions/) on purpose — its context
    // `ExecuteAtomicSettlementContext` sits at the BPF stack ceiling for
    // try_accounts; the field layout must not change.
    pub fn execute_atomic_settlement<'info>(
        ctx: Context<'info, ExecuteAtomicSettlementContext<'info>>,
        amount: u64,
        price: u64,
        // Per-match id (matcher UUID). Consumed by the context's `trade_nullifier`
        // `init` seeds — its existence on replay reverts the tx, so the same match
        // can never double-settle even when the orders still have headroom (F3c).
        trade_id: [u8; 16],
    ) -> Result<()> {
        let _ = trade_id; // bound via #[instruction] → trade_nullifier seeds; not read here
        compute_fn!("execute_atomic_settlement" => {
        require!(
            get_governance_config(&ctx.accounts.governance_config.to_account_info())?.is_operational(),
            TradingError::MaintenanceMode
        );
        let mut market = ctx.accounts.market.load_mut()?;
        require_keys_eq!(
            market.authority,
            ctx.accounts.market_authority.key(),
            TradingError::UnauthorizedAuthority
        );
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

        // `amount` is energy in 9-decimal atomic units (kWh * 1e9); `price` is
        // currency-per-kWh in 6-decimal atomic units. Their raw product is scaled
        // by 1e15, but the currency leg settles in 6-decimal base units — so divide
        // by 1e9 (the energy decimals) to land in currency base. Without this the
        // seller is overpaid 1e9x. u128 intermediate so a large amount*price can't
        // overflow u64 before the divide.
        let total_currency_value = u64::try_from(
            (amount as u128)
                .checked_mul(price as u128)
                .ok_or(TradingError::Overflow)?
                / crate::ENERGY_AMOUNT_DECIMALS_DIVISOR,
        )
        .map_err(|_| TradingError::Overflow)?;
        let market_fee = total_currency_value
            .checked_mul(market.market_fee_bps as u64)
            .map(|v| v / 10000)
            .ok_or(TradingError::Overflow)?;
        // Wheeling/loss are computed from the on-chain tariff schedule, not caller args —
        // see role-map.md fix #7b / TariffConfig. Wheeling is a flat per-kWh rate (same
        // 9-dec-energy * 6-dec-rate / 1e9 scaling as total_currency_value above), not
        // bps-of-value — the physical delivery cost doesn't scale with agreed price.
        let wheeling_charge_val = u64::try_from(
            (amount as u128)
                .checked_mul(ctx.accounts.tariff_config.wheeling_rate_per_kwh as u128)
                .ok_or(TradingError::Overflow)?
                / crate::ENERGY_AMOUNT_DECIMALS_DIVISOR,
        )
        .map_err(|_| TradingError::Overflow)?;
        let loss_cost_val = total_currency_value
            .checked_mul(ctx.accounts.tariff_config.loss_bps as u64)
            .map(|v| v / 10000)
            .ok_or(TradingError::Overflow)?;
        let net_seller_amount = total_currency_value
            .saturating_sub(market_fee)
            .saturating_sub(wheeling_charge_val)
            .saturating_sub(loss_cost_val);

        // Cache AccountInfo clones and mint decimals once — each .to_account_info() call
        // is a heap clone; doing it 12+ times across 5 CPI calls wastes CU budget.
        let _token_prog = ctx.accounts.token_program.to_account_info();
        let currency_mint_ai = ctx.accounts.currency_mint.to_account_info();
        let currency_decimals = ctx.accounts.currency_mint.decimals;
        let buyer_escrow_ai = ctx.accounts.buyer_currency_escrow.to_account_info();
        let escrow_auth_ai = ctx.accounts.escrow_authority.to_account_info();

        compute_checkpoint!("before_settlement_cpis");
        // Currency transfers
        if market_fee > 0 {
            anchor_spl::token_interface::transfer_checked(
                CpiContext::new(
                    ctx.accounts.token_program.key(),
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
                    ctx.accounts.token_program.key(),
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
                    ctx.accounts.token_program.key(),
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
                    ctx.accounts.token_program.key(),
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
                ctx.accounts.secondary_token_program.key(),
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

        // REC (renewable attribute) leg — OPT-IN via remaining_accounts[0..4] =
        // [rec_mint, seller_rec_escrow, buyer_rec_escrow, rec_token_program]. Brings the
        // production settle path to REC parity with `settle_offchain_match`. Consistent with
        // this handler's custodial model: `escrow_authority` signs (as the currency/energy
        // legs do) and the REC escrows are matcher-supplied CHECK accounts. rec_mint is pinned
        // to the governance PDA, the token program to the mint's owner, and `transfer_checked`
        // enforces both escrows hold rec_mint. Absent group → settle unchanged (back-compat).
        if let Some(rec_mint_info) = ctx.remaining_accounts.first() {
            let seller_rec = ctx
                .remaining_accounts
                .get(1)
                .ok_or(TradingError::InvalidRecMint)?;
            let buyer_rec = ctx
                .remaining_accounts
                .get(2)
                .ok_or(TradingError::InvalidRecMint)?;
            let rec_token_program = ctx
                .remaining_accounts
                .get(3)
                .ok_or(TradingError::InvalidRecMint)?;
            let (expected_rec_mint, _) =
                Pubkey::find_program_address(&[b"rec_mint"], &governance::ID);
            require_keys_eq!(
                *rec_mint_info.key,
                expected_rec_mint,
                TradingError::InvalidRecMint
            );
            let rec_mint =
                InterfaceAccount::<anchor_spl::token_interface::Mint>::try_from(rec_mint_info)
                    .map_err(|_| error!(TradingError::InvalidRecMint))?;
            // Pin the CPI program to the rec_mint's owning token program (transfer_checked
            // would revert on a mismatch anyway; binding rejects a bogus/no-op program up front).
            require_keys_eq!(
                *rec_token_program.key,
                *rec_mint_info.owner,
                TradingError::InvalidRecMint
            );
            // REC base units = energy `amount` (9-dec atomic kWh) × 1_000 / 1e9 — the same
            // factor the order-time gate applies (1 kWh = 1_000 of the 6-dec REC base units).
            let rec_amount = u64::try_from(
                (amount as u128)
                    .checked_mul(1_000)
                    .ok_or(TradingError::Overflow)?
                    / crate::ENERGY_AMOUNT_DECIMALS_DIVISOR,
            )
            .map_err(|_| TradingError::Overflow)?;
            if rec_amount > 0 {
                anchor_spl::token_interface::transfer_checked(
                    CpiContext::new(
                        *rec_token_program.key,
                        anchor_spl::token_interface::TransferChecked {
                            from: seller_rec.to_account_info(),
                            mint: rec_mint_info.to_account_info(),
                            to: buyer_rec.to_account_info(),
                            authority: ctx.accounts.escrow_authority.to_account_info(),
                        },
                    ),
                    rec_amount,
                    rec_mint.decimals,
                )?;
            }
        }
        compute_checkpoint!("after_settlement_cpis");

        // Update State
        buy_order.filled_amount += amount;
        sell_order.filled_amount += amount;
        if buy_order.filled_amount >= buy_order.amount {
            buy_order.status = OrderStatus::Completed as u8;
        }
        if sell_order.filled_amount >= sell_order.amount {
            sell_order.status = OrderStatus::Completed as u8;
        }
        market.total_volume = market.total_volume.saturating_add(amount);
        market.total_trades = market.total_trades.saturating_add(1);

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
        compute_fn!("update_market_params" => {
            instructions::update_market_params(ctx, fee_bps, clearing, min_price, max_price)
        })
    }

    /// Configure the settlement THBG mint for this market (admin only). Once set,
    /// any match that settles in this mint MUST pass the treasury accounts so the
    /// baht-denominated settlement is recorded — recording is no longer optional for
    /// THBG-denominated trades. Pass `Pubkey::default()` is not allowed (use the real
    /// THBG mint); to disable, this could be extended with a clear flag if ever needed.
    pub fn set_settlement_thbg_mint(
        ctx: Context<SetSettlementThbgMintContext>,
        thbg_mint: Pubkey,
    ) -> Result<()> {
        compute_fn!("set_settlement_thbg_mint" => {
            instructions::set_settlement_thbg_mint(ctx, thbg_mint)
        })
    }

    pub fn settle_offchain_match<'info>(
        ctx: Context<'info, SettleOffchainMatchContext<'info>>,
        buyer_payload: OffchainOrderPayload,
        seller_payload: OffchainOrderPayload,
        match_amount: u64,
        match_price: u64,
        trade_id: [u8; 16],
    ) -> Result<()> {
        instructions::settle_offchain_match(
            ctx,
            buyer_payload,
            seller_payload,
            match_amount,
            match_price,
            trade_id,
        )
    }

    /// One-time init of the on-chain tariff schedule (§role-map.md fix #7b): wheeling/loss
    /// charges are no longer caller-supplied settlement args, they're computed from this
    /// config, which only `wheeling_authority` / `loss_authority` (both MEA-PEA) can move.
    pub fn initialize_tariff_config(
        ctx: Context<InitializeTariffConfigContext>,
        wheeling_authority: Pubkey,
        loss_authority: Pubkey,
        wheeling_rate_per_kwh: u64,
        loss_bps: u16,
    ) -> Result<()> {
        instructions::initialize_tariff_config(ctx, wheeling_authority, loss_authority, wheeling_rate_per_kwh, loss_bps)
    }

    pub fn set_wheeling_rate(ctx: Context<SetWheelingRateContext>, new_rate_per_kwh: u64) -> Result<()> {
        instructions::set_wheeling_rate(ctx, new_rate_per_kwh)
    }

    pub fn set_loss_rate(ctx: Context<SetLossRateContext>, new_bps: u16) -> Result<()> {
        instructions::set_loss_rate(ctx, new_bps)
    }

    pub fn close_tariff_config(ctx: Context<CloseTariffConfigContext>) -> Result<()> {
        instructions::close_tariff_config(ctx)
    }

    pub fn set_tariff_authorities(
        ctx: Context<SetTariffAuthoritiesContext>,
        new_wheeling_authority: Pubkey,
        new_loss_authority: Pubkey,
    ) -> Result<()> {
        instructions::set_tariff_authorities(ctx, new_wheeling_authority, new_loss_authority)
    }

    pub fn initialize_market_shard(
        ctx: Context<InitializeMarketShardContext>,
        shard_id: u8,
    ) -> Result<()> {
        instructions::initialize_market_shard(ctx, shard_id)
    }

    /// One-time creation of the fee/wheeling/loss collector PDAs for a currency mint.
    pub fn initialize_collectors(ctx: Context<InitializeCollectorsContext>) -> Result<()> {
        instructions::initialize_collectors(ctx)
    }

    /// One-time creation of the SHARDED collector PDAs for a currency mint + shard
    /// (§2c Part B). Run once per shard (0..NUM_SETTLE_SHARDS).
    pub fn initialize_sharded_collectors(
        ctx: Context<InitializeShardedCollectorsContext>,
        shard_id: u8,
    ) -> Result<()> {
        instructions::initialize_sharded_collectors(ctx, shard_id)
    }

    /// Consolidate a shard's fee/wheeling/loss balances into the canonical collectors.
    /// Drain per-shard `ZoneMarketShard` staging counters back into `ZoneMarket`
    /// totals. Shards passed via `remaining_accounts` (writable). Admin-gated
    /// (market authority). See instructions/aggregate_shards.rs for semantics.
    pub fn aggregate_shards<'info>(
        ctx: Context<'info, AggregateShardsContext<'info>>,
    ) -> Result<()> {
        instructions::aggregate_shards(ctx)
    }

    pub fn sweep_collectors(ctx: Context<SweepCollectorsContext>, shard_id: u8) -> Result<()> {
        instructions::sweep_collectors(ctx, shard_id)
    }

    /// Deposit currency/energy into the caller's per-user escrow PDA (funds the
    /// off-chain settlement path).
    pub fn deposit_escrow(ctx: Context<DepositEscrowContext>, amount: u64) -> Result<()> {
        instructions::deposit_escrow(ctx, amount)
    }

    /// Withdraw from the caller's own escrow PDA back to their wallet.
    pub fn withdraw_escrow(ctx: Context<WithdrawEscrowContext>, amount: u64) -> Result<()> {
        instructions::withdraw_escrow(ctx, amount)
    }

    /// Custodial escrow funding (Option A): platform funds `user`'s escrow on their
    /// behalf. `user` is a non-signing instruction arg; the platform `funder` signs.
    /// Off-chain authorization is enforced by Chain Bridge RBAC.
    pub fn fund_escrow_custodial(
        ctx: Context<FundEscrowCustodialContext>,
        user: Pubkey,
        amount: u64,
    ) -> Result<()> {
        instructions::fund_escrow_custodial(ctx, user, amount)
    }

    // ============================================
    // Inline Context Structs (kept in lib.rs on purpose)
    // ============================================

    #[derive(Accounts)]
    #[instruction(amount: u64, price: u64, trade_id: [u8; 16])]
    pub struct ExecuteAtomicSettlementContext<'info> {
        #[account(mut)]
        pub market: AccountLoader<'info, Market>,
        #[account(mut)]
        pub buy_order: AccountLoader<'info, Order>,
        #[account(mut)]
        pub sell_order: AccountLoader<'info, Order>,
        // PER-MATCH REPLAY GUARD (F3c): created on first settle, so a re-sent match (the
        // orders' per-fill `filled_amount` alone does NOT block a partial replay while
        // headroom remains) finds this PDA already initialized and `init` reverts the tx.
        // Paid by market_authority (the platform signer). Keyed by the matcher's trade_id.
        #[account(
            init,
            payer = market_authority,
            space = TradeNullifier::LEN,
            seeds = [b"trade", trade_id.as_ref()],
            bump
        )]
        pub trade_nullifier: Account<'info, TradeNullifier>,
        /// CHECK: Buyer's token account for currency (Escrow)
        #[account(mut, owner = token_program.key())]
        pub buyer_currency_escrow: UncheckedAccount<'info>,
        /// CHECK: Seller's token account for energy (Escrow)
        #[account(mut, owner = secondary_token_program.key())]
        pub seller_energy_escrow: UncheckedAccount<'info>,
        /// CHECK: Seller's token account for currency (receiver)
        #[account(mut, owner = token_program.key())]
        pub seller_currency_account: UncheckedAccount<'info>,
        /// CHECK: Buyer's token account for energy (receiver)
        #[account(mut, owner = secondary_token_program.key())]
        pub buyer_energy_account: UncheckedAccount<'info>,
        /// CHECK: Fee collector account
        #[account(mut, owner = token_program.key())]
        pub fee_collector: UncheckedAccount<'info>,
        /// CHECK: Wheeling charge collector account
        #[account(mut, owner = token_program.key())]
        pub wheeling_collector: UncheckedAccount<'info>,
        /// CHECK: Loss cost collector account
        #[account(mut, owner = token_program.key())]
        pub loss_collector: UncheckedAccount<'info>,
        pub energy_mint: InterfaceAccount<'info, anchor_spl::token_interface::Mint>,
        pub currency_mint: InterfaceAccount<'info, anchor_spl::token_interface::Mint>,
        pub escrow_authority: Signer<'info>,
        #[account(mut)] // mut: pays rent for the trade_nullifier init
        pub market_authority: Signer<'info>,
        pub token_program: Interface<'info, anchor_spl::token_interface::TokenInterface>,
        pub system_program: Program<'info, System>,
        pub secondary_token_program: Interface<'info, anchor_spl::token_interface::TokenInterface>,
        pub governance_config: Account<'info, GovernanceConfig>,
        #[account(seeds = [b"tariff_config"], bump = tariff_config.bump)]
        pub tariff_config: Account<'info, TariffConfig>,
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
        pub fee_collector: UncheckedAccount<'info>,

        /// CHECK: Token program for transfers
        pub token_program: UncheckedAccount<'info>,

        pub governance_config: Account<'info, GovernanceConfig>,
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
