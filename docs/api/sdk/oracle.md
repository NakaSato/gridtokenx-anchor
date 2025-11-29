# Oracle SDK Module

## Overview

The Oracle module provides price feeds, meter validation, and external data integration for the GridTokenX platform.

---

## Program ID

```
DvdtU4quEbuxUY2FckmvcXwTpC9qp4HLJKb1PMLaqAoE
```

---

## Methods

### updatePriceFeed

Update the GRX price feed (admin only).

```typescript
async updatePriceFeed(params: {
  price: bigint;          // Price in lamports (9 decimals)
  source: string;         // Data source identifier
  confidence: number;     // Confidence interval (0-100)
}): Promise<TransactionSignature>
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `price` | `bigint` | GRX price (9 decimals) |
| `source` | `string` | Price source identifier |
| `confidence` | `number` | Confidence level 0-100 |

**Example:**
```typescript
const tx = await adminClient.oracle.updatePriceFeed({
  price: BigInt(3_500_000_000), // 3.5 GRX/kWh
  source: 'MEA_TARIFF',
  confidence: 95,
});
```

---

### validateMeterReading

Validate a meter reading with optional anomaly detection.

```typescript
async validateMeterReading(params: {
  meter: PublicKey;
  reading: bigint;
  timestamp: number;
  signature?: Uint8Array;
}): Promise<{
  tx: TransactionSignature;
  isValid: boolean;
  anomalyDetected: boolean;
}>
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `meter` | `PublicKey` | Meter PDA address |
| `reading` | `bigint` | Current meter reading |
| `timestamp` | `number` | Reading timestamp |
| `signature` | `Uint8Array` | Optional cryptographic signature |

**Returns:**
- `tx` - Transaction signature
- `isValid` - Whether reading passed validation
- `anomalyDetected` - Whether anomaly was detected

**Example:**
```typescript
const result = await client.oracle.validateMeterReading({
  meter: meterPda,
  reading: BigInt(15_500_000_000),
  timestamp: Math.floor(Date.now() / 1000),
});

if (result.anomalyDetected) {
  console.log('Warning: Anomaly detected in reading');
}
```

---

### getCurrentPrice

Get the current GRX price feed.

```typescript
async getCurrentPrice(): Promise<PriceFeed>
```

**Returns:** Current price feed data

**Example:**
```typescript
const price = await client.oracle.getCurrentPrice();
console.log(`Current price: ${price.value} GRX/kWh`);
console.log(`Last updated: ${new Date(price.timestamp * 1000)}`);
console.log(`Confidence: ${price.confidence}%`);
```

---

### getPriceHistory

Get historical price data.

```typescript
async getPriceHistory(params?: {
  from?: number;        // Start timestamp
  to?: number;          // End timestamp
  interval?: 'hour' | 'day' | 'week';
}): Promise<PriceFeed[]>
```

**Returns:** Array of historical price feeds

---

### getOracleState

Get the oracle configuration and state.

```typescript
async getOracleState(): Promise<OracleState>
```

**Returns:** Oracle configuration and authorized operators

---

### addAuthorizedOracle

Add an authorized oracle operator (admin only).

```typescript
async addAuthorizedOracle(params: {
  oracle: PublicKey;
  name: string;
}): Promise<TransactionSignature>
```

---

### removeAuthorizedOracle

Remove an authorized oracle operator (admin only).

```typescript
async removeAuthorizedOracle(params: {
  oracle: PublicKey;
}): Promise<TransactionSignature>
```

---

## Types

```typescript
interface PriceFeed {
  value: bigint;           // Price value (9 decimals)
  timestamp: number;       // Unix timestamp
  source: string;          // Data source
  confidence: number;      // Confidence 0-100
  exponent: number;        // Decimal exponent (-9)
}

interface OracleState {
  authority: PublicKey;
  priceFeed: PriceFeed;
  authorizedOracles: PublicKey[];
  lastUpdate: number;
  updateCount: bigint;
  minConfidence: number;
  maxStaleness: number;    // Max age in seconds
}

interface MeterValidation {
  meter: PublicKey;
  reading: bigint;
  previousReading: bigint;
  timestamp: number;
  isValid: boolean;
  anomalyScore: number;
  validatedBy: PublicKey;
}

interface PriceFeedUpdatedEvent {
  price: bigint;
  source: string;
  confidence: number;
  timestamp: number;
  updatedBy: PublicKey;
}

interface MeterValidatedEvent {
  meter: PublicKey;
  reading: bigint;
  isValid: boolean;
  anomalyDetected: boolean;
  timestamp: number;
}
```

---

## Events

### onPriceFeedUpdated

Subscribe to price feed updates.

```typescript
client.oracle.onPriceFeedUpdated((event) => {
  console.log('New price:', event.price.toString());
  console.log('Source:', event.source);
});
```

### onMeterValidated

Subscribe to meter validation events.

```typescript
client.oracle.onMeterValidated((event) => {
  console.log('Meter:', event.meter.toBase58());
  console.log('Valid:', event.isValid);
});
```

---

## Error Codes

| Code | Description |
|------|-------------|
| `Unauthorized` | Caller not authorized |
| `InvalidPrice` | Price value out of range |
| `StalePrice` | Price feed is stale |
| `InvalidMeter` | Meter not found or inactive |
| `InvalidReading` | Reading validation failed |
| `ReadingTooHigh` | Reading exceeds threshold |
| `ReadingDecreased` | Reading lower than previous |
| `AnomalyDetected` | Consumption anomaly detected |
| `SignatureInvalid` | Cryptographic signature invalid |
| `ConfidenceTooLow` | Confidence below threshold |

---

## Anomaly Detection

The oracle implements statistical anomaly detection:

1. **Threshold Check**: Reading must not exceed maximum daily generation
2. **Regression Check**: Reading cannot decrease (non-reversible meter)
3. **Rate Check**: kWh/hour must be within acceptable range
4. **Pattern Analysis**: Compares against historical patterns

```typescript
// Check for anomalies manually
const { anomalyDetected, anomalyScore } = await client.oracle.checkAnomaly({
  meter: meterPda,
  reading: currentReading,
});

if (anomalyScore > 0.8) {
  console.log('High anomaly score - possible meter tampering');
}
```

---

## Price Feed Integration

Example of automated price feed updates:

```typescript
import { GridTokenXClient } from '@gridtokenx/sdk';

async function updatePriceFromMEA() {
  const client = new GridTokenXClient({ wallet: oracleWallet });
  
  // Fetch price from MEA API
  const meaPrice = await fetchMEAPrice();
  
  // Update on-chain price feed
  const tx = await client.oracle.updatePriceFeed({
    price: BigInt(Math.floor(meaPrice * 1e9)),
    source: 'MEA_OFFICIAL',
    confidence: 98,
  });
  
  console.log('Price updated:', tx);
}

// Run every hour
setInterval(updatePriceFromMEA, 3600000);
```

---

**Document Version**: 1.0
