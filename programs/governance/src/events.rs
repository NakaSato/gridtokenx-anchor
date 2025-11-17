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
