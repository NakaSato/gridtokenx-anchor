use anchor_lang::prelude::*;

use crate::authorize_node_caller;
use crate::error::OracleError;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
pub struct AggregateReadings<'info> {
    #[account(mut, seeds = [b"oracle_data"], bump)]
    pub oracle_data: AccountLoader<'info, OracleData>,

    pub authority: Signer<'info>,

    /// CHECK: optional governance `AggregatorEntry` PDA, validated in-handler when the
    /// caller is an admitted aggregator rather than the chain bridge.
    pub aggregator_entry: Option<UncheckedAccount<'info>>,
}

pub fn aggregate_readings(
    ctx: Context<AggregateReadings>,
    total_produced: u64,
    total_consumed: u64,
    valid_count: u64,
    rejected_count: u64,
) -> Result<()> {
    let mut oracle_data = ctx.accounts.oracle_data.load_mut()?;

    require!(oracle_data.active == 1, OracleError::OracleInactive);

    authorize_node_caller(
        ctx.accounts.authority.key(),
        oracle_data.chain_bridge,
        ctx.accounts.aggregator_entry.as_ref().map(|a| a.as_ref()),
    )?;

    // Single Clock::get() syscall — reused for last_reading_timestamp,
    // quality_score_updated_at, and the emitted event timestamp.
    let current_time = Clock::get()?.unix_timestamp;

    oracle_data.total_global_energy_produced = oracle_data.total_global_energy_produced.saturating_add(total_produced);
    oracle_data.total_global_energy_consumed = oracle_data.total_global_energy_consumed.saturating_add(total_consumed);
    oracle_data.total_valid_readings = oracle_data.total_valid_readings.saturating_add(valid_count);
    oracle_data.total_rejected_readings = oracle_data.total_rejected_readings.saturating_add(rejected_count);
    oracle_data.total_readings = oracle_data.total_readings.saturating_add(valid_count).saturating_add(rejected_count);
    oracle_data.last_reading_timestamp = current_time;

    // Update quality score inline
    let total = oracle_data.total_valid_readings.saturating_add(oracle_data.total_rejected_readings);
    if total > 0 {
        let success_rate = oracle_data.total_valid_readings
            .saturating_mul(100)
            .checked_div(total)
            .unwrap_or(0);
        oracle_data.last_quality_score = success_rate.min(100) as u8;
        oracle_data.quality_score_updated_at = current_time;
    }

    emit!(ReadingsAggregated {
        authority: ctx.accounts.authority.key(),
        total_produced,
        total_consumed,
        valid_count,
        rejected_count,
        timestamp: current_time,
    });

    Ok(())
}
