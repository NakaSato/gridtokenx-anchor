// Trading program state module
// Re-exports all state structs

pub mod market;
pub mod order;
pub mod zone_market;
pub mod nullifier;
pub mod zone_config;
pub mod tariff_config;
#[cfg(feature = "privacy")]
pub mod private_balance;

pub use market::*;
pub use order::*;
pub use zone_market::*;
pub use nullifier::*;
pub use zone_config::*;
pub use tariff_config::*;
#[cfg(feature = "privacy")]
pub use private_balance::*;

use anchor_lang::prelude::*;

/// Okamoto proof of knowledge of the amount commitment's opening.
/// `challenge` = c, `response` = z_v ‖ z_r. Produced by wasm-zk
/// `create_transfer_proof`; verified by `zk_verify::verify_balance_proof`.
///
/// Lives here un-gated (not in the `privacy`-gated instruction module):
/// anchor's idl-build generates argument glue for every `#[program]` fn
/// regardless of its `#[cfg]`, so this type must exist even when the
/// `privacy` feature is off or `anchor build` fails with E0425.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct BalanceProof {
    pub challenge: [u8; 32],
    pub response: [u8; 64],
}
