// Energy-token program state

use anchor_lang::prelude::*;

/// Token program configuration and state
#[account(zero_copy)]
#[repr(C)]
pub struct TokenInfo {
    pub authority: Pubkey,           // 32
    pub registry_authority: Pubkey,  // 32
    pub registry_program: Pubkey,    // 32
    pub mint: Pubkey,                // 32
    pub total_supply: u64,           // 8
    pub created_at: i64,             // 8
    pub rec_validators: [Pubkey; 5], // 32 * 5 = 160
    pub rec_validators_count: u8,    // 1
    pub _padding: [u8; 7],           // 7
}

/// On-chain idempotency guard for generation mints. One PDA per
/// `(meter_id, window_start_ms)` settlement window; its existence-with-`minted`
/// is the authoritative record that the window's GRID was already minted, so a
/// crash/replay (even one that outlived the bridge's Redis `MINTED_SET` guard)
/// re-runs the instruction as a no-op instead of double-minting. PDA seeds:
/// `[b"gen_mint", meter_id, window_start_ms.to_le_bytes()]`.
#[account]
pub struct GenerationMintRecord {
    pub meter_id: [u8; 16],     // 16 — settlement meter UUID bytes
    pub window_start_ms: i64,   // 8  — 15-min window start (ms since epoch)
    pub amount: u64,            // 8  — atomic GRID minted for this window
    pub minted: bool,           // 1  — true once the mint CPI succeeded
    pub bump: u8,               // 1
}

impl GenerationMintRecord {
    /// Payload size (excludes the 8-byte Anchor discriminator).
    pub const LEN: usize = 16 + 8 + 8 + 1 + 1;
}
