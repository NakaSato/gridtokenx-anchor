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
use bytemuck::{Pod, Zeroable};
use crate::error::TpcError;

// ═══════════════════════════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════════════════════════

pub fn string_to_bytes<const N: usize>(s: &str) -> [u8; N] {
    let mut bytes = [0u8; N];
    let s_bytes = s.as_bytes();
    let len = s_bytes.len().min(N);
    bytes[..len].copy_from_slice(&s_bytes[..len]);
    bytes
}

pub fn bytes_to_string(bytes: &[u8]) -> String {
    let len = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
    let s = std::str::from_utf8(&bytes[..len]).unwrap_or("");
    s.to_string()
}

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
#[account(zero_copy)]
#[repr(C)]
pub struct Warehouse {
    /// Warehouse ID (W_ID)
    pub w_id: u64,
    
    /// Warehouse name (W_NAME) - max 10 chars, using 16 for Pod
    pub name: [u8; 16],
    
    /// Street suffix 1 (W_STREET_1) - max 20, using 32
    pub street_1: [u8; 32],
    
    /// Street suffix 2 (W_STREET_2) - max 20, using 32
    pub street_2: [u8; 32],
    
    /// City name (W_CITY) - max 20, using 32
    pub city: [u8; 32],
    
    /// State (W_STATE) - 2 chars, using 2
    pub state: [u8; 2],
    
    /// Zip code (W_ZIP) - 9 chars, using 16 for alignment/Pod
    pub zip: [u8; 16],
    pub _padding: [u8; 6], // 8 + 16 + 32 + 32 + 32 + 2 + 16 = 138. 144-138=6.
    
    /// Sales tax (W_TAX)
    pub tax: u64,
    
    /// Year-to-date sales (W_YTD)
    pub ytd: u64,
    
    /// Bump seed
    pub bump: u8,
    pub _padding_2: [u8; 7],
}

impl Warehouse {
    pub const SPACE: usize = 8 + std::mem::size_of::<Warehouse>();
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
#[account(zero_copy)]
#[repr(C)]
pub struct District {
    /// Warehouse ID (D_W_ID)
    pub w_id: u64,
    /// District ID (D_ID)
    pub d_id: u64,
    
    /// District name (D_NAME) - max 10, using 16
    pub name: [u8; 16],
    
    /// Street suffix 1 (D_STREET_1) - max 20, using 32
    pub street_1: [u8; 32],
    
    /// Street suffix 2 (D_STREET_2) - max 20, using 32
    pub street_2: [u8; 32],
    
    /// City name (D_CITY) - max 20, using 32
    pub city: [u8; 32],
    
    /// State (D_STATE) - 2, using 2
    pub state: [u8; 2],
    
    /// Zip code (D_ZIP) - 9, using 16 for Pod
    pub zip: [u8; 16],
    pub _padding: [u8; 6], // Align to 8 bytes
    
    /// Sales tax (D_TAX)
    pub tax: u64,
    
    /// Year-to-date sales (D_YTD)
    pub ytd: u64,
    
    /// Next available order ID (D_NEXT_O_ID)
    pub next_o_id: u64,
    
    /// Bump seed
    pub bump: u8,
    pub _padding_2: [u8; 7],
}

impl District {
    pub const SPACE: usize = 8 + std::mem::size_of::<District>();
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
#[account(zero_copy)]
#[repr(C)]
pub struct Customer {
    /// Warehouse ID (C_W_ID)
    pub w_id: u64,
    /// District ID (C_D_ID)
    pub d_id: u64,
    /// Customer ID (C_ID)
    pub c_id: u64,
    
    /// First name (C_FIRST) - 16
    pub first: [u8; 16],
    
    /// Middle name (C_MIDDLE) - 2, using 2
    pub middle: [u8; 2],
    
    /// Last name (C_LAST) - 16
    pub last: [u8; 16],
    
    /// Street suffix 1 (C_STREET_1) - 20, using 32
    pub street_1: [u8; 32],
    
    /// Street suffix 2 (C_STREET_2) - 20, using 32
    pub street_2: [u8; 32],
    
    /// City name (C_CITY) - 20, using 32
    pub city: [u8; 32],
    
    /// State (C_STATE) - 2, using 2
    pub state: [u8; 2],
    
    /// Zip code (C_ZIP) - 9, using 16
    pub zip: [u8; 16],
    
    /// Phone number (C_PHONE) - 16
    pub phone: [u8; 16],
    pub _padding: [u8; 4], // Align to 8 bytes (188 + 4 = 192)
    
    /// Date of registration (C_SINCE)
    pub since: i64,
    
    /// Credit status (C_CREDIT)
    pub credit: u8,
    pub _padding_2: [u8; 7],
    
    /// Credit limit (C_CREDIT_LIM)
    pub credit_lim: u64,
    
    /// Discount rate (C_DISCOUNT)
    pub discount: u64,
    
    /// Current balance (C_BALANCE)
    pub balance: i64,
    
    /// Year-to-date payment (C_YTD_PAYMENT)
    pub ytd_payment: u64,
    
    /// Number of payments (C_PAYMENT_CNT)
    pub payment_cnt: u32,
    
    /// Number of deliveries (C_DELIVERY_CNT)
    pub delivery_cnt: u32,
    
