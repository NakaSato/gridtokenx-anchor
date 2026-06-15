# Trading Program

## Abstract

The `trading` program is the on-chain order book and settlement engine of the GridTokenX peer-to-peer (P2P) energy-trading platform, deployed on a permissioned Proof-of-Authority (PoA) Solana cluster. It maintains a global market account, zone-partitioned order books, per-user order accounts, and a contention-reducing sharding layer, and it implements two complementary price-discovery mechanisms: a Continuous Double Auction (CDA) — a market in which buy and sell limit orders are matched continuously as they cross — and a periodic uniform-price batch auction. Its security-critical settlement path is *off-chain-signed match settlement*: an off-chain matching agent submits Ed25519-signed order payloads, and the program verifies the signatures, transfers funds between per-user escrow Program-Derived Accounts (PDAs), and records a per-order replay nullifier, all atomically. For baht-denominated trades the program performs a mandatory, non-custodial Cross-Program Invocation (CPI) into the `treasury` program to record the gross settled value, gated on a per-market policy flag. This document specifies the program's identity, state model, instruction set, invariants, cross-program interfaces, events, error codes, and test coverage, with every concrete claim cited to source.

---

## 1. Program Identity

| Property | Value | Source |
| --- | --- | --- |
| Program ID | `CnWDEUhTvSixeLSyViWgAnnu9YouBAYVGcrrFm1s9WcX` | `programs/trading/src/lib.rs:70` |
| Crate name | `trading` | `programs/trading/Cargo.toml:2,9` |
| Crate version | `0.1.1` | `programs/trading/Cargo.toml:3` |
| Anchor framework | `anchor-lang` / `anchor-spl` `1.0.0` | `programs/trading/Cargo.toml:24-25` |
| `declare_id!` location | `programs/trading/src/lib.rs:70` | — |

The program ID is declared by `declare_id!("CnWDEUhTvSixeLSyViWgAnnu9YouBAYVGcrrFm1s9WcX")` (`lib.rs:70`). The crate is built both as a Solana BPF dynamic library and as a linkable Rust library (`crate-type = ["cdylib", "lib"]`, `Cargo.toml:8`).

### Dependencies

The program declares two intra-repository path dependencies, both with the `cpi` feature enabled so their CPI client modules are generated:

| Dependency | Declaration | Purpose |
| --- | --- | --- |
| `governance` | `governance = { path = "../governance", features = ["cpi"] }` (`Cargo.toml:35`) | Supplies `PoAConfig` and `ErcCertificate`/`ErcStatus` types re-exported at `lib.rs:18`; operational-mode and ERC certificate checks. |
| `treasury` | `treasury = { path = "../treasury", features = ["cpi"] }` (`Cargo.toml:36`) | Optional `record_settlement` CPI for baht-denominated (THBG) settlement recording. |

The `cpi` feature of the `trading` crate itself implies `no-entrypoint` (`Cargo.toml:12`). Other relevant features: `localnet` enables the `compute-debug` compute-unit profiling crate (`Cargo.toml:20,34`); when `localnet` is disabled, crate-local no-op `compute_fn!` / `compute_checkpoint!` macros are defined instead (`lib.rs:81-90`).

The release profile forces checked arithmetic: `[profile.release] overflow-checks = true` (`Cargo.toml:40-41`), because `cargo build-sbf` otherwise defaults to silent wrapping.

---

## 2. System Role

The `trading` program is the marketplace and settlement layer for energy (GRID/GRX) trades. Its responsibilities are:

1. **Order book and CDA matching.** Limit orders are submitted via `submit_limit_order` (`lib.rs:591`) and market orders via `submit_market_order` (`lib.rs:697`). The CDA design is documented inline: a buy order matches when its price is at or above the best ask, and a sell order when its price is at or below the best bid (`lib.rs:647-651`). The on-chain `submit_limit_order` initializes the order and emits a `LimitOrderSubmitted` event for off-chain matching agents (`lib.rs:672-679`); actual crossing is executed by separate match/settlement instructions.

2. **Periodic uniform-price batch auction.** `clear_auction` (`lib.rs:933`) builds aggregate supply and demand curves, locates the clearing price via `find_clearing_point` (`lib.rs:1710`), and matches all eligible orders at a single uniform clearing price (`lib.rs:919-1078`). Settlement of the resulting matches is separated into `execute_auction_matches` (`lib.rs:1088`).

3. **Sharded order submission and matching.** To avoid write-lock contention on global accounts, orders may be submitted to per-shard accounts via `submit_limit_order_sharded` (`lib.rs:685`) and matched via `sharded_match_orders` (`lib.rs:411`), which write to a `ZoneMarketShard` rather than to the global `ZoneMarket` (`sharded_match_orders.rs:60-64`).

4. **Off-chain-signed match settlement.** The custody-bearing settlement path is `settle_offchain_match` (`lib.rs:1371`, implemented in `settle_offchain.rs:311`) and its batch form `batch_settle_offchain_match` (`lib.rs:582`, `settle_offchain.rs:513`). An off-chain matcher supplies two Ed25519-signed order payloads; the program verifies both signatures against the Instructions sysvar, transfers currency and energy between escrow PDAs, and updates replay nullifiers.

5. **Escrow custody.** Per-user escrow PDA token accounts hold funds for the off-chain settlement path. They are funded by `deposit_escrow` and drained by `withdraw_escrow` (`escrow.rs:57,120`); their SPL authority is the global `market_authority` PDA.

6. **Zone-partitioned markets.** Order-book depth and capacity are tracked per geographic zone in `ZoneMarket` accounts, sharded out of the global `Market` to prevent cross-zone write contention (`zone_market.rs:9-11`). Cross-zone (wheeling) flow is throttled against a transmission `capacity` (`settle_offchain.rs:352-358`).

7. **Replay protection.** Each settled off-chain order is tracked by an `OrderNullifier` PDA keyed by the order's owner and UUID (`nullifier.rs:3-9`), preventing a signed payload from being settled beyond its energy amount.

