use anchor_lang::prelude::*;

#[account]
pub struct Proposal {
    /// The wallet that created the proposal
    pub proposer: Pubkey,
    /// The microgrid zone this proposal affects (e.g., 301 for Ko Tao)
    pub target_zone: i32,
    /// The specific parameter being adjusted
    pub parameter: GridParameter,
    /// The new value for the parameter (scaled as needed)
    pub new_value: u64,
    /// Aggregate "For" voting weight
    pub votes_for: u64,
    /// Aggregate "Against" voting weight
    pub votes_against: u64,
    /// Current lifecycle status
    pub status: ProposalStatus,
    /// When voting ends
    pub expires_at: i64,
    /// Unique proposal index or ID for the zone
    pub proposal_id: u64,
    /// Bump seed for PDA
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub enum GridParameter {
    /// Generation Incentive Multiplier (e.g., 1150 for 1.15x)
    IncentiveMultiplier,
    /// Base Wheeling Charge for the zone
    WheelingCharge,
    /// Loss Factor adjustment
    LossFactor,
    /// Maintenance Mode (Pause/Resume)
    MaintenanceMode,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub enum ProposalStatus {
    Active,
    Passed,
    Rejected,
    Executed,
    Cancelled,
}

impl Proposal {
    pub const LEN: usize = 8 + // Discriminator
        32 + // proposer
        4 +  // target_zone
        1 +  // parameter (enum)
        8 +  // new_value
        8 +  // votes_for
        8 +  // votes_against
        1 +  // status (enum)
        8 +  // expires_at
        8 +  // proposal_id
        1;   // bump
}
