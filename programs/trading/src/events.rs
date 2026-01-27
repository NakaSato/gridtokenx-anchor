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

#[event]
pub struct AuctionOrderSubmitted {
    pub batch_id: u64,
    pub order_id: Pubkey,
    pub price: u64,
    pub amount: u64,
    pub is_bid: bool,
    pub timestamp: i64,
}

#[event]
pub struct AuctionResolved {
    pub batch_id: u64,
    pub clearing_price: u64,
    pub clearing_volume: u64,
    pub timestamp: i64,
}

#[event]
pub struct AuctionSettled {
    pub batch_id: u64,
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub amount: u64,
    pub price: u64,
    pub total_value: u64,
    pub timestamp: i64,
}
