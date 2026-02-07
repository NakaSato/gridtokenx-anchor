use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};

/// Auction State Lifecycle
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum AuctionState {
    /// Orders can be accepted.
    Open = 0,
    /// No new orders. Calculating clearing price.
    Locked = 1,
    /// Price determined. Ready for settlement.
    Cleared = 2,
    /// All trades settled. Account can be reset/archived.
    Settled = 3,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, Pod, Zeroable)]
#[repr(C)]
pub struct AuctionOrder {
    pub order_id: Pubkey, // 32
    pub price: u64,       // 8
    pub amount: u64,      // 8
    pub timestamp: i64,   // 8
    pub is_bid: u8,       // 1 (0=Sell, 1=Buy)
    pub _padding: [u8; 7], // 7 -> Total 64
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, Pod, Zeroable)]
#[repr(C)]
pub struct AuctionCommitment {
    pub order_id: Pubkey, // 32
    pub hash: [u8; 32],   // 32
    pub collateral_locked: u64, // 8
    pub _padding: [u8; 8], // 8 -> Total 80
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Pod, Zeroable)]
#[repr(C)]
pub struct ConfidentialAuctionOrder {
    pub order_id: Pubkey,               // 32
    pub encrypted_price: [u8; 64],      // 64 (ElGamal)
    pub encrypted_amount: [u8; 64],     // 64 (ElGamal)
    pub timestamp: i64,                 // 8
    pub is_bid: u8,                     // 1 (0=Sell, 1=Buy)
    pub _padding: [u8; 7],              // 7 -> Total 176
}

impl Default for ConfidentialAuctionOrder {
    fn default() -> Self {
        Self {
            order_id: Pubkey::default(),
            encrypted_price: [0u8; 64],
            encrypted_amount: [0u8; 64],
            timestamp: 0,
            is_bid: 0,
            _padding: [0u8; 7],
        }
    }
}

/// Represents a batch of orders for a specific time window
/// Optimized for Zero-Copy access
#[account(zero_copy)]
#[repr(C)]
pub struct AuctionBatch {
    /// Market this batch belongs to
    pub market: Pubkey,         // 32
    /// Batch ID (usually start timestamp)
    pub batch_id: u64,          // 8
    
    /// Clearing Price (MCP) - set when Cleared
    pub clearing_price: u64,    // 8
    /// Total volume to be traded at clearing price
    pub clearing_volume: u64,   // 8

    pub start_time: i64,        // 8
    pub end_time: i64,          // 8

    /// Current state
    pub state: u8,              // 1 
    pub bump: u8,               // 1
    pub locked: u8,             // 1 (Re-entrancy Guard)
    pub _padding: [u8; 1],      // 1 -> Total 80
    
    pub order_count: u32,              // 4 
    pub commitment_count: u32,         // 4
    pub confidential_order_count: u32, // 4
    
    /// Storing fixed number of orders (20 max)
    pub orders: [AuctionOrder; 20], 
    /// Storing fixed number of commitments (20 max)
    pub commitments: [AuctionCommitment; 20],
    /// Storing fixed number of confidential orders (20 max)
    pub confidential_orders: [ConfidentialAuctionOrder; 20],
}

#[error_code]
pub enum AuctionError {
    #[msg("Auction is not open for orders")]
    AuctionNotOpen,
    #[msg("Auction batch is full")]
    BatchFull,
    #[msg("Auction is not ready for resolution")]
    AuctionNotReady,
    #[msg("Auction is already resolved")]
    AuctionAlreadyResolved,
    #[msg("Price mismatch for settlement")]
    PriceMismatch,
    #[msg("Invalid order index")]
    InvalidOrderIndex,
}

/// Helper to calculate Uniform Clearing Price
/// Returns (price, volume)
pub fn calculate_clearing_price(orders_slice: &[AuctionOrder]) -> (u64, u64) {
    // Filter active orders based on slice (assumed to be orders[0..order_count])
    // We can't easily return references to local slice elements if we sort.
    // So we collect indices or copy them (they are small, 64 bytes).
    // Copying 50 orders is cheap (3200 bytes).
    
    let mut bids: Vec<AuctionOrder> = orders_slice.iter()
        .filter(|o| o.is_bid == 1)
        .cloned()
        .collect();
    let mut asks: Vec<AuctionOrder> = orders_slice.iter()
        .filter(|o| o.is_bid == 0)
        .cloned()
        .collect();

    // Sort Bids DESC (highest paying first)
    bids.sort_by(|a, b| b.price.cmp(&a.price));
    // Sort Asks ASC (lowest selling first)
    asks.sort_by(|a, b| a.price.cmp(&b.price));
    
    let mut clearing_price = 0u64;
    let mut max_volume = 0u64;

    // Collect all unique price points
    let mut prices: Vec<u64> = orders_slice.iter().map(|o| o.price).collect();
    prices.sort();
    prices.dedup();
    
    for p in prices {
        let supply: u64 = asks.iter()
            .filter(|o| o.price <= p)
            .map(|o| o.amount)
            .sum();
            
        let demand: u64 = bids.iter()
            .filter(|o| o.price >= p)
            .map(|o| o.amount)
            .sum();
            
        let volume = std::cmp::min(supply, demand);
        
        if volume > max_volume {
            max_volume = volume;
            clearing_price = p;
        } else if volume == max_volume && volume > 0 {
             // Maximize clearing price for seller benefit (msg).
             clearing_price = p;
        }
    }

    (clearing_price, max_volume)
}
