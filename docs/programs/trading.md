# Trading Program

> **Multi-Modal Decentralized Energy Marketplace**

**Program ID:** `69dGpKu9a8EZiZ7orgfTH6CoGj9DeQHHkHBF2exSr8na`

---

## Overview

The Trading program implements a sophisticated energy marketplace with **four concurrent trading mechanisms**:

1. **P2P Order Book** — Traditional limit orders with partial fills
2. **Continuous Double Auction (CDA)** — Limit orders + market orders with immediate matching
3. **Batch Processing** — Grouped order execution for efficiency
4. **Sharded Order Book** — Distributed order matching to reduce write contention

### Key Features

- **ERC-Linked Orders** — Sell orders optionally validate against Renewable Energy Certificates
- **Sharded Matching** — Market shards distribute trade load for parallel execution
- **Zone Markets** — Geographic order book depth tracking via `ZoneMarket` accounts
- **Price Bounds** — Configurable min/max price enforcement
- **Governance Integration** — Checks PoA operational status before trading

---

## State Accounts

### Market

**PDA Seeds:** `["market"]`
**Layout:** `zero_copy`

| Field | Type | Description |
|-------|------|-------------|
| `authority` | `Pubkey` | Market administrator |
| `total_volume` | `u64` | Cumulative energy traded |
| `total_trades` | `u32` | Lifetime trade count |
| `active_orders` | `u32` | Currently open orders |
| `created_at` | `i64` | Market initialization timestamp |
| `market_fee_bps` | `u16` | Platform fee (default: 25 bps = 0.25%) |
| `clearing_enabled` | `u8` | Boolean: 1 = clearing active |
| `locked` | `u8` | Re-entrancy guard flag |
| `min_price_per_kwh` | `u64` | Minimum allowed price (must be > 0) |
| `max_price_per_kwh` | `u64` | Maximum allowed price (0 = no cap) |
| `last_clearing_price` | `u64` | Most recent matched price |
| `volume_weighted_price` | `u64` | VWAP across price history |
| `price_history` | `[PricePoint; 24]` | Last 24 hourly snapshots (ring buffer) |
| `price_history_count` | `u8` | Valid entries in price history |
| `price_history_head` | `u8` | Ring-buffer write head |
| `batch_config` | `BatchConfig` | Batch processing configuration |
| `current_batch` | `BatchInfo` | Active batch (up to 32 order IDs) |
| `has_current_batch` | `u8` | Boolean: 1 = batch active |
| `num_shards` | `u8` | Number of market shards |

### BatchConfig

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | `u8` | Batch processing toggle |
| `max_batch_size` | `u32` | Maximum orders per batch |
| `batch_timeout_seconds` | `u32` | Batch expiration window |
| `min_batch_size` | `u32` | Minimum orders to execute |
| `price_improvement_threshold` | `u16` | Minimum price improvement bps |

### BatchInfo

| Field | Type | Description |
|-------|------|-------------|
| `batch_id` | `u64` | Unique batch identifier |
| `order_count` | `u32` | Orders in this batch |
| `total_volume` | `u64` | Total batch volume |
| `created_at` | `i64` | Batch creation time |
| `expires_at` | `i64` | Batch expiration time |
| `order_ids` | `[Pubkey; 32]` | Order account pubkeys |

### Order

**PDA Seeds:** `["order", ...]` (context-dependent)
**Layout:** `zero_copy`

| Field | Type | Description |
|-------|------|-------------|
| `seller` | `Pubkey` | Sell-side participant (default if buy order) |
| `buyer` | `Pubkey` | Buy-side participant (default if sell order) |
| `order_id` | `u64` | User-provided order identifier |
| `amount` | `u64` | Total energy quantity |
| `filled_amount` | `u64` | Partial fill tracking |
| `price_per_kwh` | `u64` | Limit price |
| `order_type` | `u8` | `Sell(0) | Buy(1)` |
| `status` | `u8` | `Active | PartiallyFilled | Completed | Cancelled | Expired` |
| `created_at` | `i64` | Order placement timestamp |
| `expires_at` | `i64` | Auto-expiration (default: 24h) |

### TradeRecord

