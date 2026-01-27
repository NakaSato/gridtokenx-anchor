# System Architecture

## GridTokenX Technical Architecture Documentation

> *January 2026 Edition - Research Paper Documentation*

---

## 1. High-Level Architecture

### 1.1 System Overview

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                          GRIDTOKENX SYSTEM ARCHITECTURE                            │
└────────────────────────────────────────────────────────────────────────────────────┘

                                    ┌─────────────────┐
                                    │   End Users     │
                                    │  (Prosumers &   │
                                    │   Consumers)    │
                                    └────────┬────────┘
                                             │
                        ┌────────────────────┴────────────────────┐
                        │                                         │
                        ▼                                         ▼
              ┌─────────────────┐                      ┌─────────────────┐
              │   Web Client    │                      │  Mobile Client  │
              │   (Frontend)    │                      │   (Future)      │
              └────────┬────────┘                      └────────┬────────┘
                       │                                        │
                       └────────────────┬───────────────────────┘
                                        │
                                        ▼
        ┌───────────────────────────────────────────────────────────────┐
        │                      API GATEWAY LAYER                        │
        │                                                               │
        │   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
        │   │   REST API  │  │  WebSocket  │  │   GraphQL   │         │
        │   │  Endpoints  │  │   Server    │  │  (Future)   │         │
        │   └─────────────┘  └─────────────┘  └─────────────┘         │
        └───────────────────────────┬───────────────────────────────────┘
                                    │
        ┌───────────────────────────┴───────────────────────────────────┐
        │                      BACKEND SERVICES                         │
        │                                                               │
        │   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
        │   │   User      │  │   Meter     │  │   Trading   │         │
        │   │   Service   │  │   Service   │  │   Service   │         │
        │   └─────────────┘  └─────────────┘  └─────────────┘         │
        │                                                               │
        │   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
        │   │   Event     │  │   Polling   │  │   Bridge    │         │
        │   │   Listener  │  │   Service   │  │   Service   │         │
        │   └─────────────┘  └─────────────┘  └─────────────┘         │
        └───────────────────────────┬───────────────────────────────────┘
                                    │
        ┌───────────────────────────┴───────────────────────────────────┐
        │                       DATA LAYER                              │
        │                                                               │
        │   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
        │   │ PostgreSQL  │  │    Redis    │  │   Solana    │         │
        │   │  Database   │  │    Cache    │  │    RPC      │         │
        │   └─────────────┘  └─────────────┘  └─────────────┘         │
        └───────────────────────────────────────────────────────────────┘
                                    │
        ┌───────────────────────────┴───────────────────────────────────┐
        │                    BLOCKCHAIN LAYER                           │
        │                                                               │
        │                  ┌─────────────────────┐                     │
        │                  │  Solana Blockchain  │                     │
        │                  │      (PoA)          │                     │
        │                  └──────────┬──────────┘                     │
        │                             │                                 │
        │   ┌─────────────────────────┼─────────────────────────┐      │
        │   │                         │                         │      │
        │   ▼                         ▼                         ▼      │
        │ ┌───────────┐        ┌───────────┐        ┌───────────┐     │
        │ │  Registry │        │  Energy   │        │   Oracle  │     │
        │ │  Program  │        │   Token   │        │  Program  │     │
        │ │  (3aF9..) │        │  (8jTD..) │        │  (ACeK..) │     │
        │ └───────────┘        └───────────┘        └───────────┘     │
        │                                                               │
        │ ┌───────────┐        ┌───────────┐        ┌───────────┐     │
        │ │  Trading  │        │Governance │        │Blockbench │     │
        │ │  Program  │        │  Program  │        │  Program  │     │
        │ │  (GTuR..) │        │  (51d3..) │        │  (B5aD..) │     │
        │ └───────────┘        └───────────┘        └───────────┘     │
        │                                                               │
        │                    ┌───────────┐                             │
        │                    │    TPC    │                             │
        │                    │ Benchmark │                             │
        │                    │  (BcXc..) │                             │
        │                    └───────────┘                             │
        └───────────────────────────────────────────────────────────────┘
                                    │
        ┌───────────────────────────┴───────────────────────────────────┐
        │                   EXTERNAL INTEGRATIONS                       │
        │                                                               │
        │   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
        │   │ Smart Meter │  │  Thai Baht  │  │    Grid     │         │
        │   │  Simulator  │  │    Chain    │  │  Operators  │         │
        │   └─────────────┘  └─────────────┘  └─────────────┘         │
        └───────────────────────────────────────────────────────────────┘
```

---

## 2. Layer Architecture

### 2.1 Four-Layer Model

```
┌────────────────────────────────────────────────────────────────┐
│                    LAYERED ARCHITECTURE                        │
└────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│                    PRESENTATION LAYER                         │
│                                                               │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐        │
│  │    Web UI   │   │  Mobile UI  │   │  Admin UI   │        │
│  │   (React)   │   │  (Future)   │   │  (Future)   │        │
│  └─────────────┘   └─────────────┘   └─────────────┘        │
│                                                               │
│  Responsibilities:                                            │
│  • User interface rendering                                   │
│  • Form validation                                            │
│  • State management                                           │
│  • API communication                                          │
└────────────────────────────────┬─────────────────────────────┘
                                 │
                                 ▼
