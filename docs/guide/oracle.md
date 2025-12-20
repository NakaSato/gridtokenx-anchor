# Oracle Program

The Oracle program provides price feeds and external data for the trading platform.

## Overview

| Property | Value |
|----------|-------|
| Program ID | `oracle` |
| Update Frequency | Block-by-block |
| Data Sources | Smart meters, Market feeds |

## Instructions

### `initialize_feed`

Create a new price feed.

```rust
pub fn initialize_feed(
    ctx: Context<InitializeFeed>,
    name: String,
    decimals: u8
) -> Result<()>
```

### `update_price`

Update the price in a feed.

```rust
pub fn update_price(ctx: Context<UpdatePrice>, price: u64) -> Result<()>
```

**Accounts:**
- `feed` - Price feed PDA
- `authority` - Feed authority

**Example:**
```typescript
await program.methods
  .updatePrice(new BN(45 * 1e6))  // 45.00 price
  .accounts({
    feed: feedPda,
    authority: oracleAuthority.publicKey,
  })
  .signers([oracleAuthority])
  .rpc();
```

### `get_price`

Read the current price (client-side).

```typescript
const feed = await program.account.priceFeed.fetch(feedPda);
console.log(`Current price: ${feed.price / 1e6}`);
```

## Account Structure

### PriceFeed

```rust
#[account]
pub struct PriceFeed {
    pub name: String,
    pub authority: Pubkey,
    pub price: u64,
    pub decimals: u8,
    pub last_updated: i64,
    pub confidence: u64,
}
```

## PDAs

| PDA | Seeds | Purpose |
|-----|-------|---------|
| Price Feed | `["feed", name]` | Price data |

## Events

```rust
#[event]
pub struct PriceUpdated {
    pub feed: Pubkey,
    pub price: u64,
    pub timestamp: i64,
}
```