All state-mutating instructions gate on the governance operational mode: they call `get_governance_config(...).is_operational()` and reject with `MaintenanceMode` otherwise (e.g. `lib.rs:202-205`, `lib.rs:330-333`; helper at `utils.rs:5-12`).

---

## 3. State Model

The program's persistent state is split between **zero-copy** accounts (declared `#[account(zero_copy)] #[repr(C)]`, accessed through `AccountLoader`) and **regular** Borsh-serialized accounts (declared `#[account]`, accessed through `Account`). Zero-copy accounts reserve `8 + size_of::<T>()` bytes (Anchor discriminator plus the Pod struct).

### 3.1 `Market` (zero-copy, global singleton)

Defined at `market.rs:6-56`. PDA seed: `[b"market"]` (`lib.rs:1435`). There is a single global market; the escrow and `market_authority` seeds carry no market key, and the code documents this single-market invariant (`escrow.rs:19-21`).

| Field | Type | Notes | Source |
| --- | --- | --- | --- |
| `authority` | `Pubkey` | Market admin; checked by `has_one`/`require_keys_eq` for param updates. | `market.rs:9` |
| `total_volume` | `u64` | Cumulative matched volume. | `market.rs:10` |
| `created_at` | `i64` | Creation timestamp. | `market.rs:11` |
| `last_clearing_price` | `u64` | Most recent clearing price. | `market.rs:12` |
| `volume_weighted_price` | `u64` | VWAP from price history. | `market.rs:13` |
| `active_orders` | `u32` | Open order count. | `market.rs:14` |
| `total_trades` | `u32` | Cumulative trade count. | `market.rs:15` |
| `market_fee_bps` | `u16` | Fee in basis points (initialized to 25). | `market.rs:16`, `lib.rs:133` |
| `clearing_enabled` | `u8` | Boolean flag (1 = enabled). | `market.rs:17` |
| `_reserved_guard` | `u8` | Reserved; formerly an unused re-entrancy guard, kept for layout stability. | `market.rs:18-21` |
| `_padding1` | `[u8; 4]` | Alignment. | `market.rs:22` |
| `min_price_per_kwh` | `u64` | Minimum allowed price (must be > 0). | `market.rs:23` |
| `max_price_per_kwh` | `u64` | Maximum allowed price (0 = no cap). | `market.rs:24` |
| `batch_config` | `BatchConfig` | Batch processing parameters (24 bytes). | `market.rs:27` |
| `current_batch` | `BatchInfo` | Active batch (1064 bytes: `8 + 4 + 4 + 8 + 8 + 8 + 32×32`). | `market.rs:28` |
| `has_current_batch` | `u8` | Whether a batch is open. | `market.rs:29` |
| `_padding_batch` | `[u8; 7]` | Alignment. | `market.rs:30` |
| `_padding_depth_1..3` | `[u8;512]`,`[u8;256]`,`[u8;128]` | Reserved (depth moved to `ZoneMarket`). | `market.rs:33-35` |
| `settlement_thbg_mint` | `Pubkey` | THBG settlement mint for the recording policy. | `market.rs:41` |
| `has_settlement_thbg_mint` | `u8` | Policy flag; 1 = THBG recording mandatory. | `market.rs:42` |
| `_padding_depth_4` | `[u8; 31]` | Carved from former depth padding. | `market.rs:43` |
| `_padding_depth_5` | `[u8; 6]` | Alignment. | `market.rs:44` |
| `price_history_count` | `u8` | Valid ring-buffer entries (0..=24). | `market.rs:45` |
| `price_history_head` | `u8` | Ring-buffer write head. | `market.rs:46` |
| `price_history` | `[PricePoint; 24]` | Rolling 24-slot price history (576 bytes). | `market.rs:49` |
| `total_volume_global` | `u64` | Aggregated shard volume. | `market.rs:52` |
| `total_trades_global` | `u32` | Aggregated shard trades. | `market.rs:53` |
| `num_shards` | `u8` | Active shard count. | `market.rs:54` |
| `_padding_sharding` | `[u8; 3]` | Alignment. | `market.rs:55` |

**Settlement-recording policy.** The `settlement_thbg_mint` / `has_settlement_thbg_mint` pair encodes a per-market policy: once set via `set_settlement_thbg_mint` (`lib.rs:1352`), any off-chain settlement in that currency MUST pass the treasury accounts (see §4 and §5). The fields were carved from former depth padding so the account size is unchanged and accounts predating the field read it as 0, i.e. policy off (`market.rs:36-43`).

**Embedded Pod sub-structs** (all `#[repr(C)]`, `bytemuck::Pod`): `BatchConfig` (`market.rs:63-71`), `BatchInfo` with `order_ids: [Pubkey; 32]` reduced from 50 for Pod support (`market.rs:78-86`), `PriceLevel` (`market.rs:113-118`), `PricePoint` (`market.rs:131-135`).

### 3.2 `MarketShard` (zero-copy)

Defined at `market.rs:140-150`. PDA seed: `[b"market_shard", market.key(), &[shard_id]]` (`initialize_shard.rs:18`). Per-shard volume/order counters that can be written in parallel without conflicting on the global `Market`.

| Field | Type | Source |
| --- | --- | --- |
| `shard_id` | `u8` | `market.rs:143` |
| `_padding1` | `[u8; 7]` | `market.rs:144` |
| `market` | `Pubkey` | `market.rs:145` |
| `volume_accumulated` | `u64` | `market.rs:146` |
| `order_count` | `u32` | `market.rs:147` |
| `_padding2` | `[u8; 4]` | `market.rs:148` |
| `last_update` | `i64` | `market.rs:149` |

### 3.3 `Order` and `TradeRecord` (zero-copy)

`Order` is defined at `order.rs:6-20`. PDA seed: `[b"order", authority.key(), &order_id_val.to_le_bytes()]` (e.g. `lib.rs:1459`, `lib.rs:1621`, `lib.rs:1639`).

