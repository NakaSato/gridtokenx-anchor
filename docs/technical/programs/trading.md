# Trading Program - Technical Reference

> **Implementation reference for the Trading Program**

Program ID: `GZnqNTJsre6qB4pWCQRE9FiJU2GUeBtBDPp6s7zosctk`

Source: [`programs/trading/src/lib.rs`](../../../programs/trading/src/lib.rs)

---

## Instructions

### `initialize_market`

Creates the market configuration account.

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `market` | PDA (mut) | Market state account |
| `authority` | Signer | Initial authority |
| `fee_account` | Account | Fee recipient |
| `system_program` | Program | System program |

**Arguments:**
| Name | Type | Description |
|------|------|-------------|
| `fee_bps` | u16 | Fee in basis points |

**PDA Seeds:** `["market"]`

---

### `create_sell_order`

Creates a sell order with token escrow.

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `order` | PDA (mut) | Order account |
| `market` | PDA (mut) | Market state |
| `seller` | Signer | Order creator |
| `seller_token_account` | Account (mut) | Seller's tokens |
| `escrow_token_account` | Account (mut) | Escrow account |
| `token_program` | Program | SPL Token program |
| `system_program` | Program | System program |

**Arguments:**
| Name | Type | Description |
|------|------|-------------|
| `amount` | u64 | Token amount to sell |
| `price` | u64 | Price per token (lamports) |
| `erc_certificate` | Option<Pubkey> | Optional ERC requirement |

**PDA Seeds:** `["order", authority.key(), order_num.to_le_bytes()]`

---

### `create_buy_order`

Creates a buy order.

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `order` | PDA (mut) | Order account |
| `market` | PDA (mut) | Market state |
| `buyer` | Signer | Order creator |
| `system_program` | Program | System program |

**Arguments:**
| Name | Type | Description |
|------|------|-------------|
| `amount` | u64 | Token amount to buy |
| `price` | u64 | Maximum price per token |

---

### `match_orders`

Matches a buy and sell order.

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `trade_record` | PDA (mut) | Trade record |
| `buy_order` | PDA (mut) | Buy order |
| `sell_order` | PDA (mut) | Sell order |
| `market` | PDA (mut) | Market state |
| `buyer` | Signer | Buyer wallet |
| `seller` | Account | Seller wallet |
| `buyer_token_account` | Account (mut) | Buyer receives tokens |
| `seller_token_account` | Account (mut) | Seller receives payment |
| `escrow_token_account` | Account (mut) | Escrow releases tokens |
| `fee_account` | Account (mut) | Receives trading fee |
| `token_program` | Program | SPL Token program |
| `system_program` | Program | System program |

**PDA Seeds:** `["trade", buy_order.key(), sell_order.key()]`

---

### `cancel_order`

Cancels an active order.

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `order` | PDA (mut) | Order to cancel |
| `market` | PDA (mut) | Market state |
| `authority` | Signer | Order creator |
| `refund_account` | Account (mut) | Receives refund |
| `escrow_token_account` | Account (mut) | Escrow (if sell) |
| `token_program` | Program | SPL Token program |

---

### `update_order_price`

Updates the price of an active order.

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `order` | PDA (mut) | Order to update |
| `authority` | Signer | Order creator |

**Arguments:**
| Name | Type | Description |
|------|------|-------------|
| `new_price` | u64 | New price per token |

---

## Account Structures

### Market

```rust
#[account]
pub struct Market {
    pub authority: Pubkey,
    pub fee_account: Pubkey,
    pub fee_bps: u16,
    pub is_active: bool,
    pub total_orders: u64,
    pub total_trades: u64,
    pub total_volume: u64,
    pub created_at: i64,
    pub bump: u8,
}
```

### Order

```rust
#[account]
pub struct Order {
    pub order_id: u64,
    pub authority: Pubkey,
    pub order_type: OrderType,
    pub amount: u64,
    pub price: u64,
    pub filled_amount: u64,
    pub status: OrderStatus,
    pub erc_certificate: Option<Pubkey>,
    pub created_at: i64,
    pub filled_at: Option<i64>,
    pub bump: u8,
}
```

### TradeRecord

```rust
#[account]
pub struct TradeRecord {
    pub trade_id: u64,
    pub buy_order: Pubkey,
    pub sell_order: Pubkey,
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub amount: u64,
    pub price: u64,
    pub fee: u64,
    pub executed_at: i64,
    pub bump: u8,
}
```

---

## Enums

### OrderType

```rust
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum OrderType {
    Buy,
    Sell,
}
```

### OrderStatus

```rust
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum OrderStatus {
    Active,
    PartiallyFilled,
    Filled,
    Cancelled,
}
```

---

## Events

```rust
#[event]
pub struct MarketInitialized {
    pub authority: Pubkey,
    pub fee_bps: u16,
    pub timestamp: i64,
}

#[event]
pub struct SellOrderCreated {
    pub order_id: u64,
    pub seller: Pubkey,
    pub amount: u64,
    pub price: u64,
    pub timestamp: i64,
}

#[event]
pub struct BuyOrderCreated {
    pub order_id: u64,
    pub buyer: Pubkey,
    pub amount: u64,
    pub price: u64,
    pub timestamp: i64,
}

#[event]
pub struct OrderMatched {
    pub trade_id: u64,
    pub buy_order: Pubkey,
    pub sell_order: Pubkey,
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub amount: u64,
    pub price: u64,
    pub fee: u64,
    pub timestamp: i64,
}

#[event]
pub struct OrderCancelled {
    pub order_id: u64,
    pub reason: String,
    pub timestamp: i64,
}
```

---

## Errors

```rust
#[error_code]
pub enum TradingError {
    #[msg("Market is paused")]
    MarketPaused,
    #[msg("Insufficient balance")]
    InsufficientBalance,
    #[msg("Invalid order status")]
    InvalidOrderStatus,
    #[msg("Self-trade not allowed")]
    SelfTradeNotAllowed,
    #[msg("Price mismatch")]
    PriceMismatch,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Order not found")]
    OrderNotFound,
    #[msg("Unauthorized cancellation")]
    UnauthorizedCancellation,
    #[msg("Invalid ERC certificate")]
    InvalidErcCertificate,
}
```

---

## Fee Calculation

```rust
fn calculate_fee(amount: u64, price: u64, fee_bps: u16) -> u64 {
    let total_value = amount.checked_mul(price).unwrap();
    total_value.checked_mul(fee_bps as u64).unwrap() / 10000
}
```

---

*For academic documentation, see [Academic Trading Documentation](../../academic/programs/trading.md)*
