#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

pub use error::TreasuryError;
pub use events::*;
// Handler fns share names with the #[program]-generated re-exports; the glob is
// deliberate (Context structs + client accounts must be crate-public).
#[allow(ambiguous_glob_reexports)]
pub use instructions::*;
pub use state::*;

// compute_fn! / compute_checkpoint! — real macros under `localnet`, no-ops otherwise.
#[cfg(feature = "localnet")]
use compute_debug::{compute_checkpoint, compute_fn};

// No-op versions for non-localnet builds. `#[macro_export]` hoists them to the crate
// root so the `instructions/` submodules can `use crate::{compute_fn, compute_checkpoint}`.
#[cfg(not(feature = "localnet"))]
#[macro_export]
macro_rules! compute_fn {
    ($name:expr => $block:block) => {
        $block
    };
}
#[cfg(not(feature = "localnet"))]
#[macro_export]
macro_rules! compute_checkpoint {
    ($name:expr) => {};
}

declare_id!("FfxSQYKUmx9NGdCC9TDPmZSYjWYE1h4ruu3JatzHN5Tn");

/// GRX has 9 decimals; `grx_per_thbc_rate` is THBC-minor-units per **whole** GRX,
/// so converting an atomic GRX amount divides by this.
const GRX_ATOMS_PER_WHOLE: u128 = 1_000_000_000;

/// `pending = amount * acc / ACC_PRECISION - reward_debt` (saturating at 0).
pub(crate) fn accrued_since(amount: u64, acc: u128, reward_debt: u128) -> Result<u64> {
    let gross = (amount as u128)
        .checked_mul(acc)
        .ok_or(TreasuryError::MathOverflow)?
        / ACC_PRECISION;
    let net = gross.saturating_sub(reward_debt);
    u64::try_from(net).map_err(|_| TreasuryError::MathOverflow.into())
}

/// `reward_debt = amount * acc / ACC_PRECISION`.
pub(crate) fn reward_debt_for(amount: u64, acc: u128) -> Result<u128> {
    (amount as u128)
        .checked_mul(acc)
        .ok_or(TreasuryError::MathOverflow)
        .map(|v| v / ACC_PRECISION)
        .map_err(Into::into)
}

/// Swap peg math (extracted from `swap_grx_for_thbc` so it is unit-testable):
/// `gross = grx_in * rate / 1e9`, `fee = gross * fee_bps / 1e4`, `net = gross - fee`.
/// Enforces `net > 0` (ZeroAmount) and the peg invariant
/// `thbc_supply + net <= attested_reserve` (PegBreach). All products use checked u128
/// math (MathOverflow on overflow / u64 truncation). Returns `(net, fee, new_supply)`.
pub(crate) fn compute_swap_grx_for_thbc(
    grx_in: u64,
    rate: u64,
    fee_bps: u16,
    thbc_supply: u64,
    attested_reserve: u64,
) -> Result<(u64, u64, u64)> {
    let gross = (grx_in as u128)
        .checked_mul(rate as u128)
        .ok_or(TreasuryError::MathOverflow)?
        / GRX_ATOMS_PER_WHOLE;
    let fee = gross
        .checked_mul(fee_bps as u128)
        .ok_or(TreasuryError::MathOverflow)?
        / 10_000;
    let net = gross.saturating_sub(fee);
    require!(net > 0, TreasuryError::ZeroAmount);
    let new_supply = (thbc_supply as u128)
        .checked_add(net)
        .ok_or(TreasuryError::MathOverflow)?;
    require!(new_supply <= attested_reserve as u128, TreasuryError::PegBreach);
    Ok((
        u64::try_from(net).map_err(|_| TreasuryError::MathOverflow)?,
        u64::try_from(fee).map_err(|_| TreasuryError::MathOverflow)?,
        u64::try_from(new_supply).map_err(|_| TreasuryError::MathOverflow)?,
    ))
}

