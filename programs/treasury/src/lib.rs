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

/// Issuance math for `issue_thbc` (extracted so it is unit-testable) — **F5 then F1**.
///
/// Returns the new `thbc_supply`.
///
/// This is the only place in the program where either invariant is enforced, because
/// `issue_thbc` is the only instruction that increases supply. Both guards previously
/// lived on `swap_grx_for_thbc`; the F6 fix removed that instruction and left them
/// unreachable until this restored them.
///
/// **Ordering is load-bearing.** Freshness is checked before the ceiling: a stale
/// `attested_reserve` makes the F1 comparison meaningless rather than merely
/// conservative, so reporting `StaleAttestation` is strictly more informative than
/// reporting a `PegBreach` computed from a number nobody vouches for.
///
/// A future-dated attestation is rejected too — otherwise a clock-skewed or malicious
/// attestor buys unlimited freshness by stamping ahead.
pub(crate) fn compute_issue_thbc(
    amount: u64,
    thbc_supply: u64,
    attested_reserve: u64,
    now: i64,
    attestation_ts: i64,
    attestation_ttl: i64,
) -> Result<u64> {
    // F5.
    let age = now.saturating_sub(attestation_ts);
    require!(age >= 0, TreasuryError::StaleAttestation);
    require!(age <= attestation_ttl, TreasuryError::StaleAttestation);

    // F1. Checked against `attested_reserve`, NOT `attested_reserve -
    // reserve_encumbered` as spec §4.1 wants — that field does not exist on the
    // zero-copy Treasury and adding it needs a layout change. The ceiling here is
    // therefore looser than specified by exactly the encumbered amount.
    let new_supply = (thbc_supply as u128)
        .checked_add(amount as u128)
        .ok_or(TreasuryError::MathOverflow)?;
    require!(
        new_supply <= attested_reserve as u128,
        TreasuryError::PegBreach
    );

    u64::try_from(new_supply).map_err(|_| TreasuryError::MathOverflow.into())
}

/// Inventory-exchange math for `exchange_grx_for_thbc` (extracted so it is
/// unit-testable): `gross = grx_in * rate / 1e9`, `fee = gross * fee_bps / 1e4`,
/// `net = gross - fee`. Returns `(net, fee)`.
///
/// **Pricing is byte-identical to the old `compute_swap_grx_for_thbc`.** What changed
/// is the bound and the return type:
///
/// - was: `new_supply <= attested_reserve` (PegBreach) — the mint consumed fiat-reserve
///   headroom;
/// - now: `net <= inventory` (InsufficientInventory) — the transfer is bounded by what
///   the platform actually holds.
///
/// The `new_supply` return is **gone, not zeroed**. That is the F6 fix expressed in
/// the type system: this function cannot tell a caller what supply to write to,
/// because there is no supply change to write. A future edit that reintroduces
/// minting would have to change this signature, which is exactly the kind of change
/// that should be hard to make by accident.
pub(crate) fn compute_exchange_grx_for_thbc(
    grx_in: u64,
    rate: u64,
    fee_bps: u16,
    inventory: u64,
) -> Result<(u64, u64)> {
    require!(fee_bps <= 10_000, TreasuryError::InvalidFeeBps);
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
    // A shortfall is a refusal, never a mint. This single `require!` is the whole of
    // F6 on this path.
    require!(net <= inventory as u128, TreasuryError::InsufficientInventory);
    Ok((
        u64::try_from(net).map_err(|_| TreasuryError::MathOverflow)?,
        u64::try_from(fee).map_err(|_| TreasuryError::MathOverflow)?,
    ))
}

