use anchor_lang::prelude::*;

use crate::error::EnergyTokenError;
use crate::state::*;

#[derive(Accounts)]
pub struct SetRegistryAuthority<'info> {
    #[account(
        mut,
        seeds = [b"token_info_2022"],
        bump,
    )]
    pub token_info: AccountLoader<'info, TokenInfo>,

    pub authority: Signer<'info>,
}

/// Update the registry authority (admin only)
pub fn set_registry_authority(ctx: Context<SetRegistryAuthority>, new_registry_authority: Pubkey) -> Result<()> {
    let mut token_info = ctx.accounts.token_info.load_mut()?;
    require!(
        ctx.accounts.authority.key() == token_info.authority,
        EnergyTokenError::UnauthorizedAuthority
    );

    token_info.registry_authority = new_registry_authority;
    Ok(())
}
