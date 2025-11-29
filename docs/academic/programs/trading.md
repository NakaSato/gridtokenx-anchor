# Trading Program

> **Academic Documentation - P2P Energy Marketplace**

Program ID: `GZnqNTJsre6qB4pWCQRE9FiJU2GUeBtBDPp6s7zosctk`

---

## Overview

The Trading Program implements a decentralized peer-to-peer energy marketplace with an on-chain order book, automated matching engine, and atomic settlement. It enables prosumers to sell surplus energy tokens and consumers to purchase energy directly without intermediaries.

---

## Theoretical Foundation

### Market Mechanism Design

The trading system implements a **Continuous Double Auction (CDA)** mechanism:

| Property | Implementation |
|----------|---------------|
| Order Type | Limit orders only |
| Matching | Price-time priority |
| Settlement | Atomic (all-or-nothing) |
| Price Discovery | Volume-Weighted Average Price (VWAP) |

### Why On-Chain Order Book?

| Approach | Transparency | Speed | Cost | Chosen |
|----------|--------------|-------|------|--------|
| On-chain book | Full | Medium | Higher | ✓ |
| Off-chain matching | Low | Fast | Lower | |
| Hybrid | Medium | Fast | Medium | |

On-chain order book provides:
- Complete transparency and auditability
- Trustless operation without intermediaries
- Immutable trade history
- Regulatory compliance

---

## Account Architecture

### Market Account (Singleton)

Global marketplace configuration and statistics.

| Field | Type | Description |
|-------|------|-------------|
| `authority` | PublicKey | Market administrator |
| `fee_account` | PublicKey | Trading fee recipient |
| `fee_bps` | u16 | Fee in basis points (25 = 0.25%) |
| `is_active` | bool | Market operational status |
| `total_orders` | u64 | Total orders created |
| `total_trades` | u64 | Total trades executed |
| `total_volume` | u64 | Cumulative trading volume |
| `created_at` | i64 | Market initialization time |
| `bump` | u8 | PDA bump seed |

**PDA Derivation**: Seeds = `["market"]`

### Order Account

Individual order representation.

| Field | Type | Description |
|-------|------|-------------|
| `order_id` | u64 | Unique order identifier |
| `authority` | PublicKey | Order creator |
| `order_type` | OrderType | Buy or Sell |
| `amount` | u64 | Token quantity (base units) |
| `price` | u64 | Price per token (lamports) |
| `filled_amount` | u64 | Amount already matched |
| `status` | OrderStatus | Active, Filled, Cancelled |
| `erc_certificate` | Option<PublicKey> | Optional ERC requirement |
| `created_at` | i64 | Order creation timestamp |
| `filled_at` | Option<i64> | Trade execution timestamp |
| `bump` | u8 | PDA bump seed |

**PDA Derivation**: Seeds = `["order", authority.key(), order_num.to_le_bytes()]`

### Trade Record Account

Immutable record of executed trades.

| Field | Type | Description |
|-------|------|-------------|
| `trade_id` | u64 | Unique trade identifier |
| `buy_order` | PublicKey | Buyer's order PDA |
| `sell_order` | PublicKey | Seller's order PDA |
| `buyer` | PublicKey | Buyer wallet |
| `seller` | PublicKey | Seller wallet |
| `amount` | u64 | Traded quantity |
| `price` | u64 | Execution price |
| `fee` | u64 | Trading fee charged |
| `executed_at` | i64 | Execution timestamp |
| `bump` | u8 | PDA bump seed |

**PDA Derivation**: Seeds = `["trade", buy_order.key(), sell_order.key()]`

---

## Order Lifecycle

### State Machine

**States:**
- `Active` → Order accepting matches
- `PartiallyFilled` → Partially matched
- `Filled` → Completely matched
- `Cancelled` → Withdrawn by creator

**Transitions:**
- Active → PartiallyFilled (partial match)
- Active → Filled (complete match)
- Active → Cancelled (user cancellation)
- PartiallyFilled → Filled (complete fill)
- PartiallyFilled → Cancelled (cancel remainder)

### Escrow Mechanism

Sell orders lock tokens in program-controlled escrow:

1. User creates sell order
2. Tokens transferred to escrow PDA
3. On match: tokens released to buyer
4. On cancel: tokens returned to seller

This prevents:
- Double-spending tokens
- Order manipulation
- Settlement failures

---

## Price Discovery

### Volume-Weighted Average Price (VWAP)

The market tracks VWAP for price reference:

$$\text{VWAP} = \frac{\sum_{i=1}^{n} (P_i \times V_i)}{\sum_{i=1}^{n} V_i}$$

Where:
- $P_i$ = Price of trade $i$
- $V_i$ = Volume of trade $i$

### Order Book Depth

The market maintains order book statistics:

| Metric | Description |
|--------|-------------|
| Best Bid | Highest buy price |
| Best Ask | Lowest sell price |
| Spread | Ask - Bid |
| Depth | Volume at each price level |

---

## Instructions

### Administrative Instructions

