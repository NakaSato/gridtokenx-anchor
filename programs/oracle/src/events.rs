// Oracle program events

use anchor_lang::prelude::*;

#[event]
pub struct MeterReadingSubmitted {
    pub meter_id: String,
    pub energy_produced: u64,
    pub energy_consumed: u64,
    pub timestamp: i64,
    pub zone_id: i32,
    pub submitter: Pubkey,
}

#[event]
pub struct MarketClearingTriggered {
    pub authority: Pubkey,
    pub timestamp: i64,
    pub epoch_number: i64,
}

#[event]
pub struct OracleStatusUpdated {
    pub authority: Pubkey,
    pub active: bool,
    pub timestamp: i64,
}

#[event]
pub struct ApiGatewayUpdated {
    pub authority: Pubkey,
    pub old_gateway: Pubkey,
    pub new_gateway: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct ValidationConfigUpdated {
    pub authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct BackupOracleAdded {
    pub authority: Pubkey,
    pub backup_oracle: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct BackupOracleRemoved {
    pub authority: Pubkey,
    pub backup_oracle: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct MeterReadingRejected {
    pub meter_id: String,
    pub energy_produced: u64,
    pub energy_consumed: u64,
    pub timestamp: i64,
    pub zone_id: i32,
    pub reason: String,
}

#[event]
pub struct ProductionRatioConfigUpdated {
    pub authority: Pubkey,
    pub max_production_consumption_ratio: u16,
    pub timestamp: i64,
}

#[event]
pub struct ReadingsAggregated {
    pub authority: Pubkey,
    pub total_produced: u64,
    pub total_consumed: u64,
    pub valid_count: u64,
    pub rejected_count: u64,
    pub timestamp: i64,
}
