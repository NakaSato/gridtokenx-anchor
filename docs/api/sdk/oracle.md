```markdown
# Oracle SDK Module

## Overview

The Oracle module provides AMI (Advanced Metering Infrastructure) data ingestion, validation, and market clearing capabilities for the GridTokenX P2P energy trading platform.

---

## Program ID

```
HtV8jTeaCVXKZVCQQVWjXcAvmiF6id9QSLVGP5MT5osX
```

---

## PDA Derivation

```typescript
import { PublicKey } from "@solana/web3.js";

const ORACLE_PROGRAM_ID = new PublicKey("HtV8jTeaCVXKZVCQQVWjXcAvmiF6id9QSLVGP5MT5osX");

const [oracleDataPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("oracle_data")],
  ORACLE_PROGRAM_ID
);
```

---

## Methods

### initialize

Initialize the oracle with API Gateway configuration.

```typescript
async initialize(params: {
  apiGateway: PublicKey;
}): Promise<TransactionSignature>
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `apiGateway` | `PublicKey` | Authorized API gateway address |

**Example:**
```typescript
const tx = await client.oracle.initialize({
  apiGateway: apiGatewayPubkey,
});
console.log("Oracle initialized:", tx);
```

---

### submitMeterReading

Submit validated meter reading from AMI system. **API Gateway only.**

```typescript
async submitMeterReading(params: {
  meterId: string;
  energyProduced: bigint;
  energyConsumed: bigint;
  readingTimestamp: number;
}): Promise<TransactionSignature>
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `meterId` | `string` | Meter identifier |
| `energyProduced` | `bigint` | Energy produced (kWh) |
| `energyConsumed` | `bigint` | Energy consumed (kWh) |
| `readingTimestamp` | `number` | Unix timestamp |

**Example:**
```typescript
const tx = await apiGatewayClient.oracle.submitMeterReading({
  meterId: "METER-001",
  energyProduced: BigInt(500),
  energyConsumed: BigInt(300),
  readingTimestamp: Math.floor(Date.now() / 1000),
});
```

**Validation:**
- Oracle must be active
- Caller must be the authorized `api_gateway`
- Energy values must be within configured range (default: 0-1M kWh)
- Production/consumption ratio must be ≤ 10:1

---

### triggerMarketClearing

Trigger the market clearing process. **API Gateway only.**

```typescript
async triggerMarketClearing(): Promise<TransactionSignature>
```

**Example:**
```typescript
const tx = await apiGatewayClient.oracle.triggerMarketClearing();
console.log("Market clearing triggered:", tx);
```

---

### updateOracleStatus

Activate or deactivate the oracle. **Admin only.**

```typescript
async updateOracleStatus(params: {
  active: boolean;
}): Promise<TransactionSignature>
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `active` | `boolean` | New oracle status |

**Example:**
```typescript
// Pause oracle for maintenance
await adminClient.oracle.updateOracleStatus({ active: false });

// Resume oracle operations
await adminClient.oracle.updateOracleStatus({ active: true });
```

---

### updateApiGateway

Update the authorized API Gateway address. **Admin only.**

```typescript
async updateApiGateway(params: {
  newApiGateway: PublicKey;
}): Promise<TransactionSignature>
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `newApiGateway` | `PublicKey` | New gateway address |

**Example:**
```typescript
await adminClient.oracle.updateApiGateway({
  newApiGateway: newGatewayPubkey,
});
```

---

### updateValidationConfig

Update the validation configuration. **Admin only.**

```typescript
async updateValidationConfig(params: {
  config: ValidationConfig;
}): Promise<TransactionSignature>
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `config` | `ValidationConfig` | New validation configuration |

**Example:**
```typescript
await adminClient.oracle.updateValidationConfig({
  config: {
    minEnergyValue: BigInt(0),
    maxEnergyValue: BigInt(2000000), // 2M kWh
    anomalyDetectionEnabled: true,
    maxReadingDeviationPercent: 75,
    requireConsensus: false,
  },
});
```

---

### addBackupOracle

Add a backup oracle for redundancy. **Admin only.**

```typescript
async addBackupOracle(params: {
  backupOracle: PublicKey;
}): Promise<TransactionSignature>
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `backupOracle` | `PublicKey` | Backup oracle public key |

**Example:**
```typescript
await adminClient.oracle.addBackupOracle({
  backupOracle: backupOraclePubkey,
});
```

**Constraint:** Maximum 10 backup oracles allowed.

---

### getOracleData

Fetch the current oracle state.

```typescript
async getOracleData(): Promise<OracleData>
```

**Returns:** Complete oracle configuration and metrics.

**Example:**
```typescript
const oracleData = await client.oracle.getOracleData();

console.log("Authority:", oracleData.authority.toBase58());
console.log("API Gateway:", oracleData.apiGateway.toBase58());
console.log("Active:", oracleData.active);
console.log("Total Readings:", oracleData.totalReadings.toString());
console.log("Quality Score:", oracleData.qualityMetrics.lastQualityScore);
console.log("Backup Oracles:", oracleData.backupOracles.length);
```

---

## Types

```typescript
interface OracleData {
  authority: PublicKey;
  apiGateway: PublicKey;
  totalReadings: bigint;
  lastReadingTimestamp: number;
  lastClearing: number;
  active: boolean;
  createdAt: number;
  validationConfig: ValidationConfig;
  qualityMetrics: QualityMetrics;
  backupOracles: PublicKey[];
  consensusThreshold: number;
  lastConsensusTimestamp: number;
}

