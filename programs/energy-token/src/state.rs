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
#[account]
pub struct MeterReading {
    pub meter_owner: Pubkey,       // 32 - The owner/wallet of the meter
    pub meter_serial: String,      // 4 + max 32 - Meter serial number
    pub energy_generated_kwh: u64, // 8 - Energy generated
    pub energy_consumed_kwh: u64,  // 8 - Energy consumed
    pub voltage: u16,              // 2 - Voltage reading
    pub current: u16,              // 2 - Current reading
    pub power_factor: u16,         // 2 - Power factor (0-1000)
    pub temperature: i16,          // 2 - Temperature
    pub timestamp: i64,            // 8 - Reading timestamp
    pub bump: u8,                  // 1 - PDA bump seed
}
