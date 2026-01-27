//! New-Order Transaction (45% of TPC-C Workload)
//! 
//! This is the most critical transaction in TPC-C as it:
//! 1. Drives the primary benchmark metric (tpmC)
//! 2. Tests the system's handling of write contention
//! 3. Involves the most complex data access patterns
//! 
//! ## Concurrency Analysis
//! 
//! The District.next_o_id field is the CRITICAL SERIALIZATION POINT.
//! All New-Order transactions for the same district must be serialized
//! because they all need to atomically increment this counter.
//! 
//! Parallelism in TPC-C on Solana is achieved ACROSS districts, not within.
//! With 10 districts per warehouse and W warehouses, theoretical max
//! parallel New-Order transactions = 10 × W.
//! 
//! ## Transaction Flow
//! 
//! 1. Read Warehouse (get tax rate) - READ lock
//! 2. Read & Update District (get tax, increment next_o_id) - WRITE lock ⚠️
//! 3. Read Customer (get discount) - READ lock
//! 4. Create Order account with embedded OrderLines
//! 5. Create NewOrder account (undelivered orders queue)
//! 6. For each item (5-15):
//!    a. Read Item (get price) - READ lock
//!    b. Update Stock (decrement quantity) - WRITE lock ⚠️
//! 
//! The Stock accounts for popular items can also become hot spots.

use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::TpcError;

