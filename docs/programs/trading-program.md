# Trading Program Documentation

## Overview

The Trading Program implements a decentralized peer-to-peer (P2P) energy marketplace on Solana, enabling prosumers to sell excess renewable energy and consumers to purchase clean energy directly, without traditional intermediaries.

## Purpose

The Trading Program serves as the marketplace engine for the GridTokenX ecosystem:

1. **Order Book Management**: Maintains buy and sell orders for energy trading
2. **Price Discovery**: Enables market-driven pricing through order matching
3. **Trade Execution**: Matches compatible orders and executes trades
4. **Market Analytics**: Tracks market depth, volume, and price history
5. **ERC Integration**: Ensures trades reference valid Renewable Energy Certificates (ERCs)

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                   Trading Program Architecture                   │
└─────────────────────────────────────────────────────────────────┘

Market Participants                Trading Program            Governance
┌──────────────┐                  ┌────────────────┐         ┌─────────┐
│              │                  │                │         │         │
│  Prosumers   │──── Sell ───────▶│  Create Sell   │◀─ ERC ──│  ERC    │
│  (Sellers)   │     Orders       │  Order         │ Verify  │  Certs  │
│              │                  │                │         │         │
└──────────────┘                  └───────┬────────┘         └─────────┘
                                          │
                                          ▼
                                  ┌────────────────┐
                                  │  Order Book    │
                                  │  - Buy Orders  │
                                  │  - Sell Orders │
                                  └───────┬────────┘
                                          │
┌──────────────┐                          │
│              │                          ▼
│  Consumers   │──── Buy ────────▶ ┌────────────────┐
│  (Buyers)    │     Orders        │  Order Match   │
│              │                   │  Engine        │
└──────────────┘                   └───────┬────────┘
                                           │
                                           ▼
                                   ┌────────────────┐
                                   │  Trade         │
                                   │  Settlement    │
                                   └───────┬────────┘
                                           │
                                           ▼
                                   ┌────────────────┐
                                   │  Market Data   │
                                   │  - Price       │
                                   │  - Volume      │
                                   │  - Depth       │
                                   └────────────────┘
```

## Core Components

### 1. Market Account

The central market state that stores all market-wide information:

**Market Configuration:**
- Market authority (admin)
- Market fee in basis points (e.g., 25 = 0.25%)
- Clearing enabled flag
- Emergency pause status

**Market Statistics:**
- Total buy orders count
- Total sell orders count
- Total volume traded (lifetime kWh)
- Total trades executed
- Total fees collected

**Market Depth Tracking:**
- Best bid prices (buy side, highest 5)
- Best ask prices (sell side, lowest 5)
- Volume at each price level
- Real-time order book depth

**Price History:**
- Last 50 trade prices
- Trade volumes
- Timestamps
- Enables price charting and analysis

### 2. Order Account

Individual order created by buyers or sellers:

**Order Details:**
- Order ID (unique public key)
- Order type (Buy or Sell)
- Trader (order creator's public key)
- Energy amount (kWh requested/offered)
- Price per kWh

**Order State:**
- Status (Active, Filled, PartiallyFilled, Cancelled)
- Filled amount (kWh already matched)
- Remaining amount (kWh still available)
- Created timestamp
- Last updated timestamp

**For Sell Orders:**
- Reference to ERC certificate (validates renewable source)
- ERC validation status

### 3. Batch Configuration

Manages batch trading for high-volume scenarios:

**Batch Settings:**
- Maximum orders per batch
- Batch execution frequency
- Minimum batch size
- Auto-execution enabled flag

**Purpose:** Enables efficient processing of multiple orders simultaneously, reducing transaction costs.

## Data Flow

### Sell Order Creation Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                  Sell Order Creation Process                     │
└─────────────────────────────────────────────────────────────────┘

   Prosumer                 Trading Program            Governance
      │                           │                         │
      │  1. Create Sell Order     │                         │
      ├──────────────────────────▶│                         │
      │  (energy_amount, price)   │                         │
      │                           │                         │
      │                           │  2. Load ERC Cert       │
      │                           ├────────────────────────▶│
      │                           │                         │
      │                           │  3. Validate ERC        │
      │                           │◀────────────────────────┤
      │                           │  - Status = Valid?      │
      │                           │  - Not expired?         │
      │                           │  - Enough energy?       │
      │                           │                         │
      │                ┌──────────▼──────────┐              │
      │                │ Validation Checks   │              │
      │                │ - Market active?    │              │
      │                │ - ERC sufficient?   │              │
      │                │ - Price > 0?        │              │
      │                └──────────┬──────────┘              │
      │                           │                         │
      │                ┌──────────▼──────────┐              │
      │                │ Create Order Account│              │
      │                │ - Type: Sell        │              │
      │                │ - Status: Active    │              │
      │                │ - Link ERC cert     │              │
      │                └──────────┬──────────┘              │
      │                           │                         │
      │                ┌──────────▼──────────┐              │
      │                │ Update Market Depth │              │
      │                │ - Add to ask side   │              │
      │                │ - Update best ask   │              │
      │                └──────────┬──────────┘              │
      │                           │                         │
      │  ◀─────────────────────────┤                         │
      │  Order Created Event       │                         │
      │                           │                         │
```

