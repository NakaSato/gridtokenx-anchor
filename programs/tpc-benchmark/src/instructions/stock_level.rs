//! Stock-Level Transaction (4% of TPC-C Workload)
//! 
//! This is a READ-ONLY transaction that counts items below a
//! stock threshold for recent orders.
//! 
//! ## Concurrency Analysis
//! 
//! No write contention - purely read operations.
//! Can execute in parallel with all other transactions.
//! 
//! ## Implementation Note
//! 
//! TPC-C specifies examining the last 20 orders. In Solana,
//! this requires passing all relevant Stock accounts.
//! We simplify by passing the accounts to check directly.

use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::TpcError;

/// Stock-Level Transaction Context
#[derive(Accounts)]
#[instruction(w_id: u64, d_id: u64)]
pub struct StockLevel<'info> {
    /// District to get next_o_id (determines recent orders)
    #[account(
        seeds = [b"district", w_id.to_le_bytes().as_ref(), d_id.to_le_bytes().as_ref()],
        bump = district.load()?.bump,
    )]
    pub district: AccountLoader<'info, District>,
    
    // Remaining accounts: Stock accounts to check
    // [stock_1, stock_2, ..., stock_n]
}

/// Stock Level Result
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct StockLevelResult {
    /// Warehouse ID
    pub w_id: u64,
    /// District ID
    pub d_id: u64,
    /// Threshold used for counting
    pub threshold: u64,
    /// Number of distinct items below threshold
    pub low_stock_count: u64,
    /// Total items checked
    pub items_checked: u64,
}

/// Execute Stock-Level Transaction
/// 
/// # Arguments
/// * `w_id` - Warehouse ID
/// * `d_id` - District ID
/// * `threshold` - Stock quantity threshold
/// 
/// # Remaining Accounts
/// Stock accounts to check: ["stock", w_id, i_id] for each item
pub fn stock_level<'info>(
    ctx: Context<StockLevel<'info>>,
    w_id: u64,
    d_id: u64,
    threshold: u64,
) -> Result<()> {
    require!(threshold > 0, TpcError::InvalidStockThreshold);
    
    let district = ctx.accounts.district.load()?;
    let _next_o_id = district.next_o_id;
    
    // Count items below threshold from remaining accounts
    let mut low_stock_count: u64 = 0;
    let mut items_checked: u64 = 0;
    
    for stock_account in ctx.remaining_accounts.iter() {
        let data = stock_account.try_borrow_data()?;
        if data.len() >= 8 + std::mem::size_of::<Stock>() {
            let stock = bytemuck::from_bytes::<Stock>(&data[8..8 + std::mem::size_of::<Stock>()]);
            items_checked += 1;
            
            // Check if stock is below threshold
            if stock.quantity < threshold {
                low_stock_count += 1;
            }
        }
    }
    
    // The StockLevelResult is not explicitly returned or emitted as an event
    // in this benchmark version, but it's good practice to define it.
    // let _result = StockLevelResult {
    //     w_id,
    //     d_id,
    //     threshold,
    //     low_stock_count,
    //     items_checked,
    // };
    
    msg!(
        "Stock-Level: W={} D={} threshold={} low_stock={}/{}",
        w_id, d_id, threshold, low_stock_count, items_checked
    );
    
    // In production, emit as event or return data
    // For benchmark, we just log the result
    
    Ok(())
}
