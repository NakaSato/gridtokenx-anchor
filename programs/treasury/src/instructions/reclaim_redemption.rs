use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self as token_interface, Mint as MintInterface, TokenAccount as TokenAccountInterface,
    TokenInterface, TransferChecked as TransferCheckedInterface,
};

use crate::error::TreasuryError;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
pub struct ReclaimRedemption<'info> {
    #[account(
        seeds = [b"treasury"],
        bump,
        constraint = thbc_mint.key() == treasury.load()?.thbc_mint @ TreasuryError::UnauthorizedAuthority,
    )]
    pub treasury: AccountLoader<'info, Treasury>,

    // Not `mut`: a reclaim returns escrowed tokens, it does not mint. Supply never
    // changed when they were escrowed, so there is nothing to restore.
    #[account(seeds = [b"thbc_mint"], bump = treasury.load()?.thbc_mint_bump)]
    pub thbc_mint: Box<InterfaceAccount<'info, MintInterface>>,

    #[account(mut, seeds = [b"redeem_escrow"], bump = treasury.load()?.redeem_escrow_bump)]
    pub redeem_escrow: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    /// Tokens go back where they came from — the ATA recorded at request time, not
    /// wherever the caller points now.
    #[account(mut, address = redemption.user_thbc_ata @ TreasuryError::UnauthorizedAuthority)]
    pub user_thbc_ata: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    #[account(
        mut,
        close = user,
        seeds = [b"redeem", user.key().as_ref(), &redemption.seq.to_le_bytes()],
        bump = redemption.bump,
        constraint = redemption.user == user.key() @ TreasuryError::UnauthorizedAuthority,
    )]
    pub redemption: Account<'info, RedemptionRecord>,

    /// **The holder signs.** The platform cannot reclaim on a user's behalf — doing so
    /// would need their key, which is exactly what F8 forbids. The off-chain sweep
    /// therefore reports overdue redemptions and the holder acts.
    #[account(mut)]
    pub user: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// Recover escrowed THBC after Δ with no issuer confirmation — spec §6.3. **F7.**
///
/// The guard is the timelock, not permission: any holder may call this on their own
/// record once `now - escrowed_at >= delta_secs`.
///
/// A confirmed redemption is unreachable here — `confirm_redemption` closes the record,
/// so there is nothing left to reclaim against and the runtime rejects the attempt.
/// That is stronger than a status check this program could get wrong, and it means the
/// burn and the end of the reclaim right happen in the same instant by construction.
///
/// Supply is untouched: the tokens were never burned, only moved. That asymmetry with
/// `confirm_redemption` is the whole of F7.
pub fn reclaim_redemption(ctx: Context<ReclaimRedemption>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    let (bump, amount, seq, elapsed, delta) = {
        let t = ctx.accounts.treasury.load()?;
        let r = &ctx.accounts.redemption;
        let elapsed = now.saturating_sub(r.escrowed_at);
        (t.bump, r.amount, r.seq, elapsed, r.delta_secs)
    };

    // Deliberately NOT gated on `paused`: pausing must never be able to trap a holder's
    // tokens in escrow. Pause stops new commitments (redeem_thbc_for_fiat) and the burn
    // (confirm_redemption); the escape hatch stays open.
    require!(
        elapsed >= delta,
        TreasuryError::TimelockNotExpired
    );

    let seeds: &[&[u8]] = &[b"treasury", &[bump]];
    let signer = &[seeds];
    let xfer = TransferCheckedInterface {
        from: ctx.accounts.redeem_escrow.to_account_info(),
        mint: ctx.accounts.thbc_mint.to_account_info(),
        to: ctx.accounts.user_thbc_ata.to_account_info(),
        authority: ctx.accounts.treasury.to_account_info(),
    };
    token_interface::transfer_checked(
        CpiContext::new_with_signer(ctx.accounts.token_program.key(), xfer, signer),
        amount,
        ctx.accounts.thbc_mint.decimals,
    )?;

    emit!(RedemptionReclaimed {
        user: ctx.accounts.user.key(),
        seq,
        amount,
        elapsed_secs: elapsed,
        timestamp: now,
    });
    Ok(())
}
