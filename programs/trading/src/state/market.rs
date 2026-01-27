// Market state definitions

use anchor_lang::prelude::*;

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
#[account]
#[derive(InitSpace)]
pub struct MarketShard {
    pub shard_id: u8,                    // 0-255 shard identifier
    pub market: Pubkey,                  // Parent market
    pub volume_accumulated: u64,         // Volume in this shard
    pub order_count: u32,                // Order count fits in u32
    pub last_update: i64,                // Last update timestamp
}

/// Helper to determine shard from authority pubkey
/// Distributes load across shards based on user's pubkey
pub fn get_shard_id(authority: &Pubkey, num_shards: u8) -> u8 {
    // Use first byte of pubkey for simple sharding
    authority.to_bytes()[0] % num_shards
}
