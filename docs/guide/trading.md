# Trading Program

The Trading program provides order book functionality for peer-to-peer energy trading.

## Overview

| Property | Value |
|----------|-------|
| Program ID | `trading` |
| Order Types | Buy, Sell |
| Matching | First-come-first-served |

## Instructions

### `create_market`

Create a new trading market.

```rust
pub fn create_market(ctx: Context<CreateMarket>, symbol: String) -> Result<()>
```

### `create_buy_order`

Place a buy order.

```rust
pub fn create_buy_order(
    ctx: Context<CreateOrder>,
    amount: u64,
    price: u64
) -> Result<()>
```

**Accounts:**
- `market` - Market PDA
- `order` - Order PDA
- `authority` - Order creator

**Example:**
```typescript
await program.methods
  .createBuyOrder(
    new BN(100 * 1e6),  // 100 energy units
    new BN(50 * 1e6)    // 50 tokens per unit
  )
  .accounts({
    market: marketPda,
    order: orderPda,
    authority: buyer.publicKey,
  })
  .signers([buyer])
  .rpc();
```

### `create_sell_order`

Place a sell order.

```rust
pub fn create_sell_order(
    ctx: Context<CreateOrder>,
    amount: u64,
    price: u64
) -> Result<()>
```

### `cancel_order`

Cancel an existing order.

```rust
pub fn cancel_order(ctx: Context<CancelOrder>) -> Result<()>
```

### `match_orders`

Match buy and sell orders.

```rust
pub fn match_orders(ctx: Context<MatchOrders>) -> Result<()>
```

## Account Structures

### Market

```rust
#[account]
pub struct Market {
    pub symbol: String,
    pub authority: Pubkey,
    pub total_volume: u64,
    pub order_count: u64,
    pub is_active: bool,
    pub created_at: i64,
}
```

### Order

```rust
#[account]
pub struct Order {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub order_type: OrderType,
    pub amount: u64,
    pub price: u64,
    pub filled: u64,
    pub status: OrderStatus,
    pub created_at: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub enum OrderType {
    Buy,
    Sell,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub enum OrderStatus {
    Open,
    Filled,
    Cancelled,
}
```

## PDAs

| PDA | Seeds | Purpose |
|-----|-------|---------|
| Market | `["market", symbol]` | Market state |
| Order | `["order", owner, id]` | Order state |
| Trade | `["trade", id]` | Trade record |

## Events

```rust
#[event]
pub struct OrderCreated {
    pub order: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    pub price: u64,
}

#[event]
pub struct OrderMatched {
    pub buy_order: Pubkey,
    pub sell_order: Pubkey,
    pub amount: u64,
    pub price: u64,
}
```
