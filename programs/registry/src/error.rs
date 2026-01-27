// Registry program error codes

use anchor_lang::prelude::*;

#[error_code]
pub enum RegistryError {
    #[msg("Unauthorized user")]
    UnauthorizedUser,
    #[msg("Unauthorized authority")]
    UnauthorizedAuthority,
    #[msg("Invalid user status")]
    InvalidUserStatus,
    #[msg("Invalid meter status")]
    InvalidMeterStatus,
    #[msg("User not found")]
    UserNotFound,
    #[msg("Meter not found")]
    MeterNotFound,
    #[msg("No unsettled balance to tokenize")]
    NoUnsettledBalance,
    #[msg("Oracle authority not configured")]
    OracleNotConfigured,
    #[msg("Unauthorized oracle - signer is not the configured oracle")]
    UnauthorizedOracle,
    #[msg("Stale reading - timestamp must be newer than last reading")]
    StaleReading,
    #[msg("Reading too high - exceeds maximum delta limit")]
    ReadingTooHigh,
    #[msg("Meter is already inactive")]
    AlreadyInactive,
}
