// Treasury program events

use anchor_lang::prelude::*;

/// Reserve attestor refreshed the off-chain THB reserve figure.
#[event]
pub struct ReserveAttested {
    pub attestor: Pubkey,
    pub attested_reserve: u64,
    pub timestamp: i64,
}

/// GRX swapped into THBG — the baht-denominated settlement primitive.
#[event]
pub struct SwappedGrxForThbg {
    pub user: Pubkey,
    pub grx_in: u64,
    pub thbg_out: u64,
    pub fee: u64,
    pub thbg_supply: u64,
    pub timestamp: i64,
}

/// THBG redeemed back into GRX held by the treasury swap vault.
#[event]
pub struct RedeemedThbgForGrx {
    pub user: Pubkey,
    pub thbg_in: u64,
    pub grx_out: u64,
    pub thbg_supply: u64,
    pub timestamp: i64,
}

#[event]
pub struct Staked {
    pub user: Pubkey,
    pub amount: u64,
    pub total_staked: u64,
    pub timestamp: i64,
}

#[event]
pub struct Unstaked {
    pub user: Pubkey,
    pub amount: u64,
    pub total_staked: u64,
    pub timestamp: i64,
}

#[event]
pub struct RewardsClaimed {
    pub user: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct RewardsFunded {
    pub funder: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

/// A baht-denominated trade settlement was recorded via trading CPI.
#[event]
pub struct SettlementRecorded {
    pub recorder: Pubkey,
    pub value: u64,
    pub total_settled_thbg: u64,
    pub timestamp: i64,
}

/// A staker's principal was slashed and redistributed to the remaining stakers.
#[event]
pub struct StakeSlashed {
    pub authority: Pubkey,
    pub owner: Pubkey,
    pub slashed_amount: u64,
    pub total_staked: u64,
    pub timestamp: i64,
}
