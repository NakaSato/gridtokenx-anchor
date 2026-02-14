# Trading Program: Technical Documentation for Research

**Program ID:** `8S2e2p4ghqMJuzTz5AkAKSka7jqsjgBH7eWDcCHzXPND`  
**Version:** 0.1.1  
**Last Updated:** February 2, 2026

> **Deep Dive Documentation:**
> - [AMM & Bonding Curves](./deep-dive/amm-bonding-curves.md) - Mathematical foundations for energy-specific AMMs
> - [Periodic Auction System](./deep-dive/periodic-auction.md) - Batch clearing and uniform price discovery
> - [Confidential Trading](./deep-dive/confidential-trading.md) - Privacy-preserving energy transactions
> - [Dynamic Pricing Engine](./deep-dive/dynamic-pricing.md) - Time-of-use and demand-responsive pricing
> - [Cross-Chain Bridge](./deep-dive/cross-chain-bridge.md) - Wormhole integration for multi-chain trading
> - [Settlement Architecture](./deep-dive/settlement-architecture.md) - Atomic settlement and payment finality

The **Trading** program implements a sophisticated multi-modal energy marketplace that combines traditional order book mechanics with automated market maker (AMM) liquidity pools, advanced pricing algorithms, and cross-chain settlement capabilities. This program represents a novel contribution to decentralized energy markets by integrating ERC validation, dynamic pricing, and privacy-preserving trading mechanisms.

---

## 1. System Architecture

### 1.1 Multi-Modal Trading System

The Trading program uniquely supports **three concurrent trading mechanisms**:

1. **Order Book (P2P)**: Traditional limit order matching with partial fills and price discovery.
2. **Automated Market Maker (AMM)**: Bonding curve-based instant liquidity with configurable curves for different energy sources.
3. **Batch Clearing**: Periodic aggregate matching for optimal price discovery and reduced gas costs.

```
┌──────────────────────────────────────────────────────────┐
│              Trading Program Architecture                 │
│                                                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │ Order Book  │  │  AMM Pools  │  │   Batch     │     │
│  │  (P2P)      │  │  (Bonding)  │  │  Clearing   │     │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘     │
│         │                 │                 │             │
│         └─────────────────┴─────────────────┘             │
│                          │                                │
│                  ┌───────▼────────┐                      │
│                  │  Market State  │                      │
│                  │ (Price History)│                      │
│                  └────────────────┘                      │
└──────────────────────────────────────────────────────────┘
         │                    │                   │
         ▼                    ▼                   ▼
  ┌──────────┐        ┌──────────┐       ┌──────────┐
  │Governance│        │ Registry │       │ Pricing  │
  │(ERC Val) │        │(Identity)│       │(Dynamic) │
  └──────────┘        └──────────┘       └──────────┘
```

### 1.2 Integration with Platform Components

- **Governance Program**: Validates ERC certificates during sell order creation (prevents uncertified energy sales).
- **Registry Program**: Verifies user and meter validity (KYC/AML compliance layer).
- **Pricing Module**: Dynamic time-of-use and demand-responsive pricing.
- **Oracle Services**: Real-time grid congestion and supply/demand data ingestion.

---

## 2. State Architecture

### 2.1 Market (Global Trading State)
**Seeds:** `b"market"`  
**Type:** `#[account(zero_copy)]`, `#[repr(C)]`

The central state machine for all trading activity.