**Layout:** `zero_copy` (immutable once written)

| Field | Type | Description |
|-------|------|-------------|
| `sell_order` | `Pubkey` | Sell order account |
| `buy_order` | `Pubkey` | Buy order account |
| `seller` | `Pubkey` | Seller pubkey |
| `buyer` | `Pubkey` | Buyer pubkey |
| `amount` | `u64` | Matched volume |
| `price_per_kwh` | `u64` | Execution price |
| `total_value` | `u64` | `amount × price` |
| `fee_amount` | `u64` | Platform fee |
| `executed_at` | `i64` | Trade timestamp |

### ZoneMarket

**PDA Seeds:** `["zone_market", market, zone_id]`
**Layout:** `zero_copy`

| Field | Type | Description |
|-------|------|-------------|
| `market` | `Pubkey` | Parent market |
| `zone_id` | `u32` | Geographic zone identifier |
| `num_shards` | `u8` | Number of zone shards |
| `total_volume` | `u64` | Zone-specific volume |
| `active_orders` | `u32` | Open orders in this zone |
| `total_trades` | `u32` | Zone trade count |
| `last_clearing_price` | `u64` | Zone clearing price |
| `buy_side_depth` | `[PriceLevel; 10]` | Buy-side order book depth |
| `sell_side_depth` | `[PriceLevel; 10]` | Sell-side order book depth |

### PriceLevel

| Field | Type | Description |
|-------|------|-------------|
| `price` | `u64` | Price point |
| `total_amount` | `u64` | Aggregate volume at this price |
| `order_count` | `u16` | Number of orders |

### PricePoint

| Field | Type | Description |
|-------|------|-------------|
| `price` | `u64` | Historical price |
| `volume` | `u64` | Historical volume |
| `timestamp` | `i64` | Snapshot timestamp |

### MarketShard

**PDA Seeds:** `["market_shard", market, shard_id]`

| Field | Type | Description |
|-------|------|-------------|
| `shard_id` | `u8` | Shard identifier |
| `market` | `Pubkey` | Parent market |
| `volume_accumulated` | `u64` | Shard-specific volume |
| `order_count` | `u32` | Shard order count |
| `last_update` | `i64` | Last update timestamp |

### ZoneMarketShard

**PDA Seeds:** `["zone_market_shard", zone_market, shard_id]`

| Field | Type | Description |
|-------|------|-------------|
| `shard_id` | `u8` | Shard identifier |
| `zone_market` | `Pubkey` | Parent zone |
| `volume_accumulated` | `u64` | Shard volume |
| `trade_count` | `u32` | Shard trades |
| `last_clearing_price` | `u64` | Shard clearing price |
| `last_update` | `i64` | Last update |

### OrderNullifier

Used for sharded limit order submission to prevent duplicate orders.

---

## Instructions

### initialize_program

Creates the global market singleton.

**Accounts:**
- `market` (init, PDA `["market"]`)
- `authority` (Signer, mut)

**Defaults:** `fee = 25 bps`, `clearing_enabled = 1`, `batch_config` with 300s timeout

---

### initialize_market

Initializes the market with shard configuration.

**Arguments:**
- `num_shards: u8` — Number of order book shards

**Accounts:**
- `market` (init, PDA `["market"]`)
- `authority` (Signer, mut)

---

### initialize_zone_market

Creates a zone-specific market for geographic order book depth.

**Arguments:**
- `zone_id: u32`
- `num_shards: u8`

**Accounts:**
- `zone_market` (init, PDA)
- `market` (readonly)
- `authority` (Signer, mut)

---

### initialize_zone_market_shard

Creates a zone market shard for distributed statistics.

**Arguments:**
- `shard_id: u8`

---

### create_sell_order

Lists energy for sale with optional ERC validation.

**Arguments:**
- `order_id_val: u64`
- `energy_amount: u64`
- `price_per_kwh: u64`

**Accounts:**
- `order` (init, PDA)
- `market` (readonly)
- `zone_market` (mut)
- `authority` (Signer)
- `governance_config` (readonly) — Must be operational
- `erc_certificate` (optional) — ERC validation