| Field | Type | Source |
| --- | --- | --- |
| `seller` | `Pubkey` | `order.rs:9` |
| `buyer` | `Pubkey` | `order.rs:10` |
| `order_id` | `u64` | `order.rs:11` |
| `amount` | `u64` | `order.rs:12` |
| `filled_amount` | `u64` | `order.rs:13` |
| `price_per_kwh` | `u64` | `order.rs:14` |
| `order_type` | `u8` (`OrderType`) | `order.rs:15` |
| `status` | `u8` (`OrderStatus`) | `order.rs:16` |
| `_padding` | `[u8; 6]` | `order.rs:17` |
| `created_at` | `i64` | `order.rs:18` |
| `expires_at` | `i64` | `order.rs:19` |

`TradeRecord` (`order.rs:22-34`) records a settled match. PDA seed: `[b"trade", buy_order.key(), sell_order.key()]` (`lib.rs:1493`, `lib.rs:1515`). Fields: `sell_order`, `buy_order`, `seller`, `buyer`, `amount`, `price_per_kwh`, `total_value`, `fee_amount`, `executed_at`.

`OrderType` is `{ Sell = 0, Buy = 1 }` (`order.rs:38-41`). `OrderStatus` is `{ Active = 0, PartiallyFilled = 1, Completed = 2, Cancelled = 3, Expired = 4 }` (`order.rs:44-50`). Note that the on-the-wire `side` parameter and the off-chain payload use the inverse convention `0 = Buy, 1 = Sell` (e.g. `lib.rs:594`, `settle_offchain.rs:79`).

### 3.4 `ZoneMarket` and `ZoneMarketShard` (zero-copy)

`ZoneMarket` (`zone_market.rs:12-32`). PDA seed: `[b"zone_market", market.key(), &zone_id.to_le_bytes()]` (`lib.rs:1446`).

| Field | Type | Notes | Source |
| --- | --- | --- | --- |
| `market` | `Pubkey` | Parent market. | `zone_market.rs:15` |
| `zone_id` | `u32` | Geographic zone. | `zone_market.rs:16` |
| `num_shards` | `u8` | Shard count for this zone. | `zone_market.rs:17` |
| `_padding1` | `[u8; 3]` | — | `zone_market.rs:18` |
| `total_volume` | `u64` | — | `zone_market.rs:19` |
| `active_orders` | `u32` | — | `zone_market.rs:20` |
| `total_trades` | `u32` | — | `zone_market.rs:21` |
| `buy_side_depth_count` | `u8` | — | `zone_market.rs:22` |
| `sell_side_depth_count` | `u8` | — | `zone_market.rs:23` |
| `_padding2` | `[u8; 6]` | — | `zone_market.rs:24` |
| `last_clearing_price` | `u64` | — | `zone_market.rs:25` |
| `capacity` | `u64` | Transmission capacity (base units). | `zone_market.rs:26` |
| `committed_flow` | `u64` | Currently committed cross-zone flow. | `zone_market.rs:27` |
| `buy_side_depth` | `[PriceLevel; 10]` | Bid depth (240 bytes). | `zone_market.rs:30` |
| `sell_side_depth` | `[PriceLevel; 10]` | Ask depth (240 bytes). | `zone_market.rs:31` |

`MAX_DEPTH_LEVELS = 10` (`zone_market.rs:7`); the cap keeps `update_depth` Vec payloads within Solana's 1,232-byte transaction limit (`zone_market.rs:4-7`).

`ZoneMarketShard` (`zone_market.rs:36-47`). PDA seed: `[b"zone_shard", zone_market.key(), &[shard_id]]` (`initialize_zone_shard.rs:18`). Fields: `shard_id`, `_padding1[7]`, `zone_market`, `volume_accumulated`, `trade_count`, `_padding2[4]`, `last_clearing_price`, `last_update`.

### 3.5 `OrderNullifier` (regular `#[account]`)

Defined at `nullifier.rs:3-13`. PDA seed: `[b"nullifier", user.as_ref(), &order_id]` (`settle_offchain.rs:112,121`). Space: `OrderNullifier::LEN = 8 + 16 + 32 + 8 + 1 = 65` bytes (`nullifier.rs:12`).

| Field | Type | Notes | Source |
| --- | --- | --- | --- |
| `order_id` | `[u8; 16]` | Original order UUID. | `nullifier.rs:5` |
| `authority` | `Pubkey` | Signer of the order. | `nullifier.rs:6` |
| `filled_amount` | `u64` | Cumulative settled energy for this order. | `nullifier.rs:7` |
| `bump` | `u8` | PDA bump. | `nullifier.rs:8` |

### 3.6 `ZoneConfig` (regular `#[account]`)

Defined at `zone_config.rs:3-15`. PDA seed: `[b"zone_config", zone_id.to_le_bytes()]` (`lib.rs:1897`). Space: `8 + 128` (`lib.rs:1896`; struct totals 125 bytes per the comment at `zone_config.rs:15`). Fields: `zone_id` (`u32`), `incentive_multiplier_bps` (`u64`, 10000 = 1.0×), `wheeling_charge_bps` (`u64`), `maintenance_mode` (`u8`), `authority` (`Pubkey`), `last_updated` (`i64`), `reserved1`/`reserved2` (`[u8; 32]` each).

---

## 4. Instruction Set

This section specifies every instruction in the `#[program] mod trading` (`lib.rs:95-1703`) and its delegated handlers. For brevity, the ubiquitous `governance_config` operational check (`is_operational()` → `MaintenanceMode`) is noted once per instruction rather than re-described.

### 4.1 Initialization

**`initialize_program`** (`lib.rs:115`). No-op marker emitting a log. Signer: `authority`.

**`initialize_market`** (`lib.rs:122`, args `num_shards: u8`). Signer: `authority` (becomes `market.authority`). Initializes the global `Market` PDA (`init`, seed `[b"market"]`) with `market_fee_bps = 25`, `min_price_per_kwh = 1`, `clearing_enabled = 1`, default `BatchConfig` (disabled), and zeroed price history (`lib.rs:122-160`). Emits `MarketInitialized`.