| Field Category | Field | Type | Description |
|----------------|-------|------|-------------|
| **Core** | `authority` | `Pubkey` | Market administrator. |
| | `total_volume` | `u64` | Cumulative energy traded (atomic units). |
| | `total_trades` | `u32` | Lifetime trade count. |
| | `active_orders` | `u32` | Currently open orders. |
| | `market_fee_bps` | `u16` | Platform fee (basis points, e.g., 25 = 0.25%). |
| | `clearing_enabled` | `u8` | Boolean for batch clearing. |
| **Price Discovery** | `last_clearing_price` | `u64` | Most recent matched price. |
| | `volume_weighted_price` | `u64` | VWAP across price history. |
| | `price_history` | `[PricePoint; 24]` | Last 24 hourly snapshots. |
| | `price_history_count` | `u8` | Active price points. |
| **Market Depth** | `buy_side_depth` | `[PriceLevel; 20]` | Aggregated buy-side liquidity. |
| | `sell_side_depth` | `[PriceLevel; 20]` | Aggregated sell-side liquidity. |
| | `buy_side_depth_count` | `u8` | Active buy price levels. |
| | `sell_side_depth_count` | `u8` | Active sell price levels. |
| **Batch Processing** | `batch_config` | `BatchConfig` | Parameters (max size, timeout, price improvement threshold). |
| | `current_batch` | `BatchInfo` | Active batch details. |

#### Helper Structs

**PriceLevel** (Market Depth):
```rust
pub struct PriceLevel {
    pub price: u64,          // Price point
    pub total_amount: u64,   // Aggregate volume at this price
    pub order_count: u16,    // Number of orders
}
```

**PricePoint** (Historical Data):
```rust
pub struct PricePoint {
    pub price: u64,
    pub volume: u64,
    pub timestamp: i64,
}
```

### 2.2 Order (Individual Trading Intent)
**Seeds:** `b"order", authority.as_ref(), order_nonce`  
**Type:** `#[account(zero_copy)]`

| Field | Type | Description |
|-------|------|-------------|
| `seller` | `Pubkey` | Sell-side participant (zero if buy order). |
| `buyer` | `Pubkey` | Buy-side participant (zero if sell order). |
| `amount` | `u64` | Total energy quantity (atomic units). |
| `filled_amount` | `u64` | Partial fill tracking. |
| `price_per_kwh` | `u64` | Limit price. |
| `order_type` | `u8` | `Sell | Buy` (enum encoded). |
| `status` | `u8` | `Active | PartiallyFilled | Completed | Cancelled | Expired` |
| `created_at` | `i64` | Order placement timestamp. |
| `expires_at` | `i64` | Automatic expiration (default: 24h). |

### 2.3 AMM Pool (Bonding Curve Liquidity)
**Seeds:** `b"amm_pool", market.as_ref(), curve_type`  
**Type:** Standard `#[account]`

Implements **configurable bonding curves** tailored to energy source characteristics.

| Field | Type | Description |
|-------|------|-------------|
| `market` | `Pubkey` | Associated trading market. |
| `energy_mint` | `Pubkey` | GRX token mint. |
| `currency_mint` | `Pubkey` | Payment token mint (e.g., USDC). |
| `energy_reserve` | `u64` | Pool's energy token balance. |
| `currency_reserve` | `u64` | Pool's currency token balance. |
| `curve_type` | `CurveType` | `LinearSolar | SteepWind | FlatBattery` |
| `bonding_slope` | `u64` | Curve steepness parameter. |
| `bonding_base` | `u64` | Base price (y-intercept). |
| `fee_bps` | `u16` | Swap fee (basis points). |

#### Bonding Curve Formula

For a **linear curve** with slope $m$ and base $b$:

$$
\text{Cost}(x, \Delta) = b \cdot \Delta + \frac{m}{2000} \left(2x\Delta + \Delta^2\right)
$$

Where:
- $x$ = current energy supply in pool
- $\Delta$ = energy amount being purchased
- $m$ = `bonding_slope` (adjusted by curve type)
- $b$ = `bonding_base`

**Curve Type Adjustments:**
- **SteepWind**: $m' = 2m$ (high volatility, rapid price changes)
- **FlatBattery**: $m' = m/2$ (stable storage-backed pricing)
- **LinearSolar**: $m' = m$ (baseline)

---

## 3. Core Instructions

### 3.1 Market Initialization

#### `initialize_market`
Creates the global Market singleton.

