//! TPC-C State Structures for Solana Anchor
//! 
//! This module defines all the account structures that map the TPC-C
//! relational schema to Solana's Key-Value account model using PDAs.
//! 
//! ## Design Principles
//! 
//! 1. **State Fragmentation**: Each "row" becomes a separate account to enable
//!    parallel access via Sealevel runtime.
//! 
//! 2. **Deterministic Addressing**: PDAs derived from primary keys enable O(1)
//!    lookup without on-chain indexes for primary key queries.
//! 
//! 3. **Embedded Relationships**: One-to-many relationships (like Order-Lines)
//!    are embedded as vectors to reduce account count per transaction.
//! 
//! 4. **Fixed-Size Allocation**: Accounts are allocated with maximum size
//!    to avoid costly realloc operations.

use anchor_lang::prelude::*;

// ═══════════════════════════════════════════════════════════════════════════════
// BENCHMARK CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

/// Global benchmark configuration and statistics
#[account]
#[derive(Default)]
pub struct BenchmarkState {
    /// Authority who can manage the benchmark
    pub authority: Pubkey,
    
    /// Benchmark configuration
    pub config: BenchmarkConfig,
    
    /// Running statistics
    pub stats: BenchmarkStats,
    
    /// Benchmark state
    pub is_running: bool,
    pub start_time: i64,
    pub end_time: i64,
    
    /// Bump seed for PDA
    pub bump: u8,
}

/// Configuration for benchmark execution
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct BenchmarkConfig {
    /// Number of warehouses (W parameter - scale factor)
    pub warehouses: u64,
    /// Districts per warehouse (always 10 per TPC-C spec)
    pub districts_per_warehouse: u8,
    /// Customers per district (3000 per TPC-C spec)
    pub customers_per_district: u16,
    /// Total items in catalog (100,000 per TPC-C spec)
    pub total_items: u32,
    /// Duration in seconds
    pub duration_seconds: u64,
    /// Warmup percentage to discard
    pub warmup_percent: u8,
    /// Whether to use real transactions or simulation
    pub use_real_transactions: bool,
}

/// Benchmark execution statistics
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct BenchmarkStats {
    /// New-Order transactions completed
    pub new_order_count: u64,
    /// Payment transactions completed
    pub payment_count: u64,
    /// Order-Status transactions completed
    pub order_status_count: u64,
    /// Delivery transactions completed
    pub delivery_count: u64,
    /// Stock-Level transactions completed
    pub stock_level_count: u64,
    
    /// Total successful transactions
    pub successful_transactions: u64,
    /// Total failed transactions
    pub failed_transactions: u64,
    /// MVCC/Lock conflicts
    pub conflict_count: u64,
    
    /// Latency statistics (microseconds)
    pub total_latency_us: u64,
    pub min_latency_us: u64,
    pub max_latency_us: u64,
    
    /// Computed tpmC (New-Order transactions per minute)
    pub tpm_c: u64,
}

// ═══════════════════════════════════════════════════════════════════════════════
// WAREHOUSE
// ═══════════════════════════════════════════════════════════════════════════════

/// Warehouse account - represents a distribution center
/// PDA: ["warehouse", w_id.to_le_bytes()]
/// 
/// Contention Profile: MODERATE
/// - Updated by Payment transactions (YTD field)
/// - All payments for this warehouse contend on this account
#[account]
pub struct Warehouse {
    /// Warehouse ID (W_ID) - primary key
    pub w_id: u64,
    
    /// Warehouse name (W_NAME) - max 10 chars
    pub name: String,
    
    /// Address fields
    pub street_1: String,  // W_STREET_1 - max 20 chars
    pub street_2: String,  // W_STREET_2 - max 20 chars
    pub city: String,      // W_CITY - max 20 chars
    pub state: String,     // W_STATE - 2 chars
    pub zip: String,       // W_ZIP - 9 chars
    
    /// Tax rate (W_TAX) - stored as basis points (0-2000 for 0-20%)
    pub tax: u64,
    
    /// Year-to-date balance (W_YTD) - updated by Payment transactions
    /// This is a HOT FIELD causing write contention
    pub ytd: u64,
    
    /// Bump seed for PDA derivation
    pub bump: u8,
}

