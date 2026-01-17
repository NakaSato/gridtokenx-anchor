use anchor_lang::prelude::*;

/// MeterAccount from registry program (for CPI validation)
/// This mirrors the structure in the registry program
#[account(zero_copy)]
#[repr(C)]
pub struct MeterAccount {
    pub meter_id: [u8; 32],
    pub owner: [u8; 32],
    pub meter_type: u8,              // MeterType enum
    pub status: u8,                  // MeterStatus enum
    pub _padding: [u8; 6],           // Alignment
    pub registered_at: i64,
    pub last_reading_at: i64,
    pub total_generation: u64,
    pub total_consumption: u64,
    pub settled_net_generation: u64,
    pub claimed_erc_generation: u64,
}
