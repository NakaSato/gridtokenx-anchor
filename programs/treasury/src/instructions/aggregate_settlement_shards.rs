use anchor_lang::prelude::*;

use crate::error::TreasuryError;
use crate::state::*;

#[derive(Accounts)]
pub struct AggregateSettlementShards<'info> {
    #[account(mut, seeds = [b"treasury"], bump)]
    pub treasury: AccountLoader<'info, Treasury>,

    pub authority: Signer<'info>,
    // Shards passed via remaining_accounts.
}

/// Reconcile the global `total_settled_thbg` from the per-shard accumulators.
/// Admin-only.
///
/// **Drain-and-fold:** each `SettlementShard` passed in `remaining_accounts`
/// (validated by program owner + stored-bump PDA, deduped by a shard-id bitmask)
/// has its `settled_thbg` ADDED to the running global and then ZEROED. Folding
/// into — instead of overwriting — the live global is deliberate: the single-match
/// settle path (`record_settlement`) bumps `total_settled_thbg` directly, while the
/// batch path bumps shards. Overwriting `global = sum(shards)` (the previous
/// behaviour) silently wiped every single-match contribution on each reconcile.
/// Folding preserves both; zeroing the shard makes it a delta-since-last-aggregate,
/// so re-running with no new settles is a no-op (no double counting). Shards must
/// therefore be passed writable. `settlement_count` is left cumulative.
pub fn aggregate_settlement_shards(ctx: Context<AggregateSettlementShards>) -> Result<()> {
    let mut t = ctx.accounts.treasury.load_mut()?;
    require!(t.authority == ctx.accounts.authority.key(), TreasuryError::UnauthorizedAuthority);

    // Start from the live global so single-match `record_settlement` writes are
    // preserved across reconciles.
    let mut running: u64 = t.total_settled_thbg;
    // Bitmask of shard_ids already counted — reject duplicates so a shard
    // passed twice cannot inflate the total.
    let mut seen: u16 = 0;
    const SHARD_LEN: usize = std::mem::size_of::<SettlementShard>();

    for account_info in ctx.remaining_accounts.iter() {
        require_keys_eq!(*account_info.owner, crate::ID, TreasuryError::UnauthorizedAuthority);
        let mut data = account_info.try_borrow_mut_data()?;
        require!(data.len() >= 8 + SHARD_LEN, TreasuryError::InvalidShardAccount);
        let shard = SettlementShard::load_mut_from_bytes(&mut data[8..8 + SHARD_LEN])?;
        require!(shard.shard_id < NUM_SETTLE_SHARDS, TreasuryError::InvalidShardId);

        // Validate via the stored canonical bump (create_program_address)
        // instead of re-deriving with find_program_address.
        let expected_pda = Pubkey::create_program_address(
            &[b"settle_shard", &[shard.shard_id], &[shard.bump]], &crate::ID
        ).map_err(|_| TreasuryError::InvalidShardId)?;
        require_keys_eq!(account_info.key(), expected_pda, TreasuryError::InvalidShardId);

        let bit = 1u16 << shard.shard_id;
        require!(seen & bit == 0, TreasuryError::DuplicateShard);
        seen |= bit;

        // Must be writable: the drain below mutates the shard's data.
        require!(account_info.is_writable, TreasuryError::ShardNotWritable);

        running = running
            .checked_add(shard.settled_thbg)
            .ok_or(TreasuryError::MathOverflow)?;
        shard.settled_thbg = 0; // drain — shard now holds the next delta window
    }

    t.total_settled_thbg = running;
    Ok(())
}