interface ValidationConfig {
  minEnergyValue: bigint;
  maxEnergyValue: bigint;
  anomalyDetectionEnabled: boolean;
  maxReadingDeviationPercent: number;
  requireConsensus: boolean;
}

interface QualityMetrics {
  totalValidReadings: bigint;
  totalRejectedReadings: bigint;
  averageReadingInterval: number;
  lastQualityScore: number;        // 0-100
  qualityScoreUpdatedAt: number;
}

// Events
interface MeterReadingSubmittedEvent {
  meterId: string;
  energyProduced: bigint;
  energyConsumed: bigint;
  timestamp: number;
  submitter: PublicKey;
}

interface MarketClearingTriggeredEvent {
  authority: PublicKey;
  timestamp: number;
}

interface OracleStatusUpdatedEvent {
  authority: PublicKey;
  active: boolean;
  timestamp: number;
}

interface ApiGatewayUpdatedEvent {
  authority: PublicKey;
  oldGateway: PublicKey;
  newGateway: PublicKey;
  timestamp: number;
}

interface ValidationConfigUpdatedEvent {
  authority: PublicKey;
  timestamp: number;
}

interface BackupOracleAddedEvent {
  authority: PublicKey;
  backupOracle: PublicKey;
  timestamp: number;
}
```

---

## Events

### onMeterReadingSubmitted

Subscribe to meter reading events.

```typescript
client.oracle.onMeterReadingSubmitted((event) => {
  console.log("Meter ID:", event.meterId);
  console.log("Produced:", event.energyProduced.toString(), "kWh");
  console.log("Consumed:", event.energyConsumed.toString(), "kWh");
  console.log("Timestamp:", new Date(event.timestamp * 1000));
  console.log("Submitter:", event.submitter.toBase58());
});
```

### onMarketClearingTriggered

Subscribe to market clearing events.

```typescript
client.oracle.onMarketClearingTriggered((event) => {
  console.log("Market clearing at:", new Date(event.timestamp * 1000));
});
```

### onOracleStatusUpdated

Subscribe to oracle status changes.

```typescript
client.oracle.onOracleStatusUpdated((event) => {
  console.log("Oracle status:", event.active ? "Active" : "Inactive");
});
```

### onApiGatewayUpdated

Subscribe to gateway updates.

```typescript
client.oracle.onApiGatewayUpdated((event) => {
  console.log("Gateway changed from", event.oldGateway.toBase58());
  console.log("Gateway changed to", event.newGateway.toBase58());
});
```

---

## Error Codes

| Code | Name | Description |
|------|------|-------------|
| 6000 | `UnauthorizedAuthority` | Caller is not the authority |
| 6001 | `UnauthorizedGateway` | Caller is not the API gateway |
| 6002 | `OracleInactive` | Oracle is not active |
| 6003 | `InvalidMeterReading` | Reading failed validation |
| 6004 | `MarketClearingInProgress` | Market clearing in progress |
| 6005 | `EnergyValueOutOfRange` | Value outside configured range |
| 6006 | `AnomalousReading` | Anomaly detected (ratio > 10:1) |
| 6007 | `MaxBackupOraclesReached` | Cannot add more backup oracles |

---

## Usage Examples

### API Gateway Integration

```typescript
import { GridTokenXClient } from "@gridtokenx/sdk";
import { Keypair } from "@solana/web3.js";

// Load API Gateway keypair
const apiGatewayKeypair = Keypair.fromSecretKey(/* ... */);

const apiGatewayClient = new GridTokenXClient({
  wallet: apiGatewayKeypair,
  network: "private",
});

// Submit meter readings from AMI system
async function submitAMIReading(reading: AMIReading) {
  try {
    const tx = await apiGatewayClient.oracle.submitMeterReading({
      meterId: reading.meterId,
      energyProduced: BigInt(reading.produced),
      energyConsumed: BigInt(reading.consumed),
      readingTimestamp: reading.timestamp,
    });
    console.log("Reading submitted:", tx);
  } catch (error) {
    if (error.code === 6005) {
      console.error("Energy value out of range");
    } else if (error.code === 6006) {
      console.error("Anomalous reading detected");
    }
  }
}
```

### Admin Operations

```typescript
const adminClient = new GridTokenXClient({
  wallet: adminWallet,
  network: "private",
});

// Monitor oracle health
async function checkOracleHealth() {
  const oracleData = await adminClient.oracle.getOracleData();
  
  const qualityScore = oracleData.qualityMetrics.lastQualityScore;
  if (qualityScore < 90) {
    console.warn("Quality score degraded:", qualityScore);
  }
  
  const totalReadings = oracleData.totalReadings;
  const validReadings = oracleData.qualityMetrics.totalValidReadings;
  const rejectionRate = 1 - (Number(validReadings) / Number(totalReadings));
  
  console.log("Rejection rate:", (rejectionRate * 100).toFixed(2) + "%");
}

// Update validation config for stricter checks
async function tightenValidation() {
  await adminClient.oracle.updateValidationConfig({
    config: {
      minEnergyValue: BigInt(0),
      maxEnergyValue: BigInt(500000), // Reduce max to 500k kWh
      anomalyDetectionEnabled: true,
      maxReadingDeviationPercent: 30, // Stricter 30% deviation
      requireConsensus: false,
    },
  });
}
```

### Market Clearing Automation

```typescript
// Trigger market clearing every hour
setInterval(async () => {
  try {
    const tx = await apiGatewayClient.oracle.triggerMarketClearing();
    console.log("Hourly market clearing:", tx);
  } catch (error) {
    console.error("Market clearing failed:", error);
  }
}, 3600000); // 1 hour
```

---

**Document Version**: 1.0

```