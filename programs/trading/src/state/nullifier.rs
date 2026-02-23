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