**`initialize_zone_market`** (`lib.rs:162`, args `zone_id: u32, num_shards: u8, capacity: u64`). Signer: `authority`. Initializes a `ZoneMarket` PDA bound to `market` with the given capacity; zeroes both depth arrays (`lib.rs:162-186`). No event.

**`initialize_zone_config`** (`lib.rs:99`, args `zone_id, incentive_multiplier_bps`). Signer: `authority`. Initializes a `ZoneConfig` PDA (`lib.rs:1890-1906`).

**`initialize_market_shard`** (`lib.rs:1391` → `initialize_shard.rs:28`, arg `shard_id: u8`). Signer: `payer`. Initializes a `MarketShard` PDA (seed `[b"market_shard", market, shard_id]`).

**`initialize_zone_market_shard`** (`lib.rs:188` → `initialize_zone_shard.rs:28`, arg `shard_id: u8`). Signer: `payer`. Initializes a `ZoneMarketShard` PDA (seed `[b"zone_shard", zone_market, shard_id]`).

**`initialize_collectors`** (`lib.rs:1399` → `escrow.rs:208`). Signer: `payer`. One-time `init` of the three collector PDA token accounts (`fee_collector`, `wheeling_collector`, `loss_collector`) for a given `currency_mint`, all with SPL authority = `market_authority` (`escrow.rs:160-206`).

### 4.2 Order submission

**`create_sell_order`** (`lib.rs:195`, args `order_id_val, energy_amount, price_per_kwh`) and **`create_buy_order`** (`lib.rs:272`, args `order_id_val, energy_amount, max_price_per_kwh`). Signer: `authority`. Preconditions: operational; amount > 0; price > 0; price within `[min_price_per_kwh, max_price_per_kwh]` (the upper bound only when nonzero) (`lib.rs:206-220`, `283-298`). `create_sell_order` additionally validates an optional `ErcCertificate` (Energy/Renewable Certificate): status `Valid`, not expired, `validated_for_trading`, and `energy_amount <= erc.energy_amount` (`lib.rs:227-243`). Effects: `init` the `Order` PDA, set fields, `expires_at = created_at + 86400`, increment `zone_market.active_orders`. Emits `SellOrderCreated` / `BuyOrderCreated`.

**`submit_limit_order`** (`lib.rs:591`, args `order_id_val, side, amount, price`). Signer: `authority`. CDA limit order. Validates operational, amount/price > 0, and price bounds; `init`s the order with the appropriate side; increments `market.active_orders`; emits both the side-specific order event and `LimitOrderSubmitted` for off-chain matchers (`lib.rs:591-683`). Note `side` here is `0 = Buy, 1 = Sell`.

**`submit_limit_order_sharded`** (`lib.rs:685` → `submit_sharded_limit_order.rs:10`, args `order_id_val, side, amount, price, shard_id`). Signer: `authority`. Initializes the order and touches the `ZoneMarketShard.last_update` rather than the global market; emits `LimitOrderSubmitted`. The `zone_shard` is bound by seed `[b"zone_shard", zone_market, shard_id]` (`lib.rs:1625`).

**`submit_market_order`** (`lib.rs:697`, args `side, amount`). Signer: `authority`. Requires opposite-side liquidity (`zone_market.sell_side_depth_count > 0` for buys, `buy_side_depth_count > 0` for sells), else `InsufficientLiquidity`; emits `MarketOrderSubmitted` for an off-chain agent to fill (`lib.rs:697-737`).

### 4.3 Matching

**`match_orders`** (`lib.rs:328`, arg `match_amount`). Signer: `authority`. Matches one buy against one sell order. Preconditions: both orders `Active`/`PartiallyFilled`; `buy.price >= sell.price` (`PriceMismatch`). Clearing price is the seller's price; `actual_match_amount = min(match_amount, buy_remaining, sell_remaining)`; updates `filled_amount`/`status`, `init`s a `TradeRecord`, updates `zone_market` stats; emits `OrderMatched` (`lib.rs:328-409`).

**`sharded_match_orders`** (`lib.rs:411` → `sharded_match_orders.rs:11`, args `match_amount, shard_id`). Signer: `authority`. Identical matching logic to `match_orders`, but updates a `ZoneMarketShard` instead of the global `ZoneMarket` (`sharded_match_orders.rs:60-64`), reducing contention. Emits `OrderMatched`. The `shard_id` parameter is unused inside the handler (`_shard_id`); shard selection is enforced by the account seed constraint (`lib.rs:1509`).

**`clear_auction`** (`lib.rs:933`, args `sell_orders: Vec<AuctionOrder>, buy_orders: Vec<AuctionOrder>`). Returns `ClearAuctionResult`. Sorts sells ascending and buys descending by price (`lib.rs:953-957`), builds supply and demand curves (`lib.rs:959-981`), finds the clearing point (`lib.rs:984`), then matches eligible orders (sells priced ≤ clearing, buys priced ≥ clearing) at the uniform clearing price, emitting an `OrderMatched` per pair (`lib.rs:1020-1050`). Updates market/zone aggregates and emits `AuctionCleared` (`lib.rs:1052-1067`). Errors: empty input → `InvalidAmount`; no intersection → `InvalidPrice`/`InvalidAmount` from `find_clearing_point` (`lib.rs:1729-1730`).

**`execute_auction_matches`** (`lib.rs:1088`, args `matches: Vec<AuctionMatch>, clearing_price`). Signer: `authority`. Iterates the matches produced by `clear_auction`, computes per-match fee `trade_value * market_fee_bps / 10000` with `checked_mul` (overflow → `Overflow`), emits `OrderMatched`, and bumps market aggregates (`lib.rs:1088-1137`).

### 4.4 Batch processing (intent-grouping, no token transfer)

