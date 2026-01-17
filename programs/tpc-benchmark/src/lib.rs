//! # TPC-C Benchmark Implementation for Solana Anchor
//! 
//! This module implements the TPC-C (Transaction Processing Performance Council - C)
//! benchmark adapted for the Solana blockchain using the Anchor framework.
//! 
//! ## Architecture Overview
//! 
//! The TPC-C benchmark simulates a complete computing environment where a population
//! of terminal operators executes transactions against a database. The benchmark is
//! centered around the principal activities of an order-entry environment.
//! 
//! ### TPC-C to Solana Mapping
//! 
//! | TPC-C Table   | Solana Account Strategy      | PDA Seeds                           |
//! |---------------|------------------------------|-------------------------------------|
//! | WAREHOUSE     | Individual Account           | ["warehouse", w_id]                 |
//! | DISTRICT      | Individual Account           | ["district", w_id, d_id]            |
//! | CUSTOMER      | Individual Account           | ["customer", w_id, d_id, c_id]      |
//! | ITEM          | Individual Account           | ["item", i_id]                      |
//! | STOCK         | Individual Account           | ["stock", w_id, i_id]               |
//! | ORDER         | Individual Account + Lines   | ["order", w_id, d_id, o_id]         |
//! | NEW_ORDER     | Individual Account           | ["new_order", w_id, d_id, o_id]     |
//! | HISTORY       | Individual Account           | ["history", w_id, d_id, h_id]       |
//! 
//! ### Transaction Mix (Per TPC-C Specification)
//! 
//! - New-Order: 45% (Write-heavy, high contention on District.next_o_id)
//! - Payment: 43% (Write-heavy, updates YTD balances)
//! - Order-Status: 4% (Read-only)
//! - Delivery: 4% (Batch processing, 10 districts per warehouse)
//! - Stock-Level: 4% (Read-only, aggregation query)
//! 
//! ## Proof of Authority (PoA) Context
//! 
//! This implementation is designed to run in a Solana Permissioned Environment (SPE)
//! where the validator set is fixed and controlled, emulating PoA consensus for
//! enterprise blockchain research.

use anchor_lang::prelude::*;

pub mod error;
pub mod instructions;
pub mod state;

pub use error::*;
#[allow(ambiguous_glob_reexports)]
pub use instructions::*;
pub use state::*;

declare_id!("CKLCEJhsxMu1NNEu9oVuyDqpkXcR9dMr769XSuh2WAjC");

#[cfg(feature = "localnet")]
use compute_debug::{compute_fn, compute_checkpoint};

#[cfg(not(feature = "localnet"))]
macro_rules! compute_fn {
    ($name:expr => $block:block) => { $block };
}
#[cfg(not(feature = "localnet"))]
macro_rules! compute_checkpoint {
    ($name:expr) => {};
}

/// TPC-C Transaction Mix Constants (per TPC-C Specification v5.11)
pub mod tpc_constants {
    /// New-Order transaction frequency (45%)
    pub const NEW_ORDER_FREQ: u8 = 45;
    /// Payment transaction frequency (43%)
    pub const PAYMENT_FREQ: u8 = 43;
    /// Order-Status transaction frequency (4%)
    pub const ORDER_STATUS_FREQ: u8 = 4;
    /// Delivery transaction frequency (4%)
    pub const DELIVERY_FREQ: u8 = 4;
    /// Stock-Level transaction frequency (4%)
    pub const STOCK_LEVEL_FREQ: u8 = 4;
    
    /// Minimum items per New-Order (per spec)
    pub const MIN_ORDER_LINES: u8 = 5;
    /// Maximum items per New-Order (per spec)
    pub const MAX_ORDER_LINES: u8 = 15;
    
    /// Number of districts per warehouse
    pub const DISTRICTS_PER_WAREHOUSE: u8 = 10;
    /// Number of customers per district (3000 per TPC-C)
    pub const CUSTOMERS_PER_DISTRICT: u16 = 3000;
    /// Total item count (100,000 per TPC-C)
    pub const TOTAL_ITEMS: u32 = 100_000;
    
    /// Cross-warehouse order percentage (1% per spec)
    pub const REMOTE_ORDER_PERCENT: u8 = 1;
    /// Customer lookup by last name percentage (60%)
    pub const LOOKUP_BY_LAST_NAME_PERCENT: u8 = 60;
}

#[program]
pub mod tpc_benchmark {
    use super::*;

