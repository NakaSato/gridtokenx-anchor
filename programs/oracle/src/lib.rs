#![allow(deprecated)]

use anchor_lang::prelude::*;

declare_id!("4Agkm8isGD6xDegsfoFzWN5Xp5WLVoqJyPDQLRsjh85u");

#[cfg(feature = "localnet")]
use compute_debug::{compute_fn, compute_checkpoint};

#[cfg(not(feature = "localnet"))]
macro_rules! compute_fn {
    ($name:expr => $block:block) => { $block };
}
#[cfg(not(feature = "localnet"))]
macro_rules! compute_checkpoint {
    ($name:expr) => {};
}

#[program]
pub mod oracle {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, api_gateway: Pubkey) -> Result<()> {
        compute_fn!("initialize" => {
            let mut oracle_data = ctx.accounts.oracle_data.load_init()?;
            oracle_data.authority = ctx.accounts.authority.key();
            oracle_data.api_gateway = api_gateway;
            oracle_data.total_readings = 0;
            oracle_data.last_reading_timestamp = 0;
            oracle_data.last_clearing = 0;
            oracle_data.active = 1;
            oracle_data.created_at = Clock::get()?.unix_timestamp;

            oracle_data.min_energy_value = 0;
            oracle_data.max_energy_value = 1000000;
            oracle_data.anomaly_detection_enabled = 1;
            oracle_data.max_reading_deviation_percent = 50;
            oracle_data.require_consensus = 0;

            oracle_data.total_valid_readings = 0;
            oracle_data.total_rejected_readings = 0;
            oracle_data.average_reading_interval = 300;
            oracle_data.last_quality_score = 100;
            oracle_data.quality_score_updated_at = Clock::get()?.unix_timestamp;

            oracle_data.backup_oracles_count = 0;
            oracle_data.consensus_threshold = 2;
            oracle_data.last_consensus_timestamp = 0;

            oracle_data.last_energy_produced = 0;
            oracle_data.last_energy_consumed = 0;
            oracle_data.min_reading_interval = 60;
        });

