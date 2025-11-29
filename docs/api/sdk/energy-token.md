# Energy Token SDK Module

## Overview

The Energy Token module manages GRID token operations including minting, burning, transfers, and balance queries.

---

## Program ID

```
9sAB52aZ71ciGhaVwuCg6ohTeWu8H6fDb2B29ohxsFVp
```

---

## Token Information

| Property | Value |
|----------|-------|
| Symbol | GRID |
| Decimals | 9 |
| Type | SPL Token (Token-2022 compatible) |
| Mint Authority | TokenInfo PDA (program-controlled) |

---

## PDA Addresses

### Token Info PDA
```typescript
const [tokenInfoPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("token_info")],
  ENERGY_TOKEN_PROGRAM_ID
);
```

### Mint PDA
```typescript
const [mintPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("mint")],
  ENERGY_TOKEN_PROGRAM_ID
);
```

---

## Methods

### initializeToken

Initialize the token configuration and create the program-controlled mint.

```typescript
async initializeToken(): Promise<TransactionSignature>
```

**Returns:**
- `TransactionSignature` - Transaction signature

**Example:**
```typescript
const tx = await client.energyToken.initializeToken();
console.log('Token initialized:', tx);
```

---

### createTokenMint

Create a standalone mint with Metaplex metadata.

```typescript
async createTokenMint(params: {
  name: string;         // Token name
  symbol: string;       // Token symbol
  uri: string;          // Metadata JSON URI
}): Promise<{
  tx: TransactionSignature;
  mint: PublicKey;
}>
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `name` | `string` | Token name (e.g., "Grid Renewable Energy Token") |
| `symbol` | `string` | Token symbol (e.g., "GRID") |
| `uri` | `string` | Metadata JSON URI |

**Returns:**
- `tx` - Transaction signature
- `mint` - Created mint address

**Example:**
```typescript
const { tx, mint } = await client.energyToken.createTokenMint({
  name: "Grid Renewable Energy Token",
  symbol: "GRID",
  uri: "https://gridtokenx.com/metadata.json",
});
console.log('Mint created:', mint.toBase58());
```

---

### mintToWallet

Mint GRID tokens to a wallet. Creates ATA if needed.

```typescript
async mintToWallet(params: {
  destinationOwner: PublicKey;  // Recipient wallet
  amount: bigint;               // Amount to mint (9 decimals)
}): Promise<TransactionSignature>
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `destinationOwner` | `PublicKey` | Recipient wallet address |
| `amount` | `bigint` | Token amount (9 decimals) |

**Example:**
```typescript
const tx = await client.energyToken.mintToWallet({
  destinationOwner: recipientWallet,
  amount: BigInt(5_000_000_000), // 5 GRID tokens
});
console.log('Minted to wallet:', tx);
```

---

### mintTokensDirect

Mint tokens directly to an existing token account. Updates total supply.

```typescript
async mintTokensDirect(params: {
  userTokenAccount: PublicKey;  // Recipient token account (must exist)
  amount: bigint;               // Amount to mint (9 decimals)
}): Promise<TransactionSignature>
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `userTokenAccount` | `PublicKey` | Existing token account |
| `amount` | `bigint` | Token amount (9 decimals) |

**Example:**
```typescript
const tx = await client.energyToken.mintTokensDirect({
  userTokenAccount: userAta,
  amount: BigInt(10_000_000_000), // 10 GRID tokens
});
console.log('Minted directly:', tx);
```

---

### transfer

Transfer GRID tokens to another wallet.

```typescript
async transfer(params: {
  to: PublicKey;            // Recipient token account
  amount: bigint;           // Transfer amount
}): Promise<TransactionSignature>
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `to` | `PublicKey` | Recipient token account address |
| `amount` | `bigint` | Transfer amount (9 decimals) |

**Example:**
```typescript
const tx = await client.energyToken.transfer({
  to: recipientAta,
  amount: BigInt(1_000_000_000), // 1 GRID token
});
console.log('Transfer complete:', tx);
```

---

### burn

Burn GRID tokens from holder's account.

```typescript
async burn(params: {
  amount: bigint;           // Amount to burn
}): Promise<TransactionSignature>
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `amount` | `bigint` | Token amount to burn (9 decimals) |

**Example:**
```typescript
const tx = await client.energyToken.burn({
  amount: BigInt(3_000_000_000), // 3 GRID tokens
});
console.log('Burned tokens:', tx);
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

