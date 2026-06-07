//! TPC-C Error Codes
//! 
//! Defines all error conditions for the TPC-C benchmark program.

use anchor_lang::prelude::*;

#[error_code]
pub enum TpcError {
    // ═══════════════════════════════════════════════════════════════════════
    // INITIALIZATION ERRORS
    // ═══════════════════════════════════════════════════════════════════════
    
    #[msg("Benchmark already initialized")]
    BenchmarkAlreadyInitialized,
    
    #[msg("Invalid warehouse ID")]
    InvalidWarehouseId,
    
    #[msg("Invalid district ID - must be 1-10")]
    InvalidDistrictId,
    
    #[msg("Invalid customer ID - must be 1-3000")]
    InvalidCustomerId,
    
    #[msg("Invalid item ID - must be 1-100000")]
    InvalidItemId,
    
    #[msg("String exceeds maximum length")]
    StringTooLong,
    
    #[msg("Tax rate must be 0-2000 basis points")]
    InvalidTaxRate,
    
    #[msg("Discount must be 0-5000 basis points")]
    InvalidDiscount,

    // ═══════════════════════════════════════════════════════════════════════
    // NEW-ORDER ERRORS
    // ═══════════════════════════════════════════════════════════════════════
    
    #[msg("Order must have 5-15 items per TPC-C specification")]
    InvalidOrderLineCount,
    
    #[msg("Invalid item ID - item does not exist")]
    ItemNotFound,
    
    #[msg("Insufficient stock for order")]
    InsufficientStock,
    
    #[msg("Customer not found")]
    CustomerNotFound,
    
    #[msg("District not found")]
    DistrictNotFound,
    
    #[msg("Warehouse not found")]
    WarehouseNotFound,
    
    #[msg("Invalid quantity - must be 1-10")]
    InvalidQuantity,
    
    #[msg("Order ID overflow - district counter exhausted")]
    OrderIdOverflow,

    // ═══════════════════════════════════════════════════════════════════════
    // PAYMENT ERRORS
    // ═══════════════════════════════════════════════════════════════════════
    
    #[msg("Invalid payment amount - must be positive")]
    InvalidPaymentAmount,
    
    #[msg("Customer balance would overflow")]
    BalanceOverflow,
    
    #[msg("History record creation failed")]
    HistoryCreationFailed,
    
    #[msg("Customer not found by last name")]
    CustomerNotFoundByLastName,

    // ═══════════════════════════════════════════════════════════════════════
    // ORDER-STATUS ERRORS
    // ═══════════════════════════════════════════════════════════════════════
    
    #[msg("Order not found for customer")]
    OrderNotFound,

    // ═══════════════════════════════════════════════════════════════════════
    // DELIVERY ERRORS
    // ═══════════════════════════════════════════════════════════════════════
    
    #[msg("No undelivered orders found for district")]
    NoUndeliveredOrders,
    
    #[msg("New-order record not found")]
    NewOrderNotFound,
    
    #[msg("Order already delivered")]
    OrderAlreadyDelivered,
    
    #[msg("Invalid carrier ID - must be 1-10")]
    InvalidCarrierId,
    
    #[msg("Delivery transaction would exceed compute budget")]
    ComputeBudgetExceeded,

    // ═══════════════════════════════════════════════════════════════════════
    // STOCK-LEVEL ERRORS
    // ═══════════════════════════════════════════════════════════════════════
    
    #[msg("Invalid stock threshold")]
    InvalidStockThreshold,

    // ═══════════════════════════════════════════════════════════════════════
    // INDEX ERRORS
    // ═══════════════════════════════════════════════════════════════════════
    
    #[msg("Customer index not found")]
    CustomerIndexNotFound,
    
    #[msg("Customer index full - too many customers with same last name")]
    CustomerIndexFull,

    // ═══════════════════════════════════════════════════════════════════════
    // BENCHMARK CONTROL ERRORS
    // ═══════════════════════════════════════════════════════════════════════
    
    #[msg("Benchmark not initialized")]
    BenchmarkNotInitialized,
    
    #[msg("Benchmark already running")]
    BenchmarkAlreadyRunning,
    
    #[msg("Benchmark not running")]
    BenchmarkNotRunning,
    
    #[msg("Unauthorized - only authority can perform this action")]
    Unauthorized,

    // ═══════════════════════════════════════════════════════════════════════
    // CONCURRENCY ERRORS (Blockchain-specific)
    // ═══════════════════════════════════════════════════════════════════════
    
    #[msg("Account lock conflict - transaction serialized")]
    LockConflict,
    
    #[msg("Stale blockhash - transaction expired")]
    StaleBlockhash,
    
    #[msg("Account already in use by concurrent transaction")]
    AccountInUse,
}
