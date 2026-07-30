use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self as token_interface, Burn as BurnInterface, Mint as MintInterface,
    TokenAccount as TokenAccountInterface, TokenInterface,
};

use crate::error::EnergyTokenError;
use crate::state::*;

#[cfg(feature = "localnet")]
use compute_debug::compute_checkpoint;
#[cfg(not(feature = "localnet"))]
use crate::compute_checkpoint;

#[derive(Accounts)]
pub struct RetireEnergyTokens<'info> {
    /// Canonical token config. Read-only here — the burn deliberately does NOT
    /// write `total_supply` (see the note at the end of the handler); this account
    /// exists solely to pin `mint` below.
    #[account(seeds = [b"token_info_2022"], bump)]
    pub token_info: AccountLoader<'info, TokenInfo>,

    /// The mint being burned from. **Must** be the canonical energy mint.
    ///
    /// Without this constraint the instruction burned whatever mint it was handed:
    /// `authority` only has to own `token_account`, so anyone could call the
    /// GridTokenX program to destroy their balance of an UNRELATED Token-2022 mint
    /// and have it look, on-chain and in logs, like a GridTokenX energy retirement.
    /// Mirrors the pin already used by `sync_total_supply`.
    #[account(
        mut,
        constraint = mint.key() == token_info.load()?.mint @ EnergyTokenError::InvalidMint,
    )]
    pub mint: InterfaceAccount<'info, MintInterface>,

    #[account(mut)]
    pub token_account: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    pub authority: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// Burn energy tokens (for energy consumption)
pub fn retire_energy_tokens(ctx: Context<RetireEnergyTokens>, amount: u64) -> Result<()> {
    let cpi_accounts = BurnInterface {
        mint: ctx.accounts.mint.to_account_info(),
        from: ctx.accounts.token_account.to_account_info(),
        authority: ctx.accounts.authority.to_account_info(),
    };

    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts);

    compute_checkpoint!("before_burn_cpi");
    token_interface::burn(cpi_ctx, amount)?;
    compute_checkpoint!("after_burn_cpi");

    // total_supply is NOT updated here — use sync_total_supply for batch updates
    Ok(())
}
