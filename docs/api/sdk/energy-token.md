# Energy Token SDK Module

## Overview

The Energy Token module manages GRID token operations including minting, burning, transfers, and balance queries.

---

## Program ID

```
94G1r674LmRDmLN2UPjDFD8Eh7zT8JaSaxv9v68GyEur
```

---

## Token Information

| Property | Value |
|----------|-------|
| Symbol | GRID |
| Decimals | 9 |
| Type | SPL Token |
| Mint Authority | Program PDA |

---

## Methods

### mintTokens

Mint new GRID tokens for validated energy production.

```typescript
async mintTokens(params: {
  meter: PublicKey;         // Meter PDA
  amount: bigint;           // Amount to mint (9 decimals)
  readingProof: PublicKey;  // Oracle validation proof
}): Promise<{
  tx: TransactionSignature;
  mintedAmount: bigint;
}>
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `meter` | `PublicKey` | Registered meter PDA |
| `amount` | `bigint` | Token amount (9 decimals) |
| `readingProof` | `PublicKey` | Oracle validation proof |

**Returns:**
- `tx` - Transaction signature
- `mintedAmount` - Actual minted amount

**Example:**
```typescript
const { tx, mintedAmount } = await client.energyToken.mintTokens({
  meter: meterPda,
  amount: BigInt(5_000_000_000), // 5 kWh
  readingProof: validationPda,
});
console.log('Minted:', mintedAmount.toString(), 'GRID');
```

---

### burnTokens

Burn GRID tokens (for consumed energy settlement).

```typescript
async burnTokens(params: {
  amount: bigint;           // Amount to burn
  meter?: PublicKey;        // Associated meter (optional)
}): Promise<TransactionSignature>
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `amount` | `bigint` | Token amount to burn |
| `meter` | `PublicKey` | Optional meter reference |

**Example:**
```typescript
const tx = await client.energyToken.burnTokens({
  amount: BigInt(3_000_000_000), // 3 kWh
});
console.log('Burned tokens:', tx);
```

---

### transfer

Transfer GRID tokens to another wallet.

```typescript
async transfer(params: {
  to: PublicKey;            // Recipient wallet
  amount: bigint;           // Transfer amount
  memo?: string;            // Optional memo
}): Promise<TransactionSignature>
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `to` | `PublicKey` | Recipient address |
| `amount` | `bigint` | Transfer amount |
| `memo` | `string` | Optional memo |

**Example:**
```typescript
const tx = await client.energyToken.transfer({
  to: recipientWallet,
  amount: BigInt(1_000_000_000), // 1 GRID
  memo: 'Energy transfer',
});
```

---

### getBalance

Get GRID token balance for a wallet.

```typescript
async getBalance(wallet?: PublicKey): Promise<bigint>
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `wallet` | `PublicKey` | Wallet to check (defaults to connected wallet) |

**Returns:** Token balance with 9 decimals

**Example:**
```typescript
const balance = await client.energyToken.getBalance();
console.log('Balance:', Number(balance) / 1e9, 'GRID');
```

---

### getTokenAccount

Get token account details.

```typescript
async getTokenAccount(wallet?: PublicKey): Promise<TokenAccount | null>
```

**Returns:** Token account info or null if not exists

---

### getMintInfo

Get GRID token mint information.

```typescript
async getMintInfo(): Promise<MintInfo>
```

**Returns:** Mint authority, supply, and decimals

**Example:**
```typescript
const mint = await client.energyToken.getMintInfo();
console.log('Total supply:', mint.supply.toString());
console.log('Decimals:', mint.decimals);
```

---

### createTokenAccount

Create associated token account for GRID tokens.

```typescript
async createTokenAccount(wallet?: PublicKey): Promise<{
  tx: TransactionSignature;
  tokenAccount: PublicKey;
}>
```

**Returns:**
- `tx` - Transaction signature
- `tokenAccount` - Created ATA address

---

### getTransactionHistory

