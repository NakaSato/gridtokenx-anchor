#!/usr/bin/env node

/**
 * TPC-C Style Workload for GridTokenX Blockchain
 * 
 * Adapts TPC-C OLTP benchmark to energy trading operations
 * following TPCTC "blockchainification" methodology.
 * 
 * TPC-C Transaction Mapping:
 * - New Order (45%) → Create Energy Order
 * - Payment (43%)   → Token Transfer
 * - Order Status (4%) → Check Order Status
 * - Delivery (4%)   → Execute Trade
 * - Stock Level (4%) → Check Energy Balance
 * 
 * Reference: TPC-C Specification v5.11
 */

import * as crypto from 'crypto';

// TPC-C Transaction Mix (per spec)
export const TPC_C_MIX = {
    NEW_ORDER: 0.45,
    PAYMENT: 0.43,
    ORDER_STATUS: 0.04,
    DELIVERY: 0.04,
    STOCK_LEVEL: 0.04,
};

// GridTokenX mapping
export const ENERGY_TRADING_MIX = {
    CREATE_ORDER: 0.45,      // New Order
    TOKEN_TRANSFER: 0.43,    // Payment
    GET_ORDER_STATUS: 0.04,  // Order Status
    EXECUTE_TRADE: 0.04,     // Delivery
    CHECK_BALANCE: 0.04,     // Stock Level
};

export interface TPCConfig {
    warehouses: number;        // W parameter - scale factor
    districtsPerWarehouse: number;
    customersPerDistrict: number;
    itemCount: number;
    thinkTimeMs: number;       // User think time
    keyingTimeMs: number;      // Keying time
    warmupPercent: number;     // Discard first N% of results
}

export interface TPCTransaction {
    type: keyof typeof ENERGY_TRADING_MIX;
    warehouseId: number;
    districtId: number;
    customerId?: number;
    orderId?: number;
    amount?: number;
    items?: Array<{ itemId: number; quantity: number }>;
    timestamp: number;
}

export interface TPCResult {
    transactionType: string;
    success: boolean;
    latencyMs: number;
    timestamp: number;
    mvccConflict: boolean;
    retryCount: number;
}

export interface TPCMetrics {
    tpmC: number;                    // Transactions per minute (New Order equiv)
    totalTransactions: number;
    successfulTransactions: number;
    failedTransactions: number;
    mvccConflicts: number;
    avgLatencyMs: number;
    latencyPercentiles: {
        p50: number;
        p75: number;
        p90: number;
        p95: number;
        p99: number;
    };
    transactionMix: Record<string, number>;
    warmupDiscarded: number;
    trustPremium?: number;           // vs centralized baseline
}

/**
 * Non-Uniform Random Number Generator (TPC-C Spec)
 * NURand(A, x, y) = (((random(0, A) | random(x, y)) + C) % (y - x + 1)) + x
 */
function NURand(A: number, x: number, y: number, C: number = 0): number {
    const random = (min: number, max: number) =>
        Math.floor(Math.random() * (max - min + 1)) + min;
    return (((random(0, A) | random(x, y)) + C) % (y - x + 1)) + x;
}

/**
 * Generate customer ID using TPC-C non-uniform distribution
 */
function generateCustomerId(districtsPerWarehouse: number, customersPerDistrict: number): number {
    return NURand(1023, 1, customersPerDistrict);
}

/**
 * Generate item ID using TPC-C non-uniform distribution
 */
function generateItemId(itemCount: number): number {
    return NURand(8191, 1, itemCount);
}

export class TPCCWorkload {
    private config: TPCConfig;
    private results: TPCResult[] = [];
    private startTime: number = 0;

    constructor(config: Partial<TPCConfig> = {}) {
        this.config = {
            warehouses: config.warehouses || 1,
            districtsPerWarehouse: config.districtsPerWarehouse || 10,
            customersPerDistrict: config.customersPerDistrict || 3000,
            itemCount: config.itemCount || 100000,
            thinkTimeMs: config.thinkTimeMs || 0,  // Disabled for max throughput
            keyingTimeMs: config.keyingTimeMs || 0,
            warmupPercent: config.warmupPercent || 10,
        };
    }

    /**
     * Select transaction type based on TPC-C mix
     */
    selectTransactionType(): keyof typeof ENERGY_TRADING_MIX {
        const rand = Math.random();
        let cumulative = 0;

        for (const [type, probability] of Object.entries(ENERGY_TRADING_MIX)) {
            cumulative += probability;
            if (rand < cumulative) {
                return type as keyof typeof ENERGY_TRADING_MIX;
            }
        }
        return 'CREATE_ORDER';
    }

