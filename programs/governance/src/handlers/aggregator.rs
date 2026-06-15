use crate::events::*;
use crate::{AdmitAggregator, RevokeAggregator};
use anchor_lang::prelude::*;

/// Admit an aggregator node to the PoA allow-list (current authority only).
///
/// Idempotent re-admission: if the entry already exists (was revoked), this flips it back to
/// `active` rather than failing — the account is created via `init_if_needed`.
pub fn admit_aggregator(ctx: Context<AdmitAggregator>, aggregator: Pubkey) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let entry = &mut ctx.accounts.aggregator_entry;

    let first_admission = entry.aggregator == Pubkey::default();
    if first_admission {
        entry.aggregator = aggregator;
        entry.admitted_at = now;
        entry.bump = ctx.bumps.aggregator_entry;
    }
    entry.active = true;
    entry.updated_at = now;

    emit!(AggregatorAdmitted {
        authority: ctx.accounts.authority.key(),
        aggregator,
        timestamp: now,
    });
    Ok(())
}

/// Revoke an aggregator from the allow-list (current authority only).
///
/// Keeps the PDA (audit trail) and sets `active = false`; consumers must reject inactive entries.
pub fn revoke_aggregator(ctx: Context<RevokeAggregator>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let aggregator = ctx.accounts.aggregator_entry.aggregator;
    let entry = &mut ctx.accounts.aggregator_entry;
    entry.active = false;
    entry.updated_at = now;

    emit!(AggregatorRevoked {
        authority: ctx.accounts.authority.key(),
        aggregator,
        timestamp: now,
    });
    Ok(())
}
