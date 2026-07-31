# Trading Program

## Abstract

The `trading` program is the on-chain order book and settlement engine of the GridTokenX peer-to-peer (P2P) energy-trading platform, deployed on a permissioned Proof-of-Authority (PoA) Solana cluster. It maintains a global market account, zone-partitioned order books, per-user order accounts, and a contention-reducing sharding layer, and it implements two complementary price-discovery mechanisms: a Continuous Double Auction (CDA) — a market in which buy and sell limit orders are matched continuously as they cross — and a periodic uniform-price batch auction. Its security-critical settlement path is *off-chain-signed match settlement*: an off-chain matching agent submits Ed25519-signed order payloads, and the program verifies the signatures, transfers funds between per-user escrow Program-Derived Accounts (PDAs), and records both a per-order replay nullifier (cumulative fill) and a per-match trade nullifier (replayed `trade_id` rejection), all atomically. For baht-denominated trades the program performs a mandatory, non-custodial Cross-Program Invocation (CPI) into the `treasury` program to record the gross settled value, gated on a per-market policy flag. A separate, feature-gated (`privacy`, compiled out by default) shielded-balance subsystem adds Pedersen-committed private balances with `shield`/`unshield`/`private_transfer` instructions (§4.11). This document specifies the program's identity, state model, instruction set, invariants, cross-program interfaces, events, error codes, and test coverage, with every concrete claim cited to source.

---

## 1. Program Identity

| Property | Value | Source |
| --- | --- | --- |
| Program ID | `CnWDEUhTvSixeLSyViWgAnnu9YouBAYVGcrrFm1s9WcX` | `programs/trading/src/lib.rs:71` |
| Crate name | `trading` | `programs/trading/Cargo.toml:2,9` |
| Crate version | `0.1.1` | `programs/trading/Cargo.toml:3` |
| Anchor framework | `anchor-lang` / `anchor-spl` `1.0.0` | `programs/trading/Cargo.toml:28-29` |
| `declare_id!` location | `programs/trading/src/lib.rs:71` | — |

The program ID is declared by `declare_id!("CnWDEUhTvSixeLSyViWgAnnu9YouBAYVGcrrFm1s9WcX")` (`lib.rs:71`). The crate is built both as a Solana BPF dynamic library and as a linkable Rust library (`crate-type = ["cdylib", "lib"]`, `Cargo.toml:8`).

### Dependencies

The program declares two intra-repository path dependencies, both with the `cpi` feature enabled so their CPI client modules are generated:

| Dependency | Declaration | Purpose |
| --- | --- | --- |
| `governance` | `governance = { path = "../governance", features = ["cpi"] }` (`Cargo.toml:48`) | Supplies `GovernanceConfig` and `ErcCertificate`/`ErcStatus` types re-exported at `lib.rs:21`; operational-mode, ERC certificate, and admitted-aggregator checks. |
| `treasury` | `treasury = { path = "../treasury", features = ["cpi"] }` (`Cargo.toml:49`) | Optional `record_settlement` CPI for baht-denominated (THBC) settlement recording. |

The `cpi` feature of the `trading` crate itself implies `no-entrypoint` (`Cargo.toml:12`). Other relevant features: `localnet` enables the `compute-debug` compute-unit profiling crate (`Cargo.toml:20,38`); when `localnet` is disabled, crate-local no-op `compute_fn!` / `compute_checkpoint!` macros are defined instead (`lib.rs:82-91`).

The **`privacy`** feature (OFF by default) compiles in the shielded-balance subsystem (§4.11): `privacy = ["dep:solana-curve25519", "dep:curve25519-dalek", "dep:sha2"]` (`Cargo.toml:22-25`). The optional dependencies — `solana-curve25519` (ristretto point ops via curve25519 syscalls on-chain), `curve25519-dalek` (scalar arithmetic), and `sha2` (the Fiat–Shamir challenge hash) — are version-pinned to the `solana-zk-token-sdk` 2.3.x family so the Pedersen generators match the off-chain wasm-zk prover (`Cargo.toml:40-47`). A host-only dev-dependency, `solana-zk-sdk`, builds real ZK ElGamal Proof Program context-state accounts for the `zk_verify` unit tests and is not linked into the on-chain binary (`Cargo.toml:56-59`).

The release profile forces checked arithmetic: `[profile.release] overflow-checks = true` (`Cargo.toml:53-54`), because `cargo build-sbf` otherwise defaults to silent wrapping.

---

## 2. System Role

The `trading` program is the marketplace and settlement layer for energy (GRID/GRX) trades. Its responsibilities are:

1. **Order book and CDA matching.** Limit orders are submitted via `submit_limit_order` (`lib.rs:267`) and market orders via `submit_market_order` (`lib.rs:291`). The CDA design is documented inline: a buy order matches when its price is at or above the best ask, and a sell order when its price is at or below the best bid (`submit_limit_order.rs:77-81`). The on-chain `submit_limit_order` initializes the order and emits a `LimitOrderSubmitted` event for off-chain matching agents (`submit_limit_order.rs:103-110`); actual crossing is executed by separate match/settlement instructions.

2. **Periodic uniform-price batch auction.** `clear_auction` (`lib.rs:344`) builds aggregate supply and demand curves, locates the clearing price via `find_clearing_point` (`lib.rs:1054`), and matches all eligible orders at a single uniform clearing price (`lib.rs:344-508`). The resulting matches are then emitted as bookkeeping events by `execute_auction_matches` (`lib.rs:510`) — that instruction moves **no tokens** (its context carries no escrow accounts); actual token settlement of a uniform-auction match goes through the offchain settlement path (`settle_offchain_match` / `execute_atomic_settlement`).

3. **Sharded order submission and matching.** To avoid write-lock contention on global accounts, orders may be submitted to per-shard accounts via `submit_limit_order_sharded` (`lib.rs:283`) and matched via `sharded_match_orders` (`lib.rs:196`), which writes to a `ZoneMarketShard` rather than to the global `ZoneMarket` (`sharded_match_orders.rs:85-89`) and takes `market`/`zone_market` strictly **read-only** (`sharded_match_orders.rs:13-17`). The shard staging counters are periodically drained back into `ZoneMarket` totals by the admin-gated `aggregate_shards` reconciler (`lib.rs:931`, `instructions/aggregate_shards.rs`).

4. **Off-chain-signed match settlement.** The custody-bearing settlement path is `settle_offchain_match` (wrapper `lib.rs:855`, implemented in `settle_offchain.rs:669`) and its batch form `batch_settle_offchain_match` (`lib.rs:245`, `settle_offchain.rs:1006`). An off-chain matcher — whose paying wallet must be a governance-admitted, active aggregator (§5.14) — supplies two Ed25519-signed order payloads; the program verifies both signatures against the Instructions sysvar, computes the network charges from the on-chain `TariffConfig` schedule (§3.7), transfers currency and energy between escrow PDAs, and updates replay nullifiers.

5. **Escrow custody.** Per-user escrow PDA token accounts hold funds for the off-chain settlement path. They are funded by `deposit_escrow` and drained by `withdraw_escrow` (`escrow.rs:57,198`); their SPL authority is the global `market_authority` PDA.

6. **Zone-partitioned markets.** Order-book depth and capacity are tracked per geographic zone in `ZoneMarket` accounts, sharded out of the global `Market` to prevent cross-zone write contention (`zone_market.rs:9-11`). Cross-zone (wheeling) flow is throttled against a transmission `capacity` via the per-zone `ZoneCapacity` counter (`settle_offchain.rs:738-751`, `zone_market.rs:41-54`).

7. **Replay protection.** Each settled off-chain order is tracked by an `OrderNullifier` PDA keyed by the order's owner and UUID (`nullifier.rs:3-9`), preventing a signed payload from being settled beyond its energy amount; a per-match `TradeNullifier` PDA keyed by the matcher's `trade_id` additionally blocks re-settling the same match (`nullifier.rs:15-30`).

8. **Shielded balances (`privacy` feature, compiled out by default).** When built with the `privacy` cargo feature, the program additionally exposes `shield`, `unshield`, and `private_transfer` (`lib.rs:213,221,229`): per-`(owner, mint)` Pedersen-committed balances backed by a per-mint pool vault, with on-chain conservation and proof-of-knowledge verification in `zk_verify.rs` (§4.11).

All state-mutating instructions gate on the governance operational mode: they call `get_governance_config(...).is_operational()` and reject with `MaintenanceMode` otherwise (e.g. `create_sell_order.rs:33-36`, `create_buy_order.rs:27-30`; helper at `utils.rs:5-12`). The off-chain settle paths, whose contexts sit at the BPF stack limit, perform the equivalent check in-handler against a `governance_config` account threaded through `remaining_accounts` (`settle_offchain.rs:75-86`).

---

## 3. State Model

The program's persistent state is split between **zero-copy** accounts (declared `#[account(zero_copy)] #[repr(C)]`, accessed through `AccountLoader`) and **regular** Borsh-serialized accounts (declared `#[account]`, accessed through `Account`). Zero-copy accounts reserve `8 + size_of::<T>()` bytes (Anchor discriminator plus the Pod struct).

### 3.1 `Market` (zero-copy, global singleton)

Defined at `market.rs:6-62`. PDA seed: `[b"market"]` (`initialize_market.rs:6`). There is a single global market; the escrow and `market_authority` seeds carry no market key, and the code documents this single-market invariant (`escrow.rs:19-21`).