/// Inventory-exchange math for `exchange_thbc_for_grx`:
/// `gross = thbc_in * 1e9 / rate`, `fee = gross * fee_bps / 1e4`, `net = gross - fee`.
/// Returns `(net, fee)` in GRX atoms.
///
/// Two changes from the old `compute_redeem_thbc_for_grx`:
///
/// 1. **No `SupplyUnderflow` check and no `new_supply`.** That guard existed because
///    the instruction burned; a transfer into inventory cannot underflow supply, and
///    the token program already refuses to move more than the user holds.
/// 2. **A fee is now charged**, mirroring the forward direction. The old redeem path
///    was free, which made a GRX→THBC→GRX round trip cost the forward fee only. A
///    market maker quoting a spread charges both ways; `swap_fee_bps` is that spread.
///
/// The vault bound is kept: paying out more GRX than `swap_vault` holds is refused
/// (InsufficientVault), so an admin rate change can never let a caller drain it.
pub(crate) fn compute_exchange_thbc_for_grx(
    thbc_in: u64,
    rate: u64,
    fee_bps: u16,
    vault_amount: u64,
) -> Result<(u64, u64)> {
    require!(rate > 0, TreasuryError::RateNotSet);
    require!(fee_bps <= 10_000, TreasuryError::InvalidFeeBps);
    let gross = (thbc_in as u128)
        .checked_mul(GRX_ATOMS_PER_WHOLE)
        .ok_or(TreasuryError::MathOverflow)?
        / (rate as u128);
    let fee = gross
        .checked_mul(fee_bps as u128)
        .ok_or(TreasuryError::MathOverflow)?
        / 10_000;
    let net = gross.saturating_sub(fee);
    require!(net > 0, TreasuryError::ZeroAmount);
    let net = u64::try_from(net).map_err(|_| TreasuryError::MathOverflow)?;
    require!(net <= vault_amount, TreasuryError::InsufficientVault);
    Ok((
        net,
        u64::try_from(fee).map_err(|_| TreasuryError::MathOverflow)?,
    ))
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

    // --- guard against losing the #[program] module ---

    /// The `#[program]` module was silently deleted once by an over-broad edit that
    /// truncated this file at the test block. Everything still compiled and every unit
    /// test still passed, because the handler bodies live in `instructions/` and the
    /// crate is a valid library without an entrypoint — `cargo build-sbf` succeeded and
    /// produced a program exposing ZERO instructions.
    ///
    /// This asserts the generated entrypoint exists, so that failure mode is loud.
    /// `treasury::ID` is emitted by `declare_id!` and `instruction::IssueThbc` only
    /// exists if the `#[program]` macro ran over a module containing `issue_thbc`.
    #[test]
    fn program_entrypoint_and_instructions_exist() {
        assert_eq!(crate::ID, crate::id());
        // Named instruction types are generated by #[program]; referencing them here
        // fails to COMPILE if the module or the handler is gone.
        let _ = crate::instruction::IssueThbc {
            amount: 0,
            bank_ref_hash: [0u8; 32],
        };
        let _ = crate::instruction::ExchangeGrxForThbc { grx_in: 0 };
        let _ = crate::instruction::ExchangeThbcForGrx { thbc_in: 0 };
        let _ = crate::instruction::InitializeThbcInventory {};
        let _ = crate::instruction::RedeemThbcForFiat { amount: 0, seq: 0 };
        let _ = crate::instruction::ConfirmRedemption {};
        let _ = crate::instruction::ReclaimRedemption {};
    }

    // --- issuance math: F5 then F1 ---

    #[test]
    fn issue_adds_to_supply_under_the_ceiling() {
        let new_supply = compute_issue_thbc(1_000_000, 500_000, 10_000_000, 100, 50, 3_600).unwrap();
        assert_eq!(new_supply, 1_500_000);
    }

    // F1 ceiling is inclusive: supply + amount == reserve is allowed.
    #[test]
    fn issue_ceiling_is_inclusive() {
        let new_supply = compute_issue_thbc(500_000, 500_000, 1_000_000, 100, 50, 3_600).unwrap();
        assert_eq!(new_supply, 1_000_000);
    }

    // One minor unit over the attested reserve -> PegBreach. This is F1 back in force;
    // between the F6 fix and issue_thbc landing, PegBreach had no call site at all.
    #[test]
    fn issue_one_over_the_ceiling_breaches_the_peg() {
        let e = compute_issue_thbc(500_001, 500_000, 1_000_000, 100, 50, 3_600).unwrap_err();
        assert_eq!(err_code(e), code_of(TreasuryError::PegBreach));
    }

    // F5: exactly at the TTL is still fresh.
    #[test]
    fn issue_at_exactly_the_ttl_is_fresh() {
        assert!(compute_issue_thbc(1, 0, 1_000, 3_700, 100, 3_600).is_ok());
    }

    // F5: one second past the TTL halts issuance.
    #[test]
    fn issue_one_second_past_the_ttl_halts() {
        let e = compute_issue_thbc(1, 0, 1_000, 3_701, 100, 3_600).unwrap_err();
        assert_eq!(err_code(e), code_of(TreasuryError::StaleAttestation));
    }

    // F5 is checked BEFORE F1. With both violated the caller must hear about the stale
    // reserve, because a PegBreach computed from a number nobody vouches for is not
    // actionable information.
    #[test]
    fn issue_reports_staleness_before_peg_breach() {
        let e = compute_issue_thbc(u64::MAX, 0, 0, 999_999, 100, 3_600).unwrap_err();
        assert_eq!(err_code(e), code_of(TreasuryError::StaleAttestation));
    }

    // A future-dated attestation is rejected, not treated as maximally fresh —
    // otherwise a clock-skewed or malicious attestor buys unlimited freshness.
    #[test]
    fn issue_rejects_a_future_dated_attestation() {
        let e = compute_issue_thbc(1, 0, 1_000, 100, 5_000, 3_600).unwrap_err();
        assert_eq!(err_code(e), code_of(TreasuryError::StaleAttestation));
    }

    #[test]
    fn issue_supply_overflow_is_rejected() {
        let e = compute_issue_thbc(u64::MAX, u64::MAX, u64::MAX, 100, 50, 3_600).unwrap_err();
        assert_eq!(err_code(e), code_of(TreasuryError::PegBreach));
    }

    // --- inventory exchange math (F6) ---
    //
    // These replace the old swap/redeem peg tests. The pricing assertions are carried
    // over UNCHANGED and that is the point: the F6 fix must not move the price, only
    // where the tokens come from. What is gone is every assertion about `new_supply`,
    // because there is no longer a supply to change.

    // 3 GRX x rate 4_000_000 / 1e9 = 12 THBC gross; fee 25 bps = 30_000; net 11_970_000.
    // Identical numbers to the pre-F6 `swap_output_matches_rate_and_fee`.
    #[test]
    fn exchange_output_matches_rate_and_fee() {
        let (net, fee) =
            compute_exchange_grx_for_thbc(3_000_000_000, 4_000_000, 25, 1_000_000_000).unwrap();
        assert_eq!(fee, 30_000);
        assert_eq!(net, 11_970_000);
    }

    // F6: a shortfall is a refusal, never a mint. Under the old path this same call
    // minted whatever the reserve allowed; now it is bounded by what the platform holds.
    #[test]
    fn exchange_over_inventory_is_refused() {
        let e = compute_exchange_grx_for_thbc(3_000_000_000, 4_000_000, 0, 11_999_999).unwrap_err();
        assert_eq!(err_code(e), code_of(TreasuryError::InsufficientInventory));
    }

    // Inventory bound is inclusive: paying out the entire inventory is allowed.
    #[test]
    fn exchange_inventory_bound_is_inclusive() {
        let (net, _fee) =
            compute_exchange_grx_for_thbc(3_000_000_000, 4_000_000, 0, 12_000_000).unwrap();
        assert_eq!(net, 12_000_000);
    }

    // F6, stated directly: reserve headroom is not an input to this function at all.
    // A fully-subscribed reserve used to make this call fail with PegBreach; there is
    // now no parameter through which the reserve could influence the result.
    #[test]
    fn exchange_is_independent_of_reserve_and_supply() {
        // Same inputs, ample inventory — succeeds regardless of any reserve state,
        // because no reserve state is passed in. The signature is the assertion.
        let (net, fee) =
            compute_exchange_grx_for_thbc(3_000_000_000, 4_000_000, 25, u64::MAX).unwrap();
        assert_eq!((net, fee), (11_970_000, 30_000));
    }

    // Dust input rounds to zero net output -> ZeroAmount (not a free transfer of 0).
    #[test]
    fn exchange_zero_net_is_rejected() {
        let e = compute_exchange_grx_for_thbc(1, 1, 0, u64::MAX).unwrap_err();
        assert_eq!(err_code(e), code_of(TreasuryError::ZeroAmount));
    }

    // A 100% fee leaves nothing for the user -> ZeroAmount, not a silent no-op.
    #[test]
    fn exchange_full_fee_is_rejected() {
        let e = compute_exchange_grx_for_thbc(3_000_000_000, 4_000_000, 10_000, u64::MAX)
            .unwrap_err();
        assert_eq!(err_code(e), code_of(TreasuryError::ZeroAmount));
    }

    #[test]
    fn exchange_fee_over_100_percent_is_rejected() {
        let e = compute_exchange_grx_for_thbc(3_000_000_000, 4_000_000, 10_001, u64::MAX)
            .unwrap_err();
        assert_eq!(err_code(e), code_of(TreasuryError::InvalidFeeBps));
    }

    // fee overflowing the u64 cast: huge gross with a near-100% fee leaves net small
    // enough to clear the inventory bound, but fee itself exceeds u64 -> MathOverflow.
    #[test]
    fn exchange_fee_u64_overflow_rejected() {
        let e = compute_exchange_grx_for_thbc(10_000_000_000, u64::MAX, 9_999, u64::MAX)
            .unwrap_err();
        assert_eq!(err_code(e), code_of(TreasuryError::MathOverflow));
    }

    // --- reverse direction ---

    // 12 THBC at rate 4_000_000 -> 3 GRX. Same number as the pre-F6 `redeem_output_matches_rate`,
    // with fee_bps 0 to isolate the price from the newly-charged reverse fee.
    #[test]
    fn reverse_exchange_output_matches_rate() {
        let (grx_out, fee) =
            compute_exchange_thbc_for_grx(12_000_000, 4_000_000, 0, 1_000_000_000_000).unwrap();
        assert_eq!(grx_out, 3_000_000_000);
        assert_eq!(fee, 0);
    }

    // The reverse direction now charges the same spread as the forward one. The old
    // redeem path was free, which made a round trip cost the forward fee only.
    #[test]
    fn reverse_exchange_charges_the_same_spread() {
        let (grx_out, fee) =
            compute_exchange_thbc_for_grx(12_000_000, 4_000_000, 25, 1_000_000_000_000).unwrap();
        assert_eq!(fee, 7_500_000); // 25 bps of 3e9
        assert_eq!(grx_out, 2_992_500_000);
    }

    // F6: exchanging more THBC than `thbc_supply` is NOT an error any more. The old
    // burn needed SupplyUnderflow because it decremented supply; a transfer into
    // inventory cannot underflow it, and the token program already bounds the user's
    // balance. Supply is not even a parameter.
    #[test]
    fn reverse_exchange_has_no_supply_guard() {
        let (grx_out, _fee) =
            compute_exchange_thbc_for_grx(12_000_001, 4_000_000, 0, u64::MAX).unwrap();
        assert!(grx_out > 0);
    }

    // Dust input rounds GRX out to zero -> ZeroAmount.
    #[test]
    fn reverse_exchange_dust_zero_out_rejected() {
        let e = compute_exchange_thbc_for_grx(1, 2_000_000_000, 0, u64::MAX).unwrap_err();
        assert_eq!(err_code(e), code_of(TreasuryError::ZeroAmount));
    }

    // The vault drain guard is KEPT: an admin rate change must never let a caller
    // take more GRX than was deposited.
    #[test]
    fn reverse_exchange_over_vault_rejected() {
        let e = compute_exchange_thbc_for_grx(12_000_000, 4_000_000, 0, 2_999_999_999).unwrap_err();
        assert_eq!(err_code(e), code_of(TreasuryError::InsufficientVault));
    }

    #[test]
    fn reverse_exchange_vault_exactly_covers() {
        let (grx_out, _fee) =
            compute_exchange_thbc_for_grx(12_000_000, 4_000_000, 0, 3_000_000_000).unwrap();
        assert_eq!(grx_out, 3_000_000_000);
    }

    #[test]
    fn reverse_exchange_unset_rate_rejected() {
        let e = compute_exchange_thbc_for_grx(12_000_000, 0, 0, u64::MAX).unwrap_err();
        assert_eq!(err_code(e), code_of(TreasuryError::RateNotSet));
    }

    // grx_out overflowing the u64 cast (rate 1 -> grx_out = thbc_in * 1e9) -> MathOverflow.
    #[test]
    fn reverse_exchange_grx_out_overflow_rejected() {
        let e = compute_exchange_thbc_for_grx(u64::MAX, 1, 0, u64::MAX).unwrap_err();
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

    /// Create the THBC inventory vault (`[b"thbc_inventory"]`). Admin-only.
    ///
    /// Must be called once before either `exchange_*` instruction will work; they
    /// refuse with `InventoryVaultNotInitialized` until it is. Funded by transferring
    /// THBC in — nothing in this program mints into it.
    pub fn initialize_thbc_inventory(ctx: Context<InitializeThbcInventory>) -> Result<()> {
        compute_fn!("initialize_thbc_inventory" => {
            instructions::initialize_thbc_inventory(ctx)
        })
    }

    /// Mint THBC against fiat received — the on-ramp (spec §5).
    ///
    /// The **only** instruction that increases `thbc_supply`, and therefore the only
    /// place F1 and F5 can be enforced. Both guards previously lived on the minting
    /// swap; the F6 fix removed that instruction and left them unreachable until this
    /// restored them to where they belong.
    ///
    /// F3 is enforced by the runtime, not by this code: the `[b"deposit",
    /// H(bank_ref)]` nullifier is created with `init` in the SAME instruction as the
    /// mint, so a replayed bank webhook is rejected at the account level.
    pub fn issue_thbc(ctx: Context<IssueThbc>, amount: u64, bank_ref_hash: [u8; 32]) -> Result<()> {
        compute_fn!("issue_thbc" => {
            instructions::issue_thbc(ctx, amount, bank_ref_hash)
        })
    }

    /// Create the redemption escrow vault (`[b"redeem_escrow"]`). Admin-only, once.
    pub fn initialize_redemption_escrow(ctx: Context<InitializeRedemptionEscrow>) -> Result<()> {
        compute_fn!("initialize_redemption_escrow" => {
            instructions::initialize_redemption_escrow(ctx)
        })
    }

    /// Commit THBC to a fiat redemption — spec §6.1 steps 1–2. **F7.**
    ///
    /// USER-SIGNED: `B` cannot redeem on a holder's behalf. The amount moves into
    /// escrow and stays inside `thbc_supply` — it is NOT burned, which is exactly what
    /// leaves room for `reclaim_redemption` if the issuer never wires.
    pub fn redeem_thbc_for_fiat(
        ctx: Context<RedeemThbcForFiat>,
        amount: u64,
        seq: u64,
    ) -> Result<()> {
        compute_fn!("redeem_thbc_for_fiat" => {
            instructions::redeem_thbc_for_fiat(ctx, amount, seq)
        })
    }

    /// Burn an escrowed redemption once the fiat is wired — spec §6.1 step 5. **F7.**
    ///
    /// The only place `thbc_supply` decreases. Closes the record, so a double-confirm
    /// and any later reclaim both fail at the account level.
    pub fn confirm_redemption(ctx: Context<ConfirmRedemption>) -> Result<()> {
        compute_fn!("confirm_redemption" => {
            instructions::confirm_redemption(ctx)
        })
    }

    /// Recover escrowed THBC after Δ with no confirmation — spec §6.3. **F7.**
    ///
    /// USER-SIGNED, and deliberately NOT gated on `paused`: pausing must never trap a
    /// holder's tokens in escrow. Supply is untouched, because the tokens were moved
    /// rather than burned.
    pub fn reclaim_redemption(ctx: Context<ReclaimRedemption>) -> Result<()> {
        compute_fn!("reclaim_redemption" => {
            instructions::reclaim_redemption(ctx)
        })
    }

    /// Exchange GRX → THBC out of platform-held inventory.
    ///
    /// **Replaces `swap_grx_for_thbc`, which minted (F6).** Both legs are transfers of
    /// tokens that already exist: `thbc_supply` and `attested_reserve` are untouched,
    /// so a volatile asset never enters the backing set of a fiat-referenced token.
    /// Bounded by the inventory vault's live balance, not by reserve headroom. The
    /// attestation-freshness check is deliberately absent — F5 guards *issuance*, and
    /// this issues nothing.
    pub fn exchange_grx_for_thbc(ctx: Context<ExchangeGrxForThbc>, grx_in: u64) -> Result<()> {
        compute_fn!("exchange_grx_for_thbc" => {
            instructions::exchange_grx_for_thbc(ctx, grx_in)
        })
    }

    /// Exchange THBC → GRX from the swap vault.
    ///
    /// **Replaces `redeem_thbc_for_grx`, which burned (F6).** The incoming THBC returns
    /// to the inventory vault instead of being destroyed, so supply is unchanged and
    /// `thbc_supply` stays equal to "THBC issued against fiat" — the quantity F2 is an
    /// identity over. Not named `redeem_*`: redemption here means *fiat* redemption
    /// (spec §6), a user-signed burn against a THB payout with a Δ-timelocked escrow.
    pub fn exchange_thbc_for_grx(ctx: Context<ExchangeThbcForGrx>, thbc_in: u64) -> Result<()> {
        compute_fn!("exchange_thbc_for_grx" => {
            instructions::exchange_thbc_for_grx(ctx, thbc_in)
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
