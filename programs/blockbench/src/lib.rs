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

declare_id!("9HqyYuqADh6K88gnvFav1J2mKQMgDyQjiJEa5u54Ad9v");

#[cfg(feature = "localnet")]
use compute_debug::{compute_fn, compute_checkpoint};

#[cfg(not(feature = "localnet"))]
macro_rules! compute_fn {
    ($name:expr => $block:block) => { $block };
}
#[cfg(not(feature = "localnet"))]
macro_rules! compute_checkpoint {
    ($name:expr) => {};
}

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

    pub fn initialize_benchmark(
        ctx: Context<InitializeBenchmark>,
        config: BlockbenchConfig,
    ) -> Result<()> {
        compute_fn!("initialize_benchmark" => {
            instructions::initialize_benchmark(ctx, config)
        })
    }

    pub fn do_nothing(ctx: Context<DoNothing>) -> Result<()> {
        compute_fn!("do_nothing" => {
            instructions::do_nothing(ctx)
        })
    }

    pub fn do_nothing_nonce(ctx: Context<DoNothingNonce>, nonce: u32) -> Result<()> {
        compute_fn!("do_nothing_nonce" => {
            instructions::do_nothing_nonce(ctx, nonce)
        })
    }

    pub fn cpu_heavy_sort(ctx: Context<CpuHeavy>, array_size: u16, seed: u64) -> Result<u64> {
        let res = compute_fn!("cpu_heavy_sort" => {
            instructions::cpu_heavy_sort(ctx, array_size, seed)
        })?;
        Ok(res)
    }

    pub fn cpu_heavy_loop(ctx: Context<CpuHeavy>, iterations: u32) -> Result<u64> {
        let res = compute_fn!("cpu_heavy_loop" => {
            instructions::cpu_heavy_loop(ctx, iterations)
        })?;
        Ok(res)
    }

    pub fn cpu_heavy_hash(ctx: Context<CpuHeavy>, iterations: u16, data_size: u16) -> Result<[u8; 32]> {
        let res = compute_fn!("cpu_heavy_hash" => {
            instructions::cpu_heavy_hash(ctx, iterations, data_size)
        })?;
        Ok(res)
    }

    pub fn cpu_heavy_matrix(ctx: Context<CpuHeavy>, matrix_size: u8) -> Result<u64> {
        let res = compute_fn!("cpu_heavy_matrix" => {
            instructions::cpu_heavy_matrix(ctx, matrix_size)
        })?;
        Ok(res)
    }

    pub fn io_heavy_write(
        ctx: Context<IoHeavyWrite>,
        key_prefix: [u8; 16],
        value_size: u16,
        num_writes: u8,
    ) -> Result<()> {
        compute_fn!("io_heavy_write" => {
            instructions::io_heavy_write(ctx, key_prefix, value_size, num_writes)
        })
    }

    pub fn io_heavy_read<'info>(
        ctx: Context<'_, '_, 'info, 'info, IoHeavyRead<'info>>,
        num_reads: u8,
    ) -> Result<u64> {
        let res = compute_fn!("io_heavy_read" => {
            instructions::io_heavy_read(ctx, num_reads)
        })?;
        Ok(res)
    }

    pub fn io_heavy_mixed<'info>(
        ctx: Context<'_, '_, 'info, 'info, IoHeavyMixed<'info>>,
        read_ratio: u8,
        total_ops: u8,
    ) -> Result<()> {
        compute_fn!("io_heavy_mixed" => {
            instructions::io_heavy_mixed(ctx, read_ratio, total_ops)
        })
    }

    pub fn analytics_aggregate<'info>(
        ctx: Context<'_, '_, 'info, 'info, AnalyticsAggregate<'info>>,
        aggregation_type: AggregationType,
    ) -> Result<AnalyticsResult> {
        let res = compute_fn!("analytics_aggregate" => {
            instructions::analytics_aggregate(ctx, aggregation_type)
        })?;
        Ok(res)
    }

    pub fn analytics_scan<'info>(
        ctx: Context<'_, '_, 'info, 'info, AnalyticsScan<'info>>,
        filter_threshold: u64,
    ) -> Result<u32> {
        let res = compute_fn!("analytics_scan" => {
            instructions::analytics_scan(ctx, filter_threshold)
        })?;
        Ok(res)
    }

    pub fn ycsb_init_store(ctx: Context<YcsbInitStore>) -> Result<()> {
        compute_fn!("ycsb_init_store" => {
            instructions::ycsb_init_store(ctx)
        })
    }

    pub fn ycsb_insert(
        ctx: Context<YcsbInsert>,
        key: [u8; 32],
        value: Vec<u8>,
    ) -> Result<()> {
        compute_fn!("ycsb_insert" => {
            instructions::ycsb_insert(ctx, key, value)
        })
    }

    pub fn ycsb_read(ctx: Context<YcsbRead>, key: [u8; 32]) -> Result<Vec<u8>> {
        let res = compute_fn!("ycsb_read" => {
            instructions::ycsb_read(ctx, key)
        })?;
        Ok(res)
    }

    pub fn ycsb_update(
        ctx: Context<YcsbUpdate>,
        key: [u8; 32],
        value: Vec<u8>,
    ) -> Result<()> {
        compute_fn!("ycsb_update" => {
            instructions::ycsb_update(ctx, key, value)
        })
    }

    pub fn ycsb_delete(ctx: Context<YcsbDelete>, key: [u8; 32]) -> Result<()> {
        compute_fn!("ycsb_delete" => {
            instructions::ycsb_delete(ctx, key)
        })
    }

    pub fn ycsb_batch_insert(
        ctx: Context<YcsbBatchInsert>,
        records: Vec<YcsbRecord>,
    ) -> Result<()> {
        compute_fn!("ycsb_batch_insert" => {
            instructions::ycsb_batch_insert(ctx, records)
        })
    }

    pub fn record_metric(
        ctx: Context<RecordMetric>,
        benchmark_type: BenchmarkType,
        latency_us: u64,
        compute_units: u64,
        success: bool,
    ) -> Result<()> {
        compute_fn!("record_metric" => {
            instructions::record_metric(ctx, benchmark_type, latency_us, compute_units, success)
        })
    }

    pub fn reset_metrics(ctx: Context<ResetMetrics>) -> Result<()> {
        compute_fn!("reset_metrics" => {
            instructions::reset_metrics(ctx)
        })
    }

    pub fn finalize_benchmark(ctx: Context<FinalizeBenchmark>) -> Result<BenchmarkSummary> {
        let res = compute_fn!("finalize_benchmark" => {
            instructions::finalize_benchmark(ctx)
        })?;
        Ok(res)
    }
}
