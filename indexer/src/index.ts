/**
 * GridTokenX Indexer - Multi-threaded Main Entry Point
 * 
 * Uses Node.js Worker Threads for parallel transaction processing.
 * Each program handler runs in its own dedicated worker thread.
 */

import { Worker } from 'worker_threads';
import { Connection, PublicKey } from '@solana/web3.js';
import { Pool } from 'pg';
import Redis from 'ioredis';
import express from 'express';
import pino from 'pino';
import path from 'path';
import os from 'os';
import 'dotenv/config';

import { createDatabaseClient, DatabaseClient } from './database/client';
import { createGraphQLServer } from './api/graphql';
import { createRestRoutes } from './api/routes';

// Logger
const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV === 'development'
        ? { target: 'pino-pretty' }
        : undefined,
});

// Program configuration
const PROGRAMS = [
    { name: 'registry', id: 'EgpmmYPFDAX8QfawUEFissBXi3yG6AapoxNfB6KdGtBQ' },
    { name: 'energy_token', id: 'G8dC1NwdDiMhfrnPwkf9dMaR2AgrnFXcjWcepyGSHTfA' },
    { name: 'oracle', id: '4Agkm8isGD6xDegsfoFzWN5Xp5WLVoqJyPDQLRsjh85u' },
    { name: 'trading', id: 'CrfC5coUm2ty6DphLBFhAmr8m1AMutf8KTW2JYS38Z5J' },
    { name: 'governance', id: '3d1BQT3EiwbspkD8HYKAnyLvKjs5kZwSbRBWwS5NHof9' },
];

interface IndexerConfig {
    rpcUrl: string;
    wsUrl: string;
    databaseUrl: string;
    redisUrl: string;
    apiPort: number;
    workerCount: number;
}

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

function loadConfig(): IndexerConfig {
    return {
        rpcUrl: process.env.SOLANA_RPC_URL || 'http://127.0.0.1:8899',
        wsUrl: process.env.SOLANA_WS_URL || 'ws://127.0.0.1:8900',
        databaseUrl: process.env.DATABASE_URL || 'postgresql://localhost:5432/gridtokenx',
        redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
        apiPort: parseInt(process.env.API_PORT || '4000'),
        workerCount: parseInt(process.env.WORKER_COUNT || String(Math.min(PROGRAMS.length, os.cpus().length))),
    };
}

class MultiThreadedIndexer {
    private config: IndexerConfig;
    private workers: Map<string, Worker> = new Map();
    private db: DatabaseClient = null as any;
    private redis: Redis;
    private isRunning = false;
    private stats: Map<string, { processed: number; errors: number; lastActivity: Date }> = new Map();

    constructor(config: IndexerConfig) {
        this.config = config;
        this.redis = new Redis(config.redisUrl);
    }

    async start() {
        logger.info({
            cpus: os.cpus().length,
            workerCount: this.config.workerCount,
            programs: PROGRAMS.length,
        }, 'Starting Multi-threaded GridTokenX Indexer');

        // Initialize database connection for API server
        this.db = await createDatabaseClient(this.config.databaseUrl);
        logger.info('Main thread database connected');

        // Spawn worker threads
        await this.spawnWorkers();

        // Start API server on main thread
        await this.startApiServer();

        // Start health monitoring
        this.startHealthMonitor();

        this.isRunning = true;
        logger.info('Multi-threaded indexer started successfully');
    }

    private async spawnWorkers() {
        const workerPath = path.join(__dirname, 'worker.js');

        for (const program of PROGRAMS) {
            const worker = new Worker(workerPath, {
                workerData: {
                    programName: program.name,
                    programId: program.id,
                    config: {
                        rpcUrl: this.config.rpcUrl,
                        wsUrl: this.config.wsUrl,
                        databaseUrl: this.config.databaseUrl,
                        redisUrl: this.config.redisUrl,
                    },
                },
            });

            // Initialize stats
            this.stats.set(program.name, { processed: 0, errors: 0, lastActivity: new Date() });

            // Handle messages from worker
            worker.on('message', (msg: WorkerMessage) => this.handleWorkerMessage(program.name, msg));

            // Handle worker errors
            worker.on('error', (error) => {
                logger.error({ program: program.name, error }, 'Worker error');
                this.restartWorker(program);
            });

            // Handle worker exit
            worker.on('exit', (code) => {
                if (code !== 0) {
                    logger.warn({ program: program.name, exitCode: code }, 'Worker exited unexpectedly');
                    if (this.isRunning) {
                        this.restartWorker(program);
                    }
                }
            });

            this.workers.set(program.name, worker);
            logger.info({ program: program.name, threadId: worker.threadId }, 'Worker spawned');
        }
    }

