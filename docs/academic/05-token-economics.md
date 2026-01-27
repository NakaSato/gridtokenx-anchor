# Token Economics

## GridTokenX Token Economics Analysis

> *January 2026 Edition - Research Paper Documentation*

---

## 1. Token Overview

### 1.1 Token Specification

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                           GRID TOKEN SPECIFICATION                                 │
└────────────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────────┐
│                                                                                  │
│  Token Name:        GridTokenX Energy Token                                      │
│  Symbol:            GRX                                                          │
│  Standard:          SPL Token-2022 (Next-gen Solana token standard)             │
│  Program ID:        8jTD...yEur (Energy Token Program)                          │
│  Decimals:          9                                                            │
│  Supply Type:       Elastic (Mint/Burn based on verified energy production)     │
│                                                                                  │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │                                                                        │     │
│  │   1 GRX Token  =  1 kWh of Verified Renewable Energy                  │     │
│  │   (Backed by Oracle-validated meter readings with BFT consensus)       │     │
│  │                                                                        │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│                                                                                  │
│  Mint Authority:    PDA (seeds: ["token_info_2022"])                            │
│  Freeze Authority:  None (freely transferable)                                   │
│  Burn Authority:    Token holder + Energy Token Program                          │
│  REC Validators:    Max 10 authorized validators (governance-managed)            │
│  Metaplex Support:  Yes (on-chain metadata for token discovery)                 │
│                                                                                  │
│  Technical Details:                                                              │
│  • PDA-based minting (18,000 CU, 6,665 mints/sec theoretical)                   │
│  • Zero-copy account optimization for performance                                │
│  • Dual high-water mark prevention of double-claiming                           │
│  • Cross-program invocation from Registry for automated minting                 │
│                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Token Value Proposition

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                         TOKEN VALUE BACKING                                        │
└────────────────────────────────────────────────────────────────────────────────────┘


                    GRX TOKEN VALUE COMPONENTS
                    ════════════════════════════

              ┌─────────────────────────────────────────┐
              │                                         │
              │           GRX TOKEN (Token-2022)        │
              │                                         │
              └───────────────────┬─────────────────────┘
                                  │
        ┌─────────────────────────┼─────────────────────────┐
        │                         │                         │
        ▼                         ▼                         ▼
┌───────────────┐         ┌───────────────┐         ┌───────────────┐
│   INTRINSIC   │         │   UTILITY     │         │   SCARCITY    │
│    VALUE      │         │    VALUE      │         │    VALUE      │
│               │         │               │         │               │
│ Backed by     │         │ Required for  │         │ Supply tied   │
│ BFT-validated │         │ P2P trading   │         │ to Oracle-    │
│ meter data    │         │ on platform   │         │ verified      │
│ (3f+1 oracle  │         │ (4 modalities)│         │ production    │
│ consensus)    │         │               │         │               │
└───────────────┘         └───────────────┘         └───────────────┘
        │                         │                         │
        ▼                         ▼                         ▼
   1 kWh energy          • Bilateral trading        Dual high-water
   measurement           • AMM bonding curves       mark prevention
   (immutable)           • Auction markets          (no arbitrary
                         • Batch clearing           minting)
                         • Fee discounts
```

---

## 2. Token Supply Model

### 2.1 Elastic Supply Mechanism

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                        ELASTIC SUPPLY MECHANISM                                    │
└────────────────────────────────────────────────────────────────────────────────────┘


                          SUPPLY DYNAMICS
                          ═══════════════

    Energy Production                           Token Supply
    (Physical World)                            (Digital World)

    ┌─────────────────┐                        ┌─────────────────┐
    │                 │                        │                 │
    │  Solar Panels   │                        │                 │
    │  ▼              │                        │                 │
    │  ▼              │    MINT                │   Total         │
    │  ▼  Production  │ ──────────────────────►│   Supply        │
    │  ▼              │    1 kWh → 1 GRID      │                 │
    │                 │                        │                 │
    └─────────────────┘                        └─────────────────┘

    ┌─────────────────┐                        ┌─────────────────┐
    │                 │                        │                 │
    │  Energy Use     │                        │                 │
    │  ▼              │                        │                 │
    │  ▼              │    BURN                │   Total         │
    │  ▼  Consumption │ ──────────────────────►│   Supply        │
    │  ▼              │    (Optional)          │                 │
    │                 │                        │                 │
    └─────────────────┘                        └─────────────────┘


                    Supply = Cumulative(Minted) - Cumulative(Burned)
```

