use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    Mint as MintInterface, TokenAccount as TokenAccountInterface, TokenInterface,
};

use crate::error::TreasuryError;
use crate::state::*;

#[derive(Accounts)]
pub struct InitializeRebateVault<'info> {
    #[account(
        mut,
        seeds = [b"treasury"],
        bump,
        constraint = grx_mint.key() == treasury.load()?.grx_mint @ TreasuryError::UnauthorizedAuthority,
    )]
    pub treasury: AccountLoader<'info, Treasury>,

    pub grx_mint: Box<InterfaceAccount<'info, MintInterface>>,

    /// GRX slashed-bond destination for registry's `slash_destination` — regulator /
    /// consumer-rebate pool, kept separate from `reward_vault` (yield-stakers).
    #[account(
        init,
        payer = authority,
        seeds = [b"rebate_vault"],
        bump,
        token::mint = grx_mint,
        token::authority = treasury,
        token::token_program = token_program,
    )]
    pub rebate_vault: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

/// Create the GRX rebate-pool vault (`[b"rebate_vault"]`) — a FOURTH treasury GRX vault,
/// distinct from swap/stake/reward, that registry's `slash_destination` (role-map.md
/// fix #10) should point at so slashed validator bonds reach a regulator / consumer-
/// rebate fund instead of yield-stakers. Admin-only, idempotent (fails harmlessly if
/// already created). No CPI wiring — registry sends slashed GRX here directly, this
/// program never reads or moves it; a later ERC-facing withdraw instruction is a
/// separate, explicit task.
pub fn initialize_rebate_vault(ctx: Context<InitializeRebateVault>) -> Result<()> {
    let mut t = ctx.accounts.treasury.load_mut()?;
    require!(t.authority == ctx.accounts.authority.key(), TreasuryError::UnauthorizedAuthority);
    t.rebate_vault_bump = ctx.bumps.rebate_vault;
    Ok(())
}
