use anchor_lang::prelude::*;

#[error_code]
pub enum GovernanceError {
    #[msg("Unauthorized authority")]
    UnauthorizedAuthority,
    #[msg("System is already paused")]
    AlreadyPaused,
    #[msg("System is not paused")]
    NotPaused,
    #[msg("System is currently paused")]
    SystemPaused,
    #[msg("System is in maintenance mode")]
    MaintenanceMode,
    #[msg("ERC validation is disabled")]
    ErcValidationDisabled,
    #[msg("Invalid ERC status")]
    InvalidErcStatus,
    #[msg("ERC already validated")]
    AlreadyValidated,
    #[msg("Energy amount below minimum required")]
    BelowMinimumEnergy,
    #[msg("Energy amount exceeds maximum allowed")]
    ExceedsMaximumEnergy,
    #[msg("Certificate ID too long")]
    CertificateIdTooLong,
    #[msg("Renewable source name too long")]
    SourceNameTooLong,
    #[msg("ERC certificate has expired")]
    ErcExpired,
    #[msg("Invalid minimum energy amount")]
    InvalidMinimumEnergy,
    #[msg("Invalid maximum energy amount")]
    InvalidMaximumEnergy,
    #[msg("Invalid validity period")]
    InvalidValidityPeriod,
    #[msg("Contact information too long")]
    ContactInfoTooLong,
    #[msg("Invalid oracle confidence score (must be 0-100)")]
    InvalidOracleConfidence,
    #[msg("Oracle validation required but not configured")]
    OracleValidationRequired,
    #[msg("Certificate transfers not allowed")]
    TransfersNotAllowed,
    #[msg("Insufficient unclaimed generation for ERC issuance")]
    InsufficientUnclaimedGeneration,
    
    // === Revocation Errors ===
    #[msg("Certificate already revoked")]
    AlreadyRevoked,
    #[msg("Revocation reason required")]
    RevocationReasonRequired,
    
    // === Transfer Errors ===
    #[msg("Invalid transfer recipient")]
    InvalidRecipient,
    #[msg("Cannot transfer to self")]
    CannotTransferToSelf,
    #[msg("Certificate not validated for trading")]
    NotValidatedForTrading,
    
    // === Multi-sig Authority Errors ===
    #[msg("Authority change already pending")]
    AuthorityChangePending,
    #[msg("No authority change pending")]
    NoAuthorityChangePending,
    #[msg("Invalid pending authority")]
    InvalidPendingAuthority,
    #[msg("Authority change expired")]
    AuthorityChangeExpired,
    
    // === Oracle Errors ===
    #[msg("Oracle confidence below minimum threshold")]
    OracleConfidenceTooLow,
    #[msg("Invalid oracle authority")]
    InvalidOracleAuthority,
}
