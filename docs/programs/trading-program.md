# Trading Program - Technical Specification v1.0

> GridTokenX P2P Energy Trading Marketplace with Order Book Management and ERC Certificate Validation

## Overview

The Trading Program implements a peer-to-peer (P2P) energy trading marketplace on the GridTokenX platform. It provides a complete order book management system with support for buy/sell orders, order matching, ERC certificate validation for renewable energy verification, batch processing capabilities, and sophisticated volume-weighted price discovery mechanisms.

**Program ID:** `9t3s8sCgVUG9kAgVPsozj8mDpJp9cy6SF5HwRK5nvAHb`

---

## Architecture

### System Design

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         TRADING PROGRAM                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────┐    ┌──────────────────┐    ┌────────────────┐          │
│  │     Market      │    │   Order Book     │    │ Trade Records  │          │
│  │     (PDA)       │    │   Management     │    │                │          │
│  │                 │    │                  │    │                │          │
│  │ • Authority     │    │ • Buy Orders     │    │ • Buyer/Seller │          │
│  │ • Active Orders │    │ • Sell Orders    │    │ • Amount/Price │          │
│  │ • Total Volume  │    │ • Price Levels   │    │ • Fee Amount   │          │
│  │ • Total Trades  │    │ • Market Depth   │    │ • Timestamp    │          │
│  └─────────────────┘    └──────────────────┘    └────────────────┘          │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                    ORDER MATCHING ENGINE                                 ││
│  │  Buy Order + Sell Order → Price Validation → Trade Execution            ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                    ERC CERTIFICATE VALIDATION                            ││
│  │  Sell Orders require valid ERC Certificate for renewable verification   ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                    BATCH PROCESSING                                      ││
│  │  Configurable batch execution for high-throughput trading               ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                    PRICE DISCOVERY                                       ││
│  │  Volume-weighted average pricing with historical tracking               ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                    EXTERNAL PROGRAMS                                     ││
│  │  • Governance Program (ERC Certificate validation)                      ││
│  │  • System Program (Account creation)                                    ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Core Components

| Component | Purpose | Key Features |
|-----------|---------|--------------|
| **Market** | Trading marketplace configuration and state | authority, active_orders, total_volume, total_trades, fee settings |
| **Order** | Individual buy/sell order representation | seller/buyer, amount, price, status, expiration |
| **TradeRecord** | Completed trade documentation | matched orders, parties, settlement details, fees |
| **BatchConfig** | Batch processing configuration | enabled, max_batch_size, timeout, price improvement threshold |
| **PriceLevel** | Order book depth at price point | price, total_amount, order_count |
| **PricePoint** | Historical price data point | price, volume, timestamp |

---

## Program Metadata

