# Trading Program

**Program ID:** `Fmk6vb74MjZpXVE9kAS5q4U5L8hr2AEJcDikfRSFTiyY`

The Trading program implements the Peer-to-Peer (P2P) energy market utilizing matching logic (Double Auction support) for order settlement. It integrates with Governance for certificate validation.

## Account Structures

### Market
Global market state.
**PDA**: `["market"]`.

```rust
#[account]
pub struct Market {
    pub authority: Pubkey,
    pub active_orders: u64,
    pub total_volume: u64,
    pub total_trades: u64,
    pub market_fee_bps: u16,        // Basis Points (e.g., 25 = 0.25%)
    pub created_at: i64,
    
    // Config
    pub clearing_enabled: bool,
    pub batch_config: BatchConfig,  // Nested struct
    
    // Analysis
    pub last_clearing_price: u64,
    pub volume_weighted_price: u64,
}
```

### Order
Represents a single buy or sell intent.
**PDA**: `["order", authority, timestamp_seed]`.

```rust
#[account]
pub struct Order {
    pub seller: Pubkey,             // Defaults to default() for Buy orders
    pub buyer: Pubkey,              // Defaults to default() for Sell orders
    pub amount: u64,                // Energy amount (kWh)
    pub filled_amount: u64,         // Amount matched so far
    pub price_per_kwh: u64,         // Limit price
    pub order_type: OrderType,      // Buy or Sell
    pub status: OrderStatus,        // Active, PartiallyFilled, Filled, Cancelled
    pub created_at: i64,
    pub expires_at: i64,
}
```

## Market Equations

### Matching Condition
For a trade to occur between a Buyer ($B$) and a Seller ($S$):

$$ P_{bid} \ge P_{ask} $$

Where:
- $P_{bid}$ is the Buyer's max price per kWh.
- $P_{ask}$ is the Seller's min price per kWh.

### Fee Calculation
The market fee is calculated in basis points (bps):

$$ Fee = \frac{TotalValue \times Fee_{bps}}{10000} $$

Where $TotalValue = Amount_{matched} \times Price_{execution}$.

## Instructions

### `initialize`
Basic program initialization.

### `initialize_market`
Sets up the global market state.
- **Default Fee**: 25 bps (0.25%).
- **Batch Config**: Enabled=false, Max=100 orders.

### `create_sell_order`
Places an order to sell energy.
- **PDA**: `["order", seller_key, seed]`.
- **Validation**:
  - `energy_amount > 0`
  - `price_per_kwh > 0`
  - **ERC Check**: Verifies `ErcCertificate` is Valid, not expired, and `validated_for_trading`.
- **Effect**: Increases `market.active_orders`.

### `create_buy_order`
Places an order to buy energy.
- **PDA**: `["order", buyer_key, seed]`.
- **Validation**: `amount > 0`, `max_price > 0`.

### `match_orders`
Executes a trade between a specific Buy Order and Sell Order.
- **Validation**:
  - Both orders must be `Active` or `PartiallyFilled`.
  - $P_{buy} \ge P_{sell}$.
- **Logic**:
  - Updates `filled_amount` for both orders.
  - If `filled_amount == amount`, status becomes `Filled`.
  - Emits `TradeExecuted` event.
