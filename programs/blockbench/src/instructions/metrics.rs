//! Benchmark Metrics Recording
//!
//! On-chain metric storage for post-hoc analysis.

use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::BlockbenchError;

/// Record a benchmark metric
pub fn record_metric(
    ctx: Context<RecordMetric>,
    benchmark_type: BenchmarkType,
    latency_us: u64,
    compute_units: u64,
    success: bool,
) -> Result<()> {
    let state = &mut ctx.accounts.benchmark_state;
    let metrics = &mut state.metrics;
    
    // Update counters
    metrics.total_operations += 1;
    if success {
        metrics.successful_operations += 1;
    } else {
        metrics.failed_operations += 1;
    }
    
    // Update latency stats
    metrics.total_latency_us = metrics.total_latency_us.saturating_add(latency_us);
    
    if latency_us < metrics.min_latency_us {
        metrics.min_latency_us = latency_us;
    }
    if latency_us > metrics.max_latency_us {
        metrics.max_latency_us = latency_us;
    }
    
    // For standard deviation calculation
    metrics.latency_sum_squares = metrics
        .latency_sum_squares
        .saturating_add(latency_us.saturating_mul(latency_us));
    
    // Update compute unit stats
    metrics.total_compute_units = metrics.total_compute_units.saturating_add(compute_units);
    
    if compute_units < metrics.min_compute_units {
        metrics.min_compute_units = compute_units;
    }
    if compute_units > metrics.max_compute_units {
        metrics.max_compute_units = compute_units;
    }
    
    // Update per-type counters
    match benchmark_type {
        BenchmarkType::YcsbRead => metrics.read_count += 1,
        BenchmarkType::YcsbInsert => metrics.insert_count += 1,
        BenchmarkType::YcsbUpdate => metrics.update_count += 1,
        BenchmarkType::YcsbDelete => metrics.delete_count += 1,
        BenchmarkType::YcsbScan => metrics.scan_count += 1,
        _ => {}
    }
    
    Ok(())
}

/// Reset benchmark metrics
pub fn reset_metrics(ctx: Context<ResetMetrics>) -> Result<()> {
    let state = &mut ctx.accounts.benchmark_state;
    
    require!(
        state.authority == ctx.accounts.authority.key(),
        BlockbenchError::Unauthorized
    );
    
    state.metrics = BlockbenchMetrics::default();
    state.metrics.min_latency_us = u64::MAX;
    state.metrics.min_compute_units = u64::MAX;
    state.is_running = false;
    state.run_id += 1;
    
    msg!("Benchmark metrics reset. New run_id: {}", state.run_id);
    
    Ok(())
}

/// Finalize benchmark and compute summary
pub fn finalize_benchmark(ctx: Context<FinalizeBenchmark>) -> Result<BenchmarkSummary> {
    let state = &mut ctx.accounts.benchmark_state;
    let clock = Clock::get()?;
    
    state.end_time = clock.unix_timestamp;
    state.is_running = false;
    
    let metrics = &state.metrics;
    let duration_seconds = if state.start_time > 0 {
        (state.end_time - state.start_time).max(1) as u64
    } else {
        1
    };
    
    // Calculate TPS
    let tps = metrics.successful_operations / duration_seconds;
    
    // Calculate average latency
    let avg_latency_us = if metrics.successful_operations > 0 {
        metrics.total_latency_us / metrics.successful_operations
    } else {
        0
    };
    
    // Calculate success rate (in basis points)
    let success_rate_bps = if metrics.total_operations > 0 {
        ((metrics.successful_operations * 10000) / metrics.total_operations) as u16
    } else {
        0
    };
    
    // Calculate average compute units
    let avg_compute_units = if metrics.successful_operations > 0 {
        metrics.total_compute_units / metrics.successful_operations
    } else {
        0
    };
    
    let summary = BenchmarkSummary {
        tps,
        avg_latency_us,
        // Percentiles require histogram data - use estimates for now
        p50_latency_us: avg_latency_us,
        p90_latency_us: avg_latency_us.saturating_mul(2),
        p95_latency_us: avg_latency_us.saturating_mul(3),
        p99_latency_us: metrics.max_latency_us,
        success_rate_bps,
        avg_compute_units,
        duration_seconds,
    };
    
    msg!(
        "Benchmark finalized: TPS={}, avg_latency={}us, success_rate={}%",
        summary.tps,
        summary.avg_latency_us,
        summary.success_rate_bps as f64 / 100.0
    );
    
    Ok(summary)
}

#[derive(Accounts)]
pub struct RecordMetric<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"blockbench", authority.key().as_ref()],
        bump = benchmark_state.bump,
    )]
    pub benchmark_state: Account<'info, BlockbenchState>,
}

#[derive(Accounts)]
pub struct ResetMetrics<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"blockbench", authority.key().as_ref()],
        bump = benchmark_state.bump,
    )]
    pub benchmark_state: Account<'info, BlockbenchState>,
}

#[derive(Accounts)]
pub struct FinalizeBenchmark<'info> {
    pub authority: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"blockbench", authority.key().as_ref()],
        bump = benchmark_state.bump,
    )]
    pub benchmark_state: Account<'info, BlockbenchState>,
}
