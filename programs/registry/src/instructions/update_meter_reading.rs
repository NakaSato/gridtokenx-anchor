use anchor_lang::prelude::*;

use crate::error::RegistryError;
use crate::events::*;
use crate::state::*;
use crate::{bytes32_to_string, ORACLE_PROGRAM_ID};

#[derive(Accounts)]
pub struct UpdateMeterReading<'info> {
    #[account(seeds = [b"registry"], bump)]
    pub registry: AccountLoader<'info, Registry>,

    #[account(mut)]
    pub meter_account: AccountLoader<'info, MeterAccount>,

    /// The oracle program's own per-meter reading record. Raw-validated in the handler
    /// (owner + canonical PDA for THIS meter + byte layout) — no `oracle` crate dep, would
    /// cycle through governance (see `ORACLE_PROGRAM_ID`). Cross-checked so this program's
    /// cumulative totals can never exceed what the AMI gateway actually recorded on-chain.
    /// CHECK: validated in the handler body.
    pub oracle_meter_state: UncheckedAccount<'info>,

    pub oracle_authority: Signer<'info>,
}

pub fn update_meter_reading(
    ctx: Context<UpdateMeterReading>,
    energy_generated: u64,
    energy_consumed: u64,
    reading_timestamp: i64,
) -> Result<()> {
    let registry = ctx.accounts.registry.load()?;
    let mut meter_account = ctx.accounts.meter_account.load_mut()?;

    require!(registry.has_oracle_authority == 1, RegistryError::OracleNotConfigured);
    require_keys_eq!(
        ctx.accounts.oracle_authority.key(),
        registry.oracle_authority,
        RegistryError::UnauthorizedOracle
    );

    require!(
        meter_account.status == MeterStatus::Active,
        RegistryError::InvalidMeterStatus
    );

    require!(
        reading_timestamp > meter_account.last_reading_at,
        RegistryError::StaleReading
    );

    // Rate-limit: minimum interval between readings (skipped on first reading).
    const MIN_READING_INTERVAL_SECS: i64 = 60;
    if meter_account.last_reading_at > 0 {
        require!(
            reading_timestamp >= meter_account.last_reading_at + MIN_READING_INTERVAL_SECS,
            RegistryError::ReadingTooFrequent
        );
    }

    const MAX_READING_DELTA: u64 = 1_000_000_000_000;
    require!(
        energy_generated <= MAX_READING_DELTA,
        RegistryError::ReadingTooHigh
    );
    require!(
        energy_consumed <= MAX_READING_DELTA,
        RegistryError::ReadingTooHigh
    );

    meter_account.last_reading_at = reading_timestamp;
    meter_account.total_generation = meter_account.total_generation.checked_add(energy_generated).ok_or(RegistryError::MathOverflow)?;
    meter_account.total_consumption = meter_account.total_consumption.checked_add(energy_consumed).ok_or(RegistryError::MathOverflow)?;

    // Bound this program's cumulative totals by the oracle's own independently
    // rate-limited/anomaly-checked totals for the same meter. The two ledgers are
    // pushed by separate calls from the same off-chain caller with no CPI between
    // them; without this, a corrupt oracle_authority could report energy_generated/
    // consumed values here that were never actually recorded in oracle, inflating
    // the settleable (mintable) balance. `<=` (not `==`) tolerates a registry sync
    // that lags an oracle submission — only "registry claims more than oracle ever
    // saw" is rejected. Raw-validate (owner + canonical PDA + bytes), no oracle
    // crate dep — see `ORACLE_PROGRAM_ID`.
    let oracle_meter_ai = ctx.accounts.oracle_meter_state.to_account_info();
    require_keys_eq!(*oracle_meter_ai.owner, ORACLE_PROGRAM_ID, RegistryError::OracleTotalMismatch);
    let meter_id_str = bytes32_to_string(&meter_account.meter_id);
    let (expected_meter_state, _bump) = Pubkey::find_program_address(
        &[b"meter", meter_id_str.as_bytes()],
        &ORACLE_PROGRAM_ID,
    );
    require_keys_eq!(oracle_meter_ai.key(), expected_meter_state, RegistryError::OracleTotalMismatch);
    // oracle::MeterState borsh layout: [0..8] disc | [8..40] meter_id | [40] meter_id_len
    // | [41] bump | [42..46] zone_id | [46..54] energy_produced | [54..62] energy_consumed
    // | [62..70] total_energy_produced | [70..78] total_energy_consumed | ...
    let data = oracle_meter_ai.try_borrow_data()?;
    require!(data.len() >= 78, RegistryError::OracleTotalMismatch);
    let oracle_total_produced = u64::from_le_bytes(data[62..70].try_into().unwrap());
    let oracle_total_consumed = u64::from_le_bytes(data[70..78].try_into().unwrap());
    require!(meter_account.total_generation <= oracle_total_produced, RegistryError::OracleTotalMismatch);
    require!(meter_account.total_consumption <= oracle_total_consumed, RegistryError::OracleTotalMismatch);
    drop(data);

    emit!(MeterReadingUpdated {
        meter_id: bytes32_to_string(&meter_account.meter_id),
        owner: meter_account.owner,
        energy_generated,
        energy_consumed,
    });
    Ok(())
}