### Buy Order Creation Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                   Buy Order Creation Process                     │
└─────────────────────────────────────────────────────────────────┘

   Consumer                  Trading Program
      │                           │
      │  1. Create Buy Order      │
      ├──────────────────────────▶│
      │  (energy_amount,          │
      │   max_price_per_kwh)      │
      │                           │
      │                ┌──────────▼──────────┐
      │                │ Validation Checks   │
      │                │ - Market active?    │
      │                │ - Amount > 0?       │
      │                │ - Price > 0?        │
      │                └──────────┬──────────┘
      │                           │
      │                ┌──────────▼──────────┐
      │                │ Create Order Account│
      │                │ - Type: Buy         │
      │                │ - Status: Active    │
      │                │ - Max price set     │
      │                └──────────┬──────────┘
      │                           │
      │                ┌──────────▼──────────┐
      │                │ Update Market Depth │
      │                │ - Add to bid side   │
      │                │ - Update best bid   │
      │                └──────────┬──────────┘
      │                           │
      │  ◀─────────────────────────┤
      │  Order Created Event       │
      │                           │
```

### Order Matching Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     Order Matching Process                       │
└─────────────────────────────────────────────────────────────────┘

   Matcher                   Trading Program
      │                           │
      │  Match Orders             │
      ├──────────────────────────▶│
      │  (buy_order, sell_order,  │
      │   match_amount)           │
      │                           │
      │                ┌──────────▼──────────┐
      │                │ Compatibility Check │
      │                │ - Buy price ≥       │
      │                │   Sell price?       │
      │                │ - Both Active?      │
      │                │ - Amount available? │
      │                └──────────┬──────────┘
      │                           │
      │                ┌──────────▼──────────┐
      │                │ Calculate Trade     │
      │                │ - Match amount      │
      │                │ - Execution price   │
      │                │   (weighted avg)    │
      │                │ - Market fee        │
      │                └──────────┬──────────┘
      │                           │
      │                ┌──────────▼──────────┐
      │                │ Update Orders       │
      │                │ - Update filled amt │
      │                │ - Update remaining  │
      │                │ - Change status if  │
      │                │   fully filled      │
      │                └──────────┬──────────┘
      │                           │
      │                ┌──────────▼──────────┐
      │                │ Update Market Stats │
      │                │ - Total volume      │
      │                │ - Total trades      │
      │                │ - Fees collected    │
      │                └──────────┬──────────┘
      │                           │
      │                ┌──────────▼──────────┐
      │                │ Update Price History│
      │                │ - Add trade price   │
      │                │ - Record volume     │
      │                │ - Timestamp         │
      │                └──────────┬──────────┘
      │                           │
      │                ┌──────────▼──────────┐
      │                │ Update Market Depth │
      │                │ - Adjust bid/ask    │
      │                │ - Recalculate levels│
      │                └──────────┬──────────┘
      │                           │
      │  ◀─────────────────────────┤
      │  Trade Executed Event      │
      │  (buyer, seller, amount,   │
      │   price, fee)              │
      │                           │
```

## Instructions

### Market Management Instructions

