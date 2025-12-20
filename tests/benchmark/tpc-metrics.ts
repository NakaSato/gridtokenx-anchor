#!/usr/bin/env node

/**
 * TPC Metrics Calculator for GridTokenX Research
 * 
 * Provides TPC-compliant statistical analysis including:
 * - Warmup period handling
 * - Outlier detection (>3σ exclusion)
 * - 95% confidence intervals
 * - Percentile calculations
 * - Trust Premium analysis (vs centralized baseline)
 * 
 * Reference: TPC-C Specification v5.11, Section 5
 */

export interface RawMetricData {
    latencies: number[];
    timestamps: number[];
    success: boolean[];
    transactionTypes: string[];
    conflicts?: boolean[];
}

export interface TPCCompliantMetrics {
    // Primary TPC metrics
    tpmC: number;
    tpmCConfidenceInterval: { lower: number; upper: number };

    // Throughput
    throughput: {
        average: number;
        peak: number;
        sustainedWindow: number[];
    };

    // Latency with statistical rigor
    latency: {
        mean: number;
        stdDev: number;
        percentiles: {
            p50: number;
            p75: number;
            p90: number;
            p95: number;
            p99: number;
            p999: number;
        };
        confidenceInterval95: { lower: number; upper: number };
        outliersRemoved: number;
    };

    // Transaction analysis
    transactions: {
        total: number;
        successful: number;
        failed: number;
        warmupDiscarded: number;
        successRate: number;
    };

    // Blockchain-specific metrics
    blockchain: {
        mvccConflictRate: number;
        consensusLatencyEstimate: number;
        blockInclusionRate: number;
    };

    // Trust Premium (cost of decentralization)
    trustPremium: {
        vsBaseline: number;        // Multiplier vs centralized DB
        overheadMs: number;        // Additional latency
        throughputPenalty: number; // % throughput reduction
    };

    // Metadata
    metadata: {
        testDurationMs: number;
        warmupPeriodMs: number;
        sampleSize: number;
        outlierThreshold: number;
    };
}

export interface BaselineComparison {
    centralizedTps: number;
    centralizedLatencyMs: number;
    source: string;
}

// Default baseline: PostgreSQL on similar hardware
const DEFAULT_BASELINE: BaselineComparison = {
    centralizedTps: 5000,
    centralizedLatencyMs: 2,
    source: 'PostgreSQL 15 (4 vCPU, 8GB RAM)',
};

export class TPCMetricsCalculator {
    private warmupPercent: number;
    private outlierSigma: number;
    private confidenceLevel: number;

    constructor(options: {
        warmupPercent?: number;
        outlierSigma?: number;
        confidenceLevel?: number;
    } = {}) {
        this.warmupPercent = options.warmupPercent || 10;
        this.outlierSigma = options.outlierSigma || 3;
        this.confidenceLevel = options.confidenceLevel || 0.95;
    }

