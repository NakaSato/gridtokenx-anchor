use anchor_lang::prelude::*;

use crate::error::RegistryError;
use crate::state::*;

#[derive(Accounts)]
pub struct DeregisterValidator<'info> {
    #[account(
        mut,
        seeds = [b"user", authority.key().as_ref()],
        bump,
        has_one = authority,
    )]
    pub user_account: AccountLoader<'info, UserAccount>,

    pub authority: Signer<'info>,
}

pub fn deregister_validator(ctx: Context<DeregisterValidator>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let mut user_account = ctx.accounts.user_account.load_mut()?;
    require!(
        user_account.validator_status == ValidatorStatus::Active,
        RegistryError::NotActiveValidator
    );
    user_account.validator_status = ValidatorStatus::Resigning;
    user_account.resign_at = now;
    Ok(())
}