| Field | Type | Notes | Source |
| --- | --- | --- | --- |
| `authority` | `Pubkey` | Market admin; checked by `has_one`/`require_keys_eq` for param updates. | `market.rs:9` |
| `total_volume` | `u64` | Cumulative matched volume. | `market.rs:10` |
| `created_at` | `i64` | Creation timestamp. | `market.rs:11` |
| `last_clearing_price` | `u64` | Most recent clearing price. | `market.rs:12` |
| `volume_weighted_price` | `u64` | VWAP from price history. | `market.rs:13` |
| `active_orders` | `u32` | Open order count. | `market.rs:14` |
| `total_trades` | `u32` | Cumulative trade count. | `market.rs:15` |
| `market_fee_bps` | `u16` | Fee in basis points (initialized to 25). | `market.rs:16`, `initialize_market.rs:23` |
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

**Settlement-recording policy.** The `settlement_thbc_mint` / `has_settlement_thbc_mint` pair encodes a per-market policy: once set via `set_settlement_thbc_mint` (`lib.rs:846`), any off-chain settlement in that currency MUST pass the treasury accounts (see §4 and §5). The fields were carved from former depth padding so the account size is unchanged and accounts predating the field read it as 0, i.e. policy off (`market.rs:42-49`).

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

`Order` is defined at `order.rs:6-20`. PDA seed: `[b"order", authority.key(), &order_id_val.to_le_bytes()]` (e.g. `create_sell_order.rs:13`, `create_buy_order.rs:12`, `submit_limit_order.rs:11`).

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

`TradeRecord` (`order.rs:24-38`) records a matched pair. PDA seed: `[b"trade", buy_order.key(), sell_order.key()]` (`match_orders.rs:20`, `sharded_match_orders.rs:24`). Fields: `sell_order`, `buy_order`, `seller`, `buyer`, `amount`, `price_per_kwh`, `total_value`, `fee_amount`, `executed_at`. Both `match_orders` and `sharded_match_orders` now populate the full record (the sharded path was brought to parity in commit `77bdfce`, `sharded_match_orders.rs:91-101`). Note that `TradeRecord.total_value` on these discovery paths is the **raw** `amount * price` product with **no** `/1e9` normalization — informational only, no tokens move, and the CDA verifier (`scripts/verify-price-models-onchain.ts`) asserts this raw scale, so it must not be "normalized" to 6-decimal currency (`order.rs:31-35`; see the dual-scale contract in §7).

`OrderType` is `{ Sell = 0, Buy = 1 }` (`order.rs:42-45`). `OrderStatus` is `{ Active = 0, PartiallyFilled = 1, Completed = 2, Cancelled = 3, Expired = 4 }` (`order.rs:48-54`). Note that the on-the-wire `side` parameter and the off-chain payload use the inverse convention `0 = Buy, 1 = Sell` (e.g. `lib.rs:267-277`, `settle_offchain.rs:394`).

### 3.4 `ZoneMarket` and `ZoneMarketShard` (zero-copy)

`ZoneMarket` (`zone_market.rs:12-37`). PDA seed: `[b"zone_market", market.key(), &zone_id.to_le_bytes()]` (`initialize_zone_market.rs:8`).

| Field | Type | Notes | Source |
| --- | --- | --- | --- |
| `market` | `Pubkey` | Parent market. | `zone_market.rs:15` |
| `zone_id` | `u32` | Geographic zone. | `zone_market.rs:16` |
| `num_shards` | `u8` | Shard count for this zone. | `zone_market.rs:17` |
| `segment` | `u8` | Market segment: 0 = Retail (MEA/PEA), 1 = Wholesale (EGAT). Gates which aggregators may settle here (§5.14). Carved from `_padding1`; size unchanged. | `zone_market.rs:18-22` |
| `_padding1` | `[u8; 2]` | — | `zone_market.rs:23` |
| `total_volume` | `u64` | Reconciled from shards by `aggregate_shards` (§4.3). | `zone_market.rs:24` |
| `active_orders` | `u32` | — | `zone_market.rs:25` |
| `total_trades` | `u32` | Reconciled from shards by `aggregate_shards` (§4.3). | `zone_market.rs:26` |
| `buy_side_depth_count` | `u8` | — | `zone_market.rs:27` |
| `sell_side_depth_count` | `u8` | — | `zone_market.rs:28` |
| `_padding2` | `[u8; 6]` | — | `zone_market.rs:29` |
| `last_clearing_price` | `u64` | — | `zone_market.rs:30` |
| `capacity` | `u64` | Transmission capacity ceiling (base units); read-only on the settle path. | `zone_market.rs:31` |
| `committed_flow` | `u64` | Legacy counter; the live cross-zone counter is `ZoneCapacity.committed_flow`. | `zone_market.rs:32` |
| `buy_side_depth` | `[PriceLevel; 10]` | Bid depth (240 bytes). | `zone_market.rs:35` |
| `sell_side_depth` | `[PriceLevel; 10]` | Ask depth (240 bytes). | `zone_market.rs:36` |

`MAX_DEPTH_LEVELS = 10` (`zone_market.rs:7`); the cap keeps `update_depth` Vec payloads within Solana's 1,232-byte transaction limit (`zone_market.rs:4-7`).

`ZoneCapacity` (`zone_market.rs:47-54`). PDA seed: `[b"zone_capacity", zone_market.key()]` (`initialize_zone_capacity.rs:11`), created by `initialize_zone_capacity` (`lib.rs:144`). Holds the cross-zone `committed_flow` counter split OUT of `ZoneMarket` so the settle hot path keeps `ZoneMarket` read-only: only cross-zone (wheeling) settlements pass this account `mut` and bump the counter; intra-zone settles omit it and do not serialize on the zone book (`zone_market.rs:41-46`). Fields: `zone_market` (parent binding), `committed_flow`, `bump`, `_padding[7]`.

`ZoneMarketShard` (`zone_market.rs:56-67`). PDA seed: `[b"zone_shard", zone_market.key(), &[shard_id]]` (`initialize_zone_shard.rs:18`). Fields: `shard_id`, `_padding1[7]`, `zone_market`, `volume_accumulated`, `trade_count`, `_padding2[4]`, `last_clearing_price`, `last_update`. `volume_accumulated`/`trade_count` are **staging counters**: hot paths accumulate into them and `aggregate_shards` drains them back to zero when folding the deltas into `ZoneMarket` (§4.3); `last_clearing_price`/`last_update` stay on the shard as observability fields (`aggregate_shards.rs:94-97`).

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

Defined at `zone_config.rs:3-15`. PDA seed: `[b"zone_config", zone_id.to_le_bytes()]` (`initialize_zone_config.rs:11`). Space: `8 + 128` (`initialize_zone_config.rs:8-12`; struct totals 125 bytes per the comment at `zone_config.rs:15`). Fields: `zone_id` (`u32`), `incentive_multiplier_bps` (`u64`, 10000 = 1.0×), `wheeling_charge_bps` (`u64`), `maintenance_mode` (`u8`), `authority` (`Pubkey`), `last_updated` (`i64`), `reserved1`/`reserved2` (`[u8; 32]` each).

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

### 3.8 Privacy state (`privacy` feature): `PrivateBalance`, `PrivacyNullifier`, `BalanceProof`

The shielded-balance subsystem (§4.11) adds two regular `#[account]` types in `state/private_balance.rs`, compiled only under the `privacy` cargo feature (`state/mod.rs:10-11`):

**`PrivateBalance`** (`private_balance.rs:13-23`) — the shielded balance for one `(owner, mint)` pair: a Pedersen commitment `C = balance·G + b·H` hiding the owner's private token balance. PDA seed: `[b"priv_bal", owner, mint]` (`private_shield.rs:56`, `private_transfer.rs:14,26`). Space: `LEN = 8 + 32 + 32 + 32 + 1` (`private_balance.rs:22`). Fields: `owner` (`Pubkey`), `mint` (`Pubkey`), `commitment` (`[u8; 32]`, compressed ristretto), `bump`. A freshly initialized account's zeroed `commitment` is the canonical encoding of the identity point — a commitment to 0 with blinding 0 — so the homomorphic first credit is correct (`private_balance.rs:6-9`).

**`PrivacyNullifier`** (`private_balance.rs:28-35`) — the per-transfer replay guard for shielded transfers, distinct from the settlement `OrderNullifier`/`TradeNullifier`. PDA seed: `[b"priv_null", nullifier]` (`private_transfer.rs:36`); `LEN = 8 + 1`. Existence of the PDA means that nullifier has been spent; the `init` constraint makes a replay fail at account creation (`private_transfer.rs:31-39`).

**`BalanceProof`** (`state/mod.rs:33-36`) — the instruction-argument type carrying the Okamoto proof-of-knowledge of the amount commitment's opening: `challenge: [u8; 32]`, `response: [u8; 64]` (= `z_v ‖ z_r`). It is deliberately **un-gated** (declared in `state/mod.rs`, not in the `privacy`-gated modules): Anchor's `idl-build` generates argument glue for every `#[program]` function regardless of its `#[cfg]`, so the type must exist even when `privacy` is off or `anchor build` fails with E0425 (`state/mod.rs:27-31`, commit `e76edd9`). It is re-exported at `lib.rs:16`.

---

