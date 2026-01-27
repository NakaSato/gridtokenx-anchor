# BLOCKBENCH for Solana: Technical Reference

**Program ID:** `B5aDPT9bM692E63ZtBVLQuJhsoJsPdyjn6ATqqgWpbTg`

This document details the implementation of the **BLOCKBENCH** framework for the Solana blockchain. Originally defined in "BLOCKBENCH: A Framework for Analyzing Private Blockchains" (SIGMOD 2017), this suite adapts the standard micro-benchmarks and YCSB workloads to measure the specific performance characteristics of Solana's Sealevel runtime (SVM) and Proof-of-History (PoH) consensus.

## 1. System Architecture

The benchmark suite is designed as a monolithic Anchor program that segments tests into isolated instruction modules. This allows for precise targeting of specific layers in the blockchain stack.

### Layer Mapping

| BLOCKBENCH Layer | Solana Component | Test Module | Implementation Detail |
|------------------|------------------|-------------|-----------------------|
| **Consensus** | PoH + Vote Processing | `DoNothing` | Minimal instruction footprint to isolate transaction propagation and voting latencies. |
| **Execution** | SBF (Solana BPF) | `CPUHeavy` | Cryptographic hashing (SHA-256 variant) and Sorting algorithms (Quicksort) effectively saturating the Compute Unit (CU) limit. |
| **Data Model** | AccountsDB | `IOHeavy` | Large account resizing, sequential writes, and multi-account random reads (`remaining_accounts`). |
| **Application** | Runtime / Client | `Analytics` | On-chain aggregation scans across large sets of accounts in a single transaction. |

---

## 2. Micro-Benchmarks

These tests are designed to find the "knee of the curve" for individual resource dimensions.

### 2.1 DoNothing (Consensus Layer)
**Goal:** Establish the theoretical maximum throughput (TPS) and minimum latency of the network when execution cost is negligible.

- **Instruction:** `do_nothing` / `do_nothing_nonce`
- **Logic:** Returns `Ok(())` immediately. The `nonce` variant processes a `u32` argument to prevent transaction deduplication by RPC nodes or the validator implementation when submitting bursts.
- **Metric:** Peak TPS, Average Confirmation Latency.

### 2.2 CPUHeavy (Execution Layer)
**Goal:** Measure the efficiency of the SBF JIT compiler and VM execution speed.

- **Instruction:** `cpu_heavy_sort`
- **Algorithm:** In-place **Quicksort** on a pseudo-randomly generated `Vec<u32>`.
- **Generator:** Interpretation of Linear Congruential Generator (LCG) to populate the array deterministically on-chain without external data input.
- **Constraints:**
    - Max Array Size: ~1024 elements (tuned to fit within standard 200k CU limit, or extended 1.4M limit).
    - Returns a checksum to verify correct execution logic.

### 2.3 IOHeavy (Data Model Layer)
**Goal:** Stress-test the AccountsDB performance, specifically concurrent reads and write-lock management.

- **Instruction 1: Write** (`io_heavy_write`)
    - **Pattern:** Sequential updates to a specific `IoHeavyAccount`.
    - **Logic:** Performs `n` overwrite operations on a byte vector within the account data. Simulates "hot account" contention when multiple transactions target the same PDA.
- **Instruction 2: Read** (`io_heavy_read`)
    - **Pattern:** Random reads across *multiple* accounts.
    - **Mechanism:** Uses Anchor's `ctx.remaining_accounts` feature to load up to 64 accounts in a single transaction.
    - **Logic:** Deserializes and computes a checksum of data across all passed accounts. Measures the overhead of loading account data from disk/RAM into VM memory.

### 2.4 Analytics (Query Layer)
**Goal:** Evaluate the blockchain's ability to act as an OLAP (Online Analytical Processing) engine, which is traditionally a weakness of distributed ledgers.

- **Instruction:** `analytics_aggregate` / `analytics_scan`
- **Workload:** Scans a large set of `record` accounts passed via `remaining_accounts`.
- **Operations:**
    - `SUM`, `COUNT`, `AVG`, `MIN`, `MAX` on a specific 64-bit integer field within the account state.
    - Filtering Logic: Counts records where `val > threshold`.
- **Observation:** This test highlights the cost of deserialization (Borsh) relative to the actual computation.

---

## 3. YCSB Implementation

The **Yahoo! Cloud Serving Benchmark (YCSB)** is the industry standard for evaluating NoSQL databases. We treat Solana's Account model as a Key-Value store where:
- **Key** = Program Derived Address (PDA) derived from `[b"record", key_bytes]`.
- **Value** = Serialized data stored in the Account.

### Data Schema
- **Record Account:**
    ```rust
    pub struct YcsbRecord {
        pub key: [u8; 32],      // Primary Key
        pub value: Vec<u8>,     // Blob data
        pub version: u64,       // MVCC-style versioning
        pub created_at: i64,
        pub updated_at: i64,
    }
    ```

### Operations
1.  **Insert**: Creates a new PDA. Costs 1 invocation of `system_program::create_account`.
2.  **Read**: Fetches account data. Verifies Key match.
3.  **Update**: Modifies the `value` vector and increments `version`.
4.  **Scan**: Not natively supported by Solana's hashing model. Simulated by passing a pre-determined range of accounts (requires client-side key awareness).

### Workload Definitions
The program includes constants to configure standard YCSB mixes:
- **Workload A (Update Heavy):** 50% Read, 50% Update
- **Workload B (Read Heavy):** 95% Read, 5% Update
- **Workload C (Read Only):** 100% Read
- **Workload F (Read-Modify-Write):** 50% Read, 50% RMW (atomic increment)

---

## 4. Methodology for Use in Papers

When citing this implementation for academic research:

1.  **Environment Isolation:** Ensure the `blockbench` program is deployed to a dedicated testnet or local validator (test-ledger) to avoid noise from public mainnet traffic.
2.  **Compute Budget:** SBF instructions have a hard limit (default 200,000 Compute Units). CPUHeavy benchmarks effectively measure "Operations per CU" effectively.
3.  **Parallelism:**
    - Solana executes non-overlapping transactions in parallel.
    - To test this, generate workload batches with **disjoint account sets**.
    - If `IOHeavy` targets the same account, the runtime forces serial execution (locking), drastically reducing TPS. This behavior is correct and intended for analyzing conflict resolution.

## 5. Error Codes

| Code | Name | Description |
|------|------|-------------|
| `6000` | `ArrayTooLarge` | CPU sort requested size exceeds CU safety limits. |
| `6001` | `TooManyIoOperations` | Loop count for IO test too high. |
| `6002` | `InsufficientAccounts` | Analytics/Read test provided fewer accounts than requested. |
| `6003` | `YcsbRecordNotFound` | Key mismatch in PDA lookup. |
| `6004` | `ValueTooLarge` | YCSB blob exceeds account data allocation. |

## 6. References
> Dinh, T. T. A., Wang, J., Chen, G., Liu, R., Ooi, B. C., & Tan, K. L. (2017). **BLOCKBENCH: A Framework for Analyzing Private Blockchains**. In Proceedings of the 2017 ACM International Conference on Management of Data (SIGMOD '17).
