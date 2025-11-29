# Trading SDK Module

## Overview

The Trading module handles P2P energy trading operations including order creation, matching, and cancellation.

---

## Program ID

```
GZnqNTJsre6qB4pWCQRE9FiJU2GUeBtBDPp6s7zosctk
```

---

## Methods

### createOrder

Create a new sell order in the marketplace.

```typescript
async createOrder(params: {
  amount: bigint;           // Token amount (9 decimals)
  pricePerKwh: bigint;      // Price per kWh in GRX (9 decimals)
  expiresAt?: number;       // Expiration timestamp (optional)
  ercCertificate?: PublicKey; // ERC certificate for green trading (optional)
}): Promise<{ tx: TransactionSignature; orderId: PublicKey }>
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `amount` | `bigint` | Energy amount in tokens (9 decimals) |
| `pricePerKwh` | `bigint` | Price per kWh in GRX tokens |
| `expiresAt` | `number` | Unix timestamp for expiration |
| `ercCertificate` | `PublicKey` | Optional ERC certificate PDA |

**Returns:**
- `tx` - Transaction signature
- `orderId` - Created order PDA address

**Example:**
```typescript
const { tx, orderId } = await client.trading.createOrder({
  amount: BigInt(10_000_000_000), // 10 kWh
  pricePerKwh: BigInt(3_000_000_000), // 3 GRX/kWh
});
console.log('Created order:', orderId.toBase58());
```

---

### matchOrder

Execute a trade by matching an existing order.

```typescript
async matchOrder(params: {
  orderId: PublicKey;
}): Promise<TransactionSignature>
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `orderId` | `PublicKey` | Order PDA to match |

**Example:**
```typescript
const tx = await client.trading.matchOrder({
  orderId: orderPda,
});
console.log('Trade executed:', tx);
```

**Validation:**
- Order must be active
- Buyer must have sufficient GRX balance
- Buyer cannot be the seller (no self-trading)

---

### cancelOrder

Cancel a pending order and return tokens to escrow.

```typescript
async cancelOrder(params: {
  orderId: PublicKey;
}): Promise<TransactionSignature>
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `orderId` | `PublicKey` | Order PDA to cancel |

**Example:**
```typescript
const tx = await client.trading.cancelOrder({
  orderId: orderPda,
});
console.log('Order cancelled:', tx);
```

**Requirements:**
- Only order owner can cancel
- Order must be active (not filled)

---

### getOrderBook

Fetch active orders from the marketplace.

```typescript
async getOrderBook(params?: {
  limit?: number;
  offset?: number;
  sortBy?: 'price' | 'amount' | 'created';
  sortOrder?: 'asc' | 'desc';
}): Promise<Order[]>
```

**Returns:** Array of active orders sorted as specified

**Example:**
```typescript
const orders = await client.trading.getOrderBook({
  limit: 10,
  sortBy: 'price',
  sortOrder: 'asc',
});

orders.forEach(order => {
  console.log(`${order.amount} kWh @ ${order.pricePerKwh} GRX/kWh`);
});
```

---

### getOrder

Fetch a specific order by ID.

```typescript
async getOrder(orderId: PublicKey): Promise<Order | null>
```

**Returns:** Order details or null if not found

---

### getUserOrders

Fetch orders created by a specific user.

```typescript
async getUserOrders(wallet: PublicKey): Promise<Order[]>
```

**Returns:** Array of orders owned by the wallet

---

### getMarketDepth

Fetch market depth (aggregated order book).

```typescript
async getMarketDepth(): Promise<{
  sellSide: PriceLevel[];
  buySide: PriceLevel[];
  lastClearingPrice: bigint;
  volumeWeightedPrice: bigint;
}>
```

**Returns:**
- `sellSide` - Aggregated sell orders by price level
- `buySide` - Aggregated buy orders by price level
- `lastClearingPrice` - Last trade execution price
- `volumeWeightedPrice` - VWAP calculation

---

## Types

```typescript
interface Order {
  publicKey: PublicKey;
  seller: PublicKey;
  buyer: PublicKey | null;
  amount: bigint;
  filledAmount: bigint;
  pricePerKwh: bigint;
  orderType: 'sell' | 'buy';
  status: 'active' | 'filled' | 'cancelled' | 'expired';
  ercCertificate: PublicKey | null;
  createdAt: number;
  expiresAt: number;
  filledAt: number | null;
}

interface PriceLevel {
  price: bigint;
  totalAmount: bigint;
  orderCount: number;
}

interface TradeExecutedEvent {
  orderId: PublicKey;
  seller: PublicKey;
  buyer: PublicKey;
  amount: bigint;
  pricePerKwh: bigint;
  totalPrice: bigint;
  timestamp: number;
}
```

---

## Events

### onOrderCreated

Subscribe to new order creation events.

```typescript
client.trading.onOrderCreated((event) => {
  console.log('New order:', event.orderId.toBase58());
});
```

### onTradeExecuted

Subscribe to trade execution events.

```typescript
client.trading.onTradeExecuted((event) => {
  console.log('Trade:', {
    amount: event.amount,
    price: event.totalPrice,
  });
});
```

### onOrderCancelled

Subscribe to order cancellation events.

```typescript
client.trading.onOrderCancelled((event) => {
  console.log('Cancelled:', event.orderId.toBase58());
});
```

---

## Error Codes

| Code | Description |
|------|-------------|
| `InsufficientBalance` | Not enough tokens to create order |
| `InsufficientGrx` | Buyer doesn't have enough GRX |
| `OrderNotActive` | Order is not active |
| `SelfTradingNotAllowed` | Cannot match own order |
| `OrderExpired` | Order has expired |
| `InvalidErcCertificate` | ERC certificate invalid |
| `ErcCertificateExpired` | ERC certificate expired |
| `ErcNotValidatedForTrading` | ERC not validated for trading |
| `Unauthorized` | Caller not authorized |

---

## Trade Flow Example

Complete P2P trading flow:

```typescript
// Prosumer creates sell order
const { orderId } = await prosumerClient.trading.createOrder({
  amount: BigInt(10_000_000_000), // 10 kWh
  pricePerKwh: BigInt(3_000_000_000), // 3 GRX
});

// Consumer views order book
const orders = await consumerClient.trading.getOrderBook();
const order = orders[0];

console.log(`Found order: ${order.amount} kWh @ ${order.pricePerKwh} GRX/kWh`);

// Consumer executes trade
const tx = await consumerClient.trading.matchOrder({
  orderId: order.publicKey,
});

console.log('Trade complete:', tx);

// Verify balances
const prosumerBalance = await prosumerClient.grx.getBalance();
const consumerTokens = await consumerClient.energyToken.getBalance();

console.log('Prosumer received:', prosumerBalance, 'GRX');
console.log('Consumer received:', consumerTokens, 'GRID');
```

---

**Document Version**: 1.0