### 2.2 Supply Growth Projection

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                       SUPPLY GROWTH PROJECTION                                     │
└────────────────────────────────────────────────────────────────────────────────────┘


                              TOKEN SUPPLY OVER TIME

    Supply (GRID)
         │
   500K  │                                              ┌────────
         │                                         ┌────┘
   400K  │                                    ┌────┘
         │                               ┌────┘
   300K  │                          ┌────┘
         │                     ┌────┘
   200K  │                ┌────┘
         │           ┌────┘
   100K  │      ┌────┘
         │ ┌────┘
       0 │─┴───────────────────────────────────────────────────────
         │    Q1    Q2    Q3    Q4    Q1    Q2    Q3    Q4
         │         Year 1                   Year 2


ASSUMPTIONS (January 2026 - Updated):
─────────────────────────────────────────────────────────────────
• Starting prosumers: 100 (Bangkok pilot program)
• Growth rate: 25% per quarter (conservative)
• Average surplus per prosumer: 500 kWh/month
• Seasonal variation: ±20% (Thailand solar conditions)
• Minting capacity: 6,665 GRX/sec (well above demand)
• Oracle throughput: 15,000 readings/sec (sufficient)

PROJECTION TABLE:
─────────────────────────────────────────────────────────────────
Quarter     │ Prosumers │ Monthly Mint │ Cumulative Supply
────────────┼───────────┼──────────────┼───────────────────
Year 1 Q1   │ 100       │ 50,000 GRX   │ 150,000 GRX
Year 1 Q2   │ 125       │ 62,500 GRX   │ 337,500 GRX
Year 1 Q3   │ 156       │ 78,000 GRX   │ 571,500 GRX
Year 1 Q4   │ 195       │ 97,500 GRX   │ 864,000 GRX
Year 2 Q1   │ 244       │ 122,000 GRX  │ 1,230,000 GRX
Year 2 Q2   │ 305       │ 152,500 GRX  │ 1,687,500 GRX

TECHNICAL VALIDATION:
─────────────────────────────────────────────────────────────────
• Peak minting demand (Q2 Y2): 152,500 GRX/month = 0.059 GRX/sec
• Platform capacity: 6,665 GRX/sec (theoretical)
• Sustained throughput: 4,200 TPS (mixed workload)
• Bottleneck: Oracle submissions (15,000/sec theoretical, 8,000/sec sustained)
• Conclusion: Platform can support 100x growth without performance degradation
```

---

## 3. Token Flow Model

### 3.1 Complete Token Flow

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                          COMPLETE TOKEN FLOW MODEL                                 │
└────────────────────────────────────────────────────────────────────────────────────┘


                              ┌─────────────────────┐
                              │                     │
                              │    ENERGY TOKEN     │
                              │      PROGRAM        │
                              │    (Mint/Burn)      │
                              │                     │
                              └──────────┬──────────┘
                                         │
                            ┌────────────┴────────────┐
                            │                         │
                         MINT                       BURN
                            │                         │
                            ▼                         │
              ┌─────────────────────────┐            │
              │                         │            │
              │    PROSUMER WALLET      │            │
              │    (Token Holder)       │            │
              │                         │            │
              └────────────┬────────────┘            │
                           │                         │
            ┌──────────────┼──────────────┐         │
            │              │              │         │
         HOLD           SELL          TRANSFER     │
            │              │              │         │
            │              ▼              │         │
            │    ┌─────────────────┐      │         │
            │    │                 │      │         │
            │    │  ESCROW (Order) │      │         │
            │    │                 │      │         │
            │    └────────┬────────┘      │         │
            │             │               │         │
            │    ┌────────┴────────┐      │         │
            │    │                 │      │         │
            │  MATCH           CANCEL     │         │
            │    │                 │      │         │
            │    ▼                 │      │         │
            │  ┌───────────┐       │      │         │
            │  │           │       │      │         │
            │  │  BUYER    │◄──────┘      │         │
            │  │  WALLET   │              │         │
            │  │           │              │         │
            │  └─────┬─────┘              │         │
            │        │                    │         │
            │        └────────────────────┘         │
            │                                       │
            └───────────────┬───────────────────────┘
                            │
                            │ (Optional: Energy Consumed)
                            ▼
                      ┌───────────┐
                      │           │
                      │   BURN    │
                      │           │
                      └───────────┘


TOKEN MOVEMENT SUMMARY (Across 7 Programs):
═══════════════════════════════════════════════════════════════════════════════════

1. METER READING:   Oracle validates reading (8k CU, BFT consensus)
2. SETTLEMENT:      Registry calculates net generation (3.5k CU)
3. MINTING:         Registry → Energy Token CPI (18k CU mint)
                    ↳ PDA authority signs, 1:1 kWh:GRX ratio
4. ESCROW:          Prosumer Wallet → Trading Order Escrow (7.5k CU)
5. MATCHING:        Trading program matches orders (15k CU)
6. SETTLEMENT:      Trading → Token transfer (15.2k CU)
                    ↳ Atomic 6-way settlement for complex trades (28k CU)
7. ERC ISSUANCE:    Governance verifies unclaimed energy (11.2k CU w/ CPI)
                    ↳ Dual high-water mark check via Registry
8. BURN:            Token holder → Void (14k CU, optional tracking)
9. TRANSFER:        Wallet → Wallet (15.2k CU, peer transfer)

Cross-Program Invocations:
• Registry.settle_energy() → EnergyToken.mint_tokens_direct()
• Governance.issue_erc_with_verification() → Registry.verify_unclaimed_energy()
• Trading.create_sell_order() → Governance.validate_erc() (optional)
```

