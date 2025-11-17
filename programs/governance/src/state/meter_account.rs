use anchor_lang::prelude::*;

/// MeterAccount from registry program (for CPI validation)
/// This mirrors the structure in the registry program
#[account]
pub struct MeterAccount {
    pub meter_id: String,
    pub owner: Pubkey,
    pub meter_type: u8,              // MeterType enum
    pub status: u8,                  // MeterStatus enum
    pub registered_at: i64,
    pub last_reading_at: i64,
    pub total_generation: u64,
    pub total_consumption: u64,
    pub settled_net_generation: u64,  // For GRID token tracking
    pub claimed_erc_generation: u64,  // For ERC certificate tracking
}
