#!/usr/bin/env node

/**
 * TPC-E Style Workload for GridTokenX Blockchain
 * 
 * Adapts TPC-E financial trading benchmark to energy DEX operations.
 * TPC-E simulates a brokerage with trade orders, market data, and positions.
 * 
 * Transaction Mapping:
 * - Trade Order (TO) → Submit limit order
 * - Trade Result (TR) → Execute/match orders
 * - Market Feed (MF) → Oracle price update
 * - Customer Position (CP) → Get portfolio balance
 * - Broker Volume (BV) → Trading volume query
 * - Security Detail (SD) → Asset information query
 * 
 * Reference: TPC-E Specification v1.14
 */

export const TPC_E_MIX = {
    TRADE_ORDER: 0.30,      // Submit new trade
    TRADE_RESULT: 0.25,     // Execute trade
    MARKET_FEED: 0.15,      // Price updates
    CUSTOMER_POSITION: 0.12, // Portfolio balance
    BROKER_VOLUME: 0.08,    // Volume analytics
    SECURITY_DETAIL: 0.10,  // Asset info
};

// Map to GridTokenX energy trading
export const ENERGY_DEX_MIX = {
    SUBMIT_ORDER: 0.30,       // Trade Order
    EXECUTE_TRADE: 0.25,      // Trade Result
    UPDATE_ORACLE: 0.15,      // Market Feed
    GET_BALANCE: 0.12,        // Customer Position
    GET_VOLUME: 0.08,         // Broker Volume
    GET_ASSET_INFO: 0.10,     // Security Detail
};

export interface TPCEConfig {
    customers: number;
    securities: number;      // Number of tradable assets
    brokers: number;
    tradeDays: number;
    volatility: number;      // Price volatility (0-1)
}

export interface TPCETransaction {
    type: keyof typeof ENERGY_DEX_MIX;
    customerId: number;
    securityId: number;
    orderId?: number;
    tradeType?: 'BUY' | 'SELL';
    quantity?: number;
    price?: number;
    timestamp: number;
}

export interface TPCEResult {
    transactionType: string;
    success: boolean;
    latencyMs: number;
    timestamp: number;
    isRead: boolean;
    tradeValue?: number;
}

export interface TPCEMetrics {
    tpsE: number;                    // Trade-Result equivalent TPS
    tradeOrdersPerSec: number;
    avgLatencyMs: number;
    readWriteRatio: number;          // Important for DeFi analysis
    latencyPercentiles: {
        p50: number;
        p95: number;
        p99: number;
    };
    transactionMix: Record<string, number>;
    totalTradeValue: number;
}

export class TPCEWorkload {
    private config: TPCEConfig;
    private results: TPCEResult[] = [];
    private startTime: number = 0;
    private currentPrices: Map<number, number> = new Map();

    constructor(config: Partial<TPCEConfig> = {}) {
        this.config = {
            customers: config.customers || 5000,
            securities: config.securities || 100,
            brokers: config.brokers || 10,
            tradeDays: config.tradeDays || 300,
            volatility: config.volatility || 0.02,
        };

        // Initialize prices
        for (let i = 1; i <= this.config.securities; i++) {
            this.currentPrices.set(i, 10 + Math.random() * 90); // $10-$100
        }
    }

    /**
     * Select transaction type based on TPC-E mix
     */
    selectTransactionType(): keyof typeof ENERGY_DEX_MIX {
        const rand = Math.random();
        let cumulative = 0;

        for (const [type, probability] of Object.entries(ENERGY_DEX_MIX)) {
            cumulative += probability;
            if (rand < cumulative) {
                return type as keyof typeof ENERGY_DEX_MIX;
            }
        }
        return 'SUBMIT_ORDER';
    }

    /**
     * Simulate price movement (random walk with volatility)
     */
    private updatePrice(securityId: number): number {
        const currentPrice = this.currentPrices.get(securityId) || 50;
        const change = (Math.random() - 0.5) * 2 * this.config.volatility * currentPrice;
        const newPrice = Math.max(1, currentPrice + change);
        this.currentPrices.set(securityId, newPrice);
        return newPrice;
    }

