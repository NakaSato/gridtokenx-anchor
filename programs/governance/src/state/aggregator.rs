use anchor_lang::prelude::*;

/// PoA-admitted aggregator (off-chain validator node) allow-list entry.
///
/// One PDA per aggregator pubkey — `seeds = [b"aggregator", aggregator.as_ref()]` — so admission
/// scales without a growing `Vec` in a global account (Sealevel per-entity-PDA rule). Other
/// programs (e.g. `oracle`) authorize an aggregator by deriving this PDA for the signer, checking
/// it is owned by the governance program, and requiring `active == true`.
#[account]
pub struct AggregatorEntry {
    /// The admitted aggregator's signing pubkey.
    pub aggregator: Pubkey,
    /// When the entry was admitted (unix seconds).
    pub admitted_at: i64,
    /// When the entry was last revoked/re-admitted (unix seconds).
    pub updated_at: i64,
    /// True while the aggregator is permitted to act; false once revoked.
    pub active: bool,
    /// Canonical PDA bump.
    pub bump: u8,
}

impl AggregatorEntry {
    pub const LEN: usize = 32 // aggregator
        + 8  // admitted_at
        + 8  // updated_at
        + 1  // active
        + 1; // bump
}
