# Trading Program Instructions

## Program ID
```
GZnqNTJsre6qB4pWCQRE9FiJU2GUeBtBDPp6s7zosctk
```

---

## initialize

Initialize the trading marketplace.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `authority` | `Signer` | Program authority |
| `marketplace_state` | `PDA` | Marketplace state |
| `escrow_account` | `PDA` | Token escrow |
| `mint` | `Account` | GRID token mint |
| `token_program` | `Program` | SPL Token program |
| `system_program` | `Program` | System program |

### Arguments

| Name | Type | Description |
|------|------|-------------|
| `fee_bps` | `u16` | Trading fee in basis points |
| `min_order_size` | `u64` | Minimum order size |

### Example

```typescript
await program.methods
  .initialize(
    100,                          // 1% fee
    new BN(100_000_000)           // 0.1 GRID minimum
  )
  .accounts({
    authority: wallet.publicKey,
    marketplaceState: marketplacePda,
    escrowAccount: escrowPda,
    mint: mintPda,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

---

## create_order

Create a new sell order.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `seller` | `Signer` | Order creator |
| `seller_token_account` | `ATA` | Seller's GRID tokens |
| `order` | `PDA` | Order account to create |
| `escrow_account` | `PDA` | Token escrow |
| `marketplace_state` | `PDA` | Marketplace state |
| `user_account` | `PDA` | Seller's user account |
| `erc_certificate` | `PDA` | Optional ERC certificate |
| `token_program` | `Program` | SPL Token program |
| `system_program` | `Program` | System program |

### Arguments

| Name | Type | Description |
|------|------|-------------|
| `amount` | `u64` | Token amount to sell (9 decimals) |
| `price_per_kwh` | `u64` | Price per kWh in GRX |
| `expires_at` | `Option<i64>` | Expiration timestamp |

### PDA Seeds

```
["order", seller_pubkey, nonce]
```

### Example

```typescript
const nonce = new BN(Date.now());
const [orderPda] = PublicKey.findProgramAddressSync(
  [
    Buffer.from('order'),
    wallet.publicKey.toBuffer(),
    nonce.toArrayLike(Buffer, 'le', 8),
  ],
  TRADING_PROGRAM_ID
);

