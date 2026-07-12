use anchor_lang::prelude::*;

use crate::error::OracleError;
use crate::events::*;
use crate::state::*;

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

pub fn submit_meter_reading(
    ctx: Context<SubmitMeterReading>,
    meter_id: String,
    energy_produced: u64,
    energy_consumed: u64,
    reading_timestamp: i64,
    zone_id: i32,
) -> Result<()> {
    // Validate meter_id length. The MeterIdTooLong *error* is practically
    // unreachable — the meter_state PDA seed `[b"meter", meter_id.as_bytes()]`
    // already rejects len > 32 (= MAX_METER_ID_LEN) with MaxSeedLengthExceeded in
    // account validation. Kept deliberately: it is the explicit precondition that
    // keeps the fixed-size copy into `id_bytes` below provably panic-free without
    // reasoning about seed limits.
    require!(
        meter_id.len() <= MAX_METER_ID_LEN,
        OracleError::MeterIdTooLong
    );

    // Read-only access to global config — no write lock on oracle_data
    let oracle_data = ctx.accounts.oracle_data.load()?;

    require!(oracle_data.active == 1, OracleError::OracleInactive);

    require!(
        ctx.accounts.authority.key() == oracle_data.chain_bridge,
        OracleError::UnauthorizedGateway
    );

    let current_time = Clock::get()?.unix_timestamp;

    // Validate timestamp sanity relative to current time only
    require!(
        reading_timestamp <= current_time + 60,
        OracleError::FutureReading
    );

    // Rate limit and outdated reading validation
    if ctx.accounts.meter_state.total_readings > 0 {
        require!(
            reading_timestamp > ctx.accounts.meter_state.last_reading_timestamp,
            OracleError::OutdatedReading
        );
        require!(
            reading_timestamp >= ctx.accounts.meter_state.last_reading_timestamp.saturating_add(oracle_data.min_reading_interval as i64),
            OracleError::RateLimitExceeded
        );
    }

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
            zone_id,
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

    // Update zone_id on every submission (allows relocation of meters between zones)
    meter_state.zone_id = zone_id;

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
        zone_id,
        submitter: ctx.accounts.authority.key(),
    });

    Ok(())
}

