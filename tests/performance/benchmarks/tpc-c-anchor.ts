#!/usr/bin/env node

/**
 * TPC-C Style Workload for GridTokenX Blockchain
 * 
 * Uses REAL Anchor program transactions for benchmarking.
 * Adapts TPC-C OLTP benchmark to energy trading operations.
 * 
 * TPC-C Transaction Mapping:
 * - New Order (45%) → trading.createBuyOrder()
 * - Payment (43%)   → energyToken.mintToWallet()
 * - Order Status (4%) → Account fetch
 * - Delivery (4%)   → trade execution
 * - Stock Level (4%) → Balance check
 * 
 * Reference: TPC-C Specification v5.11
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";

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
    warehouses: number;
    districtsPerWarehouse: number;
    customersPerDistrict: number;
    itemCount: number;
    warmupPercent: number;
    useRealPrograms: boolean;
}

export interface TPCTransaction {
    type: keyof typeof ENERGY_TRADING_MIX;
    warehouseId: number;
    districtId: number;
    customerId?: number;
    orderId?: string;
    amount?: number;
    timestamp: number;
}

export interface TPCResult {
    transactionType: string;
    success: boolean;
    latencyMs: number;
    timestamp: number;
    mvccConflict: boolean;
    retryCount: number;
    signature?: string;
}

export interface TPCMetrics {
    tpmC: number;
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
}

/**
 * Non-Uniform Random Number Generator (TPC-C Spec)
 */
function NURand(A: number, x: number, y: number, C: number = 0): number {
    const random = (min: number, max: number) =>
        Math.floor(Math.random() * (max - min + 1)) + min;
    return (((random(0, A) | random(x, y)) + C) % (y - x + 1)) + x;
}

function generateCustomerId(customersPerDistrict: number): number {
    return NURand(1023, 1, customersPerDistrict);
}

export class TPCCWorkloadReal {
    private config: TPCConfig;
    private results: TPCResult[] = [];
    private startTime: number = 0;

    // Anchor environment
    private provider: anchor.AnchorProvider | null = null;
    private energyTokenProgram: Program<any> | null = null;
    private tradingProgram: Program<any> | null = null;
    private authority: anchor.web3.Keypair | null = null;
    private mintPda: anchor.web3.PublicKey | null = null;
    private tokenInfoPda: anchor.web3.PublicKey | null = null;
    private traders: anchor.web3.Keypair[] = [];

    constructor(config: Partial<TPCConfig> = {}) {
        this.config = {
            warehouses: config.warehouses || 1,
            districtsPerWarehouse: config.districtsPerWarehouse || 10,
            customersPerDistrict: config.customersPerDistrict || 3000,
            itemCount: config.itemCount || 100000,
            warmupPercent: config.warmupPercent || 10,
            useRealPrograms: config.useRealPrograms ?? true,
        };
    }

    /**
     * Initialize Anchor programs
     */
    async initialize(): Promise<void> {
        if (!this.config.useRealPrograms) return;

        try {
            this.provider = anchor.AnchorProvider.env();
            anchor.setProvider(this.provider);

            // Load programs from workspace
            this.energyTokenProgram = anchor.workspace.EnergyToken;
            this.tradingProgram = anchor.workspace.Trading;

            // Load authority keypair
            const fs = await import('fs');
            const walletPath = "./keypairs/dev-wallet.json";
            const walletData = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
            this.authority = anchor.web3.Keypair.fromSecretKey(new Uint8Array(walletData));

            // Get PDAs
            [this.tokenInfoPda] = anchor.web3.PublicKey.findProgramAddressSync(
                [Buffer.from("token_info")],
                this.energyTokenProgram.programId
            );
            [this.mintPda] = anchor.web3.PublicKey.findProgramAddressSync(
                [Buffer.from("mint")],
                this.energyTokenProgram.programId
            );

            // Pre-generate trader keypairs
            for (let i = 0; i < 10; i++) {
                const trader = anchor.web3.Keypair.generate();
                // Airdrop SOL
                const sig = await this.provider.connection.requestAirdrop(
                    trader.publicKey,
                    2 * anchor.web3.LAMPORTS_PER_SOL
                );
                await this.provider.connection.confirmTransaction(sig);
                this.traders.push(trader);
            }

            console.log('  ✅ Anchor programs initialized');
        } catch (error: any) {
            console.log(`  ⚠️  Using simulation mode: ${error.message}`);
            this.config.useRealPrograms = false;
        }
    }

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

