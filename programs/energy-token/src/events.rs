// Energy-token program events

use anchor_lang::prelude::*;

#[event]
pub struct GridTokensMinted {
    pub meter_owner: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct TokensMintedDirect {
    pub recipient: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct TokensMinted {
    pub recipient: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}
#[event]
pub struct MeterReadingRecorded {
    pub meter_owner: Pubkey,
    pub meter_serial: String,
    pub energy_kwh: u64,
    pub timestamp: i64,
}

#[event]
pub struct EnergyConsumed {
    pub meter_owner: Pubkey,
    pub energy_consumed_kwh: u64,
    pub tokens_burned: u64,
    pub timestamp: i64,
}