/**
 * GridTokenX Performance Benchmark Suite
 * 
 * Comprehensive throughput and latency testing for research paper
 * Measures TPS, latency percentiles, and compute unit consumption
 */

import { LiteSVM, TransactionMetadata, FailedTransactionMetadata } from "litesvm";
import {
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  TransactionInstruction,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface BenchmarkConfig {
  name: string;
  description: string;
  warmupIterations: number;
  testIterations: number;
  concurrentUsers: number;
  transactionType: TransactionType;
}

export type TransactionType = 
  | "sol_transfer" 
  | "create_order" 
  | "cancel_order" 
  | "match_orders"
  | "mint_energy"
  | "update_oracle";

// Program IDs
const PROGRAM_IDS = {
  energyToken: new PublicKey("54SAVMgGhjssp3iQ7zBK8kgUnEtqHJTNg3QRfzzDitHB"),
  governance: new PublicKey("GZP5QP6PMD2D8nNsLkhA39Lfr4er12JLMhQZJnhxyT5h"),
  oracle: new PublicKey("F7mEgt7zaAaKHfTNmCLeZCUutdKyZ2cxYg41ggjstBi6"),
  registry: new PublicKey("9XS8uUEVErcA8LABrJQAdohWMXTToBwhFN7Rvur6dC5"),
  trading: new PublicKey("2pZ8gqotjvKMAu96XzpGZ7QFcemZzj21ybtVTbaDP1zG"),
};

const DEPLOY_PATH = path.join(__dirname, "../../target/deploy");
const RESULTS_PATH = path.join(__dirname, "../../test-results/benchmark");

// ============================================================================
// RESULTS DATA STRUCTURES
// ============================================================================

export interface LatencyMeasurement {
  timestamp: number;
  latencyMs: number;
  success: boolean;
  computeUnits?: bigint;
  errorType?: string;
}

export interface ThroughputWindow {
  startTime: number;
  endTime: number;
  transactions: number;
  successful: number;
  tps: number;
}

export interface BenchmarkResults {
  testId: string;
  testName: string;
  timestamp: string;
  environment: string;
  config: BenchmarkConfig;
  latencyResults: {
    measurements: LatencyMeasurement[];
    statistics: LatencyStatistics;
  };
  throughputResults: {
    windows: ThroughputWindow[];
    statistics: ThroughputStatistics;
  };
  resourceResults: {
    computeUnits: ComputeUnitStats;
  };
}

export interface LatencyStatistics {
  count: number;
  successRate: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
  medianMs: number;
  stdDevMs: number;
  p50Ms: number;
  p75Ms: number;
  p90Ms: number;
  p95Ms: number;
  p99Ms: number;
}

export interface ThroughputStatistics {
  totalTransactions: number;
  successfulTransactions: number;
  failedTransactions: number;
  durationSeconds: number;
  avgTps: number;
  peakTps: number;
  minTps: number;
  sustainedTps: number;
}

export interface ComputeUnitStats {
  avg: number;
  min: number;
  max: number;
  total: number;
}

// ============================================================================
// BENCHMARK ENGINE
// ============================================================================

export class BenchmarkEngine {
  private svm: LiteSVM;
  private authority: Keypair;
  private users: Keypair[] = [];
  private programsLoaded = false;

  constructor() {
    this.svm = new LiteSVM();
    this.authority = Keypair.generate();
  }

  async initialize(numUsers: number = 100): Promise<void> {
    console.log("🔧 Initializing benchmark environment...");
    
    // Fund authority
    this.svm.airdrop(this.authority.publicKey, BigInt(1000 * LAMPORTS_PER_SOL));
    
    // Create and fund users
    console.log(`   Creating ${numUsers} test users...`);
    for (let i = 0; i < numUsers; i++) {
      const user = Keypair.generate();
      this.svm.airdrop(user.publicKey, BigInt(100 * LAMPORTS_PER_SOL));
      this.users.push(user);
    }

    // Load programs
    this.loadPrograms();
    
    console.log("✓ Benchmark environment ready\n");
  }

  private loadPrograms(): void {
    if (this.programsLoaded) return;

    const programs = [
      { id: PROGRAM_IDS.energyToken, file: "energy_token.so" },
      { id: PROGRAM_IDS.governance, file: "governance.so" },
      { id: PROGRAM_IDS.oracle, file: "oracle.so" },
      { id: PROGRAM_IDS.registry, file: "registry.so" },
      { id: PROGRAM_IDS.trading, file: "trading.so" },
    ];

    for (const program of programs) {
      const programPath = path.join(DEPLOY_PATH, program.file);
      if (fs.existsSync(programPath)) {
        try {
          this.svm.addProgramFromFile(program.id, programPath);
        } catch (e) {
          // Ignore load errors for benchmark
        }
      }
    }
    this.programsLoaded = true;
  }

  createTransaction(type: TransactionType, userIndex: number): Transaction {
    const user = this.users[userIndex % this.users.length];
    const recipient = this.users[(userIndex + 1) % this.users.length];
    
    const tx = new Transaction();

    switch (type) {
      case "sol_transfer":
        tx.add(
          SystemProgram.transfer({
            fromPubkey: user.publicKey,
            toPubkey: recipient.publicKey,
            lamports: 1000n,
          })
        );
        break;
      
      case "create_order":
      case "cancel_order":
      case "match_orders":
      case "mint_energy":
      case "update_oracle":
        // For now, use SOL transfer as proxy for program instructions
        // In production, you'd create actual program instructions
        tx.add(
          SystemProgram.transfer({
            fromPubkey: user.publicKey,
            toPubkey: recipient.publicKey,
            lamports: 1000n,
          })
        );
        break;
    }

    return tx;
  }

  executeTransaction(tx: Transaction, signer: Keypair): LatencyMeasurement {
    const startTime = performance.now();
    
    tx.recentBlockhash = this.svm.latestBlockhash();
    tx.sign(signer);
    
    const result = this.svm.sendTransaction(tx);
    const endTime = performance.now();
    
    const measurement: LatencyMeasurement = {
      timestamp: Date.now(),
      latencyMs: endTime - startTime,
      success: result instanceof TransactionMetadata,
    };

    if (result instanceof TransactionMetadata) {
      measurement.computeUnits = result.computeUnitsConsumed;
    } else if (result instanceof FailedTransactionMetadata) {
      measurement.errorType = String(result.err);
    }

    return measurement;
  }

  getUser(index: number): Keypair {
    return this.users[index % this.users.length];
  }

  getUserCount(): number {
    return this.users.length;
  }
}

// ============================================================================
// STATISTICAL UTILITIES
// ============================================================================

export function calculateLatencyStatistics(measurements: LatencyMeasurement[]): LatencyStatistics {
  const successfulMeasurements = measurements.filter(m => m.success);
  const latencies = successfulMeasurements.map(m => m.latencyMs).sort((a, b) => a - b);
  
  if (latencies.length === 0) {
    return {
      count: measurements.length,
      successRate: 0,
      minMs: 0,
      maxMs: 0,
      avgMs: 0,
      medianMs: 0,
      stdDevMs: 0,
      p50Ms: 0,
      p75Ms: 0,
      p90Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
    };
  }

  const count = latencies.length;
  const sum = latencies.reduce((a, b) => a + b, 0);
  const avg = sum / count;
  
  const variance = latencies.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0) / count;
  const stdDev = Math.sqrt(variance);

  const percentile = (p: number) => {
    const index = Math.ceil((p / 100) * count) - 1;
    return latencies[Math.max(0, Math.min(index, count - 1))];
  };

  return {
    count: measurements.length,
    successRate: (successfulMeasurements.length / measurements.length) * 100,
    minMs: latencies[0],
    maxMs: latencies[count - 1],
    avgMs: avg,
    medianMs: percentile(50),
    stdDevMs: stdDev,
    p50Ms: percentile(50),
    p75Ms: percentile(75),
    p90Ms: percentile(90),
    p95Ms: percentile(95),
    p99Ms: percentile(99),
  };
}

