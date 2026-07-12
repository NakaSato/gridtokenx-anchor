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
pub struct StakeGrx<'info> {
    #[account(
        mut,
        seeds = [b"treasury"],
        bump,
        constraint = grx_mint.key() == treasury.load()?.grx_mint @ TreasuryError::UnauthorizedAuthority,
    )]
    pub treasury: AccountLoader<'info, Treasury>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + StakePosition::LEN,
        seeds = [b"stake", user.key().as_ref()],
        bump,
    )]
    pub position: Account<'info, StakePosition>,

    pub grx_mint: Box<InterfaceAccount<'info, MintInterface>>,
    #[account(mut, seeds = [b"stake_vault"], bump = treasury.load()?.stake_vault_bump)]
    pub stake_vault: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    #[account(mut, token::mint = grx_mint, token::authority = user)]
    pub user_grx_ata: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

/// Stake GRX into the staking vault. Settles any pending reward before changing
/// the position so the accumulator stays consistent.
pub fn stake_grx(ctx: Context<StakeGrx>, amount: u64) -> Result<()> {
    require!(amount > 0, TreasuryError::ZeroAmount);
    let now = Clock::get()?.unix_timestamp;

    let (acc, new_total) = {
        let t = ctx.accounts.treasury.load()?;
        let new_total = t.total_staked.checked_add(amount).ok_or(TreasuryError::MathOverflow)?;
        (t.acc_reward_per_share, new_total)
    };

    // Settle pending against the OLD position before it grows.
    let pos = &mut ctx.accounts.position;
    if pos.amount > 0 {
        let acc_rew = accrued_since(pos.amount, acc, pos.reward_debt)?;
        pos.pending = pos.pending.checked_add(acc_rew).ok_or(TreasuryError::MathOverflow)?;
    }

    let xfer = TransferCheckedInterface {
        from: ctx.accounts.user_grx_ata.to_account_info(),
        mint: ctx.accounts.grx_mint.to_account_info(),
        to: ctx.accounts.stake_vault.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    token_interface::transfer_checked(
        CpiContext::new(ctx.accounts.token_program.key(), xfer),
        amount,
        ctx.accounts.grx_mint.decimals,
    )?;

    pos.owner = ctx.accounts.user.key();
    pos.amount = pos.amount.checked_add(amount).ok_or(TreasuryError::MathOverflow)?;
    pos.reward_debt = reward_debt_for(pos.amount, acc)?;
    pos.bump = ctx.bumps.position;

    ctx.accounts.treasury.load_mut()?.total_staked = new_total;

    emit!(Staked {
        user: ctx.accounts.user.key(),
        amount,
        total_staked: new_total,
        timestamp: now,
    });
    Ok(())
}