## 4. Instruction Set

This section specifies every instruction in the `#[program] mod trading` (`lib.rs:96-1047`) and its delegated handlers. Most handler bodies live in `instructions/*.rs` with thin `compute_fn!`-wrapped wrappers in `lib.rs`; `clear_auction`, `execute_auction_matches`, and `execute_atomic_settlement` remain inline in `lib.rs`. For brevity, the ubiquitous `governance_config` operational check (`is_operational()` → `MaintenanceMode`) is noted once per instruction rather than re-described.

### 4.1 Initialization

**`initialize_program`** (`lib.rs:110` → `initialize_program.rs:9`). No-op marker emitting a log. Signer: `authority`.

**`initialize_market`** (`lib.rs:116` → `initialize_market.rs:13`, args `num_shards: u8`). Signer: `authority` (becomes `market.authority`). Initializes the global `Market` PDA (`init`, seed `[b"market"]`, `initialize_market.rs:6`) with `market_fee_bps = 25`, `min_price_per_kwh = 1`, `clearing_enabled = 1`, default `BatchConfig` (disabled), and zeroed price history (`initialize_market.rs:13-49`). Emits `MarketInitialized`.

**`initialize_zone_market`** (`lib.rs:122` → `initialize_zone_market.rs:15`, args `zone_id: u32, num_shards: u8, capacity: u64, segment: u8`). Signer: `authority`. Initializes a `ZoneMarket` PDA bound to `market` with the given capacity and market segment (0 = Retail, 1 = Wholesale — see §5.14); zeroes both depth arrays. No event.

**`initialize_zone_capacity`** (`lib.rs:144` → `initialize_zone_capacity.rs:23`). Signer: `payer`. One-time creation of the per-zone `ZoneCapacity` PDA (§3.4) that carries the cross-zone `committed_flow` counter.

**`initialize_zone_config`** (`lib.rs:100`, args `zone_id, incentive_multiplier_bps`). Signer: `authority`. Initializes a `ZoneConfig` PDA (`lib.rs:100-108`, context `initialize_zone_config.rs:6-20`).

**`initialize_market_shard`** (`lib.rs:906` → `initialize_shard.rs:28`, arg `shard_id: u8`). Signer: `payer`. Initializes a `MarketShard` PDA (seed `[b"market_shard", market, shard_id]`).

**`initialize_zone_market_shard`** (`lib.rs:134` → `initialize_zone_shard.rs:28`, arg `shard_id: u8`). Signer: `payer`. Initializes a `ZoneMarketShard` PDA (seed `[b"zone_shard", zone_market, shard_id]`).

**`initialize_collectors`** (`lib.rs:914` → `escrow.rs:286`). Signer: `payer`. One-time `init` of the three collector PDA token accounts (`fee_collector`, `wheeling_collector`, `loss_collector`) for a given `currency_mint`, all with SPL authority = `market_authority` (`escrow.rs:248-279`). **`initialize_sharded_collectors`** (`lib.rs:920` → `escrow.rs:346`, arg `shard_id`) creates the per-shard collector PDAs (seeds suffixed with `&[shard_id]`, `escrow.rs:308-330`) used by the batch settle path, and **`sweep_collectors`** (`lib.rs:937` → `escrow.rs:393`) consolidates a shard's balances into the canonical collectors.

### 4.2 Order submission

**`create_sell_order`** (`lib.rs:150` → `create_sell_order.rs:27`, args `order_id_val, energy_amount, price_per_kwh, expires_at`) and **`create_buy_order`** (`lib.rs:162` → `create_buy_order.rs:21`, args `order_id_val, energy_amount, max_price_per_kwh, expires_at`). Signer: `authority`. Preconditions: operational; amount > 0; price > 0; price within `[min_price_per_kwh, max_price_per_kwh]` (the upper bound only when nonzero) (`create_sell_order.rs:33-53`, `create_buy_order.rs:27-47`). `create_sell_order` additionally validates an optional `ErcCertificate` (Energy/Renewable Certificate): status `Valid`, not expired, `validated_for_trading`, `energy_amount <= erc.energy_amount`, **and the certificate's `owner` must equal the order authority** — a validated certificate alone is not enough; without the owner bind any user's certificate would satisfy the gate (`ErcOwnerMismatch`, `create_sell_order.rs:56-81`). It also supports an opt-in fungible-REC balance gate via `remaining_accounts[0]` (`create_sell_order.rs:83-106`): when the seller appends their REC token account, it must belong to the governance `[b"rec_mint"]` mint (`InvalidRecMint`), be owned by the seller (`RecAccountOwnerMismatch`), and hold at least `energy_amount × 1_000` base units — the 6-decimal REC mint's kWh equivalent (`InsufficientRecBalance`); omitting the account skips the gate (backwards compatible). Effects: `init` the `Order` PDA, set fields, store the caller's `expires_at` via `utils::validate_order_expiry` (`utils.rs:34`), increment `zone_market.active_orders` (`create_sell_order.rs:123-126`). Emits `SellOrderCreated` / `BuyOrderCreated`.

**Order expiry is the caller's, not the program's.** Every order-creating instruction here used to stamp `expires_at = clock.unix_timestamp + 86400` and ignore whatever lifetime the submitting client had agreed to — while off-chain the trading service resolved a real expiry per order (`trading_core::order_policy::resolve_expires_at`, 15-min default) and reaped the book on it. The two records disagreed by construction. `expires_at` is now a trailing `i64` argument on `create_sell_order`, `create_buy_order`, `record_order_custodial`, `submit_limit_order` and `submit_limit_order_sharded`, validated by `validate_order_expiry` (`utils.rs:34`): **`0` means no expiry** — the same sentinel `settle_offchain_match` applies to a signed payload (`settle_offchain.rs:724-725`) — and any other value must be strictly in the future, else `OrderExpired` (6023). There is deliberately no upper bound on chain; capping client lifetimes is the off-chain edge's job (`ORDER_MAX_TTL_SECS`), and a second, different horizon here would reject orders the platform itself considers valid. Verified against the compiled binary by `tests/order_expiry_litesvm.ts` (5 cases: value stored verbatim on both the direct and custodial paths, the `0` sentinel, past/present rejection with no account created, far-future accepted) — a green build says nothing about what a handler writes into an account.

**`record_order_custodial`** (`lib.rs:179` → `record_order_custodial.rs:26`, args `order_id_val, user: Pubkey, is_buy, energy_amount, price_per_kwh, expires_at`). Signer: `funder` (the platform), who pays rent; the non-signing `user` is stored as the order's buyer or seller per `is_buy`. Custodial analogue of `create_{buy,sell}_order`: the `Order` PDA is seed-bound to `[b"order", user, order_id_val]` (`record_order_custodial.rs:12`), and the same operational/amount/price-bounds validation applies (`record_order_custodial.rs:34-52`); off-chain authorization is enforced by Chain Bridge RBAC (trading-service role only) (`lib.rs:172-176`). Effects mirror the direct paths (store the trading service's own `expires_at` — `record_order_custodial.rs:78` — and increment `zone_market.active_orders`); no event is emitted. This is the path the trading service uses, so the PDA it records in `trading_orders.order_pda` and the row itself now state the same lifetime.

**`submit_limit_order`** (`lib.rs:270` → `submit_limit_order.rs:22`, args `order_id_val, side, amount, price, expires_at`). Signer: `authority`. CDA limit order. Validates operational, amount/price > 0, and price bounds (`submit_limit_order.rs:29-52`); `init`s the order with the appropriate side; increments `market.active_orders`; emits both the side-specific order event and `LimitOrderSubmitted` for off-chain matchers (`submit_limit_order.rs:85-110`). Note `side` here is `0 = Buy, 1 = Sell`.

**`submit_limit_order_sharded`** (`lib.rs:283` → `submit_sharded_limit_order.rs:29`, args `order_id_val, side, amount, price, shard_id, expires_at`). Signer: `authority`. Initializes the order and touches the `ZoneMarketShard.last_update` rather than the global market; emits `LimitOrderSubmitted` (`submit_sharded_limit_order.rs:65`). The `zone_shard` is bound by seed `[b"zone_shard", zone_market, shard_id]` (`submit_sharded_limit_order.rs:20`); `zone_market` is passed read-only.

**`submit_market_order`** (`lib.rs:291` → `submit_market_order.rs:18`, args `side, amount`). Signer: `authority`. Requires opposite-side liquidity (`zone_market.sell_side_depth_count > 0` for buys, `buy_side_depth_count > 0` for sells), else `InsufficientLiquidity` (`submit_market_order.rs:35-44`); emits `MarketOrderSubmitted` for an off-chain agent to fill (`submit_market_order.rs:48`).

### 4.3 Matching

**`match_orders`** (`lib.rs:190` → `match_orders.rs:29`, arg `match_amount`). Signer: `authority`. Matches one buy against one sell order. Preconditions: `match_amount > 0` (`InvalidAmount`, `match_orders.rs:35`); both orders `Active`/`PartiallyFilled` (`match_orders.rs:43-52`); `buy.price >= sell.price` (`PriceMismatch`, `match_orders.rs:53-56`). Clearing price is the seller's price; `actual_match_amount = min(match_amount, buy_remaining, sell_remaining)` (`match_orders.rs:60`); updates `filled_amount`/`status`, `init`s a `TradeRecord`, updates `zone_market` stats; emits `OrderMatched` (`match_orders.rs:98`) with the discovery-path raw `total_value = amount × price` (no `/1e9`; §7).

