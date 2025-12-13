#![allow(deprecated)]

use anchor_lang::prelude::*;
use base64::{engine::general_purpose, Engine as _};

declare_id!("4vXCNesjspqZUsKWU1Zaa3pucDAdZNeFnbbwem7DefbT");

#[program]
pub mod oracle {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, api_gateway: Pubkey) -> Result<()> {
        let oracle_data = &mut ctx.accounts.oracle_data;
        oracle_data.authority = ctx.accounts.authority.key();
        oracle_data.api_gateway = api_gateway;
        oracle_data.total_readings = 0;
        oracle_data.last_clearing = 0;
        oracle_data.active = true;
        oracle_data.created_at = Clock::get()?.unix_timestamp;

        // Initialize validation config with defaults
        oracle_data.validation_config = ValidationConfig {
            min_energy_value: 0,
            max_energy_value: 1000000, // 1M kWh max reading
            anomaly_detection_enabled: true,
            max_reading_deviation_percent: 50, // 50% max deviation
            require_consensus: false,
        };

        // Initialize quality metrics
        oracle_data.quality_metrics = QualityMetrics {
            total_valid_readings: 0,
            total_rejected_readings: 0,
            average_reading_interval: 300, // 5 minutes default
            last_quality_score: 100,
            quality_score_updated_at: Clock::get()?.unix_timestamp,
        };

        // Initialize redundancy settings
        oracle_data.backup_oracles = Vec::new();
        oracle_data.consensus_threshold = 2;
        oracle_data.last_consensus_timestamp = 0;

        msg!(
            "Oracle program initialized with API Gateway: {}",
            api_gateway
        );
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
        let oracle_data = &mut ctx.accounts.oracle_data;

        require!(oracle_data.active, ErrorCode::OracleInactive);

        // Only API Gateway can submit meter readings
        require!(
            ctx.accounts.authority.key() == oracle_data.api_gateway,
            ErrorCode::UnauthorizedGateway
        );

        // === DATA VALIDATION ===
        validate_meter_reading(
            energy_produced,
            energy_consumed,
            &oracle_data.validation_config,
        )?;

        oracle_data.total_readings += 1;
        oracle_data.last_reading_timestamp = reading_timestamp;

        // Update quality metrics
        oracle_data.quality_metrics.total_valid_readings += 1;
        update_quality_score(oracle_data, true)?;

        // Encode meter reading data as base64 for external systems
        let reading_data = format!(
            "{}:{}:{}:{}",
            meter_id, energy_produced, energy_consumed, reading_timestamp
        );
        let encoded_data = general_purpose::STANDARD.encode(reading_data.as_bytes());
        msg!("Meter reading data (base64): {}", encoded_data);

        emit!(MeterReadingSubmitted {
            meter_id: meter_id.clone(),
            energy_produced,
            energy_consumed,
            timestamp: reading_timestamp,
            submitter: ctx.accounts.authority.key(),
        });

        msg!(
            "Meter reading submitted via API Gateway - Meter: {}, Produced: {}, Consumed: {}",
            meter_id,
            energy_produced,
            energy_consumed
        );
        Ok(())
    }

    /// Trigger market clearing process (only via API Gateway)
    pub fn trigger_market_clearing(ctx: Context<TriggerMarketClearing>) -> Result<()> {
        let oracle_data = &mut ctx.accounts.oracle_data;

        require!(oracle_data.active, ErrorCode::OracleInactive);

        // Only API Gateway can trigger market clearing
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

        msg!(
            "Market clearing triggered via API Gateway at timestamp: {}",
            current_time
        );
        Ok(())
    }

    /// Update oracle status (admin only)
    pub fn update_oracle_status(ctx: Context<UpdateOracleStatus>, active: bool) -> Result<()> {
        let oracle_data = &mut ctx.accounts.oracle_data;

        require!(
            ctx.accounts.authority.key() == oracle_data.authority,
            ErrorCode::UnauthorizedAuthority
        );

        oracle_data.active = active;

        emit!(OracleStatusUpdated {
            authority: ctx.accounts.authority.key(),
            active,
            timestamp: Clock::get()?.unix_timestamp,
        });

        msg!("Oracle status updated to: {}", active);
        Ok(())
    }

    /// Update API Gateway address (admin only)
    pub fn update_api_gateway(
        ctx: Context<UpdateApiGateway>,
        new_api_gateway: Pubkey,
    ) -> Result<()> {
        let oracle_data = &mut ctx.accounts.oracle_data;

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

        msg!(
            "API Gateway updated from {} to {}",
            old_gateway,
            new_api_gateway
        );
        Ok(())
    }

    /// Update validation configuration (admin only)
    pub fn update_validation_config(
        ctx: Context<UpdateValidationConfig>,
        config: ValidationConfig,
    ) -> Result<()> {
        let oracle_data = &mut ctx.accounts.oracle_data;

        require!(
            ctx.accounts.authority.key() == oracle_data.authority,
            ErrorCode::UnauthorizedAuthority
        );

        oracle_data.validation_config = config;

        emit!(ValidationConfigUpdated {
            authority: ctx.accounts.authority.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });

        msg!("Validation configuration updated");
        Ok(())
    }

    /// Add backup oracle (admin only)
    pub fn add_backup_oracle(ctx: Context<AddBackupOracle>, backup_oracle: Pubkey) -> Result<()> {
        let oracle_data = &mut ctx.accounts.oracle_data;

        require!(
            ctx.accounts.authority.key() == oracle_data.authority,
            ErrorCode::UnauthorizedAuthority
        );

        require!(
            oracle_data.backup_oracles.len() < 10,
            ErrorCode::MaxBackupOraclesReached
        );

        oracle_data.backup_oracles.push(backup_oracle);

        emit!(BackupOracleAdded {
            authority: ctx.accounts.authority.key(),
            backup_oracle,
            timestamp: Clock::get()?.unix_timestamp,
        });

        msg!("Backup oracle added: {}", backup_oracle);
        Ok(())
    }
}

