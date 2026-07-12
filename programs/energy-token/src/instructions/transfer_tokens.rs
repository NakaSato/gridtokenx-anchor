use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self as token_interface, Mint as MintInterface, TokenAccount as TokenAccountInterface,
    TokenInterface, TransferChecked as TransferCheckedInterface,
};

#[cfg(feature = "localnet")]
use compute_debug::compute_checkpoint;
#[cfg(not(feature = "localnet"))]
use crate::compute_checkpoint;

#[derive(Accounts)]
pub struct TransferTokens<'info> {
    #[account(mut)]
    pub from_token_account: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    #[account(mut)]
    pub to_token_account: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    pub mint: InterfaceAccount<'info, MintInterface>,

    pub from_authority: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// Transfer energy tokens between accounts
pub fn transfer_tokens(ctx: Context<TransferTokens>, amount: u64) -> Result<()> {
    let cpi_accounts = TransferCheckedInterface {
        from: ctx.accounts.from_token_account.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.to_token_account.to_account_info(),
        authority: ctx.accounts.from_authority.to_account_info(),
    };

    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts);

    compute_checkpoint!("before_transfer_cpi");
    token_interface::transfer_checked(cpi_ctx, amount, 9)?;
    compute_checkpoint!("after_transfer_cpi");
    // Logging disabled to save CU
    Ok(())
}
