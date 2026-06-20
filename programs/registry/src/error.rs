// Registry program error codes

use anchor_lang::prelude::*;

#[error_code]
pub enum RegistryError {
    #[msg("Unauthorized user")]
    UnauthorizedUser,
    #[msg("Unauthorized authority")]
    UnauthorizedAuthority,
    #[msg("Invalid meter status")]
    InvalidMeterStatus,
    #[msg("No unsettled balance to tokenize")]
    NoUnsettledBalance,
    #[msg("Oracle authority not configured")]
    OracleNotConfigured,
    #[msg("Unauthorized oracle - signer is not the configured oracle")]
    UnauthorizedOracle,
    #[msg("Stale reading - timestamp must be newer than last reading")]
    StaleReading,
    #[msg("Reading too frequent - minimum interval between readings not met")]
    ReadingTooFrequent,
    #[msg("Reading too high - exceeds maximum delta limit")]
    ReadingTooHigh,
    #[msg("Meter is already inactive")]
    AlreadyInactive,
    #[msg("Invalid meter ID length (max 32 bytes)")]
    InvalidMeterId,
    #[msg("Mathematical overflow")]
    MathOverflow,
    #[msg("Invalid shard ID - must be less than 16")]
    InvalidShardId,
    #[msg("Duplicate shard passed to aggregation")]
    DuplicateShard,
    #[msg("Insufficient staking balance")]
    InsufficientStakingBalance,
    #[msg("Minimum stake requirement not met")]
    MinStakeNotMet,
    #[msg("Unstaking is currently locked")]
    UnstakingLocked,
    #[msg("Airdrop already claimed for this user")]
    AirdropAlreadyClaimed,
    #[msg("Slash destination is not configured — call set_slash_destination first")]
    SlashDestinationNotSet,
    #[msg("Slash destination does not match the configured destination")]
    InvalidSlashDestination,
    #[msg("Target is not an active validator")]
    NotActiveValidator,
    #[msg("Validator has been slashed and cannot re-register")]
    ValidatorAlreadySlashed,
    #[msg("Slash fraction must be between 1 and 10000 basis points")]
    InvalidSlashFraction,
    #[msg("Slash accounting mismatch: slashed != compensation + fund")]
    SlashAccountingMismatch,
    #[msg("victim_losses length must equal the number of victim token accounts passed")]
    VictimCountMismatch,
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
    #[msg("Slash fund has insufficient balance for this disbursement")]
    InsufficientSlashFund,
}
