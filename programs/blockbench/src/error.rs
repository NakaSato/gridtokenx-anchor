//! BLOCKBENCH Error Codes

use anchor_lang::prelude::*;

#[error_code]
pub enum BlockbenchError {
    #[msg("Benchmark is not running")]
    BenchmarkNotRunning,
    
    #[msg("Benchmark is already running")]
    BenchmarkAlreadyRunning,
    
    #[msg("Unauthorized access")]
    Unauthorized,
    
    #[msg("Invalid configuration parameter")]
    InvalidConfig,
    
    #[msg("Operation count exceeded")]
    OperationCountExceeded,
    
    #[msg("YCSB record not found")]
    YcsbRecordNotFound,
    
    #[msg("YCSB record already exists")]
    YcsbRecordAlreadyExists,
    
    #[msg("Value size exceeds maximum")]
    ValueTooLarge,
    
    #[msg("Array size exceeds compute budget")]
    ArrayTooLarge,
    
    #[msg("Invalid aggregation type")]
    InvalidAggregationType,
    
    #[msg("Insufficient accounts provided")]
    InsufficientAccounts,
    
    #[msg("Matrix size exceeds limit")]
    MatrixTooLarge,
    
    #[msg("Hash iteration count exceeds limit")]
    TooManyHashIterations,
    
    #[msg("IO operation count exceeds limit")]
    TooManyIoOperations,
    
    #[msg("Benchmark duration exceeded")]
    DurationExceeded,
    
    #[msg("Invalid distribution type")]
    InvalidDistribution,
    
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
}
