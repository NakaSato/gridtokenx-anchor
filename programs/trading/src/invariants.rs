//! Invariant Checks for Trading Program
//! 
//! This module defines critical invariants that must hold at all times
//! for the trading system to be considered correct and secure.

use anchor_lang::prelude::*;

/// Invariant check results
#[derive(Debug, Clone, PartialEq)]
pub enum InvariantResult {
    /// Invariant holds
    Ok,
    /// Invariant violated with reason
    Violated(String),
}

impl InvariantResult {
    pub fn is_ok(&self) -> bool {
        matches!(self, InvariantResult::Ok)
    }
    
    pub fn is_violated(&self) -> bool {
        matches!(self, InvariantResult::Violated(_))
    }
}

/// Trading system invariants
pub struct TradingInvariants;

impl TradingInvariants {
    /// Invariant 1: Token supply conservation
    /// 
    /// The total supply of tokens must equal the sum of all balances.
    /// No tokens can be created or destroyed except through mint/burn.
    /// 
    /// Formula: total_supply = sum(all_balances) + locked_in_orders
    pub fn check_token_conservation(
        total_supply: u64,
        circulating_balances: u64,
        locked_in_orders: u64,
        pending_settlements: u64,
    ) -> InvariantResult {
        let expected = circulating_balances
            .checked_add(locked_in_orders)
            .and_then(|v| v.checked_add(pending_settlements));
        
        match expected {
            Some(sum) if sum == total_supply => InvariantResult::Ok,
            Some(sum) => InvariantResult::Violated(format!(
                "Token conservation violated: supply={}, sum={}", 
                total_supply, sum
            )),
            None => InvariantResult::Violated(
                "Overflow in token conservation check".to_string()
            ),
        }
    }

    /// Invariant 2: Order book consistency
    /// 
    /// All orders in the order book must have:
    /// - amount > 0
    /// - price > 0
    /// - valid owner
    /// - correct status
    pub fn check_order_validity(
        amount: u64,
        price: u64,
        status: u8,
        owner: Pubkey,
    ) -> InvariantResult {
        if amount == 0 {
            return InvariantResult::Violated("Order amount must be > 0".to_string());
        }
        if price == 0 {
            return InvariantResult::Violated("Order price must be > 0".to_string());
        }
        if owner == Pubkey::default() {
            return InvariantResult::Violated("Order owner cannot be default".to_string());
        }
        // Status: 0=Active, 1=Filled, 2=Cancelled, 3=Expired
        if status > 3 {
            return InvariantResult::Violated(format!("Invalid order status: {}", status));
        }
        InvariantResult::Ok
    }

    /// Invariant 3: REC lifecycle validity
    /// 
    /// A retired REC must have a corresponding retirement record.
    /// Once retired, a REC cannot be transferred or re-retired.
    pub fn check_rec_lifecycle(
        is_retired: bool,
        has_retirement_record: bool,
        retired_at: i64,
        current_time: i64,
    ) -> InvariantResult {
        if is_retired && !has_retirement_record {
            return InvariantResult::Violated(
                "Retired REC must have retirement record".to_string()
            );
        }
        if is_retired && retired_at > current_time {
            return InvariantResult::Violated(
                "Retirement timestamp cannot be in the future".to_string()
            );
        }
        if !is_retired && has_retirement_record {
            return InvariantResult::Violated(
                "Non-retired REC should not have retirement record".to_string()
            );
        }
        InvariantResult::Ok
    }

    /// Invariant 4: Confidential balance non-negativity
    /// 
    /// Although encrypted, we must ensure that operations maintain
    /// the invariant that balances cannot go negative.
    /// This is enforced via ZK proofs in production.
    pub fn check_confidential_balance_valid(
        encrypted_amount: &[u8; 64],
        has_valid_proof: bool,
    ) -> InvariantResult {
        // In production, this would verify the ZK proof
        // For now, we check that a proof was provided
        if !has_valid_proof {
            return InvariantResult::Violated(
                "Confidential balance change requires valid ZK proof".to_string()
            );
        }
        // Check that encryption is not all zeros (empty/uninitialized)
        let is_initialized = encrypted_amount.iter().any(|&b| b != 0);
        if !is_initialized {
            return InvariantResult::Violated(
                "Confidential balance appears uninitialized".to_string()
            );
        }
        InvariantResult::Ok
    }

