// Trading program error codes

use anchor_lang::prelude::*;

#[error_code]
pub enum TradingError {
    #[msg("Unauthorized authority")]
    UnauthorizedAuthority,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Invalid price")]
    InvalidPrice,
    #[msg("Inactive sell order")]
    InactiveSellOrder,
    #[msg("Inactive buy order")]
    InactiveBuyOrder,
    #[msg("Price mismatch")]
    PriceMismatch,
    #[msg("Order not cancellable")]
    OrderNotCancellable,
    #[msg("Insufficient escrow balance")]
    InsufficientEscrowBalance,
    #[msg("Invalid ERC certificate status")]
    InvalidErcCertificate,
    #[msg("ERC certificate has expired")]
    ErcCertificateExpired,
    #[msg("ERC certificate not validated for trading")]
    ErcNotValidatedForTrading,
    #[msg("Order amount exceeds available ERC certificate amount")]
    ExceedsErcAmount,
    #[msg("Batch processing is disabled")]
    BatchProcessingDisabled,
    #[msg("Batch size exceeded")]
    BatchSizeExceeded,
}
