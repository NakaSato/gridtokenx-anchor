use crate::errors::GovernanceError;
use crate::events::*;
use crate::state::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct CancelAuthorityChange<'info> {
    #[account(
        mut,
        seeds = [b"governance_config"],
        bump,
        has_one = authority @ GovernanceError::UnauthorizedAuthority
    )]
    pub governance_config: Account<'info, GovernanceConfig>,
    pub authority: Signer<'info>,
}

/// Cancel a pending authority change
/// Can only be called by current authority
pub fn cancel_authority_change(ctx: Context<CancelAuthorityChange>) -> Result<()> {
    let governance_config = &mut ctx.accounts.governance_config;
    let clock = Clock::get()?;

    // Must have a pending authority change
    let pending = governance_config.pending_authority;
    require!(pending != Pubkey::default(), GovernanceError::NoAuthorityChangePending);

    // Clear pending state
    governance_config.pending_authority = Pubkey::default();
    governance_config.pending_authority_proposed_at = 0;
    governance_config.pending_authority_expires_at = 0;
    governance_config.last_updated = clock.unix_timestamp;

    emit!(AuthorityChangeCancelled {
        authority: ctx.accounts.authority.key(),
        cancelled_proposal: pending,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
