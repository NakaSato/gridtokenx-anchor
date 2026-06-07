//! Benchmark Management Instructions
//! 
//! Instructions for controlling and monitoring the TPC-C benchmark.

use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::TpcError;

/// Record Metric Context
#[derive(Accounts)]
pub struct RecordMetric<'info> {
    #[account(
        mut,
        seeds = [b"benchmark"],
        bump = benchmark.bump,
    )]
    pub benchmark: Account<'info, BenchmarkState>,
    
    /// Authority must be the benchmark owner
    #[account(
        constraint = authority.key() == benchmark.authority @ TpcError::Unauthorized
    )]
    pub authority: Signer<'info>,
}

/// Record a transaction metric
pub fn record_metric(
    ctx: Context<RecordMetric>,
    tx_type: TransactionType,
    latency_us: u64,
    success: bool,
    retry_count: u8,
) -> Result<()> {
    let benchmark = &mut ctx.accounts.benchmark;
    let stats = &mut benchmark.stats;
    
    // Update transaction counts
    match tx_type {
        TransactionType::NewOrder => stats.new_order_count += 1,
        TransactionType::Payment => stats.payment_count += 1,
        TransactionType::OrderStatus => stats.order_status_count += 1,
        TransactionType::Delivery => stats.delivery_count += 1,
        TransactionType::StockLevel => stats.stock_level_count += 1,
    }
    
    // Update success/failure counts
    if success {
        stats.successful_transactions += 1;
    } else {
        stats.failed_transactions += 1;
    }
    
    // Track conflicts (retries indicate lock conflicts)
    if retry_count > 0 {
        stats.conflict_count += retry_count as u64;
    }
    
    // Update latency statistics
    stats.total_latency_us += latency_us;
    
    if stats.min_latency_us == 0 || latency_us < stats.min_latency_us {
        stats.min_latency_us = latency_us;
    }
    
    if latency_us > stats.max_latency_us {
        stats.max_latency_us = latency_us;
    }
    
    Ok(())
}

/// Reset Benchmark Context
#[derive(Accounts)]
pub struct ResetBenchmark<'info> {
    #[account(
        mut,
        seeds = [b"benchmark"],
        bump = benchmark.bump,
    )]
    pub benchmark: Account<'info, BenchmarkState>,
    
    /// Authority must be the benchmark owner
    #[account(
        constraint = authority.key() == benchmark.authority @ TpcError::Unauthorized
    )]
    pub authority: Signer<'info>,
}

/// Reset benchmark statistics
pub fn reset_benchmark(ctx: Context<ResetBenchmark>) -> Result<()> {
    let benchmark = &mut ctx.accounts.benchmark;
    
    benchmark.stats = BenchmarkStats::default();
    benchmark.is_running = false;
    benchmark.start_time = 0;
    benchmark.end_time = 0;
    
    msg!("Benchmark statistics reset");
    Ok(())
}
