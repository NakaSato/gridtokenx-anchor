// Treasury program events

use anchor_lang::prelude::*;

/// Reserve attestor refreshed the off-chain THB reserve figure.
#[event]
pub struct ReserveAttested {
    pub attestor: Pubkey,
    pub attested_reserve: u64,
    /// Fiat cleared but not issuable (F1). The effective peg ceiling this attestation
    /// establishes is `attested_reserve − reserve_encumbered`, so an indexer reading
    /// only `attested_reserve` would overstate available headroom.
    pub reserve_encumbered: u64,
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

/// THBC committed to a fiat redemption and moved into escrow — NOT burned. Supply is
/// unchanged; `RedemptionConfirmed` is what reports the burn.
#[event]
pub struct RedemptionEscrowed {
    pub user: Pubkey,
    pub seq: u64,
    pub amount: u64,
    /// When the holder may reclaim if the issuer has not confirmed by then. Emitted so
    /// a holder (or the `E` observer) knows the deadline without deriving it.
    pub reclaimable_at: i64,
    pub timestamp: i64,
}

/// The issuer wired the fiat and burned the escrow. The ONLY event reporting a decrease
/// in `thbc_supply`, and the point after which the holder can no longer reclaim.
#[event]
pub struct RedemptionConfirmed {
    pub user: Pubkey,
    pub seq: u64,
    pub amount: u64,
    pub thbc_supply: u64,
    pub timestamp: i64,
}

/// F7 fired: delta elapsed with no issuer confirmation, and the holder took their THBC
/// back. Publicly visible, which is how an issuer sitting on redemptions becomes
/// observable without anyone gaining custody.
///
/// Note what this does NOT mean: the holder is whole in *tokens*, but if the issuer
/// took the fiat and never wired, the reserve is short — spec §6.4.
#[event]
pub struct RedemptionReclaimed {
    pub user: Pubkey,
    pub seq: u64,
    pub amount: u64,
    pub elapsed_secs: i64,
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