#### 1. Initialize Market
**Purpose:** Creates the market for the first time

**Process:**
- Creates Market account with default settings
- Sets market authority to initializer
- Configures default fee (25 basis points = 0.25%)
- Enables clearing by default
- Initializes all counters to zero

**Accounts Created:**
- Market (main market state)
- Batch Config (for batch trading)

#### 2. Update Market Parameters
**Purpose:** Adjust market configuration

**Authority Required:** Market admin only

**Parameters:**
- `market_fee_bps`: Fee in basis points (1 bps = 0.01%)
- `clearing_enabled`: Boolean to enable/disable market clearing

**Use Cases:**
- Adjust fees based on market conditions
- Temporarily pause market during maintenance
- Optimize for different trading scenarios

### Trading Instructions

#### 3. Create Sell Order
**Purpose:** Prosumer offers energy for sale

**Authority Required:** Any user

**Parameters:**
- `energy_amount`: kWh to sell
- `price_per_kwh`: Asking price per kWh

**Requirements:**
- Must have valid ERC certificate
- ERC must be "Valid" status (not expired/revoked)
- ERC must cover energy amount being sold
- Market must be active

**Validation:**
- Verifies ERC certificate exists and is valid
- Checks ERC has sufficient energy allocation
- Ensures price is greater than zero
- Confirms energy amount is positive

**On Success:**
- Order account created with Active status
- Market depth updated (ask side)
- OrderCreated event emitted
- ERC linked to order for traceability

#### 4. Create Buy Order
**Purpose:** Consumer requests to purchase energy

**Authority Required:** Any user

**Parameters:**
- `energy_amount`: kWh to purchase
- `max_price_per_kwh`: Maximum willing to pay

**Requirements:**
- Market must be active
- Amount and price must be positive

**On Success:**
- Order account created with Active status
- Market depth updated (bid side)
- OrderCreated event emitted

#### 5. Match Orders
**Purpose:** Execute a trade between compatible orders

**Authority Required:** Any user (typically a bot or keeper)

**Parameters:**
- `match_amount`: kWh to match (must be ≤ min of both orders)

**Accounts Required:**
- Market account
- Buy order account
- Sell order account
- Buyer's account
- Seller's account

**Matching Logic:**
```
Price Compatibility Check:
  Buy Order Max Price ≥ Sell Order Price

Execution Price Calculation:
  execution_price = (buy_price * buy_volume + sell_price * sell_volume) 
                    / (buy_volume + sell_volume)

Fee Calculation:
  fee = match_amount * execution_price * market_fee_bps / 10000

Settlement:
  - Update buy order: filled_amount += match_amount
  - Update sell order: filled_amount += match_amount
  - Update order statuses (Filled if fully matched)
  - Update market stats and price history
```

**On Success:**
- Both orders updated
- Market statistics incremented
- Price history recorded
- Market depth recalculated
- TradeExecuted event emitted

#### 6. Cancel Order
**Purpose:** Remove an active or partially filled order

**Authority Required:** Order creator only

**Requirements:**
- Order must be Active or PartiallyFilled
- Caller must be order creator

**Process:**
- Changes order status to Cancelled
- Updates market depth (removes from bid/ask)
- Emits OrderCancelled event
- Does NOT refund any already-filled portion

#### 7. Execute Batch
**Purpose:** Process multiple orders in a single transaction

**Authority Required:** Any user

**Parameters:**
- `order_ids`: Vector of order public keys

**Requirements:**
- Batch size must not exceed configured maximum
- All orders must exist and be valid

**Process:**
- Iterates through provided orders
- Attempts to match compatible buy/sell pairs
- Executes all possible matches
- Updates batch statistics
- More efficient for high-volume scenarios

**On Success:**
- Multiple trades executed atomically
- BatchExecuted event emitted
- All market metrics updated

## Events

### OrderCreated
Emitted when buy or sell order is created

**Data:**
- Order ID
- Order type (Buy/Sell)
- Trader public key
- Energy amount
- Price
- Timestamp

### OrderCancelled
Emitted when order is cancelled

**Data:**
- Order ID
- Trader public key
- Cancellation timestamp

### TradeExecuted
Emitted when orders are matched

