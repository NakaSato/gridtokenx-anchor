# Transaction Settlement Guide

**Version:** 2.0.0
**Last Updated:** March 16, 2026

> **Related Documentation:**
> - [Trading Program](./trading.md) - Core marketplace instructions
> - [Energy Token](./energy-token.md) - GRX token minting/burning
> - [Oracle Program](./oracle.md) - Meter data validation

---

## 1. Overview

GridTokenX implements a comprehensive transaction and settlement system that handles:

- **Energy-to-Token Settlement**: Converting meter readings to GRX tokens
- **P2P Trade Settlement**: Direct buyer-seller energy transactions
- **Auction Settlement**: Batch settlement at uniform clearing price
- **AMM Swaps**: Instant liquidity via constant product formula
- **Multi-Currency Payments**: GRX, THB stablecoin, USDC, USDT
- **Cross-Chain Bridge**: Wormhole-based transfers to other blockchains

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       GRIDTOKENX TRANSACTION FLOW                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                  │
│  │    METER     │───▶│    ORACLE    │───▶│   ENERGY     │                  │
│  │   READING    │    │   VALIDATE   │    │   TOKEN      │                  │
│  └──────────────┘    └──────────────┘    │   MINT       │                  │
│                                          └──────┬───────┘                  │
│                                                 │                          │
│                                                 ▼                          │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │                         TRADING OPTIONS                               │ │
│  │                                                                       │ │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐     │ │
│  │  │    P2P     │  │  PERIODIC  │  │    AMM     │  │  PRIVATE   │     │ │
│  │  │  ORDERS    │  │  AUCTION   │  │   SWAP     │  │  TRANSFER  │     │ │
│  │  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘     │ │
│  │        │               │               │               │            │ │
│  │        └───────────────┼───────────────┼───────────────┘            │ │
│  │                        │               │                            │ │
│  │                        ▼               ▼                            │ │
│  │              ┌──────────────────────────────────┐                   │ │
│  │              │         SETTLEMENT               │                   │ │
│  │              │   • Token Transfer               │                   │ │
│  │              │   • Payment Processing           │                   │ │
│  │              │   • Fee Collection               │                   │ │
│  │              │   • Event Emission               │                   │ │
│  │              └──────────────────────────────────┘                   │ │
│  │                                                                       │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Transaction Lifecycle

### 2.1 Transaction States

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      TRANSACTION STATE DIAGRAM                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│    ┌─────────┐    ┌───────────┐    ┌───────────┐    ┌───────────┐         │
│    │ CREATED │───▶│ VALIDATED │───▶│  MATCHED  │───▶│  SETTLED  │         │
│    └─────────┘    └───────────┘    └───────────┘    └───────────┘         │
│         │              │                │                │                 │
│         │              │                │                │                 │
│         ▼              ▼                ▼                ▼                 │
│    ┌─────────┐    ┌───────────┐    ┌───────────┐    ┌───────────┐         │
│    │ FAILED  │    │ REJECTED  │    │ CANCELLED │    │ FINALIZED │         │
│    └─────────┘    └───────────┘    └───────────┘    └───────────┘         │
│                                                                             │
│  State Descriptions:                                                        │
│  ─────────────────                                                         │
│  CREATED    : Transaction submitted, awaiting validation                   │
│  VALIDATED  : Passed all checks (balance, ERC, permissions)                │
│  MATCHED    : Buyer/seller paired (P2P) or included in batch (auction)     │
│  SETTLED    : Tokens and payments transferred                              │
│  FINALIZED  : Solana finality achieved (~400ms)                            │
│  FAILED     : Creation error (insufficient balance, invalid params)        │
│  REJECTED   : Validation failed (invalid ERC, suspended user)              │
│  CANCELLED  : User-initiated cancellation or expiration                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Transaction Types

| Type | Description | Settlement Time | Typical CU |
|------|-------------|-----------------|------------|
| **Energy Mint** | Meter reading → GRX tokens | Immediate | ~25,000 |
| **P2P Sell Order** | Create sell order | Immediate (order) | ~45,000 |
| **P2P Buy Order** | Create buy order | Immediate (order) | ~45,000 |
| **P2P Match** | Match buy/sell orders | Immediate | ~65,000 |
| **Auction Submit** | Submit auction order | Batch window | ~35,000 |
| **Auction Clear** | Clear auction batch | End of window | ~150,000 |
| **AMM Swap** | Instant token swap | Immediate | ~55,000 |
| **Private Transfer** | Confidential transfer | Immediate | ~80,000 |
| **Bridge Transfer** | Cross-chain via Wormhole | 10-30 minutes | ~100,000 |

---

## 3. Settlement Mechanisms

### 3.1 Energy Generation Settlement

Converts verified meter readings into GRX tokens.

**Settlement Formula:**
```
net_generation = total_generation - total_consumption
settleable = net_generation - settled_net_generation
grx_minted = settleable × 10^9 (9 decimals)
```

**Example:**
- Generation: 15.5 kWh
- Consumption: 5.2 kWh
- Net: 10.3 kWh
- GRX Minted: 10,300,000,000 lamports (10.3 GRX)

