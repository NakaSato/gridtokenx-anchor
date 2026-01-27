// Energy-token program error codes

use anchor_lang::prelude::*;

#[error_code]
pub enum EnergyTokenError {
    #[msg("Unauthorized authority")]
    UnauthorizedAuthority,
    #[msg("Invalid meter")]
    InvalidMeter,
    #[msg("Insufficient token balance")]
    InsufficientBalance,
    #[msg("Invalid metadata account")]
    InvalidMetadataAccount,
    #[msg("No unsettled balance")]
    NoUnsettledBalance,
    #[msg("Unauthorized registry program")]
    UnauthorizedRegistry,
    #[msg("Validator already exists in the list")]
    ValidatorAlreadyExists,
    #[msg("Maximum number of validators reached")]
    MaxValidatorsReached,
}
