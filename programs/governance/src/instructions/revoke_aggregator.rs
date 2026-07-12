use crate::errors::GovernanceError;
use crate::events::*;
use crate::state::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct RevokeAggregator<'info> {
    #[account(
        seeds = [b"governance_config"],
        bump,
        has_one = authority @ GovernanceError::UnauthorizedAuthority
    )]
    pub governance_config: Account<'info, GovernanceConfig>,

    #[account(
        mut,
        seeds = [b"aggregator", aggregator_entry.aggregator.as_ref()],
        bump = aggregator_entry.bump
    )]
    pub aggregator_entry: Account<'info, AggregatorEntry>,

    pub authority: Signer<'info>,
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
