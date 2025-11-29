# Registry SDK Module

## Overview

The Registry module handles user registration, meter management, and energy reading submissions.

---

## Program ID

```
2XPQmFYMdXjP7ffoBB3mXeCdboSFg5Yeb6QmTSGbW8a7
```

---

## Methods

### registerUser

Register a new user (prosumer or consumer) on the platform.

```typescript
async registerUser(params: {
  userType: 'prosumer' | 'consumer';
  name: string;
}): Promise<TransactionSignature>
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `userType` | `'prosumer' \| 'consumer'` | Type of user account |
| `name` | `string` | Display name (max 50 chars) |

**Returns:** Transaction signature

**Example:**
```typescript
const tx = await client.registry.registerUser({
  userType: 'prosumer',
  name: 'Solar Home A',
});
console.log('Registered user:', tx);
```

---

### registerMeter

Register a smart meter for a prosumer.

```typescript
async registerMeter(params: {
  meterId: string;
  meterType: 'solar' | 'wind' | 'hydro' | 'other';
}): Promise<TransactionSignature>
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `meterId` | `string` | Unique meter identifier |
| `meterType` | `string` | Energy source type |

**Example:**
```typescript
const tx = await client.registry.registerMeter({
  meterId: 'METER-001',
  meterType: 'solar',
});
```

---

### updateMeterReading

Submit a new meter reading.

```typescript
async updateMeterReading(params: {
  meterId: string;
  productionWh: bigint;
  consumptionWh: bigint;
  timestamp?: number;
}): Promise<TransactionSignature>
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `meterId` | `string` | Meter identifier |
| `productionWh` | `bigint` | Production in Wh |
| `consumptionWh` | `bigint` | Consumption in Wh |
| `timestamp` | `number` | Unix timestamp (optional) |

**Example:**
```typescript
const tx = await client.registry.updateMeterReading({
  meterId: 'METER-001',
  productionWh: BigInt(15_000), // 15 kWh
  consumptionWh: BigInt(8_000),  // 8 kWh
});
```

---

### settleMeterBalance

Settle meter balance to prepare for token minting.

```typescript
async settleMeterBalance(params: {
  meterId: string;
}): Promise<{ tx: TransactionSignature; tokensToMint: bigint }>
```

**Returns:**
- `tx` - Transaction signature
- `tokensToMint` - Amount of tokens to be minted (Wh)

**Example:**
```typescript
const { tx, tokensToMint } = await client.registry.settleMeterBalance({
  meterId: 'METER-001',
});
console.log('Tokens to mint:', tokensToMint);
```

---

### getUserAccount

Fetch user account details.

```typescript
async getUserAccount(wallet: PublicKey): Promise<UserAccount | null>
```

**Returns:** User account or null if not found

---

### getMeterAccount

Fetch meter account details.

```typescript
async getMeterAccount(meterId: string): Promise<MeterAccount | null>
```

**Returns:** Meter account or null if not found

---

### getUnsettledBalance

Get the unsettled balance for a meter.

```typescript
async getUnsettledBalance(meterId: string): Promise<bigint>
```

**Returns:** Unsettled energy in Wh

---

## Types

```typescript
interface UserAccount {
  wallet: PublicKey;
  userType: 'prosumer' | 'consumer';
  name: string;
  isActive: boolean;
  createdAt: number;
  bump: number;
}

interface MeterAccount {
  meterId: string;
  owner: PublicKey;
  meterType: string;
  status: 'active' | 'inactive' | 'suspended';
  totalGeneration: bigint;
  totalConsumption: bigint;
  settledNetGeneration: bigint;
  claimedErcGeneration: bigint;
  lastReadingAt: number;
  createdAt: number;
}
```

---

## Error Codes

| Code | Description |
|------|-------------|
| `UserAlreadyExists` | Wallet already registered |
| `InvalidUserType` | Invalid user type provided |
| `MeterAlreadyExists` | Meter ID already registered |
| `MeterNotFound` | Meter ID not found |
| `InvalidMeterStatus` | Meter is not active |
| `NoUnsettledBalance` | No balance to settle |
| `Unauthorized` | Caller not authorized |

---

**Document Version**: 1.0
