use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface};

use crate::error::RegistryError;
use crate::events::*;
use crate::state::*;

/// Disburse GRX from the slash fund; PoA-gated, updates the published ledger.
#[derive(Accounts)]
pub struct DisburseSlashFund<'info> {
    #[account(
        seeds = [b"registry"],
        bump,
    )]
    pub registry: AccountLoader<'info, Registry>,

    #[account(
        mut,
        seeds = [b"slash_fund"],
        bump,
        token::mint = grx_mint,
        token::authority = registry,
        token::token_program = token_program,
    )]
    pub slash_fund: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"slash_fund_ledger"],
        bump,
    )]
    pub slash_fund_ledger: AccountLoader<'info, SlashFundLedger>,

    /// Where the disbursed GRX goes (e.g. treasury `reward_vault`).
    #[account(
        mut,
        token::mint = grx_mint,
        token::token_program = token_program,
    )]
    pub destination: InterfaceAccount<'info, TokenAccount>,

    pub grx_mint: InterfaceAccount<'info, Mint>,

    /// PoA authority — must equal `registry.authority`.
    pub authority: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn disburse_slash_fund(ctx: Context<DisburseSlashFund>, amount: u64) -> Result<()> {
    require!(amount > 0, RegistryError::InvalidAmount);
    {
        let registry = ctx.accounts.registry.load()?;
        require_keys_eq!(
            ctx.accounts.authority.key(),
            registry.authority,
            RegistryError::UnauthorizedAuthority
        );
    }
    require!(
        amount <= ctx.accounts.slash_fund.amount,
        RegistryError::InsufficientSlashFund
    );

    let registry_seeds = &[b"registry".as_ref(), &[ctx.bumps.registry]];
    let signer = &[&registry_seeds[..]];
    let decimals = ctx.accounts.grx_mint.decimals;
    let cpi_accounts = token_interface::TransferChecked {
        from: ctx.accounts.slash_fund.to_account_info(),
        to: ctx.accounts.destination.to_account_info(),
        authority: ctx.accounts.registry.to_account_info(),
        mint: ctx.accounts.grx_mint.to_account_info(),
    };
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            cpi_accounts,
            signer,
        ),
        amount,
        decimals,
    )?;

    let now = Clock::get()?.unix_timestamp;
    let (total_disbursed, disbursement_count) = {
        let mut ledger = ctx.accounts.slash_fund_ledger.load_mut()?;
        ledger.total_disbursed = ledger
            .total_disbursed
            .checked_add(amount)
            .ok_or(RegistryError::MathOverflow)?;
        ledger.disbursement_count = ledger
            .disbursement_count
            .checked_add(1)
            .ok_or(RegistryError::MathOverflow)?;
        ledger.last_disbursed_ts = now;
        (ledger.total_disbursed, ledger.disbursement_count)
    };
    emit!(SlashFundDisbursed {
        amount,
        destination: ctx.accounts.destination.key(),
        total_disbursed,
        disbursement_count,
        timestamp: now,
    });
    Ok(())
}
