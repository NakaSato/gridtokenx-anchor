# Price Model — GridTokenX (end-to-end)

How price is formed, bounded, and settled across the on-chain programs. Verified against source on 2026-07-09; file/line references included.

## TL;DR

There are **three independent price surfaces**, and they do **not** feed each other on-chain:

1. **Energy trading price** (`trading`) — a per-kWh limit price discovered by matching bids and asks. This is the actual "market price" of energy.
2. **Treasury swap rate** (`treasury`) — a fixed, admin-set GRX↔THBC conversion rate that turns settled value into THB-pegged stablecoin. It is a *conversion rate*, not a discovered price.
3. **Oracle "clearing"** (`oracle`) — despite the name, carries **no price at all**. It validates/accumulates energy quantities and stamps 15-minute epochs. Price discovery is not done here.

The common unit that ties them together: `price_per_kwh` is expressed in **6-decimal currency base units** (e.g. `3_400_000` = 3.40 THB/kWh), and settlement ultimately denominates in **THBC** (THB-pegged, 6 decimals).

---

## 1. Energy trading price (the real market price)

Price lives on the order, not on any global account:

- `Order.price_per_kwh: u64` — 6-decimal currency units per kWh (`trading/src/state/order.rs:14`).
- `Order.amount` / `match_amount` — energy in 9-decimal atomic kWh (`kWh × 1e9`), `ENERGY_AMOUNT_DECIMALS_DIVISOR = 1_000_000_000` (`trading/src/lib.rs:26`).

### How a match price is chosen — depends on the path

The platform has three matching paths that pick price differently:

**a) Continuous pairwise match** (`sharded_match_orders.rs`, on-chain `match_orders`):
Crossing gate `buy.price_per_kwh >= sell.price_per_kwh`, then the match price is the **seller's ask** (resting-maker price), not a midpoint:

```
let clearing_price = sell_order.price_per_kwh;   // sharded_match_orders.rs:40, lib.rs:462
```

**b) Off-chain signed settlement** (`settle_offchain.rs`) — the production fund-moving path. An off-chain matcher supplies `match_price`; on-chain only enforces it lies **inside the bid-ask spread**:

```
require!(match_price <= buyer_payload.price_per_kwh, SlippageExceeded)   // :718
require!(match_price >= seller_payload.price_per_kwh, SlippageExceeded)  // :719
```

So the matcher is free to pick any price in `[seller_ask, buyer_bid]`; the chain trusts the signed orders and enforces the bounds.

**c) Batch uniform-price auction** (`clear_auction` in `lib.rs`): sorts sells ascending / buys descending, builds cumulative supply & demand curves, and `find_clearing_point` (`lib.rs:1842-1865`) returns the supply-side price at the max-crossing volume as a **single uniform clearing price** applied to all fills. Emits `AuctionCleared { clearing_price, clearing_volume, matched_orders }`.

### Settlement value = price × quantity

Authoritative computation (`settle_offchain.rs:781-787`), u128 intermediate, scaled back to 6-decimal currency:

```
total_currency_value = match_amount * match_price / 1e9   // 9-dec energy × 6-dec price → 6-dec currency
```

Deductions before the seller is paid: market fee (`total × market_fee_bps / 10000`), wheeling (flat `wheeling_rate_per_kwh × kWh / 1e9`), loss (`total × loss_bps / 10000`); seller nets the remainder. Funds move buyer→seller via per-user escrows in `currency_mint`.

### Bounds & validation

Per-market bounds on `Market`: `min_price_per_kwh` (must be >0) and `max_price_per_kwh` (0 = uncapped) (`market.rs:23-24`). Enforced on order creation in the standard `lib.rs` handlers (`InvalidPrice` if price ≤ 0, plus min/max). **No tick size** exists anywhere — prices are free u64 within bounds.

Two gaps worth knowing: the sharded fast-path `submit_limit_order_sharded` writes the price with **no** min/max/positivity check, and `settle_offchain` never re-checks market min/max (only the bid-ask spread). If min/max is a hard invariant, those are the holes.

Persisted price state: `Market.last_clearing_price`, `ZoneMarketShard.last_clearing_price` (updated every settle), and a 24-slot `price_history: [PricePoint; 24]` ring buffer on `Market`.

---

## 2. Treasury swap rate (value → THB-pegged stablecoin)

This is a **conversion rate, not a discovered price**. GRX = 9 decimals, THBC = 6 decimals. `grx_per_thbc_rate` = THBC minor units per 1 whole GRX (`state.rs:41`).