impl Warehouse {
    /// Space required for account allocation
    /// Includes discriminator (8) + all fields with max lengths
    pub const SPACE: usize = 8 +  // discriminator
        8 +                       // w_id
        4 + 10 +                  // name (String: 4 byte len + 10 chars)
        4 + 20 +                  // street_1
        4 + 20 +                  // street_2
        4 + 20 +                  // city
        4 + 2 +                   // state
        4 + 9 +                   // zip
        8 +                       // tax
        8 +                       // ytd
        1;                        // bump
}

// ═══════════════════════════════════════════════════════════════════════════════
// DISTRICT
// ═══════════════════════════════════════════════════════════════════════════════

/// District account - subdivision of a warehouse
/// PDA: ["district", w_id.to_le_bytes(), d_id.to_le_bytes()]
/// 
/// Contention Profile: HIGH (CRITICAL SYNCHRONIZATION POINT)
/// - next_o_id is incremented by EVERY New-Order transaction
/// - All New-Order transactions for this district are SERIALIZED
/// - Parallelism is achieved ACROSS districts, not within
#[account]
pub struct District {
    /// Warehouse ID (D_W_ID) - part of composite key
    pub w_id: u64,
    
    /// District ID (D_ID) - 1-10 per warehouse
    pub d_id: u64,
    
    /// District name (D_NAME) - max 10 chars
    pub name: String,
    
    /// Address fields
    pub street_1: String,
    pub street_2: String,
    pub city: String,
    pub state: String,
    pub zip: String,
    
    /// Tax rate (D_TAX) - stored as basis points
    pub tax: u64,
    
    /// Year-to-date balance (D_YTD) - updated by Payment
    pub ytd: u64,
    
    /// CRITICAL: Next available order ID (D_NEXT_O_ID)
    /// This counter is the primary source of write contention
    /// All New-Order transactions must increment this atomically
    pub next_o_id: u64,
    
    /// Bump seed for PDA derivation
    pub bump: u8,
}

impl District {
    pub const SPACE: usize = 8 +  // discriminator
        8 +                       // w_id
        8 +                       // d_id
        4 + 10 +                  // name
        4 + 20 +                  // street_1
        4 + 20 +                  // street_2
        4 + 20 +                  // city
        4 + 2 +                   // state
        4 + 9 +                   // zip
        8 +                       // tax
        8 +                       // ytd
        8 +                       // next_o_id
        1;                        // bump
}

// ═══════════════════════════════════════════════════════════════════════════════
// CUSTOMER
// ═══════════════════════════════════════════════════════════════════════════════

/// Customer credit status
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Default)]
pub enum CreditStatus {
    /// Good credit standing
    #[default]
    GoodCredit,
    /// Bad credit - requires additional data logging
    BadCredit,
}

/// Customer account - end user who places orders
/// PDA: ["customer", w_id.to_le_bytes(), d_id.to_le_bytes(), c_id.to_le_bytes()]
/// 
/// Contention Profile: LOW
/// - Updated by Payment transactions (balance, ytd_payment)
/// - Conflicts only when same customer makes multiple payments
#[account]
pub struct Customer {
    /// Warehouse ID (C_W_ID)
    pub w_id: u64,
    /// District ID (C_D_ID)
    pub d_id: u64,
    /// Customer ID (C_ID) - 1-3000 per district
    pub c_id: u64,
    
    /// Name fields (for secondary index lookup)
    pub first: String,   // C_FIRST - max 16 chars
    pub middle: String,  // C_MIDDLE - 2 chars
    pub last: String,    // C_LAST - max 16 chars (used for 60% of lookups!)
    
    /// Address
    pub street_1: String,
    pub street_2: String,
    pub city: String,
    pub state: String,
    pub zip: String,
    pub phone: String,   // C_PHONE - 16 chars
    
    /// Timestamps
    pub since: i64,      // C_SINCE - registration timestamp
    
    /// Credit information
    pub credit: CreditStatus,  // C_CREDIT - GC or BC
    pub credit_lim: u64,       // C_CREDIT_LIM
    pub discount: u64,         // C_DISCOUNT - basis points
    
    /// Financial data
    pub balance: i64,          // C_BALANCE - can be negative
    pub ytd_payment: u64,      // C_YTD_PAYMENT
    pub payment_cnt: u32,      // C_PAYMENT_CNT
    pub delivery_cnt: u32,     // C_DELIVERY_CNT
    
