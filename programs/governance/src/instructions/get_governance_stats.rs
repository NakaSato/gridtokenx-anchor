use crate::state::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct GetGovernanceStats<'info> {
    #[account(
        seeds = [b"governance_config"],
        bump
    )]
    pub governance_config: Account<'info, GovernanceConfig>,
}

pub fn get_governance_stats(ctx: Context<GetGovernanceStats>) -> Result<GovernanceStats> {
    let governance_config = &ctx.accounts.governance_config;

    Ok(GovernanceStats {
        // Core statistics
        total_ercs_issued: governance_config.total_ercs_issued,
        total_ercs_validated: governance_config.total_ercs_validated,
        total_ercs_revoked: governance_config.total_ercs_revoked,
        total_energy_certified: governance_config.total_energy_certified,

        // Authority info
        authority_name: String::from_utf8_lossy(
            &governance_config.authority_name[..governance_config.name_len as usize],
        )
        .into_owned(),
        contact_info: String::from_utf8_lossy(
            &governance_config.contact_info[..governance_config.contact_len as usize],
        )
        .into_owned(),

        // Configuration
        erc_validation_enabled: governance_config.erc_validation_enabled,
        maintenance_mode: governance_config.maintenance_mode,

        // Limits
        min_energy_amount: governance_config.min_energy_amount,
        max_erc_amount: governance_config.max_erc_amount,
        erc_validity_period: governance_config.erc_validity_period,

        // Advanced features
        require_oracle_validation: governance_config.require_oracle_validation,
        allow_certificate_transfers: governance_config.allow_certificate_transfers,

        // DAO governance
        min_quorum_votes: governance_config.min_quorum_votes,

        // Timestamps
        created_at: governance_config.created_at,
        last_updated: governance_config.last_updated,
        last_erc_issued_at: governance_config.last_erc_issued_at,

        // Authority change status
        pending_authority_change: governance_config.pending_authority!= Pubkey::default(),
        pending_authority: governance_config.pending_authority,
        pending_authority_expires_at: governance_config.pending_authority_expires_at,

        // Oracle info
        oracle_authority: governance_config.oracle_authority,
        min_oracle_confidence: governance_config.min_oracle_confidence,
    })
}
