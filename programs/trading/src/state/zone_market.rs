use anchor_lang::prelude::*;
use crate::state::market::PriceLevel;

/// Maximum depth levels per side of the order book.
/// Caps update_depth Vec payload at ~336 bytes (4 vecs × 10 × 8 + length prefixes),
/// keeping total transaction size safely below Solana's 1,232-byte limit.
pub const MAX_DEPTH_LEVELS: usize = 10;

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
    pub capacity: u64,                      // 8 - Total transmission capacity in base units
    pub committed_flow: u64,                // 8 - Currently committed flow from matches
    
    // === MARKET DEPTH ===
    pub buy_side_depth: [PriceLevel; MAX_DEPTH_LEVELS],   // 240
    pub sell_side_depth: [PriceLevel; MAX_DEPTH_LEVELS],  // 240
}

/// Sharded zone market statistics for reduced contention
/// Tracks volume and trades on a per-shard basis within a zone
#[account(zero_copy)]
#[repr(C)]
pub struct ZoneMarketShard {
    pub shard_id: u8,                    // 0-255 shard identifier
    pub _padding1: [u8; 7],
    pub zone_market: Pubkey,             // Parent ZoneMarket
    pub volume_accumulated: u64,         // Volume in this shard
    pub trade_count: u32,                // Trade count in this shard
    pub _padding2: [u8; 4],
    pub last_clearing_price: u64,        // Latest clearing price in this shard
    pub last_update: i64,                // Last update timestamp
}
