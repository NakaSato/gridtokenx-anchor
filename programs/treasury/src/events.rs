// Treasury program events

use anchor_lang::prelude::*;

/// Reserve attestor refreshed the off-chain THB reserve figure.
#[event]
pub struct ReserveAttested {
    pub attestor: Pubkey,
    pub attested_reserve: u64,
    pub timestamp: i64,
}

/// THBC minted against fiat received — the on-ramp (spec §5). The ONLY event in this
/// program that reports an increase in `thbc_supply`.
#[event]
pub struct ThbcIssued {
    pub beneficiary: Pubkey,
    pub amount: u64,
    /// `H(bank_ref)` — the F3 nullifier seed. Binds this issuance to a bank statement
    /// line for an auditor without revealing the reference itself.
    pub bank_ref_hash: [u8; 32],
    pub thbc_supply: u64,
    pub timestamp: i64,
}

/// GRX exchanged for THBC out of platform-held inventory.
///
/// `thbc_supply` is emitted even though this instruction never changes it — on
/// purpose. An indexer replaying the event stream can assert supply is identical
/// before and after every exchange, which is F6 made externally checkable rather than
/// merely asserted in a doc comment.
#[event]
pub struct ExchangedGrxForThbc {
    pub user: Pubkey,
    pub grx_in: u64,
    pub thbc_out: u64,
    pub fee: u64,
    /// Unchanged by this instruction. See above.
    pub thbc_supply: u64,
    pub timestamp: i64,
}

/// THBC exchanged back for GRX; the THBC returns to inventory rather than burning.
#[event]
pub struct ExchangedThbcForGrx {
    pub user: Pubkey,
    pub thbc_in: u64,
    pub grx_out: u64,
    /// Fee, in GRX atoms — charged on the output leg, mirroring the forward
    /// direction's fee on its THBC output.
    pub fee: u64,
    /// Unchanged by this instruction.
    pub thbc_supply: u64,
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
    pub total_settled_thbc: u64,
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
    pub total_settled_thbc: u64,
    pub timestamp: i64,
}

/// A settlement batch was recorded against a per-shard accumulator with a full
/// audit commitment (Merkle root + VAT) — the sharded counterpart of
/// `SettlementBatchRecorded`. `shard_total` is this shard's running total, not
/// the global figure (reconciled via `aggregate_settlement_shards`).
#[event]
pub struct SettlementBatchShardRecorded {
    pub recorder: Pubkey,
    pub shard_id: u8,
    pub zone_id: u32,
    pub batch_id: u64,
    pub value: u64,
    pub shard_total: u64,
    pub vat_amount: u64,
    pub vat_rate_bps: u16,
    pub merkle_root: [u8; 32],
    pub timestamp: i64,
}

/// Admin updated treasury params (rate, fee, attestation TTL, pause flag, or
/// the authorized settlement recorder).
#[event]
pub struct ParamsUpdated {
    pub authority: Pubkey,
    pub grx_per_thbc_rate: u64,
    pub swap_fee_bps: u16,
    pub attestation_ttl: i64,
    pub paused: bool,
    pub settlement_recorder: Pubkey,
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