    /// Invariant 5: Settlement atomicity
    /// 
    /// A settlement must either complete fully or not at all.
    /// Partial settlements are only allowed for predetermined split orders.
    pub fn check_settlement_atomicity(
        buy_order_filled: bool,
        sell_order_filled: bool,
        tokens_transferred: bool,
        payment_transferred: bool,
    ) -> InvariantResult {
        let actions = [buy_order_filled, sell_order_filled, tokens_transferred, payment_transferred];
        let all_done = actions.iter().all(|&v| v);
        let none_done = actions.iter().all(|&v| !v);
        
        if all_done || none_done {
            InvariantResult::Ok
        } else {
            InvariantResult::Violated(
                "Settlement partially complete - atomicity violated".to_string()
            )
        }
    }

    /// Invariant 6: Authority validation
    /// 
    /// Only authorized parties can perform privileged operations.
    pub fn check_authority(
        expected_authority: &Pubkey,
        actual_signer: &Pubkey,
        operation: &str,
    ) -> InvariantResult {
        if expected_authority != actual_signer {
            return InvariantResult::Violated(format!(
                "Unauthorized {} attempt: expected {}, got {}",
                operation, expected_authority, actual_signer
            ));
        }
        InvariantResult::Ok
    }

    /// Invariant 7: Price bounds
    /// 
    /// Prices must be within reasonable bounds to prevent manipulation.
    pub fn check_price_bounds(
        price: u64,
        min_price: u64,
        max_price: u64,
    ) -> InvariantResult {
        if price < min_price {
            return InvariantResult::Violated(format!(
                "Price {} below minimum {}", price, min_price
            ));
        }
        if price > max_price {
            return InvariantResult::Violated(format!(
                "Price {} above maximum {}", price, max_price
            ));
        }
        InvariantResult::Ok
    }

    /// Invariant 8: Carbon offset consistency
    /// 
    /// Total minted carbon offset must equal sum of all certificates.
    pub fn check_carbon_offset_consistency(
        marketplace_total_offset: u64,
        sum_certificate_offsets: u64,
        sum_retired_offsets: u64,
    ) -> InvariantResult {
        // total_minted = active + retired
        let expected = sum_certificate_offsets
            .checked_add(sum_retired_offsets);
        
        match expected {
            Some(sum) if sum == marketplace_total_offset => InvariantResult::Ok,
            Some(sum) => InvariantResult::Violated(format!(
                "Carbon offset inconsistency: marketplace={}, calculated={}",
                marketplace_total_offset, sum
            )),
            None => InvariantResult::Violated(
                "Overflow in carbon offset check".to_string()
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_token_conservation_valid() {
        let result = TradingInvariants::check_token_conservation(
            1000, // total supply
            800,  // circulating
            150,  // locked
            50,   // pending
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_token_conservation_violated() {
        let result = TradingInvariants::check_token_conservation(
            1000, // total supply
            800,  // circulating
            200,  // locked
            100,  // pending - exceeds supply!
        );
        assert!(result.is_violated());
    }

    #[test]
    fn test_order_validity_zero_amount() {
        let result = TradingInvariants::check_order_validity(
            0, // zero amount
            100,
            0,
            Pubkey::new_unique(),
        );
        assert!(result.is_violated());
    }

    #[test]
    fn test_order_validity_valid() {
        let result = TradingInvariants::check_order_validity(
            100,
            50,
            0, // Active
            Pubkey::new_unique(),
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_rec_lifecycle_valid_active() {
        let result = TradingInvariants::check_rec_lifecycle(
            false, // not retired
            false, // no record
            0,
            1000000,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_rec_lifecycle_valid_retired() {
        let result = TradingInvariants::check_rec_lifecycle(
            true,  // retired
            true,  // has record
            999999,
            1000000,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_rec_lifecycle_violated() {
        let result = TradingInvariants::check_rec_lifecycle(
            true,  // retired
            false, // no record - violation!
            999999,
            1000000,
        );
        assert!(result.is_violated());
    }

    #[test]
    fn test_settlement_atomicity_valid() {
        // All done
        let result = TradingInvariants::check_settlement_atomicity(
            true, true, true, true
        );
        assert!(result.is_ok());

        // None done
        let result = TradingInvariants::check_settlement_atomicity(
            false, false, false, false
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_settlement_atomicity_violated() {
        // Partial - violation!
        let result = TradingInvariants::check_settlement_atomicity(
            true, true, false, true
        );
        assert!(result.is_violated());
    }

    #[test]
    fn test_price_bounds() {
        assert!(TradingInvariants::check_price_bounds(50, 10, 100).is_ok());
        assert!(TradingInvariants::check_price_bounds(5, 10, 100).is_violated());
        assert!(TradingInvariants::check_price_bounds(150, 10, 100).is_violated());
    }
}