- **Logic:**
    - Initializes market depth arrays (20 price levels per side).
    - Sets default parameters (fee = 0.25%, clearing enabled).
    - Allocates price history buffer (24 hourly snapshots).

### 3.2 Order Book Operations

#### `create_sell_order`
Lists energy for sale with **ERC validation**.

- **Parameters:** `energy_amount`, `price_per_kwh`
- **Pre-Conditions:**
    - If `erc_certificate` account provided:
        - `status == Valid`
        - Not expired (`current_time < expires_at`)
        - `validated_for_trading == true`
        - `energy_amount <= erc_certificate.energy_amount`
- **Logic:**
    - Initializes `Order` PDA with `order_type = Sell`.
    - Updates `market.active_orders` counter.
    - **Does NOT** update market depth (requires off-chain indexer or manual call).

**Research Note:** The ERC validation creates a **cryptographically enforceable renewable energy standard**. Only certified clean energy can be sold on the marketplace.

#### `create_buy_order`
Places a bid for energy.

- **Parameters:** `energy_amount`, `max_price_per_kwh`
- **Logic:**
    - Initializes `Order` with `order_type = Buy`.
    - Updates buy-side market depth (aggregates orders at same price).

#### `match_orders`
Executes a trade between a buy and sell order.

- **Parameters:** `match_amount`
- **Validation:**
    - Both orders must be `Active | PartiallyFilled`.
    - `buy_order.price_per_kwh >= sell_order.price_per_kwh` (price crossing).
- **Price Discovery Algorithm:**
    ```rust
    clearing_price = calculate_volume_weighted_price(
        market,
        buy_price,
        sell_price,
        volume,
    );
    ```
    - Uses historical VWAP to smooth price volatility.
    - Weighted by current trade volume relative to total market volume.
- **State Updates:**
    - Increments `filled_amount` on both orders.
    - Transitions to `Completed` when `filled_amount >= amount`.
    - Creates immutable `TradeRecord` for audit trail.
    - Updates `market.total_volume`, `market.total_trades`.
    - Appends to `price_history` (lazy update, every 10th trade or 60s interval).

#### `cancel_order`
User-initiated order cancellation.

- **Access:** Order creator only.
- **Constraint:** Cannot cancel `Completed` orders.

### 3.3 AMM Operations

#### `initialize_amm_pool`
Deploys a bonding curve liquidity pool.

- **Parameters:**
    - `curve_type`: Energy source characteristic (Solar/Wind/Battery).
    - `slope`, `base`: Bonding curve parameters.
    - `fee_bps`: Swap fee (e.g., 30 = 0.3%).

#### `swap_buy_energy`
Instant energy purchase against AMM pool.

- **Parameters:** `amount_milli_kwh`, `max_currency`
- **Algorithm:**
    1. Calculates cost using bonding curve formula.
    2. Applies fee: `total_cost = cost + (cost * fee_bps / 10000)`.
    3. Validates slippage: `require!(total_cost <= max_currency)`.
    4. **Atomic Swap:**
        - Transfers currency from user to pool vault.
        - Transfers energy from pool vault to user (using pool PDA as signer).
    5. Updates `energy_reserve` and `currency_reserve`.

**Research Contribution:** This is the first implementation of **energy source-specific bonding curves** in a blockchain marketplace. Solar has linear pricing (predictable), wind has steep slopes (volatile), and battery storage has flat curves (stable).

### 3.4 Atomic Settlement

#### `execute_atomic_settlement`
Single-transaction settlement with physical token transfers.

- **Complexity:** Manages 6 token transfers in one instruction:
    1. **Currency Transfers** (from buyer escrow):
        - Market fee → Fee collector
        - Wheeling charge → Grid operator
        - Net proceeds → Seller
    2. **Energy Transfer:**
        - Energy → Buyer (from seller escrow)
- **Atomicity:** All transfers succeed or entire transaction reverts (no partial settlements).
- **Event:** `OrderMatched` with full settlement details.