┌──────────────────────────────────────────────────────────────┐
│                    APPLICATION LAYER                          │
│                                                               │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐        │
│  │  API Server │   │  WebSocket  │   │   Event     │        │
│  │  (Express)  │   │  (Socket.io)│   │  Processor  │        │
│  └─────────────┘   └─────────────┘   └─────────────┘        │
│                                                               │
│  Responsibilities:                                            │
│  • Request/response handling                                  │
│  • Authentication/authorization                               │
│  • Business logic orchestration                               │
│  • Event processing                                           │
└────────────────────────────────┬─────────────────────────────┘
                                 │
                                 ▼
┌──────────────────────────────────────────────────────────────┐
│                      DATA LAYER                               │
│                                                               │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐        │
│  │ PostgreSQL  │   │    Redis    │   │   Solana    │        │
│  │   (RDBMS)   │   │   (Cache)   │   │   (State)   │        │
│  └─────────────┘   └─────────────┘   └─────────────┘        │
│                                                               │
│  Responsibilities:                                            │
│  • Data persistence                                           │
│  • Query optimization                                         │
│  • Cache management                                           │
│  • Blockchain state                                           │
└────────────────────────────────┬─────────────────────────────┘
                                 │
                                 ▼
┌──────────────────────────────────────────────────────────────┐
│                   BLOCKCHAIN LAYER                            │
│                                                               │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐        │
│  │   Anchor    │   │ SPL Token   │   │  System     │        │
│  │  Programs   │   │  Program    │   │  Programs   │        │
│  └─────────────┘   └─────────────┘   └─────────────┘        │
│                                                               │
│  Responsibilities:                                            │
│  • Smart contract execution                                   │
│  • Token management                                           │
│  • State transitions                                          │
│  • Event emission                                             │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. Smart Contract Architecture

### 3.1 Program Relationship Diagram

```
┌────────────────────────────────────────────────────────────────┐
│              SMART CONTRACT PROGRAM RELATIONSHIPS              │
└────────────────────────────────────────────────────────────────┘

                        ┌─────────────────────┐
                        │   GOVERNANCE        │
                        │   PROGRAM           │
                        │                     │
                        │ • ERC Certificates  │
                        │ • Proposals         │
                        │ • Voting            │
                        └──────────┬──────────┘
                                   │
                                   │ Validates ERC for Trading
                                   ▼
┌─────────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│   REGISTRY          │     │    TRADING          │     │   ORACLE            │
│   PROGRAM           │     │    PROGRAM          │     │   PROGRAM           │
│                     │     │                     │     │                     │
│ • User Registration │     │ • Order Management  │     │ • Price Feeds       │
│ • Meter Management  │────►│ • Order Matching    │◄────│ • Rate Updates      │
│ • Reading Storage   │     │ • Settlement        │     │ • External Data     │
│ • Balance Settle    │     │ • Escrow Control    │     │                     │
└──────────┬──────────┘     └──────────┬──────────┘     └─────────────────────┘
           │                           │
           │ CPI: Mint Request         │ CPI: Token Transfer
           ▼                           ▼
        ┌─────────────────────────────────────────────┐
        │              ENERGY TOKEN PROGRAM           │
        │                                             │
        │            • GRID Token Mint               │
        │            • Token Transfers               │
        │            • Burn Operations               │
        │                                             │
        │                   Uses                     │
        │                    ▼                       │
        │         ┌─────────────────────┐           │
        │         │   SPL TOKEN         │           │
        │         │   PROGRAM           │           │
        │         │   (System)          │           │
        │         └─────────────────────┘           │
        └─────────────────────────────────────────────┘


Legend:
─────► CPI (Cross-Program Invocation)
────── Data/State Dependency
```

### 3.2 Program Specifications

