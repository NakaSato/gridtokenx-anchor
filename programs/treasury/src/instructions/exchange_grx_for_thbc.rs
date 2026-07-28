use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self as token_interface, Mint as MintInterface, TokenAccount as TokenAccountInterface,
    TokenInterface, TransferChecked as TransferCheckedInterface,
};

use crate::compute_exchange_grx_for_thbc;
use crate::error::TreasuryError;
use crate::events::*;
use crate::state::*;

#[cfg(feature = "localnet")]
use compute_debug::compute_checkpoint;
#[cfg(not(feature = "localnet"))]
use crate::compute_checkpoint;

#[derive(Accounts)]
pub struct ExchangeGrxForThbc<'info> {
    #[account(
        mut,
        seeds = [b"treasury"],
        bump,
        constraint = grx_mint.key() == treasury.load()?.grx_mint @ TreasuryError::UnauthorizedAuthority,
        constraint = thbc_mint.key() == treasury.load()?.thbc_mint @ TreasuryError::UnauthorizedAuthority,
    )]
    pub treasury: AccountLoader<'info, Treasury>,

    // Not `mut`: this instruction never mints or burns, so neither mint's supply
    // changes. `transfer_checked` reads decimals only.
    pub grx_mint: Box<InterfaceAccount<'info, MintInterface>>,
    #[account(seeds = [b"thbc_mint"], bump = treasury.load()?.thbc_mint_bump)]
    pub thbc_mint: Box<InterfaceAccount<'info, MintInterface>>,

    #[account(mut, seeds = [b"swap_vault"], bump = treasury.load()?.swap_vault_bump)]
    pub swap_vault: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    /// Platform-held THBC. Its balance IS the inventory bound.
    #[account(mut, seeds = [b"thbc_inventory"], bump = treasury.load()?.thbc_inventory_bump)]
    pub inventory_vault: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    #[account(mut, token::mint = grx_mint, token::authority = user)]
    pub user_grx_ata: Box<InterfaceAccount<'info, TokenAccountInterface>>,
    #[account(mut, token::mint = thbc_mint, token::authority = user)]
    pub user_thbc_ata: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    pub user: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

/// Exchange GRX → THBC against **platform-held inventory**. Formerly
/// `swap_grx_for_thbc`, which minted.
///
/// # Why this replaced the mint (F6)
///
/// The old path minted THBC against GRX collateral while consuming fiat-reserve
/// headroom. That put a volatile asset in the backing set of a fiat-referenced token
/// and made the peg a governance parameter: `set_params` could move
/// `grx_per_thbc_rate` and thereby change how much THBC a given GRX deposit could
/// conjure, against reserves that had not moved.
///
/// Here both legs are transfers of tokens that already exist. `thbc_supply` and
/// `attested_reserve` are untouched, so **F1 and F6 hold by construction** rather
/// than by check — there is no code path from this instruction to `mint_to`.
///
/// # What is deliberately *not* checked
///
/// The reserve attestation freshness check (F5) is gone, and its absence is correct,
/// not an oversight. F5 exists to stop *issuance* against a stale reserve. This
/// instruction issues nothing: the THBC it pays out was already issued against fiat
/// and is already inside `thbc_supply`. Blocking exchange on a stale attestation
/// would cost liveness and buy no safety.
///
/// `paused` and a configured rate are still required.
///
/// # Risk
///
/// The platform now carries GRX inventory risk explicitly on its own balance sheet
/// instead of implicitly on the reserve. That is the correct place for it.
/// `grx_per_thbc_rate` remains an admin parameter and a disclosed centralisation: a
/// quoted market-maker rate against bounded inventory, not a peg.
pub fn exchange_grx_for_thbc(ctx: Context<ExchangeGrxForThbc>, grx_in: u64) -> Result<()> {
    require!(grx_in > 0, TreasuryError::ZeroAmount);
    let now = Clock::get()?.unix_timestamp;

    let (bump, thbc_net, fee) = {
        let t = ctx.accounts.treasury.load()?;
        require!(t.paused == 0, TreasuryError::Paused);
        require!(t.grx_per_thbc_rate > 0, TreasuryError::RateNotSet);
        require!(
            t.thbc_inventory_bump != 0,
            TreasuryError::InventoryVaultNotInitialized
        );

        // Bounded by the vault's live balance, never by supply headroom.
        let (net, fee) = compute_exchange_grx_for_thbc(
            grx_in,
            t.grx_per_thbc_rate,
            t.swap_fee_bps,
            ctx.accounts.inventory_vault.amount,
        )?;

        (t.bump, net, fee)
    };

    // Leg 1 — user pays GRX into the swap vault.
    let xfer_grx = TransferCheckedInterface {
        from: ctx.accounts.user_grx_ata.to_account_info(),
        mint: ctx.accounts.grx_mint.to_account_info(),
        to: ctx.accounts.swap_vault.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    compute_checkpoint!("before_grx_pull");
    token_interface::transfer_checked(
        CpiContext::new(ctx.accounts.token_program.key(), xfer_grx),
        grx_in,
        ctx.accounts.grx_mint.decimals,
    )?;
    compute_checkpoint!("after_grx_pull");

    // Leg 2 — platform pays THBC out of inventory, signed by the treasury PDA.
    // This is where `mint_to` used to be.
    let seeds: &[&[u8]] = &[b"treasury", &[bump]];
    let signer = &[seeds];
    let xfer_thbc = TransferCheckedInterface {
        from: ctx.accounts.inventory_vault.to_account_info(),
        mint: ctx.accounts.thbc_mint.to_account_info(),
        to: ctx.accounts.user_thbc_ata.to_account_info(),
        authority: ctx.accounts.treasury.to_account_info(),
    };
    compute_checkpoint!("before_thbc_transfer");
    token_interface::transfer_checked(
        CpiContext::new_with_signer(ctx.accounts.token_program.key(), xfer_thbc, signer),
        thbc_net,
        ctx.accounts.thbc_mint.decimals,
    )?;
    compute_checkpoint!("after_thbc_transfer");

    // No `thbc_supply` write. Its absence is the invariant.
    let thbc_supply = ctx.accounts.treasury.load()?.thbc_supply;

    emit!(ExchangedGrxForThbc {
        user: ctx.accounts.user.key(),
        grx_in,
        thbc_out: thbc_net,
        fee,
        thbc_supply,
        timestamp: now,
    });
    Ok(())
}
