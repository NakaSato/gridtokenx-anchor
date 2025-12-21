//! BLOCKBENCH State Structures
//!
//! Defines account structures for benchmarking state management.

use anchor_lang::prelude::*;

// ═══════════════════════════════════════════════════════════════════════════════
// BENCHMARK CONFIGURATION AND METRICS
// ═══════════════════════════════════════════════════════════════════════════════

/// Global benchmark configuration
#[account]
#[derive(Default)]
pub struct BlockbenchState {
    /// Authority who can manage the benchmark
    pub authority: Pubkey,
    
    /// Configuration for current benchmark run
    pub config: BlockbenchConfig,
    
    /// Aggregated metrics
    pub metrics: BlockbenchMetrics,
    
    /// Benchmark run state
    pub is_running: bool,
    pub start_time: i64,
    pub end_time: i64,
    pub run_id: u64,
    
    /// PDA bump
    pub bump: u8,
}

impl BlockbenchState {
    pub const LEN: usize = 8 + // discriminator
        32 + // authority
        BlockbenchConfig::LEN +
        BlockbenchMetrics::LEN +
        1 + 8 + 8 + 8 + // is_running, start_time, end_time, run_id
        1; // bump
}

/// Benchmark configuration parameters
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct BlockbenchConfig {
    /// Target workload type
    pub workload_type: WorkloadType,
    
    /// Number of operations to perform
    pub operation_count: u64,
    
    /// Concurrency level (simulated)
    pub concurrency: u16,
    
    /// Duration in seconds (0 = unlimited)
    pub duration_seconds: u64,
    
    /// YCSB-specific: Record count
    pub record_count: u32,
    
    /// YCSB-specific: Field count per record
    pub field_count: u8,
    
    /// YCSB-specific: Field size in bytes
    pub field_size: u16,
    
    /// Distribution type for key selection
    pub distribution: DistributionType,
    
    /// Zipfian constant (if using Zipfian distribution)
    pub zipfian_constant: u16, // Stored as basis points (99 = 0.99)
}

impl BlockbenchConfig {
    pub const LEN: usize = 1 + 8 + 2 + 8 + 4 + 1 + 2 + 1 + 2;
}

/// Aggregated benchmark metrics
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct BlockbenchMetrics {
    // Transaction counts
    pub total_operations: u64,
    pub successful_operations: u64,
    pub failed_operations: u64,
    
    // Latency statistics (microseconds)
    pub total_latency_us: u64,
    pub min_latency_us: u64,
    pub max_latency_us: u64,
    pub latency_sum_squares: u64, // For std dev calculation
    
    // Compute unit statistics
    pub total_compute_units: u64,
    pub min_compute_units: u64,
    pub max_compute_units: u64,
    
    // Per-operation type counts (for YCSB)
    pub read_count: u64,
    pub insert_count: u64,
    pub update_count: u64,
    pub delete_count: u64,
    pub scan_count: u64,
    
    // Error breakdown
    pub timeout_errors: u64,
    pub conflict_errors: u64,
    pub other_errors: u64,
}

impl BlockbenchMetrics {
    pub const LEN: usize = 8 * 18; // 18 u64 fields
}

/// Benchmark summary returned after finalization
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct BenchmarkSummary {
    /// Transactions per second
    pub tps: u64,
    
    /// Average latency in microseconds
    pub avg_latency_us: u64,
    
    /// Latency percentiles (p50, p90, p95, p99)
    pub p50_latency_us: u64,
    pub p90_latency_us: u64,
    pub p95_latency_us: u64,
    pub p99_latency_us: u64,
    
    /// Success rate (basis points, 10000 = 100%)
    pub success_rate_bps: u16,
    
    /// Average compute units per transaction
    pub avg_compute_units: u64,
    
    /// Total duration in seconds
    pub duration_seconds: u64,
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENUMS
// ═══════════════════════════════════════════════════════════════════════════════

/// Workload types supported by BLOCKBENCH
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Default, Debug)]
pub enum WorkloadType {
    #[default]
    DoNothing,      // Consensus layer test
    CpuHeavySort,   // Execution layer - sorting
    CpuHeavyLoop,   // Execution layer - tight loop
    CpuHeavyHash,   // Execution layer - cryptographic
    CpuHeavyMatrix, // Execution layer - matrix ops
    IoHeavyWrite,   // Data layer - writes
    IoHeavyRead,    // Data layer - reads
    IoHeavyMixed,   // Data layer - mixed
    Analytics,      // Query layer
    YcsbA,          // YCSB Workload A (50/50 read/update)
    YcsbB,          // YCSB Workload B (95/5 read/update)
    YcsbC,          // YCSB Workload C (100% read)
    YcsbF,          // YCSB Workload F (read-modify-write)
    Smallbank,      // Smallbank OLTP
}

