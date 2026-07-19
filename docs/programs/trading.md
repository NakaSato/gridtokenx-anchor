# Trading Program

## Abstract

The `trading` program is the on-chain order book and settlement engine of the GridTokenX peer-to-peer (P2P) energy-trading platform, deployed on a permissioned Proof-of-Authority (PoA) Solana cluster. It maintains a global market account, zone-partitioned order books, per-user order accounts, and a contention-reducing sharding layer, and it implements two complementary price-discovery mechanisms: a Continuous Double Auction (CDA) — a market in which buy and sell limit orders are matched continuously as they cross — and a periodic uniform-price batch auction. Its security-critical settlement path is *off-chain-signed match settlement*: an off-chain matching agent submits Ed25519-signed order payloads, and the program verifies the signatures, transfers funds between per-user escrow Program-Derived Accounts (PDAs), and records both a per-order replay nullifier (cumulative fill) and a per-match trade nullifier (replayed `trade_id` rejection), all atomically. For baht-denominated trades the program performs a mandatory, non-custodial Cross-Program Invocation (CPI) into the `treasury` program to record the gross settled value, gated on a per-market policy flag. This document specifies the program's identity, state model, instruction set, invariants, cross-program interfaces, events, error codes, and test coverage, with every concrete claim cited to source.

---

## 1. Program Identity

| Property | Value | Source |
| --- | --- | --- |
| Program ID | `CnWDEUhTvSixeLSyViWgAnnu9YouBAYVGcrrFm1s9WcX` | `programs/trading/src/lib.rs:69` |
| Crate name | `trading` | `programs/trading/Cargo.toml:2,9` |
| Crate version | `0.1.1` | `programs/trading/Cargo.toml:3` |
| Anchor framework | `anchor-lang` / `anchor-spl` `1.0.0` | `programs/trading/Cargo.toml:24-25` |
| `declare_id!` location | `programs/trading/src/lib.rs:69` | — |

The program ID is declared by `declare_id!("CnWDEUhTvSixeLSyViWgAnnu9YouBAYVGcrrFm1s9WcX")` (`lib.rs:69`). The crate is built both as a Solana BPF dynamic library and as a linkable Rust library (`crate-type = ["cdylib", "lib"]`, `Cargo.toml:8`).

### Dependencies

The program declares two intra-repository path dependencies, both with the `cpi` feature enabled so their CPI client modules are generated:

| Dependency | Declaration | Purpose |
| --- | --- | --- |
| `governance` | `governance = { path = "../governance", features = ["cpi"] }` (`Cargo.toml:35`) | Supplies `GovernanceConfig` and `ErcCertificate`/`ErcStatus` types re-exported at `lib.rs:19`; operational-mode, ERC certificate, and admitted-aggregator checks. |
| `treasury` | `treasury = { path = "../treasury", features = ["cpi"] }` (`Cargo.toml:36`) | Optional `record_settlement` CPI for baht-denominated (THBC) settlement recording. |

The `cpi` feature of the `trading` crate itself implies `no-entrypoint` (`Cargo.toml:12`). Other relevant features: `localnet` enables the `compute-debug` compute-unit profiling crate (`Cargo.toml:20,34`); when `localnet` is disabled, crate-local no-op `compute_fn!` / `compute_checkpoint!` macros are defined instead (`lib.rs:81-90`).

The release profile forces checked arithmetic: `[profile.release] overflow-checks = true` (`Cargo.toml:40-41`), because `cargo build-sbf` otherwise defaults to silent wrapping.

---

## 2. System Role

The `trading` program is the marketplace and settlement layer for energy (GRID/GRX) trades. Its responsibilities are:

1. **Order book and CDA matching.** Limit orders are submitted via `submit_limit_order` (`lib.rs:580`) and market orders via `submit_market_order` (`lib.rs:686`). The CDA design is documented inline: a buy order matches when its price is at or above the best ask, and a sell order when its price is at or below the best bid (`lib.rs:636-638`). The on-chain `submit_limit_order` initializes the order and emits a `LimitOrderSubmitted` event for off-chain matching agents (`lib.rs:661-668`); actual crossing is executed by separate match/settlement instructions.

2. **Periodic uniform-price batch auction.** `clear_auction` (`lib.rs:893`) builds aggregate supply and demand curves, locates the clearing price via `find_clearing_point` (`lib.rs:1841`), and matches all eligible orders at a single uniform clearing price (`lib.rs:893-1038`). The resulting matches are then emitted as bookkeeping events by `execute_auction_matches` (`lib.rs:1048`) — that instruction moves **no tokens** (its context carries no escrow accounts); actual token settlement of a uniform-auction match goes through the offchain settlement path (`settle_offchain_match` / `execute_atomic_settlement`).

3. **Sharded order submission and matching.** To avoid write-lock contention on global accounts, orders may be submitted to per-shard accounts via `submit_limit_order_sharded` (`lib.rs:674`) and matched via `sharded_match_orders` (`lib.rs:512`), which write to a `ZoneMarketShard` rather than to the global `ZoneMarket` (`sharded_match_orders.rs:60-64`).

4. **Off-chain-signed match settlement.** The custody-bearing settlement path is `settle_offchain_match` (implemented in `settle_offchain.rs:669`) and its batch form `batch_settle_offchain_match` (`lib.rs:558`, `settle_offchain.rs:1006`). An off-chain matcher — whose paying wallet must be a governance-admitted, active aggregator (§5.14) — supplies two Ed25519-signed order payloads; the program verifies both signatures against the Instructions sysvar, computes the network charges from the on-chain `TariffConfig` schedule (§3.7), transfers currency and energy between escrow PDAs, and updates replay nullifiers.

5. **Escrow custody.** Per-user escrow PDA token accounts hold funds for the off-chain settlement path. They are funded by `deposit_escrow` and drained by `withdraw_escrow` (`escrow.rs:57,198`); their SPL authority is the global `market_authority` PDA.

6. **Zone-partitioned markets.** Order-book depth and capacity are tracked per geographic zone in `ZoneMarket` accounts, sharded out of the global `Market` to prevent cross-zone write contention (`zone_market.rs:9-11`). Cross-zone (wheeling) flow is throttled against a transmission `capacity` via the per-zone `ZoneCapacity` counter (`settle_offchain.rs:738-751`, `zone_market.rs:41-54`).

7. **Replay protection.** Each settled off-chain order is tracked by an `OrderNullifier` PDA keyed by the order's owner and UUID (`nullifier.rs:3-9`), preventing a signed payload from being settled beyond its energy amount; a per-match `TradeNullifier` PDA keyed by the matcher's `trade_id` additionally blocks re-settling the same match (`nullifier.rs:15-30`).

All state-mutating instructions gate on the governance operational mode: they call `get_governance_config(...).is_operational()` and reject with `MaintenanceMode` otherwise (e.g. `lib.rs:216-219`, `lib.rs:319-322`; helper at `utils.rs:5-12`). The off-chain settle paths, whose contexts sit at the BPF stack limit, perform the equivalent check in-handler against a `governance_config` account threaded through `remaining_accounts` (`settle_offchain.rs:75-86`).

---

## 3. State Model

The program's persistent state is split between **zero-copy** accounts (declared `#[account(zero_copy)] #[repr(C)]`, accessed through `AccountLoader`) and **regular** Borsh-serialized accounts (declared `#[account]`, accessed through `Account`). Zero-copy accounts reserve `8 + size_of::<T>()` bytes (Anchor discriminator plus the Pod struct).

### 3.1 `Market` (zero-copy, global singleton)

