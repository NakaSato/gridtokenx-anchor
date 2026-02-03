use anchor_lang::prelude::*;

#[event]
pub struct PoAInitialized {
    pub authority: Pubkey,
    pub authority_name: String,
    pub timestamp: i64,
}

#[event]
pub struct EmergencyPauseActivated {
    pub authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct EmergencyPauseDeactivated {
    pub authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct ErcIssued {
    pub certificate_id: String,
    pub authority: Pubkey,
    pub energy_amount: u64,
    pub renewable_source: String,
    pub timestamp: i64,
}

#[event]
pub struct ErcValidatedForTrading {
    pub certificate_id: String,
    pub authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct GovernanceConfigUpdated {
    pub authority: Pubkey,
    pub erc_validation_enabled: bool,
    pub old_enabled: bool,
    pub timestamp: i64,
}

#[event]
pub struct MaintenanceModeUpdated {
    pub authority: Pubkey,
    pub maintenance_enabled: bool,
    pub timestamp: i64,
}

#[event]
pub struct ErcLimitsUpdated {
    pub authority: Pubkey,
    pub old_min: u64,
    pub new_min: u64,
    pub old_max: u64,
    pub new_max: u64,
    pub old_validity: i64,
    pub new_validity: i64,
    pub timestamp: i64,
}

#[event]
pub struct AuthorityInfoUpdated {
    pub authority: Pubkey,
    pub old_contact: String,
    pub new_contact: String,
    pub timestamp: i64,
}

// === NEW EVENTS: Revocation ===

#[event]
pub struct ErcRevoked {
    pub certificate_id: String,
    pub authority: Pubkey,
    pub reason: String,
    pub energy_amount: u64,
    pub timestamp: i64,
}

// === NEW EVENTS: Transfer ===

#[event]
pub struct ErcTransferred {
    pub certificate_id: String,
    pub from_owner: Pubkey,
    pub to_owner: Pubkey,
    pub energy_amount: u64,
    pub timestamp: i64,
}

// === NEW EVENTS: Multi-sig Authority ===

#[event]
pub struct AuthorityChangeProposed {
    pub current_authority: Pubkey,
    pub proposed_authority: Pubkey,
    pub expires_at: i64,
    pub timestamp: i64,
}

#[event]
pub struct AuthorityChangeApproved {
    pub old_authority: Pubkey,
    pub new_authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct AuthorityChangeCancelled {
    pub authority: Pubkey,
    pub cancelled_proposal: Pubkey,
    pub timestamp: i64,
}

// === NEW EVENTS: Oracle ===

#[event]
pub struct OracleAuthoritySet {
    pub authority: Pubkey,
    pub oracle_authority: Pubkey,
    pub min_confidence: u8,
    pub timestamp: i64,
}
