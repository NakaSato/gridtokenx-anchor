use anchor_lang::prelude::*;

use crate::authorize_node_caller;
use crate::error::OracleError;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
pub struct TriggerMarketClearing<'info> {
    #[account(mut, seeds = [b"oracle_data"], bump)]
    pub oracle_data: AccountLoader<'info, OracleData>,

    pub authority: Signer<'info>,

    /// CHECK: optional governance `AggregatorEntry` PDA, validated in-handler when the
    /// caller is an admitted aggregator rather than the chain bridge.
    pub aggregator_entry: Option<UncheckedAccount<'info>>,
}

pub fn trigger_market_clearing(
    ctx: Context<TriggerMarketClearing>,
    epoch_timestamp: i64,
) -> Result<()> {
    let mut oracle_data = ctx.accounts.oracle_data.load_mut()?;

    require!(oracle_data.active == 1, OracleError::OracleInactive);

    authorize_node_caller(
        ctx.accounts.authority.key(),
        oracle_data.chain_bridge,
        ctx.accounts.aggregator_entry.as_ref().map(|a| a.as_ref()),
    )?;

    let current_time = Clock::get()?.unix_timestamp;

    // Ensure we are not clearing a stale or already cleared epoch
    require!(
        epoch_timestamp > oracle_data.last_cleared_epoch,
        OracleError::InvalidEpoch
    );
    require!(
        epoch_timestamp <= current_time,
        OracleError::InvalidEpoch
    );
    // Epochs are 15-minute market-clearing windows; reject timestamps that
    // don't fall on a 900-second boundary so "epoch" can't be arbitrary.
    require!(
        epoch_timestamp % 900 == 0,
        OracleError::InvalidEpoch
    );

    oracle_data.last_clearing = current_time;
    oracle_data.last_cleared_epoch = epoch_timestamp;

    emit!(MarketClearingTriggered {
        authority: ctx.accounts.authority.key(),
        timestamp: current_time,
        epoch_number: epoch_timestamp,
    });

    Ok(())
}