### 3.2 Payment Flow

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                            DUAL PAYMENT FLOW MODEL                                 │
└────────────────────────────────────────────────────────────────────────────────────┘


OPTION A: NATIVE GRX PAYMENT
═══════════════════════════════════════════════════════════════════════════════════

    Consumer                           Trading                          Prosumer
    (Buyer)                           Program                          (Seller)
       │                                 │                                 │
       │  1. Create Buy Order            │                                 │
       │  (100 kWh @ 3.0 GRX/kWh)        │                                 │
       │  [7.2k CU, 405ms latency]       │                                 │
       │─────────────────────────────────►                                 │
       │                                 │                                 │
       │                                 │  2. Create Sell Order           │
       │                                 │  (100 kWh @ 2.8 GRX/kWh)        │
       │                                 │  [7.5k CU, 410ms latency]       │
       │                                 ◄─────────────────────────────────│
       │                                 │                                 │
       │                                 │  3. Match Orders                │
       │                                 │  (VWAP @ 2.9 GRX/kWh)           │
       │                                 │  [15k CU, 440ms latency]        │
       │                                 │                                 │
       │  4. GRX Transfer (290 GRX)      │                                 │
       │  Fee: 0.725 GRX (0.25%)         │                                 │
       │◄────────────────────────────────┼─────────────────────────────────│
       │                                 │                                 │


OPTION B: THAI BAHT CHAIN PAYMENT (Cross-Chain)
═══════════════════════════════════════════════════════════════════════════════════

    Consumer         Thai Baht           Bridge           Trading         Prosumer
       │               Chain             Service          Program            │
       │                 │                  │                │               │
       │  1. Send THBC   │                  │                │               │
       │ ───────────────►│                  │                │               │
       │                 │                  │                │               │
       │                 │  2. Lock THBC    │                │               │
       │                 │ ────────────────►│                │               │
       │                 │                  │                │               │
       │                 │                  │  3. Proof      │               │
       │                 │                  │ ───────────────►               │
       │                 │                  │                │               │
       │                 │                  │                │  4. Execute   │
       │   ◄─────────────│──────────────────│────────────────│  Trade        │
       │   GRID Tokens   │                  │                │               │
       │                 │                  │                │               │
       │                 │                  │  5. Convert    │               │
       │                 │  6. Release GRX  │  THB → GRX     │               │
       │                 │ ◄────────────────│ ◄──────────────│               │
       │                 │                  │                │               │
       │                 │  7. Credit GRX   │                │               │
       │                 │ ─────────────────│────────────────│──────────────►│
       │                 │                  │                │               │
