// Registry program events

use anchor_lang::prelude::*;
use crate::state::{UserType, UserStatus, MeterType, MeterStatus};

#[event]
pub struct RegistryInitialized {
    pub authority: Pubkey,
}

#[event]
pub struct UserRegistered {
    pub user: Pubkey,
    pub user_type: UserType,
    pub lat_e7: i32,
    pub long_e7: i32,
    pub h3_index: u64,
}

#[event]
pub struct MeterRegistered {
    pub meter_id: String,
    pub owner: Pubkey,
    pub meter_type: MeterType,
}

#[event]
pub struct UserStatusUpdated {
    pub user: Pubkey,
    pub old_status: UserStatus,
    pub new_status: UserStatus,
}

#[event]
pub struct MeterReadingUpdated {
    pub meter_id: String,
    pub owner: Pubkey,
    pub energy_generated: u64,
    pub energy_consumed: u64,
}

#[event]
pub struct MeterBalanceSettled {
    pub meter_id: String,
    pub owner: Pubkey,
    pub tokens_to_mint: u64,
    pub total_settled: u64,
}

#[event]
pub struct OracleAuthoritySet {
    pub old_oracle: Option<Pubkey>,
    pub new_oracle: Pubkey,
}

#[event]
pub struct MeterStatusUpdated {
    pub meter_id: String,
    pub owner: Pubkey,
    pub old_status: MeterStatus,
    pub new_status: MeterStatus,
}

#[event]
pub struct MeterDeactivated {
    pub meter_id: String,
    pub owner: Pubkey,
    pub final_generation: u64,
    pub final_consumption: u64,
}
