# GridTokenX — Trading: Order Book, CDA Matching & Off-Chain Settlement

> **✅ STATUS: IMPLEMENTED.** This is a design/architecture narrative for the `trading` program. The authoritative path:line reference is `docs/programs/trading.md`; this doc explains the *model and why*, citing code where it matters. Verified against `programs/trading/src/` (Anchor 1.0).

This document specifies the trading program's market model: how orders are submitted, how the Continuous Double Auction (CDA) and batch-auction paths match them, how settlement reaches the chain non-custodially, and how sharding keeps the hot path parallel. Eight sections.

---

## 1. Two Matching Paths, One Settlement Truth

The trading program deliberately supports **two matching models** that converge on the same on-chain settlement primitives:

1. **On-chain immediate / batch matching** — orders are stored on-chain (`Order` PDA) and matched synchronously (`match_orders`, `lib.rs:328`) or in batches (`execute_batch`, `lib.rs:528`); a uniform-price batch auction is also available (`clear_auction`, `lib.rs:933` → `execute_auction_matches`, `lib.rs:1088`).
2. **Off-chain CDA matching** — limit/market orders are submitted as intent (`submit_limit_order`, `lib.rs:591`; `submit_market_order`, `lib.rs:697`); the actual order book lives off-chain in matching agents, and only the **settlement** is proved on-chain (`settle_offchain_match`, `lib.rs:1371` → `instructions/settle_offchain.rs`).

The off-chain path is the scalable one: there is **no on-chain order book** to contend on; the chain stores only nullifiers and the settlement result. The on-chain path exists for simpler/auditable flows and for the batch uniform-price auction used by zone clearing.

---

## 2. The Order Model (on-chain path)

`Order` is a zero-copy PDA seeded `[b"order", authority, order_id]` (`state/order.rs`):

- `seller`/`buyer`, `order_id`, `amount`, `filled_amount`, `price_per_kwh`
- `order_type` (Sell=0, Buy=1), `status` (Active=0, PartiallyFilled=1, Completed=2, Cancelled=3, Expired=4)
- `created_at`, `expires_at`

Lifecycle: `create_sell_order`/`create_buy_order` (`lib.rs:195`,`272`) → `match_orders` transitions Active → PartiallyFilled → Completed and bumps `filled_amount` (`lib.rs:328`) → `cancel_order` for Active/PartiallyFilled (`lib.rs:419`). Sell orders are gated by a valid ERC certificate (see the REC design doc): `InvalidErcCertificate`/`ErcExpired`/`NotValidatedForTrading`/`ExceedsErcAmount` (`lib.rs:230-240`).

---

## 3. The CDA & Off-Chain Order Book

Under the CDA path, an order is an **Ed25519-signed intent** (`OffchainOrderPayload`, `settle_offchain.rs:73`): `order_id` (UUID `[u8;16]`), `user`, `energy_amount`, `price_per_kwh`, `side`, `zone_id`, `expires_at`. Matching agents hold the book off-chain, cross bids/asks, and submit matches on-chain.

Market depth is surfaced on-chain for transparency only: `update_depth` (`lib.rs:741`) writes up to 10 levels per side into `ZoneMarket.buy_side_depth[10]`/`sell_side_depth[10]` (sorted DESC bids / ASC asks). `update_price_history` maintains a 24-slot ring buffer + VWAP (`lib.rs:831`). These are read-only views; they are not the matching state.

---

## 4. Off-Chain Match Settlement (the core)

`settle_offchain_match` (`settle_offchain.rs:311`) is the trust anchor. Per match:

