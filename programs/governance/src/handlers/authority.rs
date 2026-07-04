use crate::errors::GovernanceError;
use crate::events::*;
use crate::{
    ApproveAuthorityChange, CancelAuthorityChange, ProposeAuthorityChange, SetOracleAuthority,
};
use anchor_lang::prelude::*;

/// Authority change expiration period: 48 hours
pub const AUTHORITY_CHANGE_EXPIRATION: i64 = 48 * 60 * 60;

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

/// Set oracle authority for data validation
pub fn set_oracle_authority(
    ctx: Context<SetOracleAuthority>,
    oracle_authority: Pubkey,
    min_confidence: u8,
    require_validation: bool,
) -> Result<()> {
    let governance_config = &mut ctx.accounts.governance_config;
    let clock = Clock::get()?;

    // Validate confidence score
    require!(
        min_confidence <= 100,
        GovernanceError::InvalidOracleConfidence
    );

    // Update oracle configuration
    governance_config.oracle_authority = oracle_authority;
    governance_config.min_oracle_confidence = min_confidence;
    governance_config.require_oracle_validation = require_validation;
    governance_config.last_updated = clock.unix_timestamp;

    emit!(OracleAuthoritySet {
        authority: ctx.accounts.authority.key(),
        oracle_authority,
        min_confidence,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
