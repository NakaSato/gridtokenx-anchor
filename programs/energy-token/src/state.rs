// Energy-token program state

use anchor_lang::prelude::*;

/// Token program configuration and state
#[account(zero_copy)]
#[repr(C)]
pub struct TokenInfo {
    pub authority: Pubkey,          // 32
    pub registry_authority: Pubkey, // 32
    pub registry_program: Pubkey,   // 32
    pub mint: Pubkey,               // 32
    pub total_supply: u64,          // 8
    pub created_at: i64,            // 8
    pub rec_validators: [Pubkey; 5], // 32 * 5 = 160
    pub rec_validators_count: u8,   // 1
    pub _padding: [u8; 7],          // 7
}

/// Meter reading record stored on-chain
#[account(zero_copy)]
#[repr(C)]
pub struct MeterReading {
    pub meter_owner: Pubkey,       // 32
    pub meter_serial: [u8; 32],    // 32 (replaced String)
    pub energy_generated_kwh: u64, // 8
    pub energy_consumed_kwh: u64,  // 8
    pub timestamp: i64,            // 8
    pub voltage: u16,              // 2
    pub current: u16,              // 2
    pub power_factor: u16,         // 2
    pub temperature: i16,          // 2
    pub bump: u8,                  // 1
    pub _padding: [u8; 7],         // 7 (total: 32+32+8+8+8+2+2+2+2+1+7 = 104)
}