| Program | ID | Purpose | Key Instructions | Avg CU | Throughput |
|---------|----|---------|-----------------|---------|-----------|
| **Registry** | `3aF9...W8a7` | Identity & Device Mgmt | `register_user` (5.5k CU), `register_meter` (6.2k CU), `update_meter_reading` (3.5k CU), `settle_energy` (12k CU w/ CPI), `update_claimed_erc_generation` (2.8k CU) | 6,000 CU | 19,350/sec |
| **Energy Token** | `8jTD...yEur` | GRX Token-2022 Wrapper | `initialize_token` (13k CU), `create_token_mint` (45k CU), `mint_tokens_direct` (18k CU), `burn_tokens` (14k CU), `transfer_tokens` (15.2k CU), `add_rec_validator` (2.8k CU) | 18,000 CU | 6,665/sec |
| **Oracle** | `ACeK...AoE` | Meter Data Validation | `initialize` (7k CU), `submit_meter_reading` (8k CU), `trigger_market_clearing` (2.5k CU), `add_backup_oracle` (3.7k CU), `remove_backup_oracle` (4.3k CU) | 8,000 CU | 15,000/sec |
| **Trading** | `GTuR...ctk` | Multi-Modal Marketplace | `create_market` (8.5k CU), `create_buy_order` (7.2k CU), `create_sell_order` (7.5k CU), `match_orders` (15k CU), `execute_atomic_settlement` (28k CU), `update_price_history` (3k CU) | 12,000 CU | 8,000/sec |
| **Governance** | `51d3...vXe` | ERC Certificates & PoA | `initialize_poa_config` (5.2k CU), `issue_erc` (6.5k CU), `validate_erc` (4.8k CU), `issue_erc_with_verification` (11.2k CU w/ CPI), `transfer_erc` (5k CU), `revoke_erc` (3.5k CU) | 6,200 CU | 18,460/sec |
| **Blockbench** | `B5aD...xyz` | Performance Testing | `do_nothing` (1.2k CU), `cpu_heavy` (18.5k CU), `io_heavy` (22k CU), `analytics` (25k CU), `ycsb_workload_a/b/c` (8.5-12k CU) | 15,000 CU | 6,486/sec |
| **TPC-Benchmark** | `BcXc...abc` | TPC-C Database Testing | `new_order` (80k CU), `payment` (15k CU), `delivery` (45k CU), `order_status` (3k CU), `stock_level` (8k CU) | 30,000 CU | 3,705/sec |

**Performance Notes:**
- All CU values measured from January 2026 comprehensive benchmarks
- Throughput calculated as: (48M CU/block × 2.5 blocks/sec) ÷ Avg CU
- CPI instructions include cross-program overhead (~3-6k CU)
- Post-optimization average: 12,000 CU/tx (45.5% reduction from 22k CU)

---

## 4. Account Model

### 4.1 PDA (Program Derived Address) Structure

```
┌────────────────────────────────────────────────────────────────┐
│                    PDA ACCOUNT HIERARCHY                       │
└────────────────────────────────────────────────────────────────┘

Registry Program (3aF9..W8a7)
├── Registry PDA
│   Seeds: ["registry"]
│   └── Global state (authority, counters, total_users, total_meters)
│
├── User PDAs
│   Seeds: ["user", wallet_pubkey]
│   └── User profile, type, status, registration timestamp
│
└── Meter PDAs
    Seeds: ["meter", meter_id]
    └── total_production, total_consumption, settled_net_generation,
        claimed_erc_generation (dual high-water marks), last_reading_at

Energy Token Program (8jTD..yEur)
├── Token Info PDA (Mint Authority)
│   Seeds: ["token_info_2022"]
│   └── Controls token minting, stores registry_program_id,
│       total_supply, rec_validator list (max 10)
│
├── GRX Token Mint (Token-2022)
│   └── SPL Token-2022 mint account with Metaplex metadata
│
└── User Token Account PDAs
    Seeds: ["user_token_account", wallet_pubkey]
    └── Associated token accounts for each user

Oracle Program (ACeK..AoE)
├── Oracle Data PDA
│   Seeds: ["oracle_data"]
│   └── total_valid_readings, total_rejected_readings,
│       last_clearing_timestamp, is_active
│
├── Oracle Authority PDA
│   Seeds: ["oracle_authority"]
│   └── Primary oracle authority (API gateway wallet)
│
└── Backup Oracle PDAs
    Seeds: ["backup_oracle", oracle_pubkey]
    └── Backup oracle list for BFT consensus (max 3)

Trading Program (GTuR..ctk)
├── Market PDA
│   Seeds: ["market"]
│   └── total_orders, matched_orders, total_volume,
│       volume_weighted_price (VWAP), last_clearing_price
│
├── Order PDAs
│   Seeds: ["order", user_pubkey, order_counter]
│   └── order_type (Bilateral/AMM/Auction/BatchClearing),
│       amount, filled_amount, price_per_kwh, status,
│       erc_certificate_id (optional), created_at, expires_at
│
└── Escrow PDAs
    Seeds: ["escrow", order_id]
    └── Locked GRX tokens for pending orders

Governance Program (51d3..vXe)
├── PoA Config PDA
│   Seeds: ["poa_config"]
│   └── authority, pending_authority, transfer_initiated_at,
│       required_signers (multi-sig)
│
└── ERC Certificate PDAs
    Seeds: ["erc_certificate", certificate_id]
    └── energy_amount, energy_source (Solar/Wind/Hydro),
        status (Pending/Active/Retired/Revoked),
        issued_at, validated_at, retired_at

Blockbench Program (B5aD..xyz)
├── Benchmark State PDA
│   Seeds: ["benchmark_state"]
│   └── total_operations, total_compute_units,
│       workload_stats (YCSB A/B/C/D/E/F)
│
└── Workload PDAs
    Seeds: ["workload", workload_type]
    └── Read/update ratios, operation counts, latency stats

TPC-Benchmark Program (BcXc..abc)
├── Warehouse PDAs
│   Seeds: ["warehouse", warehouse_id]
│   └── ytd (year-to-date metrics), tax_rate
│
├── District PDAs
│   Seeds: ["district", warehouse_id, district_id]
│   └── next_o_id (critical serialization point),
│       ytd, tax_rate
│
├── Customer PDAs
│   Seeds: ["customer", warehouse_id, district_id, customer_id]
│   └── balance, ytd_payment, payment_cnt, delivery_cnt
│
└── Order PDAs
    Seeds: ["order", warehouse_id, district_id, order_id]
    └── customer_id, entry_d, carrier_id, ol_cnt, all_local
```