```

---

## 4. Price Discovery Mechanism

### 4.1 Market-Based Pricing

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                          PRICE DISCOVERY MODEL                                     │
└────────────────────────────────────────────────────────────────────────────────────┘


                        ORDER BOOK PRICE DISCOVERY
                        ═══════════════════════════

         SELL ORDERS (ASK)                    BUY ORDERS (BID)
         ─────────────────                    ────────────────

    Price    │ Amount                    Price    │ Amount
    (GRX/kWh)│ (kWh)                     (GRX/kWh)│ (kWh)
    ─────────┼────────                   ─────────┼────────
      3.50   │  100                        3.10   │  150
      3.40   │  250                        3.00   │  200   ◄── Best Bid
      3.30   │  180                        2.90   │  300
      3.20   │  500   ◄── Best Ask         2.80   │  100
                                           2.70   │  250


                            ┌───────────────────┐
                            │                   │
                            │   SPREAD = 0.10   │
                            │   (3.20 - 3.10)   │
                            │                   │
                            └───────────────────┘


    MID PRICE = (Best Ask + Best Bid) / 2 = (3.20 + 3.10) / 2 = 3.15 GRX/kWh


PRICE FACTORS:
═══════════════════════════════════════════════════════════════════════════════════

┌─────────────────────┐   ┌─────────────────────┐   ┌─────────────────────┐
│                     │   │                     │   │                     │
│  SUPPLY FACTORS     │   │  DEMAND FACTORS     │   │  EXTERNAL FACTORS   │
│                     │   │                     │   │                     │
│ • Solar production  │   │ • Consumer demand   │   │ • Grid electricity  │
│ • Weather/season    │   │ • Price sensitivity │   │   prices            │
│ • # of prosumers    │   │ • Time of day       │   │ • Government policy │
│ • Equipment uptime  │   │ • Environmental     │   │ • Market sentiment  │
│                     │   │   awareness         │   │                     │
└─────────────────────┘   └─────────────────────┘   └─────────────────────┘
```

### 4.2 Price Equilibrium

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                         PRICE EQUILIBRIUM MODEL                                    │
└────────────────────────────────────────────────────────────────────────────────────┘


    Price
    (GRX/kWh)
         │
      5  │
         │                Supply
      4  │               /
         │              /
    3.15 │─────────────●────────────────────  Equilibrium
         │            /│
      3  │           / │
         │          /  │  Demand
      2  │         /   │ ╲
         │        /    │  ╲
      1  │       /     │   ╲
         │      /      │    ╲
         │─────────────┼───────────────────────
                      Q*                      Quantity
                   (Volume)                    (kWh)


EQUILIBRIUM CONDITIONS:
═══════════════════════════════════════════════════════════════════════════════════

At equilibrium price P* = 3.15 GRX/kWh:
• Quantity supplied = Quantity demanded = Q*
• No excess supply or demand
• Market clears naturally

PRICE CEILING (Too High):
• More sellers than buyers
• Surplus tokens → Price drops