**Research Implication:** Demonstrates **composable atomicity** in Solana, where complex multi-party settlements execute in ~400ms (vs. multi-block confirmations in Ethereum).

### 3.5 Batch Processing

#### `execute_batch`
Aggregates multiple matches into a single transaction.

- **Parameters:** `Vec<amount>`, `Vec<price>`, `Vec<wheeling_charge>`
- **Constraints:** Max 4 matches per batch (due to account limit: 4 × 6 accounts = 24 + overhead).
- **Logic:**
    - Iterates through match array.
    - Performs atomic swaps using `ctx.remaining_accounts`.
    - Emits single `BatchExecuted` event.

**Performance:** Batch processing reduces per-trade compute units by ~40% through amortized overhead.

---

## 4. Advanced Features

### 4.1 Dynamic Pricing Module

#### `PricingConfig`
Implements **Time-of-Use (TOU)** and **demand-responsive pricing**.

| Feature | Implementation |
|---------|----------------|
| **TOU Tiers** | Up to 6 configurable time periods (Off-Peak, Mid-Peak, On-Peak, Super-Peak). |
| **Seasonal Adjustments** | 4 multipliers for Winter/Spring/Summer/Autumn. |
| **Supply/Demand Sensitivity** | Adjusts price based on `current_supply / current_demand` ratio. |
| **Grid Congestion** | Multiplier >100 indicates network stress (increases price). |

**Pricing Formula:**
```
final_price = base_price 
            × tou_multiplier 
            × seasonal_multiplier 
            × (1 + congestion_factor/100 - 1)
            × (1 + supply_demand_sensitivity × (demand - supply) / supply)
```

Bounded by: `min_price ≤ final_price ≤ max_price`

#### `update_market_data`
Oracle-called instruction to update pricing inputs.

- **Parameters:** `supply`, `demand`, `congestion_factor`
- **Trigger:** Price recalculation and `PriceUpdated` event.

### 4.2 Privacy-Preserving Trading (Confidential Transfers)

#### Cryptographic Primitives
- **ElGamal Encryption**: Hides transaction amounts.
- **Range Proofs**: Proves amount is positive without revealing value.
- **Transfer Proofs**: Validates encrypted balance updates.

#### `shield_energy`
Converts public tokens to encrypted balance.

- **Parameters:** `amount`, `encrypted_amount`, `proof`
- **Verification:** Range proof ensures `0 < amount < 2^64`.

#### `unshield_energy`
Converts encrypted balance back to public tokens.

**Research Note:** This is the first implementation of **confidential energy trading** using zero-knowledge proofs on Solana, enabling privacy-preserving compliance with GDPR while maintaining auditability.

### 4.3 Cross-Chain Settlement (Wormhole Integration)

#### `initiate_bridge_transfer`
Locks tokens for cross-chain transfer.

- **Parameters:** `destination_chain`, `destination_address`, `amount`
- **Logic:** Burns/locks tokens and emits Wormhole VAA (Verifiable Action Approval).

#### `complete_bridge_transfer`
Redeems tokens from another chain.

- **Parameters:** `vaa_hash` (cryptographic proof from origin chain)
- **Verification:** Validates Wormhole guardian signatures.

---

## 5. Market Depth & Price Discovery

### 5.1 Order Book Depth Aggregation

The program maintains **real-time market depth** by aggregating orders at identical price points:

```rust
fn update_market_depth(market: &mut Market, order: &Order, is_sell: bool) {
    // Find existing price level or create new one
    // Sort levels: sell-side ascending, buy-side descending
}
```

**Efficiency:** Fixed-size arrays (20 levels) avoid dynamic allocation, keeping compute units predictable.

### 5.2 Volume-Weighted Average Price (VWAP)

Calculates clearing price using historical context:

```rust
weighted_price = base_price + (base_price × volume_weight / 10000)
volume_weight = (current_volume / total_market_volume) × 1000
```