    /**
     * Generate a TPC-E transaction
     */
    generateTransaction(): TPCETransaction {
        const type = this.selectTransactionType();
        const customerId = Math.floor(Math.random() * this.config.customers) + 1;
        const securityId = Math.floor(Math.random() * this.config.securities) + 1;

        const tx: TPCETransaction = {
            type,
            customerId,
            securityId,
            timestamp: Date.now(),
        };

        switch (type) {
            case 'SUBMIT_ORDER':
                tx.tradeType = Math.random() > 0.5 ? 'BUY' : 'SELL';
                tx.quantity = Math.floor(Math.random() * 1000) + 100;
                tx.price = this.currentPrices.get(securityId) || 50;
                break;

            case 'EXECUTE_TRADE':
                tx.orderId = Math.floor(Math.random() * 100000) + 1;
                tx.quantity = Math.floor(Math.random() * 500) + 50;
                tx.price = this.currentPrices.get(securityId) || 50;
                break;

            case 'UPDATE_ORACLE':
                tx.price = this.updatePrice(securityId);
                break;

            case 'GET_BALANCE':
            case 'GET_VOLUME':
            case 'GET_ASSET_INFO':
                // Read-only operations
                break;
        }

        return tx;
    }

    /**
     * Simulate transaction execution
     */
    async executeTransaction(tx: TPCETransaction): Promise<TPCEResult> {
        const start = Date.now();
        let success = true;
        let isRead = false;
        let tradeValue = 0;

        // Simulate execution with latency based on operation type
        let baseLatency: number;
        switch (tx.type) {
            case 'SUBMIT_ORDER':
                baseLatency = 4 + Math.random() * 6; // 4-10ms
                tradeValue = (tx.quantity || 0) * (tx.price || 0);
                break;
            case 'EXECUTE_TRADE':
                baseLatency = 6 + Math.random() * 8; // 6-14ms (most complex)
                tradeValue = (tx.quantity || 0) * (tx.price || 0);
                // ~3% failure rate for order matching
                success = Math.random() > 0.03;
                break;
            case 'UPDATE_ORACLE':
                baseLatency = 3 + Math.random() * 4; // 3-7ms
                break;
            case 'GET_BALANCE':
            case 'GET_VOLUME':
            case 'GET_ASSET_INFO':
                baseLatency = 1 + Math.random() * 3; // 1-4ms (reads are fast)
                isRead = true;
                break;
            default:
                baseLatency = 3 + Math.random() * 5;
        }

        // Consensus overhead for writes
        const consensusOverhead = isRead ? 0 : (2 + Math.random() * 2);
        await new Promise(resolve => setTimeout(resolve, baseLatency + consensusOverhead));

        const result: TPCEResult = {
            transactionType: tx.type,
            success,
            latencyMs: Date.now() - start,
            timestamp: Date.now(),
            isRead,
            tradeValue: success ? tradeValue : 0,
        };

        this.results.push(result);
        return result;
    }

