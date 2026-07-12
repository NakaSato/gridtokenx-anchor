use crate::errors::GovernanceError;
use crate::events::*;
use crate::state::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct ApproveAuthorityChange<'info> {
    #[account(
        mut,
        seeds = [b"governance_config"],
        bump
    )]
    pub governance_config: Account<'info, GovernanceConfig>,
    /// The proposed new authority who must sign to approve
    pub new_authority: Signer<'info>,
}

/// Approve pending authority change (step 2 of 2-step transfer)
/// Must be called by the pending authority
pub fn approve_authority_change(ctx: Context<ApproveAuthorityChange>) -> Result<()> {
    let governance_config = &mut ctx.accounts.governance_config;
    let clock = Clock::get()?;

    // Must have a pending authority change
    let pending = governance_config.pending_authority;
    require!(pending != Pubkey::default(), GovernanceError::NoAuthorityChangePending);

    // Caller must be the pending authority
    require!(
        ctx.accounts.new_authority.key() == pending,
        GovernanceError::InvalidPendingAuthority
    );

    // Check expiration
    let expires_at = governance_config.pending_authority_expires_at;
    if expires_at > 0 {
        require!(
            clock.unix_timestamp < expires_at,
            GovernanceError::AuthorityChangeExpired
        );
    }

    // Transfer authority
    let old_authority = governance_config.authority;
    governance_config.authority = pending;

    // Clear pending state
    governance_config.pending_authority = Pubkey::default();
    governance_config.pending_authority_proposed_at = 0;
    governance_config.pending_authority_expires_at = 0;
    governance_config.last_updated = clock.unix_timestamp;

    emit!(AuthorityChangeApproved {
        old_authority,
        new_authority: pending,
        timestamp: clock.unix_timestamp,
    });

    // Logging disabled to save CU - use events instead

    Ok(())
}