Defined at `market.rs:6-62`. PDA seed: `[b"market"]` (`lib.rs:1543`). There is a single global market; the escrow and `market_authority` seeds carry no market key, and the code documents this single-market invariant (`escrow.rs:19-21`).

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
| `batch_config` | `BatchConfig` | Batch processing parameters (24 bytes). | `market.rs:33` |
| `current_batch` | `BatchInfo` | Active batch (1064 bytes: `8 + 4 + 4 + 8 + 8 + 8 + 32×32`). | `market.rs:34` |
| `has_current_batch` | `u8` | Whether a batch is open. | `market.rs:35` |
| `_padding_batch` | `[u8; 7]` | Alignment. | `market.rs:36` |
| `_padding_depth_1..3` | `[u8;512]`,`[u8;256]`,`[u8;128]` | Reserved (depth moved to `ZoneMarket`). | `market.rs:39-41` |
| `settlement_thbc_mint` | `Pubkey` | THBC settlement mint for the recording policy. | `market.rs:47` |
| `has_settlement_thbc_mint` | `u8` | Policy flag; 1 = THBC recording mandatory. | `market.rs:48` |
| `_padding_depth_4` | `[u8; 31]` | Carved from former depth padding. | `market.rs:49` |
| `_padding_depth_5` | `[u8; 6]` | Alignment. | `market.rs:50` |
| `price_history_count` | `u8` | Valid ring-buffer entries (0..=24). | `market.rs:51` |
| `price_history_head` | `u8` | Ring-buffer write head. | `market.rs:52` |
| `price_history` | `[PricePoint; 24]` | Rolling 24-slot price history (576 bytes). | `market.rs:55` |
| `total_volume_global` | `u64` | Aggregated shard volume. | `market.rs:58` |
| `total_trades_global` | `u32` | Aggregated shard trades. | `market.rs:59` |
| `num_shards` | `u8` | Active shard count. | `market.rs:60` |
| `_padding_sharding` | `[u8; 3]` | Alignment. | `market.rs:61` |

**Settlement-recording policy.** The `settlement_thbc_mint` / `has_settlement_thbc_mint` pair encodes a per-market policy: once set via `set_settlement_thbc_mint` (`lib.rs:1404`), any off-chain settlement in that currency MUST pass the treasury accounts (see §4 and §5). The fields were carved from former depth padding so the account size is unchanged and accounts predating the field read it as 0, i.e. policy off (`market.rs:42-49`).

**Embedded Pod sub-structs** (all `#[repr(C)]`, `bytemuck::Pod`): `BatchConfig` (`market.rs:69-77`), `BatchInfo` with `order_ids: [Pubkey; 32]` reduced from 50 for Pod support (`market.rs:84-92`), `PriceLevel` (`market.rs:119-124`), `PricePoint` (`market.rs:137-141`).

### 3.2 `MarketShard` (zero-copy)

Defined at `market.rs:146-156`. PDA seed: `[b"market_shard", market.key(), &[shard_id]]` (`initialize_shard.rs:18`). Per-shard volume/order counters that can be written in parallel without conflicting on the global `Market`.

| Field | Type | Source |
| --- | --- | --- |
| `shard_id` | `u8` | `market.rs:149` |
| `_padding1` | `[u8; 7]` | `market.rs:150` |
| `market` | `Pubkey` | `market.rs:151` |
| `volume_accumulated` | `u64` | `market.rs:152` |
| `order_count` | `u32` | `market.rs:153` |
| `_padding2` | `[u8; 4]` | `market.rs:154` |
| `last_update` | `i64` | `market.rs:155` |

### 3.3 `Order` and `TradeRecord` (zero-copy)

`Order` is defined at `order.rs:6-20`. PDA seed: `[b"order", authority.key(), &order_id_val.to_le_bytes()]` (e.g. `lib.rs:1583`, `lib.rs:1603`, `lib.rs:1770`).

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

`TradeRecord` (`order.rs:22-34`) records a settled match. PDA seed: `[b"trade", buy_order.key(), sell_order.key()]` (`lib.rs:1636`, `lib.rs:1658`). Fields: `sell_order`, `buy_order`, `seller`, `buyer`, `amount`, `price_per_kwh`, `total_value`, `fee_amount`, `executed_at`.

`OrderType` is `{ Sell = 0, Buy = 1 }` (`order.rs:38-41`). `OrderStatus` is `{ Active = 0, PartiallyFilled = 1, Completed = 2, Cancelled = 3, Expired = 4 }` (`order.rs:44-50`). Note that the on-the-wire `side` parameter and the off-chain payload use the inverse convention `0 = Buy, 1 = Sell` (e.g. `lib.rs:583`, `settle_offchain.rs:394`).

### 3.4 `ZoneMarket` and `ZoneMarketShard` (zero-copy)

`ZoneMarket` (`zone_market.rs:12-37`). PDA seed: `[b"zone_market", market.key(), &zone_id.to_le_bytes()]` (`lib.rs:1554`).

| Field | Type | Notes | Source |
| --- | --- | --- | --- |
| `market` | `Pubkey` | Parent market. | `zone_market.rs:15` |
| `zone_id` | `u32` | Geographic zone. | `zone_market.rs:16` |
| `num_shards` | `u8` | Shard count for this zone. | `zone_market.rs:17` |
| `segment` | `u8` | Market segment: 0 = Retail (MEA/PEA), 1 = Wholesale (EGAT). Gates which aggregators may settle here (§5.14). Carved from `_padding1`; size unchanged. | `zone_market.rs:18-22` |
| `_padding1` | `[u8; 2]` | — | `zone_market.rs:23` |
| `total_volume` | `u64` | — | `zone_market.rs:24` |
| `active_orders` | `u32` | — | `zone_market.rs:25` |
| `total_trades` | `u32` | — | `zone_market.rs:26` |
| `buy_side_depth_count` | `u8` | — | `zone_market.rs:27` |
| `sell_side_depth_count` | `u8` | — | `zone_market.rs:28` |
| `_padding2` | `[u8; 6]` | — | `zone_market.rs:29` |
| `last_clearing_price` | `u64` | — | `zone_market.rs:30` |
| `capacity` | `u64` | Transmission capacity ceiling (base units); read-only on the settle path. | `zone_market.rs:31` |
| `committed_flow` | `u64` | Legacy counter; the live cross-zone counter is `ZoneCapacity.committed_flow`. | `zone_market.rs:32` |
| `buy_side_depth` | `[PriceLevel; 10]` | Bid depth (240 bytes). | `zone_market.rs:35` |
| `sell_side_depth` | `[PriceLevel; 10]` | Ask depth (240 bytes). | `zone_market.rs:36` |

`MAX_DEPTH_LEVELS = 10` (`zone_market.rs:7`); the cap keeps `update_depth` Vec payloads within Solana's 1,232-byte transaction limit (`zone_market.rs:4-7`).

`ZoneCapacity` (`zone_market.rs:47-54`). PDA seed: `[b"zone_capacity", zone_market.key()]` (`lib.rs:1568`), created by `initialize_zone_capacity` (`lib.rs:199-207`). Holds the cross-zone `committed_flow` counter split OUT of `ZoneMarket` so the settle hot path keeps `ZoneMarket` read-only: only cross-zone (wheeling) settlements pass this account `mut` and bump the counter; intra-zone settles omit it and do not serialize on the zone book (`zone_market.rs:41-46`). Fields: `zone_market` (parent binding), `committed_flow`, `bump`, `_padding[7]`.

`ZoneMarketShard` (`zone_market.rs:56-67`). PDA seed: `[b"zone_shard", zone_market.key(), &[shard_id]]` (`initialize_zone_shard.rs:18`). Fields: `shard_id`, `_padding1[7]`, `zone_market`, `volume_accumulated`, `trade_count`, `_padding2[4]`, `last_clearing_price`, `last_update`.

### 3.5 `OrderNullifier` and `TradeNullifier` (regular `#[account]`)

`OrderNullifier` is defined at `nullifier.rs:3-13`. PDA seed: `[b"nullifier", user.as_ref(), &order_id]` (`settle_offchain.rs:436-448`). Space: `OrderNullifier::LEN = 8 + 16 + 32 + 8 + 1 = 65` bytes (`nullifier.rs:12`).

