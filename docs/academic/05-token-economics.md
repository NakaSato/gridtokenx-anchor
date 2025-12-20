# Token Economics

## GridTokenX Token Economics Analysis

> *December 2025 Edition*

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
│  Symbol:            GRID                                                         │
│  Standard:          SPL Token (Solana Program Library)                          │
│  Decimals:          9                                                            │
│  Supply Type:       Elastic (Mint/Burn based on energy)                         │
│                                                                                  │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │                                                                        │     │
│  │   1 GRID Token  =  1 kWh of Verified Renewable Energy                 │     │
│  │                                                                        │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│                                                                                  │
│  Mint Authority:    Energy Token Program PDA                                     │
│  Freeze Authority:  None (freely transferable)                                   │
│  Burn Authority:    Token holder + Program                                       │
│                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Token Value Proposition

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                         TOKEN VALUE BACKING                                        │
└────────────────────────────────────────────────────────────────────────────────────┘


                    GRID TOKEN VALUE COMPONENTS
                    ═══════════════════════════

              ┌─────────────────────────────────────────┐
              │                                         │
              │            GRID TOKEN                   │
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
│ verified      │         │ P2P trading   │         │ to actual     │
│ energy        │         │ on platform   │         │ production    │
│ production    │         │               │         │               │
└───────────────┘         └───────────────┘         └───────────────┘
        │                         │                         │
        ▼                         ▼                         ▼
   1 kWh energy            Platform fees              No arbitrary
   measurement             discounts                  minting
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


ASSUMPTIONS:
─────────────────────────────────────────────────────────────────
• Starting prosumers: 100
• Growth rate: 25% per quarter
• Average surplus per prosumer: 500 kWh/month
• Seasonal variation: ±20%

PROJECTION TABLE:
─────────────────────────────────────────────────────────────────
Quarter     │ Prosumers │ Monthly Mint │ Cumulative Supply
────────────┼───────────┼──────────────┼───────────────────
Year 1 Q1   │ 100       │ 50,000 GRID  │ 150,000 GRID
Year 1 Q2   │ 125       │ 62,500 GRID  │ 337,500 GRID
Year 1 Q3   │ 156       │ 78,000 GRID  │ 571,500 GRID
Year 1 Q4   │ 195       │ 97,500 GRID  │ 864,000 GRID
Year 2 Q1   │ 244       │ 122,000 GRID │ 1,230,000 GRID
Year 2 Q2   │ 305       │ 152,500 GRID │ 1,687,500 GRID
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


TOKEN MOVEMENT SUMMARY:
═══════════════════════════════════════════════════════════════════════════════════

1. MINTING:     Energy Production → Prosumer Wallet
2. ESCROW:      Prosumer Wallet → Order Escrow (on sell)
3. TRADE:       Order Escrow → Buyer Wallet (on match)
4. CANCEL:      Order Escrow → Prosumer Wallet (on cancel)
5. TRANSFER:    Wallet → Wallet (peer transfer)
6. BURN:        Wallet → Void (optional, for consumption tracking)
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
       │   1. Initiate Trade             │                                 │
       │   (order_id)                    │                                 │
       │ ───────────────────────────────►│                                 │
       │                                 │                                 │
       │   2. Deduct GRX                 │                                 │
       │ ◄─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │                                 │
       │                                 │                                 │
       │                                 │   3. Credit GRX                 │
       │                                 │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─►│
       │                                 │                                 │
       │                                 │   4. Transfer GRID Tokens       │
       │   ◄─────────────────────────────│                                 │
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
    │   Revenue = (Surplus kWh × Market Price) - (Surplus kWh × Fee Rate)    │
    │                                                                         │
    │   Example:                                                              │
    │   Surplus: 100 kWh                                                      │
    │   Price: 3.0 GRX/kWh                                                   │
    │   Fee: 0.25%                                                           │
    │   Revenue = (100 × 3.0) - (100 × 3.0 × 0.0025) = 299.25 GRX           │
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
    Settlement Fee        │ 0.10%         │ Seller      │ Processing cost
    ERC Issuance          │ 5 GRID fixed  │ Prosumer    │ Certificate creation
    ERC Validation        │ 2 GRID fixed  │ Prosumer    │ Trading approval
    Cancellation Fee      │ 0.05%         │ Seller      │ Discourage spam
    API Access            │ 100 GRID/mo   │ B2B         │ Enterprise features


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
    Base Energy Cost         │ 3.00 THB      │ 2.80 THB    │ 7%
    Distribution Fee         │ 0.50 THB      │ 0.00 THB    │ 100%
    Transmission Fee         │ 0.30 THB      │ 0.00 THB    │ 100%
    Administrative Fee       │ 0.15 THB      │ 0.05 THB    │ 67%
    VAT (7%)                 │ 0.28 THB      │ 0.20 THB    │ 29%
    ─────────────────────────┼───────────────┼─────────────┼──────────
    TOTAL                    │ 4.23 THB      │ 3.05 THB    │ 28%


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
    P2P sales (3.0 GRX/kWh)  │ 360 × 3.50 THB   │ 15,120 THB
    ERC certificate bonus    │ Flat             │ 1,000 THB
    ─────────────────────────┼──────────────────┼───────────────
    TOTAL                    │ 2,358 THB        │ 28,295 THB

    Payback Period: 150,000 ÷ 28,295 = 5.3 years


IMPROVEMENT:
───────────────────────────────────────────────────────────────────────────────────
    • Annual Revenue Increase: +7,480 THB (+36%)
    • Payback Reduction: -1.9 years (-26%)
    • ROI Improvement: +36%
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

**Document Version**: 1.0  
**Last Updated**: November 2024  
**Status**: Complete
