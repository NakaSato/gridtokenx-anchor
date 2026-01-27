// Registry program events

use anchor_lang::prelude::*;
use crate::state::{UserType, UserStatus, MeterType, MeterStatus};

#[event]
pub struct RegistryInitialized {
    pub authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct UserRegistered {
    pub user: Pubkey,
    pub user_type: UserType,
    pub lat: f64,
    pub long: f64,
    pub timestamp: i64,
}

#[event]
pub struct MeterRegistered {
    pub meter_id: String,
    pub owner: Pubkey,
    pub meter_type: MeterType,
    pub timestamp: i64,
}

#[event]
pub struct UserStatusUpdated {
    pub user: Pubkey,
    pub old_status: UserStatus,
    pub new_status: UserStatus,
    pub timestamp: i64,
}

#[event]
pub struct MeterReadingUpdated {
    pub meter_id: String,
    pub owner: Pubkey,
    pub energy_generated: u64,
    pub energy_consumed: u64,
    pub timestamp: i64,
}

#[event]
pub struct MeterBalanceSettled {
    pub meter_id: String,
    pub owner: Pubkey,
    pub tokens_to_mint: u64,
    pub total_settled: u64,
    pub timestamp: i64,
}

#[event]
pub struct OracleAuthoritySet {
    pub old_oracle: Option<Pubkey>,
    pub new_oracle: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct MeterStatusUpdated {
    pub meter_id: String,
    pub owner: Pubkey,
    pub old_status: MeterStatus,
    pub new_status: MeterStatus,
    pub timestamp: i64,
}

#[event]
pub struct MeterDeactivated {
    pub meter_id: String,
    pub owner: Pubkey,
    pub final_generation: u64,
    pub final_consumption: u64,
    pub timestamp: i64,
}