    /**
     * Calculate comprehensive TPC-compliant metrics
     */
    calculate(
        data: RawMetricData,
        baseline: BaselineComparison = DEFAULT_BASELINE
    ): TPCCompliantMetrics {
        // 1. Remove warmup period
        const warmupCount = Math.floor(data.latencies.length * (this.warmupPercent / 100));
        const steadyState = {
            latencies: data.latencies.slice(warmupCount),
            timestamps: data.timestamps.slice(warmupCount),
            success: data.success.slice(warmupCount),
            transactionTypes: data.transactionTypes.slice(warmupCount),
            conflicts: data.conflicts?.slice(warmupCount),
        };

        // 2. Filter successful transactions
        const successfulIndices = steadyState.success
            .map((s, i) => s ? i : -1)
            .filter(i => i >= 0);

        const successfulLatencies = successfulIndices.map(i => steadyState.latencies[i]);
        const successfulTimestamps = successfulIndices.map(i => steadyState.timestamps[i]);

        // 3. Calculate basic statistics
        const mean = this.mean(successfulLatencies);
        const stdDev = this.standardDeviation(successfulLatencies);

        // 4. Remove outliers (>3σ)
        const outlierThreshold = this.outlierSigma * stdDev;
        const filteredLatencies = successfulLatencies.filter(
            l => Math.abs(l - mean) <= outlierThreshold
        );
        const outliersRemoved = successfulLatencies.length - filteredLatencies.length;

        // 5. Calculate percentiles
        const sortedLatencies = [...filteredLatencies].sort((a, b) => a - b);

        // 6. Calculate tpmC
        const testDuration = Math.max(...successfulTimestamps) - Math.min(...successfulTimestamps);
        const testDurationMinutes = testDuration / 60000;

        const newOrderCount = successfulIndices.filter(
            i => steadyState.transactionTypes[i] === 'CREATE_ORDER' ||
                steadyState.transactionTypes[i] === 'NEW_ORDER'
        ).length;

        const tpmC = newOrderCount / testDurationMinutes;

        // 7. Calculate throughput over time (1-second windows)
        const throughputWindows = this.calculateThroughputWindows(
            successfulTimestamps,
            1000
        );

        // 8. Calculate MVCC conflict rate
        const conflicts = steadyState.conflicts || [];
        const conflictCount = conflicts.filter(c => c).length;
        const mvccConflictRate = (conflictCount / steadyState.latencies.length) * 100;

        // 9. Calculate Trust Premium
        const actualTps = filteredLatencies.length / (testDuration / 1000);
        const actualLatency = this.mean(filteredLatencies);

        const trustPremium = {
            vsBaseline: actualLatency / baseline.centralizedLatencyMs,
            overheadMs: actualLatency - baseline.centralizedLatencyMs,
            throughputPenalty: ((baseline.centralizedTps - actualTps) / baseline.centralizedTps) * 100,
        };

        // 10. Calculate confidence intervals
        const tpmCCI = this.confidenceInterval(
            Array(Math.floor(testDurationMinutes)).fill(0).map((_, i) => {
                const windowStart = successfulTimestamps[0] + i * 60000;
                const windowEnd = windowStart + 60000;
                return successfulIndices.filter(j => {
                    const ts = successfulTimestamps[successfulIndices.indexOf(j)];
                    return ts >= windowStart && ts < windowEnd &&
                        (steadyState.transactionTypes[j] === 'CREATE_ORDER' ||
                            steadyState.transactionTypes[j] === 'NEW_ORDER');
                }).length;
            }),
            this.confidenceLevel
        );

        const latencyCI = this.confidenceInterval(filteredLatencies, this.confidenceLevel);

        return {
            tpmC: Math.round(tpmC * 100) / 100,
            tpmCConfidenceInterval: {
                lower: Math.round(tpmCCI.lower * 100) / 100,
                upper: Math.round(tpmCCI.upper * 100) / 100,
            },

            throughput: {
                average: Math.round(actualTps * 100) / 100,
                peak: Math.max(...throughputWindows),
                sustainedWindow: throughputWindows.slice(-10), // Last 10 seconds
            },

            latency: {
                mean: Math.round(this.mean(filteredLatencies) * 100) / 100,
                stdDev: Math.round(this.standardDeviation(filteredLatencies) * 100) / 100,
                percentiles: {
                    p50: this.percentile(sortedLatencies, 0.50),
                    p75: this.percentile(sortedLatencies, 0.75),
                    p90: this.percentile(sortedLatencies, 0.90),
                    p95: this.percentile(sortedLatencies, 0.95),
                    p99: this.percentile(sortedLatencies, 0.99),
                    p999: this.percentile(sortedLatencies, 0.999),
                },
                confidenceInterval95: {
                    lower: Math.round(latencyCI.lower * 100) / 100,
                    upper: Math.round(latencyCI.upper * 100) / 100,
                },
                outliersRemoved,
            },

            transactions: {
                total: steadyState.latencies.length,
                successful: successfulIndices.length,
                failed: steadyState.latencies.length - successfulIndices.length,
                warmupDiscarded: warmupCount,
                successRate: (successfulIndices.length / steadyState.latencies.length) * 100,
            },

            blockchain: {
                mvccConflictRate: Math.round(mvccConflictRate * 100) / 100,
                consensusLatencyEstimate: Math.round((actualLatency * 0.4) * 100) / 100, // ~40% of latency
                blockInclusionRate: 100 - mvccConflictRate,
            },

            trustPremium: {
                vsBaseline: Math.round(trustPremium.vsBaseline * 100) / 100,
                overheadMs: Math.round(trustPremium.overheadMs * 100) / 100,
                throughputPenalty: Math.round(trustPremium.throughputPenalty * 100) / 100,
            },

            metadata: {
                testDurationMs: Math.round(testDuration),
                warmupPeriodMs: Math.round(warmupCount * (testDuration / steadyState.latencies.length)),
                sampleSize: filteredLatencies.length,
                outlierThreshold: Math.round(outlierThreshold * 100) / 100,
            },
        };
    }

    /**
     * Calculate mean
     */
    private mean(values: number[]): number {
        if (values.length === 0) return 0;
        return values.reduce((a, b) => a + b, 0) / values.length;
    }

    /**
     * Calculate standard deviation
     */
    private standardDeviation(values: number[]): number {
        if (values.length === 0) return 0;
        const avg = this.mean(values);
        const squareDiffs = values.map(v => Math.pow(v - avg, 2));
        return Math.sqrt(this.mean(squareDiffs));
    }

    /**
     * Calculate percentile
     */
    private percentile(sortedValues: number[], p: number): number {
        if (sortedValues.length === 0) return 0;
        const index = Math.ceil(sortedValues.length * p) - 1;
        return Math.round(sortedValues[Math.max(0, index)] * 100) / 100;
    }