**Exchange** (`compute_exchange_grx_for_thbc`, `lib.rs`) — formerly `compute_swap_grx_for_thbc`, which minted; the F6 fix made it an inventory transfer. Pricing is unchanged, so the arithmetic below still holds; the bound moved from `new_supply <= attested_reserve` to `net <= inventory`:

```
gross = grx_in * rate / 1e9
fee   = gross * fee_bps / 10_000
net   = gross - fee                       // thbc_out
require!(thbc_supply + net <= attested_reserve, PegBreach)
```

**Reverse exchange** (`compute_exchange_thbc_for_grx`, `lib.rs`) — formerly `compute_redeem_thbc_for_grx`, which burned. Inverse pricing, and it **now charges the same `swap_fee_bps` spread** as the forward direction (the old redeem path was free, so a round trip cost the forward fee only). The `SupplyUnderflow` guard is gone — a transfer into inventory cannot underflow supply — and the vault guard is kept:

```
require!(thbc_in <= thbc_supply, SupplyUnderflow)
grx_out = thbc_in * 1e9 / rate
require!(grx_out <= swap_vault.amount, InsufficientVault)
```

The guards guarantee a `set_params` rate change can never let a redeemer drain more GRX than the vault holds.

### The peg is administrative, not market-derived

The rate is a plain field set by the treasury `authority` in `set_params` (`lib.rs:318-348`) — there is no AMM, oracle, or pricing curve. The peg is held by a separate mechanism: an off-chain **custodian** (`attestor`, a distinct key) posts `attested_reserve` via `update_attestation`, and minting is gated by (1) freshness `now − attestation_ts ≤ attestation_ttl` (`StaleAttestation`) and (2) the supply ceiling `thbc_supply + minted ≤ attested_reserve` (`PegBreach`). Staked GRX lives in its own vault and never backs the peg.

Fee model: a single `swap_fee_bps` applied only to swap output; not charged on redeem, not routed to any vault — it simply reduces THBC minted, tightening the peg.

---

## 3. Oracle "market clearing" — no price here

Important to dispel the name: `programs/oracle` stores **energy quantities only**. `MeterState` (`state.rs:11-29`) holds `energy_produced/consumed` and cumulative totals — no price, bid, ask, or clearing-price field anywhere (a case-insensitive `price` search over the program returns zero hits).

`trigger_market_clearing` (`lib.rs:183-227`) computes no price. It validates the epoch lands on a 900-second (15-min) boundary (`epoch_timestamp % 900 == 0`), isn't stale or in the future, then just stamps `last_clearing` / `last_cleared_epoch` and emits `MarketClearingTriggered`. It's a "this 15-minute window is finalized" flag, not an auction.

Meter readings arrive via `submit_meter_reading` from the AMI gateway (`chain_bridge`), written to per-meter PDAs for parallelism, with range/anomaly validation. Node-facing instructions (clearing, aggregation) also accept governance-admitted aggregators (`AggregatorEntry` PoA allow-list); `submit_meter_reading` requires exactly the `chain_bridge`.

Downstream: **trading and treasury never read the oracle.** The only cross-program consumer is `registry`, which reads a meter's cumulative `total_energy_produced/consumed` as a trust anchor to cap mint eligibility (`OracleTotalMismatch`), not for price.

---

## How the surfaces connect (and don't)

```
AMI meters ─▶ oracle (energy quantities, epoch stamp)
                 │ (read only by registry, for mint eligibility — NOT price)
                 ▼
            registry / energy-token  (who may mint kWh→GRID)

buyers/sellers ─▶ trading order book
                    │ off-chain matcher picks match_price ∈ [ask, bid]
                    ▼
             settle_offchain_match
                    │ total_value = match_amount × match_price / 1e9   (6-dec currency = THBC)
                    ▼ (mandatory CPI when market currency == THBC)
             treasury::record_settlement   ── bumps total_settled_thbc (accounting only)

GRX holders ─▶ treasury swap/redeem   (fixed admin rate, peg-gated) ─▶ THBC
```

Price discovery happens **only** in trading, off-chain, bounded on-chain by signed limit orders. Treasury converts settled value into pegged THBC at an administrative rate. The oracle is a quantity/quality anchor with a misleading "clearing" name.

## Open questions / risks for whoever owns pricing

- The name "market clearing" is split across two programs with different meanings — oracle's epoch stamp vs trading's `clear_auction`. Worth renaming one to avoid confusion.
- `settle_offchain` trusts the off-chain matcher's `match_price` within the spread and skips market min/max; the sharded submit path skips price validation entirely. If min/max are meant to be hard invariants, close those two gaps.
- The THB peg depends entirely on an off-chain attestor posting an honest `attested_reserve` within TTL — the on-chain code cannot verify real reserves, only the ceiling and freshness.
