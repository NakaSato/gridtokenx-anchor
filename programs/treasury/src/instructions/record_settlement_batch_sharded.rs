use anchor_lang::prelude::*;

use crate::error::TreasuryError;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
#[instruction(value: u64, merkle_root: [u8; 32], vat_amount: u64, vat_rate_bps: u16, zone_id: u32, batch_id: u64, shard_id: u8)]
pub struct RecordSettlementBatchSharded<'info> {
    /// Read-only: only the recorder gate reads it (shared read lock does not serialize).
    #[account(seeds = [b"treasury"], bump)]
    pub treasury: AccountLoader<'info, Treasury>,

    /// The per-shard accumulator; bound to `shard_id` by its seeds.
    #[account(mut, seeds = [b"settle_shard".as_ref(), &[shard_id]], bump = shard.load()?.bump)]
    pub shard: AccountLoader<'info, SettlementShard>,

    /// Per-`(zone, batch)` audit commitment, created on first record for the batch.
    #[account(
        init,
        payer = payer,
        space = 8 + std::mem::size_of::<SettlementRecord>(),
        seeds = [b"settlement", zone_id.to_le_bytes().as_ref(), batch_id.to_le_bytes().as_ref()],
        bump
    )]
    pub settlement_record: AccountLoader<'info, SettlementRecord>,

    /// The authorized settlement recorder — the trading market_authority PDA.
    pub recorder: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Parallel-friendly variant of `record_settlement_batch`: bumps the per-shard
/// accumulator for `shard_id` instead of the global `total_settled_thbc`, while
/// still writing the per-`(zone, batch)` `SettlementRecord` audit commitment (which
/// is already non-global — unique per batch). Treasury is read-only here (recorder
/// gate only), so parallel batch settles on distinct shards don't serialize on it.
/// Reconcile the global total via `aggregate_settlement_shards`.
#[allow(clippy::too_many_arguments)]
pub fn record_settlement_batch_sharded(
    ctx: Context<RecordSettlementBatchSharded>,
    value: u64,
    merkle_root: [u8; 32],
    vat_amount: u64,
    vat_rate_bps: u16,
    zone_id: u32,
    batch_id: u64,
    shard_id: u8,
) -> Result<()> {
    require!(value > 0, TreasuryError::ZeroAmount);
    require!(shard_id < NUM_SETTLE_SHARDS, TreasuryError::InvalidShardId);
    let now = Clock::get()?.unix_timestamp;
    require!(
        ctx.accounts.treasury.load()?.settlement_recorder == ctx.accounts.recorder.key(),
        TreasuryError::UnauthorizedRecorder
    );

    let shard_total = {
        let mut shard = ctx.accounts.shard.load_mut()?;
        shard.settled_thbc = shard
            .settled_thbc
            .checked_add(value)
            .ok_or(TreasuryError::MathOverflow)?;
        shard.settlement_count = shard
            .settlement_count
            .checked_add(1)
            .ok_or(TreasuryError::MathOverflow)?;
        shard.settled_thbc
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

    emit!(SettlementBatchShardRecorded {
        recorder: ctx.accounts.recorder.key(),
        shard_id,
        zone_id,
        batch_id,
        value,
        shard_total,
        vat_amount,
        vat_rate_bps,
        merkle_root,
        timestamp: now,
    });
    Ok(())
}