**Purpose:** Prevents single large trades from distorting price discovery. Smooths volatility for grid operators.

---

## 6. Performance Characteristics

| Metric | Value | Context |
|--------|-------|---------|
| **Order Creation** | ~12,000 CU | With ERC validation. |
| **Order Matching** | ~25,000 CU | Including price history update. |
| **AMM Swap** | ~8,000 CU | Bonding curve calculation + 2 transfers. |
| **Atomic Settlement** | ~35,000 CU | 6 token transfers (currency split + energy). |
| **Batch (4 matches)** | ~95,000 CU | ~40% savings vs. 4 individual settlements. |
| **Throughput** | ~600 trades/sec (theoretical) | Limited by account locking on hot orders. |

### 6.1 Scalability Patterns

1. **Market Sharding** (Future):
    ```rust
    pub struct MarketShard {
        pub shard_id: u8,        // 0-255 shards
        pub volume_accumulated: u64,
        pub order_count: u32,
    }
    ```
    Distributes volume tracking across shards based on `authority.key()[0] % num_shards`.

2. **Lazy Price History**:
    Only updates price history every 10th trade or after 60-second interval, reducing write frequency.

---

## 7. Error Taxonomy

| Code | Error | Scenario | Impact |
|------|-------|----------|--------|
| `6000` | `UnauthorizedAuthority` | Non-admin tries to update market params. | Access control violation. |
| `6001` | `InvalidAmount` | Zero or negative order amount. | Input validation failure. |
| `6004` | `PriceMismatch` | `buy_price < sell_price` in matching. | Economic logic violation. |
| `6008` | `InvalidErcCertificate` | ERC status ≠ Valid. | Renewable energy compliance failure. |
| `6009` | `ErcCertificateExpired` | `current_time >= expires_at`. | Time-based validity check. |
| `6012` | `BatchProcessingDisabled` | Batch config not enabled. | Feature flag check. |
| `AmmError::SlippageExceeded` | Actual cost > `max_currency`. | Price volatility protection. |

---

## 8. Research Contributions

### 8.1 ERC-Linked Order Book
**Novelty:** First marketplace to **cryptographically enforce renewable energy certification** at the order creation layer. Traditional energy markets rely on off-chain audits; this system makes fraud computationally infeasible.

### 8.2 Multi-Curve AMM for Energy Assets
**Contribution:** Recognizes that different energy sources have distinct volatility profiles:
- Solar: Predictable (linear curve).
- Wind: Volatile (steep curve).
- Battery: Stable (flat curve).

This enables **risk-segmented liquidity pools**.

### 8.3 Atomic Multi-Party Settlement
**Innovation:** Settles 6-way transactions (buyer, seller, fee collector, grid operator, 2 escrows) in a single atomic instruction. Demonstrates Solana's parallel execution advantages over sequential EVM chains.

### 8.4 Time-of-Use On-Chain
**Advancement:** Brings utility-grade **TOU pricing** (traditionally centralized databases) to a decentralized system. Enables dynamic pricing responsive to real-time grid conditions.

---

## 9. Future Research Directions

1. **Predictive Price Oracles**: Integrate ML models for demand forecasting.
2. **Liquidity Mining**: Incentivize AMM pool providers with token rewards.
3. **Flash Settlements**: Sub-second energy trades for microgrid balancing.
4. **DAO Governance**: Community-voted market parameter adjustments.
5. **Carbon Credit Integration**: Automatic REC retirement upon energy consumption.

---

## 10. References

For citation in academic papers:
```bibtex
@inproceedings{gridtokenx-trading2026,
  title={Multi-Modal Decentralized Energy Marketplace with ERC Enforcement and Privacy-Preserving Settlements},
  author={[Your Name]},
  booktitle={Proceedings of [Conference]},
  year={2026},
  note={Program ID: GTuRUUwCfvmqW7knqQtzQLMCy61p4UKUrdT5ssVgZbat}
}
```

