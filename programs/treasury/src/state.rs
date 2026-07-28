// Treasury program state

use anchor_lang::prelude::*;

/// Fixed-point precision for the staking reward accumulator.
/// `acc_reward_per_share` is GRX-reward-per-staked-GRX scaled by this factor.
pub const ACC_PRECISION: u128 = 1_000_000_000_000; // 1e12

/// THBC is a THB-pegged stablecoin: 6 decimals, so 1 THB = 1_000_000 minor units.
pub const THBC_DECIMALS: u8 = 6;

/// Number of settlement accumulator shards. Settlement recording is otherwise a
/// global-write hot path (`Treasury.total_settled_thbc`), which serializes every
/// trade settle under Sealevel. Spreading the counter across N per-shard PDAs lets
/// settles whose buyers fall on different shards land in parallel; the global total
/// is stale-on-purpose and reconciled by `aggregate_settlement_shards`. Same pattern
/// and shard count as the registry's 16-shard counter.
pub const NUM_SETTLE_SHARDS: u8 = 16;

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
    pub thbc_mint: Pubkey,           // 32 — THBC stablecoin mint, authority = this PDA
    pub settlement_recorder: Pubkey, // 32 — PDA allowed to call record_settlement (trading market_authority)

    pub attested_reserve: u64,    // 8 — off-chain THB reserve, in THBC minor units (the peg ceiling)
    pub attestation_ts: i64,      // 8 — unix ts of the last reserve attestation
    pub attestation_ttl: i64,     // 8 — max attestation age (seconds) before mints are blocked
    pub thbc_supply: u64,         // 8 — THBC minted by the treasury (must stay <= attested_reserve)
    pub grx_per_thbc_rate: u64,   // 8 — THBC minor units issued per 1 whole GRX (settlement price P*)
    pub total_staked: u64,        // 8 — GRX currently staked (NEVER counted toward the peg)
    pub reward_pool: u64,         // 8 — GRX available to pay staking rewards
    pub created_at: i64,          // 8
    pub total_settled_thbc: u64,  // 8 — cumulative baht value settled via trading CPI

    pub swap_fee_bps: u16, // 2 — fee on swap output, basis points

    pub paused: u8, // 1 — 1 = swaps/redeems halted
    pub bump: u8,   // 1 — treasury PDA bump, also the mint/transfer signer seed
    // Canonical bumps for the mint + vault PDAs are stored on purpose: account
    // constraints validate via `bump = treasury.X_bump` (create_program_address,
    // ~1 hash) instead of bare `bump` (find_program_address bump search, ~12k CU)
    // on the swap/stake/redeem hot paths. Same convention as registry's stored bumps.
    pub thbc_mint_bump: u8,    // 1
    pub swap_vault_bump: u8,   // 1
    pub stake_vault_bump: u8,  // 1
    pub reward_vault_bump: u8, // 1
    pub rebate_vault_bump: u8, // 1 — canonical bump for the `rebate_vault` PDA (created by `initialize_rebate_vault`)
    /// Canonical bump for the THBC inventory vault `[b"thbc_inventory"]` (created by
    /// `initialize_thbc_inventory`).
    ///
    /// Taken from `_padding`, not appended: the struct is `zero_copy`, so growing it
    /// would change the account size and make every already-deployed Treasury PDA
    /// fail to deserialize — requiring a re-init that would wipe `attested_reserve`,
    /// `thbc_supply`, staking positions and the settlement totals the trading program
    /// writes. One spare padding byte buys the same field for free.
    ///
    /// Zero on a Treasury initialized before this field existed, which is
    /// indistinguishable from "vault not yet created" — correct in both cases,
    /// because `initialize_thbc_inventory` is what sets it and the exchange
    /// instructions validate the vault by seeds regardless.
    pub thbc_inventory_bump: u8, // 1
    pub _padding: [u8; 14],    // 14 — pad to 272 (16-aligned; base 258 rounds up to next multiple of 16)
    // size = 16 + 32*5 + 8*9 + 2 + 8 + 14 = 272 (multiple of 16, u128-aligned).
    // UNCHANGED from before `thbc_inventory_bump` was added — the byte came out of
    // `_padding`, so the on-chain layout is identical and no migration is needed.
}

#[cfg(test)]
mod layout_tests {
    use super::*;

    /// The whole reason `thbc_inventory_bump` was carved out of `_padding` rather
    /// than appended. If this ever fails, deployed Treasury accounts stop
    /// deserializing and the change needs a re-init or a realloc migration.
    #[test]
    fn treasury_layout_is_still_272_bytes() {
        assert_eq!(core::mem::size_of::<Treasury>(), 272);
    }