### 4.2 Account Size Calculations

```
┌────────────────────────────────────────────────────────────────┐
│                   ACCOUNT SIZE BREAKDOWN                       │
└────────────────────────────────────────────────────────────────┘

User Account (148 bytes)
┌─────────────────────────────────────┐
│ Discriminator        8 bytes        │
│ wallet              32 bytes        │
│ user_type            1 byte         │
│ status               1 byte         │
│ registered_at        8 bytes        │
│ total_production     8 bytes        │
│ total_consumption    8 bytes        │
│ total_trades         8 bytes        │
│ name (32 chars)     36 bytes        │
│ metadata            38 bytes        │
│─────────────────────────────────────│
│ Rent: ~0.001 SOL                    │
└─────────────────────────────────────┘

Meter Account (256 bytes)
┌─────────────────────────────────────┐
│ Discriminator        8 bytes        │
│ meter_id            32 bytes        │
│ owner               32 bytes        │
│ status               1 byte         │
│ registered_at        8 bytes        │
│ total_production     8 bytes        │
│ total_consumption    8 bytes        │
│ settled_net_gen      8 bytes        │
│ claimed_erc_gen      8 bytes        │
│ last_reading_at      8 bytes        │
│ location            64 bytes        │
│ metadata            71 bytes        │
│─────────────────────────────────────│
│ Rent: ~0.002 SOL                    │
└─────────────────────────────────────┘

Order Account (176 bytes)
┌─────────────────────────────────────┐
│ Discriminator        8 bytes        │
│ order_id             8 bytes        │
│ seller              32 bytes        │
│ buyer (Option)      33 bytes        │
│ amount              8 bytes         │
│ filled_amount       8 bytes         │
│ price_per_kwh       8 bytes         │
│ order_type          1 byte          │
│ status              1 byte          │
│ created_at          8 bytes         │
│ filled_at (Option)  9 bytes         │
│ expires_at          8 bytes         │
│ erc_cert (Option)  33 bytes         │
│ bump                1 byte          │
│─────────────────────────────────────│
│ Rent: ~0.0015 SOL                   │
└─────────────────────────────────────┘
```

---

## 5. Integration Architecture

### 5.1 External System Integration

```
┌────────────────────────────────────────────────────────────────┐
│                  INTEGRATION ARCHITECTURE                      │
└────────────────────────────────────────────────────────────────┘

                    ┌─────────────────────┐
                    │   GRIDTOKENX        │
                    │   CORE PLATFORM     │
                    └──────────┬──────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
        ▼                      ▼                      ▼
┌───────────────┐      ┌───────────────┐      ┌───────────────┐
│  SMART METER  │      │  THAI BAHT    │      │    GRID       │
│  INTEGRATION  │      │    CHAIN      │      │  OPERATORS    │
│               │      │               │      │               │
│ Protocol:     │      │ Protocol:     │      │ Protocol:     │
│ HTTPS/Ed25519 │      │ Cross-chain   │      │ REST API      │
│               │      │ Bridge        │      │               │
└───────┬───────┘      └───────┬───────┘      └───────┬───────┘
        │                      │                      │
        ▼                      ▼                      ▼
┌───────────────┐      ┌───────────────┐      ┌───────────────┐
│ Reading Flow: │      │ Payment Flow: │      │ Data Flow:    │
│               │      │               │      │               │
│ Meter         │      │ User initiates│      │ Platform      │
│   ↓           │      │ THB payment   │      │ reports       │
│ Sign (Ed25519)│      │   ↓           │      │ generation    │
│   ↓           │      │ Bridge locks  │      │   ↓           │
│ HTTP POST     │      │ THB coins     │      │ Grid operator │
│   ↓           │      │   ↓           │      │ receives      │
│ API validates │      │ Proof to      │      │ aggregated    │
│   ↓           │      │ Solana        │      │ data          │
│ Store + Mint  │      │   ↓           │      │               │
│               │      │ Release tokens│      │               │
└───────────────┘      └───────────────┘      └───────────────┘
```

### 5.2 Smart Meter Integration Detail

