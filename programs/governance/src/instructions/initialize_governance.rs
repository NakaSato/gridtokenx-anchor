use crate::events::*;
use crate::state::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct InitializeGovernance<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + GovernanceConfig::LEN,
        seeds = [b"governance_config"],
        bump
    )]
    pub governance_config: Account<'info, GovernanceConfig>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_governance(ctx: Context<InitializeGovernance>) -> Result<()> {
    let governance_config = &mut ctx.accounts.governance_config;
    let clock = Clock::get()?;

    // Authority Configuration
    governance_config.authority = ctx.accounts.authority.key();

    // Set fixed-size strings
    let mut name_bytes = [0u8; 64];
    let name = "REC".as_bytes();
    name_bytes[..name.len()].copy_from_slice(name);
    governance_config.authority_name = name_bytes;
    governance_config.name_len = name.len() as u8;

    let mut contact_bytes = [0u8; 128];
    let contact = "engineering_erc@utcc.ac.th".as_bytes();
    contact_bytes[..contact.len()].copy_from_slice(contact);
    governance_config.contact_info = contact_bytes;
    governance_config.contact_len = contact.len() as u8;

    // Set version
    governance_config.version = 1;

    // Controls
    governance_config.maintenance_mode = false;

    // ERC Certificate Configuration
    governance_config.erc_validation_enabled = true;
    governance_config.min_energy_amount = 100; // 100 kWh minimum
    governance_config.max_erc_amount = 1_000_000; // 1M kWh max per ERC
    governance_config.erc_validity_period = 31_536_000; // 1 year in seconds
    governance_config.require_oracle_validation = false;

    // Features
    governance_config.oracle_authority = Pubkey::default();
    governance_config.min_oracle_confidence = 80; // 80% confidence threshold
    governance_config.allow_certificate_transfers = true;

    // DAO Governance
    governance_config.min_quorum_votes = 100; // Minimum 1 meter's base weight

    // Tracking
    governance_config.total_ercs_issued = 0;
    governance_config.total_ercs_validated = 0;
    governance_config.total_ercs_revoked = 0;
    governance_config.total_energy_certified = 0;

    // Timestamps
    governance_config.created_at = clock.unix_timestamp;
    governance_config.last_updated = clock.unix_timestamp;
    governance_config.last_erc_issued_at = 0;

    // Multi-sig Authority Change (initialize as None)
    governance_config.pending_authority = Pubkey::default();
    governance_config.pending_authority_proposed_at = 0;
    governance_config.pending_authority_expires_at = 0;

    // Reserved padding
    governance_config._reserved = [0u8; 5];

    // Validate configuration
    governance_config.validate_config()?;

    emit!(GovernanceInitialized {
        authority: ctx.accounts.authority.key(),
        authority_name: "REC".to_string(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
