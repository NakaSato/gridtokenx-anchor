use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface};

use crate::check_unstake_allowed;
use crate::error::RegistryError;
use crate::events::*;
use crate::state::*;

#[cfg(feature = "localnet")]
use compute_debug::compute_checkpoint;
#[cfg(not(feature = "localnet"))]
use crate::compute_checkpoint;

#[derive(Accounts)]
pub struct UnstakeGrx<'info> {
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

pub fn unstake_grx(ctx: Context<UnstakeGrx>, amount: u64) -> Result<()> {
    require!(amount > 0, RegistryError::InsufficientStakingBalance);
    let now = Clock::get()?.unix_timestamp;

    // Read-then-drop the loader borrow before the CPI; re-borrow after.
    let (staked, last_stake_at, validator_status, resign_at) = {
        let user_account = ctx.accounts.user_account.load()?;
        (
            user_account.staked_grx,
            user_account.last_stake_at,
            user_account.validator_status,
            user_account.resign_at,
        )
    };
    // Balance + cooldown + anti-slash-escape bond lock (see check_unstake_allowed).
    check_unstake_allowed(amount, staked, last_stake_at, resign_at, now, validator_status)?;

    // Registry PDA is the vault authority — sign the withdrawal.
    let bump = ctx.bumps.registry;
    let signer_seeds: &[&[u8]] = &[b"registry".as_ref(), &[bump]];
    let signer = &[signer_seeds];

    let cpi_accounts = token_interface::TransferChecked {
        from: ctx.accounts.grx_vault.to_account_info(),
        to: ctx.accounts.user_grx_ata.to_account_info(),
        authority: ctx.accounts.registry.to_account_info(),
        mint: ctx.accounts.grx_mint.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        cpi_accounts,
        signer,
    );

    compute_checkpoint!("before_unstake_transfer_cpi");
    token_interface::transfer_checked(cpi_ctx, amount, ctx.accounts.grx_mint.decimals)?;
    compute_checkpoint!("after_unstake_transfer_cpi");

    let mut user_account = ctx.accounts.user_account.load_mut()?;
    let remaining = user_account
        .staked_grx
        .checked_sub(amount)
        .ok_or(RegistryError::MathOverflow)?;
    user_account.staked_grx = remaining;

    // No Active->Suspended demotion here: the pre-CPI guard guarantees an Active
    // validator's remaining stake never drops below MIN_VALIDATOR_STAKE via unstake.
    // Suspended/Slashed/Inactive statuses are unaffected by a withdrawal.

    emit!(Unstaked {
        user: ctx.accounts.authority.key(),
        amount,
        remaining_stake: remaining,
        timestamp: now,
    });
    Ok(())
}