    generateTransaction(): TPCTransaction {
        const type = this.selectTransactionType();
        const warehouseId = Math.floor(Math.random() * this.config.warehouses) + 1;
        const districtId = Math.floor(Math.random() * this.config.districtsPerWarehouse) + 1;

        return {
            type,
            warehouseId,
            districtId,
            customerId: generateCustomerId(this.config.customersPerDistrict),
            orderId: `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            amount: Math.random() * 1000 + 100,
            timestamp: Date.now(),
        };
    }

    /**
     * Execute real Anchor transaction
     */
    async executeRealTransaction(tx: TPCTransaction): Promise<TPCResult> {
        const start = Date.now();
        let success = true;
        let mvccConflict = false;
        let retryCount = 0;
        let signature: string | undefined;

        try {
            const trader = this.traders[Math.floor(Math.random() * this.traders.length)];

            switch (tx.type) {
                case 'CREATE_ORDER':
                    // Create buy order via trading program
                    const [marketPda] = anchor.web3.PublicKey.findProgramAddressSync(
                        [Buffer.from("market"), Buffer.from("ENERGY")],
                        this.tradingProgram!.programId
                    );
                    const [orderPda] = anchor.web3.PublicKey.findProgramAddressSync(
                        [Buffer.from("order"), trader.publicKey.toBuffer(), Buffer.from(tx.orderId!)],
                        this.tradingProgram!.programId
                    );

                    signature = await this.tradingProgram!.methods
                        .createBuyOrder(new BN(tx.amount! * 1e9), new BN(10))
                        .accounts({
                            market: marketPda,
                            order: orderPda,
                            authority: trader.publicKey,
                            systemProgram: anchor.web3.SystemProgram.programId,
                        })
                        .signers([trader])
                        .rpc();
                    break;

                case 'TOKEN_TRANSFER':
                    // Mint tokens via energy token program
                    const destinationOwner = this.traders[Math.floor(Math.random() * this.traders.length)];
                    const destination = await anchor.utils.token.associatedAddress({
                        mint: this.mintPda!,
                        owner: destinationOwner.publicKey,
                    });

                    signature = await this.energyTokenProgram!.methods
                        .mintToWallet(new BN(tx.amount! * 1e6))
                        .accounts({
                            mint: this.mintPda!,
                            destination,
                            destinationOwner: destinationOwner.publicKey,
                            authority: this.authority!.publicKey,
                            payer: this.provider!.wallet.publicKey,
                            tokenProgram: TOKEN_2022_PROGRAM_ID,
                            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                            systemProgram: anchor.web3.SystemProgram.programId,
                        })
                        .signers([this.authority!])
                        .rpc();
                    break;

                case 'GET_ORDER_STATUS':
                case 'CHECK_BALANCE':
                    // Read operations - fetch account
                    await this.provider!.connection.getBalance(trader.publicKey);
                    break;

                case 'EXECUTE_TRADE':
                    // Placeholder for order matching
                    await new Promise(r => setTimeout(r, 5));
                    break;
            }
        } catch (error: any) {
            success = false;
            if (error.message?.includes('already in use') || error.logs?.some((l: string) => l.includes('constraint'))) {
                mvccConflict = true;
                retryCount = 1;
            }
        }

        return {
            transactionType: tx.type,
            success,
            latencyMs: Date.now() - start,
            timestamp: Date.now(),
            mvccConflict,
            retryCount,
            signature,
        };
    }

    /**
     * Execute simulated transaction (fallback)
     */
    async executeSimulatedTransaction(tx: TPCTransaction): Promise<TPCResult> {
        const start = Date.now();
        let success = true;
        let mvccConflict = false;

        let baseLatency: number;
        switch (tx.type) {
            case 'CREATE_ORDER':
                baseLatency = 5 + Math.random() * 10;
                mvccConflict = Math.random() < 0.02;
                break;
            case 'TOKEN_TRANSFER':
                baseLatency = 3 + Math.random() * 7;
                mvccConflict = Math.random() < 0.01;
                break;
            case 'EXECUTE_TRADE':
                baseLatency = 8 + Math.random() * 12;
                mvccConflict = Math.random() < 0.03;
                break;
            default:
                baseLatency = 1 + Math.random() * 5;
        }

        const consensusOverhead = 2 + Math.random() * 3;
        await new Promise(resolve => setTimeout(resolve, baseLatency + consensusOverhead));

        if (mvccConflict) {
            success = Math.random() > 0.1;
        }

        return {
            transactionType: tx.type,
            success,
            latencyMs: Date.now() - start,
            timestamp: Date.now(),
            mvccConflict,
            retryCount: mvccConflict ? 1 : 0,
        };
    }

    async executeTransaction(tx: TPCTransaction): Promise<TPCResult> {
        const result = this.config.useRealPrograms
            ? await this.executeRealTransaction(tx)
            : await this.executeSimulatedTransaction(tx);

        this.results.push(result);
        return result;
    }

    async run(options: {
        durationMs?: number;
        concurrency?: number;
    } = {}): Promise<TPCMetrics> {
        const { durationMs = 30000, concurrency = 10 } = options;

        console.log('\n╔════════════════════════════════════════════════════════════╗');
        console.log('║     TPC-C Benchmark for GridTokenX (Anchor Programs)       ║');
        console.log('║     Energy Trading Blockchain - PoA Consensus              ║');
        console.log('╚════════════════════════════════════════════════════════════╝\n');

        console.log(`Configuration:`);
        console.log(`  Mode: ${this.config.useRealPrograms ? 'Real Anchor Programs' : 'Simulation'}`);
        console.log(`  Warehouses: ${this.config.warehouses}`);
        console.log(`  Concurrency: ${concurrency}`);
        console.log(`  Duration: ${durationMs}ms`);
        console.log(`  Warmup: ${this.config.warmupPercent}%\n`);

        // Initialize programs if needed
        await this.initialize();

        this.results = [];
        this.startTime = Date.now();
        const endTime = this.startTime + durationMs;
        let completed = 0;

        console.log('🚀 Running TPC-C workload...\n');

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

    calculateMetrics(): TPCMetrics {
        const warmupCount = Math.floor(this.results.length * (this.config.warmupPercent / 100));
        const steadyStateResults = this.results.slice(warmupCount);

        const successful = steadyStateResults.filter(r => r.success);
        const failed = steadyStateResults.filter(r => !r.success);
        const conflicts = steadyStateResults.filter(r => r.mvccConflict);

        const latencies = successful.map(r => r.latencyMs).sort((a, b) => a - b);
        const mean = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
        const stdDev = Math.sqrt(
            latencies.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / (latencies.length || 1)
        );
        const filteredLatencies = latencies.filter(l => Math.abs(l - mean) <= 3 * stdDev);

        const percentile = (arr: number[], p: number) => {
            if (arr.length === 0) return 0;
            const index = Math.ceil(arr.length * p) - 1;
            return arr[Math.max(0, index)];
        };

        const durationMinutes = (Date.now() - this.startTime) / 60000;
        const newOrderCount = successful.filter(r => r.transactionType === 'CREATE_ORDER').length;
        const tpmC = newOrderCount / durationMinutes;

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

        console.log('⏱️  Latency:');
        console.log(`   Average: ${metrics.avgLatencyMs.toFixed(2)}ms`);
        console.log(`   p50: ${metrics.latencyPercentiles.p50.toFixed(2)}ms`);
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
    process.argv[1]?.endsWith('tpc-c-anchor.ts');

if (isMainModule) {
    const workload = new TPCCWorkloadReal({
        warehouses: 1,
        districtsPerWarehouse: 10,
        useRealPrograms: true,
    });

    workload.run({
        durationMs: 30000,
        concurrency: 5,
    }).then(metrics => {
        console.log('\n✅ TPC-C Benchmark Complete');
        console.log(JSON.stringify(metrics, null, 2));
    }).catch(console.error);
}

export { TPCCWorkloadReal as TPCCWorkload };
