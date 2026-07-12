use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self as token_interface, Mint as MintInterface, TokenAccount as TokenAccountInterface,
    TokenInterface, TransferChecked as TransferCheckedInterface,
};

use crate::error::TreasuryError;
use crate::events::*;
use crate::state::*;
use crate::{accrued_since, reward_debt_for};

#[derive(Accounts)]
pub struct UnstakeGrx<'info> {
    #[account(
        mut,
        seeds = [b"treasury"],
        bump,
        constraint = grx_mint.key() == treasury.load()?.grx_mint @ TreasuryError::UnauthorizedAuthority,
    )]
    pub treasury: AccountLoader<'info, Treasury>,

    #[account(
        mut,
        seeds = [b"stake", user.key().as_ref()],
        bump = position.bump,
    )]
    pub position: Account<'info, StakePosition>,

    pub grx_mint: Box<InterfaceAccount<'info, MintInterface>>,
    #[account(mut, seeds = [b"stake_vault"], bump = treasury.load()?.stake_vault_bump)]
    pub stake_vault: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    #[account(mut, token::mint = grx_mint, token::authority = user)]
    pub user_grx_ata: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    pub user: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

/// Unstake GRX. Settles pending reward, returns principal from the staking vault.
pub fn unstake_grx(ctx: Context<UnstakeGrx>, amount: u64) -> Result<()> {
    require!(amount > 0, TreasuryError::ZeroAmount);
    let now = Clock::get()?.unix_timestamp;

    let (acc, bump) = {
        let t = ctx.accounts.treasury.load()?;
        (t.acc_reward_per_share, t.bump)
    };

    let pos = &mut ctx.accounts.position;
    require!(amount <= pos.amount, TreasuryError::InsufficientStake);
    let acc_rew = accrued_since(pos.amount, acc, pos.reward_debt)?;
    pos.pending = pos.pending.checked_add(acc_rew).ok_or(TreasuryError::MathOverflow)?;
    pos.amount -= amount;
    pos.reward_debt = reward_debt_for(pos.amount, acc)?;

    let seeds: &[&[u8]] = &[b"treasury", &[bump]];
    let signer = &[seeds];
    let xfer = TransferCheckedInterface {
        from: ctx.accounts.stake_vault.to_account_info(),
        mint: ctx.accounts.grx_mint.to_account_info(),
        to: ctx.accounts.user_grx_ata.to_account_info(),
        authority: ctx.accounts.treasury.to_account_info(),
    };
    token_interface::transfer_checked(
        CpiContext::new_with_signer(ctx.accounts.token_program.key(), xfer, signer),
        amount,
        ctx.accounts.grx_mint.decimals,
    )?;

    let new_total = {
        let mut t = ctx.accounts.treasury.load_mut()?;
        // checked, not saturating: `amount <= pos.amount <= total_staked` always holds,
        // so a clamp would mean corrupted accounting — fail loud instead of silently
        // understating total_staked (which would inflate per-share rewards in fund_rewards).
        t.total_staked = t.total_staked.checked_sub(amount).ok_or(TreasuryError::MathOverflow)?;
        t.total_staked
    };

    emit!(Unstaked {
        user: ctx.accounts.user.key(),
        amount,
        total_staked: new_total,
        timestamp: now,
    });
    Ok(())
}