    /// Additional data for bad credit customers
    pub data: String,          // C_DATA - max 500 chars
    
    /// Bump seed
    pub bump: u8,
}

impl Customer {
    pub const SPACE: usize = 8 +  // discriminator
        8 + 8 + 8 +               // w_id, d_id, c_id
        4 + 16 +                  // first
        4 + 2 +                   // middle
        4 + 16 +                  // last
        4 + 20 +                  // street_1
        4 + 20 +                  // street_2
        4 + 20 +                  // city
        4 + 2 +                   // state
        4 + 9 +                   // zip
        4 + 16 +                  // phone
        8 +                       // since
        1 +                       // credit (enum)
        8 +                       // credit_lim
        8 +                       // discount
        8 +                       // balance (signed)
        8 +                       // ytd_payment
        4 +                       // payment_cnt
        4 +                       // delivery_cnt
        4 + 500 +                 // data
        1;                        // bump
}

// ═══════════════════════════════════════════════════════════════════════════════
// CUSTOMER INDEX (Secondary Index for Last Name Lookup)
// ═══════════════════════════════════════════════════════════════════════════════

/// Secondary index for customer last name lookup
/// PDA: ["idx_c_last", w_id.to_le_bytes(), d_id.to_le_bytes(), hash(c_last)]
/// 
/// TPC-C requires 60% of Payment and Order-Status to lookup by last name.
/// Since Solana doesn't support native secondary indexes, we build one.
/// 
/// Handles non-unique last names by storing a vector of customer IDs.
#[account]
pub struct CustomerLastNameIndex {
    /// Warehouse ID
    pub w_id: u64,
    /// District ID
    pub d_id: u64,
    /// Hash of the last name (32 bytes)
    pub last_name_hash: [u8; 32],
    
    /// List of customer IDs with this last name
    /// TPC-C spec: return middle customer in sorted order
    pub customer_ids: Vec<u64>,
    
    /// Bump seed
    pub bump: u8,
}

impl CustomerLastNameIndex {
    /// Max customers with same last name (conservative estimate)
    pub const MAX_CUSTOMERS_PER_NAME: usize = 20;
    
    pub const SPACE: usize = 8 +  // discriminator
        8 + 8 +                   // w_id, d_id
        32 +                      // last_name_hash
        4 + (8 * Self::MAX_CUSTOMERS_PER_NAME) + // customer_ids vector
        1;                        // bump
}

// ═══════════════════════════════════════════════════════════════════════════════
// ITEM
// ═══════════════════════════════════════════════════════════════════════════════

/// Item account - product in the catalog
/// PDA: ["item", i_id.to_le_bytes()]
/// 
/// Contention Profile: READ-ONLY after initialization
/// - Never updated during benchmark execution
/// - Safe for parallel access from all transactions
#[account]
pub struct Item {
    /// Item ID (I_ID) - 1 to 100,000
    pub i_id: u64,
    
    /// Image ID (I_IM_ID)
    pub im_id: u64,
    
    /// Item name (I_NAME) - max 24 chars
    pub name: String,
    
    /// Item price (I_PRICE) - stored in minor units (cents)
    /// Range: $1.00 to $100.00 (100-10000)
    pub price: u64,
    
    /// Item data (I_DATA) - max 50 chars
    /// 10% contain "ORIGINAL" string
    pub data: String,
    
    /// Bump seed
    pub bump: u8,
}

impl Item {
    pub const SPACE: usize = 8 +  // discriminator
        8 +                       // i_id
        8 +                       // im_id
        4 + 24 +                  // name
        8 +                       // price
        4 + 50 +                  // data
        1;                        // bump
}

// ═══════════════════════════════════════════════════════════════════════════════
// STOCK
// ═══════════════════════════════════════════════════════════════════════════════

/// Stock account - inventory of an item at a warehouse
/// PDA: ["stock", w_id.to_le_bytes(), i_id.to_le_bytes()]
/// 
/// Contention Profile: HIGH
/// - Updated by EVERY New-Order that includes this item
/// - Popular items will have significant contention
/// - TPC-C uses skewed distribution (zipfian) for item selection
#[account]
pub struct Stock {
    /// Warehouse ID (S_W_ID)
    pub w_id: u64,
    /// Item ID (S_I_ID)
    pub i_id: u64,
    
    /// Current quantity (S_QUANTITY) - 10 to 100
    pub quantity: u64,
    
