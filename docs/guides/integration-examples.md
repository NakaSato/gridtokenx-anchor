# Integration Examples

> **Complete code examples for integrating with GridTokenX**

---

## Prerequisites

```bash
pnpm add @gridtokenx/sdk @solana/web3.js
```

```typescript
import { GridTokenXClient } from '@gridtokenx/sdk';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
```

---

## 1. Basic Setup

### Initialize Client

```typescript
// Load wallet from file
import * as fs from 'fs';

const walletKeyfile = JSON.parse(
  fs.readFileSync('/path/to/wallet.json', 'utf-8')
);
const wallet = Keypair.fromSecretKey(new Uint8Array(walletKeyfile));

// Create connection
const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

// Initialize client
const client = new GridTokenXClient({
  connection,
  wallet,
});

console.log('Connected as:', wallet.publicKey.toBase58());
```

---

## 2. User Registration

### Register as Prosumer

```typescript
async function registerProsumer() {
  const tx = await client.registry.registerUser({
    userType: 'prosumer',
    name: 'Solar Farm A',
    location: 'Bangkok, Thailand',
  });
  
  console.log('Registration tx:', tx);
  
  // Verify registration
  const user = await client.registry.getUser();
  console.log('User registered:', user);
  
  return user;
}
```

### Register as Consumer

```typescript
async function registerConsumer() {
  const tx = await client.registry.registerUser({
    userType: 'consumer',
    name: 'Office Building B',
    location: 'Chiang Mai, Thailand',
  });
  
  console.log('Consumer registered:', tx);
}
```

---

## 3. Meter Registration

### Register Smart Meter

```typescript
async function registerMeter() {
  const { tx, meterPda } = await client.registry.registerMeter({
    serialNumber: 'MTR-2024-001',
    meterType: 'production', // or 'consumption', 'bidirectional'
    capacityKw: 10,
    location: 'Rooftop Solar Array',
  });
  
  console.log('Meter registered:', meterPda.toBase58());
  
  return meterPda;
}
```

### Update Meter Reading

```typescript
async function submitMeterReading(meterPda: PublicKey) {
  // Get current reading from physical meter
  const currentReading = BigInt(15_500_000_000); // 15.5 kWh
  
  const tx = await client.registry.updateMeterReading({
    meter: meterPda,
    reading: currentReading,
    timestamp: Math.floor(Date.now() / 1000),
  });
  
  console.log('Reading submitted:', tx);
}
```

---

## 4. Token Minting

### Mint Tokens from Production

```typescript
async function mintFromProduction(meterPda: PublicKey) {
  // Get meter data
  const meter = await client.registry.getMeter(meterPda);
  const previousReading = meter.lastReading;
  
  // Get current reading
  const currentReading = BigInt(20_000_000_000); // 20 kWh total
  
  // Validate with oracle
  const validation = await client.oracle.validateMeterReading({
    meter: meterPda,
    reading: currentReading,
    timestamp: Math.floor(Date.now() / 1000),
  });
  
  if (!validation.isValid) {
    throw new Error('Validation failed');
  }
  
  // Calculate production
  const produced = currentReading - previousReading;
  
  // Mint tokens
  const { mintedAmount } = await client.energyToken.mintTokens({
    meter: meterPda,
    amount: produced,
    readingProof: validation.proofPda,
  });
  
  console.log('Minted:', Number(mintedAmount) / 1e9, 'GRID');
  
  return mintedAmount;
}
```

---

## 5. P2P Trading

### Create Sell Order

```typescript
async function createSellOrder() {
  // Check balance first
  const balance = await client.energyToken.getBalance();
  console.log('Available balance:', Number(balance) / 1e9, 'GRID');
  
  // Create order
  const { tx, orderId } = await client.trading.createOrder({
    amount: BigInt(5_000_000_000), // 5 kWh
    pricePerKwh: BigInt(3_500_000_000), // 3.5 GRX per kWh
    expiresAt: Math.floor(Date.now() / 1000) + 86400, // 24h
  });
  
  console.log('Order created:', orderId.toBase58());
  console.log('Transaction:', tx);
  
  return orderId;
}
```

### Browse Order Book

```typescript
async function viewOrderBook() {
  const orders = await client.trading.getOrderBook({
    limit: 10,
    sortBy: 'price',
    sortOrder: 'asc',
  });
  
  console.log('Available orders:');
  orders.forEach((order, i) => {
    const amount = Number(order.amount) / 1e9;
    const price = Number(order.pricePerKwh) / 1e9;
    const total = amount * price;
    
    console.log(`${i + 1}. ${amount} kWh @ ${price} GRX/kWh = ${total} GRX`);
    console.log(`   Seller: ${order.seller.toBase58().slice(0, 8)}...`);
    console.log(`   Order ID: ${order.publicKey.toBase58()}`);
  });
  
  return orders;
}
```

### Execute Trade

