// Treasury program state

use anchor_lang::prelude::*;

/// Fixed-point precision for the staking reward accumulator.
/// `acc_reward_per_share` is GRX-reward-per-staked-GRX scaled by this factor.
pub const ACC_PRECISION: u128 = 1_000_000_000_000; // 1e12

/// THBG is a THB-pegged stablecoin: 6 decimals, so 1 THB = 1_000_000 minor units.
pub const THBG_DECIMALS: u8 = 6;

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
