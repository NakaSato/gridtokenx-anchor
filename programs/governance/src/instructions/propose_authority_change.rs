use crate::errors::GovernanceError;
use crate::events::*;
use crate::state::*;
use anchor_lang::prelude::*;

/// Authority change expiration period: 48 hours
pub const AUTHORITY_CHANGE_EXPIRATION: i64 = 48 * 60 * 60;

#[derive(Accounts)]
pub struct ProposeAuthorityChange<'info> {
    #[account(
        mut,
        seeds = [b"governance_config"],
        bump,
        has_one = authority @ GovernanceError::UnauthorizedAuthority
    )]
    pub governance_config: Account<'info, GovernanceConfig>,
    pub authority: Signer<'info>,
}

/// Propose a new authority (step 1 of 2-step transfer)
/// Only current authority can propose
pub fn propose_authority_change(
    ctx: Context<ProposeAuthorityChange>,
    new_authority: Pubkey,
) -> Result<()> {
    let governance_config = &mut ctx.accounts.governance_config;
    let clock = Clock::get()?;

    // Cannot propose if there's already a pending change
    require!(
        governance_config.pending_authority == Pubkey::default(),
        GovernanceError::AuthorityChangePending
    );

    // Cannot propose self as new authority
    require!(
        new_authority != governance_config.authority,
        GovernanceError::CannotTransferToSelf
    );

    // Set pending authority with expiration
    let expires_at = clock.unix_timestamp + AUTHORITY_CHANGE_EXPIRATION;
    governance_config.pending_authority = new_authority;
    governance_config.pending_authority_proposed_at = clock.unix_timestamp;
    governance_config.pending_authority_expires_at = expires_at;
    governance_config.last_updated = clock.unix_timestamp;

    emit!(AuthorityChangeProposed {
        current_authority: ctx.accounts.authority.key(),
        proposed_authority: new_authority,
        expires_at,
        timestamp: clock.unix_timestamp,
    });

    // Logging disabled to save CU - use events instead

    Ok(())
}
