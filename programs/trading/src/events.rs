// Trading program events

use anchor_lang::prelude::*;

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
    // DUAL-SCALE — read the emitting instruction before summing this field.
    //   settle path (settle_offchain_match / batch_settle):    total_value = amount * price / 1e9
    //     -> real 6-dec settlement currency (THBG minor units); money actually moves; treasury reconciles.
    //   discovery path (match_orders / sharded_match_orders / clear_auction / execute_auction_matches):
    //     total_value = amount * price  (NO /1e9) -> raw atomic·micros product, 1e9x larger, INFORMATIONAL
    //     ONLY (no token transfer). The CDA verifier (scripts/verify-price-models-onchain.ts) asserts this
    //     raw form; §9.6 paper results depend on it. Do NOT "normalize" the discovery producers to /1e9 —
    //     it moves no money, breaks the verifier, and invalidates committed results.
    // External indexers/explorers MUST NOT sum total_value across paths without rescaling by path.
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
    pub min_price_per_kwh: u64,
    pub max_price_per_kwh: u64,
    pub timestamp: i64,
}

#[event]
pub struct SettlementThbgMintSet {
    pub authority: Pubkey,
    pub thbg_mint: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct MaintenanceModeChanged {
    pub authority: Pubkey,
    pub maintenance_mode: bool,
    pub timestamp: i64,
}

#[event]
pub struct LimitOrderSubmitted {
    pub order_id: Pubkey,
    pub side: u8,  // 0 = Buy, 1 = Sell
    pub price: u64,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct MarketOrderSubmitted {
    pub user: Pubkey,
    pub side: u8,  // 0 = Buy, 1 = Sell
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct DepthUpdated {
    pub buy_levels: u8,
    pub sell_levels: u8,
    pub best_bid: u64,
    pub best_ask: u64,
    pub timestamp: i64,
}

#[event]
pub struct PriceHistoryUpdated {
    pub trade_price: u64,
    pub trade_volume: u64,
    pub vwap: u64,
    pub timestamp: i64,
}

#[event]
pub struct AuctionCleared {
    pub clearing_price: u64,
    pub clearing_volume: u64,
    pub matched_orders: u32,
    pub timestamp: i64,
}

#[event]
pub struct EscrowDeposited {
    pub user: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct EscrowWithdrawn {
    pub user: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

/// Emitted by `aggregate_shards` when per-shard staging counters are drained
/// back into `ZoneMarket` totals (see instructions/aggregate_shards.rs).
#[event]
pub struct ShardsAggregated {
    pub zone_id: u32,
    pub volume_added: u64,
    pub trades_added: u32,
    pub shards_drained: u32,
    pub timestamp: i64,
}
