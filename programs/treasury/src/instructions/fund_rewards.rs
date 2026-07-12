use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self as token_interface, Mint as MintInterface, TokenAccount as TokenAccountInterface,
    TokenInterface, TransferChecked as TransferCheckedInterface,
};

use crate::error::TreasuryError;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
pub struct FundRewards<'info> {
    #[account(
        mut,
        seeds = [b"treasury"],
        bump,
        constraint = grx_mint.key() == treasury.load()?.grx_mint @ TreasuryError::UnauthorizedAuthority,
    )]
    pub treasury: AccountLoader<'info, Treasury>,

    pub grx_mint: Box<InterfaceAccount<'info, MintInterface>>,
    #[account(mut, seeds = [b"reward_vault"], bump = treasury.load()?.reward_vault_bump)]
    pub reward_vault: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    #[account(mut, token::mint = grx_mint, token::authority = funder)]
    pub funder_grx_ata: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    pub funder: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

/// Deposit GRX into the reward pool, distributing it pro-rata to current stakers
/// via the accumulator. Requires a non-zero total stake.
pub fn fund_rewards(ctx: Context<FundRewards>, amount: u64) -> Result<()> {
    require!(amount > 0, TreasuryError::ZeroAmount);
    let now = Clock::get()?.unix_timestamp;

    let total_staked = {
        let t = ctx.accounts.treasury.load()?;
        require!(t.total_staked > 0, TreasuryError::NoStakeToReward);
        t.total_staked
    };

    let xfer = TransferCheckedInterface {
        from: ctx.accounts.funder_grx_ata.to_account_info(),
        mint: ctx.accounts.grx_mint.to_account_info(),
        to: ctx.accounts.reward_vault.to_account_info(),
        authority: ctx.accounts.funder.to_account_info(),
    };
    token_interface::transfer_checked(
        CpiContext::new(ctx.accounts.token_program.key(), xfer),
        amount,
        ctx.accounts.grx_mint.decimals,
    )?;

    let delta = (amount as u128)
        .checked_mul(ACC_PRECISION)
        .ok_or(TreasuryError::MathOverflow)?
        / (total_staked as u128);
    let mut t = ctx.accounts.treasury.load_mut()?;
    t.acc_reward_per_share = t.acc_reward_per_share.checked_add(delta).ok_or(TreasuryError::MathOverflow)?;
    t.reward_pool = t.reward_pool.checked_add(amount).ok_or(TreasuryError::MathOverflow)?;

    emit!(RewardsFunded {
        funder: ctx.accounts.funder.key(),
        amount,
        timestamp: now,
    });
    Ok(())
}
