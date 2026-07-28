use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self as token_interface, Mint as MintInterface, TokenAccount as TokenAccountInterface,
    TokenInterface, TransferChecked as TransferCheckedInterface,
};

use crate::compute_exchange_thbc_for_grx;
use crate::error::TreasuryError;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
pub struct ExchangeThbcForGrx<'info> {
    #[account(
        mut,
        seeds = [b"treasury"],
        bump,
        constraint = grx_mint.key() == treasury.load()?.grx_mint @ TreasuryError::UnauthorizedAuthority,
        constraint = thbc_mint.key() == treasury.load()?.thbc_mint @ TreasuryError::UnauthorizedAuthority,
    )]
    pub treasury: AccountLoader<'info, Treasury>,

    // Not `mut`: no mint or burn, so neither supply changes.
    pub grx_mint: Box<InterfaceAccount<'info, MintInterface>>,
    #[account(seeds = [b"thbc_mint"], bump = treasury.load()?.thbc_mint_bump)]
    pub thbc_mint: Box<InterfaceAccount<'info, MintInterface>>,

    #[account(mut, seeds = [b"swap_vault"], bump = treasury.load()?.swap_vault_bump)]
    pub swap_vault: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    #[account(mut, seeds = [b"thbc_inventory"], bump = treasury.load()?.thbc_inventory_bump)]
    pub inventory_vault: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    #[account(mut, token::mint = grx_mint, token::authority = user)]
    pub user_grx_ata: Box<InterfaceAccount<'info, TokenAccountInterface>>,
    #[account(mut, token::mint = thbc_mint, token::authority = user)]
    pub user_thbc_ata: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    pub user: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

/// Exchange THBC → GRX. Formerly `redeem_thbc_for_grx`, which **burned**.
///
/// # Why this replaced the burn (F6)
///
/// The old path burned the incoming THBC and decremented `thbc_supply`, which made
/// the exchange rate a lever on the token's supply in both directions. Worse, it made
/// `thbc_supply` diverge from "THBC issued against fiat" — the quantity F2 is an
/// identity over.
///
/// The incoming THBC now returns to the platform's inventory vault, where it is
/// available to sell again. Supply is unchanged, so this instruction cannot affect
/// F1, F2, or the peg.
///
/// The GRX paid out comes from the swap vault, bounded by that vault's live balance —
/// so a rate change via `set_params` can never let a caller drain more GRX than was
/// deposited, which is the guard the old `redeem_thbc_for_grx` also had and is worth
/// keeping.
///
/// # Naming
///
/// Not called `redeem_*` any more, and that is deliberate. Redemption in this system
/// means *fiat* redemption (`redeem_thbc_for_fiat`, spec §6) — a user-signed burn
/// against a THB payout with a Δ-timelocked escrow. Reusing the word for a GRX swap
/// invited exactly the confusion where a "redeem" looked like it discharged a
/// baht-denominated claim when it discharged nothing of the sort.
pub fn exchange_thbc_for_grx(ctx: Context<ExchangeThbcForGrx>, thbc_in: u64) -> Result<()> {
    require!(thbc_in > 0, TreasuryError::ZeroAmount);
    let now = Clock::get()?.unix_timestamp;

    let (bump, grx_net, fee) = {
        let t = ctx.accounts.treasury.load()?;
        require!(t.paused == 0, TreasuryError::Paused);
        require!(t.grx_per_thbc_rate > 0, TreasuryError::RateNotSet);
        require!(
            t.thbc_inventory_bump != 0,
            TreasuryError::InventoryVaultNotInitialized
        );

        // Note what is NOT checked: `thbc_in <= thbc_supply`. The old burn needed
        // that guard (SupplyUnderflow) because it decremented supply. This transfers,
        // so the token program's own balance check on the user's ATA is the only
        // bound that matters.
        let (net, fee) = compute_exchange_thbc_for_grx(
            thbc_in,
            t.grx_per_thbc_rate,
            t.swap_fee_bps,
            ctx.accounts.swap_vault.amount,
        )?;

        (t.bump, net, fee)
    };

    // Leg 1 — user pays THBC back into inventory. This is where `burn` used to be.
    let xfer_thbc = TransferCheckedInterface {
        from: ctx.accounts.user_thbc_ata.to_account_info(),
        mint: ctx.accounts.thbc_mint.to_account_info(),
        to: ctx.accounts.inventory_vault.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    token_interface::transfer_checked(
        CpiContext::new(ctx.accounts.token_program.key(), xfer_thbc),
        thbc_in,
        ctx.accounts.thbc_mint.decimals,
    )?;

    // Leg 2 — platform pays GRX from the swap vault, signed by the treasury PDA.
    let seeds: &[&[u8]] = &[b"treasury", &[bump]];
    let signer = &[seeds];
    let xfer_grx = TransferCheckedInterface {
        from: ctx.accounts.swap_vault.to_account_info(),
        mint: ctx.accounts.grx_mint.to_account_info(),
        to: ctx.accounts.user_grx_ata.to_account_info(),
        authority: ctx.accounts.treasury.to_account_info(),
    };
    token_interface::transfer_checked(
        CpiContext::new_with_signer(ctx.accounts.token_program.key(), xfer_grx, signer),
        grx_net,
        ctx.accounts.grx_mint.decimals,
    )?;

    // No `thbc_supply` write. Its absence is the invariant.
    let thbc_supply = ctx.accounts.treasury.load()?.thbc_supply;

    emit!(ExchangedThbcForGrx {
        user: ctx.accounts.user.key(),
        thbc_in,
        grx_out: grx_net,
        fee,
        thbc_supply,
        timestamp: now,
    });
    Ok(())
}
