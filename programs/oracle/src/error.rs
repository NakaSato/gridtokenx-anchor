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
    #[msg("Energy value out of range")]
    EnergyValueOutOfRange,
    #[msg("Anomalous reading detected")]
    AnomalousReading,
    #[msg("Reading timestamp is older than last reading")]
    OutdatedReading,
    #[msg("Reading timestamp is too far in the future")]
    FutureReading,
    #[msg("Rate limit exceeded - readings too frequent")]
    RateLimitExceeded,
    #[msg("Invalid configuration parameter")]
    InvalidConfiguration,
    #[msg("Invalid market epoch - must be greater than last cleared epoch")]
    InvalidEpoch,
    #[msg("Meter ID exceeds maximum length of 32 bytes")]
    MeterIdTooLong,
}
