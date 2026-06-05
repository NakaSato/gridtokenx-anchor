// Oracle program state

use anchor_lang::prelude::*;

/// Maximum length for meter ID strings (used for PDA seeds and storage)
pub const MAX_METER_ID_LEN: usize = 32;

/// MeterState PDA - per-meter account for Sealevel parallel execution
/// Seeds: [b"meter", meter_id.as_bytes()]
/// Each meter writes to its own account, avoiding write-lock contention on the global OracleData.
#[account]
pub struct MeterState {
    pub meter_id: [u8; MAX_METER_ID_LEN], // 32 bytes - fixed-size meter identifier
    pub meter_id_len: u8,                 // 1 byte  - actual length of meter_id
    pub bump: u8,                         // 1 byte  - PDA bump seed
    pub zone_id: i32,                     // 4 bytes - New: regional identifier
    pub energy_produced: u64,             // 8 bytes - latest reading
    pub energy_consumed: u64,             // 8 bytes - latest reading
    pub total_energy_produced: u64,       // 8 bytes - cumulative for this meter
    pub total_energy_consumed: u64,       // 8 bytes - cumulative for this meter
    pub last_reading_timestamp: i64,      // 8 bytes
    pub total_readings: u64,              // 8 bytes
    pub created_at: i64,                  // 8 bytes
}

impl MeterState {
    /// Space: 8 (discriminator) + 32 + 1 + 1 + 4 (zone_id) + 8*6 + 8 = 102
    pub const SPACE: usize = 8 + MAX_METER_ID_LEN + 1 + 1 + 4 + 8 + 8 + 8 + 8 + 8 + 8 + 8;
}

/// OracleData account with zero_copy for efficient data access
/// Direct memory access avoids deserialization overhead
/// All fields explicitly defined including padding to satisfy bytemuck's Pod trait
#[account(zero_copy)]
#[repr(C)]
pub struct OracleData {
    // === 32-byte aligned fields (Pubkeys) ===
    pub authority: Pubkey,    // 32 bytes
    pub chain_bridge: Pubkey, // 32 bytes

    // === 8-byte aligned fields (u64, i64) — 12 × 8 = 96 bytes ===
    pub total_readings: u64,               // 8 bytes
    pub last_reading_timestamp: i64,       // 8 bytes
    pub last_clearing: i64,                // 8 bytes
    pub created_at: i64,                   // 8 bytes
    pub min_energy_value: u64,             // 8 bytes
    pub max_energy_value: u64,             // 8 bytes
    pub total_valid_readings: u64,         // 8 bytes
    pub total_rejected_readings: u64,      // 8 bytes
    pub quality_score_updated_at: i64,     // 8 bytes
    pub total_global_energy_produced: u64, // 8 bytes - cumulative total
    pub total_global_energy_consumed: u64, // 8 bytes - cumulative total
    pub last_cleared_epoch: i64, // 8 bytes - last epoch finalized on-chain (Unix timestamp in seconds)

    // === 2-byte aligned fields ===
    pub min_reading_interval: u16, // 2 bytes - minimum seconds between readings (rate limit)
    pub max_production_consumption_ratio: u16, // 2 bytes (e.g., 1000 = 10x, 500 = 5x)

    // === 1-byte fields ===
    pub active: u8,                    // 1 byte (1 = active, 0 = inactive)
    pub anomaly_detection_enabled: u8, // 1 byte (1 = enabled, 0 = disabled)
    pub last_quality_score: u8,        // 1 byte (0-100 quality score)

    // Explicit padding to reach 8-byte alignment.
    // After the Pubkeys (64) + 12×u64 (96) = 160 bytes (8-aligned),
    // u16*2(4) + u8*3(3) = 7 bytes → add 1 byte to reach 168 (divisible by 8).
    pub _padding: [u8; 1], // 1 byte explicit padding
}
