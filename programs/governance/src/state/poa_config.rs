use anchor_lang::prelude::*;
use crate::errors::GovernanceError;

#[account]
pub struct PoAConfig {
    // === Authority Configuration ===
    /// Single authority - REC certifying entity
    pub authority: Pubkey,
    /// Authority name (e.g., "REC")
    pub authority_name: String,
    /// Authority contact information
    pub contact_info: String,
    /// Governance version for upgrades
    pub version: u8,
    
    // === Emergency Controls ===
    /// Emergency pause status
    pub emergency_paused: bool,
    /// Emergency pause timestamp
    pub emergency_timestamp: Option<i64>,
    /// Emergency pause reason
    pub emergency_reason: Option<String>,
    /// System maintenance mode
    pub maintenance_mode: bool,
    
    // === ERC Certificate Configuration ===
    /// Whether ERC validation is enabled
    pub erc_validation_enabled: bool,
    /// Minimum energy amount for ERC issuance (kWh)
    pub min_energy_amount: u64,
    /// Maximum ERC amount per certificate (kWh)
    pub max_erc_amount: u64,
    /// ERC certificate validity period (seconds)
    pub erc_validity_period: i64,
    /// Auto-revoke expired certificates
    pub auto_revoke_expired: bool,
    /// Require oracle validation for ERC issuance
    pub require_oracle_validation: bool,
    
    // === Advanced Features ===
    /// Whether the authority can delegate ERC validation
    pub delegation_enabled: bool,
    /// Oracle authority for AMI data validation
    pub oracle_authority: Option<Pubkey>,
    /// Minimum confidence score for oracle validation (0-100)
    pub min_oracle_confidence: u8,
    /// Allow certificate transfers between accounts
    pub allow_certificate_transfers: bool,
    
    // === Statistics & Tracking ===
    /// Total ERCs issued since inception
    pub total_ercs_issued: u64,
    /// Total ERCs validated for trading
    pub total_ercs_validated: u64,
    /// Total ERCs revoked
    pub total_ercs_revoked: u64,
    /// Total energy certified (kWh)
    pub total_energy_certified: u64,
    
    // === Timestamps ===
    /// When governance was initialized
    pub created_at: i64,
    /// Last configuration update
    pub last_updated: i64,
    /// Last ERC issued timestamp
    pub last_erc_issued_at: Option<i64>,
    
    // === NEW: Multi-sig Authority Change ===
    /// Pending new authority (for 2-step transfer)
    pub pending_authority: Option<Pubkey>,
    /// When the pending authority change was proposed
    pub pending_authority_proposed_at: Option<i64>,
    /// When the pending authority change expires (48 hours)
    pub pending_authority_expires_at: Option<i64>,
}

impl PoAConfig {
    pub const LEN: usize = 
        // Authority Configuration
        32 +    // authority
        64 +    // authority_name
        128 +   // contact_info
        1 +     // version
        
        // Emergency Controls
        1 +     // emergency_paused
        9 +     // emergency_timestamp (Option<i64>)
        132 +   // emergency_reason (Option<String>)
        1 +     // maintenance_mode
        
        // ERC Certificate Configuration
        1 +     // erc_validation_enabled
        8 +     // min_energy_amount
        8 +     // max_erc_amount
        8 +     // erc_validity_period
        1 +     // auto_revoke_expired
        1 +     // require_oracle_validation
        
        // Advanced Features
        1 +     // delegation_enabled
        33 +    // oracle_authority (Option<Pubkey>)
        1 +     // min_oracle_confidence
        1 +     // allow_certificate_transfers
        
        // Statistics & Tracking
        8 +     // total_ercs_issued
        8 +     // total_ercs_validated
        8 +     // total_ercs_revoked
        8 +     // total_energy_certified
        
        // Timestamps
        8 +     // created_at
        8 +     // last_updated
        9 +     // last_erc_issued_at (Option<i64>)
        
        // Multi-sig Authority Change
        33 +    // pending_authority (Option<Pubkey>)
        9 +     // pending_authority_proposed_at (Option<i64>)
        9;      // pending_authority_expires_at (Option<i64>)
    
    /// Validate that config parameters are within acceptable ranges
    pub fn validate_config(&self) -> Result<()> {
        require!(
            self.min_energy_amount > 0,
            GovernanceError::InvalidMinimumEnergy
        );
        require!(
            self.max_erc_amount > self.min_energy_amount,
            GovernanceError::InvalidMaximumEnergy
        );
        require!(
            self.erc_validity_period > 0 && self.erc_validity_period <= 31_536_000 * 2, // Max 2 years
            GovernanceError::InvalidValidityPeriod
        );
        require!(
            self.min_oracle_confidence <= 100,
            GovernanceError::InvalidOracleConfidence
        );
        Ok(())
    }
    
    /// Check if system is operational (not paused or in maintenance)
    pub fn is_operational(&self) -> bool {
        !self.emergency_paused && !self.maintenance_mode
    }
    
    /// Check if ERC issuance is allowed
    pub fn can_issue_erc(&self) -> bool {
        self.is_operational() && self.erc_validation_enabled
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct GovernanceStats {
    // Core statistics
    pub total_ercs_issued: u64,
    pub total_ercs_validated: u64,
    pub total_ercs_revoked: u64,
    pub total_energy_certified: u64,
    
    // Configuration
    pub erc_validation_enabled: bool,
    pub emergency_paused: bool,
    pub maintenance_mode: bool,
    
    // Limits
    pub min_energy_amount: u64,
    pub max_erc_amount: u64,
    pub erc_validity_period: i64,

    // Features
    pub require_oracle_validation: bool,
    pub allow_certificate_transfers: bool,
    pub delegation_enabled: bool,
    
    // Timestamps
    pub created_at: i64,
    pub last_updated: i64,
    pub last_erc_issued_at: Option<i64>,
    
    // NEW: Authority change status
    pub pending_authority_change: bool,
    pub pending_authority: Option<Pubkey>,
    pub pending_authority_expires_at: Option<i64>,
    
    // NEW: Oracle info
    pub oracle_authority: Option<Pubkey>,
    pub min_oracle_confidence: u8,
}
