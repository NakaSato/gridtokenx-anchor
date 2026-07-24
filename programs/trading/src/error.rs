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
    ErcExpired,
    #[msg("ERC certificate not validated for trading")]
    NotValidatedForTrading,
    #[msg("Order amount exceeds available ERC certificate amount")]
    ExceedsErcAmount,
    #[msg("Batch processing is disabled")]
    BatchProcessingDisabled,
    #[msg("Batch size exceeded")]
    BatchSizeExceeded,
    #[msg("Re-entrancy Guard Lock")]
    ReentrancyLock,
    #[msg("Batch is empty")]
    EmptyBatch,
    #[msg("Batch size exceeds maximum allowed (5)")]
    BatchTooLarge,
    #[msg("System is in maintenance mode")]
    MaintenanceMode,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Price below market minimum")]
    PriceBelowMinimum,
    #[msg("Price above market maximum")]
    PriceAboveMaximum,
    #[msg("Insufficient liquidity for market order")]
    InsufficientLiquidity,
    #[msg("Invalid order side")]
    InvalidOrderSide,
    #[msg("Order has expired")]
    OrderExpired,
    #[msg("Slippage exceeded: Price outside allowed bounds")]
    SlippageExceeded,
    #[msg("Grid capacity exceeded: Transmission bottleneck detected")]
    CapacityExceeded,
    #[msg("Invalid governance account")]
    InvalidGovernanceAccount,
    #[msg("Network charges (wheeling + loss) exceed the allowed fraction of trade value")]
    ChargesExceedCap,
    #[msg("Total deductions (fee + wheeling + loss) exceed the trade value")]
    ChargesExceedValue,
    #[msg("Escrow account does not match the expected per-user PDA")]
    InvalidEscrow,
    #[msg("Nullifier account does not match the expected per-order PDA")]
    InvalidNullifier,
    #[msg("Nullifier authority does not match the signed order owner")]
    NullifierUserMismatch,
    #[msg("Settlement currency mint is not the treasury THBC mint")]
    TreasuryCurrencyMismatch,
    #[msg("This market settles in THBC: the treasury accounts are required to record the settlement")]
    TreasurySettlementRequired,
    #[msg("Settlement collector shard id out of range (must be < NUM_SETTLE_SHARDS)")]
    InvalidShardId,
    // Appended at the END to preserve existing error-code numbering (inserting mid-enum
    // shifts every later code and breaks tests/clients that assert numeric codes).
    #[msg("Cross-zone settlement requires the ZoneCapacity account (committed_flow ceiling)")]
    ZoneCapacityRequired,
    #[msg("This match (trade_id) has already been settled on-chain (replay rejected)")]
    MatchAlreadySettled,
    #[msg("Trade nullifier account does not match the expected per-match PDA")]
    InvalidTradeNullifier,
    #[msg("REC token account mint is not the governance rec_mint PDA")]
    InvalidRecMint,
    #[msg("REC token account owner does not match the order seller")]
    RecAccountOwnerMismatch,
    #[msg("Seller holds insufficient REC tokens to cover the energy offered")]
    InsufficientRecBalance,
    #[msg("Tariff config account is not the canonical PDA / not owned by this program")]
    InvalidTariffConfig,
    #[msg("Combined wheeling + loss tariff rate exceeds the allowed cap")]
    TariffRateExceedsCap,
    #[msg("Settlement payer is not a governance-admitted, active aggregator")]
    AggregatorNotAdmitted,
    #[msg("Settlement payer's aggregator is not admitted for this zone's market segment (Wholesale/Retail)")]
    AggregatorSegmentMismatch,
    #[msg("Aggregator entry account is not the canonical PDA / malformed")]
    InvalidAggregatorEntry,
    #[msg("Shielded transfer proof failed verification (conservation or balance PoK)")]
    InvalidBalanceProof,
    #[msg("Shielded transfer recipient must differ from the sender (self-transfer would double-credit)")]
    SelfTransferNotAllowed,
    #[msg("Shard passed more than once to aggregate_shards (would double-drain totals)")]
    DuplicateShard,
    #[msg("Shard does not belong to the given zone market")]
    ShardZoneMismatch,
    #[msg("Referenced ERC certificate is not owned by the order seller")]
    ErcOwnerMismatch,
}
