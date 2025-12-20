# Accounts Reference

Account structures and PDA derivation for GridTokenX.

## PDA Derivation

### Energy Token PDAs

```typescript
// Token Info PDA
const [tokenInfoPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("token_info")],
  energyTokenProgram.programId
);

// Mint PDA
const [mintPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("mint")],
  energyTokenProgram.programId
);
```

### Trading PDAs

```typescript
// Market PDA
const [marketPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("market"), Buffer.from(symbol)],
  tradingProgram.programId
);

// Order PDA
const [orderPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("order"), owner.toBuffer(), Buffer.from(orderId)],
  tradingProgram.programId
);
```

### Registry PDAs

```typescript
// Prosumer PDA
const [prosumerPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("prosumer"), owner.toBuffer()],
  registryProgram.programId
);

// Asset PDA
const [assetPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("asset"), owner.toBuffer(), Buffer.from(assetId)],
  registryProgram.programId
);
```

## Account Schemas

### TokenInfo

| Field | Type | Offset | Size |
|-------|------|--------|------|
| discriminator | u64 | 0 | 8 |
| name | String | 8 | 36 |
| symbol | String | 44 | 12 |
| decimals | u8 | 56 | 1 |
| authority | Pubkey | 57 | 32 |
| total_supply | u64 | 89 | 8 |

### Market

| Field | Type | Offset | Size |
|-------|------|--------|------|
| discriminator | u64 | 0 | 8 |
| symbol | String | 8 | 12 |
| authority | Pubkey | 20 | 32 |
| total_volume | u64 | 52 | 8 |
| order_count | u64 | 60 | 8 |
| is_active | bool | 68 | 1 |

### Order

| Field | Type | Offset | Size |
|-------|------|--------|------|
| discriminator | u64 | 0 | 8 |
| market | Pubkey | 8 | 32 |
| owner | Pubkey | 40 | 32 |
| order_type | enum | 72 | 1 |
| amount | u64 | 73 | 8 |
| price | u64 | 81 | 8 |
| filled | u64 | 89 | 8 |
| status | enum | 97 | 1 |

## Fetching Accounts

```typescript
// Fetch single account
const market = await tradingProgram.account.market.fetch(marketPda);

// Fetch all markets
const markets = await tradingProgram.account.market.all();

// Fetch with filter
const userOrders = await tradingProgram.account.order.all([
  { memcmp: { offset: 40, bytes: userPubkey.toBase58() } }
]);
```
