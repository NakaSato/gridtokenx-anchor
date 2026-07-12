use anchor_lang::prelude::*;

use crate::events::*;
use crate::require_oracle_admin;
use crate::state::*;

#[derive(Accounts)]
pub struct UpdateOracleStatus<'info> {
    #[account(mut, seeds = [b"oracle_data"], bump)]
    pub oracle_data: AccountLoader<'info, OracleData>,

    pub authority: Signer<'info>,
}

pub fn update_oracle_status(ctx: Context<UpdateOracleStatus>, active: bool) -> Result<()> {
    let mut oracle_data = ctx.accounts.oracle_data.load_mut()?;
    require_oracle_admin(&oracle_data, ctx.accounts.authority.key())?;

    oracle_data.active = if active { 1 } else { 0 };

    // Hoist Clock::get() before emit! (invariant #5) — avoids a sysvar syscall
    // inside the macro expansion.
    let now = Clock::get()?.unix_timestamp;
    emit!(OracleStatusUpdated {
        authority: ctx.accounts.authority.key(),
        active,
        timestamp: now,
    });

    Ok(())
}
