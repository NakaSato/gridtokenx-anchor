/**
 * BLOCKBENCH Framework for Solana/Anchor
 * 
 * A comprehensive benchmarking framework based on the BLOCKBENCH methodology
 * for evaluating private blockchain systems.
 * 
 * Reference: "BLOCKBENCH: A Framework for Analyzing Private Blockchains" (SIGMOD 2017)
 * 
 * Layer Architecture:
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ APPLICATION LAYER - SDKs, APIs, Client Interfaces              │
 * ├─────────────────────────────────────────────────────────────────┤
 * │ EXECUTION LAYER - BPF/SBF VM, Smart Contracts (Programs)       │
 * ├─────────────────────────────────────────────────────────────────┤
 * │ DATA MODEL LAYER - Account Storage, Merkle Trees               │
 * ├─────────────────────────────────────────────────────────────────┤
 * │ CONSENSUS LAYER - Tower BFT, Turbine, Gulf Stream              │
 * └─────────────────────────────────────────────────────────────────┘
 */

import { LiteSVM, TransactionMetadata, FailedTransactionMetadata } from "litesvm";
import {
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram,
  TransactionInstruction,
  Connection,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// BLOCKBENCH CONFIGURATION TYPES
// ============================================================================

export interface BlockbenchConfig {
  // Benchmark identification
  name: string;
  description: string;
  workloadType: WorkloadType;

  // Execution parameters
  warmupIterations: number;
  testIterations: number;
  durationSeconds?: number;
  concurrency: number;

  // YCSB specific
  recordCount?: number;
  fieldCount?: number;
  fieldSize?: number;
  distribution?: DistributionType;
  zipfianConstant?: number;

  // Workload mix (for YCSB)
  readRatio?: number;
  updateRatio?: number;
  insertRatio?: number;
  scanRatio?: number;

  // Compute budget
  computeUnitLimit?: number;
  computeUnitPrice?: number;
}

export enum WorkloadType {
  // Micro-benchmarks
  DO_NOTHING = "do_nothing",
  CPU_HEAVY_SORT = "cpu_heavy_sort",
  CPU_HEAVY_LOOP = "cpu_heavy_loop",
  CPU_HEAVY_HASH = "cpu_heavy_hash",
  CPU_HEAVY_MATRIX = "cpu_heavy_matrix",
  IO_HEAVY_WRITE = "io_heavy_write",
  IO_HEAVY_READ = "io_heavy_read",
  IO_HEAVY_MIXED = "io_heavy_mixed",
  ANALYTICS = "analytics",

  // Macro-benchmarks
  YCSB_A = "ycsb_a", // 50% read, 50% update
  YCSB_B = "ycsb_b", // 95% read, 5% update
  YCSB_C = "ycsb_c", // 100% read
  YCSB_F = "ycsb_f", // 50% read, 50% read-modify-write
  SMALLBANK = "smallbank",
  TPC_C = "tpc_c",
}

export enum DistributionType {
  UNIFORM = "uniform",
  ZIPFIAN = "zipfian",
  LATEST = "latest",
  HOTSPOT = "hotspot",
}

// ============================================================================
// MEASUREMENT DATA STRUCTURES
// ============================================================================

export interface TransactionMeasurement {
  timestamp: number;
  latencyMs: number;
  success: boolean;
  computeUnits?: number;
  errorType?: string;
  operationType?: string;
  transactionSize?: number;
}

export interface ThroughputWindow {
  startTime: number;
  endTime: number;
  transactions: number;
  successful: number;
  failed: number;
  tps: number;
}

export interface LatencyPercentiles {
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  p999: number;
}

export interface BlockbenchResults {
  // Metadata
  testId: string;
  testName: string;
  timestamp: string;
  config: BlockbenchConfig;
  environment: string;

  // Primary metrics
  throughput: {
    avgTps: number;
    peakTps: number;
    minTps: number;
    sustainedTps: number;
    totalTransactions: number;
    successfulTransactions: number;
    failedTransactions: number;
  };

  latency: {
    avgMs: number;
    minMs: number;
    maxMs: number;
    stdDevMs: number;
    percentiles: LatencyPercentiles;
  };

  // Resource metrics
  resources: {
    avgComputeUnits: number;
    minComputeUnits: number;
    maxComputeUnits: number;
    totalComputeUnits: number;
  };

  // Detailed measurements
  measurements: TransactionMeasurement[];
  windows: ThroughputWindow[];

  // Error analysis
  errors: {
    total: number;
    byType: Record<string, number>;
  };

  // Duration
  durationSeconds: number;
}

// ============================================================================
// BLOCKBENCH ENGINE
// ============================================================================

export class BlockbenchEngine {
  private svm: LiteSVM;
  private authority: Keypair;
  private users: Keypair[] = [];
  private measurements: TransactionMeasurement[] = [];
  private windows: ThroughputWindow[] = [];
  private programsLoaded = false;
  private startTime: number = 0;
  private provider: anchor.AnchorProvider | null = null;
  private blockbenchProgram: Program<any> | null = null;
  private useRealPrograms: boolean = false;

  // Program IDs
  private readonly PROGRAM_IDS = {
    blockbench: new PublicKey("BLKbnchMrk1111111111111111111111111111111111"),
    energyToken: new PublicKey("54SAVMgGhjssp3iQ7zBK8kgUnEtqHJTNg3QRfzzDitHB"),
    governance: new PublicKey("GZP5QP6PMD2D8nNsLkhA39Lfr4er12JLMhQZJnhxyT5h"),
    oracle: new PublicKey("F7mEgt7zaAaKHfTNmCLeZCUutdKyZ2cxYg41ggjstBi6"),
    registry: new PublicKey("9XS8uUEVErcA8LABrJQAdohWMXTToBwhFN7Rvur6dC5"),
    trading: new PublicKey("2pZ8gqotjvKMAu96XzpGZ7QFcemZzj21ybtVTbaDP1zG"),
    tpcBenchmark: new PublicKey("HEqH8sdd7KRxhwQYVpJrbb7kzW3P22PYkber756zs5vS"),
  };

  constructor() {
    this.svm = new LiteSVM();
    this.authority = Keypair.generate();
  }

  async initialize(numUsers: number = 100, useReal: boolean = false): Promise<void> {
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("  BLOCKBENCH Framework for Solana - Initialization");
    console.log("═══════════════════════════════════════════════════════════════\n");

    this.useRealPrograms = useReal;

    if (this.useRealPrograms) {
      console.log("📡 Initializing in REAL CLUSTER mode...");
      this.provider = anchor.AnchorProvider.env();
      anchor.setProvider(this.provider);
      this.blockbenchProgram = anchor.workspace.Blockbench;
      this.authority = (this.provider.wallet as any).payer || Keypair.generate();
    } else {
      console.log("🛠️  Initializing in LiteSVM mode...");
      // Fund authority
      this.svm.airdrop(this.authority.publicKey, BigInt(10000 * LAMPORTS_PER_SOL));
    }

    // Create and fund users
    console.log(`Creating ${numUsers} test users...`);
    for (let i = 0; i < numUsers; i++) {
      const user = Keypair.generate();
      if (this.useRealPrograms) {
        // Funding from authority/faucet
        try {
          const sig = await this.provider!.connection.requestAirdrop(user.publicKey, 2 * LAMPORTS_PER_SOL);
          await this.provider!.connection.confirmTransaction(sig);
        } catch (e) {
          // Fallback to transfer if airdrop is restricted
          const tx = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: this.authority.publicKey,
              toPubkey: user.publicKey,
              lamports: 1 * LAMPORTS_PER_SOL,
            })
          );
          await this.provider!.sendAndConfirm(tx, [this.authority]);
        }
      } else {
        this.svm.airdrop(user.publicKey, BigInt(100 * LAMPORTS_PER_SOL));
      }
      this.users.push(user);
    }

    if (!this.useRealPrograms) {
      // Load programs for LiteSVM
      await this.loadPrograms();
    }

    console.log("✓ BLOCKBENCH environment initialized\n");
  }

  private async loadPrograms(): Promise<void> {
    if (this.programsLoaded) return;

    const deployPath = path.join(__dirname, "../../../target/deploy");

    const programs = [
      { id: this.PROGRAM_IDS.energyToken, file: "energy_token.so" },
      { id: this.PROGRAM_IDS.governance, file: "governance.so" },
      { id: this.PROGRAM_IDS.oracle, file: "oracle.so" },
      { id: this.PROGRAM_IDS.registry, file: "registry.so" },
      { id: this.PROGRAM_IDS.trading, file: "trading.so" },
      { id: this.PROGRAM_IDS.tpcBenchmark, file: "tpc_benchmark.so" },
      { id: this.PROGRAM_IDS.blockbench, file: "blockbench.so" },
    ];

    for (const program of programs) {
      const programPath = path.join(deployPath, program.file);
      if (fs.existsSync(programPath)) {
        try {
          this.svm.addProgramFromFile(program.id, programPath);
          console.log(`  ✓ Loaded ${program.file}`);
        } catch (e) {
          console.log(`  ⚠ Could not load ${program.file}`);
        }
      }
    }
    this.programsLoaded = true;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MICRO-BENCHMARK EXECUTION
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Execute DoNothing micro-benchmark (Consensus Layer)
   * Measures pure consensus overhead without execution or storage costs.
   */
  async runDoNothing(config: BlockbenchConfig): Promise<BlockbenchResults> {
    console.log("\n╔══════════════════════════════════════════════════════════════╗");
    console.log("║  MICRO-BENCHMARK: DoNothing (Consensus Layer Stress Test)    ║");
    console.log("╚══════════════════════════════════════════════════════════════╝\n");

    this.resetMeasurements();
    const iterations = config.testIterations;

    // Warmup
    console.log(`Warmup: ${config.warmupIterations} iterations...`);
    for (let i = 0; i < config.warmupIterations; i++) {
      await this.executeDoNothing(i, false);
    }

    // Test
    console.log(`Test: ${iterations} iterations...`);
    this.startTime = performance.now();

    for (let i = 0; i < iterations; i++) {
      await this.executeDoNothing(i, true);

      if ((i + 1) % 100 === 0) {
        process.stdout.write(`\r  Progress: ${i + 1}/${iterations}`);
      }
    }
    console.log("\n");

    return this.computeResults(config);
  }

  private async executeDoNothing(nonce: number, record: boolean): Promise<void> {
    const user = this.users[nonce % this.users.length];

    let measurement: TransactionMeasurement;

    if (this.useRealPrograms) {
      const start = performance.now();
      try {
        const recipient = this.users[(nonce + 1) % this.users.length];
        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: user.publicKey,
            toPubkey: recipient.publicKey,
            lamports: 1000n,
          })
        );

        await this.provider!.sendAndConfirm(tx, [user]);

        measurement = {
          timestamp: Date.now(),
          latencyMs: performance.now() - start,
          success: true,
        };
      } catch (e: any) {
        measurement = {
          timestamp: Date.now(),
          latencyMs: performance.now() - start,
          success: false,
          errorType: e.message,
        };
      }
    } else {
      const recipient = this.users[(nonce + 1) % this.users.length];
      // Simple transfer as proxy for "do nothing" in LiteSVM
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: user.publicKey,
          toPubkey: recipient.publicKey,
          lamports: 1000n,
        })
      );
      measurement = this.executeAndMeasure(tx, user);
    }

    measurement.operationType = "do_nothing";

    if (record) {
      this.measurements.push(measurement);
    }
  }

  /**
   * Execute CPUHeavy micro-benchmark (Execution Layer)
   * Measures BPF/SBF VM computational efficiency.
   */
  async runCpuHeavy(
    config: BlockbenchConfig,
    variant: "sort" | "loop" | "hash" | "matrix" = "sort",
    param: number = 256
  ): Promise<BlockbenchResults> {
    console.log("\n╔══════════════════════════════════════════════════════════════╗");
    console.log(`║  MICRO-BENCHMARK: CPUHeavy-${variant} (Execution Layer)       ║`);
    console.log("╚══════════════════════════════════════════════════════════════╝\n");

    this.resetMeasurements();
    const iterations = config.testIterations;

    // Warmup
    console.log(`Warmup: ${config.warmupIterations} iterations...`);
    for (let i = 0; i < config.warmupIterations; i++) {
      await this.executeCpuHeavy(variant, param, i, false);
    }

    // Test
    console.log(`Test: ${iterations} iterations (variant=${variant}, param=${param})...`);
    this.startTime = performance.now();

    for (let i = 0; i < iterations; i++) {
      await this.executeCpuHeavy(variant, param, i, true);

      if ((i + 1) % 50 === 0) {
        process.stdout.write(`\r  Progress: ${i + 1}/${iterations}`);
      }
    }
    console.log("\n");

    return this.computeResults(config);
  }

  private async executeCpuHeavy(
    variant: string,
    param: number,
    seed: number,
    record: boolean
  ): Promise<void> {
    const user = this.users[seed % this.users.length];
    let measurement: TransactionMeasurement;

    if (this.useRealPrograms) {
      const start = performance.now();
      try {
        let methodCall;
        if (variant === "sort") {
          methodCall = this.blockbenchProgram!.methods.cpuHeavySort(param, new BN(seed));
        } else if (variant === "loop") {
          methodCall = this.blockbenchProgram!.methods.cpuHeavyLoop(param);
        } else if (variant === "hash") {
          methodCall = this.blockbenchProgram!.methods.cpuHeavyHash(param, 32);
        } else {
          methodCall = this.blockbenchProgram!.methods.cpuHeavySort(param, new BN(seed));
        }

        const sig = await methodCall
          .accounts({ payer: user.publicKey })
          .signers([user])
          .rpc();

        measurement = {
          timestamp: Date.now(),
          latencyMs: performance.now() - start,
          success: true,
        };
      } catch (e: any) {
        measurement = {
          timestamp: Date.now(),
          latencyMs: performance.now() - start,
          success: false,
          errorType: e.message,
        };
      }
    } else {
      // Simulate CPU-heavy work with compute budget
      const tx = new Transaction().add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        // In production, this would call the blockbench program
        SystemProgram.transfer({
          fromPubkey: user.publicKey,
          toPubkey: this.users[(seed + 1) % this.users.length].publicKey,
          lamports: 1000n,
        })
      );
      measurement = this.executeAndMeasure(tx, user);
    }

    measurement.operationType = `cpu_heavy_${variant}`;

    if (record) {
      this.measurements.push(measurement);
    }
  }

  /**
   * Execute IOHeavy micro-benchmark (Data Model Layer)
   * Measures account storage read/write efficiency.
   */
  async runIoHeavy(
    config: BlockbenchConfig,
    variant: "write" | "read" | "mixed" = "write",
    opsPerTx: number = 5
  ): Promise<BlockbenchResults> {
    console.log("\n╔══════════════════════════════════════════════════════════════╗");
    console.log(`║  MICRO-BENCHMARK: IOHeavy-${variant} (Data Model Layer)       ║`);
    console.log("╚══════════════════════════════════════════════════════════════╝\n");

    this.resetMeasurements();
    const iterations = config.testIterations;

    // Warmup
    console.log(`Warmup: ${config.warmupIterations} iterations...`);
    for (let i = 0; i < config.warmupIterations; i++) {
      await this.executeIoHeavy(variant, opsPerTx, i, false);
    }

    // Test
    console.log(`Test: ${iterations} iterations (variant=${variant}, ops=${opsPerTx})...`);
    this.startTime = performance.now();

    for (let i = 0; i < iterations; i++) {
      await this.executeIoHeavy(variant, opsPerTx, i, true);

      if ((i + 1) % 50 === 0) {
        process.stdout.write(`\r  Progress: ${i + 1}/${iterations}`);
      }
    }
    console.log("\n");

    return this.computeResults(config);
  }

  private async executeIoHeavy(
    variant: string,
    opsPerTx: number,
    seed: number,
    record: boolean
  ): Promise<void> {
    const user = this.users[seed % this.users.length];
    let measurement: TransactionMeasurement;

    if (this.useRealPrograms) {
      const start = performance.now();
      try {
        const keyPrefix = Buffer.alloc(16);
        keyPrefix.write(`bb_io_${seed}`);

        // Derive IO account PDA
        const [ioAccountPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("io_heavy"), user.publicKey.toBuffer(), keyPrefix],
          this.blockbenchProgram!.programId
        );

        let methodCall;
        if (variant === "write") {
          methodCall = this.blockbenchProgram!.methods.ioHeavyWrite(
            Array.from(keyPrefix),
            100, // value size
            opsPerTx
          );
        } else {
          // Simplified: using mixed for both read/mixed real-world benchmarking
          methodCall = this.blockbenchProgram!.methods.ioHeavyMixed(
            variant === "read" ? 90 : 50,
            opsPerTx
          );
        }

        await methodCall
          .accounts({
            payer: user.publicKey,
            ioAccount: ioAccountPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([user])
          .rpc();

        measurement = {
          timestamp: Date.now(),
          latencyMs: performance.now() - start,
          success: true,
        };
      } catch (e: any) {
        measurement = {
          timestamp: Date.now(),
          latencyMs: performance.now() - start,
          success: false,
          errorType: e.message,
        };
      }
    } else {
      // Multiple transfers to simulate IO-heavy workload
      const tx = new Transaction();
      for (let i = 0; i < opsPerTx; i++) {
        tx.add(
          SystemProgram.transfer({
            fromPubkey: user.publicKey,
            toPubkey: this.users[(seed + i + 1) % this.users.length].publicKey,
            lamports: 100n,
          })
        );
      }
      measurement = this.executeAndMeasure(tx, user);
    }

    measurement.operationType = `io_heavy_${variant}`;

    if (record) {
      this.measurements.push(measurement);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // YCSB MACRO-BENCHMARK
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Execute YCSB workload (Yahoo! Cloud Serving Benchmark)
   * Standard database benchmark adapted for blockchain.
   */
  async runYcsb(config: BlockbenchConfig): Promise<BlockbenchResults> {
    const workloadName = config.workloadType.replace("ycsb_", "").toUpperCase();

    console.log("\n╔══════════════════════════════════════════════════════════════╗");
    console.log(`║  MACRO-BENCHMARK: YCSB Workload ${workloadName}                          ║`);
    console.log("╚══════════════════════════════════════════════════════════════╝\n");

    // Configure workload mix based on YCSB variant
    const mix = this.getYcsbMix(config.workloadType);
    console.log(`Workload Mix: Read=${mix.read}%, Update=${mix.update}%, Insert=${mix.insert}%`);
    console.log(`Distribution: ${config.distribution || "uniform"}`);
    console.log(`Record Count: ${config.recordCount || 10000}\n`);

    this.resetMeasurements();
    const iterations = config.testIterations;

    // Warmup
    console.log(`Warmup: ${config.warmupIterations} iterations...`);
    for (let i = 0; i < config.warmupIterations; i++) {
      await this.executeYcsbOperation(mix, config, i, false);
    }

    // Test
    console.log(`Test: ${iterations} iterations...`);
    this.startTime = performance.now();

    for (let i = 0; i < iterations; i++) {
      await this.executeYcsbOperation(mix, config, i, true);

      if ((i + 1) % 100 === 0) {
        process.stdout.write(`\r  Progress: ${i + 1}/${iterations}`);
      }
    }
    console.log("\n");

    return this.computeResults(config);
  }

  private getYcsbMix(workloadType: WorkloadType): { read: number; update: number; insert: number } {
    switch (workloadType) {
      case WorkloadType.YCSB_A:
        return { read: 50, update: 50, insert: 0 };
      case WorkloadType.YCSB_B:
        return { read: 95, update: 5, insert: 0 };
      case WorkloadType.YCSB_C:
        return { read: 100, update: 0, insert: 0 };
      case WorkloadType.YCSB_F:
        return { read: 50, update: 50, insert: 0 }; // RMW treated as update
      default:
        return { read: 50, update: 50, insert: 0 };
    }
  }

  private async executeYcsbOperation(
    mix: { read: number; update: number; insert: number },
    config: BlockbenchConfig,
    seed: number,
    record: boolean
  ): Promise<void> {
    const user = this.users[seed % this.users.length];
    const rand = Math.random() * 100;

    let operationType: string;
    let methodCall;
    const key = this.generateKey(config, seed);
    // Key derivation for YCSB: 32-byte key derived from integer
    const keyArray = Array.from(Buffer.alloc(32).fill(0));
    const view = new DataView(new Uint8Array(keyArray).buffer);
    view.setUint32(0, key, true);

    if (rand < mix.read) {
      operationType = "ycsb_read";
    } else if (rand < mix.read + mix.update) {
      operationType = "ycsb_update";
    } else {
      operationType = "ycsb_insert";
    }

    let measurement: TransactionMeasurement;

    if (this.useRealPrograms) {
      const start = performance.now();
      try {
        if (operationType === "ycsb_read") {
          methodCall = this.blockbenchProgram!.methods.ycsbRead(keyArray);
        } else if (operationType === "ycsb_update") {
          methodCall = this.blockbenchProgram!.methods.ycsbUpdate(keyArray, Buffer.from("ycsb_value_at_rest"));
        } else {
          methodCall = this.blockbenchProgram!.methods.ycsbInsert(keyArray, Buffer.from("ycsb_value_at_rest"));
        }

        await methodCall
          .accounts({ payer: user.publicKey })
          .signers([user])
          .rpc();

        measurement = {
          timestamp: Date.now(),
          latencyMs: performance.now() - start,
          success: true,
        };
      } catch (e: any) {
        measurement = {
          timestamp: Date.now(),
          latencyMs: performance.now() - start,
          success: false,
          errorType: e.message,
        };
      }
    } else {
      // Execute operation via LiteSVM mock
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: user.publicKey,
          toPubkey: this.users[(seed + 1) % this.users.length].publicKey,
          lamports: 1000n,
        })
      );
      measurement = this.executeAndMeasure(tx, user);
    }

    measurement.operationType = operationType;

    if (record) {
      this.measurements.push(measurement);
    }
  }

  private generateKey(config: BlockbenchConfig, seed: number): number {
    const recordCount = config.recordCount || 10000;

    switch (config.distribution) {
      case DistributionType.ZIPFIAN:
        return this.zipfianKey(recordCount, config.zipfianConstant || 0.99, seed);
      case DistributionType.LATEST:
        return recordCount - (seed % Math.min(seed + 1, 100));
      case DistributionType.HOTSPOT:
        // 10% of keys get 90% of traffic
        if (Math.random() < 0.9) {
          return seed % Math.floor(recordCount * 0.1);
        }
        return seed % recordCount;
      default:
        return seed % recordCount;
    }
  }

  private zipfianKey(n: number, theta: number, seed: number): number {
    // Simplified Zipfian distribution
    const alpha = 1 / (1 - theta);
    const zeta = 1; // Normalization constant (simplified)
    const eta = (1 - Math.pow(2 / n, 1 - theta)) / (1 - zeta / Math.pow(n, theta));

    const u = (seed * 0.61803398875) % 1; // Golden ratio hash
    const uz = u * zeta;

    if (uz < 1) return 0;
    return Math.floor(n * Math.pow(eta * u - eta + 1, alpha));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TRANSACTION EXECUTION & MEASUREMENT
  // ══════════════════════════════════════════════════════════════════════════

  private executeAndMeasure(tx: Transaction, signer: Keypair): TransactionMeasurement {
    const startTime = performance.now();

    tx.recentBlockhash = this.svm.latestBlockhash();
    tx.sign(signer);

    const result = this.svm.sendTransaction(tx);
    const endTime = performance.now();

    const measurement: TransactionMeasurement = {
      timestamp: Date.now(),
      latencyMs: endTime - startTime,
      success: result instanceof TransactionMetadata,
      transactionSize: tx.serialize().length,
    };

    if (result instanceof TransactionMetadata) {
      measurement.computeUnits = Number(result.computeUnitsConsumed);
    } else if (result instanceof FailedTransactionMetadata) {
      measurement.errorType = String(result.err);
    }

    return measurement;
  }

  private resetMeasurements(): void {
    this.measurements = [];
    this.windows = [];
    this.startTime = 0;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RESULTS COMPUTATION
  // ══════════════════════════════════════════════════════════════════════════

  private computeResults(config: BlockbenchConfig): BlockbenchResults {
    const endTime = performance.now();
    const durationMs = endTime - this.startTime;
    const durationSeconds = durationMs / 1000;

    const successful = this.measurements.filter(m => m.success);
    const failed = this.measurements.filter(m => !m.success);

    // Latency statistics
    const latencies = successful.map(m => m.latencyMs).sort((a, b) => a - b);
    const latencyStats = this.computeLatencyStats(latencies);

    // Throughput
    const avgTps = successful.length / durationSeconds;

    // Compute windows for time-series analysis
    this.computeThroughputWindows(durationMs);
    const windowTps = this.windows.map(w => w.tps).filter(t => t > 0);

    // Compute units
    const computeUnits = successful
      .filter(m => m.computeUnits !== undefined)
      .map(m => m.computeUnits!);

    // Error breakdown
    const errorsByType: Record<string, number> = {};
    for (const m of failed) {
      const errType = m.errorType || "unknown";
      errorsByType[errType] = (errorsByType[errType] || 0) + 1;
    }

    return {
      testId: `blockbench_${Date.now()}`,
      testName: config.name,
      timestamp: new Date().toISOString(),
      config,
      environment: "litesvm",

      throughput: {
        avgTps: Math.round(avgTps * 100) / 100,
        peakTps: windowTps.length > 0 ? Math.max(...windowTps) : avgTps,
        minTps: windowTps.length > 0 ? Math.min(...windowTps) : avgTps,
        sustainedTps: avgTps,
        totalTransactions: this.measurements.length,
        successfulTransactions: successful.length,
        failedTransactions: failed.length,
      },

      latency: latencyStats,

      resources: {
        avgComputeUnits: computeUnits.length > 0
          ? computeUnits.reduce((a, b) => a + b, 0) / computeUnits.length
          : 0,
        minComputeUnits: computeUnits.length > 0 ? Math.min(...computeUnits) : 0,
        maxComputeUnits: computeUnits.length > 0 ? Math.max(...computeUnits) : 0,
        totalComputeUnits: computeUnits.reduce((a, b) => a + b, 0),
      },

      measurements: this.measurements,
      windows: this.windows,

      errors: {
        total: failed.length,
        byType: errorsByType,
      },

      durationSeconds: Math.round(durationSeconds * 100) / 100,
    };
  }

  private computeLatencyStats(latencies: number[]): BlockbenchResults["latency"] {
    if (latencies.length === 0) {
      return {
        avgMs: 0, minMs: 0, maxMs: 0, stdDevMs: 0,
        percentiles: { p50: 0, p75: 0, p90: 0, p95: 0, p99: 0, p999: 0 },
      };
    }

    const sum = latencies.reduce((a, b) => a + b, 0);
    const avg = sum / latencies.length;
    const variance = latencies.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0) / latencies.length;

    const percentile = (p: number) => {
      const index = Math.ceil((p / 100) * latencies.length) - 1;
      return latencies[Math.max(0, Math.min(index, latencies.length - 1))];
    };

    return {
      avgMs: Math.round(avg * 1000) / 1000,
      minMs: Math.round(latencies[0] * 1000) / 1000,
      maxMs: Math.round(latencies[latencies.length - 1] * 1000) / 1000,
      stdDevMs: Math.round(Math.sqrt(variance) * 1000) / 1000,
      percentiles: {
        p50: Math.round(percentile(50) * 1000) / 1000,
        p75: Math.round(percentile(75) * 1000) / 1000,
        p90: Math.round(percentile(90) * 1000) / 1000,
        p95: Math.round(percentile(95) * 1000) / 1000,
        p99: Math.round(percentile(99) * 1000) / 1000,
        p999: Math.round(percentile(99.9) * 1000) / 1000,
      },
    };
  }

  private computeThroughputWindows(totalDurationMs: number): void {
    const windowSize = 1000; // 1 second windows
    const numWindows = Math.ceil(totalDurationMs / windowSize);

    for (let i = 0; i < numWindows; i++) {
      const windowStart = this.startTime + i * windowSize;
      const windowEnd = windowStart + windowSize;

      const windowMeasurements = this.measurements.filter(m => {
        const txTime = m.timestamp;
        return txTime >= windowStart && txTime < windowEnd;
      });

      const successful = windowMeasurements.filter(m => m.success).length;

      this.windows.push({
        startTime: windowStart,
        endTime: windowEnd,
        transactions: windowMeasurements.length,
        successful,
        failed: windowMeasurements.length - successful,
        tps: successful / (windowSize / 1000),
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RESULT OUTPUT
  // ══════════════════════════════════════════════════════════════════════════

  printResults(results: BlockbenchResults): void {
    console.log("\n═══════════════════════════════════════════════════════════════");
    console.log("  BLOCKBENCH RESULTS SUMMARY");
    console.log("═══════════════════════════════════════════════════════════════\n");

    console.log(`Test: ${results.testName}`);
    console.log(`Workload: ${results.config.workloadType}`);
    console.log(`Duration: ${results.durationSeconds}s\n`);

    console.log("📊 THROUGHPUT");
    console.log("─────────────────────────────────────────");
    console.log(`  Average TPS:    ${results.throughput.avgTps.toFixed(2)}`);
    console.log(`  Peak TPS:       ${results.throughput.peakTps.toFixed(2)}`);
    console.log(`  Min TPS:        ${results.throughput.minTps.toFixed(2)}`);
    console.log(`  Total TX:       ${results.throughput.totalTransactions}`);
    console.log(`  Success:        ${results.throughput.successfulTransactions}`);
    console.log(`  Failed:         ${results.throughput.failedTransactions}`);
    console.log(`  Success Rate:   ${((results.throughput.successfulTransactions / results.throughput.totalTransactions) * 100).toFixed(2)}%\n`);

    console.log("⏱️  LATENCY");
    console.log("─────────────────────────────────────────");
    console.log(`  Average:        ${results.latency.avgMs.toFixed(3)}ms`);
    console.log(`  Min:            ${results.latency.minMs.toFixed(3)}ms`);
    console.log(`  Max:            ${results.latency.maxMs.toFixed(3)}ms`);
    console.log(`  Std Dev:        ${results.latency.stdDevMs.toFixed(3)}ms`);
    console.log(`  p50:            ${results.latency.percentiles.p50.toFixed(3)}ms`);
    console.log(`  p90:            ${results.latency.percentiles.p90.toFixed(3)}ms`);
    console.log(`  p95:            ${results.latency.percentiles.p95.toFixed(3)}ms`);
    console.log(`  p99:            ${results.latency.percentiles.p99.toFixed(3)}ms\n`);

    console.log("💻 COMPUTE UNITS");
    console.log("─────────────────────────────────────────");
    console.log(`  Average:        ${Math.round(results.resources.avgComputeUnits)}`);
    console.log(`  Min:            ${results.resources.minComputeUnits}`);
    console.log(`  Max:            ${results.resources.maxComputeUnits}`);
    console.log(`  Total:          ${results.resources.totalComputeUnits}\n`);

    if (results.errors.total > 0) {
      console.log("❌ ERRORS");
      console.log("─────────────────────────────────────────");
      for (const [type, count] of Object.entries(results.errors.byType)) {
        console.log(`  ${type}: ${count}`);
      }
      console.log("");
    }

    console.log("═══════════════════════════════════════════════════════════════\n");
  }

  saveResults(results: BlockbenchResults, outputDir?: string): string {
    const dir = outputDir || path.join(__dirname, "../../../test-results/blockbench");

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const filename = `${results.testId}.json`;
    const filepath = path.join(dir, filename);

    const serializable = JSON.parse(
      JSON.stringify(results, (key, value) =>
        typeof value === "bigint" ? value.toString() : value
      )
    );

    fs.writeFileSync(filepath, JSON.stringify(serializable, null, 2));
    console.log(`📁 Results saved to: ${filepath}`);

    return filepath;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export { BlockbenchEngine as default };
