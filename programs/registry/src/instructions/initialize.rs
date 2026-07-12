use anchor_lang::prelude::*;

use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
pub struct Initialize<'info> {
    // Shared registry account for authorities and global state
    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<Registry>(),
        seeds = [b"registry"],
        bump
    )]
    pub registry: AccountLoader<'info, Registry>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
    let mut registry = ctx.accounts.registry.load_init()?;
    registry.authority = ctx.accounts.authority.key();
    registry.has_oracle_authority = 0;
    registry.has_slash_destination = 0;
    registry.user_count = 0;
    registry.meter_count = 0;
    registry.active_meter_count = 0;

    emit!(RegistryInitialized {
        authority: ctx.accounts.authority.key(),
    });
    Ok(())
}
