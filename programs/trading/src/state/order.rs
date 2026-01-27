// Order and Trade state definitions

use anchor_lang::prelude::*;

/// Order account for trading
#[account(zero_copy)]
#[repr(C)]
pub struct Order {
    pub seller: Pubkey,         // 32
    pub buyer: Pubkey,          // 32
    pub order_id: u64,          // 8
    pub amount: u64,            // 8
    pub filled_amount: u64,     // 8
    pub price_per_kwh: u64,     // 8
    pub order_type: u8,         // 1 (OrderType)
    pub status: u8,             // 1 (OrderStatus)
    pub _padding: [u8; 6],      // 6
    pub created_at: i64,        // 8
    pub expires_at: i64,        // 8
}

#[account]
#[derive(InitSpace)]
pub struct TradeRecord {
    pub sell_order: Pubkey,
    pub buy_order: Pubkey,
    pub seller: Pubkey,
    pub buyer: Pubkey,
    pub amount: u64,
    pub price_per_kwh: u64,
    pub total_value: u64,
    pub fee_amount: u64,
    pub executed_at: i64,
}

// Enums (keep for logic, but don't put in zero_copy directly if Pod errors persist)
#[derive(AnchorSerialize, AnchorDeserialize, Copy, Clone, PartialEq, Eq, InitSpace)]
pub enum OrderType {
    Sell,
    Buy,
}

#[derive(AnchorSerialize, AnchorDeserialize, Copy, Clone, PartialEq, Eq, InitSpace)]
pub enum OrderStatus {
    Active,
    PartiallyFilled,
    Completed,
    Cancelled,
    Expired,
}
