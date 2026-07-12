use anchor_lang::prelude::*;

use crate::do_settle_meter;
use crate::state::*;

#[derive(Accounts)]
pub struct SettleAndMintTokens<'info> {
    #[account(mut)]
    pub meter_account: AccountLoader<'info, MeterAccount>,

    pub meter_owner: Signer<'info>,

    /// CHECK: Energy token program's token_info PDA
    #[account(mut)]
    pub token_info: UncheckedAccount<'info>,

    /// CHECK: Energy token mint account
    #[account(mut)]
    pub mint: UncheckedAccount<'info>,

    /// CHECK: User's token account for receiving minted tokens
    #[account(mut)]
    pub user_token_account: UncheckedAccount<'info>,

    /// CHECK: Authority that can mint tokens (usually program authority)
    /// We use the Registry account itself as the authority signer
    #[account(
        mut,
        seeds = [b"registry"],
        bump
    )]
    pub registry: AccountLoader<'info, Registry>,

    /// The energy token program
    /// CHECK: This is validated by the CPI call
    pub energy_token_program: UncheckedAccount<'info>,

    /// CHECK: SPL Token program
    pub token_program: UncheckedAccount<'info>,

    /// CHECK: REC Validator co-signer (required when validators are registered in token_info)
    /// For registry->energy_token CPI, this can be the meter_owner or a separate validator
    pub rec_validator: UncheckedAccount<'info>,
}

pub fn settle_and_mint_tokens(ctx: Context<SettleAndMintTokens>) -> Result<()> {
    let mut meter = ctx.accounts.meter_account.load_mut()?;
    let new_tokens_to_mint = do_settle_meter(&mut meter, ctx.accounts.meter_owner.key())?;

    // We need to sign as the Registry because the Registry is the authority of the Energy Token (TokenInfo)
    let bump = ctx.bumps.registry;
    let signer_seeds = &[
        b"registry".as_ref(),
        &[bump],
    ];
    let signer = &[&signer_seeds[..]];

    // let cpi_program = ctx.accounts.energy_token_program.to_account_info();
    let cpi_accounts = energy_token::cpi::accounts::MintTokensDirect {
        token_info: ctx.accounts.token_info.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        user_token_account: ctx.accounts.user_token_account.to_account_info(),
        authority: ctx.accounts.registry.to_account_info(), // Registry signs
        registry_authority: ctx.accounts.registry.to_account_info(),
        rec_validator: ctx.accounts.rec_validator.to_account_info(),
        token_program: ctx.accounts.token_program.to_account_info(),
    };

    let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.energy_token_program.key(), cpi_accounts, signer);
    energy_token::cpi::mint_tokens_direct(cpi_ctx, new_tokens_to_mint)?;
    Ok(())
}