PRICE FLOOR (Too Low):
• More buyers than sellers
• Shortage of tokens → Price rises
```

---

## 5. Incentive Mechanisms

### 5.1 Stakeholder Incentive Matrix

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                        STAKEHOLDER INCENTIVE MATRIX                                │
└────────────────────────────────────────────────────────────────────────────────────┘


                         PROSUMER INCENTIVES
                         ═══════════════════

    ┌─────────────────────────────────────────────────────────────────────────┐
    │                                                                         │
    │   Primary:    Revenue from surplus energy sales                         │
    │   Secondary:  ERC certificates for green credentials                    │
    │   Bonus:      Lower platform fees for high-volume sellers               │
    │                                                                         │
    │   Incentive Formula:                                                    │
    │   ───────────────────────────────────────────────────────────────────── │
    │                                                                         │
    │   Revenue = (Surplus kWh × Market Price) - (Trade Amount × Fee Rate)   │
    │                                                                         │
    │   Example (Typical Trade):                                             │
    │   Surplus: 100 kWh                                                      │
    │   Market Price: 3.0 GRX/kWh (VWAP from order matching)                │
    │   Trade Value: 300 GRX                                                  │
    │   Platform Fee: 300 × 0.0025 = 0.75 GRX                                │
    │   Net Revenue = 300 - 0.75 = 299.25 GRX                                │
    │                                                                         │
    │   With ERC Certificate (Premium):                                       │
    │   Market Price: 3.5 GRX/kWh (renewable premium)                        │
    │   Trade Value: 350 GRX                                                  │
    │   Platform Fee: 0.875 GRX                                               │
    │   ERC Validation: 2 GRX (one-time)                                      │
    │   Net Revenue = 350 - 0.875 - 2 = 347.125 GRX                          │
    │   Premium vs. Standard: +47.875 GRX (+16% increase)                    │
    │                                                                         │
    └─────────────────────────────────────────────────────────────────────────┘


                         CONSUMER INCENTIVES
                         ═══════════════════

    ┌─────────────────────────────────────────────────────────────────────────┐
    │                                                                         │
    │   Primary:    Lower energy costs vs. grid prices                        │
    │   Secondary:  Access to verified green energy                           │
    │   Bonus:      Loyalty rewards for consistent buying                     │
    │                                                                         │
    │   Savings Formula:                                                      │
    │   ───────────────────────────────────────────────────────────────────── │
    │                                                                         │
    │   Savings = (Grid Price - Platform Price) × kWh Purchased              │
    │                                                                         │
    │   Example:                                                              │
    │   Grid Price: 4.0 THB/kWh                                              │
    │   Platform Price: 3.0 GRX/kWh (≈ 3.5 THB/kWh)                         │
    │   Purchased: 100 kWh                                                    │
    │   Savings = (4.0 - 3.5) × 100 = 50 THB                                 │
    │                                                                         │
    └─────────────────────────────────────────────────────────────────────────┘


                         PLATFORM INCENTIVES
                         ═══════════════════

    ┌─────────────────────────────────────────────────────────────────────────┐
    │                                                                         │
    │   Revenue Sources:                                                      │
    │   ├─ Transaction fees (0.25% on trades)                                │
    │   ├─ ERC certificate issuance fees                                     │
    │   └─ Premium feature subscriptions                                      │
    │                                                                         │
    │   Platform aligns with users through:                                   │
    │   ├─ Volume-based success (more trades = more fees)                    │
    │   ├─ Network effects (more users = more liquidity)                     │
    │   └─ Quality service (better UX = user retention)                      │
    │                                                                         │
    └─────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Fee Structure

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                             FEE STRUCTURE                                          │
└────────────────────────────────────────────────────────────────────────────────────┘


    FEE TYPE              │ RATE          │ PAYER       │ PURPOSE
    ──────────────────────┼───────────────┼─────────────┼─────────────────────
    Trading Fee           │ 0.25%         │ Both        │ Platform revenue
    Settlement Fee        │ Included      │ -           │ (Covered by trade fee)
    ERC Issuance          │ 5 GRX fixed   │ Prosumer    │ Certificate creation
    ERC Validation        │ 2 GRX fixed   │ Prosumer    │ Trading approval
    ERC w/ Verification   │ 8 GRX fixed   │ Prosumer    │ Issuance + double-claim check
    Cancellation Fee      │ Free          │ -           │ Gas only (~400ms, 5k CU)
    API Access (Pro)      │ 50 GRX/mo     │ Prosumer    │ Unlimited trades, analytics
    API Access (B2B)      │ 100 GRX/mo    │ Operators   │ Enterprise integration


FEE DISTRIBUTION:
═══════════════════════════════════════════════════════════════════════════════════

    Total Fees Collected
           │
           ▼
    ┌──────────────────────────────────────────────────────────────────────┐
    │                                                                      │
    │   ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐  │
    │   │                 │   │                 │   │                 │  │
    │   │   Operations    │   │   Development   │   │    Reserve      │  │
    │   │      50%        │   │      30%        │   │      20%        │  │
    │   │                 │   │                 │   │                 │  │
    │   │ • Servers       │   │ • Engineering   │   │ • Market making │  │
    │   │ • Support       │   │ • Features      │   │ • Insurance     │  │
    │   │ • Compliance    │   │ • Security      │   │ • Growth fund   │  │
    │   │                 │   │                 │   │                 │  │
    │   └─────────────────┘   └─────────────────┘   └─────────────────┘  │
    │                                                                      │
    └──────────────────────────────────────────────────────────────────────┘
```

---

## 6. Economic Model Analysis

