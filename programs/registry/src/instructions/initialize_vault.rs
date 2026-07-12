use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::state::*;

#[derive(Accounts)]
pub struct InitializeVault<'info> {
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
        seeds = [b"grx_vault"],
        bump,
        token::mint = grx_mint,
        token::authority = registry,
        token::token_program = token_program,
    )]
    pub grx_vault: InterfaceAccount<'info, TokenAccount>,

    pub grx_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn initialize_vault(_ctx: Context<InitializeVault>) -> Result<()> {
    Ok(())
}