```typescript
async function buyEnergy(orderId: PublicKey) {
  // Get order details
  const order = await client.trading.getOrder(orderId);
  
  if (!order || order.status !== 'active') {
    throw new Error('Order not available');
  }
  
  const amount = Number(order.amount) / 1e9;
  const price = Number(order.pricePerKwh) / 1e9;
  const total = amount * price;
  
  console.log(`Buying ${amount} kWh for ${total} GRX...`);
  
  // Execute trade
  const tx = await client.trading.matchOrder({
    orderId,
  });
  
  console.log('Trade executed:', tx);
  
  // Verify new balance
  const newBalance = await client.energyToken.getBalance();
  console.log('New GRID balance:', Number(newBalance) / 1e9);
}
```

### Cancel Order

```typescript
async function cancelOrder(orderId: PublicKey) {
  const tx = await client.trading.cancelOrder({
    orderId,
  });
  
  console.log('Order cancelled:', tx);
}
```

---

## 6. Governance

### Create Proposal

```typescript
async function createProposal() {
  const { proposalId } = await client.governance.createProposal({
    title: 'Reduce Trading Fees',
    description: 'Proposal to reduce trading fees from 1% to 0.5%',
    proposalType: 'fee_adjustment',
    actions: [{
      program: TRADING_PROGRAM_ID,
      instruction: 'updateMarketplace',
      data: { feeBps: 50 },
    }],
    votingPeriod: 7 * 24 * 3600, // 7 days
  });
  
  console.log('Proposal created:', proposalId.toBase58());
  return proposalId;
}
```

### Vote on Proposal

```typescript
async function voteOnProposal(proposalId: PublicKey, support: boolean) {
  const tx = await client.governance.vote({
    proposal: proposalId,
    support,
  });
  
  console.log('Vote cast:', support ? 'FOR' : 'AGAINST');
  console.log('Transaction:', tx);
}
```

---

## 7. Event Subscription

### Subscribe to Trades

```typescript
function subscribeToTrades() {
  client.trading.onTradeExecuted((event) => {
    const amount = Number(event.amount) / 1e9;
    const price = Number(event.pricePerKwh) / 1e9;
    
    console.log('Trade executed!');
    console.log(`  Amount: ${amount} kWh`);
    console.log(`  Price: ${price} GRX/kWh`);
    console.log(`  Seller: ${event.seller.toBase58()}`);
    console.log(`  Buyer: ${event.buyer.toBase58()}`);
  });
  
  console.log('Subscribed to trade events');
}
```

### Subscribe to Price Updates

```typescript
function subscribeToPrices() {
  client.oracle.onPriceFeedUpdated((event) => {
    const price = Number(event.price) / 1e9;
    console.log(`Price updated: ${price} GRX/kWh (${event.source})`);
  });
}
```

---

## 8. Complete Trading Flow

```typescript
async function completeTradingFlow() {
  // 1. Setup
  console.log('=== GridTokenX Trading Flow ===\n');
  
  // 2. Check registration
  let user = await client.registry.getUser();
  if (!user) {
    console.log('Registering user...');
    await client.registry.registerUser({
      userType: 'prosumer',
      name: 'Test User',
      location: 'Bangkok',
    });
    user = await client.registry.getUser();
  }
  console.log('User:', user.name);
  
  // 3. Check balance
  const balance = await client.energyToken.getBalance();
  console.log('GRID Balance:', Number(balance) / 1e9);
  
  // 4. View market
  const orders = await client.trading.getOrderBook({ limit: 5 });
  console.log('Orders available:', orders.length);
  
  // 5. Create or match order
  if (balance > BigInt(1_000_000_000)) {
    // Have tokens - create sell order
    console.log('\nCreating sell order...');
    const { orderId } = await client.trading.createOrder({
      amount: BigInt(1_000_000_000),
      pricePerKwh: BigInt(3_000_000_000),
    });
    console.log('Order created:', orderId.toBase58());
  } else if (orders.length > 0) {
    // No tokens - buy from market
    console.log('\nMatching order...');
    await client.trading.matchOrder({
      orderId: orders[0].publicKey,
    });
    console.log('Trade completed!');
  }
  
  // 6. Final balance
  const finalBalance = await client.energyToken.getBalance();
  console.log('\nFinal GRID Balance:', Number(finalBalance) / 1e9);
}

// Run
completeTradingFlow().catch(console.error);
```

---

## Error Handling

```typescript
import { AnchorError } from '@coral-xyz/anchor';

async function safeTransaction() {
  try {
    const tx = await client.trading.createOrder({
      amount: BigInt(10_000_000_000),
      pricePerKwh: BigInt(3_000_000_000),
    });
    return { success: true, tx };
  } catch (error) {
    if (error instanceof AnchorError) {
      console.error('Program error:', error.error.errorMessage);
      console.error('Error code:', error.error.errorCode.number);
    } else {
      console.error('Transaction error:', error.message);
    }
    return { success: false, error };
  }
}
```

---

**Document Version**: 1.0
