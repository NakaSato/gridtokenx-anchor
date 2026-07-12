use anchor_lang::prelude::*;

use crate::error::OracleError;
use crate::events::*;
use crate::require_oracle_admin;
use crate::state::*;

/// Shared admin-config context — used by both `update_validation_config` and
/// `update_production_ratio_config` (tight group: one context, two tuning handlers).
#[derive(Accounts)]
pub struct UpdateValidationConfig<'info> {
    #[account(mut, seeds = [b"oracle_data"], bump)]
    pub oracle_data: AccountLoader<'info, OracleData>,

    pub authority: Signer<'info>,
}

pub fn update_validation_config(
    ctx: Context<UpdateValidationConfig>,
    min_energy_value: u64,
    max_energy_value: u64,
    anomaly_detection_enabled: bool,
) -> Result<()> {
    let mut oracle_data = ctx.accounts.oracle_data.load_mut()?;
    require_oracle_admin(&oracle_data, ctx.accounts.authority.key())?;

    // Reject inverted bounds — min > max would silently reject every reading.
    require!(
        min_energy_value <= max_energy_value,
        OracleError::InvalidConfiguration
    );

    oracle_data.min_energy_value = min_energy_value;
    oracle_data.max_energy_value = max_energy_value;
    oracle_data.anomaly_detection_enabled = if anomaly_detection_enabled { 1 } else { 0 };

    // Hoist Clock::get() before emit! (invariant #5).
    let now = Clock::get()?.unix_timestamp;
    emit!(ValidationConfigUpdated {
        authority: ctx.accounts.authority.key(),
        timestamp: now,
    });

    Ok(())
}

pub fn update_production_ratio_config(
    ctx: Context<UpdateValidationConfig>,
    max_production_consumption_ratio: u16,
) -> Result<()> {
    let mut oracle_data = ctx.accounts.oracle_data.load_mut()?;
    require_oracle_admin(&oracle_data, ctx.accounts.authority.key())?;

    require!(
        max_production_consumption_ratio > 0,
        OracleError::InvalidConfiguration
    );

    oracle_data.max_production_consumption_ratio = max_production_consumption_ratio;

    // Hoist Clock::get() before emit! (invariant #5).
    let now = Clock::get()?.unix_timestamp;
    emit!(ProductionRatioConfigUpdated {
        authority: ctx.accounts.authority.key(),
        max_production_consumption_ratio,
        timestamp: now,
    });

    Ok(())
}
