use anchor_lang::prelude::*;
use governance::GovernanceConfig;
use crate::error::TradingError;

pub fn get_governance_config(info: &AccountInfo) -> Result<GovernanceConfig> {
    let data = info.try_borrow_data()?;
    if data.len() < 8 {
        return Err(TradingError::InvalidGovernanceAccount.into());
    }
    let mut ptr = &data[8..];
    GovernanceConfig::deserialize(&mut ptr).map_err(|_| TradingError::InvalidGovernanceAccount.into())
}

/// Validate a caller-supplied `Order.expires_at` (absolute unix seconds).
///
/// Every order-creating instruction used to stamp `clock.unix_timestamp + 86400`,
/// so the PDA claimed a 24h lifetime no matter what expiry the submitting client
/// had actually agreed to. Off-chain, the trading service resolves a real expiry
/// per order (`trading_core::order_policy::resolve_expires_at`, default 15 min)
/// and the reaper retires the book on it; `settle_offchain_match` already enforces
/// the *signed* expiry. The order record was the one place still asserting a
/// number nobody chose — so the expiry is now passed in.
///
/// Sentinel: `0` means **no expiry**, matching how `settle_offchain_match` reads
/// `OffchainOrderPayload::expires_at` (`expires_at == 0 || now < expires_at`).
/// Keeping one meaning for 0 across both paths is deliberate: a match settling
/// against a payload with no expiry should not be facing an order PDA that claims
/// one, or vice versa.
///
/// Anything else must be strictly in the future. A past expiry is rejected rather
/// than stored, because an order that can never legitimately fill has no business
/// paying rent as an active PDA — and a negative value is a client bug, not a
/// licence to create an order the off-chain book will reap on its next tick.
pub fn validate_order_expiry(requested_expires_at: i64, now: i64) -> Result<i64> {
    if requested_expires_at == 0 {
        return Ok(0);
    }
    require!(requested_expires_at > now, TradingError::OrderExpired);
    Ok(requested_expires_at)
}

/// Reject a pairing whose either leg has already lapsed.
///
/// `validate_order_expiry` above only checks the expiry a client SUBMITS; until this
/// helper existed nothing read `Order.expires_at` back, so the field was enforced at
/// creation and then ignored — a lapsed order still matched and still settled on every
/// on-chain-order path (`match_orders`, `sharded_match_orders`,
/// `execute_atomic_settlement`), and a TTL meant nothing once the order existed.
///
/// Semantics are deliberately identical to the signed-payload path
/// (`settle_offchain_match`: `expires_at == 0 || now < expires_at`) so one order cannot be
/// live on one path and lapsed on the other: `0` is the no-expiry sentinel, and the
/// comparison is STRICT — `expires_at == now` is already lapsed.
pub fn require_orders_live(buy_expires_at: i64, sell_expires_at: i64, now: i64) -> Result<()> {
    require!(
        buy_expires_at == 0 || now < buy_expires_at,
        TradingError::OrderExpired
    );
    require!(
        sell_expires_at == 0 || now < sell_expires_at,
        TradingError::OrderExpired
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{require_orders_live, validate_order_expiry};

    const NOW: i64 = 1_800_000_000;

    #[test]
    fn both_legs_without_expiry_are_live() {
        assert!(require_orders_live(0, 0, NOW).is_ok());
    }

    #[test]
    fn future_expiries_are_live() {
        assert!(require_orders_live(NOW + 1, NOW + 1, NOW).is_ok());
    }

    /// Strict: at the expiry second the order is lapsed, matching the signed-payload path.
    #[test]
    fn expiry_equal_to_now_is_lapsed() {
        assert!(require_orders_live(NOW, NOW + 10, NOW).is_err());
        assert!(require_orders_live(NOW + 10, NOW, NOW).is_err());
    }

    #[test]
    fn either_lapsed_leg_rejects() {
        assert!(require_orders_live(NOW - 1, 0, NOW).is_err());
        assert!(require_orders_live(0, NOW - 1, NOW).is_err());
    }

    /// The sentinel is not "expired long ago": 0 stays live no matter how large `now` is.
    #[test]
    fn sentinel_survives_a_large_clock() {
        assert!(require_orders_live(0, 0, i64::MAX).is_ok());
    }

    /// 0 is the no-expiry sentinel, stored verbatim — the same reading
    /// `settle_offchain_match` gives it.
    #[test]
    fn zero_means_no_expiry() {
        assert_eq!(validate_order_expiry(0, NOW).unwrap(), 0);
    }

    /// A future expiry is stored exactly as sent: the off-chain row and the PDA
    /// must agree to the second, or a reader cannot tell which one is authoritative.
    #[test]
    fn future_expiry_is_stored_verbatim() {
        assert_eq!(validate_order_expiry(NOW + 900, NOW).unwrap(), NOW + 900);
        assert_eq!(validate_order_expiry(NOW + 1, NOW).unwrap(), NOW + 1);
        assert_eq!(
            validate_order_expiry(NOW + 86_400, NOW).unwrap(),
            NOW + 86_400
        );
    }

    /// `now` itself is already expired — the settlement check is `now < expires_at`,
    /// so an order stamped exactly `now` could never settle.
    #[test]
    fn expiry_at_or_before_now_is_rejected() {
        assert!(validate_order_expiry(NOW, NOW).is_err());
        assert!(validate_order_expiry(NOW - 1, NOW).is_err());
        assert!(validate_order_expiry(1, NOW).is_err());
        assert!(validate_order_expiry(i64::MIN, NOW).is_err());
    }

    /// No upper bound on chain: the off-chain edge caps client lifetimes
    /// (`ORDER_MAX_TTL_SECS`), and a second, different horizon here would reject
    /// orders the platform itself considers valid.
    #[test]
    fn far_future_expiry_is_accepted() {
        assert_eq!(
            validate_order_expiry(i64::MAX, NOW).unwrap(),
            i64::MAX
        );
    }
}
