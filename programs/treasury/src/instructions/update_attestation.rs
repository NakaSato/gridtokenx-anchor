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
pub fn update_attestation(ctx: Context<UpdateAttestation>, attested_reserve: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let mut t = ctx.accounts.treasury.load_mut()?;
    require!(t.attestor == ctx.accounts.attestor.key(), TreasuryError::UnauthorizedAttestor);
    t.attested_reserve = attested_reserve;
    t.attestation_ts = now;
    emit!(ReserveAttested {
        attestor: ctx.accounts.attestor.key(),
        attested_reserve,
        timestamp: now,
    });
    Ok(())
}
