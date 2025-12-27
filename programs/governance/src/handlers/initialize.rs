use anchor_lang::prelude::*;
use crate::events::*;
use crate::InitializePoa;

pub fn handler(ctx: Context<InitializePoa>) -> Result<()> {
    let poa_config = &mut ctx.accounts.poa_config;
    let clock = Clock::get()?;
    
    // Authority Configuration
    poa_config.authority = ctx.accounts.authority.key();
    poa_config.authority_name = "REC".to_string();
    poa_config.contact_info = "engineering_erc@utcc.ac.th".to_string();
    poa_config.version = 1;
    
    // Emergency Controls
    poa_config.emergency_paused = false;
    poa_config.emergency_timestamp = None;
    poa_config.emergency_reason = None;
    poa_config.maintenance_mode = false;
    
    // ERC Certificate Configuration
    poa_config.erc_validation_enabled = true;
    poa_config.min_energy_amount = 100; // 100 kWh minimum
    poa_config.max_erc_amount = 1_000_000; // 1M kWh max per ERC
    poa_config.erc_validity_period = 31_536_000; // 1 year in seconds
    poa_config.auto_revoke_expired = false;
    poa_config.require_oracle_validation = false;
    
    // Features
    poa_config.delegation_enabled = false;
    poa_config.oracle_authority = None;
    poa_config.min_oracle_confidence = 80; // 80% confidence threshold
    poa_config.allow_certificate_transfers = false;
    
    // Statistics & Tracking
    poa_config.total_ercs_issued = 0;
    poa_config.total_ercs_validated = 0;
    poa_config.total_ercs_revoked = 0;
    poa_config.total_energy_certified = 0;
    
    // Timestamps
    poa_config.created_at = clock.unix_timestamp;
    poa_config.last_updated = clock.unix_timestamp;
    poa_config.last_erc_issued_at = None;
    
    // Multi-sig Authority Change (initialize as None)
    poa_config.pending_authority = None;
    poa_config.pending_authority_proposed_at = None;
    poa_config.pending_authority_expires_at = None;
    
    // Validate configuration
    poa_config.validate_config()?;
    
    emit!(PoAInitialized {
        authority: ctx.accounts.authority.key(),
        authority_name: "REC".to_string(),
        timestamp: clock.unix_timestamp,
    });
    
    Ok(())
}
