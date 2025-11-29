use anchor_lang::prelude::*;
use crate::state::*;
use crate::GetGovernanceStats;

pub fn handler(ctx: Context<GetGovernanceStats>) -> Result<GovernanceStats> {
    let poa_config = &ctx.accounts.poa_config;
    
    Ok(GovernanceStats {
        // Core statistics
        total_ercs_issued: poa_config.total_ercs_issued,
        total_ercs_validated: poa_config.total_ercs_validated,
        total_ercs_revoked: poa_config.total_ercs_revoked,
        total_energy_certified: poa_config.total_energy_certified,
        
        // Configuration
        erc_validation_enabled: poa_config.erc_validation_enabled,
        emergency_paused: poa_config.emergency_paused,
        maintenance_mode: poa_config.maintenance_mode,
        
        // Limits
        min_energy_amount: poa_config.min_energy_amount,
        max_erc_amount: poa_config.max_erc_amount,
        erc_validity_period: poa_config.erc_validity_period,
        
        // Advanced features
        require_oracle_validation: poa_config.require_oracle_validation,
        allow_certificate_transfers: poa_config.allow_certificate_transfers,
        delegation_enabled: poa_config.delegation_enabled,
        
        // Timestamps
        created_at: poa_config.created_at,
        last_updated: poa_config.last_updated,
        last_erc_issued_at: poa_config.last_erc_issued_at,
        
        // NEW: Authority change status
        pending_authority_change: poa_config.pending_authority.is_some(),
        pending_authority: poa_config.pending_authority,
        pending_authority_expires_at: poa_config.pending_authority_expires_at,
        
        // NEW: Oracle info
        oracle_authority: poa_config.oracle_authority,
        min_oracle_confidence: poa_config.min_oracle_confidence,
    })
}
