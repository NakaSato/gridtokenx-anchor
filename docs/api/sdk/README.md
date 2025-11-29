# GridTokenX TypeScript SDK Reference

## Overview

The GridTokenX SDK provides a TypeScript interface for interacting with all five on-chain programs. This documentation covers the SDK architecture, client usage, and common patterns.

---

## Installation

```bash
# From the sdk directory
cd sdk
pnpm install
pnpm build
```

---

## SDK Architecture

```
sdk/
├── src/
│   ├── index.ts           # Main exports
│   ├── client.ts          # GridTokenX client wrapper
│   ├── registry.ts        # Registry program interface
│   ├── oracle.ts          # Oracle program interface
│   ├── energy_token.ts    # Energy token program interface
│   ├── trading.ts         # Trading program interface
│   └── governance.ts      # Governance program interface
├── package.json
└── tsconfig.json
```

---

## Quick Start

```typescript
import { GridTokenXClient } from '@gridtokenx/sdk';
import { Connection, Keypair } from '@solana/web3.js';

// Initialize connection
const connection = new Connection('http://localhost:8899', 'confirmed');
const wallet = Keypair.generate(); // Or load from file

// Create client instance
const client = new GridTokenXClient(connection, wallet);

// Register a user
await client.registry.registerUser({
  userType: 'prosumer',
  name: 'Solar Home A',
});

// Create a sell order
await client.trading.createOrder({
  amount: 10_000_000_000, // 10 kWh (9 decimals)
  pricePerKwh: 3_000_000_000, // 3 GRX per kWh
});
```

---

## Modules

### [Registry Module](./registry.md)

User and meter management functions:

- `registerUser()` - Register new prosumer/consumer
- `registerMeter()` - Register smart meter
- `updateMeterReading()` - Submit energy readings
- `settleMeterBalance()` - Settle for token minting

### [Oracle Module](./oracle.md)

Price and data oracle functions:

- `initializeOracle()` - Setup oracle
- `submitReading()` - Submit verified meter readings
- `updatePrice()` - Update energy price feed

### [Energy Token Module](./energy-token.md)

Token operations:

- `mintFromProduction()` - Mint tokens from energy surplus
- `transfer()` - Transfer tokens between accounts
- `burn()` - Burn tokens for consumption

### [Trading Module](./trading.md)

P2P marketplace functions:

- `createOrder()` - Create sell/buy order
- `matchOrder()` - Execute trade
- `cancelOrder()` - Cancel pending order
- `getOrderBook()` - Query active orders

### [Governance Module](./governance.md)

DAO and certificate functions:

- `issueErcCertificate()` - Issue renewable certificate
- `validateErc()` - Validate for trading
- `createProposal()` - Create governance proposal
- `vote()` - Cast vote on proposal

---

## Common Types

### User Types

```typescript
type UserType = 'prosumer' | 'consumer';

interface UserAccount {
  wallet: PublicKey;
  userType: UserType;
  name: string;
  isActive: boolean;
  createdAt: number;
}
```

### Order Types

```typescript
type OrderType = 'sell' | 'buy';
type OrderStatus = 'active' | 'filled' | 'cancelled' | 'expired';

interface Order {
  seller: PublicKey;
  buyer: PublicKey | null;
  amount: bigint;
  filledAmount: bigint;
  pricePerKwh: bigint;
  orderType: OrderType;
  status: OrderStatus;
  createdAt: number;
  expiresAt: number;
}
```

### ERC Certificate

```typescript
type ErcStatus = 'pending' | 'valid' | 'retired' | 'revoked';

interface ErcCertificate {
  certificateId: string;
  owner: PublicKey;
  energyAmount: bigint;
  sourceType: string;
  status: ErcStatus;
  issuedAt: number;
  expiresAt: number | null;
  validatedForTrading: boolean;
}
```

---

## Error Handling

All SDK methods return promises that may reject with typed errors:

```typescript
import { GridTokenXError, ErrorCode } from '@gridtokenx/sdk';

try {
  await client.trading.matchOrder(orderId);
} catch (error) {
  if (error instanceof GridTokenXError) {
    switch (error.code) {
      case ErrorCode.InsufficientBalance:
        console.log('Not enough tokens');
        break;
      case ErrorCode.OrderNotActive:
        console.log('Order already filled or cancelled');
        break;
      case ErrorCode.SelfTradingNotAllowed:
        console.log('Cannot match your own order');
        break;
      default:
        console.log('Transaction failed:', error.message);
    }
  }
}
```

---

## Events

Subscribe to on-chain events:

```typescript
// Subscribe to trade events
client.trading.onTradeExecuted((event) => {
  console.log('Trade executed:', {
    orderId: event.orderId,
    seller: event.seller,
    buyer: event.buyer,
    amount: event.amount,
    price: event.price,
  });
});

// Subscribe to new orders
client.trading.onOrderCreated((event) => {
  console.log('New order:', event);
});
```

---

## Configuration

### Network Selection

```typescript
// Localnet (default)
const client = new GridTokenXClient(
  new Connection('http://localhost:8899'),
  wallet
);

// Devnet
const client = new GridTokenXClient(
  new Connection('https://api.devnet.solana.com'),
  wallet
);

// Mainnet
const client = new GridTokenXClient(
  new Connection('https://api.mainnet-beta.solana.com'),
  wallet
);
```

### Custom Program IDs

```typescript
const client = new GridTokenXClient(connection, wallet, {
  registryProgramId: new PublicKey('...'),
  tradingProgramId: new PublicKey('...'),
  energyTokenProgramId: new PublicKey('...'),
  oracleProgramId: new PublicKey('...'),
  governanceProgramId: new PublicKey('...'),
});
```

---

## Best Practices

### 1. Transaction Confirmation

Always wait for confirmation before proceeding:

```typescript
const tx = await client.trading.createOrder({ ... });
const confirmation = await connection.confirmTransaction(tx, 'confirmed');
```

### 2. Balance Checks

Check balances before operations:

```typescript
const balance = await client.energyToken.getBalance(wallet.publicKey);
if (balance < requiredAmount) {
  throw new Error('Insufficient balance');
}
```

### 3. Retry Logic

Implement retry for transient failures:

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await sleep(1000 * Math.pow(2, i)); // Exponential backoff
    }
  }
  throw new Error('Max retries exceeded');
}
```

---

## Document Navigation

| Section | Description |
|---------|-------------|
| [Registry](./registry.md) | User and meter management |
| [Oracle](./oracle.md) | Price and data feeds |
| [Energy Token](./energy-token.md) | Token operations |
| [Trading](./trading.md) | P2P marketplace |
| [Governance](./governance.md) | DAO and certificates |

---

**Document Version**: 1.0  
**Last Updated**: November 2024  
**Status**: Complete
