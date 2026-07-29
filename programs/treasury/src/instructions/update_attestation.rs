use anchor_lang::prelude::*;

use crate::error::TreasuryError;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
pub struct UpdateAttestation<'info> {
    #[account(mut, seeds = [b"treasury"], bump)]
    pub treasury: AccountLoader<'info, Treasury>,
    pub attestor: Signer<'info>,
}

/// Custodian: refresh the off-chain THB reserve figure that caps THBC supply.
/// This is the peg's source of truth — mints are blocked once it goes stale.
///
/// `reserve_encumbered` is reported in the SAME call on purpose (F1, spec §4.1). It is
/// the fiat that cleared the bank but is not issuable — failed or pending KYC — and the
/// peg ceiling is `attested_reserve − reserve_encumbered`. Splitting it into its own
/// setter would allow a fresh reserve to land on-chain alongside a stale encumbrance,
/// and that gap is exactly the over-issuance the field exists to prevent.
///
/// Passing `0` reproduces the old behaviour exactly, which is also what every Treasury
/// initialized before this field existed already reads (the bytes were zeroed padding).
pub fn update_attestation(
    ctx: Context<UpdateAttestation>,
    attested_reserve: u64,
    reserve_encumbered: u64,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let mut t = ctx.accounts.treasury.load_mut()?;
    require!(t.attestor == ctx.accounts.attestor.key(), TreasuryError::UnauthorizedAttestor);
    t.attested_reserve = attested_reserve;
    t.reserve_encumbered = reserve_encumbered;
    t.attestation_ts = now;
    emit!(ReserveAttested {
        attestor: ctx.accounts.attestor.key(),
        attested_reserve,
        reserve_encumbered,
        timestamp: now,
    });
    Ok(())
}
