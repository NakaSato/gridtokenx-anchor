# TPC-C Benchmark Implementation for Solana Anchor

## Architectural Overview

This document describes the implementation of TPC-C (Transaction Processing Performance Council - C) benchmark for the Solana blockchain using the Anchor framework within a Proof of Authority (PoA) consensus environment.

## Table of Contents

1. [Introduction](#introduction)
2. [Architecture](#architecture)
3. [Schema Mapping](#schema-mapping)
4. [Transaction Implementation](#transaction-implementation)
5. [Proof of Authority Setup](#proof-of-authority-setup)
6. [Benchmarking Methodology](#benchmarking-methodology)
7. [Performance Analysis](#performance-analysis)
8. [Usage Guide](#usage-guide)

---

## Introduction

### What is TPC-C?

TPC-C is an OLTP (On-Line Transaction Processing) benchmark that simulates a complete computing environment where terminal operators execute transactions against a database. It measures the throughput of the system in **tpmC** (transactions per minute - C type, where C represents New-Order transactions).

### Why TPC-C for Blockchain?

Traditional blockchain benchmarks use simple token transfers, which fail to capture:
- Complex state management
- Multi-account updates
- Read-modify-write cycles
- Contention patterns
- Real-world business logic

TPC-C provides a rigorous, standardized methodology for evaluating blockchain performance under realistic workloads.

### Solana and Proof of Authority

While Solana natively uses Proof of History (PoH) + Proof of Stake (PoS), we configure a **Solana Permissioned Environment (SPE)** to emulate PoA:
- Fixed validator set defined at genesis
- 100% stake allocated to authorized validators
- Disabled inflation and rewards
- Restricted peer discovery

This enables enterprise-focused benchmarking where identity-based validator sets replace token-based sybil resistance.

---

## Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Load Generator                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                  │
│  │  Worker 1   │  │  Worker 2   │  │  Worker N   │                  │
│  │  (Terminal) │  │  (Terminal) │  │  (Terminal) │                  │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘                  │
│         │                │                │                          │
└─────────┼────────────────┼────────────────┼──────────────────────────┘
          │                │                │
          └────────────────┼────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Solana PoA Cluster                               │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    TPC-C Anchor Program                       │   │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────────────────┐  │   │
│  │  │ New-Order  │  │  Payment   │  │ Order-Status/Delivery/ │  │   │
│  │  │   (45%)    │  │   (43%)    │  │ Stock-Level (12%)      │  │   │
│  │  └────────────┘  └────────────┘  └────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    Account State                              │   │
│  │  Warehouse │ District │ Customer │ Item │ Stock │ Order     │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │ Validator 1  │  │ Validator 2  │  │ Validator 3  │              │
│  │   (Leader)   │  │   (Backup)   │  │   (Backup)   │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
└─────────────────────────────────────────────────────────────────────┘
```

### Program Structure

```
programs/tpc-benchmark/
├── Cargo.toml
└── src/
    ├── lib.rs                 # Program entry point
    ├── state.rs               # Account structures
    ├── error.rs               # Error definitions
    └── instructions/
        ├── mod.rs
        ├── initialize.rs      # Schema initialization
        ├── new_order.rs       # New-Order transaction (45%)
        ├── payment.rs         # Payment transaction (43%)
        ├── order_status.rs    # Order-Status transaction (4%)
        ├── delivery.rs        # Delivery transaction (4%)
        ├── stock_level.rs     # Stock-Level transaction (4%)
        └── benchmark.rs       # Benchmark control
```

---

## Schema Mapping

### TPC-C Relational Schema to Solana Accounts

| TPC-C Table | Solana Account | PDA Seeds | Contention Profile |
|-------------|----------------|-----------|-------------------|
| WAREHOUSE | `Warehouse` | `["warehouse", w_id]` | Moderate (YTD updates) |
| DISTRICT | `District` | `["district", w_id, d_id]` | **HIGH** (next_o_id) |
| CUSTOMER | `Customer` | `["customer", w_id, d_id, c_id]` | Low |
| ITEM | `Item` | `["item", i_id]` | Read-only |
| STOCK | `Stock` | `["stock", w_id, i_id]` | High (quantity updates) |
| ORDER | `Order` | `["order", w_id, d_id, o_id]` | Immutable after creation |
| NEW_ORDER | `NewOrder` | `["new_order", w_id, d_id, o_id]` | High (insert/delete) |
| HISTORY | `History` | `["history", w_id, d_id, h_id]` | Write-once |

### Critical Design Decision: Order Lines

Instead of separate `ORDER_LINE` accounts (which would require 5-15 accounts per order), we embed order lines as a vector within the `Order` account:

```rust
#[account]
pub struct Order {
    pub w_id: u64,
    pub d_id: u64,
    pub o_id: u64,
    pub c_id: u64,
    pub entry_d: i64,
    pub carrier_id: Option<u64>,
    pub ol_cnt: u8,
    pub all_local: bool,
    pub lines: Vec<OrderLine>,  // Embedded, max 15
    pub bump: u8,
}
```

**Rationale:**
- Reduces transaction size (fewer account keys)
- Fewer accounts to load per transaction
- Order and its lines are always accessed together
- TPC-C max of 15 lines fits within Solana's 10MB account limit

### Secondary Index for Customer Last Name Lookup

TPC-C requires 60% of Payment and Order-Status transactions to look up customers by last name. Solana doesn't support native secondary indexes, so we implement one:

```rust
#[account]
pub struct CustomerLastNameIndex {
    pub w_id: u64,
    pub d_id: u64,
    pub last_name_hash: [u8; 32],  // SHA-256 of last name
    pub customer_ids: Vec<u64>,    // Non-unique names supported
    pub bump: u8,
}
```

PDA: `["idx_c_last", w_id, d_id, hash(last_name)]`

---

## Transaction Implementation

### Transaction Mix (Per TPC-C Specification v5.11)

| Transaction | Frequency | Read Accounts | Write Accounts | Complexity |
|-------------|-----------|---------------|----------------|------------|
| New-Order | 45% | W, D, C, Items | D, Stock, Order, NewOrder | High |
| Payment | 43% | - | W, D, C, History | Medium |
| Order-Status | 4% | D, C, Order | None | Low |
| Delivery | 4% | D | Order, C, NewOrder | High |
| Stock-Level | 4% | D, Stock | None | Low |

### New-Order (Critical Transaction)

This is the most important transaction as it:
1. Defines the primary benchmark metric (tpmC)
2. Contains the **critical serialization point** (District.next_o_id)

```
New-Order Flow:
1. Read Warehouse tax rate
2. Read District tax rate
3. INCREMENT District.next_o_id  ← SERIALIZATION POINT
4. Read Customer discount
5. For each item (5-15):
   a. Read Item price
   b. Read & UPDATE Stock quantity
6. Create Order account (with embedded lines)
7. Create NewOrder account (undelivered queue)
```

**Concurrency Analysis:**
- All New-Order transactions for the same district are SERIALIZED
- They compete for the `next_o_id` increment
- Parallelism is achieved ACROSS districts (10 per warehouse)
- With W warehouses: max parallelism = 10 × W

### Using Remaining Accounts Pattern

Since order lines are variable (5-15), we use Anchor's `remaining_accounts`:

```rust
#[derive(Accounts)]
pub struct NewOrder<'info> {
    pub warehouse: Account<'info, Warehouse>,
    #[account(mut)]
    pub district: Account<'info, District>,
    pub customer: Account<'info, Customer>,
    #[account(init)]
    pub order: Account<'info, Order>,
    #[account(init)]
    pub new_order: Account<'info, NewOrderAccount>,
    // ...
    // Item and Stock accounts passed via remaining_accounts
}
```

Remaining accounts layout: `[Item_1, Stock_1, Item_2, Stock_2, ...]`

---

## Proof of Authority Setup

### Creating a PoA Cluster

Run the setup script:

```bash
./scripts/setup-poa-cluster.sh
```

This creates:
- Genesis configuration with fixed validator set
- Keypairs for N validators (default: 3)
- Equal stake distribution (100% to authorities)
- Disabled inflation
- Management scripts

### Configuration Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `NUM_VALIDATORS` | 3 | Number of authority nodes |
| `BASE_PORT` | 8899 | Starting RPC port |
| `LEDGER_LIMIT` | 50GB | Max ledger size |
| `FAUCET_SOL` | 1M | Initial faucet balance |

### Starting the Cluster

```bash
# Start all validators
./poa-cluster/start-cluster.sh

# Check status
./poa-cluster/cluster-status.sh

# Stop cluster
./poa-cluster/stop-cluster.sh
```

---

## Benchmarking Methodology

### TPC-C Compliance

Our implementation follows TPC-C Specification v5.11:

1. **Non-Uniform Random (NURand)** distribution for customer/item selection
2. **Warmup period** (10% discarded) before measurements
3. **Outlier removal** (>3σ from mean)
4. **95% confidence intervals** for tpmC
5. **Transaction mix** enforcement (45/43/4/4/4)

### Running Benchmarks

**TypeScript Benchmark:**
```bash
# Simulation mode
npx ts-node tests/performance/benchmarks/tpc-c-benchmark.ts 1 60 10

# Real program mode
npx ts-node tests/performance/benchmarks/tpc-c-benchmark.ts 1 60 10 --real

# Arguments: warehouses duration_seconds concurrency
```

### Metrics Collected

| Metric | Description | TPC-C Compliance |
|--------|-------------|------------------|
| tpmC | New-Order/minute | Primary metric |
| Latency percentiles | p50, p90, p99, p99.9 | Section 5.6 |
| MVCC Conflict Rate | Lock contention proxy | Blockchain-specific |
| Trust Premium | vs. centralized baseline | Research metric |

---

## Performance Analysis

### Concurrency Bottlenecks

1. **District.next_o_id**: All New-Orders in a district serialize here
2. **Stock accounts**: Popular items cause contention
3. **Warehouse/District YTD**: Payment transactions serialize

### Theoretical Maximum Throughput

With W warehouses and 10 districts each:
- Max parallel New-Orders = 10 × W
- If single-threaded latency = 50ms per New-Order
- Theoretical max tpmC ≈ 10 × W × (60000/50) = 12,000 × W

### Trust Premium Analysis

Blockchain introduces overhead vs. centralized databases:

| Component | Estimated Overhead |
|-----------|-------------------|
| Ed25519 Signing | ~15% |
| Consensus Latency | ~40% |
| State Hashing | ~20% |
| Redundant Execution | ~25% |

**Trust Premium = Blockchain Latency / Centralized Baseline**

Typical values: 200x-400x latency increase, but with decentralization guarantees.

---

## Usage Guide

### Prerequisites

- Solana CLI (1.18+)
- Anchor CLI (0.32+)
- Node.js 18+
- Rust 1.75+

### Build the Program

```bash
# Add to Anchor.toml
[programs.localnet]
tpc_benchmark = "TpcC1111111111111111111111111111111111111111"

# Build
anchor build
```

### Deploy to Local Validator

```bash
# Start local validator
solana-test-validator

# Deploy
anchor deploy
```

### Initialize Schema

```bash
# Initialize warehouses, districts, customers, items, stock
npx ts-node scripts/init-tpcc-schema.ts
```

### Run Benchmark

```bash
# Run for 60 seconds with 1 warehouse and 10 concurrent clients
npx ts-node tests/performance/benchmarks/tpc-c-benchmark.ts 1 60 10
```

### Expected Output

```
╔════════════════════════════════════════════════════════════════╗
║       TPC-C Benchmark for Solana Anchor (PoA Environment)      ║
╚════════════════════════════════════════════════════════════════╝

Configuration:
  Warehouses:    1
  Duration:      60s
  Concurrency:   10
  Warmup:        10%
  Mode:          Simulation

🚀 Starting TPC-C workload...

═══════════════════════════════════════════════════════════════
                    TPC-C BENCHMARK RESULTS
═══════════════════════════════════════════════════════════════

📊 PRIMARY METRIC (tpmC)
───────────────────────────────────────────────────────────────
   New-Order/min:     2,847
   95% CI:            [2,712, 2,982]
   Overall TPS:       102.5

📈 TRANSACTION SUMMARY
───────────────────────────────────────────────────────────────
   Total:             5,893
   Successful:        5,721
   Failed:            172
   Warmup Discarded:  655

⏱️  LATENCY (microseconds)
───────────────────────────────────────────────────────────────
   Mean:              89,234 μs
   p50:               82,456 μs
   p99:               198,234 μs

🔗 BLOCKCHAIN METRICS
───────────────────────────────────────────────────────────────
   MVCC Conflict Rate: 1.85%
   Avg Retries:        0.02

💰 TRUST PREMIUM (vs Centralized DB)
───────────────────────────────────────────────────────────────
   Baseline Latency:   2 ms (PostgreSQL)
   Latency Multiplier: 44.6x
   Throughput Penalty: 97.95%
```

---

## References

1. TPC Benchmark C Standard Specification, Revision 5.11 (2010)
2. Yakovenko, A. "Solana: A new architecture for a high performance blockchain" (2018)
3. Dinh, T.T.A. et al. "Blockbench: A framework for analyzing private blockchains" (2017)
4. Nasir, Q. et al. "Performance Analysis of Hyperledger Fabric Platforms" (2018)
5. Anchor Framework Documentation: https://www.anchor-lang.com/

---

## License

MIT License - See LICENSE file for details.