```
┌────────────────────────────────────────────────────────────────┐
│               SMART METER INTEGRATION PROTOCOL                 │
└────────────────────────────────────────────────────────────────┘

Smart Meter Device                          API Gateway
────────────────                          ───────────

┌─────────────────┐                      ┌─────────────────┐
│ 1. Generate     │                      │                 │
│    Reading      │                      │                 │
│    {            │                      │                 │
│      meter_id,  │                      │                 │
│      production,│                      │                 │
│      consumption│                      │                 │
│      timestamp  │                      │                 │
│    }            │                      │                 │
└────────┬────────┘                      │                 │
         │                               │                 │
         ▼                               │                 │
┌─────────────────┐                      │                 │
│ 2. Sign with    │                      │                 │
│    Ed25519      │                      │                 │
│    Private Key  │                      │                 │
└────────┬────────┘                      │                 │
         │                               │                 │
         │    HTTP POST                  │                 │
         │    /api/meters/submit         │                 │
         │    ─────────────────────────► │ 3. Verify       │
         │    {                          │    Signature    │
         │      data: {...},             │                 │
         │      signature: "...",        │                 │
         │      public_key: "..."        │                 │
         │    }                          │                 │
         │                               └────────┬────────┘
         │                                        │
         │                                        ▼
         │                               ┌─────────────────┐
         │                               │ 4. Validate     │
         │                               │    - Timestamp  │
         │                               │    - Duplicates │
         │                               │    - Limits     │
         │                               └────────┬────────┘
         │                                        │
         │                                        ▼
         │                               ┌─────────────────┐
         │                               │ 5. Store in DB  │
         │                               │    minted=false │
         │                               └────────┬────────┘
         │                                        │
         │    Response: OK                        │
         │    ◄─────────────────────────          │
         │                                        │
         │                               ┌────────┴────────┐
         │                               │ 6. Polling      │
         │                               │    Service      │
         │                               │    processes    │
         │                               │    and mints    │
         │                               └─────────────────┘
```

---

## 6. Data Architecture

### 6.1 Data Storage Strategy

```
┌────────────────────────────────────────────────────────────────┐
│                    DATA STORAGE STRATEGY                       │
└────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                       ON-CHAIN (Solana)                         │
│                                                                 │
│  Store:                          Purpose:                       │
│  ├─ User PDAs                    Immutable identity            │
│  ├─ Meter PDAs                   Verified production records   │
│  ├─ Order PDAs                   Trading commitments           │
│  ├─ ERC Certificates             Green energy proof            │
│  └─ Token Balances               Asset ownership               │
│                                                                 │
│  Characteristics:                                               │
│  • Immutable once written                                       │
│  • Publicly verifiable                                          │
│  • Decentralized storage                                        │
│  • Higher cost per byte                                         │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      OFF-CHAIN (PostgreSQL)                     │
│                                                                 │
│  Store:                          Purpose:                       │
│  ├─ User profiles                Extended metadata             │
│  ├─ Meter readings               Time-series data              │
│  ├─ Order book cache             Fast query                    │
│  ├─ Trade history                Analytics                     │
│  └─ Session data                 User state                    │
│                                                                 │
│  Characteristics:                                               │
│  • Fast read/write                                              │
│  • Complex queries                                              │
│  • Lower cost storage                                           │
│  • Requires sync with chain                                     │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                        CACHE (Redis)                            │
│                                                                 │
│  Store:                          Purpose:                       │
│  ├─ Active order book            Real-time access              │
│  ├─ User sessions                Auth state                    │
│  ├─ Rate limits                  Abuse prevention              │
│  └─ Hot data                     Performance                   │
│                                                                 │
│  Characteristics:                                               │
│  • In-memory (fast)                                             │
│  • TTL-based expiry                                             │
│  • Pub/sub capabilities                                         │
│  • Volatile (requires rebuild)                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 Database Schema Overview

```
┌────────────────────────────────────────────────────────────────┐
│                 DATABASE ENTITY RELATIONSHIPS                  │
└────────────────────────────────────────────────────────────────┘

┌───────────────┐         ┌───────────────┐         ┌───────────────┐
│    users      │         │ meter_readings│         │    orders     │
├───────────────┤         ├───────────────┤         ├───────────────┤
│ id (PK)       │◄────────│ user_id (FK)  │         │ id (PK)       │
│ wallet_address│         │ id (PK)       │         │ seller_id (FK)│───────┐
│ user_type     │         │ kwh_produced  │         │ buyer_id (FK) │───────┤
│ name          │         │ kwh_consumed  │         │ amount        │       │
│ created_at    │         │ surplus       │         │ price_per_kwh │       │
│ pda_address   │         │ timestamp     │         │ status        │       │
└───────────────┘         │ minted        │         │ created_at    │       │
       │                  │ tx_signature  │         │ pda_address   │       │
       │                  └───────────────┘         └───────────────┘       │
       │                                                   │                │
       │                                                   │                │
       │                  ┌───────────────┐               │                │
       │                  │    trades     │               │                │
       │                  ├───────────────┤               │                │
       └──────────────────│ seller_id (FK)│◄──────────────┘                │
                          │ buyer_id (FK) │◄───────────────────────────────┘
                          │ id (PK)       │
                          │ order_id      │
                          │ amount        │
                          │ total_price   │
                          │ executed_at   │
                          │ tx_signature  │
                          └───────────────┘


