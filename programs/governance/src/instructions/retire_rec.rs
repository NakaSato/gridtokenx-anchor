use crate::errors::GovernanceError;
use crate::events::*;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self as token_interface, Mint as MintInterface, TokenAccount as TokenAccountInterface,
    TokenInterface,
};

#[derive(Accounts)]
pub struct RetireRec<'info> {
    #[account(mut, seeds = [b"rec_mint"], bump)]
    pub rec_mint: Box<InterfaceAccount<'info, MintInterface>>,
    /// Holder retiring (burning) their REC tokens to claim the green attribute.
    #[account(mut)]
    pub holder: Signer<'info>,
    #[account(
        mut,
        associated_token::mint = rec_mint,
        associated_token::authority = holder,
        associated_token::token_program = token_program,
    )]
    pub holder_token_account: Box<InterfaceAccount<'info, TokenAccountInterface>>,
    pub token_program: Interface<'info, TokenInterface>,
}

/// Retire (burn) REC tokens — the standard REC end-of-life: the holder surrenders the
/// green attribute, removing supply. `amount` is in base units (6 decimals; 1 kWh = 1_000).
pub fn retire_rec(ctx: Context<RetireRec>, amount: u64) -> Result<()> {
    require!(amount > 0, GovernanceError::InvalidAmount);
    let now = Clock::get()?.unix_timestamp;
    let cpi_accounts = token_interface::Burn {
        mint: ctx.accounts.rec_mint.to_account_info(),
        from: ctx.accounts.holder_token_account.to_account_info(),
        authority: ctx.accounts.holder.to_account_info(),
    };
    token_interface::burn(
        CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts),
        amount,
    )?;
    emit!(RecRetired {
        holder: ctx.accounts.holder.key(),
        amount,
        timestamp: now,
    });
    Ok(())
}
