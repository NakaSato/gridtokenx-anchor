use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenInterface;

use crate::error::RegistryError;
use crate::events::*;
use crate::state::*;
use crate::AIRDROP_AMOUNT;

#[cfg(feature = "localnet")]
use compute_debug::compute_checkpoint;
#[cfg(not(feature = "localnet"))]
use crate::compute_checkpoint;

/// Accounts for the decoupled welcome airdrop. Mirrors the energy-token
/// `mint_tokens_direct` CPI inputs; the registry PDA signs the mint.
#[derive(Accounts)]
pub struct ClaimAirdrop<'info> {
    #[account(
        mut,
        seeds = [b"user", authority.key().as_ref()],
        bump
    )]
    pub user_account: AccountLoader<'info, UserAccount>,

    #[account(
        seeds = [b"registry"],
        bump,
    )]
    pub registry: AccountLoader<'info, Registry>,

    /// CHECK: The user's public key. Authorization checked in instruction body.
    pub authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: pinned to the real energy-token program ID (fail fast; don't rely on the CPI).
    #[account(constraint = energy_token_program.key() == energy_token::ID @ RegistryError::InvalidEnergyTokenProgram)]
    pub energy_token_program: UncheckedAccount<'info>,

    /// CHECK: The energy token mint.
    #[account(mut)]
    pub mint: UncheckedAccount<'info>,

    /// CHECK: The user's token account (ATA).
    #[account(mut)]
    pub user_token_account: UncheckedAccount<'info>,

    /// CHECK: The token info account (mint authority).
    pub token_info: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn claim_airdrop(ctx: Context<ClaimAirdrop>) -> Result<()> {
    // Authorization: the user signs for themselves, or the registry admin signs for them.
    let is_user_signing = ctx.accounts.authority.is_signer;
    let is_admin_signing = {
        let registry = ctx.accounts.registry.load()?;
        ctx.accounts.payer.key() == registry.authority
    };
    require!(is_user_signing || is_admin_signing, RegistryError::UnauthorizedAuthority);

    // Mark claimed first; if the mint CPI below fails, this write rolls back with
    // the failed tx, so the flag never desyncs from the actual mint.
    {
        let mut user_account = ctx.accounts.user_account.load_mut()?;
        require!(
            user_account.authority == ctx.accounts.authority.key(),
            RegistryError::UnauthorizedAuthority
        );
        require!(user_account.airdrop_claimed == 0, RegistryError::AirdropAlreadyClaimed);
        user_account.airdrop_claimed = 1;
    }

    let cpi_accounts = energy_token::cpi::accounts::MintTokensDirect {
        token_info: ctx.accounts.token_info.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        user_token_account: ctx.accounts.user_token_account.to_account_info(),
        authority: ctx.accounts.registry.to_account_info(), // Registry PDA signs
        registry_authority: ctx.accounts.registry.to_account_info(), // Must match stored registry_authority
        rec_validator: ctx.accounts.registry.to_account_info(), // Placeholder when REC count is 0
        token_program: ctx.accounts.token_program.to_account_info(),
    };
    let registry_seeds = &[b"registry".as_ref(), &[ctx.bumps.registry]];
    let signer = &[&registry_seeds[..]];
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.energy_token_program.key(),
        cpi_accounts,
        signer,
    );

    compute_checkpoint!("before_claim_cpi");
    energy_token::cpi::mint_tokens_direct(cpi_ctx, AIRDROP_AMOUNT)?;
    compute_checkpoint!("after_claim_cpi");

    let now = Clock::get()?.unix_timestamp;
    emit!(AirdropClaimed {
        user: ctx.accounts.authority.key(),
        amount: AIRDROP_AMOUNT,
        timestamp: now,
    });
    Ok(())
}