**`sharded_match_orders`** (`lib.rs:196` → `sharded_match_orders.rs:33`, args `match_amount, shard_id`). Signer: `authority`. Same matching logic as `match_orders` — including the `match_amount > 0` guard, so a zero-amount call cannot init a zero-trade `TradeRecord`, bump `trade_count`, or flip an `Active` order to `PartiallyFilled` (`sharded_match_orders.rs:39-41`) — but it updates a `ZoneMarketShard` staging counter instead of the global `ZoneMarket` (`sharded_match_orders.rs:85-89`). `market` and `zone_market` are deliberately **read-only** in its context: taking them `mut` would write-lock the shared zone accounts and serialize every "sharded" match, defeating the shard's purpose (`sharded_match_orders.rs:13-17`; write-locks dropped in commits `95e7cdd`/`1ee4417`). The `TradeRecord` is fully populated (seller/buyer/total_value/fee, `sharded_match_orders.rs:91-101`) and `OrderMatched` is emitted (`sharded_match_orders.rs:103-114`). The handler is `compute_fn!`-wrapped for CU profiling like the unsharded path (`sharded_match_orders.rs:34`, `match_orders.rs:30`). The `shard_id` parameter is unused inside the handler (`_shard_id`); shard selection is enforced by the account seed constraint (`sharded_match_orders.rs:18`).

