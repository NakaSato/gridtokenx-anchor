//! # BLOCKBENCH Micro-benchmarks for Solana/Anchor
//!
//! This program implements the BLOCKBENCH micro-benchmark suite adapted for Solana:
//!
//! ## Micro-benchmarks (Layer Isolation Tests)
//!
//! | Benchmark   | Target Layer   | Description                                      |
//! |-------------|----------------|--------------------------------------------------|
//! | DoNothing   | Consensus      | Empty transaction, measures pure consensus cost  |
//! | CPUHeavy    | Execution      | Compute-intensive operations (sorting, hashing)  |
//! | IOHeavy     | Data Model     | Storage-intensive reads/writes                   |
//! | Analytics   | Query          | Aggregation and scan operations                  |
//!
//! ## YCSB Key-Value Store
//!
//! Standard Yahoo! Cloud Serving Benchmark adapted for blockchain:
//! - Insert: Create new key-value pairs
//! - Update: Modify existing values
//! - Read: Retrieve values by key
//! - Scan: Range queries (limited by Solana model)
//!
//! ## Reference
//! 
//! Based on "BLOCKBENCH: A Framework for Analyzing Private Blockchains" (SIGMOD 2017)
//! Adapted for Solana's account model and BPF/SBF execution environment.

use anchor_lang::prelude::*;

pub mod error;
pub mod instructions;
pub mod state;

pub use error::*;
#[allow(ambiguous_glob_reexports)]
pub use instructions::*;
pub use state::*;

declare_id!("BfJ7ahTPRahUBTFXQdw1tS59DWcW5gADRJxzdhr7kQhJ");

/// BLOCKBENCH workload type constants
pub mod blockbench_constants {
    /// YCSB Workload A: 50% read, 50% update (update heavy)
    pub const YCSB_WORKLOAD_A_READ: u8 = 50;
    pub const YCSB_WORKLOAD_A_UPDATE: u8 = 50;
    
    /// YCSB Workload B: 95% read, 5% update (read heavy)
    pub const YCSB_WORKLOAD_B_READ: u8 = 95;
    pub const YCSB_WORKLOAD_B_UPDATE: u8 = 5;
    
    /// YCSB Workload C: 100% read (read only)
    pub const YCSB_WORKLOAD_C_READ: u8 = 100;
    
    /// YCSB Workload F: 50% read, 50% read-modify-write
    pub const YCSB_WORKLOAD_F_READ: u8 = 50;
    pub const YCSB_WORKLOAD_F_RMW: u8 = 50;
    
    /// Default record count for YCSB
    pub const DEFAULT_RECORD_COUNT: u32 = 10000;
    
    /// Default field size in bytes
    pub const DEFAULT_FIELD_SIZE: u16 = 100;
    
    /// CPUHeavy sort array size
    pub const CPU_HEAVY_SORT_SIZE: u16 = 256;
    
    /// IOHeavy operations per transaction
    pub const IO_HEAVY_OPS_PER_TX: u8 = 10;
}

#[program]
pub mod blockbench {
    use super::*;

    // ═══════════════════════════════════════════════════════════════════════════
    // BENCHMARK INITIALIZATION
    // ═══════════════════════════════════════════════════════════════════════════

