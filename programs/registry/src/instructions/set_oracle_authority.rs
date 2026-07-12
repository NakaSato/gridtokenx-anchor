use anchor_lang::prelude::*;

use crate::error::RegistryError;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
pub struct SetOracleAuthority<'info> {
    #[account(mut)]
    pub registry: AccountLoader<'info, Registry>,

    pub authority: Signer<'info>,
}

pub fn set_oracle_authority(ctx: Context<SetOracleAuthority>, oracle: Pubkey) -> Result<()> {
    let mut registry = ctx.accounts.registry.load_mut()?;
    require_keys_eq!(
        registry.authority,
        ctx.accounts.authority.key(),
        RegistryError::UnauthorizedAuthority
    );

    let old_oracle = if registry.has_oracle_authority == 1 {
        Some(registry.oracle_authority)
    } else {
        None
    };

    registry.oracle_authority = oracle;
    registry.has_oracle_authority = 1;

    emit!(OracleAuthoritySet {
        old_oracle,
        new_oracle: oracle,
    });
    Ok(())
}
