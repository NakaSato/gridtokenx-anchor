use anchor_lang::prelude::*;

use crate::error::RegistryError;
use crate::state::*;

#[derive(Accounts)]
#[instruction(shard_id: u8)]
pub struct InitializeShard<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<RegistryShard>(),
        seeds = [b"registry_shard".as_ref(), &[shard_id]],
        bump
    )]
    pub shard: AccountLoader<'info, RegistryShard>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn initialize_shard(ctx: Context<InitializeShard>, shard_id: u8) -> Result<()> {
    require!(shard_id < 16, RegistryError::InvalidShardId);
    let mut shard = ctx.accounts.shard.load_init()?;
    shard.shard_id = shard_id;
    shard.bump = ctx.bumps.shard; // cache canonical bump for cheap PDA checks later
    shard.user_count = 0;
    shard.meter_count = 0;
    shard.active_meter_count = 0;
    Ok(())
}
