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
pub struct BatchExecuted {
    pub authority: Pubkey,
    pub batch_id: u64,
    pub order_count: u32,
    pub total_volume: u64,
    pub timestamp: i64,
}

#[event]
pub struct OrderAddedToBatch {
    pub order_id: Pubkey,
    pub batch_id: u64,
    pub timestamp: i64,
}

#[event]
pub struct BatchCancelled {
    pub batch_id: u64,
    pub authority: Pubkey,
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
