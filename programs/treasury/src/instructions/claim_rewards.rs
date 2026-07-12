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
pub struct ClaimRewards<'info> {
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
    #[account(mut, seeds = [b"reward_vault"], bump = treasury.load()?.reward_vault_bump)]
    pub reward_vault: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    #[account(mut, token::mint = grx_mint, token::authority = user)]
    pub user_grx_ata: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    pub user: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

/// Claim accrued staking rewards (paid in GRX from the reward pool).
pub fn claim_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let (acc, bump) = {
        let t = ctx.accounts.treasury.load()?;
        (t.acc_reward_per_share, t.bump)
    };

    let payout = {
        let pos = &mut ctx.accounts.position;
        let acc_rew = accrued_since(pos.amount, acc, pos.reward_debt)?;
        let total = pos.pending.checked_add(acc_rew).ok_or(TreasuryError::MathOverflow)?;
        pos.pending = 0;
        pos.reward_debt = reward_debt_for(pos.amount, acc)?;
        total
    };
    require!(payout > 0, TreasuryError::ZeroAmount);

    {
        let t = ctx.accounts.treasury.load()?;
        require!(t.reward_pool >= payout, TreasuryError::InsufficientRewardPool);
    }

    let seeds: &[&[u8]] = &[b"treasury", &[bump]];
    let signer = &[seeds];
    let xfer = TransferCheckedInterface {
        from: ctx.accounts.reward_vault.to_account_info(),
        mint: ctx.accounts.grx_mint.to_account_info(),
        to: ctx.accounts.user_grx_ata.to_account_info(),
        authority: ctx.accounts.treasury.to_account_info(),
    };
    token_interface::transfer_checked(
        CpiContext::new_with_signer(ctx.accounts.token_program.key(), xfer, signer),
        payout,
        ctx.accounts.grx_mint.decimals,
    )?;

    ctx.accounts.treasury.load_mut()?.reward_pool -= payout;

    emit!(RewardsClaimed {
        user: ctx.accounts.user.key(),
        amount: payout,
        timestamp: now,
    });
    Ok(())
}