| Property | Value |
|----------|-------|
| **Program ID** | `9t3s8sCgVUG9kAgVPsozj8mDpJp9cy6SF5HwRK5nvAHb` |
| **Framework** | Anchor v0.32.1 |
| **Language** | Rust |
| **Network** | Solana (Private Network) |
| **Version** | 1.0.0 |
| **Instructions** | 8 |
| **Accounts** | 5 (Market, Order, TradeRecord, BatchConfig, BatchInfo) |
| **Default Market Fee** | 0.25% (25 basis points) |
| **Order Expiration** | 24 hours |
| **Dependencies** | anchor-lang, base64, governance (ErcCertificate) |

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Theoretical Foundation](#theoretical-foundation)
4. [Account Structures](#account-structures)
5. [Instructions](#instructions)
6. [ERC Certificate Validation](#erc-certificate-validation)
7. [Order Book Management](#order-book-management)
8. [Price Discovery Mechanism](#price-discovery-mechanism)
9. [Batch Processing](#batch-processing)
10. [Events](#events)
11. [Error Handling](#error-handling)
12. [Security Model](#security-model)
13. [Cross-Program Integration](#cross-program-integration)
14. [Performance Characteristics](#performance-characteristics)

---

## Theoretical Foundation

### P2P Energy Trading Model

The Trading Program implements a decentralized peer-to-peer energy marketplace where:

$$\text{Trade Value} = \text{Energy Amount (kWh)} \times \text{Clearing Price (tokens/kWh)}$$

**Key Properties:**
- **Bilateral Matching**: Direct buyer-seller order matching
- **Price Discovery**: Market-driven clearing prices
- **Partial Fills**: Orders can be partially matched
- **Renewable Verification**: ERC certificates ensure green energy provenance

### Order Book Dynamics

The order book maintains two-sided depth:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ORDER BOOK STRUCTURE                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   BUY SIDE (Bids)                      SELL SIDE (Asks)                     │
│   ═══════════════                      ════════════════                     │
│   Price │ Amount │ Orders              Price │ Amount │ Orders              │
│   ──────┼────────┼────────             ──────┼────────┼────────             │
│   105   │ 500    │ 3      ◀── Best     100   │ 300    │ 2      ◀── Best     │
│   104   │ 800    │ 5      Bid          101   │ 450    │ 4      Ask          │
│   103   │ 1200   │ 8                   102   │ 600    │ 3                   │
│   102   │ 600    │ 4                   103   │ 900    │ 6                   │
│   ...   │ ...    │ ...                 ...   │ ...    │ ...                 │
│                                                                              │
│   Sorted: Descending                   Sorted: Ascending                    │
│   (Highest bid first)                  (Lowest ask first)                   │
│                                                                              │
│   Market Spread = Best Ask - Best Bid = 100 - 105 = -5 (Crossed)            │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Volume-Weighted Average Price (VWAP)

The clearing price is determined using volume-weighted averaging:

$$\text{VWAP} = \frac{\sum_{i=1}^{n} P_i \times V_i}{\sum_{i=1}^{n} V_i}$$

Where:
- $P_i$ = Price at trade $i$
- $V_i$ = Volume at trade $i$
- $n$ = Number of trades in history

**Implementation:**
```rust
fn calculate_volume_weighted_price(
    market: &Market,
    buy_price: u64,
    sell_price: u64,
    volume: u64,
) -> u64 {
    let base_price = (buy_price + sell_price) / 2;
    
    if market.total_volume > 0 {
        let weight_factor = (volume as f64 / market.total_volume as f64).min(1.0);
        let weighted_adjustment = (base_price as f64 * weight_factor * 0.1) as u64;
        base_price.saturating_add(weighted_adjustment)
    } else {
        base_price
    }
}
```

### Fee Structure

Trading fees are calculated in basis points:

$$\text{Fee Amount} = \frac{\text{Total Value} \times \text{Fee (bps)}}{10000}$$

Default fee: 25 bps = 0.25%

| Fee Rate | Basis Points | Example (1000 tokens trade) |
|----------|--------------|----------------------------|
| 0.10% | 10 bps | 1 token |
| 0.25% | 25 bps | 2.5 tokens |
| 0.50% | 50 bps | 5 tokens |
| 1.00% | 100 bps | 10 tokens |

---

## Account Structures

### Market Account

Global marketplace configuration and statistics.

| Field | Type | Size | Description |
|-------|------|------|-------------|
| `authority` | Pubkey | 32 bytes | Market administrator |
| `active_orders` | u64 | 8 bytes | Count of active orders |
| `total_volume` | u64 | 8 bytes | Cumulative traded volume (kWh) |
| `total_trades` | u64 | 8 bytes | Total completed trades |
| `created_at` | i64 | 8 bytes | Market creation timestamp |
| `clearing_enabled` | bool | 1 byte | Whether matching is enabled |
| `market_fee_bps` | u16 | 2 bytes | Trading fee in basis points |
| `batch_config` | BatchConfig | Variable | Batch processing settings |
| `current_batch` | Option<BatchInfo> | Variable | Active batch if any |
| `buy_side_depth` | Vec<PriceLevel> | Variable | Top 20 buy price levels |
| `sell_side_depth` | Vec<PriceLevel> | Variable | Top 20 sell price levels |
| `last_clearing_price` | u64 | 8 bytes | Most recent trade price |
| `price_history` | Vec<PricePoint> | Variable | Last 100 price points |
| `volume_weighted_price` | u64 | 8 bytes | Current VWAP |

**PDA Seeds:** `[b"market"]`

### Order Account

Individual order representation.

| Field | Type | Size | Description |
|-------|------|------|-------------|
| `seller` | Pubkey | 32 bytes | Seller address (for sell orders) |
| `buyer` | Pubkey | 32 bytes | Buyer address (for buy orders) |
| `amount` | u64 | 8 bytes | Order quantity in kWh |
| `filled_amount` | u64 | 8 bytes | Matched quantity |
| `price_per_kwh` | u64 | 8 bytes | Price limit (tokens per kWh) |
| `order_type` | OrderType | 1 byte | Buy or Sell |
| `status` | OrderStatus | 1 byte | Active, PartiallyFilled, Completed, Cancelled, Expired |
| `created_at` | i64 | 8 bytes | Order creation timestamp |
| `expires_at` | i64 | 8 bytes | Order expiration timestamp |

**PDA Seeds:** `[b"order", authority.key(), market.active_orders.to_le_bytes()]`

### TradeRecord Account

Completed trade documentation.

| Field | Type | Size | Description |
|-------|------|------|-------------|
| `sell_order` | Pubkey | 32 bytes | Matched sell order |
| `buy_order` | Pubkey | 32 bytes | Matched buy order |
| `seller` | Pubkey | 32 bytes | Seller wallet |
| `buyer` | Pubkey | 32 bytes | Buyer wallet |
| `amount` | u64 | 8 bytes | Matched quantity |
| `price_per_kwh` | u64 | 8 bytes | Execution price |
| `total_value` | u64 | 8 bytes | Total trade value |
| `fee_amount` | u64 | 8 bytes | Fee charged |
| `executed_at` | i64 | 8 bytes | Execution timestamp |

**PDA Seeds:** `[b"trade", buy_order.key(), sell_order.key()]`

### BatchConfig Account

Batch processing configuration.

| Field | Type | Size | Description |
|-------|------|------|-------------|
| `enabled` | bool | 1 byte | Batch mode enabled flag |
| `max_batch_size` | u32 | 4 bytes | Maximum orders per batch |
| `batch_timeout_seconds` | u32 | 4 bytes | Auto-execute timeout |
| `min_batch_size` | u32 | 4 bytes | Minimum orders to trigger batch |
| `price_improvement_threshold` | u16 | 2 bytes | Required price improvement % |

**Default Values:**
- `enabled`: false
- `max_batch_size`: 100
- `batch_timeout_seconds`: 300 (5 minutes)
- `min_batch_size`: 5
- `price_improvement_threshold`: 5 (5%)

### BatchInfo Account

Active batch state.

| Field | Type | Size | Description |
|-------|------|------|-------------|
| `batch_id` | u64 | 8 bytes | Unique batch identifier |
| `order_count` | u32 | 4 bytes | Orders in batch |
| `total_volume` | u64 | 8 bytes | Cumulative batch volume |
| `created_at` | i64 | 8 bytes | Batch creation time |
| `expires_at` | i64 | 8 bytes | Batch expiration time |
| `order_ids` | Vec<Pubkey> | Variable | List of order PDAs (max 50) |

### Supporting Data Structures

#### PriceLevel
```rust
pub struct PriceLevel {
    pub price: u64,        // Price point
    pub total_amount: u64, // Aggregate volume at this price
    pub order_count: u32,  // Number of orders
}
```

#### PricePoint
```rust
pub struct PricePoint {
    pub price: u64,     // Execution price
    pub volume: u64,    // Trade volume
    pub timestamp: i64, // Trade timestamp
}
```

### Enumerations

#### OrderType
```rust
pub enum OrderType {
    Sell,  // Prosumer selling energy
    Buy,   // Consumer buying energy
}
```

#### OrderStatus
```rust
pub enum OrderStatus {
    Active,          // Open for matching
    PartiallyFilled, // Some quantity matched
    Completed,       // Fully matched
    Cancelled,       // User cancelled
    Expired,         // Past expiration
}
```

---

## Instructions

### Instruction Summary (7 Total)

| # | Instruction | Type | Authority | State Changes |
|---|-------------|------|-----------|---------------|
| 1 | `initialize` | Admin | Any | Logs initialization |
| 2 | `initialize_market` | Write | Deployer | Creates Market PDA |
| 3 | `create_sell_order` | Write | Prosumer | Creates sell order with ERC validation |
| 4 | `create_buy_order` | Write | Consumer | Creates buy order |
| 5 | `match_orders` | Write | Any | Matches buy/sell, creates TradeRecord |
| 6 | `cancel_order` | Write | Order Owner | Cancels active order |
| 7 | `update_market_params` | Admin | Authority | Updates market settings |
| 8 | `execute_batch` | Write | Any | Processes batch of orders |

---

### 1. initialize

Simple program initialization that logs a message.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `authority` | Signer | Program authority |

**State Changes:** None (logs only)

**Events Emitted:** None

---

### 2. initialize_market

Creates the trading market with initial configuration.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `market` | PDA (init) | Market configuration - seeds: `[b"market"]` |
| `authority` | Signer (mut) | Market authority and payer |
| `system_program` | Program | System program |

**State Changes:**
- Creates Market account with:
  - `authority` = signer
  - `active_orders` = 0
  - `total_volume` = 0
  - `total_trades` = 0
  - `clearing_enabled` = true
  - `market_fee_bps` = 25 (0.25%)
  - `batch_config` = default (disabled)
  - Empty order book depth vectors
  - `volume_weighted_price` = 0

**Events Emitted:** `MarketInitialized`

---

### 3. create_sell_order

Creates a sell order for energy with optional ERC certificate validation.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `market` | Account (mut) | Market state |
| `order` | PDA (init) | New order - seeds: `[b"order", authority, active_orders]` |
| `erc_certificate` | Option<Account> | Optional ERC certificate from Governance program |
| `authority` | Signer (mut) | Seller and payer |
| `system_program` | Program | System program |

**Arguments:**

| Argument | Type | Constraints | Description |
|----------|------|-------------|-------------|
| `energy_amount` | u64 | > 0 | Amount to sell (kWh) |
| `price_per_kwh` | u64 | > 0 | Minimum price per kWh |

**ERC Validation (when certificate provided):**
1. Certificate status must be `Valid`
2. Certificate must not be expired
3. Certificate must be `validated_for_trading`
4. Energy amount must not exceed certificate amount

**State Changes:**
- Creates Order account with sell order details
- Increments `market.active_orders`
- Updates sell side market depth

**Events Emitted:** `SellOrderCreated`

**Base64 Encoding:**
Order data is encoded and logged for external system integration:
```
SELL:${amount}:${price}:${seller_pubkey}
```

---

### 4. create_buy_order

Creates a buy order for energy.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `market` | Account (mut) | Market state |
| `order` | PDA (init) | New order - seeds: `[b"order", authority, active_orders]` |
| `authority` | Signer (mut) | Buyer and payer |
| `system_program` | Program | System program |

**Arguments:**

| Argument | Type | Constraints | Description |
|----------|------|-------------|-------------|
| `energy_amount` | u64 | > 0 | Amount to buy (kWh) |
| `max_price_per_kwh` | u64 | > 0 | Maximum price per kWh |

**State Changes:**
- Creates Order account with buy order details
- Increments `market.active_orders`
- Updates buy side market depth

**Events Emitted:** `BuyOrderCreated`

**Base64 Encoding:**
Order data is encoded and logged for external system integration:
```
BUY:${amount}:${max_price}:${buyer_pubkey}
```

---

### 5. match_orders

Matches a buy order with a sell order, creating a trade record.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `market` | Account (mut) | Market state |
| `buy_order` | Account (mut) | Existing buy order |
| `sell_order` | Account (mut) | Existing sell order |
| `trade_record` | PDA (init) | New trade - seeds: `[b"trade", buy_order, sell_order]` |
| `authority` | Signer (mut) | Matcher and payer |
| `system_program` | Program | System program |

**Arguments:**

| Argument | Type | Constraints | Description |
|----------|------|-------------|-------------|
| `match_amount` | u64 | > 0 | Amount to match |

**Matching Algorithm:**
```
1. Validate both orders are Active or PartiallyFilled
2. Validate price compatibility: buy_price >= sell_price
3. Calculate actual match amount:
   actual = min(match_amount, buy_remaining, sell_remaining)
4. Compute clearing price using VWAP
5. Calculate total value and fees
6. Update order fill amounts and statuses
7. Create trade record
8. Update market statistics and price history
```

**State Changes:**
- Updates both orders' `filled_amount` and `status`
- Creates TradeRecord account
- Updates `market.total_volume`, `market.total_trades`
- Updates `market.last_clearing_price`
- Appends to `market.price_history`
- Updates `market.volume_weighted_price`

**Events Emitted:** `OrderMatched`

---

### 6. cancel_order

Cancels an active or partially filled order.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `market` | Account (mut) | Market state |
| `order` | Account (mut) | Order to cancel |
| `authority` | Signer | Order owner |

**Validation:**
- Authority must be the order owner (buyer or seller)
- Order must be Active or PartiallyFilled

**State Changes:**
- Sets `order.status` = Cancelled
- Decrements `market.active_orders`

**Events Emitted:** `OrderCancelled`

---

### 7. update_market_params

Updates market configuration parameters (admin only).

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `market` | Account (mut, has_one = authority) | Market state |
| `authority` | Signer | Must match `market.authority` |

**Arguments:**

| Argument | Type | Description |
|----------|------|-------------|
| `market_fee_bps` | u16 | New fee in basis points |
| `clearing_enabled` | bool | Enable/disable order matching |

**State Changes:**
- Updates `market.market_fee_bps`
- Updates `market.clearing_enabled`

**Events Emitted:** `MarketParamsUpdated`

---

### 8. execute_batch

Executes a batch of orders together.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `market` | Account (mut) | Market state |
| `authority` | Signer (mut) | Batch executor |

**Arguments:**

| Argument | Type | Description |
|----------|------|-------------|
| `order_ids` | Vec<Pubkey> | List of order PDAs to process |

**Validation:**
- Batch processing must be enabled
- Batch size must not exceed `max_batch_size`

**State Changes:**
- Creates BatchInfo with processed orders
- Sets `market.current_batch`

**Events Emitted:** `BatchExecuted`

---

## ERC Certificate Validation

### Integration with Governance Program

The Trading Program validates ERC certificates from the Governance Program to ensure renewable energy provenance:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ERC CERTIFICATE VALIDATION FLOW                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Prosumer creates sell order                                               │
│            │                                                                │
│            ▼                                                                │
│   ┌─────────────────────────────────────────────────────────────────┐      │
│   │                 ERC CERTIFICATE CHECKS                           │      │
│   │                                                                  │      │
│   │   1. Status == Valid? ─────────────┬─────▶ Yes                   │      │
│   │                                    │       │                     │      │
│   │   2. Not Expired? ─────────────────┤       │                     │      │
│   │      (now < expires_at)            │       ▼                     │      │
│   │                                    │   3. validated_for_trading  │      │
│   │   4. Amount <= Certificate?        │       == true?              │      │
│   │      (energy_amount <=             │       │                     │      │
│   │       certificate.energy_amount)   │       ▼                     │      │
│   │                                    │   All Checks Pass           │      │
│   │   Any Check Fails ◀────────────────┘       │                     │      │
│   │        │                                   │                     │      │
│   │        ▼                                   ▼                     │      │
│   │   Return Error                   Create Sell Order              │      │
│   │                                                                  │      │
│   └─────────────────────────────────────────────────────────────────┘      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### ERC Certificate Fields Used

```rust
pub struct ErcCertificate {
    pub certificate_id: String,       // Unique identifier
    pub status: ErcStatus,            // Valid, Revoked, Expired
    pub energy_amount: u64,           // Certified kWh
    pub expires_at: Option<i64>,      // Expiration timestamp
    pub validated_for_trading: bool,  // Trading authorization flag
}
```

### Validation Errors

| Error | Code | Trigger |
|-------|------|---------|
| `InvalidErcCertificate` | 6008 | Certificate status ≠ Valid |
| `ErcCertificateExpired` | 6009 | Current time ≥ expires_at |
| `ErcNotValidatedForTrading` | 6010 | validated_for_trading = false |
| `ExceedsErcAmount` | 6011 | Order amount > certificate amount |

---

## Order Book Management

### Market Depth Tracking

The Trading Program maintains top 20 price levels for each side:

```rust
fn update_market_depth(market: &mut Market, order: &Order, is_sell: bool) -> Result<()> {
    let price_levels = if is_sell {
        &mut market.sell_side_depth
    } else {
        &mut market.buy_side_depth
    };

    // Update or create price level
    if let Some(level) = price_levels.iter_mut().find(|pl| pl.price == price) {
        level.total_amount += amount;
        level.order_count += 1;
    } else {
        price_levels.push(PriceLevel { price, total_amount, order_count: 1 });
    }

    // Sort and truncate to top 20
    price_levels.sort_by(|a, b| {
        if is_sell { a.price.cmp(&b.price) }      // Ascending for asks
        else       { b.price.cmp(&a.price) }      // Descending for bids
    });

    if price_levels.len() > 20 {
        price_levels.truncate(20);
    }

    Ok(())
}
```

### Order Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ORDER LIFECYCLE                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌────────┐     create_order      ┌────────┐                               │
│   │  None  │ ───────────────────▶  │ Active │                               │
│   └────────┘                       └────┬───┘                               │
│                                         │                                   │
│                      ┌──────────────────┼──────────────────┐                │
│                      │                  │                  │                │
│                      │ match_orders     │ match_orders     │ cancel_order   │
│                      │ (partial)        │ (complete)       │                │
│                      ▼                  ▼                  ▼                │
│               ┌──────────────┐   ┌───────────┐      ┌───────────┐          │
│               │ Partially    │   │ Completed │      │ Cancelled │          │
│               │ Filled       │   └───────────┘      └───────────┘          │
│               └──────┬───────┘                                              │
│                      │                                                      │
│           ┌──────────┴──────────┐                                           │
│           │                     │                                           │
│           │ match_orders        │ cancel_order                              │
│           │ (complete)          │                                           │
│           ▼                     ▼                                           │
│     ┌───────────┐        ┌───────────┐                                      │
│     │ Completed │        │ Cancelled │                                      │
│     └───────────┘        └───────────┘                                      │
│                                                                              │
│   Time-based expiration: 24 hours after creation                            │
│   expires_at = created_at + 86400                                           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Price Discovery Mechanism

### Clearing Price Calculation

The clearing price is determined through a two-step process:

**Step 1: Base Price Calculation**
$$\text{Base Price} = \frac{\text{Buy Price} + \text{Sell Price}}{2}$$

**Step 2: Volume-Weighted Adjustment**
$$\text{Clearing Price} = \text{Base Price} + \text{Base Price} \times \min\left(\frac{V_{\text{trade}}}{V_{\text{total}}}, 1\right) \times 0.1$$

Where:
- $V_{\text{trade}}$ = Current trade volume
- $V_{\text{total}}$ = Total market volume

### Price History Tracking

```rust
fn update_price_history(
    market: &mut Market,
    price: u64,
    volume: u64,
    timestamp: i64,
) -> Result<()> {
    // Add new price point
    market.price_history.push(PricePoint { price, volume, timestamp });

    // Keep only last 100 points
    if market.price_history.len() > 100 {
        market.price_history.remove(0);
    }

    // Recalculate VWAP
    let total_volume: u64 = market.price_history.iter().map(|p| p.volume).sum();
    let weighted_sum: u64 = market.price_history.iter()
        .map(|p| p.price * p.volume).sum();

    if total_volume > 0 {
        market.volume_weighted_price = weighted_sum / total_volume;
    }

    Ok(())
}
```

### Market Statistics Available

| Metric | Description | Update Frequency |
|--------|-------------|------------------|
| `total_volume` | Cumulative traded kWh | Every match |
| `total_trades` | Count of completed trades | Every match |
| `last_clearing_price` | Most recent execution price | Every match |
| `volume_weighted_price` | VWAP over last 100 trades | Every match |
| `price_history` | Last 100 price points | Every match |

---

## Batch Processing

### Configuration

Batch processing allows grouping multiple orders for efficient execution:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       BATCH PROCESSING                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   BatchConfig:                                                               │
│   ┌───────────────────────────────────────────────────────────────┐         │
│   │ enabled: false                 (Toggle batch mode)            │         │
│   │ max_batch_size: 100            (Maximum orders per batch)     │         │
│   │ batch_timeout_seconds: 300     (5 minute auto-execute)        │         │
│   │ min_batch_size: 5              (Minimum orders to trigger)    │         │
│   │ price_improvement_threshold: 5 (5% improvement required)      │         │
│   └───────────────────────────────────────────────────────────────┘         │
│                                                                              │
│   Batch Execution Flow:                                                      │
│   ═════════════════════                                                      │
│                                                                              │
│   ┌─────────┐    Collect     ┌─────────┐    Timeout/    ┌─────────┐        │
│   │ Orders  │ ─────────────▶ │  Batch  │ ────────────▶  │ Execute │        │
│   │ Queue   │     Orders     │ Pending │   Min Size     │  Batch  │        │
│   └─────────┘                └─────────┘                └─────────┘        │
│                                                                              │
│   Benefits:                                                                  │
│   • Reduced transaction costs                                               │
│   • Better price discovery across multiple orders                           │
│   • Fairness in execution (batch auction model)                             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Batch Execution

```rust
pub fn execute_batch(ctx: Context<ExecuteBatch>, order_ids: Vec<Pubkey>) -> Result<()> {
    let market = &mut ctx.accounts.market;

    require!(market.batch_config.enabled, ErrorCode::BatchProcessingDisabled);
    require!(
        order_ids.len() <= market.batch_config.max_batch_size as usize,
        ErrorCode::BatchSizeExceeded
    );

    let batch_info = BatchInfo {
        batch_id: Clock::get()?.unix_timestamp as u64,
        order_count: order_ids.len() as u32,
        total_volume,
        created_at: Clock::get()?.unix_timestamp,
        expires_at: Clock::get()?.unix_timestamp + batch_timeout,
        order_ids,
    };

    market.current_batch = Some(batch_info);

    Ok(())
}
```

---

## Events

### Event Definitions (7 Total)

| Event | Trigger | Description |
|-------|---------|-------------|
| `MarketInitialized` | `initialize_market` | New market created |
| `SellOrderCreated` | `create_sell_order` | New sell order placed |
| `BuyOrderCreated` | `create_buy_order` | New buy order placed |
| `OrderMatched` | `match_orders` | Orders successfully matched |
| `OrderCancelled` | `cancel_order` | Order cancelled by owner |
| `MarketParamsUpdated` | `update_market_params` | Market settings changed |
| `BatchExecuted` | `execute_batch` | Batch processing completed |

### Event Structures

```rust
#[event]
pub struct MarketInitialized {
    pub authority: Pubkey,  // Market authority
    pub timestamp: i64,     // Creation timestamp
}

#[event]
pub struct SellOrderCreated {
    pub seller: Pubkey,       // Seller wallet
    pub order_id: Pubkey,     // Order PDA
    pub amount: u64,          // kWh amount
    pub price_per_kwh: u64,   // Price per kWh
    pub timestamp: i64,       // Creation timestamp
}

#[event]
pub struct BuyOrderCreated {
    pub buyer: Pubkey,        // Buyer wallet
    pub order_id: Pubkey,     // Order PDA
    pub amount: u64,          // kWh amount
    pub price_per_kwh: u64,   // Max price per kWh
    pub timestamp: i64,       // Creation timestamp
}

#[event]
pub struct OrderMatched {
    pub sell_order: Pubkey,   // Sell order PDA
    pub buy_order: Pubkey,    // Buy order PDA
    pub seller: Pubkey,       // Seller wallet
    pub buyer: Pubkey,        // Buyer wallet
    pub amount: u64,          // Matched kWh
    pub price: u64,           // Clearing price
    pub total_value: u64,     // Total trade value
    pub fee_amount: u64,      // Fee charged
    pub timestamp: i64,       // Execution timestamp
}

#[event]
pub struct OrderCancelled {
    pub order_id: Pubkey,     // Cancelled order PDA
    pub user: Pubkey,         // Order owner
    pub timestamp: i64,       // Cancellation timestamp
}

#[event]
pub struct MarketParamsUpdated {
    pub authority: Pubkey,       // Admin who made change
    pub market_fee_bps: u16,     // New fee setting
    pub clearing_enabled: bool,  // New clearing setting
    pub timestamp: i64,          // Update timestamp
}

#[event]
pub struct BatchExecuted {
    pub authority: Pubkey,    // Batch executor
    pub batch_id: u64,        // Unique batch ID
    pub order_count: u32,     // Orders in batch
    pub total_volume: u64,    // Total batch volume
    pub timestamp: i64,       // Execution timestamp
}
```

---

## Error Handling

### Error Codes (12 Total)

| Code | Name | Message | Trigger |
|------|------|---------|---------|
| 6000 | `UnauthorizedAuthority` | Unauthorized authority | Signer ≠ expected authority |
| 6001 | `InvalidAmount` | Invalid amount | Amount = 0 |
| 6002 | `InvalidPrice` | Invalid price | Price = 0 |
| 6003 | `InactiveSellOrder` | Inactive sell order | Sell order not Active/PartiallyFilled |
| 6004 | `InactiveBuyOrder` | Inactive buy order | Buy order not Active/PartiallyFilled |
| 6005 | `PriceMismatch` | Price mismatch | buy_price < sell_price |
| 6006 | `OrderNotCancellable` | Order not cancellable | Order already completed/cancelled |
| 6007 | `InsufficientEscrowBalance` | Insufficient escrow balance | (Reserved for future use) |
| 6008 | `InvalidErcCertificate` | Invalid ERC certificate status | Certificate status ≠ Valid |
| 6009 | `ErcCertificateExpired` | ERC certificate has expired | now ≥ certificate.expires_at |
| 6010 | `ErcNotValidatedForTrading` | ERC certificate not validated for trading | validated_for_trading = false |
| 6011 | `ExceedsErcAmount` | Order amount exceeds available ERC certificate amount | amount > certificate.energy_amount |
| 6012 | `BatchProcessingDisabled` | Batch processing is disabled | batch_config.enabled = false |
| 6013 | `BatchSizeExceeded` | Batch size exceeded | orders.len() > max_batch_size |

### Error Definition

```rust
#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized authority")]
    UnauthorizedAuthority,            // 6000
    #[msg("Invalid amount")]
    InvalidAmount,                    // 6001
    #[msg("Invalid price")]
    InvalidPrice,                     // 6002
    #[msg("Inactive sell order")]
    InactiveSellOrder,                // 6003
    #[msg("Inactive buy order")]
    InactiveBuyOrder,                 // 6004
    #[msg("Price mismatch")]
    PriceMismatch,                    // 6005
    #[msg("Order not cancellable")]
    OrderNotCancellable,              // 6006
    #[msg("Insufficient escrow balance")]
    InsufficientEscrowBalance,        // 6007
    #[msg("Invalid ERC certificate status")]
    InvalidErcCertificate,            // 6008
    #[msg("ERC certificate has expired")]
    ErcCertificateExpired,            // 6009
    #[msg("ERC certificate not validated for trading")]
    ErcNotValidatedForTrading,        // 6010
    #[msg("Order amount exceeds available ERC certificate amount")]
    ExceedsErcAmount,                 // 6011
    #[msg("Batch processing is disabled")]
    BatchProcessingDisabled,          // 6012
    #[msg("Batch size exceeded")]
    BatchSizeExceeded,                // 6013
}
```

---

## Security Model

### Access Control Matrix

| Instruction | Public | Order Owner | Market Authority |
|-------------|:------:|:-----------:|:----------------:|
| `initialize` | ✓ | ✓ | ✓ |
| `initialize_market` | | | ✓ |
| `create_sell_order` | ✓ | | |
| `create_buy_order` | ✓ | | |
| `match_orders` | ✓ | | |
| `cancel_order` | | ✓ | |
| `update_market_params` | | | ✓ |
| `execute_batch` | ✓ | | |

### Security Constraints

| Constraint | Implementation | Error |
|------------|----------------|-------|
| Authority validation | `has_one = authority` | `UnauthorizedAuthority` |
| Order ownership | Check buyer/seller matches signer | `UnauthorizedAuthority` |
| Price compatibility | buy_price >= sell_price | `PriceMismatch` |
| ERC validation | Optional certificate checks | Various ERC errors |
| Amount overflow protection | `saturating_add` / `saturating_sub` | N/A (safe math) |
| Batch size limits | `max_batch_size` check | `BatchSizeExceeded` |

### PDA Security

Order PDAs include the authority and order sequence to prevent collision:

```rust
seeds = [
    b"order",
    authority.key().as_ref(),
    market.active_orders.to_le_bytes().as_ref()
]
```

Trade record PDAs link both orders:

```rust
seeds = [
    b"trade",
    buy_order.key().as_ref(),
    sell_order.key().as_ref()
]
```

---

## Cross-Program Integration

### Integration Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      CROSS-PROGRAM INTEGRATION                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌─────────────────┐                     ┌─────────────────┐               │
│   │   GOVERNANCE    │                     │  ENERGY TOKEN   │               │
│   │    Program      │                     │    Program      │               │
│   ├─────────────────┤                     ├─────────────────┤               │
│   │                 │                     │                 │               │
│   │ ERC Certificates│◀────────────────────│ Token Transfers │               │
│   │ (Read)          │   ERC Validation    │ (Future)        │               │
│   │                 │                     │                 │               │
│   └────────┬────────┘                     └────────┬────────┘               │
│            │                                       │                        │
│            │ Account reads                         │ Token settlement       │
│            ▼                                       ▼                        │
│   ┌─────────────────────────────────────────────────────────────┐          │
│   │                      TRADING PROGRAM                         │          │
│   │                                                              │          │
│   │  create_sell_order()                    match_orders()       │          │
│   │       │                                      │               │          │
│   │       │ Validates ERC                        │ Executes      │          │
│   │       │ Certificate                          │ Settlement    │          │
│   │       ▼                                      ▼               │          │
│   │  [ERC Checks]                         [Trade Record]        │          │
│   │                                                              │          │
│   └─────────────────────────────────────────────────────────────┘          │
│                                                                              │
│   ┌─────────────────┐                     ┌─────────────────┐               │
│   │    REGISTRY     │                     │     ORACLE      │               │
│   │    Program      │                     │    Program      │               │
│   ├─────────────────┤                     ├─────────────────┤               │
│   │                 │                     │                 │               │
│   │ Meter data for  │                     │ Price feeds     │               │
│   │ energy          │                     │ for market      │               │
│   │ verification    │                     │ reference       │               │
│   │                 │                     │                 │               │
│   └─────────────────┘                     └─────────────────┘               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Governance Program Dependency

The Trading Program imports ERC types from the Governance Program:

```rust
use governance::{ErcCertificate, ErcStatus};
```

This enables direct account deserialization of ERC certificates without CPI.

---

## Performance Characteristics

### Compute Units by Instruction

| Instruction | Compute Units | Accounts | Space Created |
|-------------|---------------|----------|---------------|
| `initialize` | ~5,000 | 1 | 0 bytes |
| `initialize_market` | ~50,000 | 3 | ~3,000 bytes |
| `create_sell_order` | ~40,000 | 4-5 | ~200 bytes |
| `create_buy_order` | ~35,000 | 4 | ~200 bytes |
| `match_orders` | ~55,000 | 6 | ~300 bytes |
| `cancel_order` | ~20,000 | 3 | 0 bytes |
| `update_market_params` | ~15,000 | 2 | 0 bytes |
| `execute_batch` | ~75,000+ | Variable | ~Variable |

### Account Rent Costs

| Account | Approximate Size | Rent (SOL) |
|---------|------------------|------------|
| Market | ~3,000 bytes | ~0.021 |
| Order | ~200 bytes | ~0.002 |
| TradeRecord | ~300 bytes | ~0.003 |

### Scalability Considerations

| Feature | Implementation | Benefit |
|---------|----------------|---------|
| Price level limit | Top 20 per side | Bounded memory |
| Price history limit | Last 100 points | Bounded storage |
| Batch size limit | Configurable max | Controlled compute |
| Order expiration | 24 hours | Natural cleanup |

---

## Appendix: TypeScript SDK Usage

### Market Initialization

```typescript
import { Program, AnchorProvider, web3 } from "@coral-xyz/anchor";
import { Trading } from "./types/trading";

// Find Market PDA
const [marketPda] = web3.PublicKey.findProgramAddressSync(
  [Buffer.from("market")],
  program.programId
);

// Initialize market
await program.methods
  .initializeMarket()
  .accounts({
    market: marketPda,
    authority: wallet.publicKey,
    systemProgram: web3.SystemProgram.programId,
  })
  .rpc();
```

### Creating Orders

```typescript
// Create sell order
const activeOrders = (await program.account.market.fetch(marketPda)).activeOrders;
const [orderPda] = web3.PublicKey.findProgramAddressSync(
  [
    Buffer.from("order"),
    wallet.publicKey.toBuffer(),
    activeOrders.toArrayLike(Buffer, "le", 8),
  ],
  program.programId
);

await program.methods
  .createSellOrder(
    new BN(100),  // 100 kWh
    new BN(50)    // 50 tokens per kWh
  )
  .accounts({
    market: marketPda,
    order: orderPda,
    ercCertificate: null,  // Optional
    authority: wallet.publicKey,
    systemProgram: web3.SystemProgram.programId,
  })
  .rpc();
```

### Matching Orders

```typescript
const [tradeRecordPda] = web3.PublicKey.findProgramAddressSync(
  [
    Buffer.from("trade"),
    buyOrderPda.toBuffer(),
    sellOrderPda.toBuffer(),
  ],
  program.programId
);

await program.methods
  .matchOrders(new BN(50))  // Match 50 kWh
  .accounts({
    market: marketPda,
    buyOrder: buyOrderPda,
    sellOrder: sellOrderPda,
    tradeRecord: tradeRecordPda,
    authority: wallet.publicKey,
    systemProgram: web3.SystemProgram.programId,
  })
  .rpc();
```

### Fetching Market Data

```typescript
const market = await program.account.market.fetch(marketPda);

console.log("Active Orders:", market.activeOrders.toString());
console.log("Total Volume:", market.totalVolume.toString(), "kWh");
console.log("Total Trades:", market.totalTrades.toString());
console.log("Market Fee:", market.marketFeeBps / 100, "%");
console.log("VWAP:", market.volumeWeightedPrice.toString());
console.log("Last Price:", market.lastClearingPrice.toString());
```

### Querying Orders

```typescript
// Fetch all orders
const orders = await program.account.order.all();

// Filter active sell orders
const activeSellOrders = orders.filter(
  (o) => o.account.status.active && o.account.orderType.sell
);

// Filter active buy orders
const activeBuyOrders = orders.filter(
  (o) => o.account.status.active && o.account.orderType.buy
);
```

---

## Changelog

### v1.0.0 (Current)
- Initial release
- P2P order book management
- Buy/sell order creation
- Order matching with VWAP pricing
- ERC certificate validation for sell orders
- Market depth tracking (top 20 levels)
- Price history tracking (last 100 trades)
- Batch processing support
- Market fee configuration
- Order cancellation
- Event emission for all operations

### Planned for v2.0
- Escrow integration for atomic settlement
- Advanced order types (limit, market, stop)
- Time-weighted average price (TWAP) orders
- Multi-token support
- Cross-market arbitrage protection
- Enhanced batch auction mechanism
- Price oracle integration

---

*Last Updated: November 2025*
*Version: 1.0.0*