| Field | Type | Notes | Source |
| --- | --- | --- | --- |
| `order_id` | `[u8; 16]` | Original order UUID. | `nullifier.rs:5` |
| `authority` | `Pubkey` | Signer of the order. | `nullifier.rs:6` |
| `filled_amount` | `u64` | Cumulative settled energy for this order. | `nullifier.rs:7` |
| `bump` | `u8` | PDA bump. | `nullifier.rs:8` |

`TradeNullifier` (`nullifier.rs:15-30`) is the per-MATCH replay guard: a marker PDA (seed `[b"trade", trade_id]`, `settle_offchain.rs:360`; `LEN = 8 + 1`, `nullifier.rs:29`) created atomically with each settlement. `OrderNullifier` only caps cumulative fill, so it cannot stop the *same* partial match being settled twice while the order still has headroom; a replayed match finds the `TradeNullifier` already program-owned and reverts `MatchAlreadySettled` (`settle_offchain.rs:346-381`).

### 3.6 `ZoneConfig` (regular `#[account]`)

Defined at `zone_config.rs:3-15`. PDA seed: `[b"zone_config", zone_id.to_le_bytes()]` (`lib.rs:2028`). Space: `8 + 128` (`lib.rs:2027`; struct totals 125 bytes per the comment at `zone_config.rs:15`). Fields: `zone_id` (`u32`), `incentive_multiplier_bps` (`u64`, 10000 = 1.0×), `wheeling_charge_bps` (`u64`), `maintenance_mode` (`u8`), `authority` (`Pubkey`), `last_updated` (`i64`), `reserved1`/`reserved2` (`[u8; 32]` each).

### 3.7 `TariffConfig` (regular `#[account]`, singleton)

Defined at `tariff_config.rs:36-48`. PDA seed: `[b"tariff_config"]` (`tariff.rs:12`). Space: `8 + TariffConfig::LEN` with `LEN = 32 + 32 + 8 + 2 + 1 = 75` (`tariff.rs:11`, `tariff_config.rs:45-48`). The on-chain network-tariff schedule: it replaces the former caller-supplied `wheeling_charge_val`/`loss_cost_val` settlement arguments, which let whoever signed the settle transaction pick any charge with no tie to a tariff authority (`tariff_config.rs:25-35`).

