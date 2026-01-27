# GridTokenX Anchor Programs Documentation

This document provides a comprehensive reference for the Solana Anchor programs that make up the GridTokenX platform and its associated benchmarking suites.

## System Overview

The GridTokenX platform is composed of several interacting on-chain programs that handle user identity, asset authentication, data ingestion, and peer-to-peer trading. In addition, the repository contains two performance benchmarking suites adapted for Solana.

### Program Map

| Program | Type | Description | Program ID |
|---------|------|-------------|------------|
| **Registry** | Core | Central identity and device registry | `3aF9FmyFuGzg4i1TCyySLQM1zWK8UUQyFALxo2f236ye` |
| **Energy Token** | Core | GRX Token-2022 management & minting | `8jTDw36yCQyYdr9hTtve5D5bFuQdaJ6f3WbdM4iGPHuq` |
| **Oracle** | Core | Smart meter data validation & ingestion | `ACeKwdMK1sma3EPnxy7bvgC5yMwy8tg7ZUJvaogC9YfR` |
| **Trading** | Core | P2P Energy Marketplace & AMM | `GTuRUUwCfvmqW7knqQtzQLMCy61p4UKUrdT5ssVgZbat` |
| **Governance** | Core | DAO/PoA System management | `51d3SDcs5coxkiwvcjMzPrKeajTPF9yikw66WezipTva` |
| **Blockbench** | Benchmark | System micro-benchmarks (YCSB) | `B5aDPT9bM692E63ZtBVLQuJhsoJsPdyjn6ATqqgWpbTg` |
| **TPC-Benchmark** | Benchmark | TPC-C Transaction benchmark | `BcXcPzZHpBJ82RwDSuVY2eVCXj3enda8R3AxUTjXwFgu` |

---

## Core Platform Programs

### 1. Registry Program
**ID:** `3aF9FmyFuGzg4i1TCyySLQM1zWK8UUQyFALxo2f236ye`

The Registry program serves as the source of truth for all participants in the network. It links on-chain identities (Public Keys) to physical entities (Users) and devices (Smart Meters).

#### Key Instructions
- **register_user**: Onboards a new participant (Consumer, Prosumer, or Producer) with geolocation data.
- **register_meter**: Links a physical smart meter ID to a User account.
- **set_oracle_authority**: Designates which Oracle program is authorized to write meter readings.
- **update_meter_reading**: Internal endpoint (called by Oracle) to update global generation/consumption stats.
- **set_meter/user_status**: Lifecycle management (Active, Suspended, Deactivated).

#### State
- **Registry**: Global counters for users and meters.
- **UserAccount**: Stores role (`UserType`), geolocation (lat/long), and reputation.
- **MeterAccount**: Stores the link between a device ID and an on-chain owner, plus cumulative energy stats.

---

### 2. Energy Token Program
**ID:** `8jTDw36yCQyYdr9hTtve5D5bFuQdaJ6f3WbdM4iGPHuq`

Manages the **GRX** token using the **Token-2022** standard. This program handles the cryptographic representation of energy credits and Renewable Energy Certificates (RECs).

#### Key Instructions
- **create_token_mint**: Creates the canonical GRX mint. Supports Metaplex metadata integration.
- **mint_to_wallet**: Mints tokens to a destination. Restricted to `token_info` authority.
- **initialize_token**: Configures the program and links it to the Registry.
- **transfer_tokens**: Wrapper around Token-2022 transfer with additional checks.
- **add_rec_validator**: Whitelists authorities allowed to validate Renewable Energy Certificates.

#### Features
- **Token-2022 Integration**: Uses the newer standard for advanced extensions.
- **REC Validation**: Includes logic to track authorized validators for certifications.

---

### 3. Oracle Program
**ID:** `ACeKwdMK1sma3EPnxy7bvgC5yMwy8tg7ZUJvaogC9YfR`

The Oracle program is the bridge between off-chain IoT devices (Smart Meters) and the on-chain Registry. It implements data quality checks and anomaly detection.