await program.methods
  .createOrder(
    new BN(10_000_000_000),  // 10 GRID
    new BN(3_000_000_000),   // 3 GRX/kWh
    new BN(Math.floor(Date.now() / 1000) + 86400) // 24h expiry
  )
  .accounts({
    seller: wallet.publicKey,
    sellerTokenAccount: sellerAta,
    order: orderPda,
    escrowAccount: escrowPda,
    marketplaceState: marketplacePda,
    userAccount: userPda,
    ercCertificate: null,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

### Validation

- Amount ≥ minimum order size
- Seller has sufficient balance
- User is registered
- Optional ERC certificate must be valid

### Errors

| Code | Description |
|------|-------------|
| `InsufficientBalance` | Not enough tokens |
| `OrderTooSmall` | Below minimum size |
| `InvalidPrice` | Price is zero |
| `UserNotRegistered` | Seller not registered |
| `InvalidErcCertificate` | ERC certificate invalid |

---

## match_order

Execute a trade by matching an existing order.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `buyer` | `Signer` | Trade executor |
| `seller` | `Account` | Order creator |
| `order` | `PDA` | Order to match |
| `escrow_account` | `PDA` | Token escrow |
| `buyer_token_account` | `ATA` | Buyer's GRID account |
| `buyer_grx_account` | `ATA` | Buyer's GRX account |
| `seller_grx_account` | `ATA` | Seller's GRX account |
| `fee_account` | `ATA` | Fee collector |
| `marketplace_state` | `PDA` | Marketplace state |
| `buyer_user_account` | `PDA` | Buyer's user account |
| `token_program` | `Program` | SPL Token program |

### Arguments

None - matches full order amount

### Example

```typescript
await program.methods
  .matchOrder()
  .accounts({
    buyer: wallet.publicKey,
    seller: orderData.seller,
    order: orderPda,
    escrowAccount: escrowPda,
    buyerTokenAccount: buyerAta,
    buyerGrxAccount: buyerGrxAta,
    sellerGrxAccount: sellerGrxAta,
    feeAccount: feeAta,
    marketplaceState: marketplacePda,
    buyerUserAccount: buyerUserPda,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .rpc();
```

### Trade Execution

1. Transfer GRX from buyer to seller (minus fee)
2. Transfer fee to fee collector
3. Transfer GRID from escrow to buyer
4. Update order status to `Filled`
5. Emit `TradeExecuted` event

### Errors

| Code | Description |
|------|-------------|
| `OrderNotActive` | Order not available |
| `InsufficientGrx` | Buyer lacks GRX |
| `SelfTradingNotAllowed` | Cannot buy own order |
| `OrderExpired` | Order has expired |
| `UserNotRegistered` | Buyer not registered |

---

## cancel_order

Cancel a pending order.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `seller` | `Signer` | Order owner |
| `order` | `PDA` | Order to cancel |
| `seller_token_account` | `ATA` | Return tokens here |
| `escrow_account` | `PDA` | Token escrow |
| `marketplace_state` | `PDA` | Marketplace state |
| `token_program` | `Program` | SPL Token program |

### Arguments

None

### Example

```typescript
await program.methods
  .cancelOrder()
  .accounts({
    seller: wallet.publicKey,
    order: orderPda,
    sellerTokenAccount: sellerAta,
    escrowAccount: escrowPda,
    marketplaceState: marketplacePda,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .rpc();
```

### Errors

| Code | Description |
|------|-------------|
| `Unauthorized` | Not order owner |
| `OrderNotActive` | Order not cancellable |
| `OrderAlreadyFilled` | Already matched |

---

## update_marketplace

Update marketplace parameters (admin only).

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `authority` | `Signer` | Admin |
| `marketplace_state` | `PDA` | Marketplace state |

### Arguments

| Name | Type | Description |
|------|------|-------------|
| `fee_bps` | `Option<u16>` | New fee (basis points) |
| `min_order_size` | `Option<u64>` | New minimum order |

### Example

```typescript
await program.methods
  .updateMarketplace(
    50,   // 0.5% fee
    null  // Keep current min order
  )
  .accounts({
    authority: adminWallet.publicKey,
    marketplaceState: marketplacePda,
  })
  .rpc();
```

---

## Account Structures

### MarketplaceState

```rust
pub struct MarketplaceState {
    pub authority: Pubkey,
    pub escrow: Pubkey,
    pub mint: Pubkey,
    pub fee_bps: u16,
    pub fee_collector: Pubkey,
    pub min_order_size: u64,
    pub total_orders: u64,
    pub total_trades: u64,
    pub total_volume: u64,
    pub is_paused: bool,
    pub initialized_at: i64,
}
```

### Order

```rust
pub struct Order {
    pub seller: Pubkey,
    pub buyer: Option<Pubkey>,
    pub amount: u64,
    pub filled_amount: u64,
    pub price_per_kwh: u64,
    pub order_type: OrderType,
    pub status: OrderStatus,
    pub erc_certificate: Option<Pubkey>,
    pub nonce: u64,
    pub created_at: i64,
    pub expires_at: Option<i64>,
    pub filled_at: Option<i64>,
}
```

### OrderStatus

```rust
pub enum OrderStatus {
    Active,
    Filled,
    Cancelled,
    Expired,
}
```

---

## Events

### OrderCreated

```rust
#[event]
pub struct OrderCreated {
    pub order: Pubkey,
    pub seller: Pubkey,
    pub amount: u64,
    pub price_per_kwh: u64,
    pub expires_at: Option<i64>,
    pub timestamp: i64,
}
```

### TradeExecuted

```rust
#[event]
pub struct TradeExecuted {
    pub order: Pubkey,
    pub seller: Pubkey,
    pub buyer: Pubkey,
    pub amount: u64,
    pub price_per_kwh: u64,
    pub total_price: u64,
    pub fee: u64,
    pub timestamp: i64,
}
```

### OrderCancelled

```rust
#[event]
pub struct OrderCancelled {
    pub order: Pubkey,
    pub seller: Pubkey,
    pub refunded_amount: u64,
    pub timestamp: i64,
}
```

---

## Fee Calculation

```rust
// Fee calculation in basis points
let fee = (total_price * fee_bps as u64) / 10000;
let seller_receives = total_price - fee;

// Example: 1% fee on 30 GRX trade
// fee = (30_000_000_000 * 100) / 10000 = 300_000_000 (0.3 GRX)
// seller_receives = 29_700_000_000 (29.7 GRX)
```

---

## ERC Certificate Integration

Orders can optionally include an ERC (Energy Renewable Certificate):

```typescript
// Create order with green energy certificate
await program.methods
  .createOrder(amount, price, expiry)
  .accounts({
    // ... other accounts
    ercCertificate: ercPda, // Include certificate
  })
  .rpc();
```

Certificate requirements:
- Must be valid (not expired)
- Must belong to seller
- Must be validated by oracle

---

**Document Version**: 1.0
