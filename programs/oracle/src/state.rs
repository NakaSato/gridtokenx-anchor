// Oracle program state

use anchor_lang::prelude::*;

/// OracleData account with zero_copy for efficient data access
/// Direct memory access avoids deserialization overhead
/// All fields explicitly defined including padding to satisfy bytemuck's Pod trait
#[account(zero_copy)]
#[repr(C)]
pub struct OracleData {
    // === 32-byte aligned fields (Pubkeys) ===
    pub authority: Pubkey,                      // 32 bytes
    pub api_gateway: Pubkey,                    // 32 bytes
    pub backup_oracles: [Pubkey; 10],           // 320 bytes (32 * 10)
    
    // === 8-byte aligned fields (u64, i64) ===
    pub total_readings: u64,                    // 8 bytes
    pub last_reading_timestamp: i64,            // 8 bytes
    pub last_clearing: i64,                     // 8 bytes
    pub created_at: i64,                        // 8 bytes
    pub min_energy_value: u64,                  // 8 bytes
    pub max_energy_value: u64,                  // 8 bytes
    pub total_valid_readings: u64,              // 8 bytes
    pub total_rejected_readings: u64,           // 8 bytes
    pub quality_score_updated_at: i64,          // 8 bytes
    pub last_consensus_timestamp: i64,          // 8 bytes
    pub last_energy_produced: u64,              // 8 bytes - for deviation check
    pub last_energy_consumed: u64,              // 8 bytes - for deviation check
    pub min_reading_interval: u64,              // 8 bytes - minimum seconds between readings (rate limit)
    
    // === 4-byte aligned field ===
    pub average_reading_interval: u32,          // 4 bytes
    
    // === 2-byte aligned field ===
    pub max_reading_deviation_percent: u16,     // 2 bytes
    
    // === 1-byte fields ===
    pub active: u8,                             // 1 byte (1 = active, 0 = inactive)
    pub anomaly_detection_enabled: u8,          // 1 byte (1 = enabled, 0 = disabled)  
    pub require_consensus: u8,                  // 1 byte (1 = required, 0 = not required)
    pub last_quality_score: u8,                 // 1 byte (0-100 quality score)
    pub backup_oracles_count: u8,               // 1 byte
    pub consensus_threshold: u8,                // 1 byte
    
    // Explicit padding to reach 8-byte alignment
    // u32(4) + u16(2) + u8*6(6) = 12 bytes
    // To align to 8 bytes: need 4 more bytes (12 + 4 = 16, which is divisible by 8)
    pub _padding: [u8; 4],                      // 4 bytes explicit padding
}
