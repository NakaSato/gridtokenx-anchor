use anchor_lang::prelude::*;

#[account]
pub struct VoteRecord {
    /// The proposal being voted on
    pub proposal: Pubkey,
    /// The voter's wallet (linked to a registered meter)
    pub voter: Pubkey,
    /// Choice: True = For, False = Against
    pub choice: bool,
    /// The voting power (weight) at the time of voting
    pub weight: u64,
    /// Timestamp for the audit trail
    pub voted_at: i64,
    /// Bump seed for PDA derivation: [b"vote", proposal, voter]
    pub bump: u8,
}

impl VoteRecord {
    pub const LEN: usize = 8 + // Discriminator
        32 + // proposal
        32 + // voter
        1 +  // choice
        8 +  // weight
        8 +  // voted_at
        1;   // bump
}
