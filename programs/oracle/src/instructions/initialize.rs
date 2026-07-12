use anchor_lang::prelude::*;

use crate::state::*;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<OracleData>(),
        seeds = [b"oracle_data"],
        bump
    )]
    pub oracle_data: AccountLoader<'info, OracleData>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn initialize(ctx: Context<Initialize>, chain_bridge: Pubkey) -> Result<()> {
    // Single Clock::get() syscall — reused for created_at and quality_score_updated_at
    // to avoid paying for two separate sysvar reads during initialization.
    let now = Clock::get()?.unix_timestamp;
    let mut oracle_data = ctx.accounts.oracle_data.load_init()?;
    oracle_data.authority = ctx.accounts.authority.key();
    oracle_data.chain_bridge = chain_bridge;
    oracle_data.total_readings = 0;
    oracle_data.last_reading_timestamp = 0;
    oracle_data.last_clearing = 0;
    oracle_data.active = 1;
    oracle_data.created_at = now;

    oracle_data.min_energy_value = 0;
    oracle_data.max_energy_value = 1000000;
    oracle_data.anomaly_detection_enabled = 1;
    oracle_data.max_production_consumption_ratio = 1000; // Default: 10x (for solar farms)

    oracle_data.total_valid_readings = 0;
    oracle_data.total_rejected_readings = 0;
    oracle_data.last_quality_score = 100;
    oracle_data.quality_score_updated_at = now;

    oracle_data.total_global_energy_produced = 0;
    oracle_data.total_global_energy_consumed = 0;
    oracle_data.min_reading_interval = 60;
    oracle_data.last_cleared_epoch = 0;

    Ok(())
}