export function calculateThroughputStatistics(
  windows: ThroughputWindow[],
  totalDurationMs: number
): ThroughputStatistics {
  const totalTx = windows.reduce((sum, w) => sum + w.transactions, 0);
  const successfulTx = windows.reduce((sum, w) => sum + w.successful, 0);
  const tpsValues = windows.map(w => w.tps).filter(t => t > 0);

  return {
    totalTransactions: totalTx,
    successfulTransactions: successfulTx,
    failedTransactions: totalTx - successfulTx,
    durationSeconds: totalDurationMs / 1000,
    avgTps: tpsValues.length > 0 ? tpsValues.reduce((a, b) => a + b, 0) / tpsValues.length : 0,
    peakTps: tpsValues.length > 0 ? Math.max(...tpsValues) : 0,
    minTps: tpsValues.length > 0 ? Math.min(...tpsValues) : 0,
    sustainedTps: successfulTx / (totalDurationMs / 1000),
  };
}

export function calculateComputeUnitStats(measurements: LatencyMeasurement[]): ComputeUnitStats {
  const cus = measurements
    .filter(m => m.computeUnits !== undefined)
    .map(m => Number(m.computeUnits));

  if (cus.length === 0) {
    return { avg: 0, min: 0, max: 0, total: 0 };
  }

  return {
    avg: cus.reduce((a, b) => a + b, 0) / cus.length,
    min: Math.min(...cus),
    max: Math.max(...cus),
    total: cus.reduce((a, b) => a + b, 0),
  };
}

// ============================================================================
// RESULT EXPORT
// ============================================================================

export function saveResults(results: BenchmarkResults): void {
  // Ensure results directory exists
  if (!fs.existsSync(RESULTS_PATH)) {
    fs.mkdirSync(RESULTS_PATH, { recursive: true });
  }

  const filename = `benchmark-${results.testId}-${Date.now()}.json`;
  const filepath = path.join(RESULTS_PATH, filename);

  // Create a serializable version (handle bigint)
  const serializable = JSON.parse(
    JSON.stringify(results, (key, value) =>
      typeof value === "bigint" ? value.toString() : value
    )
  );

  fs.writeFileSync(filepath, JSON.stringify(serializable, null, 2));
  console.log(`📊 Results saved to: ${filepath}`);
}

export function exportLatenciesToCSV(measurements: LatencyMeasurement[], filename: string): void {
  if (!fs.existsSync(RESULTS_PATH)) {
    fs.mkdirSync(RESULTS_PATH, { recursive: true });
  }

  const headers = "timestamp,latency_ms,success,compute_units,error_type\n";
  const rows = measurements.map(m => 
    `${m.timestamp},${m.latencyMs.toFixed(3)},${m.success},${m.computeUnits || ""},${m.errorType || ""}`
  ).join("\n");

  const filepath = path.join(RESULTS_PATH, filename);
  fs.writeFileSync(filepath, headers + rows);
  console.log(`📄 CSV exported to: ${filepath}`);
}

// ============================================================================
// EXPORTS
// ============================================================================

export { PROGRAM_IDS, DEPLOY_PATH, RESULTS_PATH };
