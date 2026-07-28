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