**ERC Validation (if provided):**
- `status == Valid`
- Not expired (`current_time < expires_at`)
- `validated_for_trading == true`
- `energy_amount <= erc_certificate.energy_amount`

**Event:** `SellOrderCreated`

---

### create_buy_order

Places a bid for energy.

**Arguments:**
- `order_id_val: u64`
- `energy_amount: u64`
- `max_price_per_kwh: u64`

**Accounts:**
- `order` (init, PDA)
- `zone_market` (mut)
- `authority` (Signer)
- `governance_config` (readonly)

**Event:** `BuyOrderCreated`

---

### match_orders

Executes a trade between buy and sell orders.

**Arguments:**
- `match_amount: u64`

**Validation:**
- Both orders `Active | PartiallyFilled`
- `buy_order.price >= sell_order.price` (price crossing)

**Price Discovery:** Uses `sell_order.price_per_kwh` as the clearing price.

**State Updates:**
- Increment `filled_amount` on both orders
- Transition to `Completed` when fully filled (decrement `active_orders`)
- Create immutable `TradeRecord`
- Update `zone_market.total_volume`, `total_trades`, `last_clearing_price`

**Event:** `OrderMatched`

---

### sharded_match_orders

Sharded version of `match_orders` for parallel execution.

**Arguments:**
- `match_amount: u64`
- `shard_id: u8`

---

### submit_limit_order

CDA limit order with immediate matching potential.

**Arguments:**
- `order_id_val: u64`
- `side: u8` — 0 = Buy, 1 = Sell
- `amount: u64`
- `price: u64`

**Accounts:**
- `order` (init, PDA)
- `market` (mut)
- `zone_market` (mut)
- `authority` (Signer)
- `governance_config` (readonly)

**Events:** `BuyOrderCreated | SellOrderCreated` + `LimitOrderSubmitted`

---

### submit_limit_order_sharded

Sharded version of limit order submission.

**Arguments:**
- `order_id_val: u64`
- `side: u8`
- `amount: u64`
- `price: u64`
- `shard_id: u8`

---

### submit_market_order

CDA market order — executes at best available price.

**Arguments:**
- `side: u8` — 0 = Buy (takes asks), 1 = Sell (takes bids)
- `amount: u64`

**Validation:** Checks liquidity on opposite side (`sell_side_depth_count > 0` for buys, `buy_side_depth_count > 0` for sells).

**Event:** `MarketOrderSubmitted`

---

### cancel_order

User-initiated order cancellation.

**Constraint:** Only `Active | PartiallyFilled` orders can be cancelled.

**Accounts:**
- `market` (readonly)
- `zone_market` (mut)
- `order` (mut)
- `authority` (Signer) — Must be order owner
- `governance_config` (readonly)

**Event:** `OrderCancelled`

---

### add_order_to_batch

Adds an active order to the current batch.

**Accounts:**
- `market` (mut)
- `order` (readonly)
- `authority` (Signer)
- `governance_config` (readonly)

**Logic:** Creates new batch if `has_current_batch == 0`, adds order to `current_batch.order_ids`.

**Constraints:**
- Batch processing must be enabled
- Batch not expired
- Batch size ≤ `max_batch_size` and ≤ 32 orders

**Event:** `OrderAddedToBatch`

---

### execute_batch

Executes a batch of matched order pairs.

**Arguments:**
- `match_pairs: Vec<MatchPair>`

**Accounts:**
- `market` (mut)
- `authority` (Signer)
- `governance_config` (readonly)

**Logic:**
1. Validate batch exists and matches `match_pairs` length
2. Accumulate total volume
3. Update market stats (`total_volume`, `total_trades`, `last_clearing_price`)
4. Clear batch (`has_current_batch = 0`)

**Event:** `BatchExecuted`

---

### batch_settle_offchain_match

Settles off-chain matched orders with on-chain token transfers.

**Arguments:**
- `matches: Vec<BatchMatchPair>`

---

### update_depth

Updates zone market order book depth arrays.

**Arguments:**
- `buy_prices: Vec<u64>`, `buy_amounts: Vec<u64>`
- `sell_prices: Vec<u64>`, `sell_amounts: Vec<u64>`

