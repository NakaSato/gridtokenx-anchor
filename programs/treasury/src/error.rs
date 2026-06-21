// Treasury program error codes

use anchor_lang::prelude::*;

#[error_code]
pub enum TreasuryError {
    #[msg("Unauthorized authority")]
    UnauthorizedAuthority,
    #[msg("Unauthorized reserve attestor")]
    UnauthorizedAttestor,
    #[msg("Unauthorized settlement recorder")]
    UnauthorizedRecorder,
    #[msg("Treasury is paused")]
    Paused,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Reserve attestation is stale — refresh before minting THBG")]
    StaleAttestation,
    #[msg("Mint would breach the peg: outstanding THBG must not exceed attested THB reserve")]
    PegBreach,
    #[msg("Swap/redeem rate is not configured")]
    RateNotSet,
    #[msg("Insufficient staked balance")]
    InsufficientStake,
    #[msg("Insufficient reward pool to pay the claim")]
    InsufficientRewardPool,
    #[msg("Swap vault has insufficient GRX collateral to satisfy the redemption")]
    InsufficientVault,
    #[msg("Redeem amount exceeds outstanding THBG supply")]
    SupplyUnderflow,
    #[msg("No stake to fund rewards against")]
    NoStakeToReward,
    #[msg("Settlement shard id out of range (must be < NUM_SETTLE_SHARDS)")]
    InvalidShardId,
    #[msg("Settlement shard passed more than once in aggregation")]
    DuplicateShard,
    #[msg("Settlement shard must be writable to be drained during aggregation")]
    ShardNotWritable,
}