        Ok(())
    }

    /// Submit meter reading data from AMI (only via API Gateway)
    pub fn submit_meter_reading(
        ctx: Context<SubmitMeterReading>,
        meter_id: String,
        energy_produced: u64,
        energy_consumed: u64,
        reading_timestamp: i64,
    ) -> Result<()> {
        compute_fn!("submit_meter_reading" => {
            let mut oracle_data = ctx.accounts.oracle_data.load_mut()?;

            require!(oracle_data.active == 1, ErrorCode::OracleInactive);

            require!(
                ctx.accounts.authority.key() == oracle_data.api_gateway,
                ErrorCode::UnauthorizedGateway
            );

            let current_time = Clock::get()?.unix_timestamp;
            
            require!(
                reading_timestamp > oracle_data.last_reading_timestamp,
                ErrorCode::OutdatedReading
            );

            require!(
                reading_timestamp <= current_time + 60,
                ErrorCode::FutureReading
            );

            if oracle_data.last_reading_timestamp > 0 {
                let time_since_last = reading_timestamp - oracle_data.last_reading_timestamp;
                require!(
                    time_since_last >= oracle_data.min_reading_interval as i64,
                    ErrorCode::RateLimitExceeded
                );
                
                update_reading_interval(&mut oracle_data, time_since_last as u32)?;
            }

            let validation_result = validate_meter_reading(
                energy_produced,
                energy_consumed,
                &oracle_data,
            );

            match validation_result {
                Ok(_) => {
                    oracle_data.total_readings += 1;
                    oracle_data.last_reading_timestamp = reading_timestamp;
                    oracle_data.total_valid_readings += 1;
                    
                    oracle_data.last_energy_produced = energy_produced;
                    oracle_data.last_energy_consumed = energy_consumed;
                    
                    update_quality_score(&mut oracle_data, true)?;

                    emit!(MeterReadingSubmitted {
                        meter_id: meter_id.clone(),
                        energy_produced,
                        energy_consumed,
                        timestamp: reading_timestamp,
                        submitter: ctx.accounts.authority.key(),
                    });
                },
                Err(e) => {
                    oracle_data.total_rejected_readings += 1;
                    update_quality_score(&mut oracle_data, false)?;
                    
                    emit!(MeterReadingRejected {
                        meter_id: meter_id.clone(),
                        energy_produced,
                        energy_consumed,
                        timestamp: reading_timestamp,
                        reason: format!("{:?}", e),
                    });
                    
                    return Err(e);
                }
            }
        });

        Ok(())
    }

    /// Trigger market clearing process (only via API Gateway)
    pub fn trigger_market_clearing(ctx: Context<TriggerMarketClearing>) -> Result<()> {
        compute_fn!("trigger_market_clearing" => {
            let mut oracle_data = ctx.accounts.oracle_data.load_mut()?;

            require!(oracle_data.active == 1, ErrorCode::OracleInactive);

            require!(
                ctx.accounts.authority.key() == oracle_data.api_gateway,
                ErrorCode::UnauthorizedGateway
            );

            let current_time = Clock::get()?.unix_timestamp;
            oracle_data.last_clearing = current_time;

            emit!(MarketClearingTriggered {
                authority: ctx.accounts.authority.key(),
                timestamp: current_time,
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
                ErrorCode::UnauthorizedAuthority
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
                ErrorCode::UnauthorizedAuthority
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
                ErrorCode::UnauthorizedAuthority
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
                ErrorCode::UnauthorizedAuthority
            );

            require!(
                oracle_data.backup_oracles_count < 10,
                ErrorCode::MaxBackupOraclesReached
            );

            for i in 0..oracle_data.backup_oracles_count as usize {
                require!(
                    oracle_data.backup_oracles[i] != backup_oracle,
                    ErrorCode::BackupOracleAlreadyExists
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
                ErrorCode::UnauthorizedAuthority
            );

            let mut found_index: Option<usize> = None;
            for i in 0..oracle_data.backup_oracles_count as usize {
                if oracle_data.backup_oracles[i] == backup_oracle {
                    found_index = Some(i);
                    break;
                }
            }

            require!(found_index.is_some(), ErrorCode::BackupOracleNotFound);

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
}

// Validation functions
fn validate_meter_reading(
    energy_produced: u64,
    energy_consumed: u64,
    oracle_data: &OracleData,
) -> Result<()> {
    // Range validation
    require!(
        energy_produced >= oracle_data.min_energy_value && energy_produced <= oracle_data.max_energy_value,
        ErrorCode::EnergyValueOutOfRange
    );

    require!(
        energy_consumed >= oracle_data.min_energy_value && energy_consumed <= oracle_data.max_energy_value,
        ErrorCode::EnergyValueOutOfRange
    );

    // Basic sanity check - production shouldn't be wildly different from consumption
    if oracle_data.anomaly_detection_enabled == 1 {
        let ratio = if energy_consumed > 0 {
            (energy_produced as f64 / energy_consumed as f64) * 100.0
        } else {
            0.0
        };

        // Allow production to be up to 10x consumption (for solar producers)
        require!(ratio <= 1000.0, ErrorCode::AnomalousReading);
    }

    Ok(())
}

fn update_quality_score(oracle_data: &mut OracleData, _is_valid: bool) -> Result<()> {
    let total_readings = oracle_data.total_valid_readings + oracle_data.total_rejected_readings;

    if total_readings > 0 {
        let success_rate = (oracle_data.total_valid_readings as f64 / total_readings as f64) * 100.0;
        oracle_data.last_quality_score = success_rate as u8;
        oracle_data.quality_score_updated_at = Clock::get()?.unix_timestamp;
    }

    Ok(())
}

fn update_reading_interval(oracle_data: &mut OracleData, new_interval: u32) -> Result<()> {
    // Calculate moving average of reading interval
    // Use weighted average: 80% old + 20% new
    if oracle_data.average_reading_interval > 0 {
        let old_weight = (oracle_data.average_reading_interval as f64 * 0.8) as u32;
        let new_weight = (new_interval as f64 * 0.2) as u32;
        oracle_data.average_reading_interval = old_weight + new_weight;
    } else {
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
pub struct SubmitMeterReading<'info> {
    #[account(mut)]
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

// Data structs
/// OracleData account with zero_copy for efficient data access
/// Direct memory access avoids deserialization overhead
/// All fields explicitly defined including padding to satisfy bytemuck's Pod trait
#[account(zero_copy)]
#[repr(C)]
pub struct OracleData {
    // === 32-byte aligned fields (Pubkeys) ===
    pub authority: Pubkey,                      // 32 bytes
    pub api_gateway: Pubkey,                    // 32 bytes
    pub backup_oracles: [Pubkey; 10],           // 320 bytes (32 * 10)
    
    // === 8-byte aligned fields (u64, i64) ===
    pub total_readings: u64,                    // 8 bytes
    pub last_reading_timestamp: i64,            // 8 bytes
    pub last_clearing: i64,                     // 8 bytes
    pub created_at: i64,                        // 8 bytes
    pub min_energy_value: u64,                  // 8 bytes
    pub max_energy_value: u64,                  // 8 bytes
    pub total_valid_readings: u64,              // 8 bytes
    pub total_rejected_readings: u64,           // 8 bytes
    pub quality_score_updated_at: i64,          // 8 bytes
    pub last_consensus_timestamp: i64,          // 8 bytes
    pub last_energy_produced: u64,              // 8 bytes - for deviation check
    pub last_energy_consumed: u64,              // 8 bytes - for deviation check
    pub min_reading_interval: u64,              // 8 bytes - minimum seconds between readings (rate limit)
    
    // === 4-byte aligned field ===
    pub average_reading_interval: u32,          // 4 bytes
    
    // === 2-byte aligned field ===
    pub max_reading_deviation_percent: u16,     // 2 bytes
    
    // === 1-byte fields ===
    pub active: u8,                             // 1 byte (1 = active, 0 = inactive)
    pub anomaly_detection_enabled: u8,          // 1 byte (1 = enabled, 0 = disabled)  
    pub require_consensus: u8,                  // 1 byte (1 = required, 0 = not required)
    pub last_quality_score: u8,                 // 1 byte (0-100 quality score)
    pub backup_oracles_count: u8,               // 1 byte
    pub consensus_threshold: u8,                // 1 byte
    
    // Explicit padding to reach 8-byte alignment
    // u32(4) + u16(2) + u8*6(6) = 12 bytes
    // To align to 8 bytes: need 4 more bytes (12 + 4 = 16, which is divisible by 8)
    pub _padding: [u8; 4],                      // 4 bytes explicit padding
}

// Events
#[event]
pub struct MeterReadingSubmitted {
    pub meter_id: String,
    pub energy_produced: u64,
    pub energy_consumed: u64,
    pub timestamp: i64,
    pub submitter: Pubkey,
}

#[event]
pub struct MarketClearingTriggered {
    pub authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct OracleStatusUpdated {
    pub authority: Pubkey,
    pub active: bool,
    pub timestamp: i64,
}

#[event]
pub struct ApiGatewayUpdated {
    pub authority: Pubkey,
    pub old_gateway: Pubkey,
    pub new_gateway: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct ValidationConfigUpdated {
    pub authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct BackupOracleAdded {
    pub authority: Pubkey,
    pub backup_oracle: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct BackupOracleRemoved {
    pub authority: Pubkey,
    pub backup_oracle: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct MeterReadingRejected {
    pub meter_id: String,
    pub energy_produced: u64,
    pub energy_consumed: u64,
    pub timestamp: i64,
    pub reason: String,
}

// Errors
#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized authority")]
    UnauthorizedAuthority,
    #[msg("Unauthorized API Gateway")]
    UnauthorizedGateway,
    #[msg("Oracle is inactive")]
    OracleInactive,
    #[msg("Invalid meter reading")]
    InvalidMeterReading,
    #[msg("Market clearing in progress")]
    MarketClearingInProgress,
    #[msg("Energy value out of range")]
    EnergyValueOutOfRange,
    #[msg("Anomalous reading detected")]
    AnomalousReading,
    #[msg("Maximum backup oracles reached")]
    MaxBackupOraclesReached,
    #[msg("Reading timestamp is older than last reading")]
    OutdatedReading,
    #[msg("Reading timestamp is too far in the future")]
    FutureReading,
    #[msg("Rate limit exceeded - readings too frequent")]
    RateLimitExceeded,
    #[msg("Backup oracle already exists")]
    BackupOracleAlreadyExists,
    #[msg("Backup oracle not found")]
    BackupOracleNotFound,
}
