use anchor_lang::prelude::*;

use crate::error::TreasuryError;
use crate::state::*;

#[derive(Accounts)]
#[instruction(shard_id: u8)]
pub struct InitializeSettlementShard<'info> {
    #[account(seeds = [b"treasury"], bump)]
    pub treasury: AccountLoader<'info, Treasury>,

    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<SettlementShard>(),
        seeds = [b"settle_shard".as_ref(), &[shard_id]],
        bump
    )]
    pub shard: AccountLoader<'info, SettlementShard>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Create one settlement accumulator shard PDA (`[b"settle_shard", &[shard_id]]`).
/// Admin-only, idempotent per shard_id. Run once per shard (0..NUM_SETTLE_SHARDS)
/// at deploy/init so the sharded settle path has its destination accounts.
pub fn initialize_settlement_shard(
    ctx: Context<InitializeSettlementShard>,
    shard_id: u8,
) -> Result<()> {
    require!(shard_id < NUM_SETTLE_SHARDS, TreasuryError::InvalidShardId);
    require!(
        ctx.accounts.treasury.load()?.authority == ctx.accounts.authority.key(),
        TreasuryError::UnauthorizedAuthority
    );
    let mut shard = ctx.accounts.shard.load_init()?;
    shard.shard_id = shard_id;
    shard.bump = ctx.bumps.shard;
    shard.settled_thbg = 0;
    shard.settlement_count = 0;
    Ok(())
}
