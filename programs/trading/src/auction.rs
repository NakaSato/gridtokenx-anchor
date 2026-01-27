use anchor_lang::prelude::*;


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

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct AuctionOrder {
    pub order_id: Pubkey,
    pub price: u64,
    pub amount: u64,
    pub is_bid: bool, // true = Buy, false = Sell
    pub timestamp: i64,
}

/// Represents a batch of orders for a specific time window
#[account]
#[derive(Default)]
pub struct AuctionBatch {
    /// Market this batch belongs to
    pub market: Pubkey,
    /// Batch ID (usually start timestamp)
    pub batch_id: u64,
    /// Current state
    pub state: u8, // AuctionState
    
    /// Clearing Price (MCP) - set when Cleared
    pub clearing_price: u64,
    /// Total volume to be traded at clearing price
    pub clearing_volume: u64,
    
    /// Simplified on-chain storage:
    /// In a real mainnet impl, we might not store all orders active here due to size limits.
    /// We would use a separate Orderbook account or a Merkle root.
    /// For this version, we'll store a capped number of orders for the MVP.
    pub orders: Vec<AuctionOrder>, 
    
    pub start_time: i64,
    pub end_time: i64,
    
    pub bump: u8,
}

impl AuctionBatch {
    // 8 + 32 + 8 + 1 + 8 + 8 + 4 + (Vec overhead approx) + 8 + 8 + 1
    // Allocating space for ~50 orders for MVP simulation
    pub const LEN: usize = 8 + 32 + 8 + 1 + 8 + 8 + 4 + (50 * (32 + 8 + 8 + 1 + 8)) + 8 + 8 + 1;
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
}

/// Helper to calculate Uniform Clearing Price
/// Returns (price, volume)
pub fn calculate_clearing_price(orders: &[AuctionOrder]) -> (u64, u64) {
    let mut bids: Vec<&AuctionOrder> = orders.iter().filter(|o| o.is_bid).collect();
    let mut asks: Vec<&AuctionOrder> = orders.iter().filter(|o| !o.is_bid).collect();

    // Sort Bids DESC (highest paying first)
    bids.sort_by(|a, b| b.price.cmp(&a.price));
    // Sort Asks ASC (lowest selling first)
    asks.sort_by(|a, b| a.price.cmp(&b.price));
    
    let mut clearing_price = 0u64;
    let mut max_volume = 0u64;

    // Simplified intersection logic:
    // Iterate through price points present in the orders to find intersection
    // This is O(N^2) in worst case if we iterate points, but O(N) if we walk the curves.
    // Let's walk the curves.
    
    // We need to construct the aggregate curves.
    // However, a simpler way for the MVP is to check every price point defined by an order
    // and see which one maximizes min(supply, demand).
    
    // Collect all unique price points
    let mut prices: Vec<u64> = orders.iter().map(|o| o.price).collect();
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
             // If volume is same, prefer the price closer to mid-market or just keep higher if maximizing seller surplus?
             // Standard is usually to take the mid-point of the overlap, but here we just take the highest valid price for seller benefit (msg).
             // or keep lowest for buyer benefit. Let's maximize clearing price for now (pro-producer).
             clearing_price = p;
        }
    }

    (clearing_price, max_volume)
}