    /// District-specific data strings (S_DIST_01 through S_DIST_10)
    /// Each is 24 chars, used for order line distribution info
    pub dist_01: String,
    pub dist_02: String,
    pub dist_03: String,
    pub dist_04: String,
    pub dist_05: String,
    pub dist_06: String,
    pub dist_07: String,
    pub dist_08: String,
    pub dist_09: String,
    pub dist_10: String,
    
    /// Year-to-date quantity sold (S_YTD)
    pub ytd: u64,
    
    /// Order count (S_ORDER_CNT)
    pub order_cnt: u32,
    
    /// Remote order count (S_REMOTE_CNT) - cross-warehouse orders
    pub remote_cnt: u32,
    
    /// Stock data (S_DATA) - max 50 chars
    /// 10% contain "ORIGINAL" string
    pub data: String,
    
    /// Bump seed
    pub bump: u8,
}

impl Stock {
    pub const SPACE: usize = 8 +  // discriminator
        8 + 8 +                   // w_id, i_id
        8 +                       // quantity
        (4 + 24) * 10 +           // dist_01 through dist_10
        8 +                       // ytd
        4 +                       // order_cnt
        4 +                       // remote_cnt
        4 + 50 +                  // data
        1;                        // bump
}

// ═══════════════════════════════════════════════════════════════════════════════
// ORDER
// ═══════════════════════════════════════════════════════════════════════════════

/// Order account - customer order with embedded order lines
/// PDA: ["order", w_id.to_le_bytes(), d_id.to_le_bytes(), o_id.to_le_bytes()]
/// 
/// Contention Profile: LOW (immutable after creation)
/// - Created once during New-Order
/// - carrier_id updated once during Delivery
/// 
/// OPTIMIZATION: Order lines are embedded as a vector instead of separate accounts
/// This reduces the transaction size and account loading overhead
#[account]
pub struct Order {
    /// Warehouse ID (O_W_ID)
    pub w_id: u64,
    /// District ID (O_D_ID)
    pub d_id: u64,
    /// Order ID (O_ID) - assigned from District.next_o_id
    pub o_id: u64,
    /// Customer ID (O_C_ID)
    pub c_id: u64,
    
    /// Entry date (O_ENTRY_D)
    pub entry_d: i64,
    
    /// Carrier ID (O_CARRIER_ID) - set during Delivery
    pub carrier_id: Option<u64>,
    
    /// Order line count (O_OL_CNT) - 5 to 15
    pub ol_cnt: u8,
    
    /// All local flag (O_ALL_LOCAL)
    /// True if all items are from home warehouse
    pub all_local: bool,
    
    /// EMBEDDED: Order lines (optimization)
    /// Instead of separate ORDER_LINE accounts, embed them here
    /// Max 15 lines per TPC-C spec
    pub lines: Vec<OrderLine>,
    
    /// Bump seed
    pub bump: u8,
}

/// Order line - individual item in an order
/// Embedded in Order account to reduce account count per transaction
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct OrderLine {
    /// Line number (OL_NUMBER) - 1 to 15
    pub number: u8,
    
    /// Item ID (OL_I_ID)
    pub i_id: u64,
    
    /// Supply warehouse ID (OL_SUPPLY_W_ID)
    /// May differ from order's warehouse for remote orders
    pub supply_w_id: u64,
    
    /// Delivery date (OL_DELIVERY_D) - set during Delivery
    pub delivery_d: Option<i64>,
    
    /// Quantity (OL_QUANTITY)
    pub quantity: u8,
    
    /// Amount (OL_AMOUNT) - computed from item price * quantity
    pub amount: u64,
    
    /// Distribution info (OL_DIST_INFO) - 24 chars from Stock
    pub dist_info: String,
}

impl OrderLine {
    pub const SPACE: usize = 1 +  // number
        8 +                       // i_id
        8 +                       // supply_w_id
        1 + 8 +                   // delivery_d (Option)
        1 +                       // quantity
        8 +                       // amount
        4 + 24;                   // dist_info
}

impl Order {
    /// Maximum order lines per TPC-C spec
    pub const MAX_ORDER_LINES: usize = 15;
    