Get token transaction history.

```typescript
async getTransactionHistory(params?: {
  limit?: number;
  before?: string;
}): Promise<TokenTransaction[]>
```

**Returns:** Array of token transactions

---

## Types

```typescript
interface TokenAccount {
  address: PublicKey;
  owner: PublicKey;
  mint: PublicKey;
  amount: bigint;
  delegate: PublicKey | null;
  delegatedAmount: bigint;
  isInitialized: boolean;
  isFrozen: boolean;
}

interface MintInfo {
  address: PublicKey;
  supply: bigint;
  decimals: number;
  mintAuthority: PublicKey | null;
  freezeAuthority: PublicKey | null;
  isInitialized: boolean;
}

interface TokenTransaction {
  signature: string;
  type: 'mint' | 'burn' | 'transfer';
  amount: bigint;
  from: PublicKey | null;
  to: PublicKey | null;
  timestamp: number;
  slot: number;
  fee: number;
}

interface TokensMintedEvent {
  meter: PublicKey;
  owner: PublicKey;
  amount: bigint;
  timestamp: number;
}

interface TokensBurnedEvent {
  owner: PublicKey;
  amount: bigint;
  timestamp: number;
}

interface TokensTransferredEvent {
  from: PublicKey;
  to: PublicKey;
  amount: bigint;
  timestamp: number;
}
```

---

## Events

### onTokensMinted

Subscribe to token minting events.

```typescript
client.energyToken.onTokensMinted((event) => {
  console.log('Minted:', event.amount.toString());
  console.log('Meter:', event.meter.toBase58());
});
```

### onTokensBurned

Subscribe to token burning events.

```typescript
client.energyToken.onTokensBurned((event) => {
  console.log('Burned:', event.amount.toString());
});
```

### onTokensTransferred

Subscribe to token transfer events.

```typescript
client.energyToken.onTokensTransferred((event) => {
  console.log('From:', event.from.toBase58());
  console.log('To:', event.to.toBase58());
  console.log('Amount:', event.amount.toString());
});
```

---

## Error Codes

| Code | Description |
|------|-------------|
| `InsufficientBalance` | Not enough tokens |
| `InvalidMeter` | Meter not registered |
| `MeterNotActive` | Meter is inactive |
| `InvalidReadingProof` | Oracle validation missing |
| `MintingNotAllowed` | Minting restricted |
| `BurnAmountTooHigh` | Cannot burn more than balance |
| `TokenAccountNotFound` | ATA doesn't exist |
| `AccountFrozen` | Token account is frozen |
| `Unauthorized` | Caller not authorized |

---

## Minting Flow Example

Complete energy-to-token conversion flow:

```typescript
import { GridTokenXClient } from '@gridtokenx/sdk';

async function mintFromMeterReading() {
  const client = new GridTokenXClient({ wallet });
  
  // 1. Get meter and previous reading
  const meter = await client.registry.getMeter(meterPda);
  const previousReading = meter.lastReading;
  
  // 2. Get current meter reading
  const currentReading = BigInt(16_500_000_000); // 16.5 kWh total
  
  // 3. Validate with oracle
  const validation = await client.oracle.validateMeterReading({
    meter: meterPda,
    reading: currentReading,
    timestamp: Math.floor(Date.now() / 1000),
  });
  
  if (!validation.isValid) {
    throw new Error('Reading validation failed');
  }
  
  // 4. Calculate production delta
  const produced = currentReading - previousReading;
  
  // 5. Mint tokens for produced energy
  const { mintedAmount } = await client.energyToken.mintTokens({
    meter: meterPda,
    amount: produced,
    readingProof: validation.proofPda,
  });
  
  console.log('Minted', Number(mintedAmount) / 1e9, 'GRID tokens');
  
  // 6. Check new balance
  const balance = await client.energyToken.getBalance();
  console.log('Total balance:', Number(balance) / 1e9, 'GRID');
}
```

---

**Document Version**: 1.0