/// Redeem peg math (extracted from `redeem_thbc_for_grx` for unit-testing):
/// `grx_out = thbc_in * 1e9 / rate`. Collateral guards — burning more THBC than the
/// tracked supply (SupplyUnderflow) or paying out more GRX than the swap vault holds
/// (InsufficientVault) — so a rate change can never let a redeemer drain the vault.
/// Returns `(grx_out, new_supply)`.
pub(crate) fn compute_redeem_thbc_for_grx(
    thbc_in: u64,
    rate: u64,
    thbc_supply: u64,
    vault_amount: u64,
) -> Result<(u64, u64)> {
    require!(thbc_in <= thbc_supply, TreasuryError::SupplyUnderflow);
    let grx_out = (thbc_in as u128)
        .checked_mul(GRX_ATOMS_PER_WHOLE)
        .ok_or(TreasuryError::MathOverflow)?
        / (rate as u128);
    require!(grx_out > 0, TreasuryError::ZeroAmount);
    let grx_out = u64::try_from(grx_out).map_err(|_| TreasuryError::MathOverflow)?;
    require!(grx_out <= vault_amount, TreasuryError::InsufficientVault);
    let new_supply = thbc_supply
        .checked_sub(thbc_in)
        .ok_or(TreasuryError::SupplyUnderflow)?;
    Ok((grx_out, new_supply))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Accumulator round-trip: fund N GRX against a single staker holding S,
    // the staker's accrued reward must equal ~N (minus integer-division dust).
    #[test]
    fn single_staker_earns_full_pot() {
        let staked: u64 = 10_000_000_000; // 10 GRX
        let pot: u64 = 5_000_000_000; // 5 GRX funded
        // acc += pot * ACC / staked
        let acc = (pot as u128) * ACC_PRECISION / (staked as u128);
        let debt = reward_debt_for(staked, 0).unwrap(); // joined before funding => debt 0
        let earned = accrued_since(staked, acc, debt).unwrap();
        assert_eq!(earned, pot); // exact: ACC_PRECISION absorbs the division
    }

    // Two equal stakers split a pot evenly.
    #[test]
    fn equal_stakers_split_evenly() {
        let each: u64 = 4_000_000_000;
        let total = each * 2;
        let pot: u64 = 1_000_000_000;
        let acc = (pot as u128) * ACC_PRECISION / (total as u128);
        // both joined before funding => debt 0
        let a = accrued_since(each, acc, 0).unwrap();
        let b = accrued_since(each, acc, 0).unwrap();
        assert_eq!(a, b);
        assert_eq!(a + b, pot);
    }

    // A staker who joins AFTER the pot was funded earns nothing from it:
    // their reward_debt is set at the post-funding accumulator.
    #[test]
    fn late_joiner_earns_nothing_from_prior_pot() {
        let acc = 12_345u128 * ACC_PRECISION / 1000; // some nonzero accumulator
        let amount: u64 = 7_000_000_000;
        let debt = reward_debt_for(amount, acc).unwrap();
        let earned = accrued_since(amount, acc, debt).unwrap();
        assert_eq!(earned, 0);
    }

    fn err_code(e: anchor_lang::error::Error) -> u32 {
        match e {
            anchor_lang::error::Error::AnchorError(ae) => ae.error_code_number,
            other => panic!("expected AnchorError, got {other:?}"),
        }
    }
    fn code_of(v: TreasuryError) -> u32 { err_code(v.into()) }

    // Peg arithmetic exercising the REAL handler math: 3 GRX × rate 4_000_000 / 1e9 = 12 THBC
    // gross; fee 25 bps = 30_000; net 11_970_000; supply 0 -> net, reserve ample.
    #[test]
    fn swap_output_matches_rate_and_fee() {
        let (net, fee, new_supply) =
            compute_swap_grx_for_thbc(3_000_000_000, 4_000_000, 25, 0, 1_000_000_000).unwrap();
        assert_eq!(fee, 30_000);
        assert_eq!(net, 11_970_000);
        assert_eq!(new_supply, 11_970_000);
    }

    // thbc_supply accumulates: existing 1_000_000 + net 11_970_000 = 12_970_000 <= reserve.
    #[test]
    fn swap_adds_net_to_existing_supply() {
        let (_net, _fee, new_supply) =
            compute_swap_grx_for_thbc(3_000_000_000, 4_000_000, 25, 1_000_000, 100_000_000).unwrap();
        assert_eq!(new_supply, 12_970_000);
    }

    // Dust input rounds to zero net output -> ZeroAmount (not a free mint of 0).
    #[test]
    fn swap_zero_net_is_rejected() {
        // grx_in 1 atom * rate 1 / 1e9 = 0 gross -> net 0.
        let e = compute_swap_grx_for_thbc(1, 1, 0, 0, u64::MAX).unwrap_err();
        assert_eq!(err_code(e), code_of(TreasuryError::ZeroAmount));
    }

    // Peg ceiling is inclusive: supply + net == reserve is allowed.
    #[test]
    fn swap_peg_ceiling_is_inclusive() {
        // net = 12_000_000 (fee_bps 0), supply 0, reserve exactly 12_000_000.
        let (net, _fee, new_supply) =
            compute_swap_grx_for_thbc(3_000_000_000, 4_000_000, 0, 0, 12_000_000).unwrap();
        assert_eq!(net, 12_000_000);
        assert_eq!(new_supply, 12_000_000);
    }

    // One atom over the reserve ceiling -> PegBreach.
    #[test]
    fn swap_over_reserve_breaches_peg() {
        let e = compute_swap_grx_for_thbc(3_000_000_000, 4_000_000, 0, 0, 11_999_999).unwrap_err();
        assert_eq!(err_code(e), code_of(TreasuryError::PegBreach));
    }

    // fee overflowing the u64 cast is reachable: a huge gross (> u64::MAX) with a near-100%
    // fee leaves net small enough to clear the peg, but fee itself exceeds u64 -> MathOverflow.
    // (grx_in*rate can't overflow u128 since u64*u64 < u128::MAX, and net > u64::MAX always
    // breaches the peg first — so the fee cast is the only reachable MathOverflow path.)
    #[test]
    fn swap_fee_u64_overflow_rejected() {
        // gross = 1e10 * 1.8e19 / 1e9 ~ 1.8e20 (> u64::MAX); fee_bps 9999 -> fee ~1.8e20 (> u64::MAX);
        // net ~1.8e16 (fits u64) and clears the ample reserve.
        let e =
            compute_swap_grx_for_thbc(10_000_000_000, u64::MAX, 9_999, 0, u64::MAX).unwrap_err();
        assert_eq!(err_code(e), code_of(TreasuryError::MathOverflow));
    }

    // --- redeem peg math ---

    // 12 THBC (6dp) at rate 4_000_000 (4 THBC per whole GRX) -> 3 GRX; supply fully burned.
    #[test]
    fn redeem_output_matches_rate() {
        let (grx_out, new_supply) =
            compute_redeem_thbc_for_grx(12_000_000, 4_000_000, 12_000_000, 1_000_000_000_000).unwrap();
        assert_eq!(grx_out, 3_000_000_000);
        assert_eq!(new_supply, 0);
    }

    // Burning more THBC than the tracked supply -> SupplyUnderflow (peg ledger guard).
    #[test]
    fn redeem_over_supply_rejected() {
        let e = compute_redeem_thbc_for_grx(12_000_001, 4_000_000, 12_000_000, u64::MAX).unwrap_err();
        assert_eq!(err_code(e), code_of(TreasuryError::SupplyUnderflow));
    }

    // Dust input rounds GRX out to zero -> ZeroAmount (no free burn).
    #[test]
    fn redeem_dust_zero_out_rejected() {
        // thbc_in 1 * 1e9 / rate 2e9 = 0 grx_out.
        let e = compute_redeem_thbc_for_grx(1, 2_000_000_000, 100, u64::MAX).unwrap_err();
        assert_eq!(err_code(e), code_of(TreasuryError::ZeroAmount));
    }

    // grx_out exceeding the vault's GRX collateral -> InsufficientVault (drain guard).
    #[test]
    fn redeem_over_vault_rejected() {
        // grx_out = 3e9 but vault holds only 3e9 - 1.
        let e = compute_redeem_thbc_for_grx(12_000_000, 4_000_000, 12_000_000, 2_999_999_999).unwrap_err();
        assert_eq!(err_code(e), code_of(TreasuryError::InsufficientVault));
    }

    // Vault exactly covering the payout is allowed (inclusive bound).
    #[test]
    fn redeem_vault_exactly_covers() {
        let (grx_out, _) =
            compute_redeem_thbc_for_grx(12_000_000, 4_000_000, 12_000_000, 3_000_000_000).unwrap();
        assert_eq!(grx_out, 3_000_000_000);
    }

    // grx_out overflowing the u64 cast (rate 1 -> grx_out = thbc_in * 1e9) -> MathOverflow.
    #[test]
    fn redeem_grx_out_overflow_rejected() {
        let e = compute_redeem_thbc_for_grx(u64::MAX, 1, u64::MAX, u64::MAX).unwrap_err();
        assert_eq!(err_code(e), code_of(TreasuryError::MathOverflow));
    }
}

