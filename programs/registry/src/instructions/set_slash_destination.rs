use anchor_lang::prelude::*;

use crate::error::RegistryError;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
pub struct SetSlashDestination<'info> {
    #[account(mut)]
    pub registry: AccountLoader<'info, Registry>,

    pub authority: Signer<'info>,
}

pub fn set_slash_destination(ctx: Context<SetSlashDestination>, destination: Pubkey) -> Result<()> {
    let mut registry = ctx.accounts.registry.load_mut()?;
    require_keys_eq!(
        registry.authority,
        ctx.accounts.authority.key(),
        RegistryError::UnauthorizedAuthority
    );

    let old_destination = if registry.has_slash_destination == 1 {
        Some(registry.slash_destination)
    } else {
        None
    };

    registry.slash_destination = destination;
    registry.has_slash_destination = 1;

    emit!(SlashDestinationSet {
        old_destination,
        new_destination: destination,
    });
    Ok(())
}
