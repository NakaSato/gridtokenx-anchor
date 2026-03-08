//! Delivery Transaction (4% of TPC-C Workload)
//! 
//! The Delivery transaction processes a batch of undelivered orders.
//! Per TPC-C spec, it processes the oldest undelivered order for each
//! of the 10 districts in a warehouse.
//! 
//! ## Compute Budget Consideration
//! 
//! Processing 10 districts in a single transaction may exceed Solana's
//! default compute limit (200K CU). Two strategies are provided:
//! 
//! 1. `delivery` - Full batch (requires max compute budget ~1.4M CU)
//! 2. `delivery_district` - Single district (Solana-native approach)
//! 
//! The per-district approach is more "Solana-native" and allows for
//! parallel execution across districts.
//! 
//! ## Transaction Flow
//! 
//! For each district (or single district):
//! 1. Find oldest NewOrder (lowest o_id)
//! 2. Delete NewOrder account (close and reclaim rent)
//! 3. Update Order (set carrier_id, set delivery_d for all lines)
//! 4. Update Customer (increment delivery_cnt, update balance)

use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::TpcError;

// ═══════════════════════════════════════════════════════════════════════════════
// FULL DELIVERY (All 10 Districts)
// ═══════════════════════════════════════════════════════════════════════════════

/// Full Delivery Transaction Context
/// Processes all 10 districts - requires max compute budget
#[derive(Accounts)]
#[instruction(w_id: u64)]
pub struct Delivery<'info> {
    /// Warehouse for reference
    #[account(
        seeds = [b"warehouse", w_id.to_le_bytes().as_ref()],
        bump = warehouse.load()?.bump,
    )]
    pub warehouse: AccountLoader<'info, Warehouse>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
    
    // Remaining accounts: For each district with deliverable orders
    // [new_order_1, order_1, customer_1, new_order_2, order_2, customer_2, ...]
}

/// Execute Full Delivery Transaction
/// 
/// NOTE: This may exceed compute limits for 10 districts.
/// Consider using delivery_district for production.
pub fn delivery<'info>(
    ctx: Context<Delivery<'info>>,
    w_id: u64,
    carrier_id: u64,
) -> Result<()> {
    require!(
        carrier_id >= 1 && carrier_id <= 10,
        TpcError::InvalidCarrierId
    );
    
    let clock = Clock::get()?;
    let delivery_d = clock.unix_timestamp;
    
    // Process remaining accounts in groups of 3: [new_order, order, customer]
    let accounts = &ctx.remaining_accounts;
    let districts_to_process = accounts.len() / 3;
    
    msg!(
        "Delivery: W={} carrier={} processing {} districts",
        w_id, carrier_id, districts_to_process
    );
    
    for i in 0..districts_to_process {
        // Get accounts
        let new_order_account = &ctx.remaining_accounts[i * 3];
        let order_account = &ctx.remaining_accounts[i * 3 + 1];
        let customer_account = &ctx.remaining_accounts[i * 3 + 2];
        
        let mut order_data = order_account.try_borrow_mut_data()?;
        let mut customer_data = customer_account.try_borrow_mut_data()?;
        
        process_district_delivery(
            new_order_account,
            &mut order_data,
            &mut customer_data,
            carrier_id,
            clock.unix_timestamp,
            &ctx.accounts.payer.to_account_info(),
        )?;
    }
    
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════════
// PER-DISTRICT DELIVERY (Solana-Optimized)
// ═══════════════════════════════════════════════════════════════════════════════

/// Per-District Delivery Transaction Context
/// More efficient for Solana - allows parallel execution
#[derive(Accounts)]
#[instruction(w_id: u64, d_id: u64)]
pub struct DeliveryDistrict<'info> {
    /// District for reference
    #[account(
        seeds = [b"district", w_id.to_le_bytes().as_ref(), d_id.to_le_bytes().as_ref()],
        bump = district.load()?.bump,
    )]
    pub district: AccountLoader<'info, District>,
    
    /// NewOrder to be deleted (oldest in district)
    /// Note: In practice, the client must find the oldest o_id
    #[account(
        mut,
        close = payer,
        seeds = [
            b"new_order",
            w_id.to_le_bytes().as_ref(),
            d_id.to_le_bytes().as_ref(),
            new_order.o_id.to_le_bytes().as_ref()
        ],
        bump = new_order.bump,
    )]
    pub new_order: Account<'info, NewOrderEntry>,
    
    /// Order to be updated
    #[account(
        mut,
        seeds = [
            b"order",
            w_id.to_le_bytes().as_ref(),
            d_id.to_le_bytes().as_ref(),
            new_order.o_id.to_le_bytes().as_ref()
        ],
        bump = order.load()?.bump,
    )]
    pub order: AccountLoader<'info, Order>,
    
    /// Customer to be updated
    #[account(
        mut,
        seeds = [
            b"customer",
            w_id.to_le_bytes().as_ref(),
            d_id.to_le_bytes().as_ref(),
            order.load()?.c_id.to_le_bytes().as_ref()
        ],
        bump = customer.load()?.bump,
    )]
    pub customer: AccountLoader<'info, Customer>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