1. **Verify two Ed25519 signatures** — buyer at instruction index 0, seller at index 1, via the instructions sysvar (`verify_ed25519_signature`, `settle_offchain.rs:740`). The signed message is the serialized payload (`get_message`).
2. **Validate** — `match_amount > 0`; `seller_price ≤ match_price ≤ buyer_price` (`SlippageExceeded`); correct sides (`InvalidOrderSide`); not expired (`OrderExpired`).
3. **Capacity** — cross-zone matches are throttled against `ZoneMarket.capacity`; intra-zone exempt; `committed_flow += match_amount` (`CapacityExceeded`).
4. **Nullifier replay guard** — `match_amount ≤ min(buyer_remaining, seller_remaining)` where remaining = `energy_amount − nullifier.filled_amount` (`OrderNullifier`, seeds `[b"nullifier", user, order_id]`).
5. **Token transfers** (all signed by the `market_authority` PDA, seeds `[b"market_authority"]`): from buyer currency escrow → `fee_collector` (market fee), `wheeling_collector` (wheeling charge), `loss_collector` (line loss), remainder → seller currency escrow; energy from seller escrow → buyer escrow.
6. **Treasury CPI (conditional)** — see §6.
7. **State update** — bump both nullifiers' `filled_amount`, market/zone shard volume + trade counters, `last_clearing_price`. Emit `OrderMatched`.

Non-custodial: the program never holds user funds beyond per-user escrow PDAs that the user themselves funds (`deposit_escrow`/`withdraw_escrow`, `instructions/escrow.rs`); the protocol moves them only inside a verified, signed match.

---

## 5. Sharding (Sealevel parallelism)

Hot-path writes never touch the global `Market` account. Shard select is `get_shard_id(authority, num_shards) = authority.to_bytes()[0] % num_shards` (`state/market.rs:154`). Settlement writes land on `MarketShard` (`[b"market_shard", market, shard_id]`) and `ZoneMarketShard` (`[b"zone_shard", zone_market, shard_id]`), chosen automatically from the signed payloads (`settle_offchain.rs:205`). Different shards settle in parallel without contending on one write lock; global totals are reconciled separately. `num_shards` is set at `initialize_market` (`lib.rs:122`) and per `ZoneMarket`.

---

## 6. THBG Settlement Policy & Treasury Recording

A market may pin its settlement currency to THBG via `set_settlement_thbg_mint` (`lib.rs:1352`), setting `has_settlement_thbg_mint = 1`. Then, for any match whose `currency_mint == settlement_thbg_mint`, recording to the treasury is **mandatory**:

- The settlement CPIs into `treasury::record_settlement(value)` with the gross settled value (`settle_offchain.rs:445`), authorized by the `market_authority` PDA (= treasury's `settlement_recorder`).
- The currency must equal `treasury_state.thbg_mint` or `TreasuryCurrencyMismatch`.
- If the treasury accounts are omitted while recording is required → `TreasurySettlementRequired` (no silent skip, `settle_offchain.rs:475`).

This reconciles `treasury.total_settled_thbg` to the THBG actually leaving buyer escrow.

---

## 7. Batch Settlement

`batch_settle_offchain_match` (`settle_offchain.rs:513`) settles **1–4 matches** in one transaction (`BatchTooLarge` above 4). It takes 6 remaining accounts per match (both nullifiers, both currency escrows, both energy escrows), binds each to its canonical PDA derived from the signed payloads (`InvalidNullifier`/`InvalidEscrow`/`NullifierUserMismatch`), verifies 2 signatures per match, accumulates `batch_total_value`, and records the **whole batch with one treasury CPI** — cheaper than per-match recording. This batching is what keeps per-kWh on-chain cost negligible (see the cost/fee doc).

---

## 8. Invariants & Conventions

- **Zero-copy** for `Market`/`Order`/`ZoneMarket`/`MarketShard`/`ZoneMarketShard` (`#[account(zero_copy)] #[repr(C)]`); load via `AccountLoader`.
- **Nullifier monotonicity**: `filled_amount` only increases; replays beyond remaining are rejected — the off-chain order book can never double-settle an order.
- **`compute_fn!`** wraps handlers (no-op unless `localnet` feature); CU profiled against the 200k default / 1.4M max.
- **Checked arithmetic** (`Overflow`); `overflow-checks = true` in release.
- **Capacity** models the grid transmission bottleneck on cross-zone trades, not on intra-zone.

---

*Design narrative for the implemented `trading` program. Authoritative path:line reference: `docs/programs/trading.md`. Verified against `programs/trading/src/` (Anchor 1.0).*
