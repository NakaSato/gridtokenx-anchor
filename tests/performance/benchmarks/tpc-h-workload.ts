#!/usr/bin/env node

/**
 * TPC-H Style Workload for GridTokenX Blockchain
 * 
 * Adapts TPC-H decision support (analytics) benchmark to blockchain.
 * Tests analytical query performance on ledger data.
 * 
 * Simplified Query Mapping:
 * - Q1: Aggregation (sum trades by period)
 * - Q3: Join + Filter (orders with customers)
 * - Q6: Scan with range filter
 * - Q14: Ratio calculation
 * 
 * Reference: TPC-H Specification v3.0
 */

export const TPC_H_QUERIES = {
    Q1_AGGREGATION: 'SUM trades by time period',
    Q3_SHIPPING: 'Orders with priority filter',
    Q6_REVENUE: 'Revenue forecast scan',
    Q14_PROMO: 'Promotional effect ratio',
    Q19_DISCOUNT: 'Discounted revenue query',
};

export interface TPCHConfig {
    scaleFactor: number;      // SF=1 = 1GB
    orders: number;
    customers: number;
    lineItems: number;
    queryMix: Record<string, number>;
}

export interface TPCHQuery {
    queryId: string;
    type: keyof typeof TPC_H_QUERIES;
    parameters: Record<string, any>;
    timestamp: number;
}

export interface TPCHResult {
    queryId: string;
    queryType: string;
    success: boolean;
    latencyMs: number;
    rowsScanned: number;
    rowsReturned: number;
    timestamp: number;
}

export interface TPCHMetrics {
    qphH: number;                    // Queries per hour (TPC-H primary)
    avgQueryLatencyMs: number;
    queryLatencies: Record<string, number>;
    throughputMBps: number;
    scanEfficiency: number;          // Rows returned / rows scanned
    latencyPercentiles: {
        p50: number;
        p95: number;
        p99: number;
    };
}

export class TPCHWorkload {
    private config: TPCHConfig;
    private results: TPCHResult[] = [];
    private startTime: number = 0;

    constructor(config: Partial<TPCHConfig> = {}) {
        this.config = {
            scaleFactor: config.scaleFactor || 0.1,
            orders: config.orders || 150000,
            customers: config.customers || 15000,
            lineItems: config.lineItems || 600000,
            queryMix: config.queryMix || {
                Q1_AGGREGATION: 0.30,
                Q3_SHIPPING: 0.20,
                Q6_REVENUE: 0.25,
                Q14_PROMO: 0.15,
                Q19_DISCOUNT: 0.10,
            },
        };
    }

    /**
     * Select query type based on mix
     */
    selectQueryType(): keyof typeof TPC_H_QUERIES {
        const rand = Math.random();
        let cumulative = 0;

        for (const [type, probability] of Object.entries(this.config.queryMix)) {
            cumulative += probability;
            if (rand < cumulative) {
                return type as keyof typeof TPC_H_QUERIES;
            }
        }
        return 'Q1_AGGREGATION';
    }