Table Summary:
─────────────
• users: Platform users with wallet linkage
• meter_readings: Time-series energy data
• orders: Active and historical orders
• trades: Completed trade records
• erc_certificates: Green energy certificates
```

---

## 7. Security Architecture

### 7.1 Security Layers

```
┌────────────────────────────────────────────────────────────────┐
│                    SECURITY ARCHITECTURE                       │
└────────────────────────────────────────────────────────────────┘

Layer 1: Network Security
┌────────────────────────────────────────────────────────────────┐
│  • TLS/HTTPS for all communications                            │
│  • Rate limiting at API gateway                                │
│  • DDoS protection                                             │
│  • IP whitelisting for admin access                            │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
Layer 2: Authentication & Authorization
┌────────────────────────────────────────────────────────────────┐
│  • Wallet-based authentication (Solana signatures)             │
│  • JWT tokens for session management                           │
│  • Role-based access control (RBAC)                            │
│  • API key management for B2B                                  │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
Layer 3: Application Security
┌────────────────────────────────────────────────────────────────┐
│  • Input validation and sanitization                           │
│  • SQL injection prevention (parameterized queries)            │
│  • XSS protection                                              │
│  • CSRF tokens                                                 │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
Layer 4: Smart Contract Security
┌────────────────────────────────────────────────────────────────┐
│  • PDA-based authority (no private keys in programs)           │
│  • Arithmetic overflow protection (saturating_add/sub)         │
│  • Re-entrancy guards (checks-effects-interactions pattern)    │
│  • Account validation constraints (owner, PDA derivation)      │
│  • Dual high-water marks (double-spend prevention)             │
│  • Byzantine Fault Tolerant oracle (3f+1 consensus)            │
│  • Rate limiting (60s minimum interval for meter readings)     │
│  • Anomaly detection (reject >10:1 production:consumption)     │
│  • Temporal monotonicity (reject backdated readings)           │
│  • Multi-signature requirements (governance transfers)         │
│  • Test coverage: 94.2% (489 tests, 91 security-specific)     │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
Layer 5: Data Security
┌────────────────────────────────────────────────────────────────┐
│  • Encryption at rest (database)                               │
│  • Private key management (HSM for production)                 │
│  • Audit logging                                               │
│  • Backup and recovery procedures                              │
└────────────────────────────────────────────────────────────────┘
```

### 7.2 Threat Model

```
┌────────────────────────────────────────────────────────────────┐
│                      THREAT MODEL                              │
└────────────────────────────────────────────────────────────────┘

Threat Category          Attack Vector              Mitigation (Implemented)
─────────────────────────────────────────────────────────────────────────────

Financial Attacks
├─ Double-spending       Re-use same tokens         ✅ Escrow pattern + atomic CPI
├─ Double-minting        Mint twice for reading     ✅ settled_net_gen high-water mark
├─ Double-claiming       Tokens + certificates      ✅ Dual high-water marks
│                        for same energy            (settled_net_gen + claimed_erc_gen)
├─ Front-running         MEV exploitation           ✅ Batch clearing (uniform price)
├─ Price manipulation    VWAP gaming                ✅ Lazy updates (every 10 orders)
└─ Economic exploit      Insufficient collateral    ✅ Order escrow (100% locked)

Identity Attacks
├─ Wallet impersonation  Steal private key          ✅ Ed25519 signature verification
├─ Fake meter data       Spoofed readings           ✅ Meter signing + BFT consensus
├─ Sybil attack          Multiple fake accounts     ✅ KYC + wallet registration limits
└─ Oracle manipulation   Malicious data injection   ✅ Byzantine Fault Tolerant (3f+1)
│                                                   Quality scoring, backup oracles

Protocol Attacks
├─ Re-entrancy           Recursive CPI calls        ✅ Checks-effects-interactions
│                                                   State updated before CPI
├─ Integer overflow      Large number math          ✅ saturating_add/saturating_sub
├─ Integer underflow     Negative amounts           ✅ BN validation (unsigned types)
├─ Account confusion     Wrong account passed       ✅ PDA derivation verification
├─ Signature replay      Re-use old signatures      ✅ Temporal monotonicity
│                                                   (last_reading_at enforcement)
└─ Unauthorized CPI      External program calls     ⚠️  Partial (CPI caller verification
│                        restricted functions       pending in v0.2.0)

Data Integrity Attacks
├─ Anomalous readings    Impossible meter values    ✅ Anomaly detection (>10:1 reject)
├─ Backdated readings    Timestamp manipulation     ✅ Temporal monotonicity check
├─ Rate limit bypass     Spam submissions           ✅ 60s minimum interval enforcement
└─ Energy value overflow Exceed max capacity        ✅ Boundary checks (0-1M kWh)

System Attacks
├─ DDoS                  Overwhelm services         ✅ Rate limiting (API gateway)
│                                                   Cloudflare protection
├─ API abuse             Excessive requests         ✅ API keys + quota limits
├─ Data breach           Database access            ✅ Encryption at rest (AES-256)
│                                                   TLS 1.3 in transit
└─ Compute exhaustion    High CU consumption        ✅ Optimization (45.5% CU reduction)
│                        attacks                    Lazy updates, zero-copy accounts

