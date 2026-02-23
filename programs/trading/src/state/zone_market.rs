use anchor_lang::prelude::*;
use crate::state::market::PriceLevel;

/// Zone Market account for tracking order book depth in a specific geographic zone.
/// This allows order book depth mapping to be sharded out of the main Market account,
/// preventing write lock contention on the global state when different zones are trading.
#[account(zero_copy)]
#[repr(C)]
pub struct ZoneMarket {
    pub market: Pubkey,                     // 32
    pub zone_id: u32,                       // 4
    pub _padding1: [u8; 4],                 // 4
    pub total_volume: u64,                  // 8
    pub active_orders: u32,                 // 4
    pub total_trades: u32,                  // 4
    pub buy_side_depth_count: u8,           // 1
    pub sell_side_depth_count: u8,          // 1
    pub _padding2: [u8; 6],                 // 6

    pub last_clearing_price: u64,           // 8
    
    // === MARKET DEPTH ===
    pub buy_side_depth: [PriceLevel; 20],   // 480
    pub sell_side_depth: [PriceLevel; 20],  // 480
}
