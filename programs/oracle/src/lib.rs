#![allow(deprecated)]

use anchor_lang::prelude::*;

// Core modules
pub mod error;
pub mod events;
pub mod state;

pub use error::OracleError;
pub use events::*;
pub use state::*;

declare_id!("Ad5crRxCcvKFAShAMYtRAD9XKak1cwH1FCE6TrpUA9i2");

#[cfg(feature = "localnet")]
use compute_debug::{compute_checkpoint, compute_fn};

#[cfg(not(feature = "localnet"))]
macro_rules! compute_fn {
    ($name:expr => $block:block) => {
        $block
    };
}
#[cfg(not(feature = "localnet"))]
#[allow(unused_macros)]
macro_rules! compute_checkpoint {
    ($name:expr) => {};
}

#[program]
pub mod oracle {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, api_gateway: Pubkey) -> Result<()> {
        compute_fn!("initialize" => {
            // Single Clock::get() syscall — reused for created_at and quality_score_updated_at
            // to avoid paying for two separate sysvar reads during initialization.
            let now = Clock::get()?.unix_timestamp;
            let mut oracle_data = ctx.accounts.oracle_data.load_init()?;
            oracle_data.authority = ctx.accounts.authority.key();
            oracle_data.api_gateway = api_gateway;
            oracle_data.total_readings = 0;
            oracle_data.last_reading_timestamp = 0;
            oracle_data.last_clearing = 0;
            oracle_data.active = 1;
            oracle_data.created_at = now;

            oracle_data.min_energy_value = 0;
            oracle_data.max_energy_value = 1000000;
            oracle_data.anomaly_detection_enabled = 1;
            oracle_data.max_reading_deviation_percent = 50;
            oracle_data.require_consensus = 0;
            oracle_data.max_production_consumption_ratio = 1000; // Default: 10x (for solar farms)

            oracle_data.total_valid_readings = 0;
            oracle_data.total_rejected_readings = 0;
            oracle_data.average_reading_interval = 300;
            oracle_data.last_quality_score = 100;
            oracle_data.quality_score_updated_at = now;

            oracle_data.backup_oracles_count = 0;
            oracle_data.consensus_threshold = 2;
            oracle_data.last_consensus_timestamp = 0;

            oracle_data.last_energy_produced = 0;
            oracle_data.last_energy_consumed = 0;
            oracle_data.total_global_energy_produced = 0;
            oracle_data.total_global_energy_consumed = 0;
            oracle_data.min_reading_interval = 60;
            oracle_data.last_cleared_epoch = 0;
        });