    pub const SPACE: usize = 8 +  // discriminator
        8 + 8 + 8 + 8 +           // w_id, d_id, o_id, c_id
        8 +                       // entry_d
        1 + 8 +                   // carrier_id (Option)
        1 +                       // ol_cnt
        1 +                       // all_local
        4 + (OrderLine::SPACE * Self::MAX_ORDER_LINES) + // lines vector
        1;                        // bump
}

// ═══════════════════════════════════════════════════════════════════════════════
// NEW_ORDER (Queue for undelivered orders)
// ═══════════════════════════════════════════════════════════════════════════════

/// NewOrder account - tracks orders awaiting delivery
/// PDA: ["new_order", w_id.to_le_bytes(), d_id.to_le_bytes(), o_id.to_le_bytes()]
/// 
/// Contention Profile: HIGH
/// - Created by New-Order
/// - Deleted by Delivery (oldest undelivered order in district)
/// 
/// This serves as a queue: Delivery processes the oldest entry
#[account]
pub struct NewOrderEntry {
    /// Warehouse ID (NO_W_ID)
    pub w_id: u64,
    /// District ID (NO_D_ID)
    pub d_id: u64,
    /// Order ID (NO_O_ID)
    pub o_id: u64,
    
    /// Creation timestamp for ordering
    pub created_at: i64,
    
    /// Bump seed
    pub bump: u8,
}

impl NewOrderEntry {
    pub const SPACE: usize = 8 +  // discriminator
        8 + 8 + 8 +               // w_id, d_id, o_id
        8 +                       // created_at
        1;                        // bump
}

// ═══════════════════════════════════════════════════════════════════════════════
// HISTORY
// ═══════════════════════════════════════════════════════════════════════════════

/// History account - audit trail for payments
/// PDA: ["history", w_id.to_le_bytes(), d_id.to_le_bytes(), h_id.to_le_bytes()]
/// 
/// Contention Profile: LOW (write-once)
/// - Created by Payment transaction
/// - Never updated after creation
#[account]
pub struct History {
    /// Customer's warehouse ID (H_C_W_ID)
    pub c_w_id: u64,
    /// Customer's district ID (H_C_D_ID)
    pub c_d_id: u64,
    /// Customer ID (H_C_ID)
    pub c_id: u64,
    
    /// Transaction's warehouse ID (H_W_ID)
    pub w_id: u64,
    /// Transaction's district ID (H_D_ID)
    pub d_id: u64,
    
    /// History ID (for PDA derivation)
    pub h_id: u64,
    
    /// Transaction date (H_DATE)
    pub date: i64,
    
    /// Payment amount (H_AMOUNT)
    pub amount: u64,
    
    /// Data string (H_DATA) - warehouse + district names
    pub data: String,
    
    /// Bump seed
    pub bump: u8,
}

impl History {
    pub const SPACE: usize = 8 +  // discriminator
        8 + 8 + 8 +               // c_w_id, c_d_id, c_id
        8 + 8 +                   // w_id, d_id
        8 +                       // h_id
        8 +                       // date
        8 +                       // amount
        4 + 24 +                  // data
        1;                        // bump
}

// ═══════════════════════════════════════════════════════════════════════════════
// BENCHMARK METRICS ACCOUNT
// ═══════════════════════════════════════════════════════════════════════════════

/// Transaction type for metric recording
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum TransactionType {
    NewOrder,
    Payment,
    OrderStatus,
    Delivery,
    StockLevel,
}

/// Detailed metrics for a single transaction type
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct TransactionMetrics {
    /// Transaction count
    pub count: u64,
    /// Successful transactions
    pub success_count: u64,
    /// Failed transactions
    pub fail_count: u64,
    /// Lock conflicts (MVCC equivalent)
    pub conflict_count: u64,
    
    /// Latency buckets (microseconds)
    pub latency_sum: u64,
    pub latency_sq_sum: u64,  // For variance calculation
    pub latency_min: u64,
    pub latency_max: u64,
    
    /// Latency histogram (for percentile calculation)
    /// Buckets: <100us, <500us, <1ms, <5ms, <10ms, <50ms, <100ms, <500ms, <1s, >1s
    pub histogram: [u64; 10],
}

/// Order line input for New-Order transaction
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct OrderLineInput {
    /// Item ID
    pub i_id: u64,
    /// Supply warehouse ID (may differ for remote orders)
    pub supply_w_id: u64,
    /// Quantity ordered
    pub quantity: u8,
}
