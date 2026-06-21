// Treasury program state

use anchor_lang::prelude::*;

/// Fixed-point precision for the staking reward accumulator.
/// `acc_reward_per_share` is GRX-reward-per-staked-GRX scaled by this factor.
pub const ACC_PRECISION: u128 = 1_000_000_000_000; // 1e12

/// THBG is a THB-pegged stablecoin: 6 decimals, so 1 THB = 1_000_000 minor units.
pub const THBG_DECIMALS: u8 = 6;

/// Number of settlement accumulator shards. Settlement recording is otherwise a
/// global-write hot path (`Treasury.total_settled_thbg`), which serializes every
/// trade settle under Sealevel. Spreading the counter across N per-shard PDAs lets
/// settles whose buyers fall on different shards land in parallel; the global total
/// is stale-on-purpose and reconciled by `aggregate_settlement_shards`. Same pattern
/// and shard count as the registry's 16-shard counter.
pub const NUM_SETTLE_SHARDS: u8 = 16;

/// Shard selector — maps a key (the settlement buyer) to its accumulator shard by
/// the first key byte, matching the registry's `authority.to_bytes()[0] % num_shards`.
pub fn settle_shard_for(key: &Pubkey) -> u8 {
    key.to_bytes()[0] % NUM_SETTLE_SHARDS
}

/// Global treasury configuration + accounting (zero-copy, single PDA `[b"treasury"]`).
///
/// Layout is hand-padded for `bytemuck` Pod (no implicit padding). `u128` forces
/// 16-byte struct alignment, so it leads the struct and the tail is padded to a
/// multiple of 16. Recount by hand when adding fields.
#[account(zero_copy)]
#[repr(C)]
pub struct Treasury {
    /// Staking reward accumulator: cumulative GRX reward per staked GRX, scaled by ACC_PRECISION.
    pub acc_reward_per_share: u128, // 16

    pub authority: Pubkey,           // 32 — admin (params, pause)
    pub attestor: Pubkey,            // 32 — off-chain custodian that attests the THB reserve
    pub grx_mint: Pubkey,            // 32 — GRX SPL mint (energy-token program)
    pub thbg_mint: Pubkey,           // 32 — THBG stablecoin mint, authority = this PDA
    pub settlement_recorder: Pubkey, // 32 — PDA allowed to call record_settlement (trading market_authority)

    pub attested_reserve: u64,    // 8 — off-chain THB reserve, in THBG minor units (the peg ceiling)
    pub attestation_ts: i64,      // 8 — unix ts of the last reserve attestation
    pub attestation_ttl: i64,     // 8 — max attestation age (seconds) before mints are blocked
    pub thbg_supply: u64,         // 8 — THBG minted by the treasury (must stay <= attested_reserve)
    pub grx_per_thbg_rate: u64,   // 8 — THBG minor units issued per 1 whole GRX (settlement price P*)
    pub total_staked: u64,        // 8 — GRX currently staked (NEVER counted toward the peg)
    pub reward_pool: u64,         // 8 — GRX available to pay staking rewards
    pub created_at: i64,          // 8
    pub total_settled_thbg: u64,  // 8 — cumulative baht value settled via trading CPI

    pub swap_fee_bps: u16, // 2 — fee on swap output, basis points

    pub paused: u8, // 1 — 1 = swaps/redeems halted
    pub bump: u8,   // 1 — treasury PDA bump, also the mint/transfer signer seed
    // Canonical bumps for the mint + vault PDAs are stored on purpose: account
    // constraints validate via `bump = treasury.X_bump` (create_program_address,
    // ~1 hash) instead of bare `bump` (find_program_address bump search, ~12k CU)
    // on the swap/stake/redeem hot paths. Same convention as registry's stored bumps.
    pub thbg_mint_bump: u8,    // 1
    pub swap_vault_bump: u8,   // 1
    pub stake_vault_bump: u8,  // 1
    pub reward_vault_bump: u8, // 1
    // size = 16 + 32*5 + 8*9 + 2 + 6 = 256 (multiple of 16, u128-aligned); no tail padding needed.
}

/// Per-user staking position (regular Borsh account — staking is not a hot path).
/// PDA seeds: `[b"stake", owner]`.
#[account]
pub struct StakePosition {
    pub owner: Pubkey,     // 32
    pub amount: u64,       // 8  — GRX staked by this user
    pub reward_debt: u128, // 16 — bookkeeping baseline (amount * acc / ACC_PRECISION at last update)
    pub pending: u64,      // 8  — accrued-but-unclaimed GRX rewards
    pub bump: u8,          // 1
}

impl StakePosition {
    /// Payload size (excludes the 8-byte Anchor discriminator).
    pub const LEN: usize = 32 + 8 + 16 + 8 + 1;
}

/// Per-shard settlement accumulator (zero-copy). Hot-path settles bump the shard
/// PDA for the buyer's shard instead of the global `Treasury.total_settled_thbg`, so
/// settles on distinct shards don't write-lock a single account. PDA seeds:
/// `[b"settle_shard", &[shard_id]]`. Global total reconciled via
/// `aggregate_settlement_shards`.
#[account(zero_copy)]
#[repr(C)]
pub struct SettlementShard {
    pub settled_thbg: u64,     // 8 — cumulative baht (THBG minor units) settled on this shard
    pub settlement_count: u64, // 8 — number of settlements recorded on this shard
    pub shard_id: u8,          // 1
    pub bump: u8,              // 1 — canonical PDA bump, stored to avoid find_program_address re-derivation
    pub _padding: [u8; 6],     // 6 — pad to 24 (8-aligned, no implicit pad)
    // size = 8 + 8 + 1 + 1 + 6 = 24 (multiple of 8).
}

impl SettlementShard {
    pub fn load_from_bytes(data: &[u8]) -> Result<&Self> {
        Ok(bytemuck::from_bytes(data))
    }
}

/// Per-batch settlement audit commitment (zero-copy). Binds a Merkle root over
/// the matches in one zone's settlement batch, plus the gross baht value and the
/// VAT, for off-chain verification and e-Tax issuance. Commit-only — the chain
/// stores the root; off-chain verifiers recompute and check it. The VAT rate is
/// recorded per batch (a parameter, not a constant: the reduced 7% expires).
///
/// Hand-padded for `bytemuck` Pod (no implicit padding). PDA seeds:
/// `[b"settlement", zone_id.to_le_bytes(), batch_id.to_le_bytes()]`.
#[account(zero_copy)]
#[repr(C)]
pub struct SettlementRecord {
    pub merkle_root: [u8; 32],  // 32 — root over the batch's match leaves        @0
    pub recorder: Pubkey,       // 32 — settlement_recorder that committed         @32
    pub total_value: u64,       // 8  — gross baht (THBG minor units) in the batch @64
    pub vat_amount: u64,        // 8  — VAT on the energy value (audit/e-Tax)      @72
    pub committed_ts: i64,      // 8  — unix ts of the commit                      @80
    pub batch_id: u64,          // 8  — settlement batch id within the zone        @88
    pub zone_id: u32,           // 4  — market zone                               @96
    pub vat_rate_bps: u16,      // 2  — VAT rate applied                          @100
    pub bump: u8,               // 1                                              @102
    pub _padding: [u8; 9],      // 9  — pad to 112 (8-aligned, no implicit pad)   @103
    // size = 32 + 32 + 8*4 + 4 + 2 + 1 + 9 = 112 (multiple of 8).
}
