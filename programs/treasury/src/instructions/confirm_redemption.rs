use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self as token_interface, Burn as BurnInterface, Mint as MintInterface,
    TokenAccount as TokenAccountInterface, TokenInterface,
};

use crate::error::TreasuryError;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
pub struct ConfirmRedemption<'info> {
    #[account(
        mut,
        seeds = [b"treasury"],
        bump,
        constraint = thbc_mint.key() == treasury.load()?.thbc_mint @ TreasuryError::UnauthorizedAuthority,
    )]
    pub treasury: AccountLoader<'info, Treasury>,

    #[account(mut, seeds = [b"thbc_mint"], bump = treasury.load()?.thbc_mint_bump)]
    pub thbc_mint: Box<InterfaceAccount<'info, MintInterface>>,

    #[account(mut, seeds = [b"redeem_escrow"], bump = treasury.load()?.redeem_escrow_bump)]
    pub redeem_escrow: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    /// Closed on success, with rent returned to the holder who paid it. Closing is what
    /// makes a double-confirm impossible: there is no account left to confirm against,
    /// and the runtime says so before any code here runs.
    #[account(
        mut,
        close = user,
        seeds = [b"redeem", redemption.user.as_ref(), &redemption.seq.to_le_bytes()],
        bump = redemption.bump,
        constraint = redemption.user == user.key() @ TreasuryError::UnauthorizedAuthority,
    )]
    pub redemption: Account<'info, RedemptionRecord>,

    /// CHECK: the holder, validated against `redemption.user` above. Receives the
    /// record's rent back; does not sign, because confirmation is the issuer's action.
    #[account(mut)]
    pub user: UncheckedAccount<'info>,

    /// The licensed issuer partner `B`, after the THB wire is out.
    ///
    /// Gated on `Treasury.authority` for the same reason as `issue_thbc`: a dedicated
    /// `issuer` Pubkey does not fit in the remaining padding. Disclosed, not hidden.
    pub issuer: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// Burn an escrowed redemption once the fiat has been wired — spec §6.1 step 5. **F7.**
///
/// This is the ONLY place `thbc_supply` decreases, and it is the point of no return for
/// the holder: after this there is no record to reclaim against.
///
/// # Ordering
///
/// Off-chain, F4 requires the burn to be CONFIRMED before the payout is enqueued. That
/// ordering lives in the issuer's state machine, not here — this instruction cannot
/// observe whether a wire happened. What it does guarantee is the other half: no THBC
/// leaves supply without the issuer signing for it, and the holder's reclaim right ends
/// at exactly the same instant the tokens are destroyed, never before.
pub fn confirm_redemption(ctx: Context<ConfirmRedemption>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    let (bump, amount, seq, user, new_supply) = {
        let t = ctx.accounts.treasury.load()?;
        require!(t.paused == 0, TreasuryError::Paused);
        require!(
            t.authority == ctx.accounts.issuer.key(),
            TreasuryError::UnauthorizedAuthority
        );
        let r = &ctx.accounts.redemption;
        let new_supply = t
            .thbc_supply
            .checked_sub(r.amount)
            .ok_or(TreasuryError::SupplyUnderflow)?;
        (t.bump, r.amount, r.seq, r.user, new_supply)
    };

    // Burn out of the escrow vault, signed by the treasury PDA.
    let seeds: &[&[u8]] = &[b"treasury", &[bump]];
    let signer = &[seeds];
    let burn = BurnInterface {
        mint: ctx.accounts.thbc_mint.to_account_info(),
        from: ctx.accounts.redeem_escrow.to_account_info(),
        authority: ctx.accounts.treasury.to_account_info(),
    };
    token_interface::burn(
        CpiContext::new_with_signer(ctx.accounts.token_program.key(), burn, signer),
        amount,
    )?;

    ctx.accounts.treasury.load_mut()?.thbc_supply = new_supply;

    emit!(RedemptionConfirmed {
        user,
        seq,
        amount,
        thbc_supply: new_supply,
        timestamp: now,
    });
    Ok(())
}