Governance Attacks
├─ Authority takeover    Steal PoA authority        ✅ Multi-sig requirement (3-of-5)
│                                                   Time-locked transfers
├─ Certificate forgery   Fake ERC issuance          ✅ Admin authority validation
│                                                   Cross-program verification
└─ Certificate reuse     Retire then re-activate    ✅ Immutable status transitions
│                                                   (Active → Retired only)

Security Test Coverage: 91 tests, 96.8% coverage across 8 attack categories
Known Vulnerabilities: 0 critical, 1 medium (CPI caller verification pending)
```

---

## 8. Deployment Architecture

### 8.1 Environment Configuration

```
┌────────────────────────────────────────────────────────────────┐
│                 DEPLOYMENT ENVIRONMENTS                        │
└────────────────────────────────────────────────────────────────┘

Development (Local)
┌────────────────────────────────────────────────────────────────┐
│  Solana: solana-test-validator (PoA)                          │
│  Database: PostgreSQL (local)                                  │
│  Cache: Redis (local)                                          │
│  Backend: Node.js (hot reload)                                 │
│  Purpose: Development and testing                              │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
Staging (Cloud)
┌────────────────────────────────────────────────────────────────┐
│  Solana: Devnet                                                │
│  Database: PostgreSQL (Cloud SQL)                              │
│  Cache: Redis (Managed)                                        │
│  Backend: Container (Cloud Run)                                │
│  Purpose: Integration testing, demos                           │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
Production (Cloud)
┌────────────────────────────────────────────────────────────────┐
│  Solana: Mainnet-beta                                          │
│  Database: PostgreSQL (HA cluster)                             │
│  Cache: Redis (Cluster mode)                                   │
│  Backend: Kubernetes (GKE/EKS)                                 │
│  Purpose: Production workloads                                 │
└────────────────────────────────────────────────────────────────┘
```

### 8.2 Infrastructure Components

```
┌────────────────────────────────────────────────────────────────┐
│              PRODUCTION INFRASTRUCTURE                         │
└────────────────────────────────────────────────────────────────┘

                         Internet
                            │
                            ▼
                    ┌───────────────┐
                    │   CDN/WAF     │
                    │  (Cloudflare) │
                    └───────┬───────┘
                            │
                            ▼
                    ┌───────────────┐
                    │ Load Balancer │
                    │   (Cloud LB)  │
                    └───────┬───────┘
                            │
            ┌───────────────┼───────────────┐
            │               │               │
            ▼               ▼               ▼
    ┌───────────────┐ ┌───────────────┐ ┌───────────────┐
    │  API Server   │ │  API Server   │ │  API Server   │
    │   Pod #1      │ │   Pod #2      │ │   Pod #3      │
    └───────┬───────┘ └───────┬───────┘ └───────┬───────┘
            │               │               │
            └───────────────┼───────────────┘
                            │
            ┌───────────────┼───────────────┐
            │               │               │
            ▼               ▼               ▼
    ┌───────────────┐ ┌───────────────┐ ┌───────────────┐
    │  PostgreSQL   │ │    Redis      │ │   Solana      │
    │  Primary +    │ │   Cluster     │ │    RPC        │
    │   Replica     │ │               │ │   (Helius)    │
    └───────────────┘ └───────────────┘ └───────────────┘
```

---

## 9. Performance Specifications

### 9.1 Performance Specifications (January 2026 Benchmarks)

#### Transaction Latency (P95)

| Operation | Target | Measured | Status |
|-----------|--------|----------|--------|
| **Registry** | | | |
| register_user | < 500ms | 405ms | ✅ PASS |
| register_meter | < 500ms | 410ms | ✅ PASS |
| settle_energy (w/ CPI) | < 500ms | 425ms | ✅ PASS |
| **Energy Token** | | | |
| mint_tokens_direct | < 500ms | 410ms | ✅ PASS |
| burn_tokens | < 500ms | 405ms | ✅ PASS |
| transfer_tokens | < 500ms | 395ms | ✅ PASS |
| **Oracle** | | | |
| submit_meter_reading | < 500ms | 405ms | ✅ PASS |
| trigger_market_clearing | < 500ms | 375ms | ✅ PASS |
| **Trading** | | | |
| create_buy_order | < 500ms | 405ms | ✅ PASS |
| match_orders | < 500ms | 440ms | ✅ PASS |
| atomic_settlement (6-way) | < 600ms | 480ms | ✅ PASS |
| **Governance** | | | |
| issue_erc | < 500ms | 410ms | ✅ PASS |
| issue_erc_with_verification | < 500ms | 435ms | ✅ PASS |
| **Blockbench** | | | |
| do_nothing (baseline) | < 500ms | 380ms | ✅ PASS |
| cpu_heavy | < 500ms | 425ms | ✅ PASS |
| io_heavy | < 500ms | 445ms | ✅ PASS |
| **TPC-Benchmark** | | | |
| new_order | < 600ms | 480ms | ✅ PASS |
| payment | < 500ms | 420ms | ✅ PASS |

#### System-Level Performance

| Component | Metric | Target | Current | Status |
|-----------|--------|--------|---------|--------|
| **API Layer** | | | | |
| API Response | P95 Latency | < 200ms | ~150ms | ✅ PASS |
| WebSocket Push | Latency | < 100ms | ~75ms | ✅ PASS |
| **Data Layer** | | | | |
| Database Query | P95 Latency | < 50ms | ~30ms | ✅ PASS |
| Redis Cache Hit | Latency | < 5ms | ~2ms | ✅ PASS |
| **Blockchain** | | | | |
| Block Time | Avg | 400ms | 400ms | ✅ TARGET |
| TX Confirmation | P99 | < 1s | ~820ms | ✅ PASS |
| Finality | Guaranteed | N/A | 400ms (single block) | ✅ POA |
| **End-to-End** | | | | |
| Order Match Flow | E2E Latency | < 2s | ~885ms | ✅ PASS |
| Meter Reading Flow | E2E Processing | < 5s | ~1.8s | ✅ PASS |
| Settlement Flow | E2E Latency | < 3s | ~1.2s | ✅ PASS |

*Note: All latency measurements from local test validator (400ms block time). Mainnet performance may vary.*

### 9.2 Scalability Characteristics

```
┌────────────────────────────────────────────────────────────────┐
│                  SCALABILITY CHARACTERISTICS                   │
└────────────────────────────────────────────────────────────────┘

