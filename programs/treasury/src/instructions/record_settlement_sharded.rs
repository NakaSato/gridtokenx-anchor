use anchor_lang::prelude::*;

use crate::error::TreasuryError;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
#[instruction(value: u64, shard_id: u8)]
pub struct RecordSettlementSharded<'info> {
    /// Read-only: only the recorder gate reads it. A shared read lock does not
    /// serialize parallel settles (unlike the `mut` treasury in `record_settlement`).
    #[account(seeds = [b"treasury"], bump)]
    pub treasury: AccountLoader<'info, Treasury>,

    /// The per-shard accumulator; bound to `shard_id` by its seeds.
    #[account(mut, seeds = [b"settle_shard".as_ref(), &[shard_id]], bump = shard.load()?.bump)]
    pub shard: AccountLoader<'info, SettlementShard>,

    /// The authorized settlement recorder — the trading market_authority PDA.
    pub recorder: Signer<'info>,
}

/// Parallel-friendly variant of `record_settlement`: bumps the per-shard
/// accumulator for `shard_id` instead of the global `total_settled_thbg`, so
/// settles whose buyers fall on different shards don't write-lock one account.
/// `treasury` is read-only here (recorder gate only) — read locks are shared
/// across parallel txs, so it does not serialize. The shard account is bound to
/// `shard_id` by its PDA seeds, so a recorder cannot scatter onto an arbitrary
/// account. Reconcile the global total via `aggregate_settlement_shards`.
///
/// Not independently replay-safe (same caveat as `record_settlement`): relies
/// on trading's per-match `TradeNullifier` to prevent duplicate calls.
pub fn record_settlement_sharded(
    ctx: Context<RecordSettlementSharded>,
    value: u64,
    shard_id: u8,
) -> Result<()> {
    require!(value > 0, TreasuryError::ZeroAmount);
    require!(shard_id < NUM_SETTLE_SHARDS, TreasuryError::InvalidShardId);
    let now = Clock::get()?.unix_timestamp;
    require!(
        ctx.accounts.treasury.load()?.settlement_recorder == ctx.accounts.recorder.key(),
        TreasuryError::UnauthorizedRecorder
    );
    let mut shard = ctx.accounts.shard.load_mut()?;
    shard.settled_thbg = shard
        .settled_thbg
        .checked_add(value)
        .ok_or(TreasuryError::MathOverflow)?;
    shard.settlement_count = shard
        .settlement_count
        .checked_add(1)
        .ok_or(TreasuryError::MathOverflow)?;
    emit!(SettlementShardRecorded {
        recorder: ctx.accounts.recorder.key(),
        shard_id,
        value,
        shard_total: shard.settled_thbg,
        timestamp: now,
    });
    Ok(())
}