    #[test]
    fn treasury_is_16_byte_aligned_for_its_leading_u128() {
        assert_eq!(core::mem::align_of::<Treasury>(), 16);
    }
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

/// Deposit nullifier — F3. PDA seeds: `[b"deposit", H(bank_ref)]`.
///
/// **The account's existence is the invariant; its contents are only evidence.**
/// `issue_thbc` creates this with Anchor `init` in the *same instruction* as the mint,
/// so a replayed bank webhook fails at the **account level** — the Solana runtime
/// refuses to create an account that already exists, before any of this program's code
/// runs. No application bug can defeat it, which is exactly why the guarantee is worth
/// having in the runtime rather than in a database `UNIQUE` index.
///
/// Deliberately the same construction as `[b"gen_mint", meter, window]` on the meter
/// path: both convert an at-least-once off-chain event into an exactly-once on-chain
/// effect via account existence.
///
/// A regular Borsh `#[account]`, not `zero_copy`: it is written once and never mutated,
/// so there is no hot-path re-serialization cost to avoid.
#[account]
pub struct DepositNullifier {
    /// SHA-256 over the bank's own (normalised) transaction reference. Stored so an
    /// auditor can bind this account back to a bank statement line without trusting
    /// the PDA derivation.
    pub bank_ref_hash: [u8; 32], // 32
    /// THBC minor units issued against this deposit.
    pub amount: u64, // 8
    /// Token account that received the mint.
    pub beneficiary: Pubkey, // 32
    pub issued_at: i64, // 8
    pub bump: u8,       // 1
}

impl DepositNullifier {
    /// Payload size (excludes the 8-byte Anchor discriminator).
    pub const LEN: usize = 32 + 8 + 32 + 8 + 1;
}

/// Per-shard settlement accumulator (zero-copy). Hot-path settles bump the shard
/// PDA for the buyer's shard instead of the global `Treasury.total_settled_thbc`, so
/// settles on distinct shards don't write-lock a single account. PDA seeds:
/// `[b"settle_shard", &[shard_id]]`. Global total reconciled via
/// `aggregate_settlement_shards`.
#[account(zero_copy)]
#[repr(C)]
pub struct SettlementShard {
    pub settled_thbc: u64,     // 8 — cumulative baht (THBC minor units) settled on this shard
    pub settlement_count: u64, // 8 — number of settlements recorded on this shard
    pub shard_id: u8,          // 1
    pub bump: u8,              // 1 — canonical PDA bump, stored to avoid find_program_address re-derivation
    pub _padding: [u8; 6],     // 6 — pad to 24 (8-aligned, no implicit pad)
    // size = 8 + 8 + 1 + 1 + 6 = 24 (multiple of 8).
}

impl SettlementShard {
    /// Mutable view for the drain-and-fold reconcile in `aggregate_settlement_shards`,
    /// which zeroes each shard's `settled_thbc` after folding it into the global total.
    pub fn load_mut_from_bytes(data: &mut [u8]) -> Result<&mut Self> {
        Ok(bytemuck::from_bytes_mut(data))
    }
}

/// Per-batch settlement audit commitment (zero-copy). Binds a Merkle root over
/// the matches in one zone's settlement batch, plus the gross baht value and the
/// VAT, for off-chain verification and e-Tax issuance. Commit-only — the chain
/// stores the root; off-chain verifiers recompute and check it. The VAT rate is
/// recorded per batch (a parameter, not a constant: the reduced 7% expires).
///
/// Hand-padded for `bytemuck` Pod (no implicit padding). Two distinct PDA seed
/// namespaces write this account type, deliberately kept separate so the two
/// instructions can never collide on the same address:
///   - `record_settlement_batch_sharded` (the live trading CPI path):
///     `[b"settlement", zone_id.to_le_bytes(), batch_id.to_le_bytes()]`
///   - `record_settlement_batch` (standalone, non-sharded, not on the trading
///     CPI path today): `[b"settlement_batch", zone_id.to_le_bytes(), batch_id.to_le_bytes()]`
#[account(zero_copy)]
#[repr(C)]
pub struct SettlementRecord {
    pub merkle_root: [u8; 32],  // 32 — root over the batch's match leaves        @0
    pub recorder: Pubkey,       // 32 — settlement_recorder that committed         @32
    pub total_value: u64,       // 8  — gross baht (THBC minor units) in the batch @64
    pub vat_amount: u64,        // 8  — VAT on the energy value (audit/e-Tax)      @72
    pub committed_ts: i64,      // 8  — unix ts of the commit                      @80
    pub batch_id: u64,          // 8  — settlement batch id within the zone        @88
    pub zone_id: u32,           // 4  — market zone                               @96
    pub vat_rate_bps: u16,      // 2  — VAT rate applied                          @100
    pub bump: u8,               // 1                                              @102
    pub _padding: [u8; 9],      // 9  — pad to 112 (8-aligned, no implicit pad)   @103
    // size = 32 + 32 + 8*4 + 4 + 2 + 1 + 9 = 112 (multiple of 8).
}