    /// Additional data - max 500, using 512 for Pod
    pub data: [u8; 512],
    
    /// Bump seed
    pub bump: u8,
    pub _padding_3: [u8; 7],
}

impl Customer {
    pub const SPACE: usize = 8 + std::mem::size_of::<Customer>();
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
#[account(zero_copy)]
#[repr(C)]
pub struct Item {
    /// Item ID (I_ID)
    pub i_id: u64,
    
    /// Image ID (I_IM_ID)
    pub im_id: u64,
    
    /// Item name (I_NAME) - 24, using 32
    pub name: [u8; 32],
    
    /// Item price (I_PRICE)
    pub price: u64,
    
    /// Item data (I_DATA) - 50, using 64
    pub data: [u8; 64],
    
    /// Bump seed
    pub bump: u8,
    pub _padding: [u8; 7],
}

impl Item {
    pub const SPACE: usize = 8 + std::mem::size_of::<Item>();
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
#[account(zero_copy)]
#[repr(C)]
pub struct Stock {
    /// Warehouse ID (S_W_ID)
    pub w_id: u64,
    /// Item ID (S_I_ID)
    pub i_id: u64,
    
    /// Current quantity (S_QUANTITY)
    pub quantity: u64,
    
    /// District-specific data strings - 24, using 32
    pub dist_01: [u8; 32],
    pub dist_02: [u8; 32],
    pub dist_03: [u8; 32],
    pub dist_04: [u8; 32],
    pub dist_05: [u8; 32],
    pub dist_06: [u8; 32],
    pub dist_07: [u8; 32],
    pub dist_08: [u8; 32],
    pub dist_09: [u8; 32],
    pub dist_10: [u8; 32],
    
    /// Year-to-date quantity sold (S_YTD)
    pub ytd: u64,
    
    /// Order count (S_ORDER_CNT)
    pub order_cnt: u32,
    
    /// Remote order count
    pub remote_cnt: u32,
    
    /// Stock data - 50, using 64
    pub data: [u8; 64],
    
    /// Bump seed
    pub bump: u8,
    pub _padding: [u8; 7],
}

impl Stock {
    pub const SPACE: usize = 8 + std::mem::size_of::<Stock>();
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
#[account(zero_copy)]
#[repr(C)]
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
    
    /// Carrier ID (O_CARRIER_ID) - set during Delivery (0 if None)
    pub carrier_id: u64,
    
    /// Order line count (O_OL_CNT) - 5 to 15
    pub ol_cnt: u8,
    
    /// All local flag (O_ALL_LOCAL)
    /// 0 if false, 1 if true
    pub all_local: u8,
    pub bump: u8,
    pub _padding: [u8; 5], // Align embedded lines (32+8+8+1+1+1+5=56)
    
    /// EMBEDDED: Order lines (optimization)
    /// Instead of separate ORDER_LINE accounts, embed them here
    /// Max 15 lines per TPC-C spec
    pub lines: [OrderLine; 15],
}

/// Order line - individual item in an order
/// Embedded in Order account to reduce account count per transaction
#[zero_copy]
#[repr(C)]
pub struct OrderLine {
    /// Line number (OL_NUMBER) - 1 to 15
    pub number: u8,
    pub _padding: [u8; 7], // Align next u64
    
    /// Item ID (OL_I_ID)
    pub i_id: u64,
    
    /// Supply warehouse ID (OL_SUPPLY_W_ID)
    pub supply_w_id: u64,
    
    /// Delivery date (OL_DELIVERY_D)
    pub delivery_d: i64,
    
    /// Amount (OL_AMOUNT)
    pub amount: u64,
    
    /// Distribution info - 24, using 32
    pub dist_info: [u8; 32],

    /// Quantity (OL_QUANTITY)
    pub quantity: u8,
    pub _padding_2: [u8; 7],
}

impl OrderLine {
    pub const SPACE: usize = std::mem::size_of::<OrderLine>();
}

impl Order {
    /// Maximum order lines per TPC-C spec
    pub const MAX_ORDER_LINES: usize = 15;
    
    pub const SPACE: usize = 8 + std::mem::size_of::<Order>();
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
/// History account - records a payment
/// PDA: ["history", w_id.to_le_bytes(), d_id.to_le_bytes(), h_id.to_le_bytes()]
#[account(zero_copy)]
#[repr(C)]
pub struct History {
    /// Warehouse ID (H_C_W_ID) of customer
    pub c_w_id: u64,
    /// District ID (H_C_D_ID) of customer
    pub c_d_id: u64,
    /// Customer ID (H_C_ID)
    pub c_id: u64,
    
    /// Transaction's warehouse ID (H_W_ID)
    pub w_id: u64,
    /// Transaction's district ID (H_D_ID)
    pub d_id: u64,
    
    /// History ID
    pub h_id: u64,
    
    /// Transaction date (H_DATE)
    pub date: i64,
    
    /// Payment amount (H_AMOUNT)
    pub amount: u64,
    
    /// Data string - 24, using 32
    pub data: [u8; 32],
    
    /// Bump seed
    pub bump: u8,
    pub _padding: [u8; 7],
}

impl History {
    pub const SPACE: usize = 8 + std::mem::size_of::<History>();
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