### 6.1 Value Flow Analysis

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                           VALUE FLOW ANALYSIS                                      │
└────────────────────────────────────────────────────────────────────────────────────┘


                            ECONOMIC VALUE CYCLE
                            ════════════════════


    ┌──────────────────────────────────────────────────────────────────────────┐
    │                                                                          │
    │                    ┌───────────────────┐                                │
    │                    │                   │                                │
    │                    │  RENEWABLE ENERGY │                                │
    │                    │   GENERATION      │                                │
    │                    │                   │                                │
    │                    └─────────┬─────────┘                                │
    │                              │                                          │
    │                              │ Physical Energy                          │
    │                              ▼                                          │
    │    ┌─────────────────────────────────────────────────────────────┐     │
    │    │                                                             │     │
    │    │                      TOKENIZATION                           │     │
    │    │                   (1 kWh = 1 GRID)                          │     │
    │    │                                                             │     │
    │    └───────────────────────────┬─────────────────────────────────┘     │
    │                                │                                        │
    │                                │ Digital Asset                          │
    │                                ▼                                        │
    │    ┌─────────────────────────────────────────────────────────────┐     │
    │    │                                                             │     │
    │    │                     P2P TRADING                             │     │
    │    │              (Price Discovery + Settlement)                 │     │
    │    │                                                             │     │
    │    └───────────────────────────┬─────────────────────────────────┘     │
    │                                │                                        │
    │              ┌─────────────────┴─────────────────┐                      │
    │              │                                   │                      │
    │              ▼                                   ▼                      │
    │    ┌─────────────────┐                 ┌─────────────────┐             │
    │    │                 │                 │                 │             │
    │    │  SELLER VALUE   │                 │  BUYER VALUE    │             │
    │    │                 │                 │                 │             │
    │    │ • GRX revenue   │                 │ • Energy access │             │
    │    │ • ERC certs     │                 │ • Cost savings  │             │
    │    │ • Grid parity   │                 │ • Green proof   │             │
    │    │                 │                 │                 │             │
    │    └─────────────────┘                 └─────────────────┘             │
    │                                                                          │
    └──────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Market Dynamics

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                            MARKET DYNAMICS                                         │
└────────────────────────────────────────────────────────────────────────────────────┘


                    NETWORK EFFECTS
                    ═══════════════

    ┌────────────────────────────────────────────────────────────────────┐
    │                                                                    │
    │     More            More              More            More        │
    │   Prosumers  ──►  Supply   ──►    Liquidity   ──►   Buyers       │
    │       │                                                 │         │
    │       │                                                 │         │
    │       └─────────────────────────────────────────────────┘         │
    │                           ▲                                       │
    │                           │                                       │
    │                     POSITIVE                                      │
    │                     FEEDBACK                                      │
    │                       LOOP                                        │
    │                                                                    │
    └────────────────────────────────────────────────────────────────────┘


                    MARKET LIQUIDITY STAGES
                    ══════════════════════

    Stage 1: Bootstrap              Stage 2: Growth               Stage 3: Mature
    ──────────────────              ──────────────────            ─────────────────

    ┌─────────────────┐            ┌─────────────────┐           ┌─────────────────┐
    │                 │            │                 │           │                 │
    │  Few prosumers  │            │  Growing base   │           │  Dense network  │
    │  Limited orders │     ──►    │  Active trading │    ──►    │  Deep liquidity │
    │  Wide spreads   │            │  Narrowing      │           │  Tight spreads  │
    │                 │            │  spreads        │           │                 │
    └─────────────────┘            └─────────────────┘           └─────────────────┘

    Intervention:                  Intervention:                 Intervention:
    • Market making               • Marketing                   • Maintain quality
    • Incentive programs          • Partnerships                • Innovation
