use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self as token_interface, Burn as BurnInterface, Mint as MintInterface,
    TokenAccount as TokenAccountInterface, TokenInterface,
};

#[cfg(feature = "localnet")]
use compute_debug::compute_checkpoint;
#[cfg(not(feature = "localnet"))]
use crate::compute_checkpoint;

#[derive(Accounts)]
pub struct RetireEnergyTokens<'info> {
    #[account(mut)]
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