| Instruction | Authority | Description |
|-------------|-----------|-------------|
| `initialize_market` | Deployer | Create market configuration |
| `update_market_authority` | Authority | Transfer control |
| `update_fee` | Authority | Modify trading fee |
| `pause_market` | Authority | Halt trading |
| `resume_market` | Authority | Resume trading |

### Order Management Instructions

| Instruction | Signer | Description |
|-------------|--------|-------------|
| `create_sell_order` | Seller | Create sell order with escrow |
| `create_buy_order` | Buyer | Create buy order |
| `cancel_order` | Order Creator | Cancel and refund |
| `update_order_price` | Order Creator | Modify order price |

### Matching Instructions

| Instruction | Signer | Description |
|-------------|--------|-------------|
| `match_orders` | Authority/Anyone | Execute matching trade |
| `batch_match` | Authority | Match multiple order pairs |

### Query Instructions

| Instruction | Access | Description |
|-------------|--------|-------------|
| `get_market_stats` | Public | Retrieve market statistics |
| `get_order_book` | Public | Get active orders |

---

## Matching Algorithm

### Price-Time Priority

Orders are matched using price-time priority:

1. **Price Priority**: Best price first
   - Buys: Highest price first
   - Sells: Lowest price first
2. **Time Priority**: Earlier orders first at same price

### Matching Rules

| Condition | Result |
|-----------|--------|
| Buy price ≥ Sell price | Match possible |
| Buy price < Sell price | No match |
| Self-trade (buyer = seller) | Rejected |

### Execution Price

Trades execute at the **maker's price** (earlier order):

$$P_{execution} = P_{maker}$$

### Fee Calculation

Trading fee deducted from proceeds:

$$\text{Fee} = \text{Amount} \times \text{Price} \times \frac{\text{fee\_bps}}{10000}$$

Default fee: 25 basis points (0.25%)

---

## ERC Validation Integration

### Certificate-Backed Trading

Sell orders can optionally require ERC certification:

| Mode | ERC Required | Use Case |
|------|--------------|----------|
| Standard | No | General energy trading |
| Certified | Yes | Premium renewable energy |

### Validation Process

For certified orders:

1. Seller specifies ERC certificate address
2. Trading Program reads certificate via CPI
3. Validates certificate status and coverage
4. Only allows certified energy to be sold

This enables premium pricing for verified renewable energy.

---

## Security Model

### Access Control

| Operation | Public | User | Authority |
|-----------|:------:|:----:|:---------:|
| View orders | ✓ | ✓ | ✓ |
| Create order | | ✓ | |
| Cancel own order | | ✓ | |
| Match orders | | | ✓ |
| Configure market | | | ✓ |

### Anti-Manipulation Measures

| Threat | Mitigation |
|--------|------------|
| Wash trading | Self-trade prevention |
| Front-running | Price-time priority |
| Order spoofing | Escrow requirement |
| Price manipulation | VWAP tracking |

### Settlement Guarantees

All trades settle atomically:

1. Token transfer (escrow → buyer)
2. Payment transfer (buyer → seller)
3. Fee collection (buyer → fee account)
4. Record creation

Either all succeed or all fail—no partial states.

---

## Events

| Event | Trigger | Key Fields |
|-------|---------|------------|
| `MarketInitialized` | Initialization | authority, fee_bps |
| `SellOrderCreated` | New sell order | order_id, seller, amount, price |
| `BuyOrderCreated` | New buy order | order_id, buyer, amount, price |
| `OrderMatched` | Trade execution | trade_id, buyer, seller, amount, price, fee |
| `OrderCancelled` | Cancellation | order_id, reason |
| `OrderUpdated` | Price update | order_id, old_price, new_price |
| `MarketPaused` | Pause | authority, timestamp |
| `MarketResumed` | Resume | authority, timestamp |

---

## Errors

| Error Code | Name | Description |
|------------|------|-------------|
| 6300 | `MarketPaused` | Trading currently halted |
| 6301 | `InsufficientBalance` | Not enough tokens/funds |
| 6302 | `InvalidOrderStatus` | Order not in required state |
| 6303 | `SelfTradeNotAllowed` | Cannot trade with self |
| 6304 | `PriceMismatch` | Buy price < sell price |
| 6305 | `InvalidAmount` | Zero or negative amount |
| 6306 | `OrderNotFound` | Order does not exist |
| 6307 | `UnauthorizedCancellation` | Not order owner |
| 6308 | `InvalidErcCertificate` | ERC validation failed |

---

## Research Implications

### Contribution to Literature

The Trading Program demonstrates:

1. **On-chain order book**: Fully transparent decentralized exchange
2. **Atomic settlement**: Trustless trade execution
3. **Certificate integration**: Regulatory compliance in DeFi

### Market Efficiency Analysis

| Metric | Expected Range |
|--------|----------------|
| Spread | 1-5% (emerging market) |
| Depth | Variable (liquidity dependent) |
| Slippage | <1% for typical orders |

### Performance Characteristics

| Metric | Value |
|--------|-------|
| Order creation | ~60,000 CU |
| Order matching | ~100,000 CU |
| Batch matching (5) | ~300,000 CU |
| Trade record | ~0.002 SOL rent |

---

*For implementation details, see [Technical Trading Documentation](../../technical/programs/trading.md)*