| Field | Type | Notes | Source |
| --- | --- | --- | --- |
| `wheeling_authority` | `Pubkey` | Only key allowed to set the wheeling rate (MEA/PEA — distribution network usage; retail P2P trades never reach EGAT's transmission grid). | `tariff_config.rs:38` |
| `loss_authority` | `Pubkey` | Only key allowed to set the loss rate (MEA/PEA — distribution line loss). | `tariff_config.rs:39` |
| `wheeling_rate_per_kwh` | `u64` | **Flat** rate in 6-decimal currency units per kWh (same representation as `price_per_kwh`) — delivery cost does not scale with the agreed commodity price. | `tariff_config.rs:40` |
| `loss_bps` | `u16` | Line-loss rate in bps of trade value — loss *is* proportional, since lost energy is re-purchased at the agreed price. | `tariff_config.rs:41` |
| `bump` | `u8` | PDA bump. | `tariff_config.rs:42` |

Three caps bound the schedule: `MAX_LOSS_BPS = 2000` and `MAX_WHEELING_RATE_PER_KWH = 10_000_000` (10.00 THB/kWh) apply at tariff-set time (`tariff_config.rs:7`, `tariff_config.rs:23`), while `MAX_NETWORK_CHARGE_BPS = 2000` remains a settlement-time defense-in-depth check on the *computed* charges against each trade's value — a sane flat wheeling rate can still be an outsized fraction of a very small trade (`tariff_config.rs:9-15`).

---

## 4. Instruction Set

This section specifies every instruction in the `#[program] mod trading` (`lib.rs:94-2037`) and its delegated handlers. For brevity, the ubiquitous `governance_config` operational check (`is_operational()` → `MaintenanceMode`) is noted once per instruction rather than re-described.

### 4.1 Initialization

**`initialize_program`** (`lib.rs:114`). No-op marker emitting a log. Signer: `authority`.

**`initialize_market`** (`lib.rs:121`, args `num_shards: u8`). Signer: `authority` (becomes `market.authority`). Initializes the global `Market` PDA (`init`, seed `[b"market"]`) with `market_fee_bps = 25`, `min_price_per_kwh = 1`, `clearing_enabled = 1`, default `BatchConfig` (disabled), and zeroed price history (`lib.rs:121-159`). Emits `MarketInitialized`.

**`initialize_zone_market`** (`lib.rs:161`, args `zone_id: u32, num_shards: u8, capacity: u64, segment: u8`). Signer: `authority`. Initializes a `ZoneMarket` PDA bound to `market` with the given capacity and market segment (0 = Retail, 1 = Wholesale — see §5.14); zeroes both depth arrays (`lib.rs:161-187`). No event.

**`initialize_zone_capacity`** (`lib.rs:199-207`). Signer: `payer`. One-time creation of the per-zone `ZoneCapacity` PDA (§3.4) that carries the cross-zone `committed_flow` counter.

**`initialize_zone_config`** (`lib.rs:98`, args `zone_id, incentive_multiplier_bps`). Signer: `authority`. Initializes a `ZoneConfig` PDA (`lib.rs:98-112`, context `lib.rs:2021-2037`).

**`initialize_market_shard`** (`lib.rs:1474` → `initialize_shard.rs:28`, arg `shard_id: u8`). Signer: `payer`. Initializes a `MarketShard` PDA (seed `[b"market_shard", market, shard_id]`).

**`initialize_zone_market_shard`** (`lib.rs:189` → `initialize_zone_shard.rs:28`, arg `shard_id: u8`). Signer: `payer`. Initializes a `ZoneMarketShard` PDA (seed `[b"zone_shard", zone_market, shard_id]`).

**`initialize_collectors`** (`lib.rs:1482` → `escrow.rs:286`). Signer: `payer`. One-time `init` of the three collector PDA token accounts (`fee_collector`, `wheeling_collector`, `loss_collector`) for a given `currency_mint`, all with SPL authority = `market_authority` (`escrow.rs:248-279`). **`initialize_sharded_collectors`** (`lib.rs:1488` → `escrow.rs:346`, arg `shard_id`) creates the per-shard collector PDAs (seeds suffixed with `&[shard_id]`, `escrow.rs:308-330`) used by the batch settle path, and **`sweep_collectors`** (`lib.rs:1496` → `escrow.rs:393`) consolidates a shard's balances into the canonical collectors.

### 4.2 Order submission

**`create_sell_order`** (`lib.rs:209`, args `order_id_val, energy_amount, price_per_kwh`) and **`create_buy_order`** (`lib.rs:312`, args `order_id_val, energy_amount, max_price_per_kwh`). Signer: `authority`. Preconditions: operational; amount > 0; price > 0; price within `[min_price_per_kwh, max_price_per_kwh]` (the upper bound only when nonzero) (`lib.rs:216-235`, `319-338`). `create_sell_order` additionally validates an optional `ErcCertificate` (Energy/Renewable Certificate): status `Valid`, not expired, `validated_for_trading`, and `energy_amount <= erc.energy_amount` (`lib.rs:241-257`). It also supports an opt-in fungible-REC balance gate via `remaining_accounts[0]` (`lib.rs:259-283`): when the seller appends their REC token account, it must belong to the governance `[b"rec_mint"]` mint (`InvalidRecMint`), be owned by the seller (`RecAccountOwnerMismatch`), and hold at least `energy_amount × 1_000` base units — the 6-decimal REC mint's kWh equivalent (`InsufficientRecBalance`); omitting the account skips the gate (backwards compatible). Effects: `init` the `Order` PDA, set fields, `expires_at = created_at + 86400`, increment `zone_market.active_orders`. Emits `SellOrderCreated` / `BuyOrderCreated`.

**`record_order_custodial`** (`lib.rs:373`, args `order_id_val, user: Pubkey, is_buy, energy_amount, price_per_kwh`). Signer: `funder` (the platform), who pays rent; the non-signing `user` is stored as the order's buyer or seller per `is_buy`. Custodial analogue of `create_{buy,sell}_order`: the `Order` PDA is seed-bound to `[b"order", user, order_id_val]` (`lib.rs:1618`), and the same operational/amount/price-bounds validation applies (`lib.rs:382-401`); off-chain authorization is enforced by Chain Bridge RBAC (trading-service role only) (`lib.rs:368-372`). Effects mirror the direct paths (`expires_at = created_at + 86400`, increment `zone_market.active_orders`); no event is emitted.

**`submit_limit_order`** (`lib.rs:580`, args `order_id_val, side, amount, price`). Signer: `authority`. CDA limit order. Validates operational, amount/price > 0, and price bounds; `init`s the order with the appropriate side; increments `market.active_orders`; emits both the side-specific order event and `LimitOrderSubmitted` for off-chain matchers (`lib.rs:588-671`). Note `side` here is `0 = Buy, 1 = Sell`.

**`submit_limit_order_sharded`** (`lib.rs:674` → `submit_sharded_limit_order.rs:10`, args `order_id_val, side, amount, price, shard_id`). Signer: `authority`. Initializes the order and touches the `ZoneMarketShard.last_update` rather than the global market; emits `LimitOrderSubmitted`. The `zone_shard` is bound by seed `[b"zone_shard", zone_market, shard_id]` (`lib.rs:1756`).

**`submit_market_order`** (`lib.rs:686`, args `side, amount`). Signer: `authority`. Requires opposite-side liquidity (`zone_market.sell_side_depth_count > 0` for buys, `buy_side_depth_count > 0` for sells), else `InsufficientLiquidity`; emits `MarketOrderSubmitted` for an off-chain agent to fill (`lib.rs:692-725`).

### 4.3 Matching

**`match_orders`** (`lib.rs:429`, arg `match_amount`). Signer: `authority`. Matches one buy against one sell order. Preconditions: both orders `Active`/`PartiallyFilled`; `buy.price >= sell.price` (`PriceMismatch`). Clearing price is the seller's price; `actual_match_amount = min(match_amount, buy_remaining, sell_remaining)`; updates `filled_amount`/`status`, `init`s a `TradeRecord`, updates `zone_market` stats; emits `OrderMatched` (`lib.rs:429-510`).

**`sharded_match_orders`** (`lib.rs:512` → `sharded_match_orders.rs:11`, args `match_amount, shard_id`). Signer: `authority`. Identical matching logic to `match_orders`, but updates a `ZoneMarketShard` instead of the global `ZoneMarket` (`sharded_match_orders.rs:60-64`), reducing contention. Emits `OrderMatched`. The `shard_id` parameter is unused inside the handler (`_shard_id`); shard selection is enforced by the account seed constraint (`lib.rs:1652`).

**`clear_auction`** (`lib.rs:893`, args `sell_orders: Vec<AuctionOrder>, buy_orders: Vec<AuctionOrder>`). Returns `ClearAuctionResult`. Sorts sells ascending and buys descending by price (`lib.rs:912-917`), builds supply and demand curves (`lib.rs:919-941`), finds the clearing point (`lib.rs:944`), then matches eligible orders (sells priced ≤ clearing, buys priced ≥ clearing) at the uniform clearing price, emitting an `OrderMatched` per pair (`lib.rs:949-1010`). Updates market/zone aggregates and emits `AuctionCleared` (`lib.rs:1012-1027`). Errors: empty input → `InvalidAmount`; no intersection → `InvalidPrice`/`InvalidAmount` from `find_clearing_point` (`lib.rs:1860-1861`).

**`execute_auction_matches`** (`lib.rs:1048`, args `matches: Vec<AuctionMatch>, clearing_price`). Signer: `authority`. Iterates the matches produced by `clear_auction`, computes per-match fee `trade_value * market_fee_bps / 10000` with `checked_mul` (overflow → `Overflow`), emits `OrderMatched`, and bumps market aggregates (`lib.rs:1053-1094`).

### 4.4 Batch processing (removed)

The former batch-builder instructions (`add_order_to_batch`, `execute_batch`, `cancel_batch`) were dead code (`batch_config.enabled` was never set) and were **removed** in commit `85a8702`, together with their events. The `Market.batch_config`/`current_batch` fields remain solely for zero-copy layout stability (§3.1). Off-chain match batching is instead served by `batch_settle_offchain_match` (§4.7).

### 4.5 Order lifecycle

**`cancel_order`** (`lib.rs:520`). Signer: `authority` must equal the order owner (buyer for buy orders, seller for sell orders), else `UnauthorizedAuthority`; order must be `Active`/`PartiallyFilled`, else `OrderNotCancellable`. Sets status `Cancelled`, decrements `zone_market.active_orders`; emits `OrderCancelled` (`lib.rs:520-556`).

### 4.6 Market depth and price history

**`update_depth`** (`lib.rs:730`, Vec args for buy/sell prices and amounts). Signer: market `authority` (`has_one`, `lib.rs:1791`). Validates lengths ≤ `MAX_DEPTH_LEVELS` and that price/amount vectors align; rewrites the depth arrays; emits `DepthUpdated` (`lib.rs:737-815`).

**`update_price_history`** (`lib.rs:820`, args `trade_price, trade_volume`). Signer: market `authority`. O(1) ring-buffer insert at `price_history_head`, recompute VWAP across valid entries; emits `PriceHistoryUpdated` (`lib.rs:825-877`).

### 4.7 Settlement

**`execute_atomic_settlement`** (`lib.rs:1099`, args `amount, price, trade_id: [u8;16]`). Signers: `escrow_authority` and `market_authority` (`lib.rs:1723-1725`); `market_authority.key()` must equal `market.authority` (`lib.rs:1115-1119`). A `TradeNullifier` PDA keyed by `trade_id` is `init`ed in the context, so a replayed match reverts (`lib.rs:1692-1699`). Slippage protection requires `sell.price <= price <= buy.price` (`SlippageExceeded`, `lib.rs:1125-1132`). Wheeling and loss are **not caller arguments**: the context carries the seed-bound `tariff_config` account (`lib.rs:1730-1731`) and the handler computes `wheeling = amount × wheeling_rate_per_kwh / 1e9` (flat per-kWh) and `loss = total_value × loss_bps / 10000` from it (`lib.rs:1159-1173`). Transfers currency (fee, net seller, wheeling, loss) from the buyer's currency escrow and energy from the seller's energy escrow, via `transfer_checked` over two token programs; updates order fill/status and market stats; emits `OrderMatched` (`lib.rs:1099-1360`).

**`settle_offchain_match`** (`lib.rs:1423` → `settle_offchain.rs:669`, args `buyer_payload, seller_payload: OffchainOrderPayload`, `match_amount, match_price, trade_id: [u8;16]`). The core off-chain-signed settlement instruction. Signer: `payer` (the matching agent, which must be a governance-admitted aggregator — below). See §4.10 for the signing model. Named accounts (`settle_offchain.rs:413-558`): the singleton `market` (seed `[b"market"]`), a **read-only** `zone_market` constrained to belong to that market, two `OrderNullifier` PDAs (`init_if_needed`, keyed by each payload's user + order_id), `currency_mint`/`energy_mint`, the `market_authority` PDA (escrow signer), two token programs, four per-user escrow token accounts (currency and energy for both buyer and seller, each seed `[b"escrow", user, mint]`), the three collector PDAs, a `market_shard` and `zone_shard` selected by `get_shard_id(payer, num_shards)` (`settle_offchain.rs:528-540`), the Instructions sysvar, and **optional** `treasury_program`/`treasury_state` (`settle_offchain.rs:555-557`). Because the context is at the BPF stack ceiling, further accounts ride in `remaining_accounts`: `[0]` the governance `governance_config`, `[1]` the per-match `TradeNullifier`, `[2]` the **mandatory** `tariff_config`, `[3]` the **mandatory** payer `AggregatorEntry`, `[4]` the `ZoneCapacity` PDA (mandatory iff the match is cross-zone, `settle_offchain.rs:741-745`), then the optional REC-transfer group (`settle_offchain.rs:879-894`).

Preconditions, in order: **governance maintenance gate first** — before any signature work the handler binds `remaining_accounts[0]` to the canonical `[b"governance_config"]` governance PDA and rejects with `MaintenanceMode` (or `InvalidGovernanceAccount`) when the platform is paused (`settle_offchain.rs:678-686`, helper `require_governance_operational` at `settle_offchain.rs:75-86`). Then the **operator gate** (role-map fixes #8b/#6): `payer` must own an active governance `AggregatorEntry` PDA (`[b"aggregator", payer]`, owned by `governance::ID`), else `AggregatorNotAdmitted`; and when the zone's `segment` is Wholesale (1) the aggregator's own segment byte must also be Wholesale, else `AggregatorSegmentMismatch` — Retail zones accept any admitted aggregator (`settle_offchain.rs:693-703`, helper `require_admitted_aggregator` at `settle_offchain.rs:145-171`). Then: valid buyer and seller Ed25519 signatures (`settle_offchain.rs:705-714`); `match_amount > 0`; `seller.price <= match_price <= buyer.price` (`SlippageExceeded`); `buyer.side == 0` and `seller.side == 1` (`InvalidOrderSide`); neither payload expired (`OrderExpired`, where `expires_at == 0` means no expiry) (`settle_offchain.rs:716-725`); cross-zone capacity not exceeded when either leg is remote, tracked on the writable `ZoneCapacity` counter (`CapacityExceeded`, `settle_offchain.rs:738-751`); `match_amount` within both nullifier-tracked remaining amounts (`InvalidAmount`, `settle_offchain.rs:753-755`); and the per-match `TradeNullifier` claim, which reverts `MatchAlreadySettled` on a replayed `trade_id` (`settle_offchain.rs:757-773`).

Effects: `total_currency_value = match_amount × match_price / 1e9` — a u128 `checked_mul` scaled by `ENERGY_AMOUNT_DECIMALS_DIVISOR` so 9-decimal energy × 6-decimal price lands in 6-decimal currency; overflow rejects rather than saturates, to avoid paying out a clamped value (`settle_offchain.rs:781-787`, `lib.rs:21-26`); `market_fee = total * market_fee_bps / 10000`. The network charges come from the on-chain tariff schedule, **not** caller args: `tariff_rates` raw-reads `remaining_accounts[2]` as the canonical `[b"tariff_config"]` PDA (`settle_offchain.rs:128-143`), then `wheeling_charge_val = match_amount × wheeling_rate_per_kwh / 1e9` (flat per-kWh) and `loss_cost_val = total × loss_bps / 10000` (`settle_offchain.rs:790-803`). The seller's net proceeds are computed by `net_seller_after_charges(total, market_fee, wheeling, loss)` (`settle_offchain.rs:804`, defined `settle_offchain.rs:112-126`), which keeps two defense-in-depth bounds: combined network charges `wheeling + loss` must not exceed `MAX_NETWORK_CHARGE_BPS = 2000` (20%) of the trade value (`ChargesExceedCap`), and total deductions `fee + wheeling + loss` must not exceed the trade value (`ChargesExceedValue`). It returns `net_seller_amount = total − fee − wheeling − loss`. Four currency `transfer_checked` CPIs (fee→`fee_collector`, wheeling→`wheeling_collector`, loss→`loss_collector`, net→seller currency escrow) and one energy `transfer_checked` (seller energy escrow → buyer energy escrow), all signed by `market_authority` (`settle_offchain.rs:810-877`), plus the opt-in REC transfer when the REC group is present (`settle_offchain.rs:879-894`). Then the mandatory-or-optional treasury recording (§4.8 / §5), nullifier updates (`filled_amount += match_amount`, plus `order_id`/`authority`/`bump`), and shard stat updates. Emits `OrderMatched` keyed by the two nullifier PDAs (`settle_offchain.rs:949-959`).

**`batch_settle_offchain_match`** (`lib.rs:558` → `settle_offchain.rs:1006`, args `matches: Vec<BatchMatchPair>, merkle_root, vat_amount, vat_rate_bps, batch_id, settle_shard_id`). Settles 1–4 matches in one transaction (`BatchTooLarge` outside that range, `settle_offchain.rs:1017`). Each `BatchMatchPair` is `{buyer_payload, seller_payload, match_amount, match_price, trade_id}` — the former per-match `wheeling_charge`/`loss_cost` fields were removed with the tariff binding (`settle_offchain.rs:560-569`). Unlike the single path, the collectors are **sharded** by the caller-supplied `settle_shard_id` (seed suffix `&[shard_id]`, validated `< treasury::NUM_SETTLE_SHARDS` → `InvalidShardId`, `settle_offchain.rs:600-633`, `1018`), and the optional treasury wiring adds a per-shard `settlement_shard` accumulator plus a per-`(zone, batch)` `settlement_record` (`settle_offchain.rs:645-666`). The per-pair accounts ride in `remaining_accounts` — exactly `match_count * 7 + 3` (or `+ 4` with `ZoneCapacity`): per pair 2 nullifiers + 4 escrows + 1 `TradeNullifier`, then trailing `governance_config` (at `match_count*7`), the **mandatory** `tariff_config` (`+1`), the **mandatory** payer `AggregatorEntry` (`+2`), and an optional writable `ZoneCapacity` (`+3`) for cross-zone batches (`settle_offchain.rs:1022-1030`). Gate order mirrors the single path: maintenance gate first (`settle_offchain.rs:1032-1034`), tariff rates fetched once for the whole batch (`settle_offchain.rs:1036-1038`), then the admitted-aggregator + segment gate (`settle_offchain.rs:1046-1049`). Each per-pair account is bound to the canonically derived PDA for the *signed* payload via `require_keys_eq!` against `Pubkey::find_program_address` (`InvalidNullifier`/`InvalidEscrow`, `settle_offchain.rs:1083-1120`), with additional SPL-owner checks. Per-match logic mirrors the single path — per-match `TradeNullifier` claim (`settle_offchain.rs:1160-1170`), flat-per-kWh wheeling and bps loss from the shared rates (`settle_offchain.rs:1181-1189`), and the `net_seller_after_charges` bound (`settle_offchain.rs:1190`) — except the REC transfer, which is deliberately not wired into the rigid batch layout (`settle_offchain.rs:1265-1271`). The batch's gross value is accumulated and recorded once after the loop via a single `record_settlement_batch_sharded` CPI that binds `merkle_root` and the VAT figures to the treasury `SettlementRecord` (`settle_offchain.rs:1297-1354`). Emits one `OrderMatched` per pair.

### 4.8 Escrow and policy

**`deposit_escrow`** (`lib.rs:1502` → `escrow.rs:57`, arg `amount`). Signer: `user`. Transfers `amount` from the user's wallet token account into their escrow PDA (`init_if_needed`, seed `[b"escrow", user, mint]`, authority `market_authority`); emits `EscrowDeposited` (`escrow.rs:57-85`). The custodial analogue **`fund_escrow_custodial`** (`lib.rs:1514` → `escrow.rs:131`, args `user: Pubkey, amount`) lets a platform `funder` sign the deposit into a non-signing `user`'s escrow — the escrow address is still seed-bound to `[user, mint]` (`escrow.rs:87-95`).

**`withdraw_escrow`** (`lib.rs:1507` → `escrow.rs:198`, arg `amount`). Signer: `user`. Requires `amount <= escrow.amount` (`InsufficientEscrowBalance`, `escrow.rs:201-204`); transfers from the escrow PDA back to the user wallet, signed by `market_authority`; emits `EscrowWithdrawn`. The escrow seed includes `user.key()`, so a signer can only address their own escrow (`escrow.rs:172-175`).

**`set_settlement_thbc_mint`** (`lib.rs:1404`, arg `thbc_mint: Pubkey`). Signer: market `authority` (`has_one`, `lib.rs:1744`). Rejects `Pubkey::default()` (`TreasuryCurrencyMismatch`, `lib.rs:1409`); sets `settlement_thbc_mint` and `has_settlement_thbc_mint = 1`; emits `SettlementThbcMintSet` (`lib.rs:1399-1421`). After this, THBC-denominated off-chain settlements require the treasury accounts (see §5).

**`update_market_params`** (`lib.rs:1362`, args `fee_bps, clearing, min_price, max_price`). Signer: market `authority`. Updates fee, clearing flag, and price bounds; emits `MarketParamsUpdated` (`lib.rs:1362-1397`).

### 4.9 Network tariff schedule (wheeling/loss)

These instructions manage the `TariffConfig` singleton (§3.7) from which every settlement path computes its wheeling and loss charges (role-map.md fix #7b). All are thin `lib.rs` wrappers (`lib.rs:1444-1472`) over `instructions/tariff.rs`.

**`initialize_tariff_config`** (`tariff.rs:29-45`, args `wheeling_authority: Pubkey, loss_authority: Pubkey, wheeling_rate_per_kwh: u64, loss_bps: u16`). Signer: the market admin (`has_one = authority` on `market`, `tariff.rs:16-19`). One-time `init` of the schedule; rejects `wheeling_rate_per_kwh > MAX_WHEELING_RATE_PER_KWH` or `loss_bps > MAX_LOSS_BPS` with `TariffRateExceedsCap` (`tariff.rs:36-37`). Both authorities are MEA/PEA (distribution) keys — retail P2P trades settle within one distribution territory and never touch EGAT's transmission grid; EGAT's on-chain role is the separate wholesale segment (§5.14).

**`set_wheeling_rate`** (`tariff.rs:59-63`, arg `new_rate_per_kwh: u64`). Signer: `wheeling_authority` (`has_one`, `tariff.rs:49`). Sets the **flat** per-kWh wheeling rate, capped by `MAX_WHEELING_RATE_PER_KWH` — capped independently of `loss_bps`, since the two are different units (flat per-kWh vs bps-of-value).

**`set_loss_rate`** (`tariff.rs:75-79`, arg `new_bps: u16`). Signer: `loss_authority` (`has_one`, `tariff.rs:67`). Sets the proportional line-loss rate, capped by `MAX_LOSS_BPS`.

**`set_tariff_authorities`** (`tariff.rs:121-129`, args `new_wheeling_authority, new_loss_authority`). Signer: market admin. Key rotation only; does not touch the rates.

**`close_tariff_config`** (`tariff.rs:100-108`). Signer: market admin. Deliberately **untyped** reclaim of the PDA (drains lamports, zeroes data) so a `TariffConfig` whose on-chain bytes predate the current layout can be re-initialized at the new size — used for the 2026-07-04 wheeling bps → flat-rate migration; pre-mainnet/localnet only (`tariff.rs:83-99`).

### 4.10 Off-chain match signing model

The off-chain settlement model decouples *matching* (performed off-chain) from *custody and recording* (performed on-chain). Each order is represented by an `OffchainOrderPayload` (`settle_offchain.rs:388-397`): `order_id: [u8;16]` (UUID), `user`, `energy_amount`, `price_per_kwh`, `side`, `zone_id`, `expires_at`. Its canonical message is the concatenation of these fields in fixed little-endian layout (`get_message`, `settle_offchain.rs:400-410`). The order owner signs this message off-chain with their Ed25519 key.

To settle, the matching agent constructs a transaction whose instructions are `[Ed25519_verify(buyer), Ed25519_verify(seller), settle_offchain_match]` (for the batch form, the Ed25519 instructions are interleaved per pair: `[buyer_0, seller_0, buyer_1, seller_1, …]`, `settle_offchain.rs:1077`). Inside the program, `verify_ed25519_signature` (`settle_offchain.rs:1359-1426`) reads the Instructions sysvar, locates the verification instruction at the expected index, confirms its program is the Ed25519 native program (`ED25519_ID`, `settle_offchain.rs:4-7`), parses the `Ed25519SignatureOffsets` header, requires every offset to reference the instruction itself, and checks that the public key and message at the *declared* offsets match the payload's `user` and `get_message()` byte-for-byte. Because Solana's runtime executes the Ed25519 instruction itself, a successful match of pubkey + message proves a valid signature. The settlement instruction's escrow and collector addresses are then fully derived from the signed `user` and mints, so a forged or substituted account cannot redirect funds (§5).

---

## 5. Invariants & Security Properties

1. **CDA matching correctness.** Continuous matching requires `buy.price >= sell.price` and settles at the seller's price (`lib.rs:453-462`, `sharded_match_orders.rs:35-40`). Off-chain settlement enforces two-sided slippage bounds: `seller.price <= match_price <= buyer.price` (`settle_offchain.rs:718-719`). `execute_atomic_settlement` enforces the same bounds (`lib.rs:1125-1132`). The matched amount is always clamped to both sides' remaining quantity (`lib.rs:460`, `settle_offchain.rs:753-755`).

2. **Uniform-price auction.** `clear_auction` matches all eligible orders at a single clearing price found at the supply/demand intersection that maximizes feasible volume (`find_clearing_point`, `lib.rs:1841-1864`), giving every matched participant price improvement relative to their limit. The clearing logic is unit-tested (§9).

3. **Replay protection via nullifiers.** Each off-chain order's cumulative settled energy is tracked in an `OrderNullifier` PDA keyed by `[b"nullifier", user, order_id]` (`settle_offchain.rs:436-448`). `match_amount` is bounded by `energy_amount − nullifier.filled_amount` (`settle_offchain.rs:753-755`), so a signed payload can never be settled beyond its own energy amount across repeated submissions. A per-match `TradeNullifier` PDA keyed by `trade_id` additionally rejects re-settling the *same* partial match while the order still has headroom (`MatchAlreadySettled`, `settle_offchain.rs:346-381`, batch `settle_offchain.rs:1160-1170`). In the batch path the nullifier accounts must equal the PDA derived from the signed payload (`InvalidNullifier`, `settle_offchain.rs:1086-1095`) and the loaded nullifier's stored `authority` must equal the payload user (`NullifierUserMismatch`, `settle_offchain.rs:1149-1150`).

4. **Escrow custody binding.** Every escrow address is derived from the signed payload's `user` and the mint (`seeds = [b"escrow", user, mint]`), so settlement can never be aimed at a victim's funds — the seed derivation is the authorization (`settle_offchain.rs:460-497`, `escrow.rs:14-21`). The escrow SPL authority is the global `market_authority` PDA, which signs all outbound transfers (`settle_offchain.rs:806-808`). `withdraw_escrow` seeds include `user.key()`, so a signer can only drain their own escrow (`escrow.rs:172-175`). Collectors are likewise bound to seed PDAs so fees cannot be redirected (`settle_offchain.rs:499-526`).

5. **Singleton-market binding.** `settle_offchain_match` binds `market` to the canonical `[b"market"]` PDA, blocking substitution of a fee-zero market, and constrains `zone_market` to belong to that market, blocking a zero-capacity or wrong-zone book (`settle_offchain.rs:416-425`).

6. **Mandatory THBC settlement recording.** When `market.has_settlement_thbc_mint == 1` and the settlement `currency_mint` equals `market.settlement_thbc_mint`, recording is mandatory: `recording_required` is computed, and if the treasury accounts are absent the instruction fails with `TreasurySettlementRequired` (`settle_offchain.rs:897-929` single path; `settle_offchain.rs:1297-1354` batch path). When the treasury accounts *are* supplied, the settlement currency must equal `treasury_state.thbc_mint` (`TreasuryCurrencyMismatch`, `settle_offchain.rs:909-913`, `1305-1309`), preventing an arbitrary token from being recorded as a baht settlement.

7. **`market_authority` PDA as escrow signer / settlement recorder.** All escrow transfers and the treasury recording CPIs are signed by the `market_authority` PDA (seed `[b"market_authority"]`, `settle_offchain.rs:454`, `914-924`, `1068`), which is also the on-chain identity the treasury program expects as `recorder`/`settlement_recorder` (§6).

8. **Cross-zone capacity throttle.** When `zone_market.capacity > 0` and *either* leg is remote relative to the zone, `committed_flow + match_amount` must not exceed `capacity` (`CapacityExceeded`, `settle_offchain.rs:738-751`, batch `settle_offchain.rs:1193-1204`). The live `committed_flow` counter is the `ZoneCapacity` PDA, which is *mandatory* for cross-zone matches — omitting it cannot bypass the ceiling (`ZoneCapacityRequired`, `settle_offchain.rs:88-110`). Checking both legs (not only the seller) closes a remote-buyer/local-seller bypass (`settle_offchain.rs:731-739`).

9. **Sharding parallelism.** Hot-path settlement writes go to per-shard `MarketShard`/`ZoneMarketShard` accounts selected by `get_shard_id(authority) = authority.to_bytes()[0] % num_shards` (`market.rs:160-163`), so concurrent settlements by different payers touch disjoint shard accounts and do not serialize on the global `Market`/`ZoneMarket`. The batch path additionally shards the fee/wheeling/loss collectors by the caller-rotated `settle_shard_id` (`settle_offchain.rs:600-633`).

10. **Checked arithmetic / overflow safety.** Monetary products use `checked_mul` (u128 intermediates for the 9-decimal × 6-decimal scaling) and reject on overflow rather than saturating, since a clamped money value would be paid out and recorded incorrectly (`settle_offchain.rs:781-787`, `1173-1179`). Aggregate counters use `saturating_*`. The release build forces `overflow-checks = true` so bare `+=`/`-=` panic instead of wrapping (`Cargo.toml:40-41`).

11. **Mandatory maintenance gate on the settlement fund paths.** Both `settle_offchain_match` and `batch_settle_offchain_match` are custody-bearing fund paths, so each gates on the governance operational mode **before** any signature verification — rejecting with `MaintenanceMode` when the platform is paused (`settle_offchain.rs:678-686`, `1032-1034`). The check is performed in-handler against a `governance_config` account threaded through `remaining_accounts` (first account for the single path, trailing for the batch) rather than a named `seeds`-constrained field, because the settle context already sits at the BPF stack ceiling (`settle_offchain.rs:76-78`). `require_governance_operational` still binds that account to the canonical `[b"governance_config"]` PDA owned by `governance::ID` and reads the `maintenance_mode` byte directly (`settle_offchain.rs:75-86`), so the workaround does not weaken the gate.

12. **Bounded network charges (defense-in-depth).** The computed `wheeling` and `loss` charges are validated by `net_seller_after_charges` (`settle_offchain.rs:112-126`), which replaced a `saturating_sub` chain that silently zeroed the seller when charges exceeded the trade. It rejects when `wheeling + loss` exceeds 20% of trade value (`MAX_NETWORK_CHARGE_BPS = 2000`, `tariff_config.rs:15`, `ChargesExceedCap`) and when `fee + wheeling + loss` exceeds the trade value (`ChargesExceedValue`). Since the tariff binding (#13) the primary caps live at tariff-set time; this stays as a per-settlement backstop because a sane flat wheeling rate can still be an outsized fraction of a very small trade. Both settle paths use it (`settle_offchain.rs:804`, `1190`).

13. **On-chain tariff authority binding.** Wheeling and loss charges are computed from the `TariffConfig` PDA on every settlement path — single (`settle_offchain.rs:790-803`), batch (`settle_offchain.rs:1181-1189`), and atomic (`lib.rs:1159-1173`) — never taken from the caller. `wheeling_rate_per_kwh` is a **flat THB/kWh rate** (`wheeling = energy × rate / 1e9`, mirroring the trade-value scaling) settable only by `wheeling_authority`; `loss_bps` is proportional to trade value and settable only by `loss_authority` — both MEA/PEA distribution keys (§3.7, `tariff.rs:29-79`). The settle paths bind the account to the canonical `[b"tariff_config"]` PDA owned by this program (`InvalidTariffConfig`, `settle_offchain.rs:128-143`); rate updates are capped at set time (`TariffRateExceedsCap`, `tariff.rs:36-37`, `60`, `76`).

14. **Admitted-aggregator operator gate with segment split.** The settlement `payer` on both off-chain settle paths must own an active governance `AggregatorEntry` PDA (`[b"aggregator", payer]`, owned by `governance::ID`) — an arbitrary funded wallet cannot submit settlements (`AggregatorNotAdmitted`, `require_admitted_aggregator`, `settle_offchain.rs:145-171`; wired at `settle_offchain.rs:693-703` and `1046-1049`). A Wholesale zone (`ZoneMarket.segment == 1`, EGAT's segment) additionally requires the aggregator's own `segment` byte to be Wholesale (`AggregatorSegmentMismatch`, `settle_offchain.rs:160-169`); Retail zones (0, the default) accept any admitted aggregator, and a legacy pre-segment entry reads as Retail. `execute_atomic_settlement` is intentionally outside this gate — its `market_authority` signer already ties to `market.authority` (`lib.rs:1115-1119`).

---

## 6. Cross-Program Interfaces (CPI)

The program has two CPI counterparties; both dependencies are declared with `features = ["cpi"]` (`Cargo.toml:35-36`).

### 6.1 trading → governance

The `governance` program supplies `GovernanceConfig`, `ErcCertificate`, and `ErcStatus`, re-exported at `lib.rs:19`. There is no CPI *invoke* into governance; instead, the `GovernanceConfig` account is read and manually deserialized (`get_governance_config`, `utils.rs:5-12`, which skips the 8-byte discriminator and Borsh-decodes the body, returning `InvalidGovernanceAccount` on failure). Every state-mutating instruction calls `is_operational()` on this config and rejects with `MaintenanceMode` when the platform is paused (e.g. `lib.rs:216-219`). `create_sell_order` additionally validates a governance-issued `ErcCertificate` when present (`lib.rs:241-256`). The off-chain settle paths perform two further raw-byte reads of governance-owned accounts (stack-ceiling workaround, no typed deserialize): the `governance_config` maintenance byte (`require_governance_operational`, `settle_offchain.rs:75-86`) and the payer's `AggregatorEntry` PDA for the admitted-aggregator + segment gate (`require_admitted_aggregator`, `settle_offchain.rs:145-171`).

### 6.2 trading → treasury (settlement recording, optional and non-custodial)

The off-chain settlement instructions accept optional `treasury_program: Option<Program<Treasury>>` and `treasury_state: Option<AccountLoader<Treasury>>` accounts (`settle_offchain.rs:555-557`, `649-657`); the batch context also takes an optional per-shard `settlement_shard` accumulator and per-`(zone, batch)` `settlement_record` (`settle_offchain.rs:658-666`). When the treasury accounts are present, the single path performs `treasury::cpi::record_settlement` with `RecordSettlement { treasury, recorder }`, signed by the `market_authority` PDA (`settle_offchain.rs:914-924`); the batch path performs `treasury::cpi::record_settlement_batch_sharded`, which bumps the per-shard `SettlementShard` (keeping `treasury_state` read-only so THBC batches don't serialize on the singleton) and CPI-inits a `SettlementRecord` binding the batch's `merkle_root`, VAT figures, `zone_id`, and `batch_id` (`settle_offchain.rs:1297-1354`, read-only rationale `settle_offchain.rs:650-657`). Properties:

- **Non-custodial.** The CPI moves no funds; it only records settled value. The escrow, Ed25519, and replay-nullifier guarantees are therefore untouched (`settle_offchain.rs:550-554`).
- **Records the GROSS settled value.** The single-match path passes `total_currency_value` (seller payout + fee + wheeling + loss), which reconciles to the total THBC leaving the buyer escrow rather than the seller's net receipt (`settle_offchain.rs:900-923`). The batch path accumulates `batch_total_value` across all matches and records it with one CPI after the loop (`settle_offchain.rs:1071-1073`, `1191`, `1297-1354`).
- **Wired into both settlement instructions.** Both `settle_offchain_match` and `batch_settle_offchain_match` contain the recording block (`settle_offchain.rs:897`, `1297`).
- **Recorder identity.** `recorder` is the `market_authority` PDA, which the treasury program authorizes as its `settlement_recorder` (the trading `market_authority`).

The currency-mint equality check against `treasury_state.thbc_mint` (`TreasuryCurrencyMismatch`) ensures recording is genuine baht-denominated settlement (`settle_offchain.rs:909-913`, `1305-1309`).

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
| `SettlementThbcMintSet` | authority, thbc_mint, timestamp | `set_settlement_thbc_mint` | `events.rs:59-64` |
| `MaintenanceModeChanged` | authority, maintenance_mode, timestamp | (defined; no in-program emit) | `events.rs:66-71` |
| `LimitOrderSubmitted` | order_id, side, price, amount, timestamp | `submit_limit_order`, `submit_limit_order_sharded` | `events.rs:73-80` |
| `MarketOrderSubmitted` | user, side, amount, timestamp | `submit_market_order` | `events.rs:82-88` |
| `DepthUpdated` | buy_levels, sell_levels, best_bid, best_ask, timestamp | `update_depth` | `events.rs:90-97` |
| `PriceHistoryUpdated` | trade_price, trade_volume, vwap, timestamp | `update_price_history` | `events.rs:99-105` |
| `AuctionCleared` | clearing_price, clearing_volume, matched_orders, timestamp | `clear_auction` | `events.rs:107-113` |
| `EscrowDeposited` | user, mint, amount, timestamp | `deposit_escrow`, `fund_escrow_custodial` | `events.rs:115-121` |
| `EscrowWithdrawn` | user, mint, amount, timestamp | `withdraw_escrow` | `events.rs:123-128` |

The former `BatchExecuted`/`OrderAddedToBatch`/`BatchCancelled` events were removed together with the batch-builder instructions (§4.4).

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
| `ChargesExceedCap` | Network charges (wheeling + loss) exceed the allowed fraction of trade value | `error.rs:61-62` |
| `ChargesExceedValue` | Total deductions (fee + wheeling + loss) exceed the trade value | `error.rs:63-64` |
| `InvalidEscrow` | Escrow account does not match the expected per-user PDA | `error.rs:65-66` |
| `InvalidNullifier` | Nullifier account does not match the expected per-order PDA | `error.rs:67-68` |
| `NullifierUserMismatch` | Nullifier authority does not match the signed order owner | `error.rs:69-70` |
| `TreasuryCurrencyMismatch` | Settlement currency mint is not the treasury THBC mint | `error.rs:71-72` |
| `TreasurySettlementRequired` | This market settles in THBC: the treasury accounts are required to record the settlement | `error.rs:73-74` |
| `InvalidShardId` | Settlement collector shard id out of range (must be < NUM_SETTLE_SHARDS) | `error.rs:75-76` |
| `ZoneCapacityRequired` | Cross-zone settlement requires the ZoneCapacity account (committed_flow ceiling) | `error.rs:79-80` |
| `MatchAlreadySettled` | This match (trade_id) has already been settled on-chain (replay rejected) | `error.rs:81-82` |
| `InvalidTradeNullifier` | Trade nullifier account does not match the expected per-match PDA | `error.rs:83-84` |
| `InvalidRecMint` | REC token account mint is not the governance rec_mint PDA | `error.rs:85-86` |
| `RecAccountOwnerMismatch` | REC token account owner does not match the order seller | `error.rs:87-88` |
| `InsufficientRecBalance` | Seller holds insufficient REC tokens to cover the energy offered | `error.rs:89-90` |
| `InvalidTariffConfig` | Tariff config account is not the canonical PDA / not owned by this program | `error.rs:91-92` |
| `TariffRateExceedsCap` | Combined wheeling + loss tariff rate exceeds the allowed cap | `error.rs:93-94` |
| `AggregatorNotAdmitted` | Settlement payer is not a governance-admitted, active aggregator | `error.rs:95-96` |
| `AggregatorSegmentMismatch` | Settlement payer's aggregator is not admitted for this zone's market segment (Wholesale/Retail) | `error.rs:97-98` |
| `InvalidAggregatorEntry` | Aggregator entry account is not the canonical PDA / malformed | `error.rs:99-100` |

New variants are appended at the **end** of the enum to preserve existing numeric error codes for clients and tests (`error.rs:77-78`).

---

## 9. Testing

The program's auction-clearing arithmetic is covered by Rust unit tests in `#[cfg(test)] mod tests` (`lib.rs:1871-2018`): `test_find_clearing_point_basic` and `test_find_clearing_point_no_intersection` exercise the clearing-point search (`lib.rs:1909-1937`); `test_sell_order_sorting` / `test_buy_order_sorting` verify ascending-sell / descending-buy ordering (`lib.rs:1939-1965`); `test_price_improvement_seller` / `test_price_improvement_buyer` verify uniform-price improvement (`lib.rs:1967-1983`); and `test_full_auction_scenario` runs an end-to-end curve build and clearing (`lib.rs:1985-2017`).

TypeScript integration suites live under `tests/`:

- **`tests/trading.ts`** — `describe("trading-settlement")` (`tests/trading.ts:33`): exercises `execute_atomic_settlement` between a prosumer and consumer (`tests/trading.ts:136`) and reconciliation of stored vs. canonical mint supply (`tests/trading.ts:277`).
- **`tests/escrow_settlement.ts`** — `describe("escrow-settlement")` (`tests/escrow_settlement.ts:53`): covers `deposit_escrow`/`withdraw_escrow` round-trips (`:229`), rejection of withdrawing another user's escrow (`:254`), rejection of a settlement that points a signed buyer at a victim's escrow — the theft test for invariant §5.4 (`:283`), and a successful signed off-chain match between two escrows (`:348`).
- **`tests/settle_offchain_guards_litesvm.ts`** — `describe("trading settle_offchain_match — validation guards (litesvm)")` (`tests/settle_offchain_guards_litesvm.ts:97`): in-process guard suite for the single settle path. It fabricates the mandatory `TariffConfig` at its canonical PDA via `installTariffConfig` (`:253`) so every settle carries the on-chain tariff schedule (§3.7). Covers the treasury currency-mismatch (`:534`), the slippage/side/amount rejections (`:650-669`), capacity (`:670`), full and partial-fill replay (`:682`, `:691`), the **Ed25519 offset-redirection bypass** regression (declared pubkey ≠ signed payload `user`, added in commit `80c86a1`, `tests/settle_offchain_guards_litesvm.ts:733`), the network-charge cap via a poisoned over-cap tariff config (`ChargesExceedCap`, `:786`), the revoked-aggregator operator gate (`AggregatorNotAdmitted`, `:802`), the Wholesale-segment gate — a Retail-admitted aggregator settling in a `segment = 1` zone (`AggregatorSegmentMismatch`, `:817`), the maintenance-mode gate (`MaintenanceMode`, `:834`), and order expiry (`OrderExpired`, `:847`).

Market bootstrap against a live validator is via `scripts/init-market.ts` / `scripts/init-zone-market.ts` (the former lifecycle/load simulation and settlement-driving scripts have been removed). The BlockBench (`blockbench`) and SmallBank/TPC-C (`tpc-benchmark`) suites are separate benchmark crates and do not exercise the `trading` program's settlement path.

To build and run the trading-relevant suites (per the repository `CLAUDE.md`): `anchor test` (full mocha suite under a validator). The Rust unit tests run with `cargo test` from within `programs/trading` once the crate's dependencies are built.
