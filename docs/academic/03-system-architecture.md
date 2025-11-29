# System Architecture

## GridTokenX Technical Architecture Documentation

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
        │ │  Registry │        │  Trading  │        │   Energy  │     │
        │ │  Program  │        │  Program  │        │   Token   │     │
        │ └───────────┘        └───────────┘        └───────────┘     │
        │                                                               │
        │ ┌───────────┐        ┌───────────┐                          │
        │ │Governance │        │   Oracle  │                          │
        │ │  Program  │        │  Program  │                          │
        │ └───────────┘        └───────────┘                          │
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

| Program | ID | Purpose | Key Instructions |
|---------|----|---------|--------------------|
| Registry | `2XPQm...W8a7` | User/Meter Management | register_user, register_meter, submit_reading, settle_balance |
| Energy Token | `94G1r...yEur` | Token Operations | initialize, mint_from_production, burn |
| Trading | `GZnqN...ctk` | Marketplace | create_order, match_order, cancel_order |
| Governance | `4DY97...vXe` | ERC/Voting | issue_erc, validate_erc, retire_erc |
| Oracle | `DvdtU...AoE` | External Data | update_price, get_price |

---

## 4. Account Model

### 4.1 PDA (Program Derived Address) Structure

```
┌────────────────────────────────────────────────────────────────┐
│                    PDA ACCOUNT HIERARCHY                       │
└────────────────────────────────────────────────────────────────┘

Registry Program
├── Registry PDA
│   Seeds: ["registry"]
│   └── Global state (authority, counters)
│
├── User PDAs
│   Seeds: ["user", wallet_pubkey]
│   └── User profile, type, status
│
└── Meter PDAs
    Seeds: ["meter", meter_id]
    └── Production, consumption, settled amounts

Energy Token Program
├── Mint Authority PDA
│   Seeds: ["mint_authority"]
│   └── Controls token minting
│
└── GRID Token Mint
    └── SPL Token mint account

Trading Program
├── Market PDA
│   Seeds: ["market"]
│   └── Global market state, depth, stats
│
├── Order PDAs
│   Seeds: ["order", seller, counter]
│   └── Individual order details
│
└── Escrow PDAs
    Seeds: ["escrow", order_id]
    └── Locked tokens for orders

Governance Program
├── Governance PDA
│   Seeds: ["governance"]
│   └── Global governance state
│
└── ERC Certificate PDAs
    Seeds: ["erc", certificate_id]
    └── Certificate details, status
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
│  • Authority validation (PDA ownership)                        │
│  • Arithmetic overflow protection (checked_*)                  │
│  • Re-entrancy guards                                          │
│  • Account validation constraints                              │
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

Threat Category          Attack Vector              Mitigation
─────────────────────────────────────────────────────────────────

Financial Attacks
├─ Double-spending       Re-use same tokens         Escrow pattern
├─ Double-minting        Mint twice for reading     settled_net_gen tracker
├─ Front-running         Order manipulation         Atomic transactions
└─ Price manipulation    Market gaming              Volume limits

Identity Attacks
├─ Wallet impersonation  Steal private key          Ed25519 signatures
├─ Fake meter data       Spoofed readings           Cryptographic signing
└─ Sybil attack          Multiple fake accounts     Registration limits

Protocol Attacks
├─ Re-entrancy           Recursive calls            State-first updates
├─ Integer overflow      Large number math          checked_* arithmetic
├─ Account confusion     Wrong account passed       PDA validation
└─ Signature replay      Re-use old signatures      Timestamp + nonce

System Attacks
├─ DDoS                  Overwhelm services         Rate limiting
├─ API abuse             Excessive requests         API keys + limits
└─ Data breach           Database access            Encryption + access control
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

### 9.1 Performance Targets

| Component | Metric | Target | Current |
|-----------|--------|--------|---------|
| API Response | P95 Latency | < 200ms | ~150ms |
| Database Query | P95 Latency | < 50ms | ~30ms |
| Blockchain TX | Confirmation | < 1s | ~400ms |
| Order Match | E2E Latency | < 2s | ~800ms |
| Meter Reading | Processing | < 5s | ~2s |

### 9.2 Scalability Characteristics

```
┌────────────────────────────────────────────────────────────────┐
│                  SCALABILITY CHARACTERISTICS                   │
└────────────────────────────────────────────────────────────────┘

Horizontal Scaling (Stateless Components)
─────────────────────────────────────────
• API Servers: Auto-scale 2-10 pods
• Event Processors: Scale based on queue depth
• WebSocket Servers: Sticky sessions with Redis pub/sub

Vertical Scaling (Stateful Components)
─────────────────────────────────────────
• PostgreSQL: Read replicas for queries
• Redis: Cluster mode for distribution
• Solana RPC: Multiple endpoints with failover

Throughput Estimates
─────────────────────────────────────────
• Meter Readings: ~1,000 per second
• Trading Orders: ~100 per second
• Order Matches: ~50 per second
• API Requests: ~10,000 per second
```

---

## 10. Document Navigation

| Previous | Current | Next |
|----------|---------|------|
| [02-BUSINESS-MODEL.md](./02-BUSINESS-MODEL.md) | **03-SYSTEM-ARCHITECTURE.md** | [04-DATA-FLOW-DIAGRAMS.md](./04-DATA-FLOW-DIAGRAMS.md) |

---

**Document Version**: 1.0  
**Last Updated**: November 2024  
**Status**: Complete