```

---

## 7. Comparative Economics

### 7.1 Grid vs. Platform Pricing

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                        GRID VS. PLATFORM PRICING                                   │
└────────────────────────────────────────────────────────────────────────────────────┘


                    COST COMPARISON (Per kWh)
                    ═════════════════════════

    Component                │ Grid Utility  │ GridTokenX  │ Savings
    ─────────────────────────┼───────────────┼─────────────┼──────────
    Base Energy Cost         │ 3.00 THB      │ 2.90 THB    │ 3%
    Distribution Fee         │ 0.50 THB      │ 0.00 THB    │ 100%
    Transmission Fee         │ 0.30 THB      │ 0.00 THB    │ 100%
    Administrative Fee       │ 0.15 THB      │ 0.00 THB    │ 100%
    Platform Fee (0.25%)     │ 0.00 THB      │ 0.01 THB    │ N/A
    VAT (7%)                 │ 0.28 THB      │ 0.20 THB    │ 29%
    ─────────────────────────┼───────────────┼─────────────┼──────────
    TOTAL                    │ 4.23 THB      │ 3.11 THB    │ 26%
    
    Note: GridTokenX price assumes 1 GRX ≈ 1.17 THB exchange rate
          (based on market equilibrium with slight premium for renewables)


                    VALUE PROPOSITION CHART
                    ═══════════════════════

    Cost (THB/kWh)
         │
      5  │     ████████████████████████████
         │     █     GRID UTILITY       █
    4.23 │ ───►█─────────────────────────█
         │     ████████████████████████████
      4  │
         │
      3  │     ████████████████
    3.05 │ ───►█  GRIDTOKENX  █◄─── 28% SAVINGS
         │     ████████████████
      2  │
         │
      1  │
         │
         │─────────────────────────────────────
                Grid              P2P
               Utility          Platform
```

### 7.2 Investment Return Analysis

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                      PROSUMER INVESTMENT RETURN                                    │
└────────────────────────────────────────────────────────────────────────────────────┘


SCENARIO: 5 kW Residential Solar Installation
═══════════════════════════════════════════════════════════════════════════════════

ASSUMPTIONS:
• System Cost: 150,000 THB
• Monthly Production: 600 kWh (Thailand average)
• Self-Consumption: 40% (240 kWh)
• Surplus for Sale: 60% (360 kWh)


WITHOUT GRIDTOKENX:
───────────────────────────────────────────────────────────────────────────────────
    Revenue Source           │ Monthly Value    │ Annual Value
    ─────────────────────────┼──────────────────┼───────────────
    Self-consumption savings │ 240 × 4.23 THB   │ 12,175 THB
    Feed-in tariff (2 THB)   │ 360 × 2.00 THB   │ 8,640 THB
    ─────────────────────────┼──────────────────┼───────────────
    TOTAL                    │ 1,735 THB        │ 20,815 THB

    Payback Period: 150,000 ÷ 20,815 = 7.2 years


WITH GRIDTOKENX:
───────────────────────────────────────────────────────────────────────────────────
    Revenue Source           │ Monthly Value    │ Annual Value
    ─────────────────────────┼──────────────────┼───────────────
    Self-consumption savings │ 240 × 4.23 THB   │ 12,175 THB
    P2P sales (3.0 GRX/kWh)  │ 360 × 3.51 THB   │ 15,163 THB
    Platform fee (0.25%)     │ -38 THB          │ -455 THB
    ERC certificate revenue  │ Variable         │ 1,200 THB
    ─────────────────────────┼──────────────────┼───────────────
    TOTAL                    │ 2,340 THB        │ 28,083 THB

    Payback Period: 150,000 ÷ 28,083 = 5.34 years

    Note: Based on 1 GRX ≈ 1.17 THB, average market price 3.0 GRX/kWh


IMPROVEMENT:
───────────────────────────────────────────────────────────────────────────────────
    • Annual Revenue Increase: +7,268 THB (+35%)
    • Payback Reduction: -1.86 years (-26%)
    • ROI Improvement: +35%
    • Additional Benefits:
      - Real-time settlement (vs. monthly feed-in tariff)
      - Price discovery through market mechanism
      - Green energy certificates (ERC) for ESG reporting
      - Atomic settlement security (no payment defaults)
      - 99.7% transaction success rate (validated in load testing)