/// Execute Per-District Delivery Transaction
pub fn delivery_district<'info>(
    ctx: Context<DeliveryDistrict<'info>>,
    w_id: u64,
    d_id: u64,
    carrier_id: u64,
) -> Result<()> {
    require!(
        carrier_id >= 1 && carrier_id <= 10,
        TpcError::InvalidCarrierId
    );
    
    let mut order = ctx.accounts.order.load_mut()?;
    let mut customer = ctx.accounts.customer.load_mut()?;
    let clock = Clock::get()?;
    let delivery_d = clock.unix_timestamp;
    
    // Verify order not already delivered
    require!(
        order.carrier_id == 0,
        TpcError::OrderAlreadyDelivered
    );
    
    let o_id = order.o_id;
    
    // ═══════════════════════════════════════════════════════════════════
    // UPDATE ORDER
    // ═══════════════════════════════════════════════════════════════════
    
    order.carrier_id = carrier_id;
    
    // Update delivery date for all order lines
    let mut total_amount: u64 = 0;
    let ol_cnt = order.ol_cnt as usize;
    for i in 0..ol_cnt {
        order.lines[i].delivery_d = delivery_d;
        total_amount += order.lines[i].amount;
    }
    
    // ═══════════════════════════════════════════════════════════════════
    // UPDATE CUSTOMER
    // ═══════════════════════════════════════════════════════════════════
    
    // Increase customer balance by sum of order line amounts
    customer.balance = customer.balance
        .checked_add(total_amount as i64)
        .ok_or(TpcError::BalanceOverflow)?;
    
    customer.delivery_cnt = customer.delivery_cnt
        .checked_add(1)
        .ok_or(TpcError::BalanceOverflow)?;
    
    msg!(
        "Delivery: W={} D={} O={} delivered by carrier={}, amount={}",
        w_id, d_id, o_id, carrier_id, total_amount
    );
    
    // NewOrder account is automatically closed by Anchor (close = payer)
    
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/// Process delivery for a single district (used by full delivery)
fn process_district_delivery(
    new_order_account: &AccountInfo,
    order_data: &mut [u8],
    customer_data: &mut [u8],
    carrier_id: u64,
    delivery_d: i64,
    payer: &AccountInfo,
) -> Result<()> {
    // Access accounts using manual bytemuck for zero_copy
    if order_data.len() < 8 + std::mem::size_of::<Order>() {
        return Err(ErrorCode::AccountDiscriminatorMismatch.into());
    }
    let order = bytemuck::from_bytes_mut::<Order>(&mut order_data[8..8 + std::mem::size_of::<Order>()]);
    
    // Verify not already delivered
    require!(
        order.carrier_id == 0,
        TpcError::OrderAlreadyDelivered
    );
    
    // Update order
    order.carrier_id = carrier_id;
    let mut total_amount: u64 = 0;
    let ol_cnt = order.ol_cnt as usize;
    for i in 0..ol_cnt {
        order.lines[i].delivery_d = delivery_d;
        total_amount += order.lines[i].amount;
    }
    
    // Access customer using manual bytemuck
    if customer_data.len() < 8 + std::mem::size_of::<Customer>() {
        return Err(ErrorCode::AccountDiscriminatorMismatch.into());
    }
    let customer = bytemuck::from_bytes_mut::<Customer>(&mut customer_data[8..8 + std::mem::size_of::<Customer>()]);
    
    customer.balance = customer.balance
        .checked_add(total_amount as i64)
        .ok_or(TpcError::BalanceOverflow)?;
    customer.delivery_cnt = customer.delivery_cnt
        .checked_add(1)
        .ok_or(TpcError::BalanceOverflow)?;
    
    // Close new_order account and reclaim rent (manual closing for batch)
    let lamports = new_order_account.lamports();
    **new_order_account.try_borrow_mut_lamports()? = 0;
    **payer.try_borrow_mut_lamports()? = payer.lamports()
        .checked_add(lamports)
        .ok_or(TpcError::BalanceOverflow)?;
    
    msg!(
        "  District delivery: O={} amount={} carrier={}",
        order.o_id, total_amount, carrier_id
    );
    
    Ok(())
}