**Data:**
- Buy order ID
- Sell order ID
- Buyer public key
- Seller public key
- Amount traded (kWh)
- Execution price
- Total price
- Market fee collected
- ERC certificate ID (for renewable verification)
- Timestamp

### MarketParamsUpdated
Emitted when market configuration changes

**Data:**
- New market fee (basis points)
- Clearing enabled status
- Update timestamp

### BatchExecuted
Emitted when batch execution completes

**Data:**
- Batch ID
- Number of orders processed
- Total volume matched
- Executor public key
- Timestamp

## Market Depth Management

### Bid-Ask Spread Tracking

```
Market Depth Structure:

BID SIDE (Buyers)                ASK SIDE (Sellers)
Higher prices first              Lower prices first

Price  | Volume                  Price  | Volume
─────────────────               ─────────────────
0.15   | 100 kWh  ◄──────┐     0.18   | 150 kWh ◄── Best Ask
0.14   | 250 kWh         │     0.19   | 200 kWh
0.13   | 180 kWh         │     0.20   | 300 kWh
0.12   | 320 kWh         │     0.21   | 100 kWh
0.11   | 200 kWh         │     0.22   | 180 kWh
       └────────────────┘
       Best Bid

Spread = 0.18 - 0.15 = 0.03 (3 cents per kWh)

Matchable when: Best Bid ≥ Best Ask
```

### Price Discovery Process

The market uses a **continuous trading** model:

1. **Order Placement:**
   - Orders enter the book with specified prices
   - Buy orders sorted by price (descending)
   - Sell orders sorted by price (ascending)

2. **Best Price Calculation:**
   - Best Bid = Highest buy order price
   - Best Ask = Lowest sell order price
   - Spread = Best Ask - Best Bid

3. **Trade Execution:**
   - When Best Bid ≥ Best Ask, match is possible
   - Execution price = Volume-weighted average
   - Prevents advantage to either party

4. **Market Depth Update:**
   - After each trade, recalculate depth
   - Update top 5 price levels each side
   - Provides transparency for market participants

## Security Model

### Access Control

```
┌─────────────────────────────────────────────────────────────────┐
│                    Trading Access Control                        │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────────┐
│  Market Authority    │  ← Configure market parameters
│  (Admin)             │    Update fees, enable/disable
└──────────────────────┘

┌──────────────────────┐
│  Order Creators      │  ← Create buy/sell orders
│  (Any user)          │    Must meet specific requirements
└──────────┬───────────┘
           │
           ├─── Sellers: Need valid ERC certificate
           │
           └─── Buyers: No special requirements

┌──────────────────────┐
│  Order Matchers      │  ← Execute trades (anyone can match)
│  (Keepers/Bots)      │    Incentivized by arbitrage opportunities
└──────────────────────┘

┌──────────────────────┐
│  Order Owner         │  ← Cancel own orders only
│  (Original creator)  │    Cannot cancel others' orders
└──────────────────────┘
```

### Validation Layers

**Layer 1: ERC Validation (Sell Orders)**
- Must reference valid ERC certificate
- ERC status must be "Valid"
- ERC energy amount ≥ sell order amount
- Prevents selling non-renewable energy

**Layer 2: Price Validation**
- All prices must be positive
- Prevents zero-price or negative exploits
- Ensures economic rationality

**Layer 3: Order State Validation**
- Only Active/PartiallyFilled orders can trade
- Cancelled orders cannot be reactivated
- Filled orders cannot accept more matches

**Layer 4: Match Validation**
- Buy price must be ≥ sell price
- Match amount must be ≤ both orders' remaining
- Market must not be paused
- Prevents invalid trade execution

## Integration Points

### With Governance Program
**ERC Certificate Validation:**
- Every sell order references an ERC
- Trading program reads ERC status from Governance
- Validates renewable energy authenticity
- Prevents greenwashing

**Integration Flow:**
```
Seller creates order
       │
       ▼
Trading Program loads ERC account
       │
       ▼
Checks ERC.status == "Valid"
       │
       ▼
Checks ERC.energy_amount ≥ order amount
       │
       ▼
If valid: Create order
If invalid: Reject with error
```

