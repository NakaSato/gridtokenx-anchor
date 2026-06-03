use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct ZoneConfig {
    pub zone_id: u32,
    pub incentive_multiplier_bps: u64, // 8 (10,000 = 1.0x)
    pub wheeling_charge_bps: u64,
    pub maintenance_mode: u8,
    pub authority: Pubkey,
    pub last_updated: i64,
    pub reserved1: [u8; 32],
    pub reserved2: [u8; 32],
}
// Total: 4+8+8+1+32+8+64 = 125 bytes