    /**
     * Run TPC-E workload
     */
    async run(options: {
        durationMs?: number;
        concurrency?: number;
    } = {}): Promise<TPCEMetrics> {
        const { durationMs = 30000, concurrency = 10 } = options;

        console.log('\n╔════════════════════════════════════════════════════════════╗');
        console.log('║     TPC-E Style Benchmark for GridTokenX                   ║');
        console.log('║     Energy DEX / DeFi Trading Simulation                   ║');
        console.log('╚════════════════════════════════════════════════════════════╝\n');

        console.log(`Configuration:`);
        console.log(`  Customers: ${this.config.customers}`);
        console.log(`  Securities: ${this.config.securities}`);
        console.log(`  Volatility: ${(this.config.volatility * 100).toFixed(1)}%`);
        console.log(`  Concurrency: ${concurrency}`);
        console.log(`  Duration: ${durationMs}ms\n`);

        this.results = [];
        this.startTime = Date.now();
        const endTime = this.startTime + durationMs;
        let completed = 0;

        console.log('🚀 Running TPC-E workload...\n');

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
     * Calculate TPC-E metrics
     */
    calculateMetrics(): TPCEMetrics {
        const successful = this.results.filter(r => r.success);
        const reads = successful.filter(r => r.isRead);
        const writes = successful.filter(r => !r.isRead);

        const latencies = successful.map(r => r.latencyMs).sort((a, b) => a - b);
        const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;

        const percentile = (arr: number[], p: number) => {
            if (arr.length === 0) return 0;
            const index = Math.ceil(arr.length * p) - 1;
            return arr[Math.max(0, index)];
        };

        const durationSeconds = (Date.now() - this.startTime) / 1000;

        // tpsE = Trade Result transactions per second (TPC-E primary metric)
        const tradeResults = successful.filter(r => r.transactionType === 'EXECUTE_TRADE');
        const tpsE = tradeResults.length / durationSeconds;

        const tradeOrders = successful.filter(r => r.transactionType === 'SUBMIT_ORDER');
        const tradeOrdersPerSec = tradeOrders.length / durationSeconds;

        const totalTradeValue = successful.reduce((sum, r) => sum + (r.tradeValue || 0), 0);

        const mixCounts: Record<string, number> = {};
        for (const r of successful) {
            mixCounts[r.transactionType] = (mixCounts[r.transactionType] || 0) + 1;
        }

        const metrics: TPCEMetrics = {
            tpsE: Math.round(tpsE * 100) / 100,
            tradeOrdersPerSec: Math.round(tradeOrdersPerSec * 100) / 100,
            avgLatencyMs: Math.round(avgLatency * 100) / 100,
            readWriteRatio: reads.length / (writes.length || 1),
            latencyPercentiles: {
                p50: percentile(latencies, 0.50),
                p95: percentile(latencies, 0.95),
                p99: percentile(latencies, 0.99),
            },
            transactionMix: mixCounts,
            totalTradeValue: Math.round(totalTradeValue),
        };

        this.printMetrics(metrics);
        return metrics;
    }

    private printMetrics(metrics: TPCEMetrics): void {
        console.log('════════════════════════════════════════════════════════════');
        console.log('  TPC-E BENCHMARK RESULTS');
        console.log('════════════════════════════════════════════════════════════\n');

        console.log('📊 Primary Metrics:');
        console.log(`   tpsE (Trade Executions/sec): ${metrics.tpsE.toFixed(2)}`);
        console.log(`   Trade Orders/sec: ${metrics.tradeOrdersPerSec.toFixed(2)}`);
        console.log(`   Total Trade Value: $${metrics.totalTradeValue.toLocaleString()}\n`);

        console.log('📈 Performance:');
        console.log(`   Avg Latency: ${metrics.avgLatencyMs.toFixed(2)}ms`);
        console.log(`   p50: ${metrics.latencyPercentiles.p50}ms`);
        console.log(`   p95: ${metrics.latencyPercentiles.p95}ms`);
        console.log(`   p99: ${metrics.latencyPercentiles.p99}ms\n`);

        console.log('📋 Read/Write Analysis:');
        console.log(`   Read/Write Ratio: ${metrics.readWriteRatio.toFixed(2)}`);
        console.log('   (Higher ratio = more read-heavy, typical for DeFi)\n');

        console.log('📋 Transaction Mix:');
        const totalTx = Object.values(metrics.transactionMix).reduce((a, b) => a + b, 0);
        for (const [type, count] of Object.entries(metrics.transactionMix)) {
            const pct = ((count / totalTx) * 100).toFixed(1);
            console.log(`   ${type}: ${count} (${pct}%)`);
        }
        console.log('');
    }
}

// CLI execution
const isMainModule = import.meta.url === `file://${process.argv[1]}` ||
    process.argv[1]?.endsWith('tpc-e-workload.ts');

if (isMainModule) {
    const workload = new TPCEWorkload({
        customers: 1000,
        securities: 50,
    });

    workload.run({
        durationMs: 30000,
        concurrency: 10,
    }).then(metrics => {
        console.log('\n✅ TPC-E Benchmark Complete');
        console.log(JSON.stringify(metrics, null, 2));
    }).catch(console.error);
}
