use anchor_lang::prelude::*;

use crate::error::TreasuryError;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
#[instruction(value: u64, merkle_root: [u8; 32], vat_amount: u64, vat_rate_bps: u16, zone_id: u32, batch_id: u64)]
pub struct RecordSettlementBatch<'info> {
    #[account(mut, seeds = [b"treasury"], bump)]
    pub treasury: AccountLoader<'info, Treasury>,

    /// Per-`(zone, batch)` audit commitment, created on first record for the batch.
    /// Distinct seed namespace (`b"settlement_batch"`) from the sharded variant's
    /// `b"settlement"` — this instruction is not on the live trading CPI path, so
    /// the two must never `init` the same PDA for the same (zone, batch).
    #[account(
        init,
        payer = payer,
        space = 8 + std::mem::size_of::<SettlementRecord>(),
        seeds = [b"settlement_batch", zone_id.to_le_bytes().as_ref(), batch_id.to_le_bytes().as_ref()],
        bump
    )]
    pub settlement_record: AccountLoader<'info, SettlementRecord>,

    /// The authorized settlement recorder — the trading market_authority PDA.
    pub recorder: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Record a settlement BATCH with an audit commitment. Bumps the cumulative
/// settled total (as `record_settlement` does) and writes a per-`(zone, batch)`
/// `SettlementRecord` binding the Merkle root over the batch's matches plus the
/// VAT amount/rate. Commit-only — no on-chain verification of the root; off-chain
/// verifiers recompute it and e-Tax issuance consumes the VAT fields. Authorized
/// by the `settlement_recorder` (the trading market_authority PDA).
pub fn record_settlement_batch(
    ctx: Context<RecordSettlementBatch>,
    value: u64,
    merkle_root: [u8; 32],
    vat_amount: u64,
    vat_rate_bps: u16,
    zone_id: u32,
    batch_id: u64,
) -> Result<()> {
    require!(value > 0, TreasuryError::ZeroAmount);
    let now = Clock::get()?.unix_timestamp;
    let total = {
        let mut t = ctx.accounts.treasury.load_mut()?;
        require!(
            t.settlement_recorder == ctx.accounts.recorder.key(),
            TreasuryError::UnauthorizedRecorder
        );
        t.total_settled_thbg = t
            .total_settled_thbg
            .checked_add(value)
            .ok_or(TreasuryError::MathOverflow)?;
        t.total_settled_thbg
    };

    let mut rec = ctx.accounts.settlement_record.load_init()?;
    rec.merkle_root = merkle_root;
    rec.recorder = ctx.accounts.recorder.key();
    rec.total_value = value;
    rec.vat_amount = vat_amount;
    rec.committed_ts = now;
    rec.batch_id = batch_id;
    rec.zone_id = zone_id;
    rec.vat_rate_bps = vat_rate_bps;
    rec.bump = ctx.bumps.settlement_record;

    emit!(SettlementBatchRecorded {
        recorder: ctx.accounts.recorder.key(),
        zone_id,
        batch_id,
        total_value: value,
        vat_amount,
        vat_rate_bps,
        merkle_root,
        total_settled_thbg: total,
        timestamp: now,
    });
    Ok(())
}
