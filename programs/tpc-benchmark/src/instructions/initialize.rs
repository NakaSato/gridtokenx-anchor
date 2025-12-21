//! Initialization Instructions for TPC-C Entities
//! 
//! These instructions populate the TPC-C schema accounts during the
//! load phase of the benchmark.

use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::TpcError;

// ═══════════════════════════════════════════════════════════════════════════════
// BENCHMARK INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Accounts)]
pub struct InitializeBenchmark<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<BenchmarkState>() + 256,
        seeds = [b"benchmark"],
        bump
    )]
    pub benchmark: Account<'info, BenchmarkState>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn initialize_benchmark(
    ctx: Context<InitializeBenchmark>,
    config: BenchmarkConfig,
) -> Result<()> {
    let benchmark = &mut ctx.accounts.benchmark;
    
    benchmark.authority = ctx.accounts.authority.key();
    benchmark.config = config;
    benchmark.stats = BenchmarkStats::default();
    benchmark.is_running = false;
    benchmark.start_time = 0;
    benchmark.end_time = 0;
    benchmark.bump = ctx.bumps.benchmark;
    
    msg!("TPC-C Benchmark initialized with {} warehouses", benchmark.config.warehouses);
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════════
// WAREHOUSE INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Accounts)]
#[instruction(w_id: u64)]
pub struct InitializeWarehouse<'info> {
    #[account(
        init,
        payer = authority,
        space = Warehouse::SPACE,
        seeds = [b"warehouse", w_id.to_le_bytes().as_ref()],
        bump
    )]
    pub warehouse: Account<'info, Warehouse>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
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
    require!(w_id > 0, TpcError::InvalidWarehouseId);
    require!(tax <= 2000, TpcError::InvalidTaxRate);
    require!(name.len() <= 10, TpcError::StringTooLong);
    require!(street_1.len() <= 20, TpcError::StringTooLong);
    require!(street_2.len() <= 20, TpcError::StringTooLong);
    require!(city.len() <= 20, TpcError::StringTooLong);
    require!(state.len() <= 2, TpcError::StringTooLong);
    require!(zip.len() <= 9, TpcError::StringTooLong);
    
    let warehouse = &mut ctx.accounts.warehouse;
    
    warehouse.w_id = w_id;
    warehouse.name = name;
    warehouse.street_1 = street_1;
    warehouse.street_2 = street_2;
    warehouse.city = city;
    warehouse.state = state;
    warehouse.zip = zip;
    warehouse.tax = tax;
    warehouse.ytd = 300_000_00; // $300,000.00 initial YTD (in cents)
    warehouse.bump = ctx.bumps.warehouse;
    
    msg!("Warehouse {} initialized", w_id);
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════════
// DISTRICT INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Accounts)]
#[instruction(w_id: u64, d_id: u64)]
pub struct InitializeDistrict<'info> {
    #[account(
        init,
        payer = authority,
        space = District::SPACE,
        seeds = [b"district", w_id.to_le_bytes().as_ref(), d_id.to_le_bytes().as_ref()],
        bump
    )]
    pub district: Account<'info, District>,
    
    /// Verify warehouse exists
    #[account(
        seeds = [b"warehouse", w_id.to_le_bytes().as_ref()],
        bump = warehouse.bump
    )]
    pub warehouse: Account<'info, Warehouse>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
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
    require!(d_id >= 1 && d_id <= 10, TpcError::InvalidDistrictId);
    require!(tax <= 2000, TpcError::InvalidTaxRate);
    
    let district = &mut ctx.accounts.district;
    
    district.w_id = w_id;
    district.d_id = d_id;
    district.name = name;
    district.street_1 = street_1;
    district.street_2 = street_2;
    district.city = city;
    district.state = state;
    district.zip = zip;
    district.tax = tax;
    district.ytd = 30_000_00; // $30,000.00 initial YTD (in cents)
    district.next_o_id = 3001; // Starting order ID (3000 initial orders per TPC-C)
    district.bump = ctx.bumps.district;
    
    msg!("District {}-{} initialized, next_o_id = {}", w_id, d_id, district.next_o_id);
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════════
// CUSTOMER INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Accounts)]
#[instruction(w_id: u64, d_id: u64, c_id: u64)]
pub struct InitializeCustomer<'info> {
    #[account(
        init,
        payer = authority,
        space = Customer::SPACE,
        seeds = [
            b"customer",
            w_id.to_le_bytes().as_ref(),
            d_id.to_le_bytes().as_ref(),
            c_id.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub customer: Account<'info, Customer>,
    
    /// Verify district exists
    #[account(
        seeds = [b"district", w_id.to_le_bytes().as_ref(), d_id.to_le_bytes().as_ref()],
        bump = district.bump
    )]
    pub district: Account<'info, District>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
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
    require!(c_id >= 1 && c_id <= 3000, TpcError::InvalidCustomerId);
    require!(discount <= 5000, TpcError::InvalidDiscount);
    
    let customer = &mut ctx.accounts.customer;
    let clock = Clock::get()?;
    
    customer.w_id = w_id;
    customer.d_id = d_id;
    customer.c_id = c_id;
    customer.first = first;
    customer.middle = middle;
    customer.last = last;
    customer.street_1 = street_1;
    customer.street_2 = street_2;
    customer.city = city;
    customer.state = state;
    customer.zip = zip;
    customer.phone = phone;
    customer.since = clock.unix_timestamp;
    customer.credit = credit;
    customer.credit_lim = credit_lim;
    customer.discount = discount;
    customer.balance = -10_00; // Initial balance: -$10.00 (in cents)
    customer.ytd_payment = 10_00; // Initial YTD payment: $10.00
    customer.payment_cnt = 1;
    customer.delivery_cnt = 0;
    customer.data = String::new();
    customer.bump = ctx.bumps.customer;
    
    msg!("Customer {}-{}-{} initialized", w_id, d_id, c_id);
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════════
// ITEM INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Accounts)]
#[instruction(i_id: u64)]
pub struct InitializeItem<'info> {
    #[account(
        init,
        payer = authority,
        space = Item::SPACE,
        seeds = [b"item", i_id.to_le_bytes().as_ref()],
        bump
    )]
    pub item: Account<'info, Item>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn initialize_item(
    ctx: Context<InitializeItem>,
    i_id: u64,
    im_id: u64,
    name: String,
    price: u64,
    data: String,
) -> Result<()> {
    require!(i_id >= 1 && i_id <= 100_000, TpcError::InvalidItemId);
    require!(name.len() <= 24, TpcError::StringTooLong);
    require!(data.len() <= 50, TpcError::StringTooLong);
    
    let item = &mut ctx.accounts.item;
    
    item.i_id = i_id;
    item.im_id = im_id;
    item.name = name;
    item.price = price;
    item.data = data;
    item.bump = ctx.bumps.item;
    
    msg!("Item {} initialized: price = {}", i_id, price);
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════════
// STOCK INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Accounts)]
#[instruction(w_id: u64, i_id: u64)]
pub struct InitializeStock<'info> {
    #[account(
        init,
        payer = authority,
        space = Stock::SPACE,
        seeds = [b"stock", w_id.to_le_bytes().as_ref(), i_id.to_le_bytes().as_ref()],
        bump
    )]
    pub stock: Account<'info, Stock>,
    
    /// Verify warehouse exists
    #[account(
        seeds = [b"warehouse", w_id.to_le_bytes().as_ref()],
        bump = warehouse.bump
    )]
    pub warehouse: Account<'info, Warehouse>,
    
    /// Verify item exists
    #[account(
        seeds = [b"item", i_id.to_le_bytes().as_ref()],
        bump = item.bump
    )]
    pub item: Account<'info, Item>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
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
    let stock = &mut ctx.accounts.stock;
    
    stock.w_id = w_id;
    stock.i_id = i_id;
    stock.quantity = quantity;
    stock.dist_01 = dist_01;
    stock.dist_02 = dist_02;
    stock.dist_03 = dist_03;
    stock.dist_04 = dist_04;
    stock.dist_05 = dist_05;
    stock.dist_06 = dist_06;
    stock.dist_07 = dist_07;
    stock.dist_08 = dist_08;
    stock.dist_09 = dist_09;
    stock.dist_10 = dist_10;
    stock.ytd = 0;
    stock.order_cnt = 0;
    stock.remote_cnt = 0;
    stock.data = data;
    stock.bump = ctx.bumps.stock;
    
    msg!("Stock for item {} at warehouse {} initialized: qty = {}", i_id, w_id, quantity);
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════════
// CUSTOMER INDEX INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Accounts)]
#[instruction(w_id: u64, d_id: u64, last_name_hash: [u8; 32])]
pub struct InitializeCustomerIndex<'info> {
    #[account(
        init,
        payer = authority,
        space = CustomerLastNameIndex::SPACE,
        seeds = [
            b"idx_c_last",
            w_id.to_le_bytes().as_ref(),
            d_id.to_le_bytes().as_ref(),
            last_name_hash.as_ref()
        ],
        bump
    )]
    pub index: Account<'info, CustomerLastNameIndex>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn initialize_customer_index(
    ctx: Context<InitializeCustomerIndex>,
    w_id: u64,
    d_id: u64,
    last_name_hash: [u8; 32],
) -> Result<()> {
    let index = &mut ctx.accounts.index;
    
    index.w_id = w_id;
    index.d_id = d_id;
    index.last_name_hash = last_name_hash;
    index.customer_ids = Vec::new();
    index.bump = ctx.bumps.index;
    
    msg!("Customer index initialized for district {}-{}", w_id, d_id);
    Ok(())
}
