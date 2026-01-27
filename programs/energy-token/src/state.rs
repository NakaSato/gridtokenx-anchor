// Energy-token program state

use anchor_lang::prelude::*;

/// Token program configuration and state
#[account(zero_copy)]
#[repr(C)]
pub struct TokenInfo {
    pub authority: Pubkey,        // 32
    pub registry_program: Pubkey, // 32
    pub mint: Pubkey,             // 32
    pub total_supply: u64,        // 8
    pub created_at: i64,          // 8
    pub rec_validators: [Pubkey; 5], // 32 * 5 = 160
    pub rec_validators_count: u8, // 1
    pub _padding: [u8; 7],        // 7
}
