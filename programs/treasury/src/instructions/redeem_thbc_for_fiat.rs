use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self as token_interface, Mint as MintInterface, TokenAccount as TokenAccountInterface,
    TokenInterface, TransferChecked as TransferCheckedInterface,
};

use crate::error::TreasuryError;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
#[instruction(amount: u64, seq: u64)]
pub struct RedeemThbcForFiat<'info> {
    #[account(
        seeds = [b"treasury"],
        bump,
        constraint = thbc_mint.key() == treasury.load()?.thbc_mint @ TreasuryError::UnauthorizedAuthority,
    )]
    pub treasury: AccountLoader<'info, Treasury>,

    // Not `mut`: nothing is minted or burned here. The tokens move into escrow and
    // `thbc_supply` is deliberately unchanged — see the handler doc.
    #[account(seeds = [b"thbc_mint"], bump = treasury.load()?.thbc_mint_bump)]
    pub thbc_mint: Box<InterfaceAccount<'info, MintInterface>>,

    #[account(mut, seeds = [b"redeem_escrow"], bump = treasury.load()?.redeem_escrow_bump)]
    pub redeem_escrow: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    #[account(mut, token::mint = thbc_mint, token::authority = user)]
    pub user_thbc_ata: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    /// The pending-redemption record. Its existence IS the queue entry; both terminal
    /// instructions `close` it, so a completed redemption cannot be re-processed.
    #[account(
        init,
        payer = user,
        space = 8 + RedemptionRecord::LEN,
        seeds = [b"redeem", user.key().as_ref(), &seq.to_le_bytes()],
        bump,
    )]
    pub redemption: Account<'info, RedemptionRecord>,

    /// **The user signs.** `B` cannot redeem on a holder's behalf — that is the whole
    /// point of spec §6.1 step 1, and it is why F8 survives this instruction.
    #[account(mut)]
    pub user: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

/// Commit THBC to a fiat redemption — spec §6.1 steps 1–2. **F7.**
///
/// # Why this escrows instead of burning
///
/// The naive off-ramp burns immediately and trusts the issuer to wire. Steps 1–2 are
/// then irreversible and on-chain while steps 4–5 are a promise: if `B` declines, the
/// holder has destroyed their token and received nothing.
///
/// So the amount moves into `[b"redeem_escrow"]` and stays inside `thbc_supply`.
/// `confirm_redemption` burns it once the wire is out; `reclaim_redemption` gives it
/// back if Δ passes without a confirmation. The holder is then no worse off than
/// before, and `B`'s failure is visible on-chain because the record is still open.
///
/// # What this does NOT solve
///
/// The escrow protects the *token* side only. If `B` takes the fiat and never wires,
/// the holder recovers their THBC but the reserve is short and F1 breaks at the next
/// honest attestation. That is fair exchange between an on-chain action and an
/// off-chain one, which has a known impossibility result without a trusted third
/// party — spec §6.4. Not a bug in this instruction.
pub fn redeem_thbc_for_fiat(ctx: Context<RedeemThbcForFiat>, amount: u64, seq: u64) -> Result<()> {
    require!(amount > 0, TreasuryError::ZeroAmount);
    let now = Clock::get()?.unix_timestamp;

    {
        let t = ctx.accounts.treasury.load()?;
        require!(t.paused == 0, TreasuryError::Paused);
        require!(
            t.redeem_escrow_bump != 0,
            TreasuryError::RedemptionEscrowNotInitialized
        );
    }

    // User -> escrow. The token program bounds this by the user's balance.
    let xfer = TransferCheckedInterface {
        from: ctx.accounts.user_thbc_ata.to_account_info(),
        mint: ctx.accounts.thbc_mint.to_account_info(),
        to: ctx.accounts.redeem_escrow.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    token_interface::transfer_checked(
        CpiContext::new(ctx.accounts.token_program.key(), xfer),
        amount,
        ctx.accounts.thbc_mint.decimals,
    )?;

    let r = &mut ctx.accounts.redemption;
    r.user = ctx.accounts.user.key();
    r.amount = amount;
    r.user_thbc_ata = ctx.accounts.user_thbc_ata.key();
    r.escrowed_at = now;
    // Δ is frozen per-record: a later change to REDEMPTION_DELTA_SECS must never extend
    // an in-flight holder's wait.
    r.delta_secs = REDEMPTION_DELTA_SECS;
    r.seq = seq;
    r.bump = ctx.bumps.redemption;

    emit!(RedemptionEscrowed {
        user: ctx.accounts.user.key(),
        seq,
        amount,
        reclaimable_at: now.saturating_add(REDEMPTION_DELTA_SECS),
        timestamp: now,
    });
    Ok(())
}
