#![allow(deprecated)]

use anchor_lang::prelude::*;

// Core modules
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

pub use error::OracleError;
pub use events::*;
// Handler fns share names with the #[program]-generated re-exports; the glob is
// deliberate (Context structs + client accounts must be crate-public).
#[allow(ambiguous_glob_reexports)]
pub use instructions::*;
pub use state::*;

declare_id!("64Vgos61STZ8pW9NnHi2iGtXMTQr7NqBoMorK6Zg8RJU");

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

    pub fn initialize(ctx: Context<Initialize>, chain_bridge: Pubkey) -> Result<()> {
        compute_fn!("initialize" => {
            instructions::initialize(ctx, chain_bridge)
        })
    }

    /// Submit meter reading data from AMI (only via Chain Bridge)
    ///
    /// Sealevel-optimized: oracle_data is read-only (config), writes go to per-meter MeterState PDA.
    /// This lets readings for different meters touch disjoint write sets. NOTE: the per-tx fee
    /// payer (the chain_bridge authority, also the `mut` rent payer here) is always write-locked,
    /// so submissions sharing one gateway signer still serialize. Per-meter PDAs only parallelize
    /// across distinct fee payers.
    pub fn submit_meter_reading(
        ctx: Context<SubmitMeterReading>,
        meter_id: String,
        energy_produced: u64,
        energy_consumed: u64,
        reading_timestamp: i64,
        zone_id: i32,
    ) -> Result<()> {
        compute_fn!("submit_meter_reading" => {
            instructions::submit_meter_reading(
                ctx,
                meter_id,
                energy_produced,
                energy_consumed,
                reading_timestamp,
                zone_id,
            )
        })
    }

    /// Trigger market clearing process (only via API Gateway)
    pub fn trigger_market_clearing(
        ctx: Context<TriggerMarketClearing>,
        epoch_timestamp: i64,
    ) -> Result<()> {
        compute_fn!("trigger_market_clearing" => {
            instructions::trigger_market_clearing(ctx, epoch_timestamp)
        })
    }

    /// Update oracle status (admin only)
    pub fn update_oracle_status(ctx: Context<UpdateOracleStatus>, active: bool) -> Result<()> {
        compute_fn!("update_oracle_status" => {
            instructions::update_oracle_status(ctx, active)
        })
    }

    /// Update API Gateway address (admin only)
    pub fn update_api_gateway(
        ctx: Context<UpdateApiGateway>,
        new_api_gateway: Pubkey,
    ) -> Result<()> {
        compute_fn!("update_api_gateway" => {
            instructions::update_api_gateway(ctx, new_api_gateway)
        })
    }

    /// Update production/consumption ratio validation threshold (admin only)
    /// Allows adjustment for different deployment scenarios (residential vs. large solar farms)
    pub fn update_production_ratio_config(
        ctx: Context<UpdateValidationConfig>,
        max_production_consumption_ratio: u16,
    ) -> Result<()> {
        compute_fn!("update_production_ratio_config" => {
            instructions::update_production_ratio_config(ctx, max_production_consumption_ratio)
        })
    }

    /// Update validation configuration (admin only)
    pub fn update_validation_config(
        ctx: Context<UpdateValidationConfig>,
        min_energy_value: u64,
        max_energy_value: u64,
        anomaly_detection_enabled: bool,
    ) -> Result<()> {
        compute_fn!("update_validation_config" => {
            instructions::update_validation_config(
                ctx,
                min_energy_value,
                max_energy_value,
                anomaly_detection_enabled,
            )
        })
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
            instructions::aggregate_readings(
                ctx,
                total_produced,
                total_consumed,
                valid_count,
                rejected_count,
            )
        })
    }
}

/// Admin gate for the oracle config handlers — the signer must be the stored
/// `OracleData.authority`. Single source of truth shared by every admin instruction
/// (update_oracle_status / update_api_gateway / update_production_ratio_config /
/// update_validation_config) so the check can never drift between them.
fn require_oracle_admin(oracle_data: &OracleData, signer: Pubkey) -> Result<()> {
    require!(signer == oracle_data.authority, OracleError::UnauthorizedAuthority);
    Ok(())
}

/// Authorize a caller of the node-facing oracle instructions: either the configured
/// chain bridge, or an aggregator admitted to governance's PoA allow-list (proven by
/// passing its `AggregatorEntry` PDA, which is validated against the governance program).
fn authorize_node_caller(
    signer: Pubkey,
    chain_bridge: Pubkey,
    aggregator_entry: Option<&AccountInfo>,
) -> Result<()> {
    if signer == chain_bridge {
        return Ok(());
    }
    let entry_ai = aggregator_entry.ok_or(OracleError::UnauthorizedGateway)?;
    require_keys_eq!(*entry_ai.owner, governance::ID, OracleError::AggregatorNotAdmitted);
    let (expected, _) =
        Pubkey::find_program_address(&[b"aggregator", signer.as_ref()], &governance::ID);
    require_keys_eq!(entry_ai.key(), expected, OracleError::AggregatorNotAdmitted);
    let data = entry_ai.try_borrow_data()?;
    let entry = governance::AggregatorEntry::try_deserialize(&mut &data[..])?;
    require!(
        entry.active && entry.aggregator == signer,
        OracleError::AggregatorNotAdmitted
    );
    Ok(())
}
