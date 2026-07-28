use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self as token_interface, Mint as MintInterface, MintTo as MintToInterface,
    TokenAccount as TokenAccountInterface, TokenInterface,
};

use crate::compute_issue_thbc;
use crate::error::TreasuryError;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
#[instruction(amount: u64, bank_ref_hash: [u8; 32])]
pub struct IssueThbc<'info> {
    #[account(
        mut,
        seeds = [b"treasury"],
        bump,
        constraint = thbc_mint.key() == treasury.load()?.thbc_mint @ TreasuryError::UnauthorizedAuthority,
    )]
    pub treasury: AccountLoader<'info, Treasury>,

    #[account(mut, seeds = [b"thbc_mint"], bump = treasury.load()?.thbc_mint_bump)]
    pub thbc_mint: Box<InterfaceAccount<'info, MintInterface>>,

    #[account(mut, token::mint = thbc_mint)]
    pub beneficiary_thbc_ata: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    /// **F3.** `init` here is the entire guarantee: a replayed `bank_ref` makes the
    /// Solana runtime reject the instruction because the account already exists —
    /// before a single line of this program runs. Because it is in the *same*
    /// instruction as the mint, the two either both happen or neither does.
    ///
    /// Creating this in a separate transaction would not implement F3: the window
    /// between the two is exactly where a double-issue lives.
    #[account(
        init,
        payer = issuer,
        space = 8 + DepositNullifier::LEN,
        seeds = [b"deposit", bank_ref_hash.as_ref()],
        bump,
    )]
    pub deposit_nullifier: Account<'info, DepositNullifier>,

    /// The licensed issuer partner `B`.
    ///
    /// **Currently checked against `Treasury.authority`, not a dedicated `issuer`
    /// key.** Spec §4.2 wants them distinct; a `Pubkey` is 32 bytes and only 14 spare
    /// padding bytes remain on the zero-copy `Treasury`, so a separate field needs a
    /// layout change and a re-init. Conflating them means the parameter admin can
    /// issue — a real weakening of the §3 actor separation, disclosed rather than
    /// hidden, and the first thing the next layout change should fix.
    #[account(mut)]
    pub issuer: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

/// Mint THBC against fiat received — the on-ramp (spec §5).
///
/// This is the **only** instruction in the program that increases `thbc_supply`, and
/// therefore the only place F1 and F5 can be enforced. Both guards previously lived on
/// `swap_grx_for_thbc`; when the F6 fix removed that instruction they became
/// unreachable, and this restores them to the instruction they actually belong to.
///
/// Order of checks matters and is the order of spec §5.2:
///
/// 1. **F5 first** — a stale `attested_reserve` makes the F1 comparison meaningless
///    rather than merely conservative, so freshness is checked before the ceiling.
/// 2. **F1 second** — `thbc_supply + amount ≤ attested_reserve`.
/// 3. **F3 throughout** — enforced by the runtime at account creation, not by code
///    here.
///
/// # What this still does not enforce
///
/// F1 is checked against `attested_reserve`, **not** `attested_reserve −
/// reserve_encumbered` as §4.1 specifies, because `reserve_encumbered` is not a field
/// on `Treasury` (same 32-byte padding problem as `issuer`). Fiat that cleared the bank
/// and then failed KYC therefore still counts as free backing on-chain. The off-chain
/// service enforces the tighter ceiling from its own records and is consequently
/// *stricter than the chain*; a caller that bypasses it gets this looser one.
pub fn issue_thbc(ctx: Context<IssueThbc>, amount: u64, bank_ref_hash: [u8; 32]) -> Result<()> {
    require!(amount > 0, TreasuryError::ZeroAmount);
    let now = Clock::get()?.unix_timestamp;

    let (bump, new_supply) = {
        let t = ctx.accounts.treasury.load()?;
        require!(t.paused == 0, TreasuryError::Paused);
        require!(
            t.authority == ctx.accounts.issuer.key(),
            TreasuryError::UnauthorizedAuthority
        );

        // F5 then F1.
        let new_supply = compute_issue_thbc(
            amount,
            t.thbc_supply,
            t.attested_reserve,
            now,
            t.attestation_ts,
            t.attestation_ttl,
        )?;

        (t.bump, new_supply)
    };

    let seeds: &[&[u8]] = &[b"treasury", &[bump]];
    let signer = &[seeds];
    let mint_to = MintToInterface {
        mint: ctx.accounts.thbc_mint.to_account_info(),
        to: ctx.accounts.beneficiary_thbc_ata.to_account_info(),
        authority: ctx.accounts.treasury.to_account_info(),
    };
    token_interface::mint_to(
        CpiContext::new_with_signer(ctx.accounts.token_program.key(), mint_to, signer),
        amount,
    )?;

    ctx.accounts.treasury.load_mut()?.thbc_supply = new_supply;

    // Contents are evidence; the account's existence is the invariant.
    let nullifier = &mut ctx.accounts.deposit_nullifier;
    nullifier.bank_ref_hash = bank_ref_hash;
    nullifier.amount = amount;
    nullifier.beneficiary = ctx.accounts.beneficiary_thbc_ata.key();
    nullifier.issued_at = now;
    nullifier.bump = ctx.bumps.deposit_nullifier;

    emit!(ThbcIssued {
        beneficiary: ctx.accounts.beneficiary_thbc_ata.key(),
        amount,
        bank_ref_hash,
        thbc_supply: new_supply,
        timestamp: now,
    });
    Ok(())
}
