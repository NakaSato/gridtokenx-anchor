use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint as MintInterface};

use crate::error::EnergyTokenError;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
pub struct SyncTotalSupply<'info> {
    #[account(
        mut,
        seeds = [b"token_info_2022"],
        bump
    )]
    pub token_info: AccountLoader<'info, TokenInfo>,

    #[account(
        constraint = mint.key() == token_info.load()?.mint @ EnergyTokenError::UnauthorizedAuthority,
    )]
    pub mint: InterfaceAccount<'info, MintInterface>,

    pub authority: Signer<'info>,
}

/// Sync total_supply from the canonical SPL Mint account (admin only)
///
/// Call this periodically (e.g. every N mints/burns) instead of writing
/// token_info on every transaction. Eliminates write-lock contention on
/// token_info during high-frequency mint/burn operations.
pub fn sync_total_supply(ctx: Context<SyncTotalSupply>) -> Result<()> {
    let mut token_info = ctx.accounts.token_info.load_mut()?;

    require!(
        ctx.accounts.authority.key() == token_info.authority,
        EnergyTokenError::UnauthorizedAuthority
    );

    let canonical_supply = ctx.accounts.mint.supply;
    token_info.total_supply = canonical_supply;

    // Hoist Clock::get() before emit! — avoids inline syscall inside macro expansion.
    let now = Clock::get()?.unix_timestamp;
    emit!(TotalSupplySynced {
        authority: ctx.accounts.authority.key(),
        supply: canonical_supply,
        timestamp: now,
    });
    Ok(())
}