    /// Initialize the BLOCKBENCH suite configuration
    pub fn initialize_benchmark(
        ctx: Context<InitializeBenchmark>,
        config: BlockbenchConfig,
    ) -> Result<()> {
        instructions::initialize_benchmark(ctx, config)
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MICRO-BENCHMARK: DoNothing (Consensus Layer Stress Test)
    // ═══════════════════════════════════════════════════════════════════════════

    /// DoNothing benchmark - measures pure consensus overhead
    /// 
    /// This instruction performs no state changes and minimal computation.
    /// It isolates the cost of:
    /// - Transaction signature verification
    /// - Account loading
    /// - Consensus and block inclusion
    /// 
    /// Use this to establish the baseline latency floor of the network.
    pub fn do_nothing(ctx: Context<DoNothing>) -> Result<()> {
        instructions::do_nothing(ctx)
    }

    /// DoNothing with nonce - prevents transaction deduplication
    pub fn do_nothing_nonce(ctx: Context<DoNothingNonce>, nonce: u64) -> Result<()> {
        instructions::do_nothing_nonce(ctx, nonce)
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MICRO-BENCHMARK: CPUHeavy (Execution Layer Stress Test)
    // ═══════════════════════════════════════════════════════════════════════════

    /// CPUHeavy: Quicksort benchmark
    /// 
    /// Performs in-memory quicksort on an array of the specified size.
    /// Tests the computational efficiency of the BPF/SBF VM.
    /// 
    /// ## Compute Unit Analysis
    /// - Small (64 elements): ~5,000 CU
    /// - Medium (256 elements): ~25,000 CU  
    /// - Large (1024 elements): ~150,000 CU
    pub fn cpu_heavy_sort(ctx: Context<CpuHeavy>, array_size: u16, seed: u64) -> Result<u64> {
        instructions::cpu_heavy_sort(ctx, array_size, seed)
    }

    /// CPUHeavy: Loop benchmark
    /// 
    /// Executes a tight loop with mathematical operations.
    /// Useful for measuring raw instruction throughput.
    pub fn cpu_heavy_loop(ctx: Context<CpuHeavy>, iterations: u32) -> Result<u64> {
        instructions::cpu_heavy_loop(ctx, iterations)
    }

    /// CPUHeavy: Hash computation benchmark
    /// 
    /// Performs repeated SHA-256 hashing operations.
    /// Tests cryptographic primitive performance in BPF.
    pub fn cpu_heavy_hash(ctx: Context<CpuHeavy>, iterations: u16, data_size: u16) -> Result<[u8; 32]> {
        instructions::cpu_heavy_hash(ctx, iterations, data_size)
    }

    /// CPUHeavy: Matrix multiplication benchmark
    /// 
    /// Multiplies two NxN matrices.
    /// Measures O(n³) computational scaling.
    pub fn cpu_heavy_matrix(ctx: Context<CpuHeavy>, matrix_size: u8) -> Result<u64> {
        instructions::cpu_heavy_matrix(ctx, matrix_size)
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MICRO-BENCHMARK: IOHeavy (Data Model Layer Stress Test)
    // ═══════════════════════════════════════════════════════════════════════════

    /// IOHeavy: Sequential writes benchmark
    /// 
    /// Performs multiple sequential writes to the state storage.
    /// Measures write amplification and storage throughput.
    pub fn io_heavy_write(
        ctx: Context<IoHeavyWrite>,
        key_prefix: [u8; 16],
        value_size: u16,
        num_writes: u8,
    ) -> Result<()> {
        instructions::io_heavy_write(ctx, key_prefix, value_size, num_writes)
    }

    /// IOHeavy: Random reads benchmark
    /// 
    /// Reads multiple accounts in random order.
    /// Tests account loading efficiency and caching.
    pub fn io_heavy_read<'info>(
        ctx: Context<'_, '_, 'info, 'info, IoHeavyRead<'info>>,
        num_reads: u8,
    ) -> Result<u64> {
        instructions::io_heavy_read(ctx, num_reads)
    }

    /// IOHeavy: Mixed read-write benchmark
    /// 
    /// Performs interleaved read and write operations.
    /// Simulates realistic workload patterns.
    pub fn io_heavy_mixed<'info>(
        ctx: Context<'_, '_, 'info, 'info, IoHeavyMixed<'info>>,
        read_ratio: u8,
        total_ops: u8,
    ) -> Result<()> {
        instructions::io_heavy_mixed(ctx, read_ratio, total_ops)
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MICRO-BENCHMARK: Analytics (Query Layer Stress Test)
    // ═══════════════════════════════════════════════════════════════════════════

    /// Analytics: Aggregation query
    /// 
    /// Computes aggregate statistics across multiple accounts.
    /// Tests OLAP-style query performance.
    pub fn analytics_aggregate<'info>(
        ctx: Context<'_, '_, 'info, 'info, AnalyticsAggregate<'info>>,
        aggregation_type: AggregationType,
    ) -> Result<AnalyticsResult> {
        instructions::analytics_aggregate(ctx, aggregation_type)
    }

    /// Analytics: Scan and filter
    /// 
    /// Scans accounts and filters by predicate.
    /// Measures scan throughput with selective filtering.
    pub fn analytics_scan<'info>(
        ctx: Context<'_, '_, 'info, 'info, AnalyticsScan<'info>>,
        filter_threshold: u64,
    ) -> Result<u32> {
        instructions::analytics_scan(ctx, filter_threshold)
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // YCSB KEY-VALUE STORE OPERATIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /// YCSB: Initialize key-value store
    pub fn ycsb_init_store(ctx: Context<YcsbInitStore>) -> Result<()> {
        instructions::ycsb_init_store(ctx)
    }

    /// YCSB: Insert operation
    /// 
    /// Creates a new key-value record.
    /// Used for initial data loading phase.
    pub fn ycsb_insert(
        ctx: Context<YcsbInsert>,
        key: [u8; 32],
        value: Vec<u8>,
    ) -> Result<()> {
        instructions::ycsb_insert(ctx, key, value)
    }

    /// YCSB: Read operation
    /// 
    /// Retrieves a value by key.
    /// Tests point query performance.
    pub fn ycsb_read(ctx: Context<YcsbRead>, key: [u8; 32]) -> Result<Vec<u8>> {
        instructions::ycsb_read(ctx, key)
    }

    /// YCSB: Update operation
    /// 
    /// Modifies an existing value.
    /// Tests read-modify-write performance.
    pub fn ycsb_update(
        ctx: Context<YcsbUpdate>,
        key: [u8; 32],
        value: Vec<u8>,
    ) -> Result<()> {
        instructions::ycsb_update(ctx, key, value)
    }

    /// YCSB: Delete operation
    /// 
    /// Removes a key-value record.
    /// Tests account close operation.
    pub fn ycsb_delete(ctx: Context<YcsbDelete>, key: [u8; 32]) -> Result<()> {
        instructions::ycsb_delete(ctx, key)
    }

    /// YCSB: Batch insert for efficient loading
    pub fn ycsb_batch_insert(
        ctx: Context<YcsbBatchInsert>,
        records: Vec<YcsbRecord>,
    ) -> Result<()> {
        instructions::ycsb_batch_insert(ctx, records)
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // BENCHMARK METRICS AND REPORTING
    // ═══════════════════════════════════════════════════════════════════════════

    /// Record a benchmark metric on-chain
    pub fn record_metric(
        ctx: Context<RecordMetric>,
        benchmark_type: BenchmarkType,
        latency_us: u64,
        compute_units: u64,
        success: bool,
    ) -> Result<()> {
        instructions::record_metric(ctx, benchmark_type, latency_us, compute_units, success)
    }

    /// Reset benchmark statistics
    pub fn reset_metrics(ctx: Context<ResetMetrics>) -> Result<()> {
        instructions::reset_metrics(ctx)
    }

    /// Finalize benchmark run and compute summary statistics
    pub fn finalize_benchmark(ctx: Context<FinalizeBenchmark>) -> Result<BenchmarkSummary> {
        instructions::finalize_benchmark(ctx)
    }
}