```

---

## 8. Risk Factors

### 8.1 Economic Risks

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                           ECONOMIC RISK MATRIX                                     │
└────────────────────────────────────────────────────────────────────────────────────┘


    RISK                    │ PROBABILITY │ IMPACT  │ MITIGATION
    ────────────────────────┼─────────────┼─────────┼─────────────────────────────
    Price Volatility        │ High        │ Medium  │ Market depth, price bands
    Liquidity Crisis        │ Low         │ High    │ Market making, reserves
    Regulatory Changes      │ Medium      │ High    │ Compliance, lobbying
    Grid Price Changes      │ Medium      │ Medium  │ Pricing algorithms
    Token Value Collapse    │ Low         │ High    │ Utility backing, burns
    Network Effects Failure │ Medium      │ High    │ Incentives, partnerships


RISK MITIGATION MECHANISMS:
═══════════════════════════════════════════════════════════════════════════════════

1. PRICE VOLATILITY
   ┌─────────────────────────────────────────────────────────────────────┐
   │  • Price bands: ±20% daily movement limit                           │
   │  • Circuit breakers: Pause trading if extreme moves                │
   │  • Market making: Platform provides baseline liquidity             │
   └─────────────────────────────────────────────────────────────────────┘

2. LIQUIDITY CRISIS
   ┌─────────────────────────────────────────────────────────────────────┐
   │  • Reserve fund: 20% of fees allocated                             │
   │  • Emergency liquidity: Platform acts as buyer of last resort      │
   │  • Incentive programs: Bonus for market makers                     │
   └─────────────────────────────────────────────────────────────────────┘

3. TOKEN VALUE
   ┌─────────────────────────────────────────────────────────────────────┐
   │  • Physical backing: 1 token = 1 kWh verified energy               │
   │  • Utility requirement: Must hold for platform features            │
   │  • Burn mechanism: Reduces supply when energy consumed             │
   └─────────────────────────────────────────────────────────────────────┘
```

---

## 9. Summary Metrics

### 9.1 Key Economic Indicators

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                         KEY ECONOMIC INDICATORS                                    │
└────────────────────────────────────────────────────────────────────────────────────┘


TOKEN METRICS (Projected Year 1)
═══════════════════════════════════════════════════════════════════════════════════

    Metric                          │ Value              │ Notes
    ────────────────────────────────┼────────────────────┼─────────────────────
    Total Supply                    │ 864,000 GRID       │ End of Year 1
    Circulating Supply              │ 690,000 GRID       │ 80% (rest locked)
    Daily Trading Volume            │ 5,000 GRID         │ Target
    Average Price                   │ 3.0 GRX/GRID       │ Market determined
    Market Cap (GRX)                │ 2,592,000 GRX      │ Supply × Price


PLATFORM METRICS (Projected Year 1)
═══════════════════════════════════════════════════════════════════════════════════

    Metric                          │ Value              │ Notes
    ────────────────────────────────┼────────────────────┼─────────────────────
    Active Prosumers                │ 200                │ End of Year 1
    Active Consumers                │ 1,000              │ 5:1 ratio
    Monthly Energy Traded           │ 72,000 kWh         │ Average
    Monthly Platform Revenue        │ 180 GRID           │ From fees
    Average Order Size              │ 50 kWh             │ Per transaction


EFFICIENCY METRICS
═══════════════════════════════════════════════════════════════════════════════════

    Metric                          │ Value              │ Notes
    ────────────────────────────────┼────────────────────┼─────────────────────
    Order Fill Rate                 │ >80%               │ Target
    Average Settlement Time         │ <1 second          │ Blockchain
    Platform Uptime                 │ >99.9%             │ SLA
    Customer Acquisition Cost       │ <50 GRID           │ Per user
```

---

## 10. Document Navigation

| Previous | Current | Next |
|----------|---------|------|
| [04-DATA-FLOW-DIAGRAMS.md](./04-DATA-FLOW-DIAGRAMS.md) | **05-TOKEN-ECONOMICS.md** | [06-PROCESS-FLOWS.md](./06-PROCESS-FLOWS.md) |

---

**Document Version**: 2.0  
**Last Updated**: January 25, 2026  
**Status**: Complete (Research Paper Edition)

**Key Updates in v2.0:**
- Updated token symbol from GRID to GRX (GridTokenX)
- Corrected to Token-2022 standard (SPL Token-2022)
- Added actual performance metrics from comprehensive testing
- Updated with measured latency and throughput values
- Enhanced with cross-program invocation details
- Added dual high-water mark economic security
- Updated projections with January 2026 pilot data
- Included all 7 programs in token flow model
- Added BFT oracle consensus validation details
- Updated risk analysis with implemented mitigations

**References:**
- [Energy Token Program](../programs/energy-token.md) - Technical implementation details
- [Trading Program](../programs/trading.md) - Multi-modal marketplace mechanics
- [Governance Program](../programs/governance.md) - ERC certificate economics
- [System Architecture](./03-system-architecture.md) - Cross-program architecture
- [Software Testing](./11-software-testing.md) - Performance validation results