#[program]
pub mod treasury {
    use super::*;

    /// Bootstrap the treasury: config PDA, the THBC mint (authority = treasury PDA),
    /// and the three GRX vaults (swap collateral, stake custody, reward pool).
    pub fn initialize(
        ctx: Context<Initialize>,
        attestor: Pubkey,
        settlement_recorder: Pubkey,
        grx_per_thbc_rate: u64,
        swap_fee_bps: u16,
        attestation_ttl: i64,
    ) -> Result<()> {
        compute_fn!("initialize" => {
            instructions::initialize(
                ctx,
                attestor,
                settlement_recorder,
                grx_per_thbc_rate,
                swap_fee_bps,
                attestation_ttl,
            )
        })
    }

    /// Admin: update swap rate, fee, attestation TTL, pause flag, and the
    /// authorized settlement recorder (the trading market_authority PDA).
    pub fn set_params(
        ctx: Context<SetParams>,
        grx_per_thbc_rate: u64,
        swap_fee_bps: u16,
        attestation_ttl: i64,
        paused: bool,
        settlement_recorder: Pubkey,
    ) -> Result<()> {
        compute_fn!("set_params" => {
            instructions::set_params(
                ctx,
                grx_per_thbc_rate,
                swap_fee_bps,
                attestation_ttl,
                paused,
                settlement_recorder,
            )
        })
    }