### With Registry Program
**User and Meter Validation:**
- Traders should be registered users
- Energy amounts validated against meter readings
- Ensures only real prosumers can sell

### With Oracle Program
**Market Clearing Trigger:**
- Oracle emits MarketClearingTriggered events
- Trading program can batch-process orders
- Coordinate market-wide settlement

## Best Practices

### For Traders

**Creating Sell Orders:**
1. Ensure ERC certificate is issued and valid
2. Check ERC coverage for energy amount
3. Research current market prices (check market depth)
4. Set competitive pricing to match faster
5. Monitor order status for partial fills

**Creating Buy Orders:**
1. Check market depth for available supply
2. Set realistic max price based on market conditions
3. Consider splitting large orders for better matching
4. Monitor for partial fills
5. Cancel and recreate if market moves significantly

**Order Management:**
1. Cancel orders that are no longer favorable
2. Adjust prices based on market feedback
3. Use smaller orders for price discovery
4. Batch similar orders when possible

### For Market Makers / Keepers

**Order Matching:**
1. Monitor order book continuously
2. Match orders when spread is profitable
3. Consider gas costs in matching decisions
4. Prioritize larger matches for efficiency
5. Update depth after every match

**Batch Processing:**
1. Collect compatible orders
2. Execute in single transaction to save fees
3. Handle errors gracefully (skip invalid orders)
4. Emit comprehensive events for tracking

### For Administrators

**Market Configuration:**
1. Set fees that balance liquidity and revenue
2. Monitor fee collection vs market volume
3. Adjust parameters during low liquidity periods
4. Communicate changes to market participants
5. Test parameter changes in devnet first

**Emergency Response:**
1. Disable clearing during system maintenance
2. Monitor for suspicious trading patterns
3. Have rollback procedures documented
4. Coordinate with Oracle and Governance admins

## Limitations and Considerations

### Current Limitations

1. **No Automatic Matching:**
   - Requires external matcher (bot/keeper)
   - Orders don't auto-match on creation
   - Dependent on matcher activeness

2. **Limited Order Types:**
   - Only limit orders supported
   - No market orders (immediate execution)
   - No stop-loss or advanced order types

3. **Fixed Market Depth:**
   - Only top 5 price levels tracked
   - Cannot see full order book on-chain
   - May miss liquidity visibility

4. **No Order Modification:**
   - Cannot update order price or amount
   - Must cancel and recreate
   - Incurs additional transaction costs

5. **Single Market:**
   - All energy types in one market
   - Cannot separate solar vs wind markets
   - No geographic market segmentation

### Design Considerations

**Decentralization vs Efficiency:**
- Permissionless matching enables decentralization
- But requires active keeper ecosystem
- Consider incentive mechanisms for matchers

**On-chain vs Off-chain Matching:**
- Current design: On-chain order book
- Advantages: Transparent, trustless
- Drawbacks: Limited scalability, storage costs
- Alternative: Off-chain matching with on-chain settlement

**ERC Coupling:**
- Tight integration with Governance ensures authenticity
- But adds dependency and complexity
- Trade-off: Renewable verification vs simplicity

## Future Enhancements

Potential improvements for future versions:

1. **Advanced Order Types:**
   - Market orders (immediate execution at best price)
   - Stop-loss orders (automatic cancellation at price)
   - Time-in-force options (Good Till Cancelled, Fill or Kill)
   - Iceberg orders (hidden liquidity)

2. **Automated Matching:**
   - On-chain matching engine (crank-based)
   - Automatic best-price matching on order creation
   - Reduce reliance on external keepers

3. **Market Segmentation:**
   - Separate markets by energy type (solar, wind, etc.)
   - Geographic markets (local energy trading)
   - Time-based markets (peak vs off-peak)

4. **Enhanced Analytics:**
   - Full order book depth (not just top 5)
   - Historical candlestick data
   - Volume-weighted average price (VWAP)
   - Market manipulation detection

5. **Liquidity Incentives:**
   - Rebates for market makers
   - Rewards for order matchers
   - Reduced fees for high-volume traders

6. **Performance Optimizations:**
   - Compressed order storage
   - Event-based order book updates
   - Zero-copy deserialization
   - Parallel order matching