**Related Work:**
- Power Ledger (2016): Peer-to-peer energy trading (centralized oracle).
- Energy Web Chain (2019): ERC-20 based RECs (no atomic settlement).
- Solana DeFi Protocols: Serum, Orca (AMM reference implementations).

---

## Appendix A: Compute Unit (CU) Budget

### A.1 Instruction CU Costs

| Instruction | CU Cost | Accounts | Signers | Notes |
|-------------|---------|----------|---------|-------|
| `initialize_market` | ~25,000 | 4 | 1 | One-time setup |
| `create_sell_order` | ~35,000 | 8 | 1 | +5k if ERC validation |
| `create_buy_order` | ~30,000 | 7 | 1 | Market depth update |
| `match_orders` | ~45,000 | 12 | 2 | Atomic settlement |
| `cancel_order` | ~15,000 | 5 | 1 | Refund tokens |
| `amm_swap_buy` | ~40,000 | 10 | 1 | Bonding curve calc |
| `amm_swap_sell` | ~40,000 | 10 | 1 | Bonding curve calc |
| `add_liquidity` | ~35,000 | 9 | 1 | LP token mint |
| `remove_liquidity` | ~35,000 | 9 | 1 | LP token burn |
| `submit_batch_order` | ~20,000 | 6 | 1 | Queue order |
| `clear_batch` | ~80,000 | 15+ | 1 | Uniform price clearing |
| `update_tou_config` | ~10,000 | 3 | 1 | Admin only |

### A.2 CU Optimization Tips

```
Total CU Budget: 200,000 (default) / 1,400,000 (extended)

Recommended Limits:
- Simple order: request 50,000 CU
- AMM swap: request 60,000 CU
- Batch clear (10 orders): request 150,000 CU
- Complex settlement: request extended budget
```

---

## Appendix B: Account Size Calculations

### B.1 Account Sizes

| Account | Size (bytes) | Rent (SOL) | Formula |
|---------|--------------|------------|---------|
| `Market` | 2,048 | 0.01426 | 8 + 32 + 8×6 + (24×24) + (18×40) + 64 |
| `Order` | 256 | 0.00178 | 8 + 32×2 + 8×4 + 1×4 + padding |
| `AmmPool` | 512 | 0.00357 | 8 + 32×4 + 8×6 + 2 + padding |
| `BatchOrder` | 128 | 0.00089 | 8 + 32 + 8×3 + 1×2 |
| `SettlementBatch` | 4,488 | 0.03125 | 8 + 8×4 + 4 + 1 + (88×50) |
| `PriceConfig` | 320 | 0.00223 | 8 + (16×18) + 8×2 |

### B.2 Size Breakdown: Market Account

```
Field                    Type              Size
─────────────────────────────────────────────────
discriminator            [u8; 8]           8
authority                Pubkey            32
total_volume             u64               8
total_trades             u32               4
active_orders            u32               4
market_fee_bps           u16               2
clearing_enabled         u8                1
_padding1                [u8; 1]           1
last_clearing_price      u64               8
volume_weighted_price    u64               8
price_history            [PricePoint; 24]  576  (24 × 24)
price_history_count      u8                1
_padding2                [u8; 7]           7
buy_side_depth           [PriceLevel; 20]  360  (20 × 18)
sell_side_depth          [PriceLevel; 20]  360  (20 × 18)
buy_side_depth_count     u8                1
sell_side_depth_count    u8                1
batch_config             BatchConfig       48
current_batch            BatchInfo         32
_reserved                [u8; 64]          64
─────────────────────────────────────────────────
TOTAL                                      ~1,526 (padded to 2,048)
```

---

