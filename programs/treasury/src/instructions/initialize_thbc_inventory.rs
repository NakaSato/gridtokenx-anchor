use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    Mint as MintInterface, TokenAccount as TokenAccountInterface, TokenInterface,
};

use crate::error::TreasuryError;
use crate::state::*;

#[derive(Accounts)]
pub struct InitializeThbcInventory<'info> {
    #[account(
        mut,
        seeds = [b"treasury"],
        bump,
        constraint = thbc_mint.key() == treasury.load()?.thbc_mint @ TreasuryError::UnauthorizedAuthority,
    )]
    pub treasury: AccountLoader<'info, Treasury>,

    #[account(seeds = [b"thbc_mint"], bump = treasury.load()?.thbc_mint_bump)]
    pub thbc_mint: Box<InterfaceAccount<'info, MintInterface>>,

    /// Platform-held THBC that the exchange path pays out of.
    ///
    /// A plain token account owned by the treasury PDA. Its **balance is the
    /// inventory** — there is no mirrored `thbc_inventory: u64` on `Treasury`, and
    /// that is deliberate: a mirrored counter can drift from the real balance, and
    /// the drift would be invisible until an exchange either over-paid or refused a
    /// valid one. Reading `inventory_vault.amount` cannot drift from itself.
    #[account(
        init,
        payer = authority,
        seeds = [b"thbc_inventory"],
        bump,
        token::mint = thbc_mint,
        token::authority = treasury,
        token::token_program = token_program,
    )]
    pub inventory_vault: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

/// Create the THBC inventory vault (`[b"thbc_inventory"]`) — the platform's own THBC,
/// held against the GRX↔THBC exchange path.
///
/// This vault is **funded by transfer**, never by mint: the platform buys or is issued
/// THBC like anyone else and then quotes against what it holds. Nothing in this
/// program mints into it. That is the whole of the F6 fix — with an inventory to pay
/// from, `exchange_grx_for_thbc` can transfer instead of minting, so a volatile asset
/// (GRX) never enters the backing set of a fiat-referenced token and `thbc_supply`
/// stops being a function of the exchange rate.
///
/// Admin-only. Idempotent in the sense that a second call fails at the account level
/// (`init` on an existing PDA), not silently.
pub fn initialize_thbc_inventory(ctx: Context<InitializeThbcInventory>) -> Result<()> {
    let mut t = ctx.accounts.treasury.load_mut()?;
    require!(
        t.authority == ctx.accounts.authority.key(),
        TreasuryError::UnauthorizedAuthority
    );
    t.thbc_inventory_bump = ctx.bumps.inventory_vault;
    Ok(())
}
