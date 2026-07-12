use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::state::*;

/// Init the transparent slash fund (T1.4): GRX vault `[b"slash_fund"]` (registry
/// authority) + `SlashFundLedger` PDA `[b"slash_fund_ledger"]`.
#[derive(Accounts)]
pub struct InitializeSlashFund<'info> {
    #[account(
        mut,
        seeds = [b"registry"],
        bump,
        has_one = authority,
    )]
    pub registry: AccountLoader<'info, Registry>,

    #[account(
        init,
        payer = authority,
        seeds = [b"slash_fund"],
        bump,
        token::mint = grx_mint,
        token::authority = registry,
        token::token_program = token_program,
    )]
    pub slash_fund: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<SlashFundLedger>(),
        seeds = [b"slash_fund_ledger"],
        bump,
    )]
    pub slash_fund_ledger: AccountLoader<'info, SlashFundLedger>,

    pub grx_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn initialize_slash_fund(ctx: Context<InitializeSlashFund>) -> Result<()> {
    let mut ledger = ctx.accounts.slash_fund_ledger.load_init()?;
    ledger.total_disbursed = 0;
    ledger.disbursement_count = 0;
    ledger.last_disbursed_ts = 0;
    ledger.bump = ctx.bumps.slash_fund_ledger;
    Ok(())
}