    private handleWorkerMessage(programName: string, msg: WorkerMessage) {
        const stats = this.stats.get(programName);
        if (!stats) return;

        switch (msg.type) {
            case 'ready':
                logger.info({ program: programName }, 'Worker ready');
                break;

            case 'processed':
                stats.processed++;
                stats.lastActivity = new Date();
                logger.debug({
                    program: programName,
                    signature: msg.signature,
                    slot: msg.slot
                }, 'Transaction processed');
                break;

            case 'error':
                stats.errors++;
                stats.lastActivity = new Date();
                logger.error({
                    program: programName,
                    signature: msg.signature,
                    error: msg.error
                }, 'Worker processing error');
                break;

            case 'stats':
                if (msg.stats) {
                    stats.processed = msg.stats.processed;
                    stats.errors = msg.stats.errors;
                }
                break;
        }
    }

    private async restartWorker(program: { name: string; id: string }) {
        logger.info({ program: program.name }, 'Restarting worker...');

        // Remove old worker
        const oldWorker = this.workers.get(program.name);
        if (oldWorker) {
            try {
                await oldWorker.terminate();
            } catch (e) {
                // Worker already terminated
            }
            this.workers.delete(program.name);
        }

        // Wait before restart
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Spawn new worker
        const workerPath = path.join(__dirname, 'worker.js');
        const worker = new Worker(workerPath, {
            workerData: {
                programName: program.name,
                programId: program.id,
                config: {
                    rpcUrl: this.config.rpcUrl,
                    wsUrl: this.config.wsUrl,
                    databaseUrl: this.config.databaseUrl,
                    redisUrl: this.config.redisUrl,
                },
            },
        });

        worker.on('message', (msg: WorkerMessage) => this.handleWorkerMessage(program.name, msg));
        worker.on('error', (error) => {
            logger.error({ program: program.name, error }, 'Worker error');
            this.restartWorker(program);
        });
        worker.on('exit', (code) => {
            if (code !== 0 && this.isRunning) {
                this.restartWorker(program);
            }
        });

        this.workers.set(program.name, worker);
        logger.info({ program: program.name, threadId: worker.threadId }, 'Worker restarted');
    }

    private startHealthMonitor() {
        setInterval(() => {
            const healthStatus: Record<string, any> = {};

            for (const [programName, stats] of this.stats) {
                const worker = this.workers.get(programName);
                const timeSinceActivity = Date.now() - stats.lastActivity.getTime();

                healthStatus[programName] = {
                    threadId: worker?.threadId,
                    processed: stats.processed,
                    errors: stats.errors,
                    lastActivity: stats.lastActivity.toISOString(),
                    healthy: timeSinceActivity < 60000, // Healthy if active in last minute
                };
            }

            logger.info({ workers: healthStatus }, 'Worker health check');
        }, 30000); // Every 30 seconds
    }

    private async startApiServer() {
        const app = express();

        app.use(express.json());

        // Health check with worker status
        app.get('/health', (req, res) => {
            const workerStatus: Record<string, any> = {};

            for (const [programName, stats] of this.stats) {
                const worker = this.workers.get(programName);
                workerStatus[programName] = {
                    threadId: worker?.threadId,
                    processed: stats.processed,
                    errors: stats.errors,
                    healthy: Date.now() - stats.lastActivity.getTime() < 60000,
                };
            }

            res.json({
                status: 'ok',
                mode: 'multi-threaded',
                uptime: process.uptime(),
                cpus: os.cpus().length,
                workerCount: this.workers.size,
                workers: workerStatus,
                memory: process.memoryUsage(),
            });
        });

        // Worker stats endpoint
        app.get('/stats', (req, res) => {
            const allStats = {
                totalProcessed: 0,
                totalErrors: 0,
                workers: {} as Record<string, any>,
            };

            for (const [programName, stats] of this.stats) {
                allStats.totalProcessed += stats.processed;
                allStats.totalErrors += stats.errors;
                allStats.workers[programName] = stats;
            }

            res.json(allStats);
        });

        // Restart worker endpoint
        app.post('/workers/:program/restart', async (req, res) => {
            const program = PROGRAMS.find(p => p.name === req.params.program);
            if (!program) {
                return res.status(404).json({ error: 'Program not found' });
            }

            await this.restartWorker(program);
            res.json({ status: 'restarting', program: program.name });
        });

        // REST API routes
        app.use('/api', createRestRoutes(this.db));

        // GraphQL endpoint
        const graphqlServer = createGraphQLServer(this.db);
        app.use('/graphql', graphqlServer);

        app.listen(this.config.apiPort, () => {
            logger.info({ port: this.config.apiPort }, 'API server started (main thread)');
        });
    }

    async stop() {
        logger.info('Stopping multi-threaded indexer...');
        this.isRunning = false;

        // Terminate all workers
        const terminationPromises = Array.from(this.workers.values()).map(worker =>
            worker.terminate()
        );

        await Promise.all(terminationPromises);

        // Close connections
        await this.redis.quit();
        await this.db.close();

        logger.info('Multi-threaded indexer stopped');
    }
}

// Main
async function main() {
    const config = loadConfig();
    const indexer = new MultiThreadedIndexer(config);

    // Graceful shutdown
    process.on('SIGINT', async () => {
        await indexer.stop();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        await indexer.stop();
        process.exit(0);
    });

    await indexer.start();
}

main().catch((error) => {
    logger.error({ error }, 'Fatal error');
    process.exit(1);
});
