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
pub struct SlashStake<'info> {
    #[account(
        mut,
        seeds = [b"treasury"],
        bump,
        has_one = authority @ TreasuryError::UnauthorizedAuthority,
        constraint = grx_mint.key() == treasury.load()?.grx_mint @ TreasuryError::UnauthorizedAuthority,
    )]
    pub treasury: AccountLoader<'info, Treasury>,

    /// CHECK: identifies the slashed staker; only used to derive the position PDA and label the event.
    pub target_owner: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"stake", target_owner.key().as_ref()],
        bump = position.bump,
    )]
    pub position: Account<'info, StakePosition>,

    pub grx_mint: Box<InterfaceAccount<'info, MintInterface>>,
    #[account(mut, seeds = [b"stake_vault"], bump = treasury.load()?.stake_vault_bump)]
    pub stake_vault: Box<InterfaceAccount<'info, TokenAccountInterface>>,
    #[account(mut, seeds = [b"reward_vault"], bump = treasury.load()?.reward_vault_bump)]
    pub reward_vault: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    /// Treasury authority — must equal `treasury.authority`.
    pub authority: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

/// Slash a staker's principal for misbehaviour (treasury authority only).
///
/// The slashed GRX moves from the staking vault into the reward vault and is redistributed
/// pro-rata to the *remaining* stakers via the reward accumulator (same mechanism as
/// `fund_rewards`) — "redistributed to honest stakers, not burned". The slashed staker's
/// already-accrued rewards are preserved (settled into `pending`); only principal is taken,
/// and they are excluded from this redistribution (their `reward_debt` is rebased at the new
/// accumulator). If no stake remains after slashing, the amount is parked in `reward_pool`.
pub fn slash_stake(ctx: Context<SlashStake>, amount: u64) -> Result<()> {
    require!(amount > 0, TreasuryError::ZeroAmount);
    let now = Clock::get()?.unix_timestamp;

    let (acc_old, total_staked, bump) = {
        let t = ctx.accounts.treasury.load()?;
        (t.acc_reward_per_share, t.total_staked, t.bump)
    };

    // Settle the slashed staker's accrued reward at the OLD accumulator, then take principal.
    let slashed = {
        let pos = &mut ctx.accounts.position;
        require!(pos.amount > 0, TreasuryError::InsufficientStake);
        let acc_rew = accrued_since(pos.amount, acc_old, pos.reward_debt)?;
        pos.pending = pos.pending.checked_add(acc_rew).ok_or(TreasuryError::MathOverflow)?;
        let slashed = amount.min(pos.amount);
        pos.amount -= slashed;
        slashed
    };

    // checked, not saturating: `slashed <= pos.amount <= total_staked`, so a clamp
    // would signal corrupted accounting — fail loud rather than understate total_staked.
    let total_after = total_staked.checked_sub(slashed).ok_or(TreasuryError::MathOverflow)?;

    // Redistribute to remaining stakers (acc bump); if none remain, just hold in pool.
    let acc_new = if total_after > 0 {
        let delta = (slashed as u128)
            .checked_mul(ACC_PRECISION)
            .ok_or(TreasuryError::MathOverflow)?
            / (total_after as u128);
        acc_old.checked_add(delta).ok_or(TreasuryError::MathOverflow)?
    } else {
        acc_old
    };

    // Rebase the slashed staker at the new accumulator so they don't share their own slash.
    {
        let pos = &mut ctx.accounts.position;
        pos.reward_debt = reward_debt_for(pos.amount, acc_new)?;
    }

    {
        let mut t = ctx.accounts.treasury.load_mut()?;
        t.acc_reward_per_share = acc_new;
        t.total_staked = total_after;
        t.reward_pool = t.reward_pool.checked_add(slashed).ok_or(TreasuryError::MathOverflow)?;
    }

    let seeds: &[&[u8]] = &[b"treasury", &[bump]];
    let signer = &[seeds];
    let xfer = TransferCheckedInterface {
        from: ctx.accounts.stake_vault.to_account_info(),
        mint: ctx.accounts.grx_mint.to_account_info(),
        to: ctx.accounts.reward_vault.to_account_info(),
        authority: ctx.accounts.treasury.to_account_info(),
    };
    token_interface::transfer_checked(
        CpiContext::new_with_signer(ctx.accounts.token_program.key(), xfer, signer),
        slashed,
        ctx.accounts.grx_mint.decimals,
    )?;

    emit!(StakeSlashed {
        authority: ctx.accounts.authority.key(),
        owner: ctx.accounts.position.owner,
        slashed_amount: slashed,
        total_staked: total_after,
        timestamp: now,
    });
    Ok(())
}
