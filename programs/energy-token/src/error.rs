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
    #[msg("REC validator not found in the registered list")]
    RecValidatorNotFound,
    #[msg("Validator to remove not found in the registered list")]
    RemoveValidatorNotFound,
    #[msg("Window start must be a positive 15-minute (900_000 ms) boundary at or before now")]
    MisalignedWindow,
    #[msg("Mint amount must be greater than zero")]
    ZeroAmount,
    #[msg("REC validator co-signer must differ from the platform authority")]
    RecValidatorIsAuthority,
    #[msg("Invalid governance account — must be the canonical governance_config PDA")]
    InvalidGovernanceAccount,
    // Appended at the END on purpose: Anchor assigns codes sequentially from 6000,
    // so inserting above would renumber every later variant and break clients that
    // match on the numeric code.
    #[msg("Mint must be the canonical energy-token mint recorded in token_info")]
    InvalidMint,
}
