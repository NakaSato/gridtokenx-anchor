use crate::errors::GovernanceError;
use crate::events::*;
use crate::{ProposeAuthorityChange, ApproveAuthorityChange, CancelAuthorityChange, SetOracleAuthority};
use anchor_lang::prelude::*;

/// Authority change expiration period: 48 hours
pub const AUTHORITY_CHANGE_EXPIRATION: i64 = 48 * 60 * 60;

/// Propose a new authority (step 1 of 2-step transfer)
/// Only current authority can propose
pub fn propose_authority_change(
    ctx: Context<ProposeAuthorityChange>,
    new_authority: Pubkey,
) -> Result<()> {
    let poa_config = &mut ctx.accounts.poa_config;
    let clock = Clock::get()?;
    
    // Cannot propose if there's already a pending change
    require!(
        poa_config.pending_authority.is_none(),
        GovernanceError::AuthorityChangePending
    );
    
    // Cannot propose self as new authority
    require!(
        new_authority != poa_config.authority,
        GovernanceError::CannotTransferToSelf
    );
    
    // Set pending authority with expiration
    let expires_at = clock.unix_timestamp + AUTHORITY_CHANGE_EXPIRATION;
    poa_config.pending_authority = Some(new_authority);
    poa_config.pending_authority_proposed_at = Some(clock.unix_timestamp);
    poa_config.pending_authority_expires_at = Some(expires_at);
    poa_config.last_updated = clock.unix_timestamp;
    
    emit!(AuthorityChangeProposed {
        current_authority: ctx.accounts.authority.key(),
        proposed_authority: new_authority,
        expires_at,
        timestamp: clock.unix_timestamp,
    });
    
    msg!(
        "Authority change proposed: {} -> {} (expires in 48h)",
        poa_config.authority,
        new_authority
    );
    
    Ok(())
}

/// Approve authority change (step 2 of 2-step transfer)
/// Must be called by the NEW authority to accept
pub fn approve_authority_change(ctx: Context<ApproveAuthorityChange>) -> Result<()> {
    let poa_config = &mut ctx.accounts.poa_config;
    let clock = Clock::get()?;
    
    // Must have a pending authority change
    let pending = poa_config
        .pending_authority
        .ok_or(GovernanceError::NoAuthorityChangePending)?;
    
    // Caller must be the pending authority
    require!(
        ctx.accounts.new_authority.key() == pending,
        GovernanceError::InvalidPendingAuthority
    );
    
    // Check expiration
    if let Some(expires_at) = poa_config.pending_authority_expires_at {
        require!(
            clock.unix_timestamp < expires_at,
            GovernanceError::AuthorityChangeExpired
        );
    }
    
    // Transfer authority
    let old_authority = poa_config.authority;
    poa_config.authority = pending;
    
    // Clear pending state
    poa_config.pending_authority = None;
    poa_config.pending_authority_proposed_at = None;
    poa_config.pending_authority_expires_at = None;
    poa_config.last_updated = clock.unix_timestamp;
    
    emit!(AuthorityChangeApproved {
        old_authority,
        new_authority: pending,
        timestamp: clock.unix_timestamp,
    });
    
    msg!(
        "Authority change approved and completed: {} -> {}",
        old_authority,
        pending
    );
    
    Ok(())
}

/// Cancel a pending authority change
/// Can only be called by current authority
pub fn cancel_authority_change(ctx: Context<CancelAuthorityChange>) -> Result<()> {
    let poa_config = &mut ctx.accounts.poa_config;
    let clock = Clock::get()?;
    
    // Must have a pending authority change
    let pending = poa_config
        .pending_authority
        .ok_or(GovernanceError::NoAuthorityChangePending)?;
    
    // Clear pending state
    poa_config.pending_authority = None;
    poa_config.pending_authority_proposed_at = None;
    poa_config.pending_authority_expires_at = None;
    poa_config.last_updated = clock.unix_timestamp;
    
    emit!(AuthorityChangeCancelled {
        authority: ctx.accounts.authority.key(),
        cancelled_proposal: pending,
        timestamp: clock.unix_timestamp,
    });
    
    msg!("Authority change cancelled: {} (proposed)", pending);
    
    Ok(())
}

/// Set oracle authority for data validation
pub fn set_oracle_authority(
    ctx: Context<SetOracleAuthority>,
    oracle_authority: Pubkey,
    min_confidence: u8,
    require_validation: bool,
) -> Result<()> {
    let poa_config = &mut ctx.accounts.poa_config;
    let clock = Clock::get()?;
    
    // Validate confidence score
    require!(
        min_confidence <= 100,
        GovernanceError::InvalidOracleConfidence
    );
    
    // Update oracle configuration
    poa_config.oracle_authority = Some(oracle_authority);
    poa_config.min_oracle_confidence = min_confidence;
    poa_config.require_oracle_validation = require_validation;
    poa_config.last_updated = clock.unix_timestamp;
    
    emit!(OracleAuthoritySet {
        authority: ctx.accounts.authority.key(),
        oracle_authority,
        min_confidence,
        timestamp: clock.unix_timestamp,
    });
    
    msg!(
        "Oracle authority set: {} (min confidence: {}%, required: {})",
        oracle_authority,
        min_confidence,
        require_validation
    );
    
    Ok(())
}
