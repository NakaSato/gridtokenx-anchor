use anchor_lang::prelude::*;

#[account]
pub struct ZoneConfig {
    /// The zone ID (e.g., 301 for Ko Tao)
    pub zone_id: i32,
    /// Generation incentive multiplier (scaled by 1000, e.g., 1150 = 1.15x)
    pub incentive_multiplier: u64,
    /// Base wheeling charge (scaled)
    pub wheeling_charge: u64,
    /// Maintenance mode for this specific zone
    pub maintenance_mode: bool,
    /// Last updated timestamp
    pub last_updated: i64,
    /// Bump seed for PDA: [b"zone_config", zone_id]
    pub bump: u8,
}

impl ZoneConfig {
    pub const LEN: usize = 8 + // Discriminator
        4 +  // zone_id
        8 +  // incentive_multiplier
        8 +  // wheeling_charge
        1 +  // maintenance_mode
        8 +  // last_updated
        1;   // bump
}