        Ok(())
    }

    /// Submit meter reading data from AMI (only via API Gateway)
    ///
    /// Sealevel-optimized: oracle_data is read-only (config), writes go to per-meter MeterState PDA.
    /// This allows readings for different meters to execute in parallel on separate CPU cores.
    pub fn submit_meter_reading(
        ctx: Context<SubmitMeterReading>,
        meter_id: String,
        energy_produced: u64,
        energy_consumed: u64,
        reading_timestamp: i64,
    ) -> Result<()> {
        compute_fn!("submit_meter_reading" => {
            // Validate meter_id length
            require!(
                meter_id.len() <= MAX_METER_ID_LEN,
                OracleError::MeterIdTooLong
            );

            // Read-only access to global config — no write lock on oracle_data
            let oracle_data = ctx.accounts.oracle_data.load()?;

            require!(oracle_data.active == 1, OracleError::OracleInactive);

            require!(
                ctx.accounts.authority.key() == oracle_data.api_gateway,
                OracleError::UnauthorizedGateway
            );

            let current_time = Clock::get()?.unix_timestamp;

            // Validate timestamp sanity relative to current time only
            require!(
                reading_timestamp <= current_time + 60,
                OracleError::FutureReading
            );

            // Validation logic (stateless, uses read-only config)
            validate_meter_reading(
                energy_produced,
                energy_consumed,
                &oracle_data,
            ).map_err(|e| {
                emit!(MeterReadingRejected {
                    meter_id: meter_id.clone(),
                    energy_produced,
                    energy_consumed,
                    timestamp: reading_timestamp,
                    reason: format!("{:?}", e),
                });
                e
            })?;

            // Drop the read-only borrow before writing to meter_state
            drop(oracle_data);

            // Write to per-meter PDA — each meter locks its own account
            let meter_state = &mut ctx.accounts.meter_state;

            // Initialize meter_id on first use
            if meter_state.total_readings == 0 {
                let mut id_bytes = [0u8; MAX_METER_ID_LEN];
                let id_src = meter_id.as_bytes();
                id_bytes[..id_src.len()].copy_from_slice(id_src);
                meter_state.meter_id = id_bytes;
                meter_state.meter_id_len = id_src.len() as u8;
                meter_state.bump = ctx.bumps.meter_state;
                meter_state.created_at = current_time;
            }

            meter_state.energy_produced = energy_produced;
            meter_state.energy_consumed = energy_consumed;
            meter_state.total_energy_produced = meter_state.total_energy_produced.saturating_add(energy_produced);
            meter_state.total_energy_consumed = meter_state.total_energy_consumed.saturating_add(energy_consumed);
            meter_state.last_reading_timestamp = reading_timestamp;
            meter_state.total_readings = meter_state.total_readings.saturating_add(1);

            emit!(MeterReadingSubmitted {
                meter_id: meter_id.clone(),
                energy_produced,
                energy_consumed,
                timestamp: reading_timestamp,
                submitter: ctx.accounts.authority.key(),
            });
        });

        Ok(())
    }

    /// Trigger market clearing process (only via API Gateway)
    pub fn trigger_market_clearing(
        ctx: Context<TriggerMarketClearing>,
        epoch_timestamp: i64,
    ) -> Result<()> {
        compute_fn!("trigger_market_clearing" => {
            let mut oracle_data = ctx.accounts.oracle_data.load_mut()?;

            require!(oracle_data.active == 1, OracleError::OracleInactive);

            require!(
                ctx.accounts.authority.key() == oracle_data.api_gateway,
                OracleError::UnauthorizedGateway
            );

            // Ensure we are not clearing a stale or already cleared epoch
            require!(
                epoch_timestamp > oracle_data.last_cleared_epoch,
                OracleError::InvalidEpoch
            );

            let current_time = Clock::get()?.unix_timestamp;
            oracle_data.last_clearing = current_time;
            oracle_data.last_cleared_epoch = epoch_timestamp;

            emit!(MarketClearingTriggered {
                authority: ctx.accounts.authority.key(),
                timestamp: current_time,
                epoch_number: epoch_timestamp,
            });
        });

        Ok(())
    }

    /// Update oracle status (admin only)
    pub fn update_oracle_status(ctx: Context<UpdateOracleStatus>, active: bool) -> Result<()> {
        compute_fn!("update_oracle_status" => {
            let mut oracle_data = ctx.accounts.oracle_data.load_mut()?;

            require!(
                ctx.accounts.authority.key() == oracle_data.authority,
                OracleError::UnauthorizedAuthority
            );

            oracle_data.active = if active { 1 } else { 0 };

            emit!(OracleStatusUpdated {
                authority: ctx.accounts.authority.key(),
                active,
                timestamp: Clock::get()?.unix_timestamp,
            });
        });

        Ok(())
    }

    /// Update API Gateway address (admin only)
    pub fn update_api_gateway(
        ctx: Context<UpdateApiGateway>,
        new_api_gateway: Pubkey,
    ) -> Result<()> {
        compute_fn!("update_api_gateway" => {
            let mut oracle_data = ctx.accounts.oracle_data.load_mut()?;

            require!(
                ctx.accounts.authority.key() == oracle_data.authority,
                OracleError::UnauthorizedAuthority
            );

            let old_gateway = oracle_data.api_gateway;
            oracle_data.api_gateway = new_api_gateway;

            emit!(ApiGatewayUpdated {
                authority: ctx.accounts.authority.key(),
                old_gateway,
                new_gateway: new_api_gateway,
                timestamp: Clock::get()?.unix_timestamp,
            });
        });

        Ok(())
    }

    /// Update production/consumption ratio validation threshold (admin only)
    /// Allows adjustment for different deployment scenarios (residential vs. large solar farms)
    pub fn update_production_ratio_config(
        ctx: Context<UpdateValidationConfig>,
        max_production_consumption_ratio: u16,
    ) -> Result<()> {
        compute_fn!("update_production_ratio_config" => {
            let mut oracle_data = ctx.accounts.oracle_data.load_mut()?;

            require!(
                ctx.accounts.authority.key() == oracle_data.authority,
                OracleError::UnauthorizedAuthority
            );

            require!(
                max_production_consumption_ratio > 0,
                OracleError::InvalidConfiguration
            );

            oracle_data.max_production_consumption_ratio = max_production_consumption_ratio;

            emit!(ProductionRatioConfigUpdated {
                authority: ctx.accounts.authority.key(),
                max_production_consumption_ratio,
                timestamp: Clock::get()?.unix_timestamp,
            });
        });
        Ok(())
    }

    /// Update validation configuration (admin only)
    pub fn update_validation_config(
        ctx: Context<UpdateValidationConfig>,
        min_energy_value: u64,
        max_energy_value: u64,
        anomaly_detection_enabled: bool,
        max_reading_deviation_percent: u16,
        require_consensus: bool,
    ) -> Result<()> {
        compute_fn!("update_validation_config" => {
            let mut oracle_data = ctx.accounts.oracle_data.load_mut()?;

            require!(
                ctx.accounts.authority.key() == oracle_data.authority,
                OracleError::UnauthorizedAuthority
            );

            oracle_data.min_energy_value = min_energy_value;
            oracle_data.max_energy_value = max_energy_value;
            oracle_data.anomaly_detection_enabled = if anomaly_detection_enabled { 1 } else { 0 };
            oracle_data.max_reading_deviation_percent = max_reading_deviation_percent;
            oracle_data.require_consensus = if require_consensus { 1 } else { 0 };

            emit!(ValidationConfigUpdated {
                authority: ctx.accounts.authority.key(),
                timestamp: Clock::get()?.unix_timestamp,
            });
        });

        Ok(())
    }

    /// Add backup oracle (admin only)
    pub fn add_backup_oracle(ctx: Context<AddBackupOracle>, backup_oracle: Pubkey) -> Result<()> {
        compute_fn!("add_backup_oracle" => {
            let mut oracle_data = ctx.accounts.oracle_data.load_mut()?;

            require!(
                ctx.accounts.authority.key() == oracle_data.authority,
                OracleError::UnauthorizedAuthority
            );

            require!(
                oracle_data.backup_oracles_count < 10,
                OracleError::MaxBackupOraclesReached
            );

            for i in 0..oracle_data.backup_oracles_count as usize {
                require!(
                    oracle_data.backup_oracles[i] != backup_oracle,
                    OracleError::BackupOracleAlreadyExists
                );
            }

            let index = oracle_data.backup_oracles_count as usize;
            oracle_data.backup_oracles[index] = backup_oracle;
            oracle_data.backup_oracles_count += 1;

            emit!(BackupOracleAdded {
                authority: ctx.accounts.authority.key(),
                backup_oracle,
                timestamp: Clock::get()?.unix_timestamp,
            });
        });
        Ok(())
    }

    /// Remove backup oracle (admin only)
    pub fn remove_backup_oracle(
        ctx: Context<RemoveBackupOracle>,
        backup_oracle: Pubkey,
    ) -> Result<()> {
        compute_fn!("remove_backup_oracle" => {
            let mut oracle_data = ctx.accounts.oracle_data.load_mut()?;

            require!(
                ctx.accounts.authority.key() == oracle_data.authority,
                OracleError::UnauthorizedAuthority
            );

            let mut found_index: Option<usize> = None;
            for i in 0..oracle_data.backup_oracles_count as usize {
                if oracle_data.backup_oracles[i] == backup_oracle {
                    found_index = Some(i);
                    break;
                }
            }

            require!(found_index.is_some(), OracleError::BackupOracleNotFound);

            let index = found_index.unwrap();

            for i in index..oracle_data.backup_oracles_count as usize - 1 {
                oracle_data.backup_oracles[i] = oracle_data.backup_oracles[i + 1];
            }

            let last_index = oracle_data.backup_oracles_count as usize - 1;
            oracle_data.backup_oracles[last_index] = Pubkey::default();
            oracle_data.backup_oracles_count -= 1;

            emit!(BackupOracleRemoved {
                authority: ctx.accounts.authority.key(),
                backup_oracle,
                timestamp: Clock::get()?.unix_timestamp,
            });
        });
        Ok(())
    }

    /// Aggregate meter readings into global counters (only via API Gateway)
    ///
    /// Called periodically by the Gateway to batch-update global totals,
    /// avoiding per-transaction write locks on oracle_data during submit_meter_reading.
    pub fn aggregate_readings(
        ctx: Context<AggregateReadings>,
        total_produced: u64,
        total_consumed: u64,
        valid_count: u64,
        rejected_count: u64,
    ) -> Result<()> {
        compute_fn!("aggregate_readings" => {
            let mut oracle_data = ctx.accounts.oracle_data.load_mut()?;

            require!(oracle_data.active == 1, OracleError::OracleInactive);

            require!(
                ctx.accounts.authority.key() == oracle_data.api_gateway,
                OracleError::UnauthorizedGateway
            );

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
            let total = oracle_data.total_valid_readings + oracle_data.total_rejected_readings;
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
        });

        Ok(())
    }
}

