// Market state definitions

use anchor_lang::prelude::*;

/// Market account for order and trade management
#[account(zero_copy)]
#[repr(C)]
pub struct Market {
    pub authority: Pubkey,          // 32
    pub total_volume: u64,          // 8
    pub created_at: i64,            // 8
    pub last_clearing_price: u64,   // 8
    pub volume_weighted_price: u64, // 8
    pub active_orders: u32,         // 4
    pub total_trades: u32,          // 4
    pub market_fee_bps: u16,        // 2
    pub clearing_enabled: u8,       // 1
    pub locked: u8,                 // 1 (Re-entrancy Guard)
    pub _padding1: [u8; 4],         // 4 -> 80
    pub min_price_per_kwh: u64,     // 8 — minimum allowed price (must be > 0)
    pub max_price_per_kwh: u64,     // 8 — maximum allowed price (0 = no cap)

    // === BATCH PROCESSING ===
    pub batch_config: BatchConfig, // 24
    pub current_batch: BatchInfo,  // 1640
    pub has_current_batch: u8,
    pub _padding_batch: [u8; 7],

    // === MARKET DEPTH (Moved to ZoneMarket) ===
    pub _padding_depth_1: [u8; 512],
    pub _padding_depth_2: [u8; 256],
    pub _padding_depth_3: [u8; 128],
    pub _padding_depth_4: [u8; 64],
    pub _padding_depth_5: [u8; 6], // 512+256+128+64+6 = 966
    pub price_history_count: u8,   // 1 — number of valid entries (0..=24)
    pub price_history_head: u8,    // 1 — ring-buffer write head (next slot to overwrite)

    // === PRICE DISCOVERY ===
    pub price_history: [PricePoint; 24], // 576

    // === SHARDING METRICS (Aggregated from MarketShard) ===
    pub total_volume_global: u64,   // Aggregated volume
    pub total_trades_global: u32,   // Aggregated trades
    pub num_shards: u8,             // Number of active shards
    pub _padding_sharding: [u8; 3], // 8+4+1+3 = 16
}

/// Batch configuration for batch processing
#[derive(
    AnchorSerialize, AnchorDeserialize, Copy, Clone, InitSpace, bytemuck::Zeroable, bytemuck::Pod,
)]
#[repr(C)]
pub struct BatchConfig {
    pub enabled: u8,
    pub _padding1: [u8; 3],
    pub max_batch_size: u32,
    pub batch_timeout_seconds: u32,
    pub min_batch_size: u32,
    pub price_improvement_threshold: u16,
    pub _padding2: [u8; 6], // 1+3+4+4+4+2+6 = 24. 24 is 8x3. Good.
}

/// Batch information for grouped order execution
#[derive(
    AnchorSerialize, AnchorDeserialize, Copy, Clone, InitSpace, bytemuck::Zeroable, bytemuck::Pod,
)]
#[repr(C)]
pub struct BatchInfo {
    pub batch_id: u64,
    pub order_count: u32,
    pub _padding1: [u8; 4],
    pub total_volume: u64,
    pub created_at: i64,
    pub expires_at: i64,
    pub order_ids: [Pubkey; 32], // Reduced from 50 to 32 for bytemuck::Pod support
}

impl Default for BatchInfo {
    fn default() -> Self {
        Self {
            batch_id: 0,
            order_count: 0,
            _padding1: [0; 4],
            total_volume: 0,
            created_at: 0,
            expires_at: 0,
            order_ids: [Pubkey::default(); 32],
        }
    }
}

#[derive(
    AnchorSerialize,
    AnchorDeserialize,
    Copy,
    Clone,
    InitSpace,
    Default,
    bytemuck::Zeroable,
    bytemuck::Pod,
)]
#[repr(C)]
pub struct PriceLevel {
    pub price: u64,
    pub total_amount: u64,
    pub order_count: u16,
    pub _padding: [u8; 6], // Alignment
}

#[derive(
    AnchorSerialize,
    AnchorDeserialize,
    Copy,
    Clone,
    InitSpace,
    Default,
    bytemuck::Zeroable,
    bytemuck::Pod,
)]
#[repr(C)]
pub struct PricePoint {
    pub price: u64,
    pub volume: u64,
    pub timestamp: i64,
}

/// Sharded market statistics for reduced contention
/// Each shard tracks independent volume/order counts that can be aggregated
/// This allows parallel writes without MVCC conflicts on the main Market account
#[account(zero_copy)]
#[repr(C)]
pub struct MarketShard {
    pub shard_id: u8,            // 0-255 shard identifier
    pub _padding1: [u8; 7],
    pub market: Pubkey,          // Parent market
    pub volume_accumulated: u64, // Volume in this shard
    pub order_count: u32,        // Order count fits in u32
    pub _padding2: [u8; 4],
    pub last_update: i64,        // Last update timestamp
}

/// Helper to determine shard from authority pubkey
/// Distributes load across shards based on user's pubkey
pub fn get_shard_id(authority: &Pubkey, num_shards: u8) -> u8 {
    // Use first byte of pubkey for simple sharding
    authority.to_bytes()[0] % num_shards
}
