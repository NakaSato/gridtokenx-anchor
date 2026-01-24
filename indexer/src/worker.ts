/**
 * GridTokenX Indexer - Worker Thread
 * 
 * Each worker handles a single program's transaction processing.
 * Runs in its own thread for parallel execution.
 */

import { parentPort, workerData, threadId } from 'worker_threads';
import { Connection, PublicKey, Commitment } from '@solana/web3.js';
import Redis from 'ioredis';
import pino from 'pino';

import { createDatabaseClient, DatabaseClient } from './database/client';
import { RegistryHandler } from './handlers/registry';
import { TradingHandler } from './handlers/trading';
import { OracleHandler } from './handlers/oracle';
import { GovernanceHandler } from './handlers/governance';
import { EnergyTokenHandler } from './handlers/energy-token';

// Worker data passed from main thread
interface WorkerData {
    programName: string;
    programId: string;
    config: {
        rpcUrl: string;
        wsUrl: string;
        databaseUrl: string;
        redisUrl: string;
    };
}

// Message types to send back to main thread
interface WorkerMessage {
    type: 'ready' | 'processed' | 'error' | 'stats';
    program?: string;
    signature?: string;
    slot?: number;
    error?: string;
    stats?: {
        processed: number;
        errors: number;
        uptime: number;
    };
}

function sendMessage(msg: WorkerMessage) {
    parentPort?.postMessage(msg);
}

class ProgramWorker {
    private programName: string;
    private programId: PublicKey;
    private connection: Connection;
    private db: DatabaseClient = null as any;
    private redis: Redis;
    private handler: any;
    private logger: pino.Logger;
    private subscriptionId: number = 0;
    private stats = {
        processed: 0,
        errors: 0,
        startTime: Date.now(),
    };

    constructor(data: WorkerData) {
        this.programName = data.programName;
        this.programId = new PublicKey(data.programId);

        this.connection = new Connection(data.config.rpcUrl, {
            commitment: 'confirmed' as Commitment,
            wsEndpoint: data.config.wsUrl,
        });

        this.redis = new Redis(data.config.redisUrl);

        this.logger = pino({
            level: process.env.LOG_LEVEL || 'info',
            transport: process.env.NODE_ENV === 'development'
                ? { target: 'pino-pretty' }
                : undefined,
        }).child({
            worker: this.programName,
            threadId,
        });
    }

    async start() {
        this.logger.info('Worker starting...');

        // Initialize database connection
        this.db = await createDatabaseClient(workerData.config.databaseUrl);
        this.logger.info('Database connected');

        // Initialize handler based on program
        this.handler = this.createHandler();
        this.logger.info('Handler initialized');

        // Backfill historical data
        await this.backfill();

        // Subscribe to program logs
        await this.subscribe();

        // Start stats reporter
        this.startStatsReporter();

        // Signal ready to main thread
        sendMessage({ type: 'ready', program: this.programName });
        this.logger.info('Worker ready');
    }

    private createHandler() {
        const handlerLogger = this.logger.child({ component: 'handler' });

        switch (this.programName) {
            case 'registry':
                return new RegistryHandler(this.db, handlerLogger);
            case 'trading':
                return new TradingHandler(this.db, handlerLogger);
            case 'oracle':
                return new OracleHandler(this.db, handlerLogger);
            case 'governance':
                return new GovernanceHandler(this.db, handlerLogger);
            case 'energy_token':
                return new EnergyTokenHandler(this.db, handlerLogger);
            default:
                throw new Error(`Unknown program: ${this.programName}`);
        }
    }

    private async backfill() {
        this.logger.info('Starting backfill...');

        try {
            const state = await this.db.getIndexerState(this.programId.toBase58());
            const lastSlot = state?.last_processed_slot || 0;

            this.logger.info({ lastSlot }, 'Backfilling from slot');

            // Get signatures since last processed
            let signatures = await this.connection.getSignaturesForAddress(
                this.programId,
                { limit: 1000 },
                'confirmed'
            );

            // Filter to only new signatures
            signatures = signatures.filter(sig => sig.slot > lastSlot);

            if (signatures.length > 0) {
                this.logger.info({ count: signatures.length }, 'Processing historical transactions');

                // Process in reverse order (oldest first)
                for (const sig of signatures.reverse()) {
                    await this.processTransaction(sig.signature);
                }
            }

            this.logger.info('Backfill complete');
        } catch (error) {
            this.logger.error({ error }, 'Backfill error');
        }
    }

    private async subscribe() {
        this.subscriptionId = this.connection.onLogs(
            this.programId,
            async (logs, ctx) => {
                if (logs.err) {
                    this.logger.warn({ signature: logs.signature, error: logs.err }, 'Transaction error');
                    return;
                }

                await this.processTransaction(logs.signature);
            },
            'confirmed'
        );

        this.logger.info({ subscriptionId: this.subscriptionId }, 'Subscribed to program logs');
    }

    private async processTransaction(signature: string) {
        try {
            // Check cache to avoid duplicate processing
            const cacheKey = `tx:${this.programName}:${signature}`;
            const cached = await this.redis.get(cacheKey);
            if (cached) {
                return;
            }

            const tx = await this.connection.getTransaction(signature, {
                commitment: 'confirmed',
                maxSupportedTransactionVersion: 0,
            });

            if (!tx) {
                this.logger.warn({ signature }, 'Transaction not found');
                return;
            }

            // Process with handler
            await this.handler.processTransaction(tx, signature);

            // Update indexer state
            await this.db.updateIndexerState(
                this.programId.toBase58(),
                tx.slot,
                signature
            );

            // Cache to prevent reprocessing
            await this.redis.setex(cacheKey, 3600, '1');

            this.stats.processed++;

            sendMessage({
                type: 'processed',
                program: this.programName,
                signature,
                slot: tx.slot,
            });

        } catch (error: any) {
            this.stats.errors++;

            this.logger.error({ signature, error: error.message }, 'Error processing transaction');
            await this.db.logIndexerError(signature, this.programId.toBase58(), error);

            sendMessage({
                type: 'error',
                program: this.programName,
                signature,
                error: error.message,
            });
        }
    }

    private startStatsReporter() {
        setInterval(() => {
            sendMessage({
                type: 'stats',
                program: this.programName,
                stats: {
                    processed: this.stats.processed,
                    errors: this.stats.errors,
                    uptime: (Date.now() - this.stats.startTime) / 1000,
                },
            });
        }, 10000); // Every 10 seconds
    }

    async stop() {
        this.logger.info('Worker stopping...');

        if (this.subscriptionId) {
            await this.connection.removeOnLogsListener(this.subscriptionId);
        }

        await this.redis.quit();
        await this.db.close();

        this.logger.info('Worker stopped');
    }
}

// Worker entry point
async function main() {
    const data = workerData as WorkerData;
    const worker = new ProgramWorker(data);

    // Handle termination
    parentPort?.on('close', async () => {
        await worker.stop();
    });

    await worker.start();
}

main().catch((error) => {
    console.error(`Worker ${workerData?.programName} fatal error:`, error);
    process.exit(1);
});