/// New-Order Transaction Context
/// 
/// Uses `remaining_accounts` pattern for variable number of Stock/Item accounts
/// since order can have 5-15 items.
#[derive(Accounts)]
#[instruction(w_id: u64, d_id: u64, c_id: u64, o_id: u64)]
pub struct NewOrder<'info> {
    // ═══════════════════════════════════════════════════════════════════
    // STATIC ACCOUNTS (always present)
    // ═══════════════════════════════════════════════════════════════════
    
    /// Warehouse - read tax rate
    #[account(
        seeds = [b"warehouse", w_id.to_le_bytes().as_ref()],
        bump = warehouse.bump,
    )]
    pub warehouse: Account<'info, Warehouse>,
    
    /// District - CRITICAL: increment next_o_id (WRITE LOCK)
    /// This is the primary serialization point for the district
    #[account(
        mut,
        seeds = [b"district", w_id.to_le_bytes().as_ref(), d_id.to_le_bytes().as_ref()],
        bump = district.bump,
    )]
    pub district: Account<'info, District>,
    
    /// Customer - read discount rate
    #[account(
        seeds = [
            b"customer",
            w_id.to_le_bytes().as_ref(),
            d_id.to_le_bytes().as_ref(),
            c_id.to_le_bytes().as_ref()
        ],
        bump = customer.bump,
    )]
    pub customer: Account<'info, Customer>,
    
    /// Order - to be created (PDA with next_o_id)
    /// Space allocated for max 15 order lines
    #[account(
        init,
        payer = payer,
        space = Order::SPACE,
        seeds = [
            b"order",
            w_id.to_le_bytes().as_ref(),
            d_id.to_le_bytes().as_ref(),
            o_id.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub order: Account<'info, Order>,
    
    /// NewOrder - to be created (queue entry for undelivered orders)
    #[account(
        init,
        payer = payer,
        space = NewOrderEntry::SPACE,
        seeds = [
            b"new_order",
            w_id.to_le_bytes().as_ref(),
            d_id.to_le_bytes().as_ref(),
            o_id.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub new_order: Account<'info, NewOrderEntry>,
    
    /// Payer for account creation (rent)
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
    
    // ═══════════════════════════════════════════════════════════════════
    // DYNAMIC ACCOUNTS (via remaining_accounts)
    // ═══════════════════════════════════════════════════════════════════
    // 
    // For each order line, the following accounts must be passed:
    //   - Item (READ) - seeds: ["item", i_id]
    //   - Stock (WRITE) - seeds: ["stock", supply_w_id, i_id]
    //
    // Order in remaining_accounts:
    //   [item_1, stock_1, item_2, stock_2, ..., item_n, stock_n]
    //
    // Example for 5-item order: 10 accounts in remaining_accounts
}

/// Execute New-Order Transaction
/// 
/// # Arguments
/// * `ctx` - Transaction context with accounts
/// * `w_id` - Warehouse ID
/// * `d_id` - District ID  
/// * `c_id` - Customer ID
/// * `order_lines` - Vector of order line inputs (5-15 items)
/// 
/// # Remaining Accounts Layout
/// For each order line i: [Item_i, Stock_i]
pub fn new_order<'info>(
    ctx: Context<'_, '_, 'info, 'info, NewOrder<'info>>,
    w_id: u64,
    d_id: u64,
    c_id: u64,
    o_id: u64,
    order_lines: Vec<OrderLineInput>,
) -> Result<()> {
    // ═══════════════════════════════════════════════════════════════════
    // VALIDATION
    // ═══════════════════════════════════════════════════════════════════
    
    // TPC-C spec: 5-15 items per order
    let ol_cnt = order_lines.len();
    require!(
        ol_cnt >= 5 && ol_cnt <= 15,
        TpcError::InvalidOrderLineCount
    );
    
    // Verify we have enough remaining accounts (2 per order line)
    require!(
        ctx.remaining_accounts.len() == ol_cnt * 2,
        TpcError::InvalidOrderLineCount
    );
    
    // Validate quantities
    for ol in &order_lines {
        require!(ol.quantity >= 1 && ol.quantity <= 10, TpcError::InvalidQuantity);
    }
    
    // ═══════════════════════════════════════════════════════════════════
    // READ PHASE
    // ═══════════════════════════════════════════════════════════════════
    
    let warehouse = &ctx.accounts.warehouse;
    let district = &mut ctx.accounts.district;
    let customer = &ctx.accounts.customer;
    let clock = Clock::get()?;
    
    // Get tax rates and discount
    let w_tax = warehouse.tax;
    let d_tax = district.tax;
    let c_discount = customer.discount;
    
    // ═══════════════════════════════════════════════════════════════════
    // CRITICAL SECTION: Assign Order ID
    // ═══════════════════════════════════════════════════════════════════
    
    // We used to use district.next_o_id, but now we use client-provided o_id
    // for PDA seeds. We still increment district.next_o_id for legacy state
    // tracking, but the collision is resolved by unique o_ids.
    
    // Increment next_o_id - THIS IS THE SERIALIZATION POINT
    district.next_o_id = district.next_o_id
        .checked_add(1)
        .ok_or(TpcError::OrderIdOverflow)?;
    
    msg!(
        "New-Order: W={} D={} C={} O={} items={}",
        w_id, d_id, c_id, o_id, ol_cnt
    );
    
    // ═══════════════════════════════════════════════════════════════════
    // PROCESS ORDER LINES
    // ═══════════════════════════════════════════════════════════════════
    
    let mut total_amount: u64 = 0;
    let mut all_local = true;
    let mut processed_lines: Vec<OrderLine> = Vec::with_capacity(ol_cnt);
    
    for (i, ol_input) in order_lines.iter().enumerate() {
        // Get Item and Stock accounts from remaining_accounts
        let item_idx = i * 2;
        let stock_idx = i * 2 + 1;
        
        let item_account = &ctx.remaining_accounts[item_idx];
        let stock_account = &ctx.remaining_accounts[stock_idx];
        
        // Deserialize Item (read-only)
        let item_data = item_account.try_borrow_data()?;
        let item: Item = Item::try_deserialize(&mut &item_data[..])?;
        
        // Verify item ID matches
        require!(item.i_id == ol_input.i_id, TpcError::ItemNotFound);
        
        // Deserialize and update Stock (mutable)
        let mut stock_data = stock_account.try_borrow_mut_data()?;
        let mut stock: Stock = Stock::try_deserialize(&mut &stock_data[..])?;
        
        // Verify stock matches
        require!(
            stock.w_id == ol_input.supply_w_id && stock.i_id == ol_input.i_id,
            TpcError::ItemNotFound
        );
        
        // Check and update stock quantity
        let quantity = ol_input.quantity as u64;
        if stock.quantity >= quantity + 10 {
            stock.quantity -= quantity;
        } else {
            stock.quantity = stock.quantity + 91 - quantity; // Restock
        }
        
        // Update stock statistics
        stock.ytd += quantity;
        stock.order_cnt += 1;
        if ol_input.supply_w_id != w_id {
            stock.remote_cnt += 1;
            all_local = false;
        }
        
        // Calculate line amount
        let line_amount = item.price * quantity;
        total_amount += line_amount;
        
        // Get district info for this line
        let dist_info = match d_id {
            1 => stock.dist_01.clone(),
            2 => stock.dist_02.clone(),
            3 => stock.dist_03.clone(),
            4 => stock.dist_04.clone(),
            5 => stock.dist_05.clone(),
            6 => stock.dist_06.clone(),
            7 => stock.dist_07.clone(),
            8 => stock.dist_08.clone(),
            9 => stock.dist_09.clone(),
            10 => stock.dist_10.clone(),
            _ => String::new(),
        };
        
        // Create order line
        let order_line = OrderLine {
            number: (i + 1) as u8,
            i_id: ol_input.i_id,
            supply_w_id: ol_input.supply_w_id,
            delivery_d: None,
            quantity: ol_input.quantity,
            amount: line_amount,
            dist_info,
        };
        processed_lines.push(order_line);
        
        // Serialize stock back
        let serialized_stock = stock.try_to_vec()?;
        stock_data[8..8 + serialized_stock.len()].copy_from_slice(&serialized_stock);
    }
    
    // ═══════════════════════════════════════════════════════════════════
    // APPLY TAXES AND DISCOUNT
    // ═══════════════════════════════════════════════════════════════════
    
    // Apply warehouse and district taxes (basis points)
    // total = total * (1 + w_tax/10000) * (1 + d_tax/10000) * (1 - c_discount/10000)
    let taxed_amount = total_amount
        .saturating_mul(10000 + w_tax)
        .saturating_div(10000)
        .saturating_mul(10000 + d_tax)
        .saturating_div(10000)
        .saturating_mul(10000 - c_discount)
        .saturating_div(10000);
    
    // ═══════════════════════════════════════════════════════════════════
    // CREATE ORDER
    // ═══════════════════════════════════════════════════════════════════
    
    let order = &mut ctx.accounts.order;
    order.w_id = w_id;
    order.d_id = d_id;
    order.o_id = o_id;
    order.c_id = c_id;
    order.entry_d = clock.unix_timestamp;
    order.carrier_id = None;
    order.ol_cnt = ol_cnt as u8;
    order.all_local = all_local;
    order.lines = processed_lines;
    order.bump = ctx.bumps.order;
    
    // ═══════════════════════════════════════════════════════════════════
    // CREATE NEW-ORDER (Undelivered queue entry)
    // ═══════════════════════════════════════════════════════════════════
    
    let new_order = &mut ctx.accounts.new_order;
    new_order.w_id = w_id;
    new_order.d_id = d_id;
    new_order.o_id = o_id;
    new_order.created_at = clock.unix_timestamp;
    new_order.bump = ctx.bumps.new_order;
    
    msg!(
        "Order {} created: {} items, total = {} (after tax/discount = {})",
        o_id, ol_cnt, total_amount, taxed_amount
    );
    
    Ok(())
}