Horizontal Scaling (Stateless Components)
─────────────────────────────────────────
• API Servers: Auto-scale 2-20 pods (Kubernetes HPA)
• Event Processors: Scale based on queue depth (RabbitMQ/Redis Streams)
• WebSocket Servers: Sticky sessions with Redis pub/sub
• Blockchain RPC: Load-balanced across 3 endpoints with failover

Vertical Scaling (Stateful Components)
─────────────────────────────────────────
• PostgreSQL: Primary + 2 read replicas (streaming replication)
• Redis: Cluster mode (6 nodes: 3 masters, 3 replicas)
• Solana Validators: 7 PoA nodes (minimum 4f+1 for BFT)

Measured Throughput (January 2026)
─────────────────────────────────────────
Per-Program Theoretical Capacity:
• Registry: 19,350 operations/sec (avg 6.2k CU)
• Energy Token: 6,665 mints/sec (18k CU)
• Oracle: 15,000 readings/sec (8k CU)
• Trading: 8,000 matches/sec (15k CU)
• Governance: 18,460 issuances/sec (6.5k CU)
• Blockbench: 100,000 DoNothing/sec (1.2k CU)
• TPC-Benchmark: 3,705 New-Orders/sec (80k CU)

Sustained Throughput (Load Testing):
• Overall: 4,200 TPS (mixed workload)
• Meter Readings: ~8,000/sec (sustained)
• Trading Orders: ~6,000/sec (sustained)
• Order Matches: ~4,000/sec (sustained)
• API Requests: ~25,000/sec (gateway capacity)

Bottlenecks & Scaling Solutions:
─────────────────────────────────────────
1. Oracle Account Serialization
   Current: 400 readings/sec (sequential writes)
   Solution: Shard by region (10 oracle_data accounts)
   Result: 4,000 readings/sec (10x improvement)

2. TPC District.next_o_id Contention
   Current: 10 concurrent New-Orders/warehouse
   Solution: Scale warehouses (100x)
   Result: 1,000 concurrent transactions

3. Trading Market VWAP Updates
   Current: 300 orders/block (write lock)
   Solution: Lazy updates (every 10th order)
   Result: 3,000 orders/block (10x improvement)

Projected Capacity (Phase 2 - H2 2026):
─────────────────────────────────────────
• Target: 50,000 sustained TPS
• Regional sharding: 10 oracle data accounts
• Multi-warehouse: 100 TPC warehouses
• Optimized validators: 16-core, 128GB RAM
• Network: Southeast Asia coverage (100M potential users)
```

---

## 10. Document Navigation

| Previous | Current | Next |
|----------|---------|------|
| [02-BUSINESS-MODEL.md](./02-BUSINESS-MODEL.md) | **03-SYSTEM-ARCHITECTURE.md** | [04-DATA-FLOW-DIAGRAMS.md](./04-DATA-FLOW-DIAGRAMS.md) |

---

**Document Version**: 2.0  
**Last Updated**: January 25, 2026  
**Status**: Complete (Research Paper Edition)

**Key Updates in v2.0:**
- Added all 7 Anchor programs (Blockbench, TPC-Benchmark)
- Updated with measured performance metrics from comprehensive testing
- Enhanced security model with BFT consensus details
- Added actual CU consumption and throughput calculations
- Expanded PDA structure documentation for all programs
- Updated threat model with implemented mitigations
- Added scalability bottleneck analysis and solutions

**References:**
- [Program Documentation](../programs/) - Detailed technical docs for each program
- [ALGORITHMS.md](../ALGORITHMS.md) - Algorithm specifications and complexity analysis
- [Software Testing](./11-software-testing.md) - Comprehensive test coverage and results