// Validation functions
fn validate_meter_reading(
    energy_produced: u64,
    energy_consumed: u64,
    oracle_data: &OracleData,
) -> Result<()> {
    // Range validation
    require!(
        energy_produced >= oracle_data.min_energy_value
            && energy_produced <= oracle_data.max_energy_value,
        OracleError::EnergyValueOutOfRange
    );

    require!(
        energy_consumed >= oracle_data.min_energy_value
            && energy_consumed <= oracle_data.max_energy_value,
        OracleError::EnergyValueOutOfRange
    );

    // Basic sanity check - production shouldn't be wildly different from consumption
    if oracle_data.anomaly_detection_enabled == 1 {
        // Use integer cross-multiplication for ratio check to avoid floating point math
        // Instead of (produced / consumed) * 100 <= max_ratio
        // We use produced * 100 <= max_ratio * consumed
        if energy_consumed > 0 {
            require!(
                energy_produced
                    .checked_mul(100)
                    .ok_or(OracleError::InvalidConfiguration)?
                    <= (oracle_data.max_production_consumption_ratio as u64)
                        .checked_mul(energy_consumed)
                        .ok_or(OracleError::InvalidConfiguration)?,
                OracleError::AnomalousReading
            );
        }
    }

    Ok(())
}

/// Helper function to update the oracle's quality score based on reading validity.
/// Reserved for future batch processing optimization when we enable global counter updates.
#[allow(dead_code)]
fn update_quality_score(oracle_data: &mut OracleData, _is_valid: bool) -> Result<()> {
    let total_readings = oracle_data.total_valid_readings + oracle_data.total_rejected_readings;

    if total_readings > 0 {
        // Success rate calculation using integer math (scaled by 100)
        let success_rate = oracle_data
            .total_valid_readings
            .checked_mul(100)
            .ok_or(ProgramError::ArithmeticOverflow)?
            .checked_div(total_readings)
            .ok_or(ProgramError::ArithmeticOverflow)?;

        oracle_data.last_quality_score = success_rate as u8;
        oracle_data.quality_score_updated_at = Clock::get()?.unix_timestamp;
    }

    Ok(())
}

