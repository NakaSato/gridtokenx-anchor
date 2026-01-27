// Oracle program error codes

use anchor_lang::prelude::*;

#[error_code]
pub enum OracleError {
    #[msg("Unauthorized authority")]
    UnauthorizedAuthority,
    #[msg("Unauthorized API Gateway")]
    UnauthorizedGateway,
    #[msg("Oracle is inactive")]
    OracleInactive,
    #[msg("Invalid meter reading")]
    InvalidMeterReading,
    #[msg("Market clearing in progress")]
    MarketClearingInProgress,
    #[msg("Energy value out of range")]
    EnergyValueOutOfRange,
    #[msg("Anomalous reading detected")]
    AnomalousReading,
    #[msg("Maximum backup oracles reached")]
    MaxBackupOraclesReached,
    #[msg("Reading timestamp is older than last reading")]
    OutdatedReading,
    #[msg("Reading timestamp is too far in the future")]
    FutureReading,
    #[msg("Rate limit exceeded - readings too frequent")]
    RateLimitExceeded,
    #[msg("Backup oracle already exists")]
    BackupOracleAlreadyExists,
    #[msg("Backup oracle not found")]
    BackupOracleNotFound,
}
