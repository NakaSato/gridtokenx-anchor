use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{
        self as token_interface, Mint as MintInterface, TokenAccount as TokenAccountInterface,
        TokenInterface,
    },
};

use crate::error::EnergyTokenError;
use crate::events::*;
use crate::rec_validator_registered;
use crate::state::*;

#[cfg(feature = "localnet")]
use compute_debug::compute_checkpoint;
#[cfg(not(feature = "localnet"))]
use crate::compute_checkpoint;

#[derive(Accounts)]
#[instruction(meter_id: [u8; 16], window_start_ms: i64)]
pub struct MintGeneration<'info> {
    #[account(
        mut,
        constraint = mint.key() == token_info.load()?.mint @ EnergyTokenError::UnauthorizedAuthority,
    )]
    pub mint: InterfaceAccount<'info, MintInterface>,

    #[account(
        seeds = [b"token_info_2022"],
        bump,
        constraint = token_info.load()?.authority == authority.key() @ EnergyTokenError::UnauthorizedAuthority,
    )]
    pub token_info: AccountLoader<'info, TokenInfo>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = destination_owner,
        token::token_program = token_program,
    )]
    pub destination: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    /// CHECK: The owner of the destination token account
    pub destination_owner: UncheckedAccount<'info>,

    /// Per-(meter, window) idempotency guard. `init_if_needed` so the first mint
    /// creates it and a replay finds it already present; the `minted` flag (checked
    /// in the handler before any mint) makes re-entry a no-op, closing the standard
    /// init_if_needed re-init footgun.
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + GenerationMintRecord::LEN,
        seeds = [b"gen_mint", meter_id.as_ref(), &window_start_ms.to_le_bytes()],
        bump,
    )]
    pub mint_record: Account<'info, GenerationMintRecord>,

    pub authority: Signer<'info>,

    /// REC validator co-signer — MANDATORY: must be a registered REC validator. Typed as
    /// Option so a missing co-signer surfaces as RecValidatorNotFound rather than a coarse
    /// "account not enough keys"; the handler rejects None and any non-registered key.
    pub rec_validator: Option<Signer<'info>>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Idempotent generation mint, keyed by `(meter_id, window_start_ms)`.
///
/// Identical mint semantics to [`mint_to_wallet`] (authority + REC-validator
/// checks, Token-2022 `mint_to` CPI), but gated on a per-window
/// [`GenerationMintRecord`] PDA. The Aggregator Bridge calls this once per
/// settlement window; if the same window is replayed (crash between submit and
/// eviction, or a Redis outage that defeated the bridge's `MINTED_SET` guard),
/// the record already exists with `minted == true` and the call short-circuits
/// to a no-op success — no second mint. This is the authoritative exactly-once
/// guard; the bridge-side marker is only a fast path.
///
/// Per-instruction (not per-transaction) so a replayed recipient batched with
/// fresh ones no-ops without aborting the whole transaction and starving its
/// chunk-mates.
pub fn mint_generation(
    ctx: Context<MintGeneration>,
    meter_id: [u8; 16],
    window_start_ms: i64,
    amount: u64,
) -> Result<()> {
    // Idempotency: this (meter, window) already minted — no-op success.
    // Must be the first check so a replay never re-runs the mint CPI.
    if ctx.accounts.mint_record.minted {
        return Ok(());
    }

    // Reject a zero-amount mint: mint_to(_, 0) is a silent no-op that would
    // still stamp `minted = true` below, permanently poisoning this window so
    // the real generation mint can never run. Guard before any state write.
    require!(amount > 0, EnergyTokenError::ZeroAmount);

    let now = Clock::get()?.unix_timestamp;

    // Window-unit reconciliation: the off-chain node aligns 15-min windows to
    // wall-clock (oracle checks `epoch % 900 == 0` in *seconds*). This PDA keys on
    // `window_start_ms` (*milliseconds*), so enforce the same boundary in ms:
    // 900 s = 900_000 ms. Also upper-bound it: a settlement window cannot start in
    // the future, so reject any window_start_ms past now + one window (defense in
    // depth — the bridge already validates; this stops a buggy/hostile future
    // window on-chain). Rejects unaligned/garbage windows before minting.
    require!(
        window_start_ms > 0
            && window_start_ms % 900_000 == 0
            && window_start_ms / 1000 <= now + 900,
        EnergyTokenError::MisalignedWindow
    );

    {
        let token_info = ctx.accounts.token_info.load()?;
        require!(
            token_info.authority == ctx.accounts.authority.key(),
            EnergyTokenError::UnauthorizedAuthority
        );

        // REC provenance (mandatory — no opt-out): every generation mint must be
        // co-signed by a registered REC validator. A fresh token cannot mint until a
        // validator is registered (count == 0 => no key registered => rejected).
        let rec_key = ctx
            .accounts
            .rec_validator
            .as_ref()
            .map(|v| v.key())
            .ok_or(EnergyTokenError::RecValidatorNotFound)?;
        require!(
            rec_validator_registered(&token_info, &rec_key),
            EnergyTokenError::RecValidatorNotFound
        );

        // Two-party control: the REC validator co-signer must be a DIFFERENT key
        // from the platform authority, else one signer satisfies both gates and
        // the mandatory co-sign collapses from 2-of-2 to 1-of-1.
        require!(
            rec_key != ctx.accounts.authority.key(),
            EnergyTokenError::RecValidatorIsAuthority
        );
    }

    let cpi_accounts = token_interface::MintTo {
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.destination.to_account_info(),
        authority: ctx.accounts.token_info.to_account_info(),
    };
    let seeds = &[b"token_info_2022".as_ref(), &[ctx.bumps.token_info]];
    let signer = &[&seeds[..]];
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        cpi_accounts,
        signer,
    );

    compute_checkpoint!("before_mint_cpi");
    token_interface::mint_to(cpi_ctx, amount)?;
    compute_checkpoint!("after_mint_cpi");

    // Stamp the record only AFTER a successful mint, so a failed mint leaves
    // the window un-minted and retryable (the account exists with
    // minted == false; the next attempt re-runs the CPI).
    let record = &mut ctx.accounts.mint_record;
    record.meter_id = meter_id;
    record.window_start_ms = window_start_ms;
    record.amount = amount;
    record.minted = true;
    record.bump = ctx.bumps.mint_record;

    emit!(TokensMinted {
        recipient: ctx.accounts.destination.key(),
        amount,
        timestamp: now,
    });
    Ok(())
}