/// Helper function to update the weighted moving average of meter reading intervals.
/// Reserved for future batch processing optimization when we enable global counter updates.
#[allow(dead_code)]
fn update_reading_interval(oracle_data: &mut OracleData, new_interval: u32) -> Result<()> {
    // Weighted Moving Average (WMA) for reading interval stability
    //
    // Formula: WMA = (old_average × 0.8) + (new_interval × 0.2)
    // Purpose: Smooth out fluctuations in meter reading intervals
    // - 80% weight on historical average → prevents oscillation from recent spikes
    // - 20% weight on new reading → responsive to gradual trend changes
    //
    // Example:
    // - If average was 300s and new reading is 600s (double):
    //   WMA = (300 × 0.8) + (600 × 0.2) = 240 + 120 = 360s
    //   (gradual adjustment, not sudden jump to 600s)

    if oracle_data.average_reading_interval > 0 {
        // Integer WMA: (old_average * 4 + new_interval) / 5
        // This is equivalent to (old * 0.8) + (new * 0.2)
        let weighted_sum = (oracle_data.average_reading_interval as u64)
            .checked_mul(4)
            .ok_or(ProgramError::ArithmeticOverflow)?
            .checked_add(new_interval as u64)
            .ok_or(ProgramError::ArithmeticOverflow)?
            .checked_div(5)
            .ok_or(ProgramError::ArithmeticOverflow)?;

        oracle_data.average_reading_interval = weighted_sum as u32;
    } else {
        // Initialize with first reading
        oracle_data.average_reading_interval = new_interval;
    }
    Ok(())
}

// Account structs
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

#[derive(Accounts)]
#[instruction(meter_id: String)]
pub struct SubmitMeterReading<'info> {
    /// Global config — read-only, no write lock for Sealevel parallelism
    #[account(seeds = [b"oracle_data"], bump)]
    pub oracle_data: AccountLoader<'info, OracleData>,

    /// Per-meter PDA — each meter locks its own account
    #[account(
        init_if_needed,
        payer = authority,
        space = MeterState::SPACE,
        seeds = [b"meter", meter_id.as_bytes()],
        bump
    )]
    pub meter_state: Account<'info, MeterState>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AggregateReadings<'info> {
    #[account(mut, seeds = [b"oracle_data"], bump)]
    pub oracle_data: AccountLoader<'info, OracleData>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct TriggerMarketClearing<'info> {
    #[account(mut)]
    pub oracle_data: AccountLoader<'info, OracleData>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateOracleStatus<'info> {
    #[account(mut)]
    pub oracle_data: AccountLoader<'info, OracleData>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateApiGateway<'info> {
    #[account(mut)]
    pub oracle_data: AccountLoader<'info, OracleData>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateValidationConfig<'info> {
    #[account(mut)]
    pub oracle_data: AccountLoader<'info, OracleData>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct AddBackupOracle<'info> {
    #[account(mut)]
    pub oracle_data: AccountLoader<'info, OracleData>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct RemoveBackupOracle<'info> {
    #[account(mut)]
    pub oracle_data: AccountLoader<'info, OracleData>,

    pub authority: Signer<'info>,
}
