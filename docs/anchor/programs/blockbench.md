# BLOCKBENCH Program

**Program ID:** `BfsR4GtThj5bvF9NS8Ltx5GzDKjvVrGmU7tGwLX8z3PW`

This program ports the [BLOCKBENCH](https://github.com/ooibc88/blockbench) micro-benchmark suite to the Solana/Anchor environment. It is used to evaluate the performance of the underlying blockchain layer (Solana + Layer N / Custom Runtime).

## Micro-Benchmarks
These isolate specific layers of the blockchain stack.

### `DoNothing` (Consensus Layer)
- **Logic**: Performs minimal computation and no state changes.
- **Goal**: Measure pure consensus overhead ($T_{consensus}$), transaction signature verification cost, and baseline latency.

### `CPUHeavy` (Execution Layer)
- **Logic**: Sorts an array of size $N=256$ using Quicksort/Bubblesort or computes Keccak hashes.
- **Goal**: Measure Execution Time ($T_{exec}$).
- **Formula**: $T_{exec} \approx O(N \log N)$ or linear hash time.

### `IOHeavy` (Data Model Layer)
- **Logic**: Performs $K=10$ random reads and writes to account data.
- **Goal**: Stress test RocksDB/AccountsDB.
- **Complexity**: $O(K)$ random accesses.

### `Analytics` (Query Layer)
- **Logic**: Scans and aggregates data from multiple accounts.
- **Goal**: Measure OLAP-style query performance on-chain.

## YCSB Workloads
Implements the Yahoo! Cloud Serving Benchmark (YCSB) key-value store operations.

| Workload | Read % | Update % | RMW % | Description |
|----------|--------|----------|-------|-------------|
| **A**    | 50 | 50 | 0 | **Update Heavy**: Session store recording recent actions. |
| **B**    | 95 | 5 | 0 | **Read Heavy**: Photo tagging, adding tags is rare. |
| **C**    | 100 | 0 | 0 | **Read Only**: User profile cache, no changes. |
| **F**    | 50 | 0 | 50 | **Read-Modify-Write**: User database, read record, modify, write back. |

**Constants**:
- Default Record Count: 10,000
- Default Field Size: 100 bytes
- CPU Sort Size: 256 elements