    /// Record a baht-denominated trade settlement. Called via CPI by the trading
    /// program after it pays a seller in THBC; bumps the cumulative settled total.
    /// Non-custodial — moves no funds. Authorized by the `settlement_recorder`
    /// signer (the trading market_authority PDA), so only genuine trading
    /// settlements can advance the counter.
    ///
    /// Not independently replay-safe: this instruction has no per-call nullifier
    /// of its own and relies on the caller (trading's per-match `TradeNullifier`,
    /// see `settle_offchain.rs`) to guarantee it's never invoked twice for the
    /// same match.
    pub fn record_settlement(ctx: Context<RecordSettlement>, value: u64) -> Result<()> {
        compute_fn!("record_settlement" => {
            instructions::record_settlement(ctx, value)
        })
    }

    /// Record a settlement BATCH with an audit commitment. Bumps the cumulative
    /// settled total (as `record_settlement` does) and writes a per-`(zone, batch)`
    /// `SettlementRecord` binding the Merkle root over the batch's matches plus the
    /// VAT amount/rate. Commit-only — no on-chain verification of the root; off-chain
    /// verifiers recompute it and e-Tax issuance consumes the VAT fields. Authorized
    /// by the `settlement_recorder` (the trading market_authority PDA).
    pub fn record_settlement_batch(
        ctx: Context<RecordSettlementBatch>,
        value: u64,
        merkle_root: [u8; 32],
        vat_amount: u64,
        vat_rate_bps: u16,
        zone_id: u32,
        batch_id: u64,
    ) -> Result<()> {
        compute_fn!("record_settlement_batch" => {
            instructions::record_settlement_batch(
                ctx,
                value,
                merkle_root,
                vat_amount,
                vat_rate_bps,
                zone_id,
                batch_id,
            )
        })
    }