### getTokenInfo

Get token configuration and supply information.

```typescript
async getTokenInfo(): Promise<TokenInfo>
```

**Returns:** TokenInfo account data

**Example:**
```typescript
const tokenInfo = await client.energyToken.getTokenInfo();
console.log('Authority:', tokenInfo.authority.toBase58());
console.log('Total supply:', Number(tokenInfo.totalSupply) / 1e9, 'GRID');
console.log('Created at:', new Date(tokenInfo.createdAt * 1000));
```

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
console.log('Decimals:', mint.decimals);
console.log('Supply:', mint.supply.toString());
```

---

## Types

```typescript
interface TokenInfo {
  authority: PublicKey;
  mint: PublicKey;
  totalSupply: bigint;
  createdAt: number;
}

interface MintInfo {
  address: PublicKey;
  supply: bigint;
  decimals: number;
  mintAuthority: PublicKey | null;
  freezeAuthority: PublicKey | null;
  isInitialized: boolean;
}

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
```

---

## Events

### TokensMinted

Emitted when tokens are minted via `mintToWallet`.

```typescript
interface TokensMinted {
  recipient: PublicKey;
  amount: bigint;
  timestamp: number;
}

client.energyToken.onTokensMinted((event) => {
  console.log('Minted:', Number(event.amount) / 1e9, 'GRID');
  console.log('To:', event.recipient.toBase58());
});
```

### TokensMintedDirect

Emitted when tokens are minted via `mintTokensDirect`.

```typescript
interface TokensMintedDirect {
  recipient: PublicKey;
  amount: bigint;
  timestamp: number;
}

client.energyToken.onTokensMintedDirect((event) => {
  console.log('Direct mint:', Number(event.amount) / 1e9, 'GRID');
});
```

### GridTokensMinted

Emitted for grid meter-based minting.

```typescript
interface GridTokensMinted {
  meterOwner: PublicKey;
  amount: bigint;
  timestamp: number;
}
```

---

## Error Codes

| Code | Name | Description |
|------|------|-------------|
| 6000 | `UnauthorizedAuthority` | Caller is not the token authority |
| 6001 | `InvalidMeter` | Meter not found or invalid |
| 6002 | `InsufficientBalance` | Not enough tokens |
| 6003 | `InvalidMetadataAccount` | Metadata account invalid |
| 6004 | `NoUnsettledBalance` | No unsettled balance to mint |

---

## Complete Flow Example

```typescript
import { GridTokenXClient } from '@gridtokenx/sdk';
import { Connection, Keypair } from '@solana/web3.js';

async function energyTokenDemo() {
  // Initialize client
  const connection = new Connection('http://localhost:8899', 'confirmed');
  const wallet = Keypair.generate();
  const client = new GridTokenXClient(connection, wallet);
  
  // 1. Initialize token (one-time setup)
  await client.energyToken.initializeToken();
  
  // 2. Get token info
  const tokenInfo = await client.energyToken.getTokenInfo();
  console.log('Token authority:', tokenInfo.authority.toBase58());
  
  // 3. Mint tokens to a user
  const recipientWallet = Keypair.generate().publicKey;
  await client.energyToken.mintToWallet({
    destinationOwner: recipientWallet,
    amount: BigInt(100_000_000_000), // 100 GRID
  });
  
  // 4. Check balance
  const balance = await client.energyToken.getBalance(recipientWallet);
  console.log('Balance:', Number(balance) / 1e9, 'GRID');
  
  // 5. Transfer tokens
  const anotherWallet = Keypair.generate().publicKey;
  await client.energyToken.transfer({
    to: anotherWallet,
    amount: BigInt(10_000_000_000), // 10 GRID
  });
  
  // 6. Burn tokens
  await client.energyToken.burn({
    amount: BigInt(5_000_000_000), // 5 GRID
  });
  
  // 7. Check final token info
  const finalInfo = await client.energyToken.getTokenInfo();
  console.log('Total supply:', Number(finalInfo.totalSupply) / 1e9, 'GRID');
}
```

---

## Common Token Amounts

| Amount | Base Units | Description |
|--------|------------|-------------|
| 0.1 GRID | `100_000_000` | Small amount |
| 1 GRID | `1_000_000_000` | Standard unit |
| 10 GRID | `10_000_000_000` | Medium amount |
| 100 GRID | `100_000_000_000` | Large amount |

---

**Document Version**: 2.0  
**Last Updated**: November 2024