// Validation functions
fn validate_meter_reading(
    energy_produced: u64,
    energy_consumed: u64,
    oracle_data: &OracleData,
) -> Result<()> {
    // Range validation (only check min bound if value is non-zero to allow unilateral meters)
    if energy_produced > 0 {
        require!(
            energy_produced >= oracle_data.min_energy_value,
            OracleError::EnergyValueOutOfRange
        );
    }
    require!(
        energy_produced <= oracle_data.max_energy_value,
        OracleError::EnergyValueOutOfRange
    );

    if energy_consumed > 0 {
        require!(
            energy_consumed >= oracle_data.min_energy_value,
            OracleError::EnergyValueOutOfRange
        );
    }
    require!(
        energy_consumed <= oracle_data.max_energy_value,
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

#[cfg(test)]
mod validate_meter_reading_tests {
    use super::*;

    // Anchor `#[error_code]` lays variants out from 6000; compare codes (stable) not
    // Display strings. Mirrors trading's net_seller_tests house style.
    fn err_code(e: anchor_lang::error::Error) -> u32 {
        match e {
            anchor_lang::error::Error::AnchorError(ae) => ae.error_code_number,
            other => panic!("expected AnchorError, got {other:?}"),
        }
    }
    fn code_of(v: OracleError) -> u32 { err_code(v.into()) }

    // OracleData is zero_copy + repr(C) Pod (plain ints/Pubkeys), so a host struct
    // literal builds it directly — no on-chain account needed.
    fn od(min: u64, max: u64, ratio: u16, anomaly: u8) -> OracleData {
        OracleData {
            authority: Pubkey::default(),
            chain_bridge: Pubkey::default(),
            total_readings: 0,
            last_reading_timestamp: 0,
            last_clearing: 0,
            created_at: 0,
            min_energy_value: min,
            max_energy_value: max,
            total_valid_readings: 0,
            total_rejected_readings: 0,
            quality_score_updated_at: 0,
            total_global_energy_produced: 0,
            total_global_energy_consumed: 0,
            last_cleared_epoch: 0,
            min_reading_interval: 0,
            max_production_consumption_ratio: ratio,
            active: 1,
            anomaly_detection_enabled: anomaly,
            last_quality_score: 0,
            _padding: [0; 1],
        }
    }

    #[test]
    fn accepts_a_reading_within_bounds_and_ratio() {
        // min 10, max 1000, ratio 10x, anomaly on. 100*100=10000 <= 1000*50=50000.
        assert!(validate_meter_reading(100, 50, &od(10, 1000, 1000, 1)).is_ok());
    }

    #[test]
    fn rejects_nonzero_produced_below_min() {
        let e = validate_meter_reading(5, 0, &od(10, 1000, 1000, 1)).unwrap_err();
        assert_eq!(err_code(e), code_of(OracleError::EnergyValueOutOfRange));
    }

    #[test]
    fn zero_produced_bypasses_min_bound() {
        // produced == 0 is allowed (unilateral consumer); consumed 50 is within bounds.
        assert!(validate_meter_reading(0, 50, &od(10, 1000, 1000, 1)).is_ok());
    }

    #[test]
    fn rejects_produced_above_max() {
        let e = validate_meter_reading(2000, 0, &od(10, 1000, 1000, 1)).unwrap_err();
        assert_eq!(err_code(e), code_of(OracleError::EnergyValueOutOfRange));
    }

    #[test]
    fn rejects_nonzero_consumed_below_min() {
        let e = validate_meter_reading(0, 5, &od(10, 1000, 1000, 1)).unwrap_err();
        assert_eq!(err_code(e), code_of(OracleError::EnergyValueOutOfRange));
    }

    #[test]
    fn rejects_anomalous_production_consumption_ratio() {
        // ratio 1x (100). 300*100=30000 > 100*100=10000 → anomalous.
        let e = validate_meter_reading(300, 100, &od(1, 100_000, 100, 1)).unwrap_err();
        assert_eq!(err_code(e), code_of(OracleError::AnomalousReading));
    }

    #[test]
    fn accepts_ratio_exactly_at_limit() {
        // 100*100 == 100*100 → boundary is inclusive (<=).
        assert!(validate_meter_reading(100, 100, &od(1, 100_000, 100, 1)).is_ok());
    }

    #[test]
    fn zero_consumed_skips_ratio_check() {
        // consumed == 0 with anomaly on → ratio check skipped (unilateral producer).
        assert!(validate_meter_reading(99_999, 0, &od(1, 100_000, 100, 1)).is_ok());
    }

    #[test]
    fn anomaly_disabled_allows_any_ratio() {
        assert!(validate_meter_reading(99_999, 1, &od(1, 100_000, 100, 0)).is_ok());
    }

    #[test]
    fn rejects_overflow_in_produced_times_100() {
        // produced * 100 overflows u64 → InvalidConfiguration (not a silent wrap).
        let p = u64::MAX / 10; // *100 overflows
        let e = validate_meter_reading(p, 1, &od(0, u64::MAX, u16::MAX, 1)).unwrap_err();
        assert_eq!(err_code(e), code_of(OracleError::InvalidConfiguration));
    }

    #[test]
    fn rejects_overflow_in_ratio_times_consumed() {
        // produced*100 fits, but max_ratio * consumed overflows → InvalidConfiguration.
        let c = u64::MAX / 2;
        let e = validate_meter_reading(1, c, &od(0, u64::MAX, u16::MAX, 1)).unwrap_err();
        assert_eq!(err_code(e), code_of(OracleError::InvalidConfiguration));
    }
}
