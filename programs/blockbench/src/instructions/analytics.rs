//! Analytics Micro-benchmark
//!
//! Measures query layer performance through aggregation and scan operations.
//! Tests OLAP-style workload performance (which blockchains typically handle poorly).

use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::BlockbenchError;

/// Analytics: Aggregation query across multiple accounts
pub fn analytics_aggregate<'info>(
    ctx: Context<'_, '_, 'info, 'info, AnalyticsAggregate<'info>>,
    aggregation_type: AggregationType,
) -> Result<AnalyticsResult> {
    let remaining = ctx.remaining_accounts;
    
    require!(!remaining.is_empty(), BlockbenchError::InsufficientAccounts);
    
    let mut sum: u64 = 0;
    let mut count: u32 = 0;
    let mut min: u64 = u64::MAX;
    let mut max: u64 = 0;
    
    // Scan through all provided accounts
    for account in remaining.iter() {
        if let Ok(io_account) = Account::<IoHeavyAccount>::try_from(account) {
            let value = io_account.write_count;
            
            sum = sum.saturating_add(value);
            count += 1;
            
            if value < min {
                min = value;
            }
            if value > max {
                max = value;
            }
        }
    }
    
    // Compute the requested aggregation
    let result_value = match aggregation_type {
        AggregationType::Sum => sum,
        AggregationType::Count => count as u64,
        AggregationType::Average => {
            if count > 0 {
                sum / (count as u64)
            } else {
                0
            }
        }
        AggregationType::Min => {
            if min == u64::MAX { 0 } else { min }
        }
        AggregationType::Max => max,
    };
    
    let result = AnalyticsResult {
        aggregation_type: aggregation_type as u8,
        result_value,
        records_scanned: count,
        compute_units_used: 0, // Will be populated by caller
    };
    
    msg!(
        "Analytics Aggregate: type={:?}, result={}, scanned={}",
        aggregation_type,
        result_value,
        count
    );
    
    Ok(result)
}

/// Analytics: Scan and filter by threshold
pub fn analytics_scan<'info>(
    ctx: Context<'_, '_, 'info, 'info, AnalyticsScan<'info>>,
    filter_threshold: u64,
) -> Result<u32> {
    let remaining = ctx.remaining_accounts;
    
    let mut matches: u32 = 0;
    let mut scanned: u32 = 0;
    
    // Scan through all provided accounts and filter
    for account in remaining.iter() {
        scanned += 1;
        
        if let Ok(io_account) = Account::<IoHeavyAccount>::try_from(account) {
            // Filter: count accounts where write_count > threshold
            if io_account.write_count > filter_threshold {
                matches += 1;
            }
        }
    }
    
    msg!(
        "Analytics Scan: threshold={}, matches={}, scanned={}",
        filter_threshold,
        matches,
        scanned
    );
    
    Ok(matches)
}

#[derive(Accounts)]
pub struct AnalyticsAggregate<'info> {
    pub payer: Signer<'info>,
    // Remaining accounts are the accounts to aggregate over
}

#[derive(Accounts)]
pub struct AnalyticsScan<'info> {
    pub payer: Signer<'info>,
    // Remaining accounts are the accounts to scan
}
