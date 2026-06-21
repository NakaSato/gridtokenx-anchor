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

/// A baht-denominated settlement was recorded against a per-shard accumulator
/// (parallel-friendly variant of `SettlementRecorded`). `shard_total` is this
/// shard's running total, not the global figure (reconciled via aggregation).
#[event]
pub struct SettlementShardRecorded {
    pub recorder: Pubkey,
    pub shard_id: u8,
    pub value: u64,
    pub shard_total: u64,
    pub timestamp: i64,
}

/// A settlement batch was recorded with an audit commitment (Merkle root + VAT).
#[event]
pub struct SettlementBatchRecorded {
    pub recorder: Pubkey,
    pub zone_id: u32,
    pub batch_id: u64,
    pub total_value: u64,
    pub vat_amount: u64,
    pub vat_rate_bps: u16,
    pub merkle_root: [u8; 32],
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
