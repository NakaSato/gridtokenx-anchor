use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint as MintInterface, TokenInterface};

use crate::state::*;

#[derive(Accounts)]
pub struct InitializeToken<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<TokenInfo>(),
        seeds = [b"token_info_2022"],
        bump
    )]
    pub token_info: AccountLoader<'info, TokenInfo>,

    #[account(
        init,
        payer = authority,
        seeds = [b"mint_2022"],
        bump,
        mint::decimals = 9,
        mint::authority = token_info,
        mint::token_program = token_program,
    )]
    pub mint: InterfaceAccount<'info, MintInterface>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub rent: Sysvar<'info, Rent>,
}

/// Initialize the energy token program
pub fn initialize_token(
    ctx: Context<InitializeToken>,
    registry_program_id: Pubkey,
    registry_authority: Pubkey,
) -> Result<()> {
    let clock = Clock::get()?;
    let mut token_info = ctx.accounts.token_info.load_init()?;
    token_info.authority = ctx.accounts.authority.key();
    token_info.registry_authority = registry_authority;
    token_info.registry_program = registry_program_id;
    token_info.mint = ctx.accounts.mint.key();
    token_info.total_supply = 0;
    token_info.created_at = clock.unix_timestamp;
    token_info.rec_validators_count = 0;
    token_info.rec_validators = [Pubkey::default(); 5];
    Ok(())
}
