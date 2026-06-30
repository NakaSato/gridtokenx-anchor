use anchor_lang::prelude::*;

#[account]
pub struct OrderNullifier {
    pub order_id: [u8; 16],   // Original UUID of the order
    pub authority: Pubkey,    // The signer of the order
    pub filled_amount: u64,   // How much of this order has been settled on-chain
    pub bump: u8,             // PDA bump
}

impl OrderNullifier {
    pub const LEN: usize = 8 + 16 + 32 + 8 + 1; // Discriminator + order_id + pubkey + filled_amount + bump
}

/// Per-MATCH replay guard. `OrderNullifier` only caps cumulative fill against an order's
/// `energy_amount` — it does NOT stop the SAME partial match being settled twice while the
/// order still has headroom (the F3c double-settle). This marker PDA is keyed by the unique
/// per-match `trade_id` the off-chain matcher assigns, created on first settle and so present
/// (program-owned) on any replay. Existence IS the guard — a re-sent match (re-signed with a
/// fresh blockhash, defeating the bridge's tx-hash dedup) hits an already-created PDA and
/// reverts `MatchAlreadySettled`, regardless of order headroom. Created atomically with the
/// settle, so a never-committed match leaves no marker and a genuine retry still proceeds.
#[account]
pub struct TradeNullifier {
    pub bump: u8, // PDA bump
}

impl TradeNullifier {
    pub const LEN: usize = 8 + 1; // Discriminator + bump
}