#### Key Instructions
- **submit_meter_reading**: The primary ingestion point. Accepts (Production, Consumption, Timestamp). Includes validation logic for:
    - Timestamp ordering (no future readings, no stale readings).
    - Rate limiting (minimum interval between readings).
    - Anomaly detection (spikes in values).
- **trigger_market_clearing**: Signal to process settlement periods.
- **update_validation_config**: Adjust thresholds for anomaly detection and rate limits.
- **add/remove_backup_oracle**: Manage redundancy in data providers.

#### Architecture
The Oracle acts as a "Gatekeeper". It does not store all historical data on-chain but aggregates it and forwards validated updates to the **Registry** program.

---

### 4. Trading Program
**ID:** `GTuRUUwCfvmqW7knqQtzQLMCy61p4UKUrdT5ssVgZbat`

A comprehensive marketplace supporting both Order Book (P2P) and Automated Market Maker (AMM) models for energy trading.

#### Key Instructions
- **P2P Order Book**:
    - `create_sell_order`: Lists energy for sale. Validates ownership of valid **ERC Certificates**.
    - `create_buy_order`: Places a bid for energy.
    - `match_orders`: Executes trades. Supports partial fills and price discovery (Volume Weighted Average Price).
- **AMM Pool**:
    - `initialize_amm_pool`: Sets up a liquidity pool with a specific curve (Constant Product, etc.).
    - `swap_buy_energy`: Immediate purchase against the pool.
- **Admin**:
    - `initialize_market`: Sets fees, clearing intervals, and batch configurations.

#### Features
- **ERC Integration**: Checks validity/expiry of Energy Attribute Certificates before allowing sales.
- **Price Discovery**: Implements logic to find fair clearing prices.
- **Modules**: Includes placeholders/logic for Carbon Credits, Confidential Trading (ZK), and Wormhole bridging.

---

### 5. Governance Program
**ID:** `51d3SDcs5coxkiwvcjMzPrKeajTPF9yikw66WezipTva`

Manages the Proof of Authority (PoA) consensus configuration and network-wide emergency controls.

#### Key Instructions
- **initialize_poa**: Sets up the initial validator set.
- **emergency_pause/unpause**: A "Circuit Breaker" to halt sensitive operations across the platform in case of exploit or bug.
- **Handlers**: Structured into modules (`authority`, `config`, `stats`).

---

## Benchmarking Suites

These programs are used to evaluate the performance of the Solana cluster itself for the specific workload profiles of the energy grid.

### 1. Blockbench
**ID:** `B5aDPT9bM692E63ZtBVLQuJhsoJsPdyjn6ATqqgWpbTg`

An adaptation of the *BLOCKBENCH* framework (SIGMOD 2017) for Solana. It tests isolated layers of the blockchain stack.

#### Workloads
- **DoNothing**: Tests pure consensus throughput (minimal execution cost).
- **CPUHeavy**: Tests execution engine (BPF) with compute-intensive tasks (hashing, sorting).
- **IOHeavy**: Tests the storage layer (Rent, Account resizing) with large data reads/writes.
- **Analytics**: Tests query/aggregation performance over on-chain data.
- **YCSB**: Implements Yahoo! Cloud Serving Benchmark key-value operations (Insert, Update, Read, Scan).

### 2. TPC-Benchmark (TPC-C)
**ID:** `BcXcPzZHpBJ82RwDSuVY2eVCXj3enda8R3AxUTjXwFgu`

A full implementation of the TPC-C (Online Transaction Processing) benchmark standard, mapped to Solana's account model.

#### Application Model
Simulates a wholesale supplier database:
- **Warehouse** -> **District** -> **Customer**
- **Items**, **Stock**, **Orders**

#### Transactions
- **New-Order** (45% fix): Write-heavy, high contention.
- **Payment** (43% fix): Read/Write, widely distributed.
- **Order-Status** (4% fix): Read-only.
- **Delivery** (4% fix): Batch processing.
- **Stock-Level** (4% fix): Analytical read.

This program serves as a stress test for complex, inter-dependent account mutations typical in enterprise applications.