    /**
     * Generate a TPC-C transaction
     */
    generateTransaction(): TPCTransaction {
        const type = this.selectTransactionType();
        const warehouseId = Math.floor(Math.random() * this.config.warehouses) + 1;
        const districtId = Math.floor(Math.random() * this.config.districtsPerWarehouse) + 1;

        const tx: TPCTransaction = {
            type,
            warehouseId,
            districtId,
            timestamp: Date.now(),
        };

        switch (type) {
            case 'CREATE_ORDER':
                // New Order: 5-15 items per order
                const numItems = Math.floor(Math.random() * 11) + 5;
                tx.customerId = generateCustomerId(
                    this.config.districtsPerWarehouse,
                    this.config.customersPerDistrict
                );
                tx.items = Array.from({ length: numItems }, () => ({
                    itemId: generateItemId(this.config.itemCount),
                    quantity: Math.floor(Math.random() * 10) + 1,
                }));
                tx.amount = tx.items.reduce((sum, item) =>
                    sum + item.quantity * (Math.random() * 100), 0);
                break;

            case 'TOKEN_TRANSFER':
                // Payment: Transfer between accounts
                tx.customerId = generateCustomerId(
                    this.config.districtsPerWarehouse,
                    this.config.customersPerDistrict
                );
                tx.amount = Math.random() * 5000 + 1;
                break;

            case 'GET_ORDER_STATUS':
                // Order Status: Query last order
                tx.customerId = generateCustomerId(
                    this.config.districtsPerWarehouse,
                    this.config.customersPerDistrict
                );
                break;

            case 'EXECUTE_TRADE':
                // Delivery: Process batch of orders
                tx.orderId = Math.floor(Math.random() * 10000) + 1;
                break;

            case 'CHECK_BALANCE':
                // Stock Level: Check energy balance threshold
                tx.amount = Math.floor(Math.random() * 100); // Threshold
                break;
        }

        return tx;
    }

    /**
     * Simulate transaction execution (mock for testing)
     */
    async executeTransaction(tx: TPCTransaction): Promise<TPCResult> {
        const start = Date.now();
        let success = true;
        let mvccConflict = false;
        let retryCount = 0;

        // Simulate execution with realistic latency distribution
        // Higher latency for write transactions (CREATE_ORDER, TOKEN_TRANSFER)
        let baseLatency: number;
        switch (tx.type) {
            case 'CREATE_ORDER':
                baseLatency = 5 + Math.random() * 10; // 5-15ms
                // 2% MVCC conflict rate for high-contention operations
                mvccConflict = Math.random() < 0.02;
                break;
            case 'TOKEN_TRANSFER':
                baseLatency = 3 + Math.random() * 7; // 3-10ms
                mvccConflict = Math.random() < 0.01;
                break;
            case 'EXECUTE_TRADE':
                baseLatency = 8 + Math.random() * 12; // 8-20ms
                mvccConflict = Math.random() < 0.03;
                break;
            default:
                baseLatency = 1 + Math.random() * 5; // 1-6ms (read operations)
        }

        // Add consensus overhead (simulated)
        const consensusOverhead = 2 + Math.random() * 3;
        const totalLatency = baseLatency + consensusOverhead;

        await new Promise(resolve => setTimeout(resolve, totalLatency));

        if (mvccConflict) {
            // Retry logic
            retryCount = 1;
            success = Math.random() > 0.1; // 90% success on retry
        }

        const result: TPCResult = {
            transactionType: tx.type,
            success,
            latencyMs: Date.now() - start,
            timestamp: Date.now(),
            mvccConflict,
            retryCount,
        };

        this.results.push(result);
        return result;
    }

    /**
     * Run TPC-C workload
     */
    async run(options: {
        durationMs?: number;
        transactionCount?: number;
        concurrency?: number;
    } = {}): Promise<TPCMetrics> {
        const {
            durationMs = 60000,
            transactionCount,
            concurrency = 10
        } = options;

        console.log('\n╔════════════════════════════════════════════════════════════╗');
        console.log('║     TPC-C Style Benchmark for GridTokenX                   ║');
        console.log('║     Energy Trading Blockchain Performance Analysis         ║');
        console.log('╚════════════════════════════════════════════════════════════╝\n');

        console.log(`Configuration:`);
        console.log(`  Warehouses: ${this.config.warehouses}`);
        console.log(`  Districts/Warehouse: ${this.config.districtsPerWarehouse}`);
        console.log(`  Concurrency: ${concurrency}`);
        console.log(`  Duration: ${durationMs}ms`);
        console.log(`  Warmup: ${this.config.warmupPercent}%\n`);

        this.results = [];
        this.startTime = Date.now();
        const endTime = this.startTime + durationMs;
        let completed = 0;

        console.log('🚀 Running TPC-C workload...\n');

        // Run concurrent transactions
        const workers = Array.from({ length: concurrency }, async () => {
            while (Date.now() < endTime) {
                const tx = this.generateTransaction();
                await this.executeTransaction(tx);
                completed++;

                if (completed % 100 === 0) {
                    process.stdout.write(`\r  Completed: ${completed} transactions`);
                }
            }
        });

        await Promise.all(workers);
        console.log('\n');

        return this.calculateMetrics();
    }

