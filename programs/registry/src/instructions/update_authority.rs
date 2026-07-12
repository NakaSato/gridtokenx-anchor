use anchor_lang::prelude::*;

use crate::error::RegistryError;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
pub struct UpdateAuthority<'info> {
    #[account(mut)]
    pub registry: AccountLoader<'info, Registry>,

    pub authority: Signer<'info>,
}

pub fn update_authority(ctx: Context<UpdateAuthority>, new_authority: Pubkey) -> Result<()> {
    let mut registry = ctx.accounts.registry.load_mut()?;
    require_keys_eq!(
        registry.authority,
        ctx.accounts.authority.key(),
        RegistryError::UnauthorizedAuthority
    );

    let old_authority = registry.authority;
    registry.authority = new_authority;

    emit!(AuthorityUpdated {
        old_authority,
        new_authority,
    });
    Ok(())
}
