use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self as token_interface, Mint as MintInterface, MintTo as MintToInterface,
    TokenAccount as TokenAccountInterface, TokenInterface,
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
pub struct MintTokensDirect<'info> {
    /// Global config — read-only, no write lock for Sealevel parallelism
    #[account(
        seeds = [b"token_info_2022"],
        bump
    )]
    pub token_info: AccountLoader<'info, TokenInfo>,

    #[account(
        mut,
        constraint = mint.key() == token_info.load()?.mint @ EnergyTokenError::UnauthorizedAuthority,
    )]
    pub mint: InterfaceAccount<'info, MintInterface>,

    // Bind the recipient to the canonical mint + token program — parity with the
    // `destination` binding on mint_to_wallet / mint_generation. Defense-in-depth:
    // the mint_to CPI already rejects a wrong-mint account, but this makes the
    // contract explicit and fails earlier in account validation.
    #[account(
        mut,
        token::mint = mint,
        token::token_program = token_program,
    )]
    pub user_token_account: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    pub authority: Signer<'info>,

    /// CHECK: Validated against stored registry_authority in TokenInfo
    #[account(
        constraint = registry_authority.key() == token_info.load()?.registry_authority @ EnergyTokenError::UnauthorizedAuthority
    )]
    pub registry_authority: UncheckedAccount<'info>,

    /// REC Validator co-signer — must be in token_info.rec_validators when count > 0
    pub rec_validator: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// Mint tokens directly to a user (authority or registry program only)
///
/// Sealevel-optimized: token_info is read-only (no total_supply write).
/// If REC validators are registered, one must co-sign to prove energy provenance.
/// Call sync_total_supply periodically to batch-update the stored total.
pub fn mint_tokens_direct(ctx: Context<MintTokensDirect>, amount: u64) -> Result<()> {
    let token_info = ctx.accounts.token_info.load()?;

    // Check if caller has permission (Admin or Registry Program)
    let is_admin = ctx.accounts.authority.key() == token_info.authority;
    let is_registry = ctx.accounts.authority.key() == ctx.accounts.registry_authority.key();


    require!(is_admin || is_registry, EnergyTokenError::UnauthorizedAuthority);

    // REC Validator co-signature: an ADMIN mint must be co-signed by a registered
    // REC validator — it represents energy provenance, so a human authority can
    // never mint un-RECed tokens (and cannot mint at all while the validator set
    // is empty). Registry-program CPIs (claim_airdrop / settle_and_mint_tokens,
    // which sign as the registry PDA) are exempt: those are protocol mints with
    // their own on-chain guards (claim flag, settlement validation), not
    // energy-generation claims, and they pass the registry PDA as a rec_validator
    // placeholder that can never be in the list.
    if !is_registry {
        require!(
            token_info.rec_validators_count > 0
                && rec_validator_registered(&token_info, &ctx.accounts.rec_validator.key()),
            EnergyTokenError::RecValidatorNotFound
        );
    }

    drop(token_info);

    // Cache clock before CPI — avoids an inline syscall inside the emit! macro
    // and ensures the timestamp is captured before the CPI context is consumed.
    let now = Clock::get()?.unix_timestamp;

    // Mint tokens using token_info PDA as authority
    let seeds = &[b"token_info_2022".as_ref(), &[ctx.bumps.token_info]];
    let signer_seeds = &[&seeds[..]];

    let cpi_accounts = MintToInterface {
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.user_token_account.to_account_info(),
        authority: ctx.accounts.token_info.to_account_info(),
    };

    let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.token_program.key(), cpi_accounts, signer_seeds);

    compute_checkpoint!("before_mint_direct_cpi");
    token_interface::mint_to(cpi_ctx, amount)?;
    compute_checkpoint!("after_mint_direct_cpi");

    // total_supply is NOT updated here — use sync_total_supply for batch updates

    emit!(GridTokensMinted {
        // The recipient WALLET (token-account owner), not the token-account address —
        // downstream REC/provenance consumers key on the owner, not the ATA pubkey.
        meter_owner: ctx.accounts.user_token_account.owner,
        amount,
        timestamp: now,
    });
    Ok(())
}