    // ═══════════════════════════════════════════════════════════════════════════
    // INITIALIZATION INSTRUCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    pub fn initialize_benchmark(
        ctx: Context<InitializeBenchmark>,
        config: BenchmarkConfig,
    ) -> Result<()> {
        compute_fn!("initialize_benchmark" => {
            instructions::initialize_benchmark(ctx, config)
        })
    }

    pub fn initialize_warehouse(
        ctx: Context<InitializeWarehouse>,
        w_id: u64,
        name: String,
        street_1: String,
        street_2: String,
        city: String,
        state: String,
        zip: String,
        tax: u64,
    ) -> Result<()> {
        compute_fn!("initialize_warehouse" => {
            instructions::initialize_warehouse(ctx, w_id, name, street_1, street_2, city, state, zip, tax)
        })
    }

    pub fn initialize_district(
        ctx: Context<InitializeDistrict>,
        w_id: u64,
        d_id: u64,
        name: String,
        street_1: String,
        street_2: String,
        city: String,
        state: String,
        zip: String,
        tax: u64,
    ) -> Result<()> {
        compute_fn!("initialize_district" => {
            instructions::initialize_district(ctx, w_id, d_id, name, street_1, street_2, city, state, zip, tax)
        })
    }

    pub fn initialize_customer(
        ctx: Context<InitializeCustomer>,
        w_id: u64,
        d_id: u64,
        c_id: u64,
        first: String,
        middle: String,
        last: String,
        street_1: String,
        street_2: String,
        city: String,
        state: String,
        zip: String,
        phone: String,
        credit: CreditStatus,
        credit_lim: u64,
        discount: u64,
    ) -> Result<()> {
        compute_fn!("initialize_customer" => {
            instructions::initialize_customer(
                ctx, w_id, d_id, c_id, first, middle, last,
                street_1, street_2, city, state, zip, phone,
                credit, credit_lim, discount,
            )
        })
    }

    pub fn initialize_item(
        ctx: Context<InitializeItem>,
        i_id: u64,
        im_id: u64,
        name: String,
        price: u64,
        data: String,
    ) -> Result<()> {
        compute_fn!("initialize_item" => {
            instructions::initialize_item(ctx, i_id, im_id, name, price, data)
        })
    }

    pub fn initialize_stock(
        ctx: Context<InitializeStock>,
        w_id: u64,
        i_id: u64,
        quantity: u64,
        dist_01: String,
        dist_02: String,
        dist_03: String,
        dist_04: String,
        dist_05: String,
        dist_06: String,
        dist_07: String,
        dist_08: String,
        dist_09: String,
        dist_10: String,
        data: String,
    ) -> Result<()> {
        compute_fn!("initialize_stock" => {
            instructions::initialize_stock(
                ctx, w_id, i_id, quantity,
                dist_01, dist_02, dist_03, dist_04, dist_05,
                dist_06, dist_07, dist_08, dist_09, dist_10,
                data,
            )
        })
    }

    pub fn initialize_customer_index(
        ctx: Context<InitializeCustomerIndex>,
        w_id: u64,
        d_id: u64,
        last_name_hash: [u8; 32],
    ) -> Result<()> {
        compute_fn!("initialize_customer_index" => {
            instructions::initialize_customer_index(ctx, w_id, d_id, last_name_hash)
        })
    }

    pub fn new_order<'info>(
        ctx: Context<'_, '_, 'info, 'info, NewOrder<'info>>,
        w_id: u64,
        d_id: u64,
        c_id: u64,
        order_lines: Vec<OrderLineInput>,
    ) -> Result<()> {
        compute_fn!("new_order" => {
            instructions::new_order(ctx, w_id, d_id, c_id, order_lines)
        })
    }

    pub fn payment(
        ctx: Context<Payment>,
        w_id: u64,
        d_id: u64,
        c_id: u64,
        c_w_id: u64,
        c_d_id: u64,
        h_id: u64,
        h_amount: u64,
        by_last_name: bool,
    ) -> Result<()> {
        compute_fn!("payment" => {
            instructions::payment(ctx, w_id, d_id, c_id, c_w_id, c_d_id, h_id, h_amount, by_last_name)
        })
    }

    pub fn order_status(
        ctx: Context<OrderStatus>,
        w_id: u64,
        d_id: u64,
        c_id: u64,
        by_last_name: bool,
    ) -> Result<()> {
        compute_fn!("order_status" => {
            instructions::order_status(ctx, w_id, d_id, c_id, by_last_name)
        })
    }

    pub fn delivery<'a, 'info>(
        ctx: Context<'a, 'a, 'a, 'info, Delivery<'info>>,
        w_id: u64,
        carrier_id: u64,
    ) -> Result<()> {
        compute_fn!("delivery" => {
            instructions::delivery(ctx, w_id, carrier_id)
        })
    }

    pub fn delivery_district(
        ctx: Context<DeliveryDistrict>,
        w_id: u64,
        d_id: u64,
        carrier_id: u64,
    ) -> Result<()> {
        compute_fn!("delivery_district" => {
            instructions::delivery_district(ctx, w_id, d_id, carrier_id)
        })
    }

    pub fn stock_level(
        ctx: Context<StockLevel>,
        w_id: u64,
        d_id: u64,
        threshold: u64,
    ) -> Result<()> {
        compute_fn!("stock_level" => {
            instructions::stock_level(ctx, w_id, d_id, threshold)
        })
    }

    pub fn record_metric(
        ctx: Context<RecordMetric>,
        tx_type: TransactionType,
        latency_us: u64,
        success: bool,
        retry_count: u8,
    ) -> Result<()> {
        compute_fn!("record_metric" => {
            instructions::record_metric(ctx, tx_type, latency_us, success, retry_count)
        })
    }

    pub fn reset_benchmark(ctx: Context<ResetBenchmark>) -> Result<()> {
        compute_fn!("reset_benchmark" => {
            instructions::reset_benchmark(ctx)
        })
    }
}