**`add_order_to_batch`** (`lib.rs:457`). Requires `batch_config.enabled == 1` (`BatchProcessingDisabled`); creates a batch if none open; rejects expired batches and enforces `max_batch_size` and the hard cap of 32 (`BatchTooLarge`/`BatchSizeExceeded`); appends the order key. Emits `OrderAddedToBatch` (`lib.rs:457-526`).

**`execute_batch`** (`lib.rs:528`, arg `match_pairs: Vec<MatchPair>`). Requires an open batch whose `order_count` equals `match_pairs.len()`; accumulates volume; updates market stats and clears the batch. Emits `BatchExecuted` (`lib.rs:528-580`).

**`cancel_batch`** (`lib.rs:890`). Clears the current batch; emits `BatchCancelled`.

### 4.5 Order lifecycle

**`cancel_order`** (`lib.rs:419`). Signer: `authority` must equal the order owner (buyer for buy orders, seller for sell orders), else `UnauthorizedAuthority`; order must be `Active`/`PartiallyFilled`, else `OrderNotCancellable`. Sets status `Cancelled`, decrements `zone_market.active_orders`; emits `OrderCancelled` (`lib.rs:419-455`).

### 4.6 Market depth and price history

**`update_depth`** (`lib.rs:741`, Vec args for buy/sell prices and amounts). Signer: market `authority` (`has_one`, `lib.rs:1660`). Validates lengths ≤ `MAX_DEPTH_LEVELS` and that price/amount vectors align; rewrites the depth arrays; emits `DepthUpdated` (`lib.rs:741-827`).

**`update_price_history`** (`lib.rs:831`, args `trade_price, trade_volume`). Signer: market `authority`. O(1) ring-buffer insert at `price_history_head`, recompute VWAP across valid entries; emits `PriceHistoryUpdated` (`lib.rs:831-888`).

### 4.7 Settlement

**`execute_atomic_settlement`** (`lib.rs:1139`, args `amount, price, wheeling_charge_val, loss_cost_val`). Signers: `escrow_authority` and `market_authority` (`lib.rs:1567-1568`); `market_authority.key()` must equal `market.authority` (`lib.rs:1152-1156`). Slippage protection requires `sell.price <= price <= buy.price` (`SlippageExceeded`, `lib.rs:1162-1169`). Transfers currency (fee, net seller, wheeling, loss) from the buyer's currency escrow and energy from the seller's energy escrow, via `transfer_checked` over two token programs; updates order fill/status and market stats; emits `OrderMatched` (`lib.rs:1139-1306`).

