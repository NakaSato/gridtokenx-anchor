//! IOHeavy Micro-benchmark
//!
//! Measures data model layer performance through storage-intensive operations.
//! Tests account read/write throughput and caching efficiency.

use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::BlockbenchError;

/// Maximum number of IO operations per transaction
pub const MAX_IO_OPS: u8 = 20;

/// IOHeavy: Sequential writes benchmark
pub fn io_heavy_write(
    ctx: Context<IoHeavyWrite>,
    key_prefix: [u8; 16],
    value_size: u16,
    num_writes: u8,
) -> Result<()> {
    require!(num_writes <= MAX_IO_OPS, BlockbenchError::TooManyIoOperations);
    require!(value_size as usize <= IoHeavyAccount::MAX_DATA_SIZE, BlockbenchError::ValueTooLarge);
    
    let io_account = &mut ctx.accounts.io_account;
    let clock = Clock::get()?;
    
    // Initialize if new
    if io_account.write_count == 0 {
        io_account.key = key_prefix;
        io_account.bump = ctx.bumps.io_account;
    }
    
    // Generate data to write
    let mut data = vec![0u8; value_size as usize];
    for (i, byte) in data.iter_mut().enumerate() {
        byte.clone_from(&(((i + io_account.write_count as usize) % 256) as u8));
    }
    
    // Perform writes (simulated by updating the same account multiple times)
    for _ in 0..num_writes {
        io_account.data = data.clone();
        io_account.write_count += 1;
        io_account.last_write = clock.unix_timestamp;
        
        // Modify data slightly for each "write"
        if !data.is_empty() {
            data[0] = data[0].wrapping_add(1);
        }
    }
    
    msg!(
        "IOHeavy Write: key_prefix={:?}, writes={}, total_writes={}", 
        &key_prefix[..4], 
        num_writes,
        io_account.write_count
    );
    
    Ok(())
}

/// IOHeavy: Random reads benchmark
pub fn io_heavy_read<'info>(
    ctx: Context<'_, '_, 'info, 'info, IoHeavyRead<'info>>,
    num_reads: u8,
) -> Result<u64> {
    require!(num_reads <= MAX_IO_OPS, BlockbenchError::TooManyIoOperations);
    
    let remaining = ctx.remaining_accounts;
    require!(
        remaining.len() >= num_reads as usize,
        BlockbenchError::InsufficientAccounts
    );
    
    let mut checksum: u64 = 0;
    let mut total_bytes_read: u64 = 0;
    
    // Read from provided accounts
    for i in 0..(num_reads as usize) {
        let account = &remaining[i];
        
        // Try to deserialize as IoHeavyAccount
        if let Ok(io_account) = Account::<IoHeavyAccount>::try_from(account) {
            total_bytes_read += io_account.data.len() as u64;
            
            // Compute checksum from data
            for byte in &io_account.data {
                checksum = checksum.wrapping_add(*byte as u64);
            }
        }
    }
    
    msg!(
        "IOHeavy Read: accounts={}, bytes_read={}, checksum={}",
        num_reads,
        total_bytes_read,
        checksum
    );
    
    Ok(checksum)
}

/// IOHeavy: Mixed read-write benchmark
pub fn io_heavy_mixed<'info>(
    ctx: Context<'_, '_, 'info, 'info, IoHeavyMixed<'info>>,
    read_ratio: u8, // Percentage of reads (0-100)
    total_ops: u8,
) -> Result<()> {
    require!(total_ops <= MAX_IO_OPS, BlockbenchError::TooManyIoOperations);
    require!(read_ratio <= 100, BlockbenchError::InvalidConfig);
    
    let clock = Clock::get()?;
    let remaining = ctx.remaining_accounts;
    let io_account = &mut ctx.accounts.io_account;
    
    let mut reads = 0u32;
    let mut writes = 0u32;
    let mut checksum: u64 = 0;
    
    for i in 0..total_ops {
        let is_read = ((i as u16 * 100) / (total_ops as u16)) < (read_ratio as u16);
        
        if is_read {
            // Perform read from remaining accounts
            if let Some(account) = remaining.get(reads as usize % remaining.len().max(1)) {
                if let Ok(acc) = Account::<IoHeavyAccount>::try_from(account) {
                    for byte in &acc.data {
                        checksum = checksum.wrapping_add(*byte as u64);
                    }
                }
            }
            reads += 1;
        } else {
            // Perform write
            let write_val = (writes % 256) as u8;
            if !io_account.data.is_empty() {
                io_account.data[0] = write_val;
            }
            io_account.write_count += 1;
            io_account.last_write = clock.unix_timestamp;
            writes += 1;
        }
    }
    
    msg!(
        "IOHeavy Mixed: reads={}, writes={}, checksum={}",
        reads,
        writes,
        checksum
    );
    
    Ok(())
}

#[derive(Accounts)]
#[instruction(key_prefix: [u8; 16], value_size: u16, num_writes: u8)]
pub struct IoHeavyWrite<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    
    #[account(
        init_if_needed,
        payer = payer,
        space = IoHeavyAccount::MAX_LEN,
        seeds = [b"io_heavy", payer.key().as_ref(), &key_prefix],
        bump
    )]
    pub io_account: Account<'info, IoHeavyAccount>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct IoHeavyRead<'info> {
    pub payer: Signer<'info>,
    // Remaining accounts are the accounts to read from
}

#[derive(Accounts)]
#[instruction(read_ratio: u8, total_ops: u8)]
pub struct IoHeavyMixed<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"io_heavy", payer.key().as_ref(), &io_account.key],
        bump = io_account.bump
    )]
    pub io_account: Account<'info, IoHeavyAccount>,
    // Remaining accounts for reading
}