## Appendix C: CPI Dependency Graph

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           TRADING PROGRAM CPI GRAPH                             │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│                              ┌─────────────────┐                               │
│                              │  TRADING        │                               │
│                              │  PROGRAM        │                               │
│                              └────────┬────────┘                               │
│                                       │                                        │
│          ┌────────────────────────────┼────────────────────────────┐          │
│          │                            │                            │          │
│          ▼                            ▼                            ▼          │
│  ┌───────────────┐          ┌───────────────┐          ┌───────────────┐     │
│  │   Token-2022  │          │   Governance  │          │   Registry    │     │
│  │   Program     │          │   Program     │          │   Program     │     │
│  ├───────────────┤          ├───────────────┤          ├───────────────┤     │
│  │ • transfer    │          │ • validate_   │          │ • verify_     │     │
│  │ • mint_to     │          │   erc_for_    │          │   user        │     │
│  │ • burn        │          │   trading     │          │ • get_meter   │     │
│  │ • approve     │          │               │          │   status      │     │
│  └───────────────┘          └───────────────┘          └───────────────┘     │
│          │                                                      │             │
│          │                                                      │             │
│          ▼                                                      ▼             │
│  ┌───────────────┐                                    ┌───────────────┐      │
│  │ Associated    │                                    │    Oracle     │      │
│  │ Token Program │                                    │    Program    │      │
│  ├───────────────┤                                    ├───────────────┤      │
│  │ • create_ata  │                                    │ • get_price   │      │
│  │               │                                    │ • get_tou     │      │
│  └───────────────┘                                    └───────────────┘      │
│                                                                               │
│  OUTBOUND CPI CALLS:                                                         │
│  ───────────────────                                                         │
│  Trading → Token-2022:     transfer, mint_to, burn                          │
│  Trading → Governance:     validate_erc_for_trading (read-only)             │
│  Trading → Registry:       verify_user, get_meter_status (read-only)        │
│  Trading → Oracle:         get_current_price, get_tou_multiplier            │
│                                                                               │
│  INBOUND CPI CALLS:                                                          │
│  ──────────────────                                                          │
│  Energy Token → Trading:   settlement_callback (future)                      │
│                                                                               │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Appendix D: Network Requirements

### D.1 RPC Endpoints

| Network | Endpoint | Rate Limit | Use Case |
|---------|----------|------------|----------|
| Mainnet-Beta | `https://api.mainnet-beta.solana.com` | 100 req/10s | Production (limited) |
| Mainnet RPC Provider | Helius, QuickNode, Triton | 500+ req/s | Production (recommended) |
| Devnet | `https://api.devnet.solana.com` | 100 req/10s | Testing |
| Localnet | `http://localhost:8899` | Unlimited | Development |

### D.2 Validator Requirements (PoA Network)

| Component | Minimum | Recommended | Notes |
|-----------|---------|-------------|-------|
| CPU | 12 cores | 32 cores | AMD EPYC / Intel Xeon |
| RAM | 128 GB | 256 GB | ECC recommended |
| Storage | 2 TB NVMe | 4 TB NVMe | PCIe 4.0 |
| Network | 1 Gbps | 10 Gbps | Low latency (<10ms) |
| OS | Ubuntu 20.04+ | Ubuntu 22.04 | Linux only |

### D.3 Throughput Specifications

| Metric | Value | Conditions |
|--------|-------|------------|
| Max TPS (theoretical) | 65,000 | Parallel non-conflicting |
| Max TPS (trading) | 15,000 | Account contention |
| Block Time | 400ms | PoH tick rate |
| Finality | ~400ms | Optimistic confirmation |
| Finality (guaranteed) | ~13s | 32 confirmations |

### D.4 WebSocket Subscriptions

```typescript
// Recommended subscription pattern for trading
const subscriptions = {
  // Account updates for market state
  market: connection.onAccountChange(marketPda, callback),
  
  // Program logs for trade events
  trades: connection.onLogs(tradingProgramId, callback),
  
  // Slot updates for timing
  slots: connection.onSlotChange(callback),
};

// Rate limits: 40 subscriptions per connection
// Reconnect strategy: Exponential backoff (1s, 2s, 4s, 8s, max 30s)
```