**`aggregate_shards`** (`lib.rs:931` → `aggregate_shards.rs:44`). Signer: `authority`, which must equal `market.authority` (`UnauthorizedAuthority`, `aggregate_shards.rs:49-54`). The periodic admin reconciler that folds the per-shard staging counters back into `ZoneMarket.total_volume`/`total_trades`, which the sharded hot paths leave stale on purpose (SKILL.md invariant #3). Context: read-only `market` (canonical `[b"market"]` seed, only the authority gate reads it), writable `zone_market` constrained to belong to `market` (`aggregate_shards.rs:33-42`); the shards ride in `remaining_accounts` (writable), each loaded through `AccountLoader<ZoneMarketShard>` (owner + discriminator checked) and required to belong to the given `zone_market` (`ShardZoneMismatch`, `aggregate_shards.rs:70-74`). Semantics are **DRAIN, not snapshot** (unlike `registry::aggregate_shards`, which sets global = Σ shards): `match_orders` and `clear_auction` also increment `ZoneMarket` totals directly, so a snapshot would clobber their contributions — instead each shard's accumulated counters are checked-added to the zone totals and then zeroed (`aggregate_shards.rs:18-22`, `87-98`, `101-108`). Any subset of shards may be passed and a re-run after a drain adds zero; passing the same shard twice in one call is rejected via a 256-bit `shard_id` bitmask (`DuplicateShard`, `aggregate_shards.rs:65-79`). `zone_market.last_clearing_price` is refreshed best-effort from the most recently updated shard that had trades (`aggregate_shards.rs:81-85`, `109-111`). Not reconciled: `active_orders` (shards do not track order lifecycle) and the informational shard fields `last_clearing_price`/`last_update` (`aggregate_shards.rs:30-32`). Emits `ShardsAggregated` (`aggregate_shards.rs:113-119`).

**`clear_auction`** (`lib.rs:344`, args `sell_orders: Vec<AuctionOrder>, buy_orders: Vec<AuctionOrder>`). Returns `ClearAuctionResult`. Sorts sells ascending and buys descending by price (`lib.rs:365-368`), builds supply and demand curves (`lib.rs:371-393`), finds the clearing point (`lib.rs:395`), then matches eligible orders (sells priced ≤ clearing, buys priced ≥ clearing) at the uniform clearing price, emitting an `OrderMatched` per pair (`lib.rs:400-472`; discovery-path raw `total_value`, `lib.rs:445-447`). Updates market/zone aggregates and emits `AuctionCleared` (`lib.rs:474`). Errors: empty input → `InvalidAmount` (`lib.rs:360-361`); no intersection → `InvalidPrice`/`InvalidAmount` from `find_clearing_point` (`lib.rs:397-398`, `1073-1074`).

**`execute_auction_matches`** (`lib.rs:510`, args `matches: Vec<AuctionMatch>, clearing_price`). Signer: `authority`. Discovery bookkeeping only, **not** settlement: its context is `ClearAuctionContext`, which carries no escrow/mint/token accounts, so token movement is structurally impossible (`lib.rs:493-508`). Iterates the matches produced by `clear_auction`, computes per-match fee `trade_value * market_fee_bps / 10000` with `checked_mul` (overflow → `Overflow`, `lib.rs:534-540`), emits `OrderMatched` per match (`lib.rs:542`; informational raw-scale `total_value`/`fee_amount`, §7), and bumps market aggregates. Empty input → `InvalidAmount` (`lib.rs:527`). Actual token settlement of a uniform-auction match goes through `settle_offchain_match`/`execute_atomic_settlement`; this instruction currently has no on-chain/test/client caller (`lib.rs:504`).

### 4.4 Batch processing (removed)

The former batch-builder instructions (`add_order_to_batch`, `execute_batch`, `cancel_batch`) were dead code (`batch_config.enabled` was never set) and were **removed** in commit `85a8702`, together with their events. The `Market.batch_config`/`current_batch` fields remain solely for zero-copy layout stability (§3.1). Off-chain match batching is instead served by `batch_settle_offchain_match` (§4.7).

### 4.5 Order lifecycle

**`cancel_order`** (`lib.rs:204` → `cancel_order.rs:19`). Signer: `authority` must equal the order owner (buyer for buy orders, seller for sell orders), else `UnauthorizedAuthority`; order must be `Active`/`PartiallyFilled`, else `OrderNotCancellable` (`cancel_order.rs:34-44`). Sets status `Cancelled`, decrements `zone_market.active_orders` (`cancel_order.rs:45`); emits `OrderCancelled` (`cancel_order.rs:47`).

### 4.6 Market depth and price history

**`update_depth`** (`lib.rs:303` → `update_depth.rs:20`, Vec args for buy/sell prices and amounts). Signer: market `authority` (`has_one`, `update_depth.rs:9`). Validates lengths ≤ `MAX_DEPTH_LEVELS` and that price/amount vectors align (`update_depth.rs:36-51`); rewrites the depth arrays; emits `DepthUpdated` (`update_depth.rs:87`).

**`update_price_history`** (`lib.rs:317` → `update_price_history.rs:18`, args `trade_price, trade_volume`). Signer: market `authority` (`has_one`, `update_price_history.rs:9`). O(1) ring-buffer insert at `price_history_head`, recompute VWAP across valid entries; emits `PriceHistoryUpdated` (`update_price_history.rs:65`).

### 4.7 Settlement

**`execute_atomic_settlement`** (`lib.rs:566`, args `amount, price, trade_id: [u8;16]`). Signers: `escrow_authority` and `market_authority` (`lib.rs:1011-1013`); `market_authority.key()` must equal `market.authority` (`lib.rs:582-586`). A `TradeNullifier` PDA keyed by `trade_id` is `init`ed in the context, so a replayed match reverts (`lib.rs:980-988`). Slippage protection requires `sell.price <= price <= buy.price` (`SlippageExceeded`, `lib.rs:590-598`). Wheeling and loss are **not caller arguments**: the context carries the seed-bound `tariff_config` account (`lib.rs:1018-1019`) and the handler computes `wheeling = amount × wheeling_rate_per_kwh / 1e9` (flat per-kWh) and `loss = total_value × loss_bps / 10000` from it (`lib.rs:615-645`). Transfers currency (fee, net seller, wheeling, loss) from the buyer's currency escrow and energy from the seller's energy escrow, via `transfer_checked` over two token programs (`lib.rs:652-724`); updates order fill/status and market stats; emits `OrderMatched` (`lib.rs:814`). The full handler spans `lib.rs:566-828` with its inline context at `lib.rs:966-1021`.

**`settle_offchain_match`** (`lib.rs:855` → `settle_offchain.rs:669`, args `buyer_payload, seller_payload: OffchainOrderPayload`, `match_amount, match_price, trade_id: [u8;16]`). The core off-chain-signed settlement instruction. Signer: `payer` (the matching agent, which must be a governance-admitted aggregator — below). See §4.10 for the signing model. Named accounts (`settle_offchain.rs:413-558`): the singleton `market` (seed `[b"market"]`), a **read-only** `zone_market` constrained to belong to that market, two `OrderNullifier` PDAs (`init_if_needed`, keyed by each payload's user + order_id), `currency_mint`/`energy_mint`, the `market_authority` PDA (escrow signer), two token programs, four per-user escrow token accounts (currency and energy for both buyer and seller, each seed `[b"escrow", user, mint]`), the three collector PDAs, a `market_shard` and `zone_shard` selected by `get_shard_id(payer, num_shards)` (`settle_offchain.rs:528-540`), the Instructions sysvar, and **optional** `treasury_program`/`treasury_state` (`settle_offchain.rs:555-557`). Because the context is at the BPF stack ceiling, further accounts ride in `remaining_accounts`: `[0]` the governance `governance_config`, `[1]` the per-match `TradeNullifier`, `[2]` the **mandatory** `tariff_config`, `[3]` the **mandatory** payer `AggregatorEntry`, `[4]` the `ZoneCapacity` PDA (mandatory iff the match is cross-zone, `settle_offchain.rs:741-745`), then the optional REC-transfer group (`settle_offchain.rs:879-894`).

Preconditions, in order: **governance maintenance gate first** — before any signature work the handler binds `remaining_accounts[0]` to the canonical `[b"governance_config"]` governance PDA and rejects with `MaintenanceMode` (or `InvalidGovernanceAccount`) when the platform is paused (`settle_offchain.rs:678-686`, helper `require_governance_operational` at `settle_offchain.rs:75-86`). Then the **operator gate** (role-map fixes #8b/#6): `payer` must own an active governance `AggregatorEntry` PDA (`[b"aggregator", payer]`, owned by `governance::ID`), else `AggregatorNotAdmitted`; and when the zone's `segment` is Wholesale (1) the aggregator's own segment byte must also be Wholesale, else `AggregatorSegmentMismatch` — Retail zones accept any admitted aggregator (`settle_offchain.rs:693-703`, helper `require_admitted_aggregator` at `settle_offchain.rs:145-171`). Then: valid buyer and seller Ed25519 signatures (`settle_offchain.rs:705-714`); `match_amount > 0`; `seller.price <= match_price <= buyer.price` (`SlippageExceeded`); `buyer.side == 0` and `seller.side == 1` (`InvalidOrderSide`); neither payload expired (`OrderExpired`, where `expires_at == 0` means no expiry) (`settle_offchain.rs:716-725`); cross-zone capacity not exceeded when either leg is remote, tracked on the writable `ZoneCapacity` counter (`CapacityExceeded`, `settle_offchain.rs:738-751`); `match_amount` within both nullifier-tracked remaining amounts (`InvalidAmount`, `settle_offchain.rs:753-755`); and the per-match `TradeNullifier` claim, which reverts `MatchAlreadySettled` on a replayed `trade_id` (`settle_offchain.rs:757-773`).

Effects: `total_currency_value = match_amount × match_price / 1e9` — a u128 `checked_mul` scaled by `ENERGY_AMOUNT_DECIMALS_DIVISOR` so 9-decimal energy × 6-decimal price lands in 6-decimal currency; overflow rejects rather than saturates, to avoid paying out a clamped value (`settle_offchain.rs:781-787`, `lib.rs:23-28`); `market_fee = total * market_fee_bps / 10000`. The network charges come from the on-chain tariff schedule, **not** caller args: `tariff_rates` raw-reads `remaining_accounts[2]` as the canonical `[b"tariff_config"]` PDA (`settle_offchain.rs:128-143`), then `wheeling_charge_val = match_amount × wheeling_rate_per_kwh / 1e9` (flat per-kWh) and `loss_cost_val = total × loss_bps / 10000` (`settle_offchain.rs:790-803`). The seller's net proceeds are computed by `net_seller_after_charges(total, market_fee, wheeling, loss)` (`settle_offchain.rs:804`, defined `settle_offchain.rs:112-126`), which keeps two defense-in-depth bounds: combined network charges `wheeling + loss` must not exceed `MAX_NETWORK_CHARGE_BPS = 2000` (20%) of the trade value (`ChargesExceedCap`), and total deductions `fee + wheeling + loss` must not exceed the trade value (`ChargesExceedValue`). It returns `net_seller_amount = total − fee − wheeling − loss`. Four currency `transfer_checked` CPIs (fee→`fee_collector`, wheeling→`wheeling_collector`, loss→`loss_collector`, net→seller currency escrow) and one energy `transfer_checked` (seller energy escrow → buyer energy escrow), all signed by `market_authority` (`settle_offchain.rs:810-877`), plus the opt-in REC transfer when the REC group is present (`settle_offchain.rs:879-894`). Then the mandatory-or-optional treasury recording (§4.8 / §5), nullifier updates (`filled_amount += match_amount`, plus `order_id`/`authority`/`bump`), and shard stat updates. Emits `OrderMatched` keyed by the two nullifier PDAs (`settle_offchain.rs:949-959`).

**`batch_settle_offchain_match`** (`lib.rs:245` → `settle_offchain.rs:1006`, args `matches: Vec<BatchMatchPair>, merkle_root, vat_amount, vat_rate_bps, batch_id, settle_shard_id`). Settles 1–4 matches in one transaction (`BatchTooLarge` outside that range, `settle_offchain.rs:1017`). Each `BatchMatchPair` is `{buyer_payload, seller_payload, match_amount, match_price, trade_id}` — the former per-match `wheeling_charge`/`loss_cost` fields were removed with the tariff binding (`settle_offchain.rs:560-569`). Unlike the single path, the collectors are **sharded** by the caller-supplied `settle_shard_id` (seed suffix `&[shard_id]`, validated `< treasury::NUM_SETTLE_SHARDS` → `InvalidShardId`, `settle_offchain.rs:600-633`, `1018`), and the optional treasury wiring adds a per-shard `settlement_shard` accumulator plus a per-`(zone, batch)` `settlement_record` (`settle_offchain.rs:645-666`). The per-pair accounts ride in `remaining_accounts` — exactly `match_count * 7 + 3` (or `+ 4` with `ZoneCapacity`): per pair 2 nullifiers + 4 escrows + 1 `TradeNullifier`, then trailing `governance_config` (at `match_count*7`), the **mandatory** `tariff_config` (`+1`), the **mandatory** payer `AggregatorEntry` (`+2`), and an optional writable `ZoneCapacity` (`+3`) for cross-zone batches (`settle_offchain.rs:1022-1030`). Gate order mirrors the single path: maintenance gate first (`settle_offchain.rs:1032-1034`), tariff rates fetched once for the whole batch (`settle_offchain.rs:1036-1038`), then the admitted-aggregator + segment gate (`settle_offchain.rs:1046-1049`). Each per-pair account is bound to the canonically derived PDA for the *signed* payload via `require_keys_eq!` against `Pubkey::find_program_address` (`InvalidNullifier`/`InvalidEscrow`, `settle_offchain.rs:1083-1120`), with additional SPL-owner checks. Per-match logic mirrors the single path — per-match `TradeNullifier` claim (`settle_offchain.rs:1160-1170`), flat-per-kWh wheeling and bps loss from the shared rates (`settle_offchain.rs:1181-1189`), and the `net_seller_after_charges` bound (`settle_offchain.rs:1190`) — except the REC transfer, which is deliberately not wired into the rigid batch layout (`settle_offchain.rs:1265-1271`). The batch's gross value is accumulated and recorded once after the loop via a single `record_settlement_batch_sharded` CPI that binds `merkle_root` and the VAT figures to the treasury `SettlementRecord` (`settle_offchain.rs:1297-1354`). Emits one `OrderMatched` per pair.

### 4.8 Escrow and policy

**`deposit_escrow`** (`lib.rs:943` → `escrow.rs:57`, arg `amount`). Signer: `user`. Transfers `amount` from the user's wallet token account into their escrow PDA (`init_if_needed`, seed `[b"escrow", user, mint]`, authority `market_authority`); emits `EscrowDeposited` (`escrow.rs:57-85`). The custodial analogue **`fund_escrow_custodial`** (`lib.rs:955` → `escrow.rs:131`, args `user: Pubkey, amount`) lets a platform `funder` sign the deposit into a non-signing `user`'s escrow — the escrow address is still seed-bound to `[user, mint]` (`escrow.rs:87-95`).

**`withdraw_escrow`** (`lib.rs:948` → `escrow.rs:198`, arg `amount`). Signer: `user`. Requires `amount <= escrow.amount` (`InsufficientEscrowBalance`, `escrow.rs:201-204`); transfers from the escrow PDA back to the user wallet, signed by `market_authority`; emits `EscrowWithdrawn`. The escrow seed includes `user.key()`, so a signer can only address their own escrow (`escrow.rs:172-175`).

**`set_settlement_thbc_mint`** (`lib.rs:846` → `set_settlement_thbc_mint.rs:17`, arg `thbc_mint: Pubkey`). Signer: market `authority` (`has_one`, `set_settlement_thbc_mint.rs:7`). Rejects `Pubkey::default()` (`TreasuryCurrencyMismatch`, `set_settlement_thbc_mint.rs:21`); sets `settlement_thbc_mint` and `has_settlement_thbc_mint = 1`; emits `SettlementThbcMintSet` (`set_settlement_thbc_mint.rs:26`). After this, THBC-denominated off-chain settlements require the treasury accounts (see §5).

**`update_market_params`** (`lib.rs:829` → `update_market_params.rs:15`, args `fee_bps, clearing, min_price, max_price`). Signer: market `authority` (`has_one`, `update_market_params.rs:9`). Updates fee, clearing flag, and price bounds; emits `MarketParamsUpdated` (`update_market_params.rs:15-47`).

### 4.9 Network tariff schedule (wheeling/loss)

These instructions manage the `TariffConfig` singleton (§3.7) from which every settlement path computes its wheeling and loss charges (role-map.md fix #7b). All are thin `lib.rs` wrappers (`lib.rs:876-904`) over `instructions/tariff.rs`.

**`initialize_tariff_config`** (`tariff.rs:29-45`, args `wheeling_authority: Pubkey, loss_authority: Pubkey, wheeling_rate_per_kwh: u64, loss_bps: u16`). Signer: the market admin (`has_one = authority` on `market`, `tariff.rs:16-19`). One-time `init` of the schedule; rejects `wheeling_rate_per_kwh > MAX_WHEELING_RATE_PER_KWH` or `loss_bps > MAX_LOSS_BPS` with `TariffRateExceedsCap` (`tariff.rs:36-37`). Both authorities are MEA/PEA (distribution) keys — retail P2P trades settle within one distribution territory and never touch EGAT's transmission grid; EGAT's on-chain role is the separate wholesale segment (§5.14).

**`set_wheeling_rate`** (`tariff.rs:59-63`, arg `new_rate_per_kwh: u64`). Signer: `wheeling_authority` (`has_one`, `tariff.rs:49`). Sets the **flat** per-kWh wheeling rate, capped by `MAX_WHEELING_RATE_PER_KWH` — capped independently of `loss_bps`, since the two are different units (flat per-kWh vs bps-of-value).

**`set_loss_rate`** (`tariff.rs:75-79`, arg `new_bps: u16`). Signer: `loss_authority` (`has_one`, `tariff.rs:67`). Sets the proportional line-loss rate, capped by `MAX_LOSS_BPS`.

**`set_tariff_authorities`** (`tariff.rs:121-129`, args `new_wheeling_authority, new_loss_authority`). Signer: market admin. Key rotation only; does not touch the rates.

**`close_tariff_config`** (`tariff.rs:100-108`). Signer: market admin. Deliberately **untyped** reclaim of the PDA (drains lamports, zeroes data) so a `TariffConfig` whose on-chain bytes predate the current layout can be re-initialized at the new size — used for the 2026-07-04 wheeling bps → flat-rate migration; pre-mainnet/localnet only (`tariff.rs:83-99`).

### 4.10 Off-chain match signing model

The off-chain settlement model decouples *matching* (performed off-chain) from *custody and recording* (performed on-chain). Each order is represented by an `OffchainOrderPayload` (`settle_offchain.rs:388-397`): `order_id: [u8;16]` (UUID), `user`, `energy_amount`, `price_per_kwh`, `side`, `zone_id`, `expires_at`. Its canonical message is the concatenation of these fields in fixed little-endian layout (`get_message`, `settle_offchain.rs:400-410`). The order owner signs this message off-chain with their Ed25519 key.

To settle, the matching agent constructs a transaction whose instructions are `[Ed25519_verify(buyer), Ed25519_verify(seller), settle_offchain_match]` (for the batch form, the Ed25519 instructions are interleaved per pair: `[buyer_0, seller_0, buyer_1, seller_1, …]`, `settle_offchain.rs:1077`). Inside the program, `verify_ed25519_signature` (`settle_offchain.rs:1359-1426`) reads the Instructions sysvar, locates the verification instruction at the expected index, confirms its program is the Ed25519 native program (`ED25519_ID`, `settle_offchain.rs:4-7`), parses the `Ed25519SignatureOffsets` header, requires every offset to reference the instruction itself, and checks that the public key and message at the *declared* offsets match the payload's `user` and `get_message()` byte-for-byte. Because Solana's runtime executes the Ed25519 instruction itself, a successful match of pubkey + message proves a valid signature. The settlement instruction's escrow and collector addresses are then fully derived from the signed `user` and mints, so a forged or substituted account cannot redirect funds (§5).

### 4.11 Shielded transfers (`privacy` feature, OFF by default)

Commit `193ddaf` added a shielded-balance subsystem, compiled only when the `privacy` cargo feature is enabled (`#[cfg(feature = "privacy")]` on the instruction modules, state module, `zk_verify`, and the three `lib.rs` wrappers — `instructions/mod.rs:14-17,43-46`, `state/mod.rs:10-11`, `lib.rs:8-9`). The feature ships **disabled**: the in-tree comments describe Phase 1 as verifying conservation + the balance proof-of-knowledge but not being mainnet-sound on its own, and instruct keeping `privacy` off (`Cargo.toml:22-24`, `zk_verify.rs:17-24`) — even though the handlers as written now also validate ZK ElGamal Proof Program range-proof **context-state accounts** (the Phase-2 mechanism) for both `private_transfer` and `unshield` (below).

**Model.** A user's shielded balance for one `(owner, mint)` is a Pedersen commitment `C = balance·G + b·H` stored in a `PrivateBalance` PDA (§3.8). Public tokens enter and leave a per-mint **pool vault** — a token account at `[b"priv_vault", mint]` whose authority is the `[b"priv_vault_auth"]` PDA (`private_shield.rs:36-50`). Shield/unshield amounts are public (tokens visibly cross the boundary); only `private_transfer` hides amounts (`private_shield.rs:1-6`). The generators `G` (the ristretto basepoint) and `H` (the `solana-zk-token-sdk` Pedersen blinding generator) are pinned as constants so the on-chain verifier and the off-chain wasm-zk prover (`gridtokenx-trading/wasm-zk`) agree (`zk_verify.rs:42-56`).

**`shield`** (`lib.rs:213` → `private_shield.rs:65`, arg `amount: u64`). Signer: `sender`. Requires `amount > 0`; `transfer_checked`s `amount` from the sender's wallet into the pool vault, then homomorphically credits the commitment: `C += amount·G` (public deposit, blinding contribution 0) via `zk_verify::value_times_g`/`add_commitments` (`private_shield.rs:65-91`). Both the vault and the sender's `PrivateBalance` are `init_if_needed`.

**`unshield`** (`lib.rs:221` → `private_shield.rs:138`, arg `amount: u64`). Signer: `sender`. Computes the post-unshield commitment `C_new = C − amount·G` (`private_shield.rs:145-148`), then requires a **range-proof context-state account**: it must be owned by the ZK ElGamal Proof Program (`ZkE1Gama1Proof11111111111111111111111111111`, constant at `zk_verify.rs:34-40`) and be a `BatchedRangeProofU64` whose single committed value equals `C_new` exactly, proven to 64-bit range (`verify_single_range_context`, `zk_verify.rs:188-204`; wired `private_shield.rs:150-163`). Without this, `amount > balance` would wrap the commitment mod the group order — the underflow hole called out in the module header (`private_shield.rs:8-11`). The vault-authority PDA then signs the transfer back to the sender's wallet (`private_shield.rs:166-182`). All proof failures map to `InvalidBalanceProof`.

**`private_transfer`** (`lib.rs:229` → `private_transfer.rs:67`, args `nullifier: [u8;32]`, `amount_commitment: [u8;32]`, `sender_new_commitment: [u8;32]`, `balance_proof: BalanceProof`). Signer: `sender`. Transfers a *hidden* amount between shielded balances. Verification chain, in order (`private_transfer.rs:74-105`):

1. **Conservation** — `C_old == C_amt + C_new` as ristretto points; the binding, additively homomorphic commitments force `value(C_old) = value(C_amt) + value(C_new)` mod l (`zk_verify::verify_conservation`, `zk_verify.rs:90-95`).
2. **Balance proof-of-knowledge** — a Fiat–Shamir Okamoto proof that the sender knows the opening `(amount, r_amt)` of `C_amt`: recomputes `A' = z_v·G + z_r·H − c·C_amt` and checks `H("GridTokenX_BalanceProof_v1", C_amt, A') == c`, rejecting non-canonical scalars (`verify_balance_proof`, `zk_verify.rs:97-136`; domain-separated challenge `zk_verify.rs:58-69`, byte-identical to the wasm-zk prover's `okamoto_challenge`).
3. **Range proofs** — the context-state account must be owned by the ZK ElGamal Proof Program and be a `BatchedRangeProofU128` whose first two committed values are *positionally* `C_amt` and `C_new`, each proven 64-bit (`verify_range_context`, `zk_verify.rs:165-186`; layout documented `zk_verify.rs:138-163`). The owner check comes first — a matching layout under another owner proves nothing (`private_transfer.rs:90-98`).

Effects: the sender's commitment is replaced by `C_new`; the recipient's is homomorphically credited `C += C_amt` (a fresh recipient account's zeroed commitment is the identity point, so init-credit is correct, `private_transfer.rs:19-21,107-119`). Replay is blocked by `init` of the `PrivacyNullifier` PDA `[b"priv_null", nullifier]` (`private_transfer.rs:31-39`). Self-transfer is rejected (`recipient != sender`) with the domain-specific `SelfTransferNotAllowed` — defense-in-depth over Anchor's own duplicate-mutable-account error, since sender and recipient balances would otherwise be the same PDA and the debit/credit double-write would create value (`private_transfer.rs:41-48`).

The verification helpers and constants live in `src/zk_verify.rs` (`lib.rs:8-9`); its unit tests (prover/verifier agreement, tampered-commitment and zero-proof rejection, context-state layout validation against real `solana-zk-sdk`-built accounts, and the ZK program-id byte check) are at `zk_verify.rs:206-406` and run natively (`cargo test --features privacy`) because `solana-curve25519` provides host implementations of the curve syscalls off-target (`Cargo.toml:40-47`).

---

## 5. Invariants & Security Properties

1. **CDA matching correctness.** Continuous matching requires `buy.price >= sell.price` and settles at the seller's price (`match_orders.rs:53-65`, `sharded_match_orders.rs:60-68`). Off-chain settlement enforces two-sided slippage bounds: `seller.price <= match_price <= buyer.price` (`settle_offchain.rs:718-719`). `execute_atomic_settlement` enforces the same bounds (`lib.rs:590-598`). The matched amount is always clamped to both sides' remaining quantity (`match_orders.rs:60`, `settle_offchain.rs:753-755`).

2. **Uniform-price auction.** `clear_auction` matches all eligible orders at a single clearing price found at the supply/demand intersection that maximizes feasible volume (`find_clearing_point`, `lib.rs:1054-1078`), giving every matched participant price improvement relative to their limit. The clearing logic is unit-tested (§9).

3. **Replay protection via nullifiers.** Each off-chain order's cumulative settled energy is tracked in an `OrderNullifier` PDA keyed by `[b"nullifier", user, order_id]` (`settle_offchain.rs:436-448`). `match_amount` is bounded by `energy_amount − nullifier.filled_amount` (`settle_offchain.rs:753-755`), so a signed payload can never be settled beyond its own energy amount across repeated submissions. A per-match `TradeNullifier` PDA keyed by `trade_id` additionally rejects re-settling the *same* partial match while the order still has headroom (`MatchAlreadySettled`, `settle_offchain.rs:346-381`, batch `settle_offchain.rs:1160-1170`). In the batch path the nullifier accounts must equal the PDA derived from the signed payload (`InvalidNullifier`, `settle_offchain.rs:1086-1095`) and the loaded nullifier's stored `authority` must equal the payload user (`NullifierUserMismatch`, `settle_offchain.rs:1149-1150`).

4. **Escrow custody binding.** Every escrow address is derived from the signed payload's `user` and the mint (`seeds = [b"escrow", user, mint]`), so settlement can never be aimed at a victim's funds — the seed derivation is the authorization (`settle_offchain.rs:460-497`, `escrow.rs:14-21`). The escrow SPL authority is the global `market_authority` PDA, which signs all outbound transfers (`settle_offchain.rs:806-808`). `withdraw_escrow` seeds include `user.key()`, so a signer can only drain their own escrow (`escrow.rs:172-175`). Collectors are likewise bound to seed PDAs so fees cannot be redirected (`settle_offchain.rs:499-526`).

5. **Singleton-market binding.** `settle_offchain_match` binds `market` to the canonical `[b"market"]` PDA, blocking substitution of a fee-zero market, and constrains `zone_market` to belong to that market, blocking a zero-capacity or wrong-zone book (`settle_offchain.rs:416-425`).

6. **Mandatory THBC settlement recording.** When `market.has_settlement_thbc_mint == 1` and the settlement `currency_mint` equals `market.settlement_thbc_mint`, recording is mandatory: `recording_required` is computed, and if the treasury accounts are absent the instruction fails with `TreasurySettlementRequired` (`settle_offchain.rs:897-929` single path; `settle_offchain.rs:1297-1354` batch path). When the treasury accounts *are* supplied, the settlement currency must equal `treasury_state.thbc_mint` (`TreasuryCurrencyMismatch`, `settle_offchain.rs:909-913`, `1305-1309`), preventing an arbitrary token from being recorded as a baht settlement.

7. **`market_authority` PDA as escrow signer / settlement recorder.** All escrow transfers and the treasury recording CPIs are signed by the `market_authority` PDA (seed `[b"market_authority"]`, `settle_offchain.rs:454`, `914-924`, `1068`), which is also the on-chain identity the treasury program expects as `recorder`/`settlement_recorder` (§6).

8. **Cross-zone capacity throttle.** When `zone_market.capacity > 0` and *either* leg is remote relative to the zone, `committed_flow + match_amount` must not exceed `capacity` (`CapacityExceeded`, `settle_offchain.rs:738-751`, batch `settle_offchain.rs:1193-1204`). The live `committed_flow` counter is the `ZoneCapacity` PDA, which is *mandatory* for cross-zone matches — omitting it cannot bypass the ceiling (`ZoneCapacityRequired`, `settle_offchain.rs:88-110`). Checking both legs (not only the seller) closes a remote-buyer/local-seller bypass (`settle_offchain.rs:731-739`).

9. **Sharding parallelism with drain reconciliation.** Hot-path settlement writes go to per-shard `MarketShard`/`ZoneMarketShard` accounts selected by `get_shard_id(authority) = authority.to_bytes()[0] % num_shards` (`market.rs:160-163`), so concurrent settlements by different payers touch disjoint shard accounts and do not serialize on the global `Market`/`ZoneMarket`. `sharded_match_orders` keeps `market`/`zone_market` strictly read-only in its context — a `mut` there would re-introduce the write-lock the shard exists to avoid (`sharded_match_orders.rs:13-17`). The resulting staleness of `ZoneMarket.total_volume`/`total_trades` is intentional and reconciled by the admin `aggregate_shards` drain, whose duplicate-shard bitmask and zone-binding checks make a drain idempotent and non-double-counting (`DuplicateShard`/`ShardZoneMismatch`, `aggregate_shards.rs:65-79`, `70-74`; §4.3). The batch settle path additionally shards the fee/wheeling/loss collectors by the caller-rotated `settle_shard_id` (`settle_offchain.rs:600-633`).

10. **Checked arithmetic / overflow safety.** Monetary products use `checked_mul` (u128 intermediates for the 9-decimal × 6-decimal scaling) and reject on overflow rather than saturating, since a clamped money value would be paid out and recorded incorrectly (`settle_offchain.rs:781-787`, `1173-1179`). Aggregate counters use `saturating_*`; `aggregate_shards` uses `checked_add` and rejects with `Overflow` (`aggregate_shards.rs:87-108`). The release build forces `overflow-checks = true` so bare `+=`/`-=` panic instead of wrapping (`Cargo.toml:53-54`).

11. **Mandatory maintenance gate on the settlement fund paths.** Both `settle_offchain_match` and `batch_settle_offchain_match` are custody-bearing fund paths, so each gates on the governance operational mode **before** any signature verification — rejecting with `MaintenanceMode` when the platform is paused (`settle_offchain.rs:678-686`, `1032-1034`). The check is performed in-handler against a `governance_config` account threaded through `remaining_accounts` (first account for the single path, trailing for the batch) rather than a named `seeds`-constrained field, because the settle context already sits at the BPF stack ceiling (`settle_offchain.rs:76-78`). `require_governance_operational` still binds that account to the canonical `[b"governance_config"]` PDA owned by `governance::ID` and reads the `maintenance_mode` byte directly (`settle_offchain.rs:75-86`), so the workaround does not weaken the gate.

12. **Bounded network charges (defense-in-depth).** The computed `wheeling` and `loss` charges are validated by `net_seller_after_charges` (`settle_offchain.rs:112-126`), which replaced a `saturating_sub` chain that silently zeroed the seller when charges exceeded the trade. It rejects when `wheeling + loss` exceeds 20% of trade value (`MAX_NETWORK_CHARGE_BPS = 2000`, `tariff_config.rs:15`, `ChargesExceedCap`) and when `fee + wheeling + loss` exceeds the trade value (`ChargesExceedValue`). Since the tariff binding (#13) the primary caps live at tariff-set time; this stays as a per-settlement backstop because a sane flat wheeling rate can still be an outsized fraction of a very small trade. Both settle paths use it (`settle_offchain.rs:804`, `1190`).

13. **On-chain tariff authority binding.** Wheeling and loss charges are computed from the `TariffConfig` PDA on every settlement path — single (`settle_offchain.rs:790-803`), batch (`settle_offchain.rs:1181-1189`), and atomic (`lib.rs:615-645`) — never taken from the caller. `wheeling_rate_per_kwh` is a **flat THB/kWh rate** (`wheeling = energy × rate / 1e9`, mirroring the trade-value scaling) settable only by `wheeling_authority`; `loss_bps` is proportional to trade value and settable only by `loss_authority` — both MEA/PEA distribution keys (§3.7, `tariff.rs:29-79`). The settle paths bind the account to the canonical `[b"tariff_config"]` PDA owned by this program (`InvalidTariffConfig`, `settle_offchain.rs:128-143`); rate updates are capped at set time (`TariffRateExceedsCap`, `tariff.rs:36-37`, `60`, `76`).

14. **Admitted-aggregator operator gate with segment split.** The settlement `payer` on both off-chain settle paths must own an active governance `AggregatorEntry` PDA (`[b"aggregator", payer]`, owned by `governance::ID`) — an arbitrary funded wallet cannot submit settlements (`AggregatorNotAdmitted`, `require_admitted_aggregator`, `settle_offchain.rs:145-171`; wired at `settle_offchain.rs:693-703` and `1046-1049`). A Wholesale zone (`ZoneMarket.segment == 1`, EGAT's segment) additionally requires the aggregator's own `segment` byte to be Wholesale (`AggregatorSegmentMismatch`, `settle_offchain.rs:160-169`); Retail zones (0, the default) accept any admitted aggregator, and a legacy pre-segment entry reads as Retail. `execute_atomic_settlement` is intentionally outside this gate — its `market_authority` signer already ties to `market.authority` (`lib.rs:582-586`).

15. **Shielded-pool soundness boundary (`privacy`, compiled out by default).** The shielded subsystem's value-safety rests on four checks: Pedersen conservation (`C_old = C_amt + C_new`, `zk_verify.rs:90-95`), the Okamoto opening proof (`zk_verify.rs:97-136`), the ZK ElGamal Proof Program range-context validation with owner-first checking (`private_transfer.rs:90-105`, `private_shield.rs:150-163`), and the `PrivacyNullifier` replay guard plus self-transfer rejection (`private_transfer.rs:31-48`). The feature is nonetheless OFF by default and the source explicitly flags it as not mainnet-sound on its own (`Cargo.toml:22-24`, `zk_verify.rs:17-24`); it must not gate real funds until that caveat is lifted.

---

## 6. Cross-Program Interfaces (CPI)

The program has two CPI counterparties; both dependencies are declared with `features = ["cpi"]` (`Cargo.toml:48-49`).

### 6.1 trading → governance

The `governance` program supplies `GovernanceConfig`, `ErcCertificate`, and `ErcStatus`, re-exported at `lib.rs:21`. There is no CPI *invoke* into governance; instead, the `GovernanceConfig` account is read and manually deserialized (`get_governance_config`, `utils.rs:5-12`, which skips the 8-byte discriminator and Borsh-decodes the body, returning `InvalidGovernanceAccount` on failure). Every state-mutating instruction calls `is_operational()` on this config and rejects with `MaintenanceMode` when the platform is paused (e.g. `create_sell_order.rs:33-36`). `create_sell_order` additionally validates a governance-issued `ErcCertificate` when present, including the seller-ownership bind (`create_sell_order.rs:56-81`). The off-chain settle paths perform two further raw-byte reads of governance-owned accounts (stack-ceiling workaround, no typed deserialize): the `governance_config` maintenance byte (`require_governance_operational`, `settle_offchain.rs:75-86`) and the payer's `AggregatorEntry` PDA for the admitted-aggregator + segment gate (`require_admitted_aggregator`, `settle_offchain.rs:145-171`).

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
| `OrderMatched` | sell_order, buy_order, seller, buyer, amount, price, total_value, fee_amount, timestamp | `match_orders`, `sharded_match_orders`, `clear_auction`, `execute_auction_matches`, `execute_atomic_settlement`, `settle_offchain_match`, `batch_settle_offchain_match` | `events.rs:29-50` |
| `OrderCancelled` | order_id, user, timestamp | `cancel_order` | `events.rs:51-57` |
| `MarketParamsUpdated` | authority, market_fee_bps, clearing_enabled, min/max_price_per_kwh, timestamp | `update_market_params` | `events.rs:58-66` |
| `SettlementThbcMintSet` | authority, thbc_mint, timestamp | `set_settlement_thbc_mint` | `events.rs:68-73` |
| `MaintenanceModeChanged` | authority, maintenance_mode, timestamp | (defined; no in-program emit) | `events.rs:75-80` |
| `LimitOrderSubmitted` | order_id, side, price, amount, timestamp | `submit_limit_order`, `submit_limit_order_sharded` | `events.rs:82-89` |
| `MarketOrderSubmitted` | user, side, amount, timestamp | `submit_market_order` | `events.rs:91-97` |
| `DepthUpdated` | buy_levels, sell_levels, best_bid, best_ask, timestamp | `update_depth` | `events.rs:99-106` |
| `PriceHistoryUpdated` | trade_price, trade_volume, vwap, timestamp | `update_price_history` | `events.rs:108-114` |
| `AuctionCleared` | clearing_price, clearing_volume, matched_orders, timestamp | `clear_auction` | `events.rs:116-122` |
| `EscrowDeposited` | user, mint, amount, timestamp | `deposit_escrow`, `fund_escrow_custodial` | `events.rs:124-130` |
| `EscrowWithdrawn` | user, mint, amount, timestamp | `withdraw_escrow` | `events.rs:132-138` |
| `ShardsAggregated` | zone_id, volume_added, trades_added, shards_drained, timestamp | `aggregate_shards` | `events.rs:140-149` |

**Dual-scale `OrderMatched.total_value` contract.** `total_value` means two different things depending on the emitting instruction, and the source now documents this in-place (`events.rs:37-46`, commit `c55ebc9`):

- **Settle paths** (`settle_offchain_match`, `batch_settle_offchain_match`, `execute_atomic_settlement`): `total_value = amount × price / 1e9` — real 6-decimal settlement currency (THBC minor units); money actually moves and the treasury recording reconciles to it.
- **Discovery paths** (`match_orders`, `sharded_match_orders`, `clear_auction`, `execute_auction_matches`): `total_value = amount × price` with **no** `/1e9` — a raw atomic·micros product, 1e9× larger, **informational only** (no token transfer). The CDA verifier (`scripts/verify-price-models-onchain.ts`) asserts this raw form, so "normalizing" the discovery producers would break the verifier and invalidate committed results.

External indexers/explorers must not sum `total_value` across paths without rescaling by path. The same raw scale applies to the discovery-path `TradeRecord.total_value` (§3.3, `order.rs:31-35`).

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
| `InvalidBalanceProof` | Shielded transfer proof failed verification (conservation or balance PoK) | `error.rs:101-102` |
| `SelfTransferNotAllowed` | Shielded transfer recipient must differ from the sender (self-transfer would double-credit) | `error.rs:103-104` |
| `DuplicateShard` | Shard passed more than once to aggregate_shards (would double-drain totals) | `error.rs:105-106` |
| `ShardZoneMismatch` | Shard does not belong to the given zone market | `error.rs:107-108` |
| `ErcOwnerMismatch` | Referenced ERC certificate is not owned by the order seller | `error.rs:109-110` |

New variants are appended at the **end** of the enum to preserve existing numeric error codes for clients and tests (`error.rs:77-78`). Note that `InvalidBalanceProof` and `SelfTransferNotAllowed` are defined unconditionally (not `#[cfg(feature = "privacy")]`-gated), again to keep numeric codes stable across feature builds.

---

## 9. Testing

The program's auction-clearing arithmetic is covered by Rust unit tests in `#[cfg(test)] mod tests` (`lib.rs:1084-1231`): `test_find_clearing_point_basic` and `test_find_clearing_point_no_intersection` exercise the clearing-point search (`lib.rs:1123`, `1141`); `test_sell_order_sorting` / `test_buy_order_sorting` verify ascending-sell / descending-buy ordering (`lib.rs:1153`, `1167`); `test_price_improvement_seller` / `test_price_improvement_buyer` verify uniform-price improvement (`lib.rs:1181`, `1190`); and `test_full_auction_scenario` runs an end-to-end curve build and clearing (`lib.rs:1199`). The shielded-transfer verifier has its own unit suite in `zk_verify.rs:206-406` (prover/verifier agreement with the wasm-zk construction, zero-placeholder and wrong-commitment rejection, range-context layout validation against real `solana-zk-sdk`-built context-state accounts, and the ZK program-id byte check); it runs natively via `cargo test --features privacy` because `solana-curve25519` ships host implementations of the curve syscalls off-target.

TypeScript suites live under `tests/`. The former validator-gated suites that exercised this program (`tests/trading.ts`, `tests/escrow_settlement.ts`, `tests/settle_offchain_guards_litesvm.ts`, `tests/treasury.ts`, and the per-suite `npm run test:*` recipes) were **removed** in commit `b2021fb`; the current trading-relevant suites are:

- **`tests/sharded_match_litesvm.ts`** — `describe("sharded_match_orders (litesvm) — shard-lock CDA parity with match_orders")` (`tests/sharded_match_litesvm.ts:41`): in-process (no validator) coverage of exactly the §4.3 sharded-path guarantees — rejection of `match_amount == 0` with **no** state mutation (`:196`), a full match with shard bookkeeping and a fully-populated `TradeRecord` at seller-ask pricing (`:212`), the `aggregate_shards` drain into `ZoneMarket` with idempotent re-run (`:240`), and rejection of a duplicate shard (`DuplicateShard`) and of a non-authority caller (`:267`).
- **`tests/price_models_litesvm.ts`** — `describe("price models (litesvm) — comparative prosumer economics on one book")` (`tests/price_models_litesvm.ts:81`): CDA discriminatory pricing per fill (`:224`), uniform-price clearing at the max-crossing volume (`:248`), utility buyback comparison (`:275`), and the uniform > CDA > buyback ranking (`:286`).
- **`tests/batch_settle_tps.ts`** — `describe("batch_settle THBC — TPS sweep (§2b)")` (`tests/batch_settle_tps.ts:81`): validator-gated throughput sweep driving `batch_settle_offchain_match` with sharded collectors and THBC treasury recording (`tests/batch_settle_tps.ts:304`).

(`tests/rec_gate_litesvm.ts` targets the energy-token program's REC co-sign gate, not trading.) The lib-level price-model unit suite lives at `scripts/lib/price-model-tariff.test.ts`.

Market bootstrap against a live validator is via `scripts/init-market.ts` / `scripts/init-zone-market.ts` (the former lifecycle/load simulation and settlement-driving scripts have been removed). The BlockBench (`blockbench`) and SmallBank/TPC-C (`tpc-benchmark`) suites are separate benchmark crates and do not exercise the `trading` program's settlement path.

To build and run the trading-relevant suites (per the repository `CLAUDE.md`): run the litesvm suites directly with mocha (`npx mocha -r tsx tests/sharded_match_litesvm.ts ...`, loading `target/deploy/*.so`), or `anchor test` for the full validator-backed flow. The Rust unit tests run with `cargo test` from within `programs/trading` once the crate's dependencies are built (`cargo test --features privacy` additionally runs the `zk_verify` suite).
