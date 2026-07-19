use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self as token_interface, Mint as MintInterface, MintTo as MintToInterface,
    TokenAccount as TokenAccountInterface, TokenInterface,
    TransferChecked as TransferCheckedInterface,
};

use crate::compute_swap_grx_for_thbc;
use crate::error::TreasuryError;
use crate::events::*;
use crate::state::*;

#[cfg(feature = "localnet")]
use compute_debug::compute_checkpoint;
#[cfg(not(feature = "localnet"))]
use crate::compute_checkpoint;

#[derive(Accounts)]
pub struct SwapGrxForThbc<'info> {
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

/// Swap GRX → THBC. This is the baht-denominated settlement primitive: a
/// producer's GRX is converted to THB-pegged value at `grx_per_thbc_rate`.
///
/// Peg invariants enforced here:
///   1. The reserve attestation must be fresh (`now - attestation_ts <= ttl`).
///   2. Outstanding `thbc_supply + minted` must never exceed `attested_reserve`.
/// Staked GRX is held in a separate vault and never backs the peg.
pub fn swap_grx_for_thbc(ctx: Context<SwapGrxForThbc>, grx_in: u64) -> Result<()> {
    require!(grx_in > 0, TreasuryError::ZeroAmount);
    let now = Clock::get()?.unix_timestamp;

    let (bump, thbc_net, fee, new_supply) = {
        let t = ctx.accounts.treasury.load()?;
        require!(t.paused == 0, TreasuryError::Paused);
        require!(t.grx_per_thbc_rate > 0, TreasuryError::RateNotSet);
        require!(
            now.saturating_sub(t.attestation_ts) <= t.attestation_ttl,
            TreasuryError::StaleAttestation
        );

        let (net, fee, new_supply) = compute_swap_grx_for_thbc(
            grx_in,
            t.grx_per_thbc_rate,
            t.swap_fee_bps,
            t.thbc_supply,
            t.attested_reserve,
        )?;

        (t.bump, net, fee, new_supply)
    };

    // Pull GRX collateral from the user into the swap vault.
    let xfer = TransferCheckedInterface {
        from: ctx.accounts.user_grx_ata.to_account_info(),
        mint: ctx.accounts.grx_mint.to_account_info(),
        to: ctx.accounts.swap_vault.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    compute_checkpoint!("before_grx_pull");
    token_interface::transfer_checked(
        CpiContext::new(ctx.accounts.token_program.key(), xfer),
        grx_in,
        ctx.accounts.grx_mint.decimals,
    )?;
    compute_checkpoint!("after_grx_pull");

    // Mint THBC to the user, signed by the treasury PDA.
    let seeds: &[&[u8]] = &[b"treasury", &[bump]];
    let signer = &[seeds];
    let mint_to = MintToInterface {
        mint: ctx.accounts.thbc_mint.to_account_info(),
        to: ctx.accounts.user_thbc_ata.to_account_info(),
        authority: ctx.accounts.treasury.to_account_info(),
    };
    compute_checkpoint!("before_thbc_mint");
    token_interface::mint_to(
        CpiContext::new_with_signer(ctx.accounts.token_program.key(), mint_to, signer),
        thbc_net,
    )?;
    compute_checkpoint!("after_thbc_mint");

    ctx.accounts.treasury.load_mut()?.thbc_supply = new_supply;

    emit!(SwappedGrxForThbc {
        user: ctx.accounts.user.key(),
        grx_in,
        thbc_out: thbc_net,
        fee,
        thbc_supply: new_supply,
        timestamp: now,
    });
    Ok(())
}
