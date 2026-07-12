use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface};

use crate::error::RegistryError;
use crate::events::*;
use crate::state::*;
use crate::{apply_slash_status, compute_slash_amount, poa_slash_gate};

#[cfg(feature = "localnet")]
use compute_debug::compute_checkpoint;
#[cfg(not(feature = "localnet"))]
use crate::compute_checkpoint;

#[derive(Accounts)]
pub struct SlashValidator<'info> {
    /// CHECK: the validator being slashed; only used to derive its UserAccount PDA and label the event.
    pub target_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"user", target_authority.key().as_ref()],
        bump,
    )]
    pub target_user_account: AccountLoader<'info, UserAccount>,

    #[account(
        mut,
        seeds = [b"grx_vault"],
        bump,
        token::mint = grx_mint,
        token::authority = registry,
        token::token_program = token_program,
    )]
    pub grx_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        seeds = [b"registry"],
        bump,
    )]
    pub registry: AccountLoader<'info, Registry>,

    /// Transparent fund: destination for the slash remainder (e.g. treasury `reward_vault`).
    #[account(
        mut,
        token::mint = grx_mint,
        token::token_program = token_program,
    )]
    pub slash_destination: InterfaceAccount<'info, TokenAccount>,

    /// Harmed party's GRX token account, paid the capped victim compensation. When
    /// `proven_loss == 0` no transfer occurs; pass any valid GRX account (e.g. the fund).
    #[account(
        mut,
        token::mint = grx_mint,
        token::token_program = token_program,
    )]
    pub victim_token_account: InterfaceAccount<'info, TokenAccount>,

    pub grx_mint: InterfaceAccount<'info, Mint>,

    /// PoA authority — must equal `registry.authority`.
    pub authority: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn slash_validator(
    ctx: Context<SlashValidator>,
    slash_bps: u16,
    proven_loss: u64,
) -> Result<()> {
    require!(
        slash_bps > 0 && slash_bps <= 10_000,
        RegistryError::InvalidSlashFraction
    );
    // PoA gate: only the registry authority may slash, and only to the configured
    // slash destination (e.g. treasury reward_vault) so the fund remainder cannot
    // be misrouted.
    {
        let registry = ctx.accounts.registry.load()?;
        poa_slash_gate(
            &registry,
            ctx.accounts.authority.key(),
            ctx.accounts.slash_destination.key(),
        )?;
    }

    let (slash_amount, compensation, fund_amount, remaining) = {
        let user_account = ctx.accounts.target_user_account.load()?;
        let bond = user_account.staked_grx;
        // bond * slash_bps / 10_000, capped at bond (validates Active + bond>0).
        let slash_amount = compute_slash_amount(&user_account, slash_bps)?;
        // Compensation capped at proven loss removes the bounty-gaming incentive.
        let compensation = slash_amount.min(proven_loss);
        let fund_amount = slash_amount - compensation; // safe: compensation <= slash_amount
        let remaining = bond - slash_amount;            // safe: slash_amount <= bond
        (slash_amount, compensation, fund_amount, remaining)
    };

    // Value-accounting invariant: nothing created or destroyed.
    require!(
        slash_amount == compensation + fund_amount,
        RegistryError::SlashAccountingMismatch
    );

    let registry_seeds = &[b"registry".as_ref(), &[ctx.bumps.registry]];
    let signer = &[&registry_seeds[..]];
    let decimals = ctx.accounts.grx_mint.decimals;

    // Victim compensation (skip zero-amount transfer).
    if compensation > 0 {
        let cpi_accounts = token_interface::TransferChecked {
            from: ctx.accounts.grx_vault.to_account_info(),
            to: ctx.accounts.victim_token_account.to_account_info(),
            authority: ctx.accounts.registry.to_account_info(),
            mint: ctx.accounts.grx_mint.to_account_info(),
        };
        compute_checkpoint!("before_victim_comp_cpi");
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                cpi_accounts,
                signer,
            ),
            compensation,
            decimals,
        )?;
        compute_checkpoint!("after_victim_comp_cpi");
    }

    // Fund remainder to the configured destination (skip zero-amount transfer).
    if fund_amount > 0 {
        let cpi_accounts = token_interface::TransferChecked {
            from: ctx.accounts.grx_vault.to_account_info(),
            to: ctx.accounts.slash_destination.to_account_info(),
            authority: ctx.accounts.registry.to_account_info(),
            mint: ctx.accounts.grx_mint.to_account_info(),
        };
        compute_checkpoint!("before_fund_cpi");
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                cpi_accounts,
                signer,
            ),
            fund_amount,
            decimals,
        )?;
        compute_checkpoint!("after_fund_cpi");
    }

    let mut user_account = ctx.accounts.target_user_account.load_mut()?;
    user_account.staked_grx = remaining;
    apply_slash_status(&mut user_account, slash_bps, remaining);

    let now = Clock::get()?.unix_timestamp;
    emit!(ValidatorSlashed {
        validator: ctx.accounts.target_authority.key(),
        slashed_amount: slash_amount,
        compensation,
        fund_amount,
        proven_loss,
        remaining_stake: remaining,
        timestamp: now,
    });
    Ok(())
}
