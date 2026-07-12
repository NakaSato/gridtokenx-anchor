use crate::errors::GovernanceError;
use crate::events::*;
use crate::state::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct SetOracleAuthority<'info> {
    #[account(
        mut,
        seeds = [b"governance_config"],
        bump,
        has_one = authority @ GovernanceError::UnauthorizedAuthority
    )]
    pub governance_config: Account<'info, GovernanceConfig>,
    pub authority: Signer<'info>,
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
