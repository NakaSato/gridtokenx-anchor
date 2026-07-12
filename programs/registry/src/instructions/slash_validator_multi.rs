use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface};

use crate::error::RegistryError;
use crate::events::*;
use crate::state::*;
use crate::{apply_slash_status, compute_slash_amount, poa_slash_gate};

/// Multi-victim slash (T1.3). Same as `SlashValidator` but the victim token
/// accounts are passed as `remaining_accounts` (all GRX, all `mut`), parallel to
/// the `victim_losses` arg, instead of a single `victim_token_account`.
#[derive(Accounts)]
pub struct SlashValidatorMulti<'info> {
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

    pub grx_mint: InterfaceAccount<'info, Mint>,

    /// PoA authority — must equal `registry.authority`.
    pub authority: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    // remaining_accounts: N victim GRX token accounts (mut), parallel to victim_losses.
}

pub fn slash_validator_multi<'info>(
    ctx: Context<'info, SlashValidatorMulti<'info>>,
    slash_bps: u16,
    victim_losses: Vec<u64>,
) -> Result<()> {
    require!(
        slash_bps > 0 && slash_bps <= 10_000,
        RegistryError::InvalidSlashFraction
    );
    require!(
        victim_losses.len() == ctx.remaining_accounts.len(),
        RegistryError::VictimCountMismatch
    );
    // PoA gate — authority + configured destination, identical to slash_validator.
    {
        let registry = ctx.accounts.registry.load()?;
        poa_slash_gate(
            &registry,
            ctx.accounts.authority.key(),
            ctx.accounts.slash_destination.key(),
        )?;
    }

    let (slash_amount, pool, total_loss, remaining) = {
        let user_account = ctx.accounts.target_user_account.load()?;
        let bond = user_account.staked_grx;
        // bond * slash_bps / 10_000, capped at bond (validates Active + bond>0).
        let slash_amount = compute_slash_amount(&user_account, slash_bps)?;
        // total proven loss across victims; compensation pool capped at it.
        let total_loss = victim_losses
            .iter()
            .try_fold(0u64, |a, &l| a.checked_add(l))
            .ok_or(RegistryError::MathOverflow)?;
        let pool = slash_amount.min(total_loss);
        let remaining = bond - slash_amount; // safe: slash_amount <= bond
        (slash_amount, pool, total_loss, remaining)
    };

    let registry_seeds = &[b"registry".as_ref(), &[ctx.bumps.registry]];
    let signer = &[&registry_seeds[..]];
    let decimals = ctx.accounts.grx_mint.decimals;

    // Pro-rata victim payouts (skipped entirely when total_loss == 0).
    let mut paid: u64 = 0;
    if total_loss > 0 && pool > 0 {
        for (i, victim_ai) in ctx.remaining_accounts.iter().enumerate() {
            // comp_i = pool * victim_losses[i] / total_loss (u128, floor).
            let comp_i = ((pool as u128)
                .checked_mul(victim_losses[i] as u128)
                .ok_or(RegistryError::MathOverflow)?
                / total_loss as u128) as u64;
            if comp_i == 0 {
                continue;
            }
            let cpi_accounts = token_interface::TransferChecked {
                from: ctx.accounts.grx_vault.to_account_info(),
                to: victim_ai.clone(),
                authority: ctx.accounts.registry.to_account_info(),
                mint: ctx.accounts.grx_mint.to_account_info(),
            };
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    cpi_accounts,
                    signer,
                ),
                comp_i,
                decimals,
            )?;
            paid = paid.checked_add(comp_i).ok_or(RegistryError::MathOverflow)?;
        }
    }

    // Fund remainder = everything not paid to victims (incl. rounding dust).
    let fund_amount = slash_amount - paid; // safe: paid <= pool <= slash_amount
    require!(
        slash_amount == paid + fund_amount,
        RegistryError::SlashAccountingMismatch
    );
    if fund_amount > 0 {
        let cpi_accounts = token_interface::TransferChecked {
            from: ctx.accounts.grx_vault.to_account_info(),
            to: ctx.accounts.slash_destination.to_account_info(),
            authority: ctx.accounts.registry.to_account_info(),
            mint: ctx.accounts.grx_mint.to_account_info(),
        };
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                cpi_accounts,
                signer,
            ),
            fund_amount,
            decimals,
        )?;
    }

    let mut user_account = ctx.accounts.target_user_account.load_mut()?;
    user_account.staked_grx = remaining;
    apply_slash_status(&mut user_account, slash_bps, remaining);

    let now = Clock::get()?.unix_timestamp;
    emit!(ValidatorSlashed {
        validator: ctx.accounts.target_authority.key(),
        slashed_amount: slash_amount,
        compensation: paid,
        fund_amount,
        proven_loss: total_loss,
        remaining_stake: remaining,
        timestamp: now,
    });
    Ok(())
}
