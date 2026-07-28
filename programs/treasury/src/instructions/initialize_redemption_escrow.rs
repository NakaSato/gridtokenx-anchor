use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    Mint as MintInterface, TokenAccount as TokenAccountInterface, TokenInterface,
};

use crate::error::TreasuryError;
use crate::state::*;

#[derive(Accounts)]
pub struct InitializeRedemptionEscrow<'info> {
    #[account(
        mut,
        seeds = [b"treasury"],
        bump,
        constraint = thbc_mint.key() == treasury.load()?.thbc_mint @ TreasuryError::UnauthorizedAuthority,
    )]
    pub treasury: AccountLoader<'info, Treasury>,

    #[account(seeds = [b"thbc_mint"], bump = treasury.load()?.thbc_mint_bump)]
    pub thbc_mint: Box<InterfaceAccount<'info, MintInterface>>,

    /// Holds THBC that users have committed to redeem but which is **not yet burned**.
    ///
    /// One shared vault rather than a token account per redemption: per-redemption
    /// accounts would cost rent and an extra `init` on every request for no benefit,
    /// since the `[b"redeem", user, seq]` record already says who owns what.
    ///
    /// Tokens sitting here are still inside `thbc_supply` — that is the point of F7.
    /// Supply falls only at `confirm_redemption`, which is precisely what leaves room
    /// for `reclaim_redemption` to give them back.
    #[account(
        init,
        payer = authority,
        seeds = [b"redeem_escrow"],
        bump,
        token::mint = thbc_mint,
        token::authority = treasury,
        token::token_program = token_program,
    )]
    pub redeem_escrow: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

/// Create the redemption escrow vault (`[b"redeem_escrow"]`). Admin-only, once.
pub fn initialize_redemption_escrow(ctx: Context<InitializeRedemptionEscrow>) -> Result<()> {
    let mut t = ctx.accounts.treasury.load_mut()?;
    require!(
        t.authority == ctx.accounts.authority.key(),
        TreasuryError::UnauthorizedAuthority
    );
    t.redeem_escrow_bump = ctx.bumps.redeem_escrow;
    Ok(())
}