**Constraints:** All vectors ≤ `MAX_DEPTH_LEVELS` (10).

**Event:** `DepthUpdated`

---

### initialize_shard / initialize_zone_shard

Creates market/zone shards for distributed counting.

---

## Error Codes

| Discriminant | Error | Condition |
|--------------|-------|-----------|
| 0 | `UnauthorizedAuthority` | Caller is not order owner |
| 1 | `InvalidAmount` | Zero or negative amount |
| 2 | `InvalidPrice` | Zero or negative price |
| 3 | `InactiveSellOrder` | Sell order not active/partially filled |
| 4 | `InactiveBuyOrder` | Buy order not active/partially filled |
| 5 | `PriceMismatch` | `buy_price < sell_price` |
| 6 | `OrderNotCancellable` | Order is Completed/Cancelled/Expired |
| 7 | `InsufficientEscrowBalance` | Escrow has insufficient funds |
| 8 | `InvalidErcCertificate` | ERC status ≠ Valid |
| 9 | `ErcExpired` | Certificate past expiration |
| 10 | `NotValidatedForTrading` | ERC not approved for trading |
| 11 | `ExceedsErcAmount` | Order amount > ERC certificate amount |
| 12 | `BatchProcessingDisabled` | Batch config not enabled |
| 13 | `BatchSizeExceeded` | Batch limit reached |
| 14 | `ReentrancyLock` | Re-entrancy guard active |
| 15 | `EmptyBatch` | No orders in batch |
| 16 | `BatchTooLarge` | Batch exceeds max size |
| 17 | `MaintenanceMode` | System paused via governance |
| 18 | `Overflow` | Arithmetic overflow |
| 19 | `PriceBelowMinimum` | Price < `min_price_per_kwh` |
| 20 | `PriceAboveMaximum` | Price > `max_price_per_kwh` (if cap set) |
| 21 | `InsufficientLiquidity` | No orders on opposite side |
| 22 | `InvalidOrderSide` | Side not 0 or 1 |
| 23 | `OrderExpired` | Order past `expires_at` |
| 24 | `SlippageExceeded` | Price outside allowed bounds |

---

## Events

| Event | Fields |
|-------|--------|
| `MarketInitialized` | `authority`, `timestamp` |
| `SellOrderCreated` | `seller`, `order_id`, `amount`, `price_per_kwh`, `timestamp` |
| `BuyOrderCreated` | `buyer`, `order_id`, `amount`, `price_per_kwh`, `timestamp` |
| `OrderMatched` | `sell_order`, `buy_order`, `seller`, `buyer`, `amount`, `price`, `total_value`, `fee_amount`, `timestamp` |
| `OrderCancelled` | `order_id`, `user`, `timestamp` |
| `OrderAddedToBatch` | `order_id`, `batch_id`, `timestamp` |
| `BatchExecuted` | `authority`, `batch_id`, `order_count`, `total_volume`, `timestamp` |
| `LimitOrderSubmitted` | `order_id`, `side`, `price`, `amount`, `timestamp` |
| `MarketOrderSubmitted` | `user`, `side`, `amount`, `timestamp` |
| `DepthUpdated` | `buy_levels`, `sell_levels`, `best_bid`, `best_ask`, `timestamp` |
| `AuctionCleared` | `clearing_price`, `clearing_volume`, `matched_orders`, `timestamp` |

---

## Design Decisions

### Sharded Order Book

Market shards (`MarketShard`, `ZoneMarketShard`) distribute write load across independent accounts. Each shard tracks its own `volume_accumulated` and `order_count`, which can be aggregated into the global Market/ZoneMarket periodically. This reduces MVCC contention during high-frequency trading.

### Ring-Buffer Price History

`price_history` uses a ring buffer with `price_history_head` as the write pointer. When full, the oldest entry is overwritten. `price_history_count` tracks valid entries (capped at 24).

### Governance Check

Every trading instruction checks `governance_config.is_operational()` — if the Governance program has enabled maintenance mode, all trading halts.

---

**Related:** [Auction Clearing](./auction-clearing.md) — Batch auction algorithm · [Governance](./governance.md) — ERC validation
