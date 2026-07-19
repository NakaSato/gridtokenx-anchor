use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self as token_interface, Burn as BurnInterface, Mint as MintInterface,
    TokenAccount as TokenAccountInterface, TokenInterface,
    TransferChecked as TransferCheckedInterface,
};

use crate::compute_redeem_thbc_for_grx;
use crate::error::TreasuryError;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
pub struct RedeemThbcForGrx<'info> {
    #[account(
        mut,
        seeds = [b"treasury"],
        bump,
        constraint = grx_mint.key() == treasury.load()?.grx_mint @ TreasuryError::UnauthorizedAuthority,
        constraint = thbc_mint.key() == treasury.load()?.thbc_mint @ TreasuryError::UnauthorizedAuthority,
    )]
    pub treasury: AccountLoader<'info, Treasury>,

    #[account(mut)]
    pub grx_mint: Box<InterfaceAccount<'info, MintInterface>>,
    #[account(mut, seeds = [b"thbc_mint"], bump = treasury.load()?.thbc_mint_bump)]
    pub thbc_mint: Box<InterfaceAccount<'info, MintInterface>>,

    #[account(mut, seeds = [b"swap_vault"], bump = treasury.load()?.swap_vault_bump)]
    pub swap_vault: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    #[account(mut, token::mint = grx_mint, token::authority = user)]
    pub user_grx_ata: Box<InterfaceAccount<'info, TokenAccountInterface>>,
    #[account(mut, token::mint = thbc_mint, token::authority = user)]
    pub user_thbc_ata: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    pub user: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

/// Redeem THBC → GRX from the swap vault. Burns the user's THBC (shrinking the
/// peg liability) and returns GRX at the configured rate.
pub fn redeem_thbc_for_grx(ctx: Context<RedeemThbcForGrx>, thbc_in: u64) -> Result<()> {
    require!(thbc_in > 0, TreasuryError::ZeroAmount);
    let now = Clock::get()?.unix_timestamp;

    let (bump, grx_out, new_supply) = {
        let t = ctx.accounts.treasury.load()?;
        require!(t.paused == 0, TreasuryError::Paused);
        require!(t.grx_per_thbc_rate > 0, TreasuryError::RateNotSet);

        // Math + collateral guards (SupplyUnderflow / InsufficientVault) — the swap
        // vault is the redemption collateral, so a rate change (set_params) can never
        // let a redeemer drain more GRX than was deposited.
        let (grx_out, new_supply) = compute_redeem_thbc_for_grx(
            thbc_in,
            t.grx_per_thbc_rate,
            t.thbc_supply,
            ctx.accounts.swap_vault.amount,
        )?;
        (t.bump, grx_out, new_supply)
    };

    // Burn the user's THBC.
    let burn = BurnInterface {
        mint: ctx.accounts.thbc_mint.to_account_info(),
        from: ctx.accounts.user_thbc_ata.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    token_interface::burn(
        CpiContext::new(ctx.accounts.token_program.key(), burn),
        thbc_in,
    )?;

    // Return GRX from the swap vault, signed by the treasury PDA.
    let seeds: &[&[u8]] = &[b"treasury", &[bump]];
    let signer = &[seeds];
    let xfer = TransferCheckedInterface {
        from: ctx.accounts.swap_vault.to_account_info(),
        mint: ctx.accounts.grx_mint.to_account_info(),
        to: ctx.accounts.user_grx_ata.to_account_info(),
        authority: ctx.accounts.treasury.to_account_info(),
    };
    token_interface::transfer_checked(
        CpiContext::new_with_signer(ctx.accounts.token_program.key(), xfer, signer),
        grx_out,
        ctx.accounts.grx_mint.decimals,
    )?;

    ctx.accounts.treasury.load_mut()?.thbc_supply = new_supply;

    emit!(RedeemedThbcForGrx {
        user: ctx.accounts.user.key(),
        thbc_in,
        grx_out,
        thbc_supply: new_supply,
        timestamp: now,
    });
    Ok(())
}