    /// Create one settlement accumulator shard PDA (`[b"settle_shard", &[shard_id]]`).
    /// Admin-only, idempotent per shard_id. Run once per shard (0..NUM_SETTLE_SHARDS)
    /// at deploy/init so the sharded settle path has its destination accounts.
    pub fn initialize_settlement_shard(
        ctx: Context<InitializeSettlementShard>,
        shard_id: u8,
    ) -> Result<()> {
        compute_fn!("initialize_settlement_shard" => {
            instructions::initialize_settlement_shard(ctx, shard_id)
        })
    }

    /// Create the GRX rebate-pool vault (`[b"rebate_vault"]`) — a FOURTH treasury GRX vault,
    /// distinct from swap/stake/reward, that registry's `slash_destination` (role-map.md
    /// fix #10) should point at so slashed validator bonds reach a regulator / consumer-
    /// rebate fund instead of yield-stakers. Admin-only, idempotent (fails harmlessly if
    /// already created). No CPI wiring — registry sends slashed GRX here directly, this
    /// program never reads or moves it; a later ERC-facing withdraw instruction is a
    /// separate, explicit task.
    pub fn initialize_rebate_vault(ctx: Context<InitializeRebateVault>) -> Result<()> {
        compute_fn!("initialize_rebate_vault" => {
            instructions::initialize_rebate_vault(ctx)
        })
    }

    /// Parallel-friendly variant of `record_settlement`: bumps the per-shard
    /// accumulator for `shard_id` instead of the global `total_settled_thbc`, so
    /// settles whose buyers fall on different shards don't write-lock one account.
    /// `treasury` is read-only here (recorder gate only) — read locks are shared
    /// across parallel txs, so it does not serialize. The shard account is bound to
    /// `shard_id` by its PDA seeds, so a recorder cannot scatter onto an arbitrary
    /// account. Reconcile the global total via `aggregate_settlement_shards`.
    ///
    /// Not independently replay-safe (same caveat as `record_settlement`): relies
    /// on trading's per-match `TradeNullifier` to prevent duplicate calls.
    pub fn record_settlement_sharded(
        ctx: Context<RecordSettlementSharded>,
        value: u64,
        shard_id: u8,
    ) -> Result<()> {
        compute_fn!("record_settlement_sharded" => {
            instructions::record_settlement_sharded(ctx, value, shard_id)
        })
    }

    /// Reconcile the global `total_settled_thbc` from the per-shard accumulators.
    /// Admin-only.
    ///
    /// **Drain-and-fold:** each `SettlementShard` passed in `remaining_accounts`
    /// (validated by program owner + stored-bump PDA, deduped by a shard-id bitmask)
    /// has its `settled_thbc` ADDED to the running global and then ZEROED. Folding
    /// into — instead of overwriting — the live global is deliberate: the single-match
    /// settle path (`record_settlement`) bumps `total_settled_thbc` directly, while the
    /// batch path bumps shards. Overwriting `global = sum(shards)` (the previous
    /// behaviour) silently wiped every single-match contribution on each reconcile.
    /// Folding preserves both; zeroing the shard makes it a delta-since-last-aggregate,
    /// so re-running with no new settles is a no-op (no double counting). Shards must
    /// therefore be passed writable. `settlement_count` is left cumulative.
    pub fn aggregate_settlement_shards(ctx: Context<AggregateSettlementShards>) -> Result<()> {
        compute_fn!("aggregate_settlement_shards" => {
            instructions::aggregate_settlement_shards(ctx)
        })
    }

    /// Parallel-friendly variant of `record_settlement_batch`: bumps the per-shard
    /// accumulator for `shard_id` instead of the global `total_settled_thbc`, while
    /// still writing the per-`(zone, batch)` `SettlementRecord` audit commitment (which
    /// is already non-global — unique per batch). Treasury is read-only here (recorder
    /// gate only), so parallel batch settles on distinct shards don't serialize on it.
    /// Reconcile the global total via `aggregate_settlement_shards`.
    #[allow(clippy::too_many_arguments)]
    pub fn record_settlement_batch_sharded(
        ctx: Context<RecordSettlementBatchSharded>,
        value: u64,
        merkle_root: [u8; 32],
        vat_amount: u64,
        vat_rate_bps: u16,
        zone_id: u32,
        batch_id: u64,
        shard_id: u8,
    ) -> Result<()> {
        compute_fn!("record_settlement_batch_sharded" => {
            instructions::record_settlement_batch_sharded(
                ctx,
                value,
                merkle_root,
                vat_amount,
                vat_rate_bps,
                zone_id,
                batch_id,
                shard_id,
            )
        })
    }