    /**
     * Calculate confidence interval
     */
    private confidenceInterval(
        values: number[],
        level: number
    ): { lower: number; upper: number } {
        if (values.length === 0) return { lower: 0, upper: 0 };

        const avg = this.mean(values);
        const stdErr = this.standardDeviation(values) / Math.sqrt(values.length);

        // Z-score for confidence level (approximate)
        const zScores: Record<number, number> = {
            0.90: 1.645,
            0.95: 1.96,
            0.99: 2.576,
        };
        const z = zScores[level] || 1.96;

        return {
            lower: avg - z * stdErr,
            upper: avg + z * stdErr,
        };
    }

    /**
     * Calculate throughput in time windows
     */
    private calculateThroughputWindows(
        timestamps: number[],
        windowMs: number
    ): number[] {
        if (timestamps.length === 0) return [];

        const startTime = Math.min(...timestamps);
        const endTime = Math.max(...timestamps);
        const windows: number[] = [];

        for (let t = startTime; t < endTime; t += windowMs) {
            const count = timestamps.filter(ts => ts >= t && ts < t + windowMs).length;
            windows.push(count * (1000 / windowMs)); // Convert to TPS
        }

        return windows;
    }

    /**
     * Print formatted metrics report
     */
    printReport(metrics: TPCCompliantMetrics): void {
        console.log('\n════════════════════════════════════════════════════════════════════');
        console.log('  TPC-COMPLIANT METRICS REPORT');
        console.log('  GridTokenX Blockchain Performance Analysis');
        console.log('════════════════════════════════════════════════════════════════════\n');

        console.log('┌─────────────────────────────────────────────────────────────────┐');
        console.log('│  PRIMARY METRIC: tpmC (Transactions per Minute - New Order eq) │');
        console.log('├─────────────────────────────────────────────────────────────────┤');
        console.log(`│  Value: ${metrics.tpmC.toFixed(2)} tpmC`);
        console.log(`│  95% CI: [${metrics.tpmCConfidenceInterval.lower.toFixed(2)}, ${metrics.tpmCConfidenceInterval.upper.toFixed(2)}]`);
        console.log('└─────────────────────────────────────────────────────────────────┘\n');

        console.log('📊 THROUGHPUT');
        console.log(`   Average: ${metrics.throughput.average.toFixed(2)} TPS`);
        console.log(`   Peak: ${metrics.throughput.peak.toFixed(2)} TPS\n`);

        console.log('⏱️  LATENCY (outliers removed: ' + metrics.latency.outliersRemoved + ')');
        console.log(`   Mean: ${metrics.latency.mean.toFixed(2)}ms ± ${metrics.latency.stdDev.toFixed(2)}ms`);
        console.log(`   p50: ${metrics.latency.percentiles.p50}ms`);
        console.log(`   p95: ${metrics.latency.percentiles.p95}ms`);
        console.log(`   p99: ${metrics.latency.percentiles.p99}ms`);
        console.log(`   95% CI: [${metrics.latency.confidenceInterval95.lower.toFixed(2)}, ${metrics.latency.confidenceInterval95.upper.toFixed(2)}]ms\n`);

        console.log('📈 TRANSACTIONS');
        console.log(`   Total: ${metrics.transactions.total}`);
        console.log(`   Successful: ${metrics.transactions.successful} (${metrics.transactions.successRate.toFixed(1)}%)`);
        console.log(`   Warmup Discarded: ${metrics.transactions.warmupDiscarded}\n`);

        console.log('⛓️  BLOCKCHAIN METRICS');
        console.log(`   MVCC Conflict Rate: ${metrics.blockchain.mvccConflictRate.toFixed(2)}%`);
        console.log(`   Consensus Latency Est: ${metrics.blockchain.consensusLatencyEstimate.toFixed(2)}ms`);
        console.log(`   Block Inclusion Rate: ${metrics.blockchain.blockInclusionRate.toFixed(2)}%\n`);

        console.log('┌─────────────────────────────────────────────────────────────────┐');
        console.log('│  TRUST PREMIUM (Cost of Decentralization)                      │');
        console.log('├─────────────────────────────────────────────────────────────────┤');
        console.log(`│  Latency Multiplier vs Baseline: ${metrics.trustPremium.vsBaseline.toFixed(2)}x`);
        console.log(`│  Additional Overhead: +${metrics.trustPremium.overheadMs.toFixed(2)}ms`);
        console.log(`│  Throughput Penalty: ${metrics.trustPremium.throughputPenalty.toFixed(1)}%`);
        console.log('└─────────────────────────────────────────────────────────────────┘\n');

        console.log('📋 METADATA');
        console.log(`   Test Duration: ${(metrics.metadata.testDurationMs / 1000).toFixed(1)}s`);
        console.log(`   Sample Size: ${metrics.metadata.sampleSize}`);
        console.log(`   Outlier Threshold: ±${metrics.metadata.outlierThreshold.toFixed(2)}ms\n`);
    }
}

// Export for use in other modules
export { DEFAULT_BASELINE };
