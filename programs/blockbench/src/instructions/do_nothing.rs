//! DoNothing Micro-benchmark
//!
//! Measures pure consensus layer overhead by performing no computation
//! or state changes. This establishes the baseline latency floor.

use anchor_lang::prelude::*;
use crate::state::*;

/// DoNothing benchmark - empty instruction
pub fn do_nothing(_ctx: Context<DoNothing>) -> Result<()> {
    // Intentionally empty - measures consensus overhead only
    msg!("DoNothing: executed");
    Ok(())
}

/// DoNothing with nonce to prevent deduplication
pub fn do_nothing_nonce(_ctx: Context<DoNothingNonce>, _nonce: u32) -> Result<()> {
    // Nonce prevents transaction caching/deduplication
    // Use u32 instead of u64 to reduce serialization overhead
    Ok(())
}

#[derive(Accounts)]
pub struct DoNothing<'info> {
    /// The payer for the transaction (required for fee accounting)
    pub payer: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(nonce: u32)]
pub struct DoNothingNonce<'info> {
    /// The payer for the transaction
    pub payer: Signer<'info>,
    
    /// Optional: benchmark state for metric tracking
    #[account(
        mut,
        seeds = [b"blockbench", payer.key().as_ref()],
        bump = benchmark_state.bump,
    )]
    pub benchmark_state: Option<Account<'info, BlockbenchState>>,
}