/// Key distribution types for workload generation
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Default, Debug)]
pub enum DistributionType {
    #[default]
    Uniform,
    Zipfian,
    Latest,
    Hotspot,
}

/// Benchmark type for metric recording
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum BenchmarkType {
    DoNothing,
    CpuHeavy,
    IoHeavy,
    Analytics,
    YcsbRead,
    YcsbInsert,
    YcsbUpdate,
    YcsbDelete,
    YcsbScan,
    Smallbank,
}

/// Aggregation type for analytics benchmark
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum AggregationType {
    Sum,
    Count,
    Average,
    Min,
    Max,
}

/// Analytics query result
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct AnalyticsResult {
    pub aggregation_type: u8,
    pub result_value: u64,
    pub records_scanned: u32,
    pub compute_units_used: u64,
}

// ═══════════════════════════════════════════════════════════════════════════════
// YCSB KEY-VALUE STORE ACCOUNTS
// ═══════════════════════════════════════════════════════════════════════════════

/// YCSB Store configuration
#[account]
pub struct YcsbStore {
    pub authority: Pubkey,
    pub record_count: u32,
    pub field_count: u8,
    pub field_size: u16,
    pub initialized: bool,
    pub bump: u8,
}

impl YcsbStore {
    pub const LEN: usize = 8 + 32 + 4 + 1 + 2 + 1 + 1;
}

/// YCSB Key-Value Record
#[account]
pub struct YcsbRecord {
    /// The key for this record (32 bytes for PDA derivation)
    pub key: [u8; 32],
    
    /// The value data (variable size, max 1KB for benchmark)
    pub value: Vec<u8>,
    
    /// Metadata
    pub created_at: i64,
    pub updated_at: i64,
    pub version: u64,
    
    /// PDA bump
    pub bump: u8,
}

impl YcsbRecord {
    pub const BASE_LEN: usize = 8 + 32 + 4 + 8 + 8 + 8 + 1; // discriminator + key + vec_prefix + timestamps + version + bump
    pub const MAX_VALUE_SIZE: usize = 1024;
    pub const MAX_LEN: usize = Self::BASE_LEN + Self::MAX_VALUE_SIZE;
}

// ═══════════════════════════════════════════════════════════════════════════════
// IO HEAVY BENCHMARK ACCOUNTS
// ═══════════════════════════════════════════════════════════════════════════════

/// Account for IO heavy benchmark writes
#[account]
pub struct IoHeavyAccount {
    /// Key identifier
    pub key: [u8; 16],
    
    /// Variable size data
    pub data: Vec<u8>,
    
    /// Write counter
    pub write_count: u64,
    
    /// Last write timestamp
    pub last_write: i64,
    
    /// PDA bump
    pub bump: u8,
}

impl IoHeavyAccount {
    pub const BASE_LEN: usize = 8 + 16 + 4 + 8 + 8 + 1;
    pub const MAX_DATA_SIZE: usize = 2048;
    pub const MAX_LEN: usize = Self::BASE_LEN + Self::MAX_DATA_SIZE;
}

// ═══════════════════════════════════════════════════════════════════════════════
// METRIC RECORDING ACCOUNT
// ═══════════════════════════════════════════════════════════════════════════════

/// Individual metric entry for detailed analysis
#[account]
pub struct MetricEntry {
    pub benchmark_state: Pubkey,
    pub benchmark_type: u8,
    pub latency_us: u64,
    pub compute_units: u64,
    pub success: bool,
    pub timestamp: i64,
    pub sequence: u64,
    pub bump: u8,
}

impl MetricEntry {
    pub const LEN: usize = 8 + 32 + 1 + 8 + 8 + 1 + 8 + 8 + 1;
}

/// Latency histogram bucket for on-chain percentile calculation
#[account]
pub struct LatencyHistogram {
    pub benchmark_state: Pubkey,
    
    /// Histogram buckets (microseconds)
    /// Bucket boundaries: 0-100, 100-500, 500-1000, 1000-5000, 5000-10000, 10000-50000, 50000+
    pub buckets: [u64; 7],
    
    /// Total count
    pub total_count: u64,
    
    pub bump: u8,
}

impl LatencyHistogram {
    pub const LEN: usize = 8 + 32 + (8 * 7) + 8 + 1;
}