### 3.2 P2P Trade Settlement

**Settlement Calculation:**
```
trade_value     = quantity × price
market_fee      = trade_value × 0.0025 (0.25% = 25 bps)
seller_receives = trade_value - market_fee
```

**Example:**
- 100 GRX @ 3.5 THB = 350 THB
- Fee: 0.875 THB
- Seller receives: 349.125 THB

### 3.3 Auction Settlement

**Periodic Auction Process:**

1. **Order Collection** (5-minute window)
2. **Price Discovery** - Find clearing price where supply = demand
3. **Uniform Pricing** - All matched orders execute at clearing price
4. **Settlement** - Atomic token/payment exchange

**Clearing Price Example:**
- Supply: 200 GRX (sorted ascending by price)
- Demand: 160 GRX (sorted descending by price)
- Clearing: P* = 3.4 THB, Q* = 130 GRX

### 3.4 AMM Settlement

**Constant Product Formula:** `x × y = k`

**Swap Calculation:**
```
new_grx_reserve = grx_reserve - grx_amount
required_thb_reserve = k / new_grx_reserve
thb_to_pay = required_thb_reserve - thb_reserve
fee = thb_to_pay × 0.003 (0.3%)
total_cost = thb_to_pay + fee
```

---

## 4. Payment Systems

### 4.1 Supported Currencies

| Currency | Type | Mint Address | Decimals |
|----------|------|--------------|----------|
| GRX | SPL Token (Energy-backed) | Program-derived | 9 |
| THB | Stablecoin (Baht Digital) | External | 6 |
| USDC | Stablecoin (Circle) | External | 6 |
| USDT | Stablecoin (Tether) | External | 6 |

### 4.2 Payment Flow

```
User Wallet → Escrow PDA → Counterparty → Fee Collector
```

All payments use Solana's native transfer instruction with CPI (Cross-Program Invocation).

---

## 5. Fee Structure

| Operation | Fee Rate | Recipient |
|-----------|----------|-----------|
| P2P Trade | 0.25% (25 bps) | Platform treasury |
| Auction Trade | 1.0% (100 bps) | Platform treasury |
| AMM Swap | 0.3% (30 bps) | Liquidity providers |
| Energy Mint | 0% | - |
| Private Transfer | 0.01% (1 bp) | Burn address |
| Bridge Transfer | Variable | Wormhole + Platform |

---

## 6. Error Handling & Recovery

### 6.1 Common Errors

| Error Code | Message | Recovery |
|------------|---------|----------|
| `InsufficientBalance` | User lacks required tokens | Fund account and retry |
| `InvalidERC` | Missing/invalid ERC certificate | Obtain certification |
| `PriceSlippage` | Price moved beyond tolerance | Adjust slippage tolerance |
| `AuctionNotClearable` | No valid clearing price | Wait for next auction |
| `SettlementFailed` | Atomic transfer failed | Check account permissions |

### 6.2 Recovery Procedures

**Failed Transaction:**
1. Check transaction signature on Solana explorer
2. Review error logs from program events
3. Verify account state (balances, permissions)
4. Resubmit with corrected parameters

**Stuck Escrow:**
1. Query escrow PDA state
2. If timeout exceeded, call `release_escrow`
3. Funds return to original owner

---

## 7. Best Practices

### 7.1 For Users

- **Check ERC validity** before trading (required for settlement)
- **Set appropriate slippage** (0.5-1% for P2P, 2-3% for AMM)
- **Monitor auction windows** (5-minute batches)
- **Verify finality** before considering trade complete (~400ms)

### 7.2 For Developers

- **Use idempotent instructions** where possible
- **Handle partial fills** in auction orders
- **Implement retry logic** for network congestion
- **Cache account data** to reduce RPC calls
- **Batch independent operations** in single transaction

---

## 8. Examples

### 8.1 Complete P2P Trade

```typescript
// 1. Seller creates order
const sellOrder = await tradingProgram.createOrder({
  marketId,
  side: 'sell',
  quantity: 100,
  price: 3.5,
  expiration: Date.now() + 86400000,
});

// 2. Buyer matches order
const matchTx = await tradingProgram.matchOrder({
  orderId: sellOrder.id,
  quantity: 100,
});

// 3. Settlement (automatic in match transaction)
// - 100 GRX transferred from seller to buyer
// - 350 THB transferred from buyer to seller
// - 0.875 THB fee collected
// - Events emitted: OrderMatched, TradeExecuted
```

### 8.2 Energy Mint from Meter Reading

```typescript
// 1. Oracle submits reading
await oracleProgram.submitReading({
  meterId,
  timestamp,
  generation: 15.5,
  consumption: 5.2,
  signature: meterSignature,
});

// 2. Registry updates meter account
// 3. Energy Token mints 10.3 GRX to user wallet
```

---

## See Also

- [Trading Program API](./trading.md) - Full instruction reference
- [Energy Token Mechanics](./energy-token.md) - Minting/burning details
- [Oracle Security](./deep-dive/oracle-security.md) - Data validation
- [Settlement Architecture](./deep-dive/settlement-architecture.md) - Deep dive
