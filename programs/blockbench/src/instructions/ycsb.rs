//! YCSB Key-Value Store Operations
//!
//! Implements the Yahoo! Cloud Serving Benchmark (YCSB) workload
//! adapted for Solana's account model.

use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::BlockbenchError;

/// Initialize YCSB store
pub fn ycsb_init_store(ctx: Context<YcsbInitStore>) -> Result<()> {
    let store = &mut ctx.accounts.ycsb_store;
    
    store.authority = ctx.accounts.authority.key();
    store.record_count = 0;
    store.field_count = 1;
    store.field_size = 100;
    store.initialized = true;
    store.bump = ctx.bumps.ycsb_store;
    
    msg!("YCSB Store initialized");
    
    Ok(())
}

/// YCSB: Insert a new record
pub fn ycsb_insert(
    ctx: Context<YcsbInsert>,
    key: [u8; 32],
    value: Vec<u8>,
) -> Result<()> {
    require!(
        value.len() <= YcsbRecord::MAX_VALUE_SIZE,
        BlockbenchError::ValueTooLarge
    );
    
    let record = &mut ctx.accounts.record;
    let clock = Clock::get()?;
    
    record.key = key;
    record.value = value.clone();
    record.created_at = clock.unix_timestamp;
    record.updated_at = clock.unix_timestamp;
    record.version = 1;
    record.bump = ctx.bumps.record;
    
    // Update store counter
    let store = &mut ctx.accounts.ycsb_store;
    store.record_count += 1;
    
    msg!(
        "YCSB Insert: key={:?}, value_size={}, total_records={}",
        &key[..4],
        value.len(),
        store.record_count
    );
    
    Ok(())
}

/// YCSB: Read a record
pub fn ycsb_read(ctx: Context<YcsbRead>, key: [u8; 32]) -> Result<Vec<u8>> {
    let record = &ctx.accounts.record;
    
    // Verify key matches
    require!(record.key == key, BlockbenchError::YcsbRecordNotFound);
    
    msg!(
        "YCSB Read: key={:?}, value_size={}, version={}",
        &key[..4],
        record.value.len(),
        record.version
    );
    
    Ok(record.value.clone())
}

/// YCSB: Update an existing record
pub fn ycsb_update(
    ctx: Context<YcsbUpdate>,
    key: [u8; 32],
    value: Vec<u8>,
) -> Result<()> {
    require!(
        value.len() <= YcsbRecord::MAX_VALUE_SIZE,
        BlockbenchError::ValueTooLarge
    );
    
    let record = &mut ctx.accounts.record;
    let clock = Clock::get()?;
    
    // Verify key matches
    require!(record.key == key, BlockbenchError::YcsbRecordNotFound);
    
    let old_version = record.version;
    
    record.value = value.clone();
    record.updated_at = clock.unix_timestamp;
    record.version += 1;
    
    msg!(
        "YCSB Update: key={:?}, value_size={}, version={} -> {}",
        &key[..4],
        value.len(),
        old_version,
        record.version
    );
    
    Ok(())
}

/// YCSB: Delete a record
pub fn ycsb_delete(ctx: Context<YcsbDelete>, key: [u8; 32]) -> Result<()> {
    let record = &ctx.accounts.record;
    
    // Verify key matches
    require!(record.key == key, BlockbenchError::YcsbRecordNotFound);
    
    // Update store counter
    let store = &mut ctx.accounts.ycsb_store;
    store.record_count = store.record_count.saturating_sub(1);
    
    msg!(
        "YCSB Delete: key={:?}, remaining_records={}",
        &key[..4],
        store.record_count
    );
    
    // Account will be closed and rent returned to payer
    Ok(())
}

/// YCSB: Batch insert for efficient loading
pub fn ycsb_batch_insert(
    ctx: Context<YcsbBatchInsert>,
    _records: Vec<YcsbRecord>,
) -> Result<()> {
    // Note: In Solana, true batch insert of multiple PDAs in one tx is limited
    // This is a placeholder - actual implementation would use remaining_accounts
    
    let store = &mut ctx.accounts.ycsb_store;
    
    msg!(
        "YCSB Batch Insert: store has {} records",
        store.record_count
    );
    
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACCOUNT CONTEXTS
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Accounts)]
pub struct YcsbInitStore<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(
        init,
        payer = authority,
        space = YcsbStore::LEN,
        seeds = [b"ycsb_store", authority.key().as_ref()],
        bump
    )]
    pub ycsb_store: Account<'info, YcsbStore>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(key: [u8; 32], value: Vec<u8>)]
pub struct YcsbInsert<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"ycsb_store", authority.key().as_ref()],
        bump = ycsb_store.bump,
    )]
    pub ycsb_store: Account<'info, YcsbStore>,
    
    #[account(
        init,
        payer = authority,
        space = YcsbRecord::BASE_LEN + value.len(),
        seeds = [b"ycsb_record", ycsb_store.key().as_ref(), &key],
        bump
    )]
    pub record: Account<'info, YcsbRecord>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(key: [u8; 32])]
pub struct YcsbRead<'info> {
    pub authority: Signer<'info>,
    
    #[account(
        seeds = [b"ycsb_store", authority.key().as_ref()],
        bump = ycsb_store.bump,
    )]
    pub ycsb_store: Account<'info, YcsbStore>,
    
    #[account(
        seeds = [b"ycsb_record", ycsb_store.key().as_ref(), &key],
        bump = record.bump,
    )]
    pub record: Account<'info, YcsbRecord>,
}

#[derive(Accounts)]
#[instruction(key: [u8; 32], value: Vec<u8>)]
pub struct YcsbUpdate<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(
        seeds = [b"ycsb_store", authority.key().as_ref()],
        bump = ycsb_store.bump,
    )]
    pub ycsb_store: Account<'info, YcsbStore>,
    
    #[account(
        mut,
        seeds = [b"ycsb_record", ycsb_store.key().as_ref(), &key],
        bump = record.bump,
        realloc = YcsbRecord::BASE_LEN + value.len(),
        realloc::payer = authority,
        realloc::zero = false,
    )]
    pub record: Account<'info, YcsbRecord>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(key: [u8; 32])]
pub struct YcsbDelete<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"ycsb_store", authority.key().as_ref()],
        bump = ycsb_store.bump,
    )]
    pub ycsb_store: Account<'info, YcsbStore>,
    
    #[account(
        mut,
        close = authority,
        seeds = [b"ycsb_record", ycsb_store.key().as_ref(), &key],
        bump = record.bump,
    )]
    pub record: Account<'info, YcsbRecord>,
}

#[derive(Accounts)]
pub struct YcsbBatchInsert<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"ycsb_store", authority.key().as_ref()],
        bump = ycsb_store.bump,
    )]
    pub ycsb_store: Account<'info, YcsbStore>,
    
    pub system_program: Program<'info, System>,
}