    /**
     * Calculate TPC-C compliant metrics
     */
    calculateMetrics(): TPCMetrics {
        // Remove warmup period
        const warmupCount = Math.floor(this.results.length * (this.config.warmupPercent / 100));
        const steadyStateResults = this.results.slice(warmupCount);

        // Filter successful transactions
        const successful = steadyStateResults.filter(r => r.success);
        const failed = steadyStateResults.filter(r => !r.success);
        const conflicts = steadyStateResults.filter(r => r.mvccConflict);

        // Calculate latencies
        const latencies = successful.map(r => r.latencyMs).sort((a, b) => a - b);

        // Remove outliers (>3σ)
        const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length;
        const stdDev = Math.sqrt(
            latencies.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / latencies.length
        );
        const filteredLatencies = latencies.filter(l => Math.abs(l - mean) <= 3 * stdDev);

        // Calculate percentiles
        const percentile = (arr: number[], p: number) => {
            if (arr.length === 0) return 0;
            const index = Math.ceil(arr.length * p) - 1;
            return arr[Math.max(0, index)];
        };

        // Calculate tpmC (New Order transactions per minute)
        const durationMinutes = (Date.now() - this.startTime) / 60000;
        const newOrderCount = successful.filter(r => r.transactionType === 'CREATE_ORDER').length;
        const tpmC = newOrderCount / durationMinutes;

        // Transaction mix
        const mixCounts: Record<string, number> = {};
        for (const r of successful) {
            mixCounts[r.transactionType] = (mixCounts[r.transactionType] || 0) + 1;
        }

        const metrics: TPCMetrics = {
            tpmC: Math.round(tpmC * 100) / 100,
            totalTransactions: steadyStateResults.length,
            successfulTransactions: successful.length,
            failedTransactions: failed.length,
            mvccConflicts: conflicts.length,
            avgLatencyMs: Math.round(mean * 100) / 100,
            latencyPercentiles: {
                p50: percentile(filteredLatencies, 0.50),
                p75: percentile(filteredLatencies, 0.75),
                p90: percentile(filteredLatencies, 0.90),
                p95: percentile(filteredLatencies, 0.95),
                p99: percentile(filteredLatencies, 0.99),
            },
            transactionMix: mixCounts,
            warmupDiscarded: warmupCount,
        };

        this.printMetrics(metrics);
        return metrics;
    }

    private printMetrics(metrics: TPCMetrics): void {
        console.log('════════════════════════════════════════════════════════════');
        console.log('  TPC-C BENCHMARK RESULTS');
        console.log('════════════════════════════════════════════════════════════\n');

        console.log('📊 Primary Metric:');
        console.log(`   tpmC (New Order/min): ${metrics.tpmC.toFixed(2)}\n`);

        console.log('📈 Transaction Summary:');
        console.log(`   Total: ${metrics.totalTransactions}`);
        console.log(`   Successful: ${metrics.successfulTransactions}`);
        console.log(`   Failed: ${metrics.failedTransactions}`);
        console.log(`   MVCC Conflicts: ${metrics.mvccConflicts}`);
        console.log(`   Warmup Discarded: ${metrics.warmupDiscarded}\n`);

        console.log('⏱️  Latency (with outlier removal):');
        console.log(`   Average: ${metrics.avgLatencyMs.toFixed(2)}ms`);
        console.log(`   p50: ${metrics.latencyPercentiles.p50.toFixed(2)}ms`);
        console.log(`   p75: ${metrics.latencyPercentiles.p75.toFixed(2)}ms`);
        console.log(`   p90: ${metrics.latencyPercentiles.p90.toFixed(2)}ms`);
        console.log(`   p95: ${metrics.latencyPercentiles.p95.toFixed(2)}ms`);
        console.log(`   p99: ${metrics.latencyPercentiles.p99.toFixed(2)}ms\n`);

        console.log('📋 Transaction Mix:');
        for (const [type, count] of Object.entries(metrics.transactionMix)) {
            const pct = ((count / metrics.successfulTransactions) * 100).toFixed(1);
            console.log(`   ${type}: ${count} (${pct}%)`);
        }
        console.log('');
    }
}

// CLI execution
const isMainModule = import.meta.url === `file://${process.argv[1]}` ||
    process.argv[1]?.endsWith('tpc-c-workload.ts');

if (isMainModule) {
    const workload = new TPCCWorkload({
        warehouses: 1,
        districtsPerWarehouse: 10,
    });

    workload.run({
        durationMs: 30000,
        concurrency: 10,
    }).then(metrics => {
        console.log('\n✅ TPC-C Benchmark Complete');
        console.log(JSON.stringify(metrics, null, 2));
    }).catch(console.error);
}
