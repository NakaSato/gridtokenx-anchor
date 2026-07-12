use crate::errors::GovernanceError;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint as MintInterface, TokenInterface};

#[derive(Accounts)]
pub struct InitRecMint<'info> {
    #[account(
        seeds = [b"governance_config"],
        bump,
        has_one = authority @ GovernanceError::UnauthorizedAuthority
    )]
    pub governance_config: Account<'info, GovernanceConfig>,
    /// Fungible REC mint: 1 token = 1 MWh, 6 decimals (base unit = 1 Wh; 1 kWh = 1000 units).
    /// Mint authority = governance_config PDA `[b"governance_config"]`.
    #[account(
        init,
        payer = authority,
        seeds = [b"rec_mint"],
        bump,
        mint::decimals = 6,
        mint::authority = governance_config,
        mint::token_program = token_program,
    )]
    pub rec_mint: Box<InterfaceAccount<'info, MintInterface>>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

/// Initialize the fungible REC mint (PDA `[b"rec_mint"]`, 6 decimals, mint authority =
/// governance_config PDA). Run once before issuing certificates. The mint is created
/// entirely via account constraints.
pub fn init_rec_mint(_ctx: Context<InitRecMint>) -> Result<()> {
    Ok(())
}