**`settle_offchain_match`** (`lib.rs:1371` → `settle_offchain.rs:311`, args `buyer_payload, seller_payload: OffchainOrderPayload`, `match_amount, match_price, wheeling_charge_val, loss_cost_val`). The core off-chain-signed settlement instruction. Signer: `payer` (the matching agent). See §4.8 for the signing model. Accounts (`settle_offchain.rs:98-234`): the singleton `market` (seed `[b"market"]`), a `zone_market` constrained to belong to that market, two `OrderNullifier` PDAs (`init_if_needed`, keyed by each payload's user + order_id), `currency_mint`/`energy_mint`, the `market_authority` PDA (escrow signer), two token programs, four per-user escrow token accounts (currency and energy for both buyer and seller, each seed `[b"escrow", user, mint]`), the three collector PDAs, a `market_shard` and `zone_shard` selected by `get_shard_id(payer, num_shards)`, the Instructions sysvar, and **optional** `treasury_program`/`treasury_state`.

Preconditions (`settle_offchain.rs:333-362`): valid buyer and seller Ed25519 signatures; `match_amount > 0`; `seller.price <= match_price <= buyer.price` (`SlippageExceeded`); `buyer.side == 0` and `seller.side == 1` (`InvalidOrderSide`); neither payload expired (`OrderExpired`, where `expires_at == 0` means no expiry); cross-zone capacity not exceeded when either leg is remote (`CapacityExceeded`); `match_amount` within both nullifier-tracked remaining amounts (`InvalidAmount`).

Effects: `total_currency_value = match_amount.checked_mul(match_price)` (overflow → `Overflow`, *not* saturating, to avoid paying out a clamped value — `settle_offchain.rs:365-367`); `market_fee = total * market_fee_bps / 10000`; `net_seller_amount = total − fee − wheeling − loss`. Four currency `transfer_checked` CPIs (fee→`fee_collector`, wheeling→`wheeling_collector`, loss→`loss_collector`, net→seller currency escrow) and one energy `transfer_checked` (seller energy escrow → buyer energy escrow), all signed by `market_authority` (`settle_offchain.rs:375-443`). Then the mandatory-or-optional treasury recording (§4.8 / §5), nullifier updates (`filled_amount += match_amount`, plus `order_id`/`authority`/`bump`), and shard stat updates. Emits `OrderMatched` keyed by the two nullifier PDAs (`settle_offchain.rs:497-507`).

**`batch_settle_offchain_match`** (`lib.rs:582` → `settle_offchain.rs:513`, arg `matches: Vec<BatchMatchPair>`). Settles 1–4 matches in one transaction (`BatchTooLarge` outside that range, `settle_offchain.rs:519`). The buyer/seller escrows and nullifiers for each pair are passed in `remaining_accounts` (exactly `match_count * 6`, `settle_offchain.rs:523`), and each is bound to the canonically derived PDA for the *signed* payload via `require_keys_eq!` against `Pubkey::find_program_address` (`InvalidNullifier`/`InvalidEscrow`, `settle_offchain.rs:556-591`), with additional SPL-owner checks. Per-match logic mirrors the single path; the batch's gross value is accumulated and recorded once via a single treasury CPI after the loop (`settle_offchain.rs:705-735`). Emits one `OrderMatched` per pair.

### 4.8 Escrow and policy

**`deposit_escrow`** (`lib.rs:1405` → `escrow.rs:57`, arg `amount`). Signer: `user`. Transfers `amount` from the user's wallet token account into their escrow PDA (`init_if_needed`, seed `[b"escrow", user, mint]`, authority `market_authority`); emits `EscrowDeposited` (`escrow.rs:57-85`).

**`withdraw_escrow`** (`lib.rs:1410` → `escrow.rs:120`, arg `amount`). Signer: `user`. Requires `amount <= escrow.amount` (`InsufficientEscrowBalance`); transfers from the escrow PDA back to the user wallet, signed by `market_authority`; emits `EscrowWithdrawn`. The escrow seed includes `user.key()`, so a signer can only address their own escrow (`escrow.rs:94-118`).

**`set_settlement_thbg_mint`** (`lib.rs:1352`, arg `thbg_mint: Pubkey`). Signer: market `authority` (`has_one`, `lib.rs:1585`). Rejects `Pubkey::default()` (`TreasuryCurrencyMismatch`, `lib.rs:1357`); sets `settlement_thbg_mint` and `has_settlement_thbg_mint = 1`; emits `SettlementThbgMintSet` (`lib.rs:1352-1369`). After this, THBG-denominated off-chain settlements require the treasury accounts (see §5).

**`update_market_params`** (`lib.rs:1309`, args `fee_bps, clearing, min_price, max_price`). Signer: market `authority`. Updates fee, clearing flag, and price bounds; emits `MarketParamsUpdated` (`lib.rs:1309-1345`).

### Off-chain match signing model

The off-chain settlement model decouples *matching* (performed off-chain) from *custody and recording* (performed on-chain). Each order is represented by an `OffchainOrderPayload` (`settle_offchain.rs:73-82`): `order_id: [u8;16]` (UUID), `user`, `energy_amount`, `price_per_kwh`, `side`, `zone_id`, `expires_at`. Its canonical message is the concatenation of these fields in fixed little-endian layout (`get_message`, `settle_offchain.rs:85-95`). The order owner signs this message off-chain with their Ed25519 key.

To settle, the matching agent constructs a transaction whose instructions are `[Ed25519_verify(buyer), Ed25519_verify(seller), settle_offchain_match]` (for the batch form, the Ed25519 instructions are interleaved per pair: `[buyer_0, seller_0, buyer_1, seller_1, …]`, `settle_offchain.rs:547`). Inside the program, `verify_ed25519_signature` (`settle_offchain.rs:740-768`) reads the Instructions sysvar, locates the verification instruction at the expected index, confirms its program is the Ed25519 native program (`ED25519_ID`, `settle_offchain.rs:4-7`), and checks that the embedded public key matches the payload's `user` and the embedded message matches `get_message()` byte-for-byte. Because Solana's runtime executes the Ed25519 instruction itself, a successful match of pubkey + message proves a valid signature. The settlement instruction's escrow and collector addresses are then fully derived from the signed `user` and mints, so a forged or substituted account cannot redirect funds (§5).

---

## 5. Invariants & Security Properties

1. **CDA matching correctness.** Continuous matching requires `buy.price >= sell.price` and settles at the seller's price (`lib.rs:352-361`, `sharded_match_orders.rs:35-40`). Off-chain settlement enforces two-sided slippage bounds: `seller.price <= match_price <= buyer.price` (`settle_offchain.rs:334-335`). `execute_atomic_settlement` enforces the same bounds (`lib.rs:1162-1169`). The matched amount is always clamped to both sides' remaining quantity (`lib.rs:359`, `settle_offchain.rs:360-362`).

2. **Uniform-price auction.** `clear_auction` matches all eligible orders at a single clearing price found at the supply/demand intersection that maximizes feasible volume (`find_clearing_point`, `lib.rs:1710-1733`), giving every matched participant price improvement relative to their limit. The clearing logic is unit-tested (§9).

3. **Replay protection via nullifiers.** Each off-chain order's cumulative settled energy is tracked in an `OrderNullifier` PDA keyed by `[b"nullifier", user, order_id]` (`settle_offchain.rs:112,121`). `match_amount` is bounded by `energy_amount − nullifier.filled_amount` (`settle_offchain.rs:360-362`), so a signed payload can never be settled beyond its own energy amount across repeated submissions. In the batch path the nullifier accounts must equal the PDA derived from the signed payload (`InvalidNullifier`, `settle_offchain.rs:556-566`) and the loaded nullifier's stored `authority` must equal the payload user (`NullifierUserMismatch`, `settle_offchain.rs:595-596`).

4. **Escrow custody binding.** Every escrow address is derived from the signed payload's `user` and the mint (`seeds = [b"escrow", user, mint]`), so settlement can never be aimed at a victim's funds — the seed derivation is the authorization (`settle_offchain.rs:136-173`, `escrow.rs:14-21`). The escrow SPL authority is the global `market_authority` PDA, which signs all outbound transfers (`settle_offchain.rs:371-373`). `withdraw_escrow` seeds include `user.key()`, so a signer can only drain their own escrow (`escrow.rs:94-97`). Collectors are likewise bound to seed PDAs so fees cannot be redirected (`settle_offchain.rs:175-202`).

5. **Singleton-market binding.** `settle_offchain_match` binds `market` to the canonical `[b"market"]` PDA, blocking substitution of a fee-zero market, and constrains `zone_market` to belong to that market, blocking a zero-capacity or wrong-zone book (`settle_offchain.rs:101-106`).

6. **Mandatory THBG settlement recording.** When `market.has_settlement_thbg_mint == 1` and the settlement `currency_mint` equals `market.settlement_thbg_mint`, recording is mandatory: `recording_required` is computed, and if the treasury accounts are absent the instruction fails with `TreasurySettlementRequired` (`settle_offchain.rs:448-476` single path; `settle_offchain.rs:709-734` batch path). When the treasury accounts *are* supplied, the settlement currency must equal `treasury_state.thbg_mint` (`TreasuryCurrencyMismatch`, `settle_offchain.rs:457-461`, `713-717`), preventing an arbitrary token from being recorded as a baht settlement.

7. **`market_authority` PDA as escrow signer / settlement recorder.** All escrow transfers and the treasury `record_settlement` CPI are signed by the `market_authority` PDA (seed `[b"market_authority"]`, `settle_offchain.rs:130`, `467`, `538`), which is also the on-chain identity the treasury program expects as `recorder`/`settlement_recorder` (§6).

8. **Cross-zone capacity throttle.** When `zone_market.capacity > 0` and *either* leg is remote relative to the zone, `committed_flow + match_amount` must not exceed `capacity` (`CapacityExceeded`, `settle_offchain.rs:352-358`, `613-619`). Checking both legs (not only the seller) closes a remote-buyer/local-seller bypass (`settle_offchain.rs:349-351`).

9. **Sharding parallelism.** Hot-path settlement writes go to per-shard `MarketShard`/`ZoneMarketShard` accounts selected by `get_shard_id(authority) = authority.to_bytes()[0] % num_shards` (`market.rs:154-157`), so concurrent settlements by different payers touch disjoint shard accounts and do not serialize on the global `Market`/`ZoneMarket`.

10. **Checked arithmetic / overflow safety.** Monetary products use `checked_mul` and reject on overflow rather than saturating, since a clamped money value would be paid out and recorded incorrectly (`settle_offchain.rs:365-367`, `606-609`). Aggregate counters use `saturating_*`. The release build forces `overflow-checks = true` so bare `+=`/`-=` panic instead of wrapping (`Cargo.toml:40-41`).

---

## 6. Cross-Program Interfaces (CPI)

The program has two CPI counterparties; both dependencies are declared with `features = ["cpi"]` (`Cargo.toml:35-36`).

### 6.1 trading → governance

The `governance` program supplies `PoAConfig`, `ErcCertificate`, and `ErcStatus`, re-exported at `lib.rs:18`. There is no CPI *invoke* into governance; instead, the `PoAConfig` account is read and manually deserialized (`get_governance_config`, `utils.rs:5-12`, which skips the 8-byte discriminator and Borsh-decodes the body, returning `InvalidGovernanceAccount` on failure). Every state-mutating instruction calls `is_operational()` on this config and rejects with `MaintenanceMode` when the platform is paused (e.g. `lib.rs:202-205`). `create_sell_order` additionally validates a governance-issued `ErcCertificate` when present (`lib.rs:227-243`).

### 6.2 trading → treasury (`record_settlement`, optional and non-custodial)

The off-chain settlement instructions accept optional `treasury_program: Option<Program<Treasury>>` and `treasury_state: Option<AccountLoader<Treasury>>` accounts (`settle_offchain.rs:231-233`, `306-308`). When both are present, the program performs `treasury::cpi::record_settlement` with `RecordSettlement { treasury, recorder }`, signed by the `market_authority` PDA (`settle_offchain.rs:462-472` single; `settle_offchain.rs:719-729` batch). Properties:

- **Non-custodial.** The CPI moves no funds; it only bumps the treasury's settled-value counter. The escrow, Ed25519, and replay-nullifier guarantees are therefore untouched (`settle_offchain.rs:226-230`).
- **Records the GROSS settled value.** The single-match path passes `total_currency_value` (seller payout + fee + wheeling + loss), which reconciles to the total THBG leaving the buyer escrow rather than the seller's net receipt (`settle_offchain.rs:445-472`). The batch path accumulates `batch_total_value` across all matches and records it with one CPI after the loop (`settle_offchain.rs:541-543`, `606-609`, `718-730`).
- **Wired into both settlement instructions.** Both `settle_offchain_match` and `batch_settle_offchain_match` contain the recording block (`settle_offchain.rs:450`, `711`).
- **Recorder identity.** `recorder` is the `market_authority` PDA, which the treasury program authorizes as its `settlement_recorder` (the trading `market_authority`).

The currency-mint equality check against `treasury_state.thbg_mint` (`TreasuryCurrencyMismatch`) ensures recording is genuine baht-denominated settlement (`settle_offchain.rs:457-461`, `713-717`).

---

## 7. Events

All events are defined in `events.rs`.

| Event | Fields | Emitted by | Source |
| --- | --- | --- | --- |
| `MarketInitialized` | authority, timestamp | `initialize_market` | `events.rs:5-9` |
| `SellOrderCreated` | seller, order_id, amount, price_per_kwh, timestamp | `create_sell_order`, `submit_limit_order` | `events.rs:11-18` |
| `BuyOrderCreated` | buyer, order_id, amount, price_per_kwh, timestamp | `create_buy_order`, `submit_limit_order` | `events.rs:20-27` |
| `OrderMatched` | sell_order, buy_order, seller, buyer, amount, price, total_value, fee_amount, timestamp | `match_orders`, `sharded_match_orders`, `clear_auction`, `execute_auction_matches`, `execute_atomic_settlement`, `settle_offchain_match`, `batch_settle_offchain_match` | `events.rs:29-40` |
| `OrderCancelled` | order_id, user, timestamp | `cancel_order` | `events.rs:42-47` |
| `MarketParamsUpdated` | authority, market_fee_bps, clearing_enabled, min/max_price_per_kwh, timestamp | `update_market_params` | `events.rs:49-57` |
| `SettlementThbgMintSet` | authority, thbg_mint, timestamp | `set_settlement_thbg_mint` | `events.rs:59-64` |
| `BatchExecuted` | authority, batch_id, order_count, total_volume, timestamp | `execute_batch` | `events.rs:66-73` |
| `OrderAddedToBatch` | order_id, batch_id, timestamp | `add_order_to_batch` | `events.rs:75-80` |
| `BatchCancelled` | batch_id, authority, timestamp | `cancel_batch` | `events.rs:82-87` |
| `MaintenanceModeChanged` | authority, maintenance_mode, timestamp | (defined; no in-program emit) | `events.rs:89-94` |
| `LimitOrderSubmitted` | order_id, side, price, amount, timestamp | `submit_limit_order`, `submit_limit_order_sharded` | `events.rs:96-103` |
| `MarketOrderSubmitted` | user, side, amount, timestamp | `submit_market_order` | `events.rs:105-111` |
| `DepthUpdated` | buy_levels, sell_levels, best_bid, best_ask, timestamp | `update_depth` | `events.rs:113-120` |
| `PriceHistoryUpdated` | trade_price, trade_volume, vwap, timestamp | `update_price_history` | `events.rs:122-128` |
| `AuctionCleared` | clearing_price, clearing_volume, matched_orders, timestamp | `clear_auction` | `events.rs:130-136` |
| `EscrowDeposited` | user, mint, amount, timestamp | `deposit_escrow` | `events.rs:138-144` |
| `EscrowWithdrawn` | user, mint, amount, timestamp | `withdraw_escrow` | `events.rs:146-152` |

---

## 8. Error Codes

All variants are defined in `error.rs` under `#[error_code] enum TradingError`.

| Variant | Message | Source |
| --- | --- | --- |
| `UnauthorizedAuthority` | Unauthorized authority | `error.rs:7-8` |
| `InvalidAmount` | Invalid amount | `error.rs:9-10` |
| `InvalidPrice` | Invalid price | `error.rs:11-12` |
| `InactiveSellOrder` | Inactive sell order | `error.rs:13-14` |
| `InactiveBuyOrder` | Inactive buy order | `error.rs:15-16` |
| `PriceMismatch` | Price mismatch | `error.rs:17-18` |
| `OrderNotCancellable` | Order not cancellable | `error.rs:19-20` |
| `InsufficientEscrowBalance` | Insufficient escrow balance | `error.rs:21-22` |
| `InvalidErcCertificate` | Invalid ERC certificate status | `error.rs:23-24` |
| `ErcExpired` | ERC certificate has expired | `error.rs:25-26` |
| `NotValidatedForTrading` | ERC certificate not validated for trading | `error.rs:27-28` |
| `ExceedsErcAmount` | Order amount exceeds available ERC certificate amount | `error.rs:29-30` |
| `BatchProcessingDisabled` | Batch processing is disabled | `error.rs:31-32` |
| `BatchSizeExceeded` | Batch size exceeded | `error.rs:33-34` |
| `ReentrancyLock` | Re-entrancy Guard Lock | `error.rs:35-36` |
| `EmptyBatch` | Batch is empty | `error.rs:37-38` |
| `BatchTooLarge` | Batch size exceeds maximum allowed (5) | `error.rs:39-40` |
| `MaintenanceMode` | System is in maintenance mode | `error.rs:41-42` |
| `Overflow` | Arithmetic overflow | `error.rs:43-44` |
| `PriceBelowMinimum` | Price below market minimum | `error.rs:45-46` |
| `PriceAboveMaximum` | Price above market maximum | `error.rs:47-48` |
| `InsufficientLiquidity` | Insufficient liquidity for market order | `error.rs:49-50` |
| `InvalidOrderSide` | Invalid order side | `error.rs:51-52` |
| `OrderExpired` | Order has expired | `error.rs:53-54` |
| `SlippageExceeded` | Slippage exceeded: Price outside allowed bounds | `error.rs:55-56` |
| `CapacityExceeded` | Grid capacity exceeded: Transmission bottleneck detected | `error.rs:57-58` |
| `InvalidGovernanceAccount` | Invalid governance account | `error.rs:59-60` |
| `InvalidEscrow` | Escrow account does not match the expected per-user PDA | `error.rs:61-62` |
| `InvalidNullifier` | Nullifier account does not match the expected per-order PDA | `error.rs:63-64` |
| `NullifierUserMismatch` | Nullifier authority does not match the signed order owner | `error.rs:65-66` |
| `TreasuryCurrencyMismatch` | Settlement currency mint is not the treasury THBG mint | `error.rs:67-68` |
| `TreasurySettlementRequired` | This market settles in THBG: the treasury accounts are required to record the settlement | `error.rs:69-70` |

---

## 9. Testing

The program's auction-clearing arithmetic is covered by Rust unit tests in `#[cfg(test)] mod tests` (`lib.rs:1739-1887`): `test_find_clearing_point_basic` and `test_find_clearing_point_no_intersection` exercise the clearing-point search (`lib.rs:1778-1806`); `test_sell_order_sorting` / `test_buy_order_sorting` verify ascending-sell / descending-buy ordering (`lib.rs:1808-1834`); `test_price_improvement_seller` / `test_price_improvement_buyer` verify uniform-price improvement (`lib.rs:1836-1852`); and `test_full_auction_scenario` runs an end-to-end curve build and clearing (`lib.rs:1854-1886`).

TypeScript integration suites live under `tests/`:

- **`tests/trading.ts`** — `describe("trading-settlement")` (`tests/trading.ts:33`): exercises `execute_atomic_settlement` between a prosumer and consumer (`tests/trading.ts:124`) and reconciliation of stored vs. canonical mint supply (`tests/trading.ts:250`).
- **`tests/escrow_settlement.ts`** — `describe("escrow-settlement")` (`tests/escrow_settlement.ts:51`): covers `deposit_escrow`/`withdraw_escrow` round-trips (`:198`), rejection of withdrawing another user's escrow (`:223`), rejection of a settlement that points a signed buyer at a victim's escrow — the theft test for invariant §5.4 (`:252`), and a successful signed off-chain match between two escrows (`:307`).

Lifecycle and load simulations (run via `npx tsx` against a live validator) are `scripts/simulate-trading.ts` and `scripts/simulate-market-clearing.ts`, with market bootstrap via `scripts/init-market.ts` / `scripts/init-zone-market.ts` and settlement driving via `scripts/execute-settlement.ts`. The BlockBench (`blockbench`) and SmallBank/TPC-C (`tpc-benchmark`) suites are separate benchmark crates and do not exercise the `trading` program's settlement path.

To build and run the trading-relevant suites (per the repository `CLAUDE.md`): `anchor test` (full mocha suite under a validator), or the standalone runner `./scripts/run-tests.sh` when `surfpool` is unavailable. The Rust unit tests run with `cargo test` from within `programs/trading` once the crate's dependencies are built.
