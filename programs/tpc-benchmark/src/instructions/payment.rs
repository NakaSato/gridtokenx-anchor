//! Payment Transaction (43% of TPC-C Workload)
//! 
//! The Payment transaction updates customer balance and records payment
//! in both warehouse and district YTD totals.
//! 
//! ## Concurrency Analysis
//! 
//! This transaction creates HIGH WRITE CONTENTION on:
//! 1. Warehouse.ytd - All payments to a warehouse update this
//! 2. District.ytd - All payments to a district update this
//! 3. Customer.balance - Lower contention (per-customer)
//! 
//! Since every payment in a district updates District.ytd, all Payment
//! transactions for the same district are serialized on that account.
//! 
//! ## Secondary Index Usage
//! 
//! 60% of payments look up customer by LAST NAME (C_LAST).
//! This requires the CustomerLastNameIndex account to find the customer ID.
//! The middle customer (sorted alphabetically by first name) is selected
//! per TPC-C specification.

use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::TpcError;

/// Payment Transaction Context
#[derive(Accounts)]
#[instruction(w_id: u64, d_id: u64, c_id: u64, c_w_id: u64, c_d_id: u64, h_id: u64)]
pub struct Payment<'info> {
    /// Warehouse receiving payment - UPDATE YTD
    #[account(
        mut,
        seeds = [b"warehouse", w_id.to_le_bytes().as_ref()],
        bump = warehouse.bump,
    )]
    pub warehouse: Account<'info, Warehouse>,
    
    /// District receiving payment - UPDATE YTD
    #[account(
        mut,
        seeds = [b"district", w_id.to_le_bytes().as_ref(), d_id.to_le_bytes().as_ref()],
        bump = district.bump,
    )]
    pub district: Account<'info, District>,
    
    /// Customer making payment - UPDATE BALANCE
    /// Note: Customer may be from different warehouse/district (15% of cases)
    #[account(
        mut,
        seeds = [
            b"customer",
            c_w_id.to_le_bytes().as_ref(),
            c_d_id.to_le_bytes().as_ref(),
            c_id.to_le_bytes().as_ref()
        ],
        bump = customer.bump,
    )]
    pub customer: Account<'info, Customer>,
    
    /// History record - CREATE
    /// h_id should be a unique timestamp provided by the client
    #[account(
        init,
        payer = payer,
        space = History::SPACE,
        seeds = [
            b"history",
            w_id.to_le_bytes().as_ref(),
            d_id.to_le_bytes().as_ref(),
            h_id.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub history: Account<'info, History>,
    
    /// Optional: Customer index for last name lookup
    /// Only used when by_last_name = true (60% of cases)
    /// CHECK: Optional account, validated in instruction
    pub customer_index: Option<UncheckedAccount<'info>>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

/// Execute Payment Transaction
/// 
/// # Arguments
/// * `w_id` - Warehouse ID receiving payment
/// * `d_id` - District ID receiving payment
/// * `c_id` - Customer ID (if by_last_name = false)
/// * `c_w_id` - Customer's warehouse ID (may differ from w_id in 15% of cases)
/// * `c_d_id` - Customer's district ID
/// * `h_id` - Unique history ID (typically timestamp)
/// * `h_amount` - Payment amount in minor units (cents)
/// * `by_last_name` - Whether customer was looked up by last name
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
    require!(h_amount > 0, TpcError::InvalidPaymentAmount);
    
    let warehouse = &mut ctx.accounts.warehouse;
    let district = &mut ctx.accounts.district;
    let customer = &mut ctx.accounts.customer;
    let history = &mut ctx.accounts.history;
    let clock = Clock::get()?;
    
    // ═══════════════════════════════════════════════════════════════════
    // UPDATE WAREHOUSE YTD
    // ═══════════════════════════════════════════════════════════════════
    
    warehouse.ytd = warehouse.ytd
        .checked_add(h_amount)
        .ok_or(TpcError::BalanceOverflow)?;
    
    // ═══════════════════════════════════════════════════════════════════
    // UPDATE DISTRICT YTD
    // ═══════════════════════════════════════════════════════════════════
    
    district.ytd = district.ytd
        .checked_add(h_amount)
        .ok_or(TpcError::BalanceOverflow)?;
    
    // ═══════════════════════════════════════════════════════════════════
    // UPDATE CUSTOMER
    // ═══════════════════════════════════════════════════════════════════
    
    // Balance can be negative, so use signed arithmetic
    let h_amount_signed = h_amount as i64;
    customer.balance = customer.balance
        .checked_sub(h_amount_signed)
        .ok_or(TpcError::BalanceOverflow)?;
    
    customer.ytd_payment = customer.ytd_payment
        .checked_add(h_amount)
        .ok_or(TpcError::BalanceOverflow)?;
    
    customer.payment_cnt = customer.payment_cnt
        .checked_add(1)
        .ok_or(TpcError::BalanceOverflow)?;
    
    // For bad credit customers, append payment data
    if customer.credit == CreditStatus::BadCredit {
        let payment_info = format!(
            "C_ID={} C_D_ID={} C_W_ID={} D_ID={} W_ID={} H_AMT={}|",
            c_id, c_d_id, c_w_id, d_id, w_id, h_amount
        );
        
        // Prepend to data, truncate to 500 chars
        let new_data = format!("{}{}", payment_info, customer.data);
        customer.data = if new_data.len() > 500 {
            new_data[..500].to_string()
        } else {
            new_data
        };
    }
    
    // ═══════════════════════════════════════════════════════════════════
    // CREATE HISTORY RECORD
    // ═══════════════════════════════════════════════════════════════════
    
    history.c_w_id = c_w_id;
    history.c_d_id = c_d_id;
    history.c_id = c_id;
    history.w_id = w_id;
    history.d_id = d_id;
    history.h_id = h_id;
    history.date = clock.unix_timestamp;
    history.amount = h_amount;
    
    // H_DATA: concatenate warehouse name + district name
    history.data = format!("{}    {}", warehouse.name, district.name);
    history.bump = ctx.bumps.history;
    
    msg!(
        "Payment: C={}-{}-{} paid {} to W={} D={} (by_name={})",
        c_w_id, c_d_id, c_id, h_amount, w_id, d_id, by_last_name
    );
    
    Ok(())
}