// Validation functions
fn validate_meter_reading(
    energy_produced: u64,
    energy_consumed: u64,
    config: &ValidationConfig,
) -> Result<()> {
    // Range validation
    require!(
        energy_produced >= config.min_energy_value && energy_produced <= config.max_energy_value,
        ErrorCode::EnergyValueOutOfRange
    );

    require!(
        energy_consumed >= config.min_energy_value && energy_consumed <= config.max_energy_value,
        ErrorCode::EnergyValueOutOfRange
    );

    // Basic sanity check - production shouldn't be wildly different from consumption
    if config.anomaly_detection_enabled {
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

fn update_quality_score(oracle_data: &mut OracleData, is_valid: bool) -> Result<()> {
    let metrics = &mut oracle_data.quality_metrics;
    let total_readings = metrics.total_valid_readings + metrics.total_rejected_readings;

    if total_readings > 0 {
        let success_rate = (metrics.total_valid_readings as f64 / total_readings as f64) * 100.0;
        metrics.last_quality_score = success_rate as u8;
        metrics.quality_score_updated_at = Clock::get()?.unix_timestamp;
    }

    Ok(())
}

// Account structs
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + OracleData::INIT_SPACE,
        seeds = [b"oracle_data"],
        bump
    )]
    pub oracle_data: Account<'info, OracleData>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SubmitMeterReading<'info> {
    #[account(mut)]
    pub oracle_data: Account<'info, OracleData>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct TriggerMarketClearing<'info> {
    #[account(mut)]
    pub oracle_data: Account<'info, OracleData>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateOracleStatus<'info> {
    #[account(mut, has_one = authority @ ErrorCode::UnauthorizedAuthority)]
    pub oracle_data: Account<'info, OracleData>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateApiGateway<'info> {
    #[account(mut, has_one = authority @ ErrorCode::UnauthorizedAuthority)]
    pub oracle_data: Account<'info, OracleData>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateValidationConfig<'info> {
    #[account(mut, has_one = authority @ ErrorCode::UnauthorizedAuthority)]
    pub oracle_data: Account<'info, OracleData>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct AddBackupOracle<'info> {
    #[account(mut, has_one = authority @ ErrorCode::UnauthorizedAuthority)]
    pub oracle_data: Account<'info, OracleData>,

    pub authority: Signer<'info>,
}

// Data structs
#[account]
#[derive(InitSpace)]
pub struct OracleData {
    pub authority: Pubkey,
    pub api_gateway: Pubkey, // Only API Gateway can call oracle functions
    pub total_readings: u64,
    pub last_reading_timestamp: i64,
    pub last_clearing: i64,
    pub active: bool,
    pub created_at: i64,

    // === DATA VALIDATION & QUALITY ===
    pub validation_config: ValidationConfig,
    pub quality_metrics: QualityMetrics,

    // === REDUNDANCY & CONSENSUS ===
    #[max_len(10)]
    pub backup_oracles: Vec<Pubkey>, // Backup oracle authorities
    pub consensus_threshold: u8, // Minimum oracles required for consensus
    pub last_consensus_timestamp: i64,
}

#[account]
#[derive(InitSpace)]
pub struct ValidationConfig {
    pub min_energy_value: u64, // Minimum valid energy reading
    pub max_energy_value: u64, // Maximum valid energy reading
    pub anomaly_detection_enabled: bool,
    pub max_reading_deviation_percent: u16, // Max deviation from historical average
    pub require_consensus: bool,            // Whether to require multiple oracle consensus
}

#[account]
#[derive(InitSpace)]
pub struct QualityMetrics {
    pub total_valid_readings: u64,
    pub total_rejected_readings: u64,
    pub average_reading_interval: u32, // Average seconds between readings
    pub last_quality_score: u8,        // 0-100 quality score
    pub quality_score_updated_at: i64,
}

#[account]
#[derive(InitSpace)]
pub struct ReadingHistory {
    #[max_len(50)]
    pub meter_id: String, // max 50 chars
    #[max_len(10)]
    pub readings: Vec<HistoricalReading>, // Last 10 readings for trend analysis
    pub last_updated: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct HistoricalReading {
    pub energy_produced: u64,
    pub energy_consumed: u64,
    pub timestamp: i64,
    pub quality_score: u8,
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
}
