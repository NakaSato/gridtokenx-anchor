//! Benchmark Initialization Instructions

use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::BlockbenchError;

/// Initialize the BLOCKBENCH suite
pub fn initialize_benchmark(
    ctx: Context<InitializeBenchmark>,
    config: BlockbenchConfig,
) -> Result<()> {
    let state = &mut ctx.accounts.benchmark_state;
    
    state.authority = ctx.accounts.authority.key();
    state.config = config;
    state.metrics = BlockbenchMetrics::default();
    state.is_running = false;
    state.start_time = 0;
    state.end_time = 0;
    state.run_id = 0;
    state.bump = ctx.bumps.benchmark_state;
    
    // Initialize min values to max
    state.metrics.min_latency_us = u64::MAX;
    state.metrics.min_compute_units = u64::MAX;
    
    msg!("BLOCKBENCH initialized with workload: {:?}", state.config.workload_type);
    
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeBenchmark<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(
        init,
        payer = authority,
        space = BlockbenchState::LEN,
        seeds = [b"blockbench", authority.key().as_ref()],
        bump
    )]
    pub benchmark_state: Account<'info, BlockbenchState>,
    
    pub system_program: Program<'info, System>,
}
