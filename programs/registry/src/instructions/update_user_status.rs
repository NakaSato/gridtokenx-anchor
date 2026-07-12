use anchor_lang::prelude::*;

use crate::error::RegistryError;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
pub struct UpdateUserStatus<'info> {
    #[account(mut, seeds = [b"registry"], bump)]
    pub registry: AccountLoader<'info, Registry>,

    #[account(mut)]
    pub user_account: AccountLoader<'info, UserAccount>,

    pub authority: Signer<'info>,
}

pub fn update_user_status(
    ctx: Context<UpdateUserStatus>,
    new_status: UserStatus,
) -> Result<()> {
    let mut user_account = ctx.accounts.user_account.load_mut()?;
    let registry = ctx.accounts.registry.load()?;

    require_keys_eq!(
        ctx.accounts.authority.key(),
        registry.authority,
        RegistryError::UnauthorizedAuthority
    );

    let old_status = user_account.status;
    user_account.status = new_status;

    emit!(UserStatusUpdated {
        user: user_account.authority,
        old_status,
        new_status,
    });
    Ok(())
}
