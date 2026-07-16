pub mod cancel_order;
pub mod create_buy_order;
pub mod create_sell_order;
pub mod escrow;
pub mod initialize_market;
pub mod initialize_program;
pub mod initialize_shard;
pub mod initialize_zone_capacity;
pub mod initialize_zone_config;
pub mod initialize_zone_market;
pub mod initialize_zone_shard;
pub mod match_orders;
#[cfg(feature = "privacy")]
pub mod private_shield;
#[cfg(feature = "privacy")]
pub mod private_transfer;
pub mod record_order_custodial;
pub mod set_settlement_thbg_mint;
pub mod settle_offchain;
pub mod sharded_match_orders;
pub mod submit_limit_order;
pub mod submit_market_order;
pub mod submit_sharded_limit_order;
pub mod tariff;
pub mod update_depth;
pub mod update_market_params;
pub mod update_price_history;

pub use cancel_order::*;
pub use create_buy_order::*;
pub use create_sell_order::*;
pub use escrow::*;
pub use initialize_market::*;
pub use initialize_program::*;
pub use initialize_shard::*;
pub use initialize_zone_capacity::*;
pub use initialize_zone_config::*;
pub use initialize_zone_market::*;
pub use initialize_zone_shard::*;
pub use match_orders::*;
#[cfg(feature = "privacy")]
pub use private_shield::*;
#[cfg(feature = "privacy")]
pub use private_transfer::*;
pub use record_order_custodial::*;
pub use set_settlement_thbg_mint::*;
pub use settle_offchain::*;
pub use sharded_match_orders::*;
pub use submit_limit_order::*;
pub use submit_market_order::*;
pub use submit_sharded_limit_order::*;
pub use tariff::*;
pub use update_depth::*;
pub use update_market_params::*;
pub use update_price_history::*;
// Note: clear_auction / execute_auction_matches / execute_atomic_settlement remain
// inline in lib.rs — the auction arg/return types (AuctionOrder, ClearAuctionResult, …)
// live at crate root to avoid the Anchor IDL macro issue, and
// ExecuteAtomicSettlementContext sits at the BPF stack ceiling; both are kept inline
// deliberately (see lib.rs).
