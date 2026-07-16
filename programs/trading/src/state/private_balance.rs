use anchor_lang::prelude::*;

/// Shielded balance for one (owner, mint): a Pedersen commitment
/// `C = balance·G + b·H` hiding the owner's private token balance.
///
/// A freshly-initialized account has `commitment = [0; 32]`, which is the
/// canonical ristretto encoding of the identity point — i.e. a commitment to 0
/// with blinding 0. Homomorphic top-up (`C += C_amount`) therefore works
/// correctly the first time a recipient is credited.
///
/// FEATURE-GATED (`privacy`). Phase 1 verifies conservation + a balance PoK but
/// NOT the range proofs; see instructions/private_transfer.rs and zk_verify.rs.
#[account]
pub struct PrivateBalance {
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub commitment: [u8; 32],
    pub bump: u8,
}

impl PrivateBalance {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 1;
}

/// Per-transfer replay guard for shielded transfers. Distinct from the
/// settlement `OrderNullifier`/`TradeNullifier`. Existence of the PDA (keyed by
/// the transfer's nullifier bytes) means that nullifier has been spent.
#[account]
pub struct PrivacyNullifier {
    pub bump: u8,
}

impl PrivacyNullifier {
    pub const LEN: usize = 8 + 1;
}
