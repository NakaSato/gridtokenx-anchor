# GridTokenX Transaction & Settlement Guide

**Version:** 2.0.0  
**Last Updated:** February 2, 2026

---

## Table of Contents

1. [Overview](#1-overview)
2. [Transaction Lifecycle](#2-transaction-lifecycle)
3. [Settlement Mechanisms](#3-settlement-mechanisms)
4. [Payment Systems](#4-payment-systems)
5. [Fee Structure](#5-fee-structure)
6. [Escrow & Custody](#6-escrow--custody)
7. [Cross-Chain Transactions](#7-cross-chain-transactions)
8. [Transaction Examples](#8-transaction-examples)
9. [Error Handling & Recovery](#9-error-handling--recovery)
10. [Best Practices](#10-best-practices)

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
│                                                                             │
│  State Descriptions:                                                        │
│  ─────────────────                                                         │
│  CREATED    : Transaction submitted, awaiting validation                   │
│  VALIDATED  : Passed all checks (balance, ERC, permissions)                │
│  MATCHED    : Buyer/seller paired (P2P) or included in batch (auction)     │
│  SETTLED    : Tokens and payments transferred                              │
│  FINALIZED  : Solana finality achieved (~400ms)                           │
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

### 2.3 Transaction Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    COMPLETE TRANSACTION LIFECYCLE                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  USER                    PROGRAM                    SETTLEMENT              │
│    │                        │                           │                   │
│    │  1. Submit TX          │                           │                   │
│    │────────────────────────▶                           │                   │
│    │                        │                           │                   │
│    │                        │  2. Validate              │                   │
│    │                        │  • Check signatures       │                   │
│    │                        │  • Verify balances        │                   │
│    │                        │  • Validate ERC           │                   │
│    │                        │  • Check permissions      │                   │
│    │                        │                           │                   │
│    │                        │  3. Lock Assets           │                   │
│    │                        │  • Transfer to escrow     │                   │
│    │                        │  • Create order PDA       │                   │
│    │                        │                           │                   │
│    │                        │  4. Match (if applicable) │                   │
│    │                        │──────────────────────────▶│                   │
│    │                        │                           │                   │
│    │                        │                           │  5. Execute       │
│    │                        │                           │  • Transfer GRX   │
│    │                        │                           │  • Transfer THB   │
│    │                        │                           │  • Deduct fees    │
│    │                        │                           │                   │
│    │                        │  6. Update State          │                   │
│    │                        │◀──────────────────────────│                   │
│    │                        │  • Mark completed         │                   │
│    │                        │  • Update statistics      │                   │
│    │                        │                           │                   │
│    │  7. Emit Events        │                           │                   │
│    │◀────────────────────────                           │                   │
│    │  • TradeExecuted       │                           │                   │
│    │  • OrderCompleted      │                           │                   │
│    │                        │                           │                   │
│    │  8. Finality           │                           │                   │
│    │  (~400ms)              │                           │                   │
│    │                        │                           │                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Settlement Mechanisms

### 3.1 Energy Generation Settlement

Converts verified meter readings into GRX tokens.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ENERGY GENERATION SETTLEMENT                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  PHYSICAL WORLD                ON-CHAIN                                     │
│  ──────────────                ────────                                     │
│                                                                             │
│  ┌─────────────┐              ┌─────────────┐                              │
│  │ Smart Meter │              │   Oracle    │                              │
│  │             │              │   Program   │                              │
│  │ generation: │─────API─────▶│             │                              │
│  │ 15.5 kWh    │              │ submit_     │                              │
│  │ consumption:│              │ reading()   │                              │
│  │ 5.2 kWh     │              │             │                              │
│  └─────────────┘              └──────┬──────┘                              │
│                                      │                                      │
│                                      │ CPI: update_meter_reading            │
│                                      ▼                                      │
│                               ┌─────────────┐                              │
│                               │  Registry   │                              │
│                               │  Program    │                              │
│                               │             │                              │
│                               │ MeterAccount│                              │
│                               │ total_gen:  │                              │
│                               │   += 15.5   │                              │
│                               │ total_cons: │                              │
│                               │   += 5.2    │                              │
│                               └──────┬──────┘                              │
│                                      │                                      │
│                                      │ CPI: mint_to_wallet                  │
│                                      ▼                                      │
│                               ┌─────────────┐                              │
│                               │   Energy    │                              │
│                               │   Token     │                              │
│                               │             │                              │
│                               │ Net gen:    │                              │
│                               │ 15.5 - 5.2  │                              │
│                               │ = 10.3 kWh  │                              │
│                               │             │                              │
│                               │ MINT:       │                              │
│                               │ 10.3 GRX    │                              │
│                               └─────────────┘                              │
│                                                                             │
│  Settlement Formula:                                                        │
│  ═══════════════════                                                        │
│  net_generation = total_generation - total_consumption                      │
│  settleable = net_generation - settled_net_generation                       │
│  grx_minted = settleable × 10^9 (9 decimals)                               │
│                                                                             │
│  Example:                                                                   │
│  • Generation: 15.5 kWh                                                    │
│  • Consumption: 5.2 kWh                                                    │
│  • Net: 10.3 kWh                                                           │
│  • GRX Minted: 10,300,000,000 lamports (10.3 GRX)                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 P2P Trade Settlement

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        P2P TRADE SETTLEMENT                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  SELLER (Alice)              ESCROW                  BUYER (Bob)            │
│       │                         │                         │                 │
│       │  1. Create Sell Order   │                         │                 │
│       │  (100 GRX @ 3.5 THB)    │                         │                 │
│       │─────────────────────────▶                         │                 │
│       │                         │                         │                 │
│       │  2. Lock GRX in Escrow  │                         │                 │
│       │  ═══════════════════════│                         │                 │
│       │  Alice: -100 GRX        │                         │                 │
│       │  Escrow: +100 GRX       │                         │                 │
│       │                         │                         │                 │
│       │                         │  3. Create Buy Order    │                 │
│       │                         │  (100 GRX @ 3.5 THB)    │                 │
│       │                         │◀─────────────────────────                 │
│       │                         │                         │                 │
│       │                         │  4. Lock THB in Escrow  │                 │
│       │                         │  ═══════════════════════│                 │
│       │                         │  Bob: -350 THB          │                 │
│       │                         │  Escrow: +350 THB       │                 │
│       │                         │                         │                 │
│       │      5. MATCH & SETTLE  │                         │                 │
│       │     ════════════════════│═════════════════════════│                 │
│       │                         │                         │                 │
│       │  6. Receive THB         │  7. Transfer GRX       │                 │
│       │◀════════════════════════│════════════════════════▶│                 │
│       │  Alice: +349.125 THB    │  Bob: +100 GRX         │                 │
│       │  (after 0.25% fee)      │                         │                 │
│       │                         │                         │                 │
│       │                         │  8. Fee Collection     │                 │
│       │                         │  Fee Collector: +0.875 THB│               │
│       │                         │                         │                 │
│                                                                             │
│  Settlement Calculation:                                                    │
│  ═══════════════════════                                                    │
│  trade_value     = 100 GRX × 3.5 THB = 350 THB                             │
│  market_fee      = 350 THB × 0.0025 = 0.875 THB (0.25% = 25 bps)           │
│  seller_receives = 350 - 0.875 = 349.125 THB                               │
│  buyer_receives  = 100 GRX                                                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Auction Settlement

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       PERIODIC AUCTION SETTLEMENT                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  PHASE 1: ORDER COLLECTION (5 minutes)                                     │
│  ─────────────────────────────────────                                     │
│                                                                             │
│  Sell Orders:                     Buy Orders:                               │
│  ┌──────────────────────┐        ┌──────────────────────┐                  │
│  │ S1: 50 GRX @ 3.2 THB │        │ B1: 30 GRX @ 3.8 THB │                  │
│  │ S2: 80 GRX @ 3.4 THB │        │ B2: 60 GRX @ 3.6 THB │                  │
│  │ S3: 40 GRX @ 3.6 THB │        │ B3: 50 GRX @ 3.4 THB │                  │
│  │ S4: 30 GRX @ 3.8 THB │        │ B4: 20 GRX @ 3.2 THB │                  │
│  └──────────────────────┘        └──────────────────────┘                  │
│                                                                             │
│  PHASE 2: PRICE DISCOVERY                                                  │
│  ────────────────────────                                                  │
│                                                                             │
│  Supply Curve (sorted ASC):       Demand Curve (sorted DESC):              │
│                                                                             │
│  Price │                          Price │                                   │
│   3.8  │              ████████     3.8  │ ████                              │
│   3.6  │         ████████████      3.6  │ ███████████                       │
│   3.4  │    █████████████████      3.4  │ █████████████████                 │
│   3.2  │ ████████████████████      3.2  │ ███████████████████               │
│        └──────────────────────          └──────────────────────             │
│          50   130   170   200             30    90   140   160              │
│                                                                             │
│  Intersection: P* = 3.4 THB, Q* = 130 GRX                                  │
│                                                                             │
│  PHASE 3: SETTLEMENT                                                       │
│  ───────────────────                                                       │
│                                                                             │
│  Matched at Clearing Price 3.4 THB:                                        │
│                                                                             │
│  │ Order │ Original  │ Matched │ Filled │ Remaining │ Status         │    │
│  ├───────┼───────────┼─────────┼────────┼───────────┼────────────────┤    │
│  │ S1    │ 50 @ 3.2  │ 50 GRX  │ 100%   │ 0         │ Completed      │    │
│  │ S2    │ 80 @ 3.4  │ 80 GRX  │ 100%   │ 0         │ Completed      │    │
│  │ S3    │ 40 @ 3.6  │ 0 GRX   │ 0%     │ 40        │ Cancelled*     │    │
│  │ S4    │ 30 @ 3.8  │ 0 GRX   │ 0%     │ 30        │ Cancelled*     │    │
│  │ B1    │ 30 @ 3.8  │ 30 GRX  │ 100%   │ 0         │ Completed      │    │
│  │ B2    │ 60 @ 3.6  │ 60 GRX  │ 100%   │ 0         │ Completed      │    │
│  │ B3    │ 50 @ 3.4  │ 40 GRX  │ 80%    │ 10        │ PartialFill**  │    │
│  │ B4    │ 20 @ 3.2  │ 0 GRX   │ 0%     │ 20        │ Cancelled*     │    │
│                                                                             │
│  * Unmatched orders: funds returned to owner                               │
│  ** Partial fill: remaining can roll to next auction                       │
│                                                                             │
│  Total Settled:                                                             │
│  • Volume: 130 GRX                                                         │
│  • Value: 130 × 3.4 = 442 THB                                              │
│  • Fees: 442 × 0.01 = 4.42 THB                                             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.4 AMM Settlement

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          AMM SWAP SETTLEMENT                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  CONSTANT PRODUCT FORMULA: x × y = k                                       │
│  ─────────────────────────────────────                                     │
│                                                                             │
│  Pool State (Before):                                                       │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │  GRX Reserve: 10,000 GRX       THB Reserve: 35,000 THB             │   │
│  │  k = 10,000 × 35,000 = 350,000,000                                 │   │
│  │  Implied Price: 35,000 / 10,000 = 3.5 THB/GRX                      │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  User Action: Buy 100 GRX                                                  │
│  ─────────────────────────                                                 │
│                                                                             │
│  Calculation:                                                               │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │  1. New GRX Reserve = 10,000 - 100 = 9,900 GRX                     │   │
│  │                                                                     │   │
│  │  2. Required THB Reserve (to maintain k):                          │   │
│  │     new_thb = k / new_grx = 350,000,000 / 9,900 = 35,353.54 THB   │   │
│  │                                                                     │   │
│  │  3. THB to Pay = 35,353.54 - 35,000 = 353.54 THB                  │   │
│  │                                                                     │   │
│  │  4. Add Fee (0.3% = 30 bps):                                       │   │
│  │     fee = 353.54 × 0.003 = 1.06 THB                               │   │
│  │     total_cost = 353.54 + 1.06 = 354.60 THB                       │   │
│  │                                                                     │   │
│  │  5. Effective Price = 354.60 / 100 = 3.546 THB/GRX                │   │
│  │     Price Impact = (3.546 - 3.5) / 3.5 = 1.31%                    │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Pool State (After):                                                        │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │  GRX Reserve: 9,900 GRX        THB Reserve: 35,354.60 THB          │   │
│  │  k = 9,900 × 35,354.60 = 350,010,540 (slightly increased by fees) │   │
│  │  New Implied Price: 35,354.60 / 9,900 = 3.57 THB/GRX              │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Token Flows:                                                               │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │  User → Pool:    354.60 THB                                         │ │
│  │  Pool → User:    100 GRX                                            │ │
│  │  Fee Accrued:    1.06 THB (stays in pool for LPs)                   │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  CURVE TYPES:                                                              │
│  ════════════                                                              │
│  LinearSolar (default): Standard bonding curve                            │
│  SteepWind:            2x slope for volatile wind energy                  │
│  FlatBattery:          0.5x slope for stable battery-backed energy       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Payment Systems

### 4.1 Supported Payment Tokens

| Token | Symbol | Decimals | Type | Use Case |
|-------|--------|----------|------|----------|
| **GRX** | GRX | 9 | Native | Energy representation (1 GRX = 1 kWh) |
| **THB Stablecoin** | THB | 9 | Primary | Domestic Thai Baht settlement |
| **USDC** | USDC | 6 | Secondary | International settlement |
| **USDT** | USDT | 6 | Secondary | International settlement |
| **Wormhole Wrapped** | Various | Various | Bridge | Cross-chain tokens |

### 4.2 Payment Token Configuration

```rust
/// Token configuration stored on-chain
pub struct TokenConfig {
    pub bump: u8,                       // PDA bump seed
    pub market: Pubkey,                 // Parent market
    pub token_type: u8,                 // 0=GRX, 1=USDC, 2=USDT, 3=Wormhole
    pub mint: Pubkey,                   // Token mint address
    pub decimals: u8,                   // Token decimals
    pub enabled: bool,                  // Trading enabled flag
    pub min_order_size: u64,            // Minimum order in base units
    pub price_oracle: Option<Pubkey>,   // Oracle for price conversion
    pub last_price: u64,                // Cached price
    pub last_price_update: i64,         // Price timestamp
    pub max_price_deviation_bps: u16,   // Max slippage (basis points)
}
```

### 4.3 Multi-Currency Order Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     MULTI-CURRENCY SETTLEMENT FLOW                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Seller (wants THB)          Market              Buyer (pays USDC)          │
│        │                        │                        │                  │
│        │  1. Sell Order         │                        │                  │
│        │  100 GRX @ 3.5 THB     │                        │                  │
│        │───────────────────────▶│                        │                  │
│        │                        │                        │                  │
│        │                        │  2. Buy Order          │                  │
│        │                        │  100 GRX, pay USDC     │                  │
│        │                        │◀────────────────────────                  │
│        │                        │                        │                  │
│        │                        │  3. Price Conversion   │                  │
│        │                        │  ────────────────────  │                  │
│        │                        │  THB price: 3.5 THB    │                  │
│        │                        │  Exchange: 35 THB/USD  │                  │
│        │                        │  USDC equiv: $10 USDC  │                  │
│        │                        │                        │                  │
│        │                        │  4. Settlement         │                  │
│        │                        │  ════════════════════  │                  │
│        │                        │                        │                  │
│        │  5a. Receive THB       │  5b. Send USDC        │                  │
│        │◀═══════════════════════│◀════════════════════════                  │
│        │  349.125 THB           │  $10.10 USDC          │                  │
│        │  (net of 0.25% fee)    │  (incl. conversion)   │                  │
│        │                        │                        │                  │
│        │  5c. Receive GRX       │                        │                  │
│        │                        │═══════════════════════▶│                  │
│        │                        │  100 GRX               │                  │
│        │                        │                        │                  │
│                                                                             │
│  Conversion uses Oracle price with max deviation check:                    │
│  • Oracle provides THB/USD rate                                            │
│  • Rate must be within max_price_deviation_bps of last known price         │
│  • Conversion: usdc_amount = thb_amount / exchange_rate                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.4 Payment Info Account

Each order with alternative payment creates a `OrderPaymentInfo` account:

```rust
pub struct OrderPaymentInfo {
    pub order: Pubkey,              // Linked order
    pub payment_token: u8,          // Token type enum
    pub payment_mint: Pubkey,       // Actual mint address
    pub price_in_payment_token: u64,// Converted price
    pub exchange_rate: u64,         // Rate used (×10^9)
    pub rate_timestamp: i64,        // When rate was fetched
    pub payment_processed: bool,    // Settlement complete flag
}
```

---

## 5. Fee Structure

### 5.1 Fee Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          FEE STRUCTURE OVERVIEW                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Fee Type              Rate (bps)    Rate (%)    Applied To                │
│  ────────────────────────────────────────────────────────────────────────  │
│  Market Fee            25            0.25%       All P2P trades            │
│  Auction Fee           50            0.5%        Auction settlements       │
│  AMM Swap Fee          30            0.3%        AMM swaps (to LPs)        │
│  Bridge Fee            50            0.5%        Cross-chain transfers     │
│  Relayer Fee           Fixed         ~$0.50      Wormhole relayer payment  │
│                                                                             │
│  Fee Formula:                                                               │
│  ═══════════                                                                │
│  fee = (trade_value × fee_bps) / 10,000                                    │
│                                                                             │
│  Example (100 GRX @ 3.5 THB with 0.25% fee):                               │
│  • Trade value: 350 THB                                                    │
│  • Fee: 350 × 25 / 10,000 = 0.875 THB                                      │
│  • Seller receives: 350 - 0.875 = 349.125 THB                              │
│                                                                             │
│  Fee Distribution:                                                          │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │                                                                       │ │
│  │   Collected Fees                                                      │ │
│  │        │                                                              │ │
│  │        ├───────▶ 70% Platform Treasury (governance-controlled)       │ │
│  │        │                                                              │ │
│  │        ├───────▶ 20% PoA Validators (distributed by stake)           │ │
│  │        │                                                              │ │
│  │        └───────▶ 10% Insurance Fund (for dispute resolution)         │ │
│  │                                                                       │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Fee Calculation Code

```rust
/// Calculate market fee
fn calculate_fee(trade_value: u64, fee_bps: u16) -> u64 {
    (trade_value as u128)
        .saturating_mul(fee_bps as u128)
        .checked_div(10_000)
        .unwrap_or(0) as u64
}

/// Calculate net amount after fee
fn calculate_net_amount(gross_amount: u64, fee_bps: u16) -> (u64, u64) {
    let fee = calculate_fee(gross_amount, fee_bps);
    let net = gross_amount.saturating_sub(fee);
    (net, fee)
}

// Example usage in settlement
let trade_value = amount * price_per_kwh;
let (seller_receives, market_fee) = calculate_net_amount(trade_value, market.market_fee_bps);
```

### 5.3 Fee Configuration

| Market Type | Default Fee | Min Fee | Max Fee | Configurable By |
|-------------|-------------|---------|---------|-----------------|
| P2P Trading | 25 bps | 10 bps | 500 bps | Authority |
| Periodic Auction | 50 bps | 10 bps | 200 bps | Authority |
| AMM Pools | 30 bps | 5 bps | 100 bps | Pool Creator |
| Wormhole Bridge | 50 bps | 20 bps | 200 bps | Authority |

---

## 6. Escrow & Custody

### 6.1 Escrow Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          ESCROW ARCHITECTURE                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  User Wallet              Escrow PDA               Counterparty             │
│  ──────────               ──────────               ────────────             │
│                                                                             │
│  ┌─────────────┐         ┌─────────────┐         ┌─────────────┐           │
│  │ Token       │  Lock   │ Escrow      │ Release │ Token       │           │
│  │ Account     │────────▶│ Account     │────────▶│ Account     │           │
│  │             │         │             │         │             │           │
│  │ GRX: 1000   │         │ Seeds:      │         │ GRX: 0→100  │           │
│  │      ↓      │         │ ["escrow",  │         │             │           │
│  │ GRX: 900    │         │  order,     │         └─────────────┘           │
│  │             │         │  bump]      │                                    │
│  └─────────────┘         │             │         ┌─────────────┐           │
│                          │ GRX: 100    │         │ Token       │           │
│                          │ (locked)    │ Refund  │ Account     │           │
│                          │             │────────▶│             │           │
│                          │ Authority:  │  (if    │ GRX: 900→   │           │
│                          │ Program     │cancelled│      1000   │           │
│                          │             │  )      │             │           │
│                          └─────────────┘         └─────────────┘           │
│                                                                             │
│  ESCROW TYPES:                                                              │
│  ═════════════                                                              │
│                                                                             │
│  1. Order Escrow                                                           │
│     Seeds: ["order_escrow", order_pubkey, bump]                            │
│     Holds: GRX (sell) or THB (buy) during order lifetime                   │
│                                                                             │
│  2. Auction Escrow                                                         │
│     Seeds: ["auction_escrow", auction_id, user_pubkey, bump]               │
│     Holds: Funds during auction collection window                          │
│                                                                             │
│  3. Bridge Escrow                                                          │
│     Seeds: ["bridge_escrow", transfer_id, bump]                            │
│     Holds: Tokens during cross-chain transfer                              │
│                                                                             │
│  4. AMM Pool Vault                                                         │
│     Seeds: ["pool_vault", pool_pubkey, token_type, bump]                   │
│     Holds: Pool reserves (LP-owned)                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Escrow Operations

| Operation | Description | CPI Required |
|-----------|-------------|--------------|
| `lock_to_escrow` | Transfer from user to escrow PDA | `transfer_checked` |
| `release_from_escrow` | Transfer from escrow to counterparty | `transfer_checked` (with PDA signer) |
| `refund_from_escrow` | Return to original owner (cancel) | `transfer_checked` (with PDA signer) |
| `close_escrow` | Close PDA, return rent | `close_account` |

### 6.3 Escrow Security

```rust
// Escrow authority validation
#[account(
    mut,
    seeds = [b"order_escrow", order.key().as_ref()],
    bump,
    token::mint = energy_mint,
    token::authority = escrow_authority,
)]
pub escrow_account: InterfaceAccount<'info, TokenAccount>,

/// CHECK: PDA for escrow authority
#[account(
    seeds = [b"escrow_authority", market.key().as_ref()],
    bump,
)]
pub escrow_authority: UncheckedAccount<'info>,

// Transfer with PDA signer
let seeds = &[
    b"escrow_authority",
    market.key().as_ref(),
    &[escrow_bump],
];
let signer = &[&seeds[..]];

transfer_checked(
    CpiContext::new_with_signer(
        token_program.to_account_info(),
        transfer_accounts,
        signer,
    ),
    amount,
    decimals,
)?;
```

---

## 7. Cross-Chain Transactions

### 7.1 Wormhole Bridge Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       CROSS-CHAIN BRIDGE FLOW                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  SOLANA                      WORMHOLE                      ETHEREUM         │
│  ──────                      ────────                      ────────         │
│                                                                             │
│  ┌─────────────┐            ┌─────────────┐            ┌─────────────┐     │
│  │ User        │            │ Guardian    │            │ Destination │     │
│  │ initiates   │            │ Network     │            │ Chain       │     │
│  │ bridge      │            │ (19 nodes)  │            │             │     │
│  └──────┬──────┘            └──────┬──────┘            └──────┬──────┘     │
│         │                          │                          │            │
│    1. initiate_bridge_             │                          │            │
│       transfer()                   │                          │            │
│         │                          │                          │            │
│    2. Lock GRX in                  │                          │            │
│       bridge escrow                │                          │            │
│         │                          │                          │            │
│    3. Emit Wormhole                │                          │            │
│       message                      │                          │            │
│         │─────────────────────────▶│                          │            │
│         │                          │                          │            │
│         │                     4. Guardians                    │            │
│         │                        observe &                    │            │
│         │                        sign VAA                     │            │
│         │                          │                          │            │
│         │                     5. VAA reaches                  │            │
│         │                        threshold                    │            │
│         │                        (13/19)                      │            │
│         │                          │─────────────────────────▶│            │
│         │                          │                          │            │
│         │                          │                     6. Redeem VAA     │
│         │                          │                        on dest        │
│         │                          │                        chain          │
│         │                          │                          │            │
│         │                          │                     7. Mint wrapped   │
│         │                          │                        GRX tokens     │
│         │                          │                          │            │
│         │◀─────────────────────────│◀─────────────────────────│            │
│         │                          │                          │            │
│    8. complete_bridge_             │                          │            │
│       transfer()                   │                          │            │
│       (update status)              │                          │            │
│         │                          │                          │            │
│                                                                             │
│  Timeline: 10-30 minutes (depending on guardian confirmation)              │
│                                                                             │
│  Supported Destination Chains:                                             │
│  • Ethereum (chain_id: 2)                                                  │
│  • Polygon (chain_id: 5)                                                   │
│  • Arbitrum (chain_id: 23)                                                 │
│  • Base (chain_id: 30)                                                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Bridge Configuration

```rust
pub struct BridgeConfig {
    pub bump: u8,
    pub market: Pubkey,
    pub wormhole_program: Pubkey,
    pub token_bridge_program: Pubkey,
    pub authority: Pubkey,
    pub enabled: bool,
    pub min_bridge_amount: u64,      // Minimum 100 GRX
    pub bridge_fee_bps: u16,         // 50 bps default
    pub relayer_fee: u64,            // Fixed relayer payment
    pub supported_chains: [u8; 32],  // Bitmap of enabled chains
}
```

---

## 8. Transaction Examples

### 8.1 Complete P2P Trade (TypeScript)

```typescript
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import { PublicKey, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';

async function executeTrade(
  program: Program,
  seller: PublicKey,
  buyer: PublicKey,
  amount: number,
  pricePerKwh: number
) {
  // 1. Create sell order
  const [orderPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('order'), seller.toBuffer(), new BN(Date.now()).toArrayLike(Buffer, 'le', 8)],
    program.programId
  );

  const sellOrderTx = await program.methods
    .createSellOrder(new BN(amount * 1e9), new BN(pricePerKwh * 1e9))
    .accounts({
      order: orderPda,
      seller: seller,
      market: marketPda,
      sellerEnergyAccount: await getAssociatedTokenAddress(grxMint, seller),
      escrowAccount: escrowPda,
      // ... other accounts
    })
    .rpc();

  console.log('Sell order created:', sellOrderTx);

  // 2. Create buy order and match
  const [buyOrderPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('order'), buyer.toBuffer(), new BN(Date.now()).toArrayLike(Buffer, 'le', 8)],
    program.programId
  );

  const matchTx = await program.methods
    .createBuyOrderAndMatch(new BN(amount * 1e9), new BN(pricePerKwh * 1e9))
    .accounts({
      buyOrder: buyOrderPda,
      sellOrder: orderPda,
      buyer: buyer,
      seller: seller,
      market: marketPda,
      buyerThbAccount: await getAssociatedTokenAddress(thbMint, buyer),
      sellerThbAccount: await getAssociatedTokenAddress(thbMint, seller),
      buyerEnergyAccount: await getAssociatedTokenAddress(grxMint, buyer),
      escrowAccount: escrowPda,
      feeCollector: feeCollectorPda,
      // ... other accounts
    })
    .rpc();

  console.log('Trade executed:', matchTx);

  // 3. Verify settlement
  const tradeRecord = await program.account.tradeRecord.fetch(tradeRecordPda);
  console.log('Settlement details:', {
    amount: tradeRecord.amount.toNumber() / 1e9,
    price: tradeRecord.price.toNumber() / 1e9,
    fee: tradeRecord.fee.toNumber() / 1e9,
    timestamp: new Date(tradeRecord.timestamp.toNumber() * 1000),
  });
}
```

### 8.2 AMM Swap (TypeScript)

```typescript
async function swapBuyEnergy(
  program: Program,
  user: PublicKey,
  amountGrx: number,
  maxThb: number
) {
  const tx = await program.methods
    .swapBuyEnergy(
      new BN(amountGrx * 1e9),  // Amount in milli-kWh (9 decimals)
      new BN(maxThb * 1e9)      // Max THB to spend (slippage protection)
    )
    .accounts({
      pool: poolPda,
      userEnergyAccount: await getAssociatedTokenAddress(grxMint, user),
      userCurrencyAccount: await getAssociatedTokenAddress(thbMint, user),
      poolEnergyVault: poolEnergyVaultPda,
      poolCurrencyVault: poolCurrencyVaultPda,
      energyMint: grxMint,
      currencyMint: thbMint,
      user: user,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  console.log('Swap executed:', tx);
}
```

### 8.3 Auction Participation (TypeScript)

```typescript
async function participateInAuction(
  program: Program,
  user: PublicKey,
  amount: number,
  price: number,
  isSell: boolean
) {
  // Submit auction order
  const auctionOrderTx = await program.methods
    .submitAuctionOrder(
      new BN(amount * 1e9),
      new BN(price * 1e9),
      isSell
    )
    .accounts({
      auctionOrder: auctionOrderPda,
      auction: currentAuctionPda,
      user: user,
      userTokenAccount: isSell
        ? await getAssociatedTokenAddress(grxMint, user)
        : await getAssociatedTokenAddress(thbMint, user),
      auctionEscrow: auctionEscrowPda,
      // ... other accounts
    })
    .rpc();

  console.log('Auction order submitted:', auctionOrderTx);

  // Wait for auction to close (5 minutes)
  // Settlement happens automatically via crank
}
```

---

## 9. Error Handling & Recovery

### 9.1 Common Transaction Errors

| Error Code | Name | Cause | Resolution |
|------------|------|-------|------------|
| `6000` | `InsufficientBalance` | Not enough tokens | Check balance before transaction |
| `6001` | `InvalidAmount` | Zero or negative amount | Use positive amounts |
| `6002` | `InvalidPrice` | Zero or negative price | Use positive price |
| `6003` | `OrderExpired` | Order past `expires_at` | Create new order |
| `6004` | `UnauthorizedAuthority` | Wrong signer | Use correct wallet |
| `6005` | `InactiveBuyOrder` | Buy order not active | Check order status |
| `6006` | `InactiveSellOrder` | Sell order not active | Check order status |
| `6007` | `PriceMismatch` | Buy price < sell price | Adjust prices |
| `6008` | `InvalidERC` | ERC not valid for trading | Obtain valid ERC |
| `6009` | `SlippageExceeded` | Price moved too much | Increase slippage tolerance |
| `6010` | `SystemPaused` | Emergency pause active | Wait for unpause |

### 9.2 Transaction Recovery

```typescript
async function recoverFailedTransaction(
  program: Program,
  orderPda: PublicKey,
  user: PublicKey
) {
  // Check order status
  const order = await program.account.order.fetch(orderPda);
  
  if (order.status === OrderStatus.Active) {
    // Cancel and recover escrow
    await program.methods
      .cancelOrder()
      .accounts({
        order: orderPda,
        owner: user,
        escrowAccount: escrowPda,
        ownerTokenAccount: await getAssociatedTokenAddress(
          order.orderType === OrderType.Sell ? grxMint : thbMint,
          user
        ),
        // ... other accounts
      })
      .rpc();
    
    console.log('Order cancelled, funds returned');
  }
}
```

### 9.3 Timeout Handling

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        TRANSACTION TIMEOUT HANDLING                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Scenario                    Timeout      Recovery Action                   │
│  ─────────────────────────────────────────────────────────────────────────  │
│  Order expiration            7 days       Crank expires order, refunds     │
│  Auction window              5 minutes    Auto-close, settle, refund       │
│  Bridge pending              24 hours     Manual recovery via support      │
│  RPC timeout                 30 seconds   Retry with fresh blockhash       │
│  Confirmation timeout        60 seconds   Check if TX landed, retry if not │
│                                                                             │
│  Crank Service:                                                            │
│  ─────────────                                                             │
│  • Runs every 60 seconds                                                   │
│  • Expires stale orders                                                    │
│  • Triggers auction clearing                                               │
│  • Completes pending bridge transfers                                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 10. Best Practices

### 10.1 Transaction Optimization

| Practice | Description | Impact |
|----------|-------------|--------|
| **Batch operations** | Combine multiple orders in one TX | Reduce fees, faster |
| **Preflight simulation** | Simulate before sending | Avoid failed TXs |
| **Priority fees** | Add tip during congestion | Faster confirmation |
| **Account prefetch** | Load accounts in parallel | Reduce latency |
| **Blockhash caching** | Reuse recent blockhash | Fewer RPC calls |

### 10.2 Settlement Best Practices

```typescript
// ✅ Good: Check balance before creating order
const balance = await connection.getTokenAccountBalance(userTokenAccount);
if (balance.value.uiAmount < orderAmount) {
  throw new Error('Insufficient balance');
}

// ✅ Good: Use slippage protection for AMM
const maxCost = expectedCost * 1.02; // 2% slippage
await swapBuyEnergy(program, user, amount, maxCost);

// ✅ Good: Verify settlement after trade
const tradeRecord = await program.account.tradeRecord.fetch(tradeRecordPda);
assert(tradeRecord.status === TradeStatus.Settled);

// ❌ Bad: Hardcoded prices without oracle
const price = 3.5; // Don't do this in production

// ❌ Bad: No error handling
await program.methods.createOrder(...).rpc(); // Always wrap in try-catch
```

### 10.3 Security Checklist

- [ ] Verify all account owners before transfer
- [ ] Check order status before matching
- [ ] Validate ERC certificates for sell orders
- [ ] Use checked math for all calculations
- [ ] Implement slippage protection for swaps
- [ ] Set reasonable order expiration times
- [ ] Monitor for unusual trading patterns
- [ ] Keep private keys secure (hardware wallet recommended)

---

## Related Documentation

- [Trading Program](./programs/trading.md) - Trading module reference
- [State Machines](./programs/diagrams/state-machines.md) - Order state transitions
- [Sequence Diagrams](./programs/diagrams/sequences.md) - Transaction flows
- [Glossary](./glossary.md) - Term definitions
- [AMM Deep Dive](./programs/deep-dive/amm-deep-dive.md) - AMM mechanics
- [Pricing Deep Dive](./programs/deep-dive/pricing-deep-dive.md) - Price discovery
