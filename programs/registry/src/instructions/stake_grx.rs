use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface};

use crate::error::RegistryError;
use crate::state::*;

#[cfg(feature = "localnet")]
use compute_debug::compute_checkpoint;
#[cfg(not(feature = "localnet"))]
use crate::compute_checkpoint;

#[derive(Accounts)]
pub struct StakeGrx<'info> {
    #[account(
        mut,
        seeds = [b"user", authority.key().as_ref()],
        bump,
        has_one = authority,
    )]
    pub user_account: AccountLoader<'info, UserAccount>,

    #[account(
        mut,
        seeds = [b"grx_vault"],
        bump,
        token::mint = grx_mint,
        token::authority = registry,
        token::token_program = token_program,
    )]
    pub grx_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        seeds = [b"registry"],
        bump,
    )]
    pub registry: AccountLoader<'info, Registry>,

    #[account(
        mut,
        token::mint = grx_mint,
        token::authority = authority,
        token::token_program = token_program,
    )]
    pub user_grx_ata: InterfaceAccount<'info, TokenAccount>,

    pub grx_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn stake_grx(ctx: Context<StakeGrx>, amount: u64) -> Result<()> {
    require!(amount > 0, RegistryError::MinStakeNotMet);
    let cpi_accounts = token_interface::TransferChecked {
        from: ctx.accounts.user_grx_ata.to_account_info(),
        to: ctx.accounts.grx_vault.to_account_info(),
        authority: ctx.accounts.authority.to_account_info(),
        mint: ctx.accounts.grx_mint.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts);

    compute_checkpoint!("before_stake_transfer_cpi");
    token_interface::transfer_checked(cpi_ctx, amount, ctx.accounts.grx_mint.decimals)?;
    compute_checkpoint!("after_stake_transfer_cpi");

    let mut user_account = ctx.accounts.user_account.load_mut()?;
    user_account.staked_grx = user_account
        .staked_grx
        .checked_add(amount)
        .ok_or(RegistryError::MathOverflow)?;
    // Re-anchor the unstake cooldown to the most recent stake/top-up on
    // EVERY stake. Anchoring only to the first deposit let a staker keep a
    // dust balance permanently staked so `last_stake_at` never refreshed,
    // then stake-large-and-immediately-unstake-large with zero cooldown —
    // escaping the slashing window. Every fresh GRX must serve the full
    // cooldown before it can leave the vault.
    user_account.last_stake_at = Clock::get()?.unix_timestamp;
    Ok(())
}
