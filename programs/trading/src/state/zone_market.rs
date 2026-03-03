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
    pub num_shards: u8,                     // 1
    pub _padding1: [u8; 3],                 // 3
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

/// Sharded zone market statistics for reduced contention
/// Tracks volume and trades on a per-shard basis within a zone
#[account]
#[derive(InitSpace)]
pub struct ZoneMarketShard {
    pub shard_id: u8,                    // 0-255 shard identifier
    pub zone_market: Pubkey,             // Parent ZoneMarket
    pub volume_accumulated: u64,         // Volume in this shard
    pub trade_count: u32,                // Trade count in this shard
    pub last_clearing_price: u64,        // Latest clearing price in this shard
    pub last_update: i64,                // Last update timestamp
}