    /// Custodian: refresh the off-chain THB reserve figure that caps THBC supply.
    /// This is the peg's source of truth — mints are blocked once it goes stale.
    pub fn update_attestation(ctx: Context<UpdateAttestation>, attested_reserve: u64) -> Result<()> {
        compute_fn!("update_attestation" => {
            instructions::update_attestation(ctx, attested_reserve)
        })
    }

    /// Swap GRX → THBC. This is the baht-denominated settlement primitive: a
    /// producer's GRX is converted to THB-pegged value at `grx_per_thbc_rate`.
    ///
    /// Peg invariants enforced here:
    ///   1. The reserve attestation must be fresh (`now - attestation_ts <= ttl`).
    ///   2. Outstanding `thbc_supply + minted` must never exceed `attested_reserve`.
    /// Staked GRX is held in a separate vault and never backs the peg.
    pub fn swap_grx_for_thbc(ctx: Context<SwapGrxForThbc>, grx_in: u64) -> Result<()> {
        compute_fn!("swap_grx_for_thbc" => {
            instructions::swap_grx_for_thbc(ctx, grx_in)
        })
    }

    /// Redeem THBC → GRX from the swap vault. Burns the user's THBC (shrinking the
    /// peg liability) and returns GRX at the configured rate.
    pub fn redeem_thbc_for_grx(ctx: Context<RedeemThbcForGrx>, thbc_in: u64) -> Result<()> {
        compute_fn!("redeem_thbc_for_grx" => {
            instructions::redeem_thbc_for_grx(ctx, thbc_in)
        })
    }

    /// Stake GRX into the staking vault. Settles any pending reward before changing
    /// the position so the accumulator stays consistent.
    pub fn stake_grx(ctx: Context<StakeGrx>, amount: u64) -> Result<()> {
        compute_fn!("stake_grx" => {
            instructions::stake_grx(ctx, amount)
        })
    }

    /// Unstake GRX. Settles pending reward, returns principal from the staking vault.
    pub fn unstake_grx(ctx: Context<UnstakeGrx>, amount: u64) -> Result<()> {
        compute_fn!("unstake_grx" => {
            instructions::unstake_grx(ctx, amount)
        })
    }

    /// Claim accrued staking rewards (paid in GRX from the reward pool).
    pub fn claim_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
        compute_fn!("claim_rewards" => {
            instructions::claim_rewards(ctx)
        })
    }

    /// Deposit GRX into the reward pool, distributing it pro-rata to current stakers
    /// via the accumulator. Requires a non-zero total stake.
    pub fn fund_rewards(ctx: Context<FundRewards>, amount: u64) -> Result<()> {
        compute_fn!("fund_rewards" => {
            instructions::fund_rewards(ctx, amount)
        })
    }

    /// Slash a staker's principal for misbehaviour (treasury authority only).
    ///
    /// The slashed GRX moves from the staking vault into the reward vault and is redistributed
    /// pro-rata to the *remaining* stakers via the reward accumulator (same mechanism as
    /// `fund_rewards`) — "redistributed to honest stakers, not burned". The slashed staker's
    /// already-accrued rewards are preserved (settled into `pending`); only principal is taken,
    /// and they are excluded from this redistribution (their `reward_debt` is rebased at the new
    /// accumulator). If no stake remains after slashing, the amount is parked in `reward_pool`.
    pub fn slash_stake(ctx: Context<SlashStake>, amount: u64) -> Result<()> {
        compute_fn!("slash_stake" => {
            instructions::slash_stake(ctx, amount)
        })
    }
}
