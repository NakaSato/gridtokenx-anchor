use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{
        self as token_interface, Mint as MintInterface, TokenAccount as TokenAccountInterface,
        TokenInterface,
    },
};

use crate::error::EnergyTokenError;
use crate::events::*;
use crate::rec_validator_registered;
use crate::state::*;

#[cfg(feature = "localnet")]
use compute_debug::compute_checkpoint;
#[cfg(not(feature = "localnet"))]
use crate::compute_checkpoint;

#[derive(Accounts)]
pub struct MintToWallet<'info> {
    #[account(
        mut,
        constraint = mint.key() == token_info.load()?.mint @ EnergyTokenError::UnauthorizedAuthority,
    )]
    pub mint: InterfaceAccount<'info, MintInterface>,

    #[account(
        seeds = [b"token_info_2022"],
        bump,
        constraint = token_info.load()?.authority == authority.key() @ EnergyTokenError::UnauthorizedAuthority,
    )]
    pub token_info: AccountLoader<'info, TokenInfo>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = destination_owner,
        token::token_program = token_program,
    )]
    pub destination: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    /// CHECK: The owner of the destination token account
    pub destination_owner: UncheckedAccount<'info>,

    pub authority: Signer<'info>,

    /// REC validator co-signer — MANDATORY: must be a registered REC validator. Typed as
    /// Option so a missing co-signer surfaces as RecValidatorNotFound rather than a coarse
    /// "account not enough keys"; the handler rejects None and any non-registered key.
    pub rec_validator: Option<Signer<'info>>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Mint GRID tokens to a wallet using Token interface
pub fn mint_to_wallet(ctx: Context<MintToWallet>, amount: u64) -> Result<()> {
    {
        let token_info = ctx.accounts.token_info.load()?;
        require!(
            token_info.authority == ctx.accounts.authority.key(),
            EnergyTokenError::UnauthorizedAuthority
        );

        // REC provenance (mandatory — no opt-out): every mint must be co-signed by a
        // registered REC validator, proving the minted GRID is backed by a Renewable
        // Energy Certificate. A fresh token cannot mint until at least one validator
        // is registered via add_rec_validator (rec_validators_count == 0 => no key is
        // registered => RecValidatorNotFound).
        let rec_key = ctx
            .accounts
            .rec_validator
            .as_ref()
            .map(|v| v.key())
            .ok_or(EnergyTokenError::RecValidatorNotFound)?;
        require!(
            rec_validator_registered(&token_info, &rec_key),
            EnergyTokenError::RecValidatorNotFound
        );
    }
    // Cache clock before CPI — avoids an inline syscall inside the emit! macro
    // and ensures the timestamp is captured before the CPI context is consumed.
    let now = Clock::get()?.unix_timestamp;
    // Logging disabled to save CU
    let cpi_accounts = token_interface::MintTo {
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.destination.to_account_info(),
        authority: ctx.accounts.token_info.to_account_info(),
    };

    let seeds = &[b"token_info_2022".as_ref(), &[ctx.bumps.token_info]];
    let signer = &[&seeds[..]];

    let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.token_program.key(), cpi_accounts, signer);

    compute_checkpoint!("before_mint_cpi");
    token_interface::mint_to(cpi_ctx, amount)?;
    compute_checkpoint!("after_mint_cpi");

    // total_supply is NOT updated here — use sync_total_supply for batch updates
    // to avoid write-lock contention on token_info during high-frequency minting

    emit!(TokensMinted {
        recipient: ctx.accounts.destination.key(),
        amount,
        timestamp: now,
    });
    Ok(())
}