    /**
     * Generate query parameters based on query type
     */
    generateQuery(): TPCHQuery {
        const type = this.selectQueryType();
        const queryId = `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        let parameters: Record<string, any> = {};

        switch (type) {
            case 'Q1_AGGREGATION':
                // Aggregate trades in date range
                parameters = {
                    dateStart: '2024-01-01',
                    dateEnd: '2024-12-31',
                    groupBy: 'month',
                };
                break;

            case 'Q3_SHIPPING':
                // Orders with priority and date filter
                parameters = {
                    segment: Math.random() > 0.5 ? 'PRODUCER' : 'CONSUMER',
                    dateFilter: '2024-06-01',
                    limit: 10,
                };
                break;

            case 'Q6_REVENUE':
                // Revenue scan with range filter
                parameters = {
                    discount: 0.05 + Math.random() * 0.02,
                    quantityMin: 10,
                    quantityMax: 100,
                };
                break;

            case 'Q14_PROMO':
                // Promotional effect ratio
                parameters = {
                    month: Math.floor(Math.random() * 12) + 1,
                    year: 2024,
                };
                break;

            case 'Q19_DISCOUNT':
                // Discounted revenue with multiple conditions
                parameters = {
                    brands: ['GridToken', 'SolarPower', 'WindEnergy'],
                    containers: ['SM CASE', 'LG BOX'],
                };
                break;
        }

        return {
            queryId,
            type,
            parameters,
            timestamp: Date.now(),
        };
    }

    /**
     * Simulate query execution
     */
    async executeQuery(query: TPCHQuery): Promise<TPCHResult> {
        const start = Date.now();

        // Simulate query execution based on complexity
        let baseLatency: number;
        let rowsScanned: number;
        let rowsReturned: number;

        switch (query.type) {
            case 'Q1_AGGREGATION':
                // Heavy aggregation - scans most data
                baseLatency = 50 + Math.random() * 100; // 50-150ms
                rowsScanned = Math.floor(this.config.lineItems * 0.9);
                rowsReturned = 12; // Monthly aggregates
                break;

            case 'Q3_SHIPPING':
                // Join with filter
                baseLatency = 30 + Math.random() * 70; // 30-100ms
                rowsScanned = Math.floor(this.config.orders * 0.3);
                rowsReturned = 10;
                break;

            case 'Q6_REVENUE':
                // Scan with range filter
                baseLatency = 20 + Math.random() * 50; // 20-70ms
                rowsScanned = Math.floor(this.config.lineItems * 0.2);
                rowsReturned = 1; // Single aggregate
                break;

            case 'Q14_PROMO':
                // Ratio calculation
                baseLatency = 25 + Math.random() * 60; // 25-85ms
                rowsScanned = Math.floor(this.config.lineItems * 0.15);
                rowsReturned = 1;
                break;

            case 'Q19_DISCOUNT':
                // Complex multi-condition
                baseLatency = 40 + Math.random() * 80; // 40-120ms
                rowsScanned = Math.floor(this.config.lineItems * 0.25);
                rowsReturned = 50;
                break;

            default:
                baseLatency = 30 + Math.random() * 60;
                rowsScanned = 10000;
                rowsReturned = 10;
        }

        await new Promise(resolve => setTimeout(resolve, baseLatency));

        const result: TPCHResult = {
            queryId: query.queryId,
            queryType: query.type,
            success: Math.random() > 0.01, // 99% success rate
            latencyMs: Date.now() - start,
            rowsScanned,
            rowsReturned,
            timestamp: Date.now(),
        };

        this.results.push(result);
        return result;
    }

    /**
     * Run TPC-H workload
     */
    async run(options: {
        durationMs?: number;
        concurrency?: number;
    } = {}): Promise<TPCHMetrics> {
        const { durationMs = 30000, concurrency = 5 } = options;

        console.log('\n╔════════════════════════════════════════════════════════════╗');
        console.log('║     TPC-H Style Benchmark for GridTokenX                   ║');
        console.log('║     Blockchain Analytics / Decision Support                ║');
        console.log('╚════════════════════════════════════════════════════════════╝\n');

        console.log(`Configuration:`);
        console.log(`  Scale Factor: ${this.config.scaleFactor}`);
        console.log(`  Orders: ${this.config.orders.toLocaleString()}`);
        console.log(`  Line Items: ${this.config.lineItems.toLocaleString()}`);
        console.log(`  Concurrency: ${concurrency}`);
        console.log(`  Duration: ${durationMs}ms\n`);

        this.results = [];
        this.startTime = Date.now();
        const endTime = this.startTime + durationMs;
        let completed = 0;

        console.log('🚀 Running TPC-H queries...\n');

        const workers = Array.from({ length: concurrency }, async () => {
            while (Date.now() < endTime) {
                const query = this.generateQuery();
                await this.executeQuery(query);
                completed++;

                if (completed % 10 === 0) {
                    process.stdout.write(`\r  Completed: ${completed} queries`);
                }
            }
        });

        await Promise.all(workers);
        console.log('\n');

        return this.calculateMetrics();
    }

    /**
     * Calculate TPC-H metrics
     */
    calculateMetrics(): TPCHMetrics {
        const successful = this.results.filter(r => r.success);
        const durationHours = (Date.now() - this.startTime) / 3600000;

        // QphH = queries per hour (TPC-H primary metric)
        const qphH = successful.length / durationHours;

        const latencies = successful.map(r => r.latencyMs).sort((a, b) => a - b);
        const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;

        // Per-query type latencies
        const queryLatencies: Record<string, number> = {};
        for (const queryType of Object.keys(TPC_H_QUERIES)) {
            const typeResults = successful.filter(r => r.queryType === queryType);
            if (typeResults.length > 0) {
                queryLatencies[queryType] =
                    typeResults.reduce((sum, r) => sum + r.latencyMs, 0) / typeResults.length;
            }
        }

        // Scan efficiency
        const totalScanned = successful.reduce((sum, r) => sum + r.rowsScanned, 0);
        const totalReturned = successful.reduce((sum, r) => sum + r.rowsReturned, 0);
        const scanEfficiency = totalReturned / totalScanned;

        // Throughput (simulated)
        const bytesPerRow = 100; // Approximate
        const throughputMBps = (totalScanned * bytesPerRow) / (Date.now() - this.startTime) / 1000;

        const percentile = (arr: number[], p: number) => {
            if (arr.length === 0) return 0;
            const index = Math.ceil(arr.length * p) - 1;
            return arr[Math.max(0, index)];
        };

        const metrics: TPCHMetrics = {
            qphH: Math.round(qphH),
            avgQueryLatencyMs: Math.round(avgLatency * 100) / 100,
            queryLatencies,
            throughputMBps: Math.round(throughputMBps * 100) / 100,
            scanEfficiency: Math.round(scanEfficiency * 10000) / 10000,
            latencyPercentiles: {
                p50: percentile(latencies, 0.50),
                p95: percentile(latencies, 0.95),
                p99: percentile(latencies, 0.99),
            },
        };

        this.printMetrics(metrics);
        return metrics;
    }

    private printMetrics(metrics: TPCHMetrics): void {
        console.log('════════════════════════════════════════════════════════════');
        console.log('  TPC-H BENCHMARK RESULTS');
        console.log('════════════════════════════════════════════════════════════\n');

        console.log('📊 Primary Metric:');
        console.log(`   QphH (Queries/hour): ${metrics.qphH.toLocaleString()}\n`);

        console.log('⏱️  Query Latency:');
        console.log(`   Average: ${metrics.avgQueryLatencyMs.toFixed(2)}ms`);
        console.log(`   p50: ${metrics.latencyPercentiles.p50}ms`);
        console.log(`   p95: ${metrics.latencyPercentiles.p95}ms`);
        console.log(`   p99: ${metrics.latencyPercentiles.p99}ms\n`);

        console.log('📋 Per-Query Latency:');
        for (const [queryType, latency] of Object.entries(metrics.queryLatencies)) {
            console.log(`   ${queryType}: ${latency.toFixed(2)}ms`);
        }
        console.log('');

        console.log('📈 I/O Metrics:');
        console.log(`   Throughput: ${metrics.throughputMBps.toFixed(2)} MB/s`);
        console.log(`   Scan Efficiency: ${(metrics.scanEfficiency * 100).toFixed(4)}%\n`);
    }
}

// CLI execution
const isMainModule = import.meta.url === `file://${process.argv[1]}` ||
    process.argv[1]?.endsWith('tpc-h-workload.ts');

if (isMainModule) {
    const workload = new TPCHWorkload({
        scaleFactor: 0.1,
        orders: 10000,
        lineItems: 50000,
    });

    workload.run({
        durationMs: 30000,
        concurrency: 5,
    }).then(metrics => {
        console.log('\n✅ TPC-H Benchmark Complete');
        console.log(JSON.stringify(metrics, null, 2));
    }).catch(console.error);
}
