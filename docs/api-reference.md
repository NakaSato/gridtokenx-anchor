# GridTokenX API Reference

> **Version**: 2.0.0  
> **Last Updated**: 2025  
> **Framework**: Anchor 0.30.x on Solana

This comprehensive API reference documents all instructions, accounts, types, events, and errors across the GridTokenX smart contract programs.

---

## Table of Contents

1. [Program Addresses](#program-addresses)
2. [Trading Program](#trading-program)
3. [Registry Program](#registry-program)
4. [Oracle Program](#oracle-program)
5. [Governance Program](#governance-program)
6. [Energy Token Program](#energy-token-program)
7. [Common Types](#common-types)
8. [SDK Usage Examples](#sdk-usage-examples)

---

## Program Addresses

| Program | Address | Description |
|---------|---------|-------------|
| **Trading** | `8S2e2p4ghqMJuzTz5AkAKSka7jqsjgBH7eWDcCHzXPND` | Order book, AMM, auctions, settlement |
| **Registry** | `CXXRVpEwyd2ch7eo425mtaBfr2Yi1825Nm6yik2NEWqR` | User and meter management |
| **Oracle** | `EkcPD2YEXhpo1J73UX9EJNnjV2uuFS8KXMVLx9ybqnhU` | AMI data bridge and validation |
| **Governance** | `8bNpJqZoqqUWKu55VWhR8LWS66BX7NPpwgYBAKhBzu2L` | PoA administration, ERC certificates |
| **Energy Token** | `5DJCWKo5cXt3PXRsrpH1xixra4wXWbNzxZ1p4FHqSxvi` | GRX token minting and management |

---

## Trading Program

The Trading program provides the core marketplace functionality for P2P energy trading.

### Instructions

#### Market Operations

##### `initialize_market`
Initialize a new trading market.

```typescript
initialize_market()
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `market` | `Account<Market>` | Market account to initialize (writable) |
| `authority` | `Signer` | Market authority (writable) |
| `system_program` | `Program` | System program |

---

##### `update_market_params`
Update market parameters (admin only).

```typescript
update_market_params(
  market_fee_bps: u16,    // Market fee in basis points
  clearing_enabled: bool  // Enable/disable clearing
)
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `market` | `Account<Market>` | Market account (writable) |
| `authority` | `Signer` | Market authority |

---

##### `update_batch_config`
Update batch processing configuration.

```typescript
update_batch_config(config: BatchConfig)
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `market` | `Account<Market>` | Market account (writable) |
| `authority` | `Signer` | Market authority |

---

#### Order Management

##### `create_buy_order`
Create a buy order for energy.

```typescript
create_buy_order(
  order_id: u64,          // Unique order identifier
  energy_amount: u64,     // Energy amount in milli-kWh
  max_price_per_kwh: u64  // Maximum price per kWh (micro-units)
)
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `market` | `Account<Market>` | Trading market (writable) |
| `order` | `Account<Order>` | New order account (writable) |
| `authority` | `Signer` | Buyer authority (writable) |
| `system_program` | `Program` | System program |

**Events:**
- `BuyOrderCreated`

---

##### `create_sell_order`
Create a sell order for energy. Validates ERC certificate if provided.

```typescript
create_sell_order(
  order_id: u64,        // Unique order identifier
  energy_amount: u64,   // Energy amount in milli-kWh
  price_per_kwh: u64    // Price per kWh (micro-units)
)
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `market` | `Account<Market>` | Trading market (writable) |
| `order` | `Account<Order>` | New order account (writable) |
| `erc_certificate` | `Option<Account<ErcCertificate>>` | Optional ERC certificate |
| `authority` | `Signer` | Seller authority (writable) |
| `system_program` | `Program` | System program |

**Events:**
- `SellOrderCreated`

---

##### `cancel_order`
Cancel an active order.

```typescript
cancel_order()
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `market` | `Account<Market>` | Trading market (writable) |
| `order` | `Account<Order>` | Order to cancel (writable) |
| `authority` | `Signer` | Order owner |

**Events:**
- `OrderCancelled`

---

##### `match_orders`
Match a buy order with a sell order.

```typescript
match_orders(match_amount: u64)
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `market` | `Account<Market>` | Trading market (writable) |
| `buy_order` | `Account<Order>` | Buy order (writable) |
| `sell_order` | `Account<Order>` | Sell order (writable) |
| `trade_record` | `Account<TradeRecord>` | Trade record (writable) |
| `authority` | `Signer` | Matching authority (writable) |
| `system_program` | `Program` | System program |

**Events:**
- `OrderMatched`

---

##### `submit_limit_order`
Submit a CDA (Continuous Double Auction) limit order to the order book.

```typescript
submit_limit_order(
  order_id: u64,    // Unique order identifier
  side: u8,         // 0 = Buy, 1 = Sell
  amount: u64,      // Energy amount in milli-kWh
  price: u64        // Price per kWh (micro-units)
)
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `market` | `Account<Market>` | Trading market (writable) |
| `order` | `Account<Order>` | New order account (writable) |
| `authority` | `Signer` | Order owner (writable) |
| `system_program` | `Program` | System program |

**Events:**
- `BuyOrderCreated` (if side = 0)
- `SellOrderCreated` (if side = 1)
- `LimitOrderSubmitted`

---

##### `submit_market_order`
Submit a CDA market order for immediate execution at best available price.

```typescript
submit_market_order(
  side: u8,      // 0 = Buy (takes asks), 1 = Sell (takes bids)
  amount: u64    // Energy amount in milli-kWh
)
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `market` | `Account<Market>` | Trading market |
| `authority` | `Signer` | Order owner (writable) |

**Events:**
- `MarketOrderSubmitted`

**Errors:**
- `InsufficientLiquidity` - No orders on opposite side

---

#### Settlement

##### `execute_atomic_settlement`
Execute truly atomic settlement between buyer and seller.

```typescript
execute_atomic_settlement(
  amount: u64,          // Energy amount to settle
  price: u64,           // Settlement price
  wheeling_charge: u64  // Grid wheeling charge
)
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `market` | `Account<Market>` | Trading market (writable) |
| `buy_order` | `Account<Order>` | Buy order (writable) |
| `sell_order` | `Account<Order>` | Sell order (writable) |
| `buyer_currency_escrow` | `TokenAccount` | Buyer's currency escrow (writable) |
| `seller_energy_escrow` | `TokenAccount` | Seller's energy escrow (writable) |
| `seller_currency_account` | `TokenAccount` | Seller's currency account (writable) |
| `buyer_energy_account` | `TokenAccount` | Buyer's energy account (writable) |
| `fee_collector` | `TokenAccount` | Platform fee collector (writable) |
| `wheeling_collector` | `TokenAccount` | Grid wheeling collector (writable) |
| `energy_mint` | `Mint` | Energy token mint |
| `currency_mint` | `Mint` | Currency token mint |
| `escrow_authority` | `Signer` | Escrow authority |
| `market_authority` | `Signer` | Market authority |
| `token_program` | `Program` | Token program |
| `system_program` | `Program` | System program |
| `secondary_token_program` | `Program` | Secondary token program |

---

##### `execute_batch`
Execute a batch of orders with aggregated token transfers.

```typescript
execute_batch(
  amount: Vec<u64>,          // Array of amounts
  price: Vec<u64>,           // Array of prices
  wheeling_charge: Vec<u64>  // Array of wheeling charges
)
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `market` | `Account<Market>` | Trading market (writable) |
| `authority` | `Signer` | Batch authority (writable) |

*Additional accounts via remaining_accounts for each match.*

**Events:**
- `BatchExecuted`

---

#### Stablecoin Payments

##### `configure_payment_token`
Configure a payment token (USDC/USDT) for the market.

```typescript
configure_payment_token(
  token_type: u8,              // 0=GRID, 1=USDC, 2=USDT, 3=THB
  min_order_size: u64,         // Minimum order size
  max_price_deviation_bps: u16 // Max price deviation in bps
)
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `market` | `Account<Market>` | Trading market (writable) |
| `token_config` | `Account<TokenConfig>` | Token configuration (writable) |
| `token_mint` | `Mint` | Token mint |
| `authority` | `Signer` | Market authority (writable) |
| `system_program` | `Program` | System program |

**Events:**
- `TokenConfigured`

---

##### `create_stablecoin_buy_order`
Create a buy order with stablecoin payment.

```typescript
create_stablecoin_buy_order(
  energy_amount: u64,     // Energy amount
  max_price_per_kwh: u64, // Max price per kWh
  payment_token: u8       // Payment token type
)
```

**Events:**
- `StablecoinOrderCreated`

---

##### `execute_stablecoin_settlement`
Execute settlement with stablecoin payment.

```typescript
execute_stablecoin_settlement(
  amount: u64,        // Energy amount
  exchange_rate: u64  // THB/GRID exchange rate
)
```

**Events:**
- `StablecoinSettlement`

---

#### AMM Pool

##### `initialize_amm_pool`
Initialize the Energy AMM pool.

```typescript
initialize_amm_pool(
  curve_type: CurveType,  // LinearSolar, SteepWind, FlatBattery
  slope: u64,             // Bonding curve slope
  base: u64,              // Base price
  fee_bps: u16            // Fee in basis points
)
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `pool` | `Account<AmmPool>` | AMM pool account (writable) |
| `market` | `Account<Market>` | Associated market |
| `energy_mint` | `Mint` | Energy token mint |
| `currency_mint` | `Mint` | Currency token mint |
| `authority` | `Signer` | Pool authority (writable) |
| `system_program` | `Program` | System program |

---

##### `swap_buy_energy`
Swap currency for energy via AMM.

```typescript
swap_buy_energy(
  amount_milli_kwh: u64,  // Energy amount in milli-kWh
  max_currency: u64       // Maximum currency to spend
)
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `pool` | `Account<AmmPool>` | AMM pool (writable) |
| `user_energy_account` | `TokenAccount` | User's energy account (writable) |
| `user_currency_account` | `TokenAccount` | User's currency account (writable) |
| `pool_energy_vault` | `TokenAccount` | Pool energy vault (writable) |
| `pool_currency_vault` | `TokenAccount` | Pool currency vault (writable) |
| `energy_mint` | `Mint` | Energy token mint |
| `currency_mint` | `Mint` | Currency token mint |
| `user` | `Signer` | User authority |
| `token_program` | `Program` | Token program |

**Events:**
- `TokenSwapExecuted`

---

#### Periodic Auctions

##### `initialize_auction`
Initialize a new auction batch.

```typescript
initialize_auction(
  batch_id: u64,   // Unique batch identifier
  duration: i64    // Auction duration in seconds
)
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `batch` | `Account<AuctionBatch>` | Auction batch (writable) |
| `market` | `Account<Market>` | Associated market |
| `authority` | `Signer` | Auction authority (writable) |
| `system_program` | `Program` | System program |

---

##### `submit_auction_order`
Submit an order to the current auction.

```typescript
submit_auction_order(
  price: u64,    // Bid/ask price
  amount: u64,   // Energy amount
  is_bid: bool   // True for buy, false for sell
)
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `batch` | `Account<AuctionBatch>` | Auction batch (writable) |
| `user_token_account` | `TokenAccount` | User's token account (writable) |
| `vault` | `TokenAccount` | Auction vault (writable) |
| `token_mint` | `Mint` | Token mint |
| `authority` | `Signer` | Order submitter (writable) |
| `token_program` | `Program` | Token program |
| `system_program` | `Program` | System program |

**Events:**
- `AuctionOrderSubmitted`

---

##### `resolve_auction`
Resolve the auction by calculating uniform clearing price.

```typescript
resolve_auction()
```

**Events:**
- `AuctionResolved`

---

##### `execute_settlement`
Execute settlement for specific orders in a cleared auction.

```typescript
execute_settlement(
  bid_order_idx: u32,   // Bid order index
  ask_order_idx: u32,   // Ask order index
  settle_amount: u64    // Amount to settle
)
```

**Events:**
- `AuctionSettled`

---

##### `cancel_auction_order`
Cancel an order in an open auction batch.

```typescript
cancel_auction_order(order_idx: u32)
```

---

#### Privacy / Confidential Trading

##### `initialize_confidential_balance`
Initialize a confidential balance account.

```typescript
initialize_confidential_balance()
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `confidential_balance` | `Account<ConfidentialBalance>` | Balance account (writable) |
| `mint` | `Mint` | Token mint |
| `owner` | `Signer` | Account owner (writable) |
| `system_program` | `Program` | System program |

---

##### `shield_energy`
Convert public tokens to confidential balance.

```typescript
shield_energy(
  amount: u64,                         // Amount to shield
  encrypted_amount: ElGamalCiphertext, // Encrypted amount
  proof: RangeProof                    // Range proof
)
```

---

##### `unshield_energy`
Convert confidential balance to public tokens.

```typescript
unshield_energy(
  amount: u64,                             // Amount to unshield
  new_encrypted_amount: ElGamalCiphertext, // New encrypted balance
  proof: TransferProof                     // Transfer proof
)
```

---

##### `private_transfer`
Send encrypted tokens between confidential accounts.

```typescript
private_transfer(
  amount: u64,                         // Transfer amount
  encrypted_amount: ElGamalCiphertext, // Encrypted amount
  proof: TransferProof                 // Transfer proof
)
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `sender_balance` | `Account<ConfidentialBalance>` | Sender's balance (writable) |
| `receiver_balance` | `Account<ConfidentialBalance>` | Receiver's balance (writable) |
| `receiver_owner` | `AccountInfo` | Receiver's owner |
| `mint` | `Mint` | Token mint |
| `owner` | `Signer` | Sender authority (writable) |

---

#### Cross-Chain Bridge (Wormhole)

##### `initialize_bridge`
Initialize Wormhole bridge configuration.

```typescript
initialize_bridge(
  min_bridge_amount: u64,  // Minimum bridge amount
  bridge_fee_bps: u16,     // Bridge fee in basis points
  relayer_fee: u64         // Relayer fee
)
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `market` | `Account<Market>` | Trading market (writable) |
| `bridge_config` | `Account<BridgeConfig>` | Bridge config (writable) |
| `wormhole_program` | `Program` | Wormhole program |
| `token_bridge_program` | `Program` | Token bridge program |
| `authority` | `Signer` | Bridge authority (writable) |
| `system_program` | `Program` | System program |

---

##### `initiate_bridge_transfer`
Initiate a bridge transfer to another chain.

```typescript
initiate_bridge_transfer(
  destination_chain: u16,       // Target chain ID
  destination_address: [u8; 32],// Target address
  amount: u64,                  // Amount to bridge
  timestamp: u64                // Timestamp
)
```

**Events:**
- `BridgeInitiated`

---

##### `complete_bridge_transfer`
Complete a bridge transfer from another chain.

```typescript
complete_bridge_transfer(vaa_hash: [u8; 32])
```

**Events:**
- `BridgeCompleted`

---

##### `create_cross_chain_order`
Create a cross-chain order record.

```typescript
create_cross_chain_order(
  origin_chain: u16,           // Origin chain ID
  origin_order_id: [u8; 32],   // Origin order ID
  origin_user: [u8; 32],       // User on origin chain
  energy_amount: u64,          // Energy amount
  price: u64,                  // Price
  payment_token: [u8; 32]      // Payment token address
)
```

---

##### `match_cross_chain_order`
Match a local order with a cross-chain order.

```typescript
match_cross_chain_order(amount: u64)
```

---

#### Carbon Credits / REC

##### `initialize_carbon_marketplace`
Initialize the carbon marketplace.

```typescript
initialize_carbon_marketplace(
  minting_fee_bps: u16,   // Minting fee in bps
  trading_fee_bps: u16,   // Trading fee in bps
  kwh_to_rec_rate: u32,   // kWh to REC conversion rate
  carbon_intensity: u32   // g CO2e per kWh
)
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `marketplace` | `Account<CarbonMarketplace>` | Marketplace (writable) |
| `rec_mint` | `Mint` | REC token mint |
| `carbon_mint` | `Mint` | Carbon token mint |
| `treasury` | `TokenAccount` | Fee treasury |
| `authority` | `Signer` | Marketplace authority (writable) |
| `system_program` | `Program` | System program |

---

##### `mint_rec_certificate`
Mint a new REC certificate based on verified production.

```typescript
mint_rec_certificate(
  generation_start: i64,  // Generation period start
  generation_end: i64     // Generation period end
)
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `marketplace` | `Account<CarbonMarketplace>` | Carbon marketplace (writable) |
| `certificate` | `Account<RecCertificate>` | Certificate to mint (writable) |
| `issuer` | `Signer` | Certificate issuer (writable) |
| `verified_reading` | `Account<VerifiedReading>` | Verified meter reading |
| `authority` | `Signer` | Authority |
| `system_program` | `Program` | System program |

**Events:**
- `RecMinted`

---

##### `transfer_carbon_credits`
Transfer carbon credits (REC tokens) between wallets.

```typescript
transfer_carbon_credits(amount: u64)
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `sender` | `Signer` | Sender authority (writable) |
| `receiver` | `AccountInfo` | Receiver account |
| `sender_rec_account` | `TokenAccount` | Sender's REC account (writable) |
| `receiver_rec_account` | `TokenAccount` | Receiver's REC account (writable) |
| `rec_mint` | `Mint` | REC mint |
| `token_program` | `Program` | Token program |

**Events:**
- `CarbonCreditTransferred`

---

#### Meter Verification

##### `initialize_meter_config`
Initialize meter verification configuration.

```typescript
initialize_meter_config(
  max_delta_per_hour: u64,  // Max reading change per hour
  min_interval: u32         // Min reading interval (seconds)
)
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `config` | `Account<MeterVerificationConfig>` | Config (writable) |
| `authority` | `Signer` | Config authority (writable) |
| `system_program` | `Program` | System program |

---

##### `authorize_oracle`
Authorize a new oracle for meter verification.

```typescript
authorize_oracle(oracle: Pubkey)
```

**Events:**
- `OracleAuthorized`

---

##### `initialize_meter_history`
Initialize meter history for anomaly detection.

```typescript
initialize_meter_history()
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `history` | `Account<MeterHistory>` | History account (writable) |
| `meter` | `AccountInfo` | Meter account |
| `authority` | `Signer` | Authority (writable) |
| `system_program` | `Program` | System program |

---

##### `verify_meter_reading`
Verify a meter reading with signature and ZK checks.

```typescript
verify_meter_reading(
  reading_proof: MeterReadingProof,  // ZK proof
  timestamp: i64                     // Reading timestamp
)
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `config` | `Account<MeterVerificationConfig>` | Verification config (writable) |
| `history` | `Account<MeterHistory>` | Meter history (writable) |
| `verified_reading` | `Account<VerifiedReading>` | Verified reading (writable) |
| `authority` | `Signer` | Authority (writable) |
| `token_mint` | `Mint` | Token mint (writable) |
| `user_token_account` | `TokenAccount` | User's tokens (writable) |
| `token_program` | `Program` | Token program |
| `system_program` | `Program` | System program |

**Events:**
- `ReadingVerified`

---

### Accounts

#### `Market`
Market account for order and trade management.

```rust
pub struct Market {
    pub authority: Pubkey,              // 32 bytes
    pub total_volume: u64,              // 8 bytes
    pub created_at: i64,                // 8 bytes
    pub last_clearing_price: u64,       // 8 bytes
    pub volume_weighted_price: u64,     // 8 bytes
    pub active_orders: u32,             // 4 bytes
    pub total_trades: u32,              // 4 bytes
    pub market_fee_bps: u16,            // 2 bytes
    pub clearing_enabled: u8,           // 1 byte
    pub batch_config: BatchConfig,      // Batch configuration
    pub current_batch: BatchInfo,       // Current batch info
    pub has_current_batch: u8,          // 1 byte
    pub buy_side_depth: [PriceLevel; 20],   // Order book depth
    pub sell_side_depth: [PriceLevel; 20],  // Order book depth
    pub price_history: [PricePoint; 24],    // Price history
}
```

**Size**: ~2,000 bytes

---

#### `Order`
Order account for trading.

```rust
pub struct Order {
    pub seller: Pubkey,       // 32 bytes
    pub buyer: Pubkey,        // 32 bytes
    pub order_id: u64,        // 8 bytes
    pub amount: u64,          // 8 bytes - Energy amount (milli-kWh)
    pub filled_amount: u64,   // 8 bytes
    pub price_per_kwh: u64,   // 8 bytes - Price (micro-units)
    pub order_type: u8,       // 1 byte - 0=Sell, 1=Buy
    pub status: u8,           // 1 byte - 0=Open, 1=Partial, 2=Filled, 3=Cancelled
    pub created_at: i64,      // 8 bytes
    pub expires_at: i64,      // 8 bytes
}
```

**Size**: 120 bytes

---

#### `AmmPool`
AMM pool for automated market making.

```rust
pub struct AmmPool {
    pub market: Pubkey,           // 32 bytes
    pub energy_mint: Pubkey,      // 32 bytes
    pub currency_mint: Pubkey,    // 32 bytes
    pub energy_reserve: u64,      // 8 bytes
    pub currency_reserve: u64,    // 8 bytes
    pub curve_type: CurveType,    // 1 byte
    pub bonding_slope: u64,       // 8 bytes
    pub bonding_base: u64,        // 8 bytes
    pub fee_bps: u16,             // 2 bytes
    pub bump: u8,                 // 1 byte
}
```

**Size**: 136 bytes

---

#### `AuctionBatch`
Batch of orders for periodic auctions.

```rust
pub struct AuctionBatch {
    pub market: Pubkey,           // 32 bytes
    pub batch_id: u64,            // 8 bytes
    pub state: u8,                // 1 byte - 0=Open, 1=Closed, 2=Cleared, 3=Settled
    pub clearing_price: u64,      // 8 bytes
    pub clearing_volume: u64,     // 8 bytes
    pub orders: Vec<AuctionOrder>,// Variable
    pub start_time: i64,          // 8 bytes
    pub end_time: i64,            // 8 bytes
    pub bump: u8,                 // 1 byte
}
```

---

#### `ConfidentialBalance`
Encrypted balance for privacy trading.

```rust
pub struct ConfidentialBalance {
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub encrypted_amount: ElGamalCiphertext,
    pub pending_amount: u64,
    pub last_update_slot: u64,
    pub bump: u8,
}
```

---

#### `BridgeConfig`
Wormhole bridge configuration.

```rust
pub struct BridgeConfig {
    pub bump: u8,
    pub market: Pubkey,
    pub wormhole_program: Pubkey,
    pub token_bridge_program: Pubkey,
    pub authority: Pubkey,
    pub enabled: bool,
    pub min_bridge_amount: u64,
    pub bridge_fee_bps: u16,
    pub relayer_fee: u64,
    pub supported_chains: u32,      // Bitmap
    pub total_bridged_out: u64,
    pub total_bridged_in: u64,
    pub bridge_count: u64,
}
```

---

#### `CarbonMarketplace`
Carbon credit marketplace configuration.

```rust
pub struct CarbonMarketplace {
    pub bump: u8,
    pub authority: Pubkey,
    pub rec_mint: Pubkey,
    pub carbon_mint: Pubkey,
    pub treasury: Pubkey,
    pub minting_fee_bps: u16,
    pub trading_fee_bps: u16,
    pub retirement_fee_bps: u16,
    pub total_minted: u64,
    pub total_retired: u64,
    pub total_carbon_offset: u64,   // kg CO2e
    pub active_listings: u32,
    pub is_active: bool,
    pub kwh_to_rec_rate: u32,       // Scaled by 1000
    pub carbon_intensity: u32,      // g CO2e per kWh
}
```

---

### Events

| Event | Description |
|-------|-------------|
| `MarketInitialized` | Market created |
| `MarketParamsUpdated` | Market parameters changed |
| `BuyOrderCreated` | New buy order placed |
| `SellOrderCreated` | New sell order placed |
| `OrderCancelled` | Order cancelled |
| `OrderMatched` | Orders matched |
| `BatchExecuted` | Batch settlement completed |
| `LimitOrderSubmitted` | CDA limit order submitted |
| `MarketOrderSubmitted` | CDA market order submitted |
| `AuctionOrderSubmitted` | Order submitted to auction |
| `AuctionResolved` | Auction clearing price calculated |
| `AuctionSettled` | Auction orders settled |
| `TokenSwapExecuted` | AMM swap completed |
| `BridgeInitiated` | Cross-chain transfer started |
| `BridgeCompleted` | Cross-chain transfer completed |
| `BridgeConfigUpdated` | Bridge settings changed |
| `RecMinted` | REC certificate minted |
| `RecRetired` | REC certificate retired |
| `RecTransferred` | REC certificate transferred |
| `CarbonCreditTransferred` | Carbon credits transferred |
| `TokenConfigured` | Payment token configured |
| `StablecoinOrderCreated` | Stablecoin order created |
| `StablecoinSettlement` | Stablecoin settlement completed |
| `OracleAuthorized` | Oracle authorized |
| `ReadingVerified` | Meter reading verified |
| `ListingCreated` | Carbon listing created |
| `ListingFilled` | Carbon listing filled |
| `TokensReceived` | Wrapped tokens received |

---

### Errors

| Code | Name | Message |
|------|------|---------|
| 6000 | `BridgeDisabled` | Bridge is disabled |
| 6001 | `ChainNotSupported` | Destination chain not supported |
| 6002 | `AmountBelowMinimum` | Amount below minimum bridge amount |
| 6003 | `InvalidDestinationAddress` | Invalid destination address |
| 6004 | `TransferAlreadyCompleted` | Transfer already completed |
| 6005 | `InvalidVaa` | Invalid VAA |
| 6006 | `VaaAlreadyProcessed` | VAA already processed |
| 6007 | `WrappedTokenNotApproved` | Wrapped token not approved for trading |
| 6008 | `UnauthorizedAuthority` | Unauthorized bridge authority |
| 6009 | `InvalidWormholeProgram` | Invalid Wormhole program |
| 6010 | `BatchProcessingDisabled` | Batch processing is disabled |
| 6011 | `BatchSizeExceeded` | Batch size exceeded |
| 6012 | `ReentrancyLock` | Re-entrancy guard lock |
| 6013 | `EmptyBatch` | Batch is empty |
| 6014 | `BatchTooLarge` | Batch size exceeds maximum allowed |
| 6015 | `InsufficientLiquidity` | Insufficient liquidity for market order |

---

## Registry Program

The Registry program manages user accounts and smart meters.

### Instructions

#### `initialize`
Initialize the registry.

```typescript
initialize()
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `registry` | `Account<Registry>` | Registry account (writable) |
| `authority` | `Signer` | Registry authority (writable) |
| `system_program` | `Program` | System program |

**Events:**
- `RegistryInitialized`

---

#### `register_user`
Register a new user in the P2P energy trading system.

```typescript
register_user(
  user_type: UserType,  // Prosumer or Consumer
  lat: f64,             // Latitude
  long: f64             // Longitude
)
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `user_account` | `Account<UserAccount>` | User account (writable) |
| `registry` | `Account<Registry>` | Registry (writable) |
| `authority` | `Signer` | User authority (writable) |
| `system_program` | `Program` | System program |

**Events:**
- `UserRegistered`

---

#### `update_user_status`
Update user status (admin only).

```typescript
update_user_status(new_status: UserStatus)
```

**Events:**
- `UserStatusUpdated`

---

#### `register_meter`
Register a smart meter for an existing user.

```typescript
register_meter(
  meter_id: String,      // Unique meter ID (max 32 bytes)
  meter_type: MeterType  // Solar, Wind, Battery, Grid
)
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `meter_account` | `Account<MeterAccount>` | Meter account (writable) |
| `user_account` | `Account<UserAccount>` | User account (writable) |
| `registry` | `Account<Registry>` | Registry (writable) |
| `owner` | `Signer` | Meter owner (writable) |
| `system_program` | `Program` | System program |

**Events:**
- `MeterRegistered`

---

#### `set_meter_status`
Set meter status (owner or authority).

```typescript
set_meter_status(new_status: MeterStatus)
```

**Events:**
- `MeterStatusUpdated`

---

#### `deactivate_meter`
Deactivate a meter permanently (owner only).

```typescript
deactivate_meter()
```

**Events:**
- `MeterDeactivated`

---

#### `update_meter_reading`
Update meter reading (oracle only).

```typescript
update_meter_reading(
  energy_generated: u64,    // kWh generated
  energy_consumed: u64,     // kWh consumed
  reading_timestamp: i64    // Reading timestamp
)
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `registry` | `Account<Registry>` | Registry account |
| `meter_account` | `Account<MeterAccount>` | Meter account (writable) |
| `oracle_authority` | `Signer` | Authorized oracle |

**Events:**
- `MeterReadingUpdated`

---

#### `set_oracle_authority`
Set the oracle authority (admin only).

```typescript
set_oracle_authority(oracle: Pubkey)
```

**Events:**
- `OracleAuthoritySet`

---

#### `settle_meter_balance`
Settle meter balance for GRID token minting.

```typescript
settle_meter_balance() -> u64  // Returns tokens to mint
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `meter_account` | `Account<MeterAccount>` | Meter account (writable) |
| `meter_owner` | `Signer` | Meter owner |

**Events:**
- `MeterBalanceSettled`

---

#### `settle_and_mint_tokens`
Settle meter balance and automatically mint GRID tokens via CPI.

```typescript
settle_and_mint_tokens()
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `meter_account` | `Account<MeterAccount>` | Meter account (writable) |
| `meter_owner` | `Signer` | Meter owner |
| `token_info` | `Account<TokenInfo>` | Energy token info (writable) |
| `mint` | `Mint` | GRX mint (writable) |
| `user_token_account` | `TokenAccount` | User's tokens (writable) |
| `registry` | `Account<Registry>` | Registry (writable) |
| `energy_token_program` | `Program` | Energy token program |
| `token_program` | `Program` | Token program |

---

#### `get_unsettled_balance`
Get unsettled net generation ready for tokenization.

```typescript
get_unsettled_balance() -> u64
```

---

#### `is_valid_meter`
Verify if a meter is valid and active.

```typescript
is_valid_meter() -> bool
```

---

#### `is_valid_user`
Verify if a user is valid and active.

```typescript
is_valid_user() -> bool
```

---

### Accounts

#### `Registry`
Registry account for system metadata.

```rust
pub struct Registry {
    pub authority: Pubkey,           // 32 bytes
    pub oracle_authority: Pubkey,    // 32 bytes
    pub has_oracle_authority: u8,    // 1 byte
    pub user_count: u64,             // 8 bytes
    pub meter_count: u64,            // 8 bytes
    pub active_meter_count: u64,     // 8 bytes
}
```

**Size**: 96 bytes

---

#### `UserAccount`
User account for energy trading participants.

```rust
pub struct UserAccount {
    pub authority: Pubkey,       // 32 bytes
    pub user_type: UserType,     // 1 byte
    pub lat: f64,                // 8 bytes
    pub long: f64,               // 8 bytes
    pub status: UserStatus,      // 1 byte
    pub registered_at: i64,      // 8 bytes
    pub meter_count: u32,        // 4 bytes
}
```

**Size**: 80 bytes

---

#### `MeterAccount`
Smart meter account for energy tracking.

```rust
pub struct MeterAccount {
    pub meter_id: [u8; 32],          // 32 bytes
    pub owner: Pubkey,               // 32 bytes
    pub meter_type: MeterType,       // 1 byte
    pub status: MeterStatus,         // 1 byte
    pub registered_at: i64,          // 8 bytes
    pub last_reading_at: i64,        // 8 bytes
    pub total_generation: u64,       // 8 bytes - Total kWh generated
    pub total_consumption: u64,      // 8 bytes - Total kWh consumed
    pub settled_net_generation: u64, // 8 bytes - Already tokenized
    pub claimed_erc_generation: u64, // 8 bytes - Claimed for ERC
}
```

**Size**: 128 bytes

---

### Events

| Event | Description |
|-------|-------------|
| `RegistryInitialized` | Registry created |
| `UserRegistered` | New user registered |
| `UserStatusUpdated` | User status changed |
| `MeterRegistered` | New meter registered |
| `MeterStatusUpdated` | Meter status changed |
| `MeterDeactivated` | Meter deactivated |
| `MeterReadingUpdated` | Meter reading updated |
| `MeterBalanceSettled` | Balance settled for minting |
| `OracleAuthoritySet` | Oracle authority configured |

---

### Errors

| Code | Name | Message |
|------|------|---------|
| 6000 | `UnauthorizedUser` | Unauthorized user |
| 6001 | `UnauthorizedAuthority` | Unauthorized authority |
| 6002 | `InvalidUserStatus` | Invalid user status |
| 6003 | `InvalidMeterStatus` | Invalid meter status |
| 6004 | `UserNotFound` | User not found |
| 6005 | `MeterNotFound` | Meter not found |
| 6006 | `NoUnsettledBalance` | No unsettled balance to tokenize |
| 6007 | `OracleNotConfigured` | Oracle authority not configured |
| 6008 | `UnauthorizedOracle` | Unauthorized oracle |
| 6009 | `StaleReading` | Reading timestamp must be newer |
| 6010 | `ReadingTooHigh` | Reading exceeds maximum delta limit |
| 6011 | `AlreadyInactive` | Meter is already inactive |
| 6012 | `InvalidMeterId` | Invalid meter ID length |

---

## Oracle Program

The Oracle program bridges AMI (Advanced Metering Infrastructure) data to the blockchain.

### Instructions

#### `initialize`
Initialize the oracle.

```typescript
initialize(api_gateway: Pubkey)
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `oracle_data` | `Account<OracleData>` | Oracle data account (writable) |
| `authority` | `Signer` | Oracle authority (writable) |
| `system_program` | `Program` | System program |

---

#### `submit_meter_reading`
Submit meter reading data from AMI (API Gateway only).

```typescript
submit_meter_reading(
  meter_id: String,           // Meter identifier
  energy_produced: u64,       // kWh produced
  energy_consumed: u64,       // kWh consumed
  reading_timestamp: i64      // Reading timestamp
)
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `oracle_data` | `Account<OracleData>` | Oracle data |
| `authority` | `Signer` | API Gateway authority |

**Events:**
- `MeterReadingSubmitted`
- `MeterReadingRejected` (if validation fails)

---

#### `trigger_market_clearing`
Trigger market clearing process (API Gateway only).

```typescript
trigger_market_clearing()
```

**Events:**
- `MarketClearingTriggered`

---

#### `update_api_gateway`
Update API Gateway address (admin only).

```typescript
update_api_gateway(new_api_gateway: Pubkey)
```

**Events:**
- `ApiGatewayUpdated`

---

#### `update_oracle_status`
Update oracle status (admin only).

```typescript
update_oracle_status(active: bool)
```

**Events:**
- `OracleStatusUpdated`

---

#### `update_validation_config`
Update validation configuration (admin only).

```typescript
update_validation_config(
  min_energy_value: u64,              // Minimum valid energy
  max_energy_value: u64,              // Maximum valid energy
  anomaly_detection_enabled: bool,    // Enable anomaly detection
  max_reading_deviation_percent: u16, // Max deviation %
  require_consensus: bool             // Require multi-oracle consensus
)
```

**Events:**
- `ValidationConfigUpdated`

---

#### `update_production_ratio_config`
Update production/consumption ratio validation threshold.

```typescript
update_production_ratio_config(max_production_consumption_ratio: u16)
```

**Events:**
- `ProductionRatioConfigUpdated`

---

#### `add_backup_oracle`
Add backup oracle (admin only).

```typescript
add_backup_oracle(backup_oracle: Pubkey)
```

**Events:**
- `BackupOracleAdded`

---

#### `remove_backup_oracle`
Remove backup oracle (admin only).

```typescript
remove_backup_oracle(backup_oracle: Pubkey)
```

**Events:**
- `BackupOracleRemoved`

---

### Accounts

#### `OracleData`
Oracle configuration and state.

```rust
pub struct OracleData {
    pub authority: Pubkey,                     // 32 bytes
    pub api_gateway: Pubkey,                   // 32 bytes
    pub backup_oracles: [Pubkey; 10],          // 320 bytes
    pub total_readings: u64,                   // 8 bytes
    pub last_reading_timestamp: i64,           // 8 bytes
    pub last_clearing: i64,                    // 8 bytes
    pub created_at: i64,                       // 8 bytes
    pub min_energy_value: u64,                 // 8 bytes
    pub max_energy_value: u64,                 // 8 bytes
    pub total_valid_readings: u64,             // 8 bytes
    pub total_rejected_readings: u64,          // 8 bytes
    pub quality_score_updated_at: i64,         // 8 bytes
    pub last_consensus_timestamp: i64,         // 8 bytes
    pub last_energy_produced: u64,             // 8 bytes
    pub last_energy_consumed: u64,             // 8 bytes
    pub min_reading_interval: u64,             // 8 bytes
    pub average_reading_interval: u32,         // 4 bytes
    pub max_reading_deviation_percent: u16,    // 2 bytes
    pub max_production_consumption_ratio: u16, // 2 bytes
    pub active: u8,                            // 1 byte
    pub anomaly_detection_enabled: u8,         // 1 byte
    pub require_consensus: u8,                 // 1 byte
    pub last_quality_score: u8,                // 1 byte
    pub backup_oracles_count: u8,              // 1 byte
    pub consensus_threshold: u8,               // 1 byte
}
```

**Size**: 512 bytes

---

### Events

| Event | Description |
|-------|-------------|
| `MeterReadingSubmitted` | Reading accepted |
| `MeterReadingRejected` | Reading rejected with reason |
| `MarketClearingTriggered` | Clearing process triggered |
| `ApiGatewayUpdated` | API Gateway address changed |
| `OracleStatusUpdated` | Oracle status changed |
| `ValidationConfigUpdated` | Validation config changed |
| `ProductionRatioConfigUpdated` | Ratio config changed |
| `BackupOracleAdded` | Backup oracle added |
| `BackupOracleRemoved` | Backup oracle removed |

---

### Errors

| Code | Name | Message |
|------|------|---------|
| 6000 | `UnauthorizedAuthority` | Unauthorized authority |
| 6001 | `UnauthorizedGateway` | Unauthorized API Gateway |
| 6002 | `OracleInactive` | Oracle is inactive |
| 6003 | `InvalidMeterReading` | Invalid meter reading |
| 6004 | `MarketClearingInProgress` | Market clearing in progress |
| 6005 | `EnergyValueOutOfRange` | Energy value out of range |
| 6006 | `AnomalousReading` | Anomalous reading detected |
| 6007 | `MaxBackupOraclesReached` | Maximum backup oracles reached |
| 6008 | `OutdatedReading` | Reading timestamp older than last |
| 6009 | `FutureReading` | Reading timestamp too far in future |
| 6010 | `RateLimitExceeded` | Readings too frequent |
| 6011 | `BackupOracleAlreadyExists` | Backup oracle already exists |
| 6012 | `BackupOracleNotFound` | Backup oracle not found |
| 6013 | `InvalidConfiguration` | Invalid configuration parameter |

---

## Governance Program

The Governance program manages the Proof-of-Authority administration and ERC (Energy Regulatory Commission) certificates.

### Instructions

#### `initialize_poa`
Initialize Proof-of-Authority governance.

```typescript
initialize_poa()
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `poa_config` | `Account<PoAConfig>` | PoA config (writable) |
| `authority` | `Signer` | Initial authority (writable) |
| `system_program` | `Program` | System program |

**Events:**
- `PoAInitialized`

---

#### `issue_erc`
Issue an ERC certificate.

```typescript
issue_erc(
  certificate_id: String,   // Unique certificate ID
  energy_amount: u64,       // Energy amount (kWh)
  renewable_source: String, // Energy source (solar, wind, etc.)
  validation_data: String   // Additional validation data
)
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `poa_config` | `Account<PoAConfig>` | PoA configuration |
| `erc_certificate` | `Account<ErcCertificate>` | Certificate (writable) |
| `meter_account` | `Account<MeterAccount>` | Meter account |
| `authority` | `Signer` | Issuing authority (writable) |
| `system_program` | `Program` | System program |

**Events:**
- `ErcIssued`

---

#### `revoke_erc`
Revoke an ERC certificate.

```typescript
revoke_erc(reason: String)
```

**Events:**
- `ErcRevoked`

---

#### `transfer_erc`
Transfer an ERC certificate to a new owner.

```typescript
transfer_erc()
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `poa_config` | `Account<PoAConfig>` | PoA configuration |
| `erc_certificate` | `Account<ErcCertificate>` | Certificate (writable) |
| `current_owner` | `Signer` | Current certificate owner |
| `new_owner` | `AccountInfo` | New owner |

**Events:**
- `ErcTransferred`

---

#### `validate_erc_for_trading`
Validate an ERC certificate for trading.

```typescript
validate_erc_for_trading()
```

**Events:**
- `ErcValidatedForTrading`

---

#### `update_erc_limits`
Update ERC issuance limits.

```typescript
update_erc_limits(
  min_energy_amount: u64,     // Minimum energy (kWh)
  max_erc_amount: u64,        // Maximum energy per certificate
  erc_validity_period: i64    // Validity period (seconds)
)
```

**Events:**
- `ErcLimitsUpdated`

---

#### `update_governance_config`
Update governance configuration.

```typescript
update_governance_config(erc_validation_enabled: bool)
```

**Events:**
- `GovernanceConfigUpdated`

---

#### `set_oracle_authority`
Set oracle authority for ERC validation.

```typescript
set_oracle_authority(
  oracle_authority: Pubkey,  // Oracle authority pubkey
  min_confidence: u8,        // Minimum confidence (0-100)
  require_validation: bool   // Require oracle validation
)
```

**Events:**
- `OracleAuthoritySet`

---

#### `propose_authority_change`
Propose a new authority (2-step transfer).

```typescript
propose_authority_change(new_authority: Pubkey)
```

**Events:**
- `AuthorityChangeProposed`

---

#### `approve_authority_change`
Approve authority change (new authority signs).

```typescript
approve_authority_change()
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `poa_config` | `Account<PoAConfig>` | PoA config (writable) |
| `new_authority` | `Signer` | New authority |

**Events:**
- `AuthorityChangeApproved`

---

#### `cancel_authority_change`
Cancel pending authority change.

```typescript
cancel_authority_change()
```

**Events:**
- `AuthorityChangeCancelled`

---

#### `emergency_pause`
Activate emergency pause.

```typescript
emergency_pause()
```

**Events:**
- `EmergencyPauseActivated`

---

#### `emergency_unpause`
Deactivate emergency pause.

```typescript
emergency_unpause()
```

**Events:**
- `EmergencyPauseDeactivated`

---

#### `set_maintenance_mode`
Set maintenance mode.

```typescript
set_maintenance_mode(maintenance_enabled: bool)
```

**Events:**
- `MaintenanceModeUpdated`

---

#### `update_authority_info`
Update authority contact information.

```typescript
update_authority_info(contact_info: String)
```

**Events:**
- `AuthorityInfoUpdated`

---

#### `get_governance_stats`
Get governance statistics (view function).

```typescript
get_governance_stats() -> GovernanceStats
```

---

### Accounts

#### `PoAConfig`
Proof-of-Authority configuration.

```rust
pub struct PoAConfig {
    pub authority: Pubkey,                    // REC certifying entity
    pub authority_name: String,               // e.g., "REC"
    pub contact_info: String,                 // Contact information
    pub version: u8,                          // Governance version
    pub emergency_paused: bool,               // Emergency pause status
    pub emergency_timestamp: Option<i64>,     // Pause timestamp
    pub emergency_reason: Option<String>,     // Pause reason
    pub maintenance_mode: bool,               // Maintenance mode
    pub erc_validation_enabled: bool,         // ERC validation enabled
    pub min_energy_amount: u64,               // Min energy for ERC
    pub max_erc_amount: u64,                  // Max energy per certificate
    pub erc_validity_period: i64,             // Validity period (seconds)
    pub auto_revoke_expired: bool,            // Auto-revoke expired
    pub require_oracle_validation: bool,      // Require oracle
    pub delegation_enabled: bool,             // Allow delegation
    pub oracle_authority: Option<Pubkey>,     // Oracle authority
    pub min_oracle_confidence: u8,            // Min confidence (0-100)
    pub allow_certificate_transfers: bool,    // Allow transfers
    pub total_ercs_issued: u64,               // Total issued
    pub total_ercs_validated: u64,            // Total validated
    pub total_ercs_revoked: u64,              // Total revoked
    pub total_energy_certified: u64,          // Total kWh certified
    pub created_at: i64,
    pub last_updated: i64,
    pub last_erc_issued_at: Option<i64>,
    pub pending_authority: Option<Pubkey>,              // For 2-step transfer
    pub pending_authority_proposed_at: Option<i64>,
    pub pending_authority_expires_at: Option<i64>,     // 48 hours expiry
}
```

---

#### `ErcCertificate`
Energy Regulatory Commission certificate.

```rust
pub struct ErcCertificate {
    pub certificate_id: String,             // Unique ID
    pub authority: Pubkey,                  // Issuing authority
    pub owner: Pubkey,                      // Current owner
    pub energy_amount: u64,                 // kWh certified
    pub renewable_source: String,           // solar, wind, etc.
    pub validation_data: String,            // Additional data
    pub issued_at: i64,                     // Issue timestamp
    pub expires_at: Option<i64>,            // Expiry timestamp
    pub status: ErcStatus,                  // Valid, Expired, Revoked, Pending
    pub validated_for_trading: bool,        // Trading validated
    pub trading_validated_at: Option<i64>,  // Validation timestamp
    pub revocation_reason: Option<String>,  // Revocation reason
    pub revoked_at: Option<i64>,            // Revocation timestamp
    pub transfer_count: u8,                 // Transfer count
    pub last_transferred_at: Option<i64>,   // Last transfer
}
```

---

### Events

| Event | Description |
|-------|-------------|
| `PoAInitialized` | PoA governance initialized |
| `ErcIssued` | ERC certificate issued |
| `ErcRevoked` | ERC certificate revoked |
| `ErcTransferred` | ERC certificate transferred |
| `ErcValidatedForTrading` | ERC validated for trading |
| `ErcLimitsUpdated` | ERC limits changed |
| `GovernanceConfigUpdated` | Governance config changed |
| `OracleAuthoritySet` | Oracle authority configured |
| `AuthorityChangeProposed` | Authority change proposed |
| `AuthorityChangeApproved` | Authority change approved |
| `AuthorityChangeCancelled` | Authority change cancelled |
| `EmergencyPauseActivated` | Emergency pause activated |
| `EmergencyPauseDeactivated` | Emergency pause deactivated |
| `MaintenanceModeUpdated` | Maintenance mode changed |
| `AuthorityInfoUpdated` | Authority info updated |

---

### Errors

| Code | Name | Message |
|------|------|---------|
| 6000 | `UnauthorizedAuthority` | Unauthorized authority |
| 6001 | `AlreadyPaused` | System is already paused |
| 6002 | `NotPaused` | System is not paused |
| 6003 | `SystemPaused` | System is currently paused |
| 6004 | `MaintenanceMode` | System is in maintenance mode |
| 6005 | `ErcValidationDisabled` | ERC validation is disabled |
| 6006 | `InvalidErcStatus` | Invalid ERC status |
| 6007 | `AlreadyValidated` | ERC already validated |
| 6008 | `BelowMinimumEnergy` | Energy below minimum required |
| 6009 | `ExceedsMaximumEnergy` | Energy exceeds maximum allowed |
| 6010 | `CertificateIdTooLong` | Certificate ID too long |
| 6011 | `SourceNameTooLong` | Renewable source name too long |
| 6012 | `ErcExpired` | ERC certificate has expired |
| 6013 | `InvalidMinimumEnergy` | Invalid minimum energy amount |
| 6014 | `InvalidMaximumEnergy` | Invalid maximum energy amount |
| 6015 | `InvalidValidityPeriod` | Invalid validity period |
| 6016 | `ContactInfoTooLong` | Contact information too long |
| 6017 | `InvalidOracleConfidence` | Invalid oracle confidence (0-100) |
| 6018 | `OracleValidationRequired` | Oracle validation required but not configured |
| 6019 | `TransfersNotAllowed` | Certificate transfers not allowed |
| 6020 | `InsufficientUnclaimedGeneration` | Insufficient unclaimed generation |
| 6021 | `AlreadyRevoked` | Certificate already revoked |
| 6022 | `RevocationReasonRequired` | Revocation reason required |
| 6023 | `InvalidRecipient` | Invalid transfer recipient |
| 6024 | `CannotTransferToSelf` | Cannot transfer to self |
| 6025 | `NotValidatedForTrading` | Certificate not validated for trading |
| 6026 | `AuthorityChangePending` | Authority change already pending |
| 6027 | `NoAuthorityChangePending` | No authority change pending |
| 6028 | `InvalidPendingAuthority` | Invalid pending authority |
| 6029 | `AuthorityChangeExpired` | Authority change expired |
| 6030 | `OracleConfidenceTooLow` | Oracle confidence below threshold |
| 6031 | `InvalidOracleAuthority` | Invalid oracle authority |
| 6032 | `ValidationDataTooLong` | Validation data too long |

---

## Energy Token Program

The Energy Token program manages the GRX (GRID) SPL token.

### Instructions

#### `initialize_token`
Initialize the energy token program.

```typescript
initialize_token(registry_program_id: Pubkey)
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `token_info` | `Account<TokenInfo>` | Token info (writable) |
| `mint` | `Mint` | GRX mint (writable) |
| `authority` | `Signer` | Token authority (writable) |
| `system_program` | `Program` | System program |
| `token_program` | `Program` | Token program |
| `rent` | `Sysvar` | Rent sysvar |

---

#### `create_token_mint`
Add metadata to existing GRX token mint via Metaplex.

```typescript
create_token_mint(
  name: String,    // Token name
  symbol: String,  // Token symbol
  uri: String      // Metadata URI
)
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `mint` | `Mint` | GRX mint (writable) |
| `token_info` | `Account<TokenInfo>` | Token info |
| `metadata` | `AccountInfo` | Metadata account (writable) |
| `payer` | `Signer` | Transaction payer (writable) |
| `authority` | `Signer` | Token authority |
| `system_program` | `Program` | System program |
| `token_program` | `Program` | Token program |
| `metadata_program` | `Program` | Metaplex metadata program |
| `rent` | `Sysvar` | Rent sysvar |
| `sysvar_instructions` | `Sysvar` | Instructions sysvar |

---

#### `mint_tokens_direct`
Mint tokens directly to a user (authority or registry only).

```typescript
mint_tokens_direct(amount: u64)
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `token_info` | `Account<TokenInfo>` | Token info (writable) |
| `mint` | `Mint` | GRX mint (writable) |
| `user_token_account` | `TokenAccount` | User's token account (writable) |
| `authority` | `Signer` | Minting authority |
| `token_program` | `Program` | Token program |

**Events:**
- `TokensMintedDirect`

---

#### `mint_to_wallet`
Mint GRX tokens to a wallet using Token interface.

```typescript
mint_to_wallet(amount: u64)
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `mint` | `Mint` | GRX mint (writable) |
| `token_info` | `Account<TokenInfo>` | Token info |
| `destination` | `TokenAccount` | Destination account (writable) |
| `destination_owner` | `AccountInfo` | Destination owner |
| `authority` | `Signer` | Minting authority |
| `payer` | `Signer` | Transaction payer (writable) |
| `token_program` | `Program` | Token program |
| `associated_token_program` | `Program` | ATA program |
| `system_program` | `Program` | System program |

**Events:**
- `TokensMinted`

---

#### `burn_tokens`
Burn energy tokens (for energy consumption).

```typescript
burn_tokens(amount: u64)
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `token_info` | `Account<TokenInfo>` | Token info (writable) |
| `mint` | `Mint` | GRX mint (writable) |
| `token_account` | `TokenAccount` | Token account to burn from (writable) |
| `authority` | `Signer` | Token account authority |
| `token_program` | `Program` | Token program |

---

#### `transfer_tokens`
Transfer energy tokens between accounts.

```typescript
transfer_tokens(amount: u64)
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `from_token_account` | `TokenAccount` | Source account (writable) |
| `to_token_account` | `TokenAccount` | Destination account (writable) |
| `mint` | `Mint` | GRX mint |
| `from_authority` | `Signer` | Source authority |
| `token_program` | `Program` | Token program |

---

#### `add_rec_validator`
Add a REC validator to the system.

```typescript
add_rec_validator(
  validator_pubkey: Pubkey,  // Validator public key
  authority_name: String     // Authority name
)
```

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `token_info` | `Account<TokenInfo>` | Token info (writable) |
| `authority` | `Signer` | Token authority |

---

### Accounts

#### `TokenInfo`
Token program configuration and state.

```rust
pub struct TokenInfo {
    pub authority: Pubkey,            // 32 bytes
    pub registry_program: Pubkey,     // 32 bytes
    pub mint: Pubkey,                 // 32 bytes
    pub total_supply: u64,            // 8 bytes
    pub created_at: i64,              // 8 bytes
    pub rec_validators: [Pubkey; 5],  // 160 bytes - Max 5 validators
    pub rec_validators_count: u8,     // 1 byte
}
```

**Size**: 280 bytes

---

### Events

| Event | Description |
|-------|-------------|
| `TokensMinted` | Tokens minted to wallet |
| `TokensMintedDirect` | Tokens minted directly |
| `GridTokensMinted` | GRID tokens minted from meter settlement |

---

### Errors

| Code | Name | Message |
|------|------|---------|
| 6000 | `UnauthorizedAuthority` | Unauthorized authority |
| 6001 | `InvalidMeter` | Invalid meter |
| 6002 | `InsufficientBalance` | Insufficient token balance |
| 6003 | `InvalidMetadataAccount` | Invalid metadata account |
| 6004 | `NoUnsettledBalance` | No unsettled balance |
| 6005 | `UnauthorizedRegistry` | Unauthorized registry program |
| 6006 | `ValidatorAlreadyExists` | Validator already exists |
| 6007 | `MaxValidatorsReached` | Maximum validators reached |

---

## Common Types

### Enums

#### `UserType`
```rust
pub enum UserType {
    Prosumer,  // Can produce and consume
    Consumer,  // Can only consume
}
```

#### `UserStatus`
```rust
pub enum UserStatus {
    Active,
    Suspended,
    Inactive,
}
```

#### `MeterType`
```rust
pub enum MeterType {
    Solar,
    Wind,
    Battery,
    Grid,
}
```

#### `MeterStatus`
```rust
pub enum MeterStatus {
    Active,
    Inactive,
    Maintenance,
}
```

#### `CurveType`
```rust
pub enum CurveType {
    LinearSolar,   // P = slope * q + base
    SteepWind,     // Steeper curve for wind
    FlatBattery,   // Flatter curve for battery
}
```

#### `ErcStatus`
```rust
pub enum ErcStatus {
    Valid,
    Expired,
    Revoked,
    Pending,
}
```

---

### Cryptographic Types

#### `ElGamalCiphertext`
```rust
pub struct ElGamalCiphertext {
    pub r_g: [u8; 32],  // Random point
    pub c: [u8; 32],    // Ciphertext
}
```

#### `Commitment`
```rust
pub struct Commitment {
    pub point: [u8; 32],  // Pedersen commitment point
}
```

#### `RangeProof`
```rust
pub struct RangeProof {
    pub proof_data: [u8; 64],
    pub commitment: Commitment,
}
```

#### `TransferProof`
```rust
pub struct TransferProof {
    pub amount_commitment: Commitment,
    pub amount_range_proof: RangeProof,
    pub remaining_range_proof: RangeProof,
    pub balance_proof: EqualityProof,
}
```

---

### Configuration Types

#### `BatchConfig`
```rust
pub struct BatchConfig {
    pub enabled: u8,
    pub max_batch_size: u32,
    pub batch_timeout_seconds: u32,
    pub min_batch_size: u32,
    pub price_improvement_threshold: u16,
}
```

#### `PriceTier`
```rust
pub struct PriceTier {
    pub base_price: u64,     // Micro-units (6 decimals)
    pub multiplier: u16,     // 100 = 1.0x, 150 = 1.5x
    pub start_hour: u8,      // 0-23
    pub end_hour: u8,        // 0-23
    pub period: u8,          // Time period classification
}
```

#### `GovernanceStats`
```rust
pub struct GovernanceStats {
    pub total_ercs_issued: u64,
    pub total_ercs_validated: u64,
    pub total_ercs_revoked: u64,
    pub total_energy_certified: u64,
    pub erc_validation_enabled: bool,
    pub emergency_paused: bool,
    pub maintenance_mode: bool,
    pub min_energy_amount: u64,
    pub max_erc_amount: u64,
    pub erc_validity_period: i64,
    pub require_oracle_validation: bool,
    pub allow_certificate_transfers: bool,
    pub delegation_enabled: bool,
    pub created_at: i64,
    pub last_updated: i64,
    pub last_erc_issued_at: Option<i64>,
    pub pending_authority_change: bool,
    pub pending_authority: Option<Pubkey>,
    pub pending_authority_expires_at: Option<i64>,
    pub oracle_authority: Option<Pubkey>,
    pub min_oracle_confidence: u8,
}
```

---

## SDK Usage Examples

### TypeScript SDK Setup

```typescript
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { Trading } from './types/trading';
import { Registry } from './types/registry';

// Initialize connection
const connection = new Connection('https://api.devnet.solana.com');
const wallet = new Wallet(Keypair.fromSecretKey(/* ... */));
const provider = new AnchorProvider(connection, wallet, {});

// Load programs
const tradingProgram = new Program<Trading>(
  tradingIdl,
  '8S2e2p4ghqMJuzTz5AkAKSka7jqsjgBH7eWDcCHzXPND',
  provider
);

const registryProgram = new Program<Registry>(
  registryIdl,
  'CXXRVpEwyd2ch7eo425mtaBfr2Yi1825Nm6yik2NEWqR',
  provider
);
```

---

### Register User

```typescript
const [userAccount] = PublicKey.findProgramAddressSync(
  [Buffer.from('user'), wallet.publicKey.toBuffer()],
  registryProgram.programId
);

await registryProgram.methods
  .registerUser(
    { prosumer: {} },  // UserType
    13.7563,           // Latitude
    100.5018           // Longitude
  )
  .accounts({
    userAccount,
    registry: registryPda,
    authority: wallet.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

---

### Create Buy Order

```typescript
const orderId = Date.now();
const [orderAccount] = PublicKey.findProgramAddressSync(
  [Buffer.from('order'), new BN(orderId).toArrayLike(Buffer, 'le', 8)],
  tradingProgram.programId
);

await tradingProgram.methods
  .createBuyOrder(
    new BN(orderId),
    new BN(10_000_000),   // 10 kWh (in milli-kWh)
    new BN(4_500_000)     // 4.5 THB/kWh (in micro-units)
  )
  .accounts({
    market: marketPda,
    order: orderAccount,
    authority: wallet.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

---

### Submit Auction Order

```typescript
await tradingProgram.methods
  .submitAuctionOrder(
    new BN(4_200_000),    // 4.2 THB/kWh bid price
    new BN(5_000_000),    // 5 kWh amount
    true                   // is_bid (true = buy)
  )
  .accounts({
    batch: auctionBatchPda,
    userTokenAccount: userCurrencyAta,
    vault: auctionVault,
    tokenMint: currencyMint,
    authority: wallet.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

---

### Listen to Events

```typescript
// Subscribe to order matched events
const listener = tradingProgram.addEventListener('OrderMatched', (event) => {
  console.log('Order matched:', {
    buyer: event.buyer.toBase58(),
    seller: event.seller.toBase58(),
    amount: event.amount.toNumber() / 1000, // kWh
    price: event.price.toNumber() / 1_000_000, // THB
    totalValue: event.totalValue.toNumber() / 1_000_000,
  });
});

// Remove listener when done
tradingProgram.removeEventListener(listener);
```

---

### PDA Derivation

```typescript
// Market PDA
const [marketPda] = PublicKey.findProgramAddressSync(
  [Buffer.from('market')],
  tradingProgram.programId
);

// User account PDA
const [userPda] = PublicKey.findProgramAddressSync(
  [Buffer.from('user'), userPubkey.toBuffer()],
  registryProgram.programId
);

// Meter account PDA
const [meterPda] = PublicKey.findProgramAddressSync(
  [Buffer.from('meter'), Buffer.from(meterId)],
  registryProgram.programId
);

// AMM pool PDA
const [poolPda] = PublicKey.findProgramAddressSync(
  [Buffer.from('amm_pool'), marketPda.toBuffer()],
  tradingProgram.programId
);

// Auction batch PDA
const [batchPda] = PublicKey.findProgramAddressSync(
  [Buffer.from('auction'), new BN(batchId).toArrayLike(Buffer, 'le', 8)],
  tradingProgram.programId
);

// Pricing config PDA
const [pricingPda] = PublicKey.findProgramAddressSync(
  [Buffer.from('pricing'), marketPda.toBuffer()],
  tradingProgram.programId
);

// Bridge config PDA
const [bridgePda] = PublicKey.findProgramAddressSync(
  [Buffer.from('bridge'), marketPda.toBuffer()],
  tradingProgram.programId
);
```

---

## Related Documentation

- [Trading Deep Dive](programs/deep-dive/amm-deep-dive.md)
- [Periodic Auctions](programs/deep-dive/auction-deep-dive.md)
- [Privacy Trading](programs/deep-dive/privacy-deep-dive.md)
- [Cross-Chain Bridge](programs/deep-dive/bridge-deep-dive.md)
- [Carbon Credits](programs/deep-dive/carbon-deep-dive.md)
- [Oracle Integration](programs/deep-dive/oracle-deep-dive.md)
- [Settlement Mechanisms](programs/deep-dive/settlement-deep-dive.md)
- [Glossary](glossary.md)
- [Transaction & Settlement Guide](transaction-settlement-guide.md)
- [Benchmark Report](benchmark-report.md)

---

*GridTokenX API Reference v2.0.0 - Complete IDL Documentation*
