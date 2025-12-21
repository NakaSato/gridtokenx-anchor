/**
 * YCSB (Yahoo! Cloud Serving Benchmark) Workload for GridTokenX
 * 
 * Implements the standard YCSB workloads adapted for blockchain:
 * - Workload A: 50% read, 50% update (update heavy)
 * - Workload B: 95% read, 5% update (read heavy)  
 * - Workload C: 100% read (read only)
 * - Workload D: 95% read, 5% insert (read latest)
 * - Workload E: 95% scan, 5% insert (short ranges)
 * - Workload F: 50% read, 50% read-modify-write
 * 
 * Reference: Cooper et al., "Benchmarking Cloud Serving Systems with YCSB" (SoCC 2010)
 */

import { Keypair, PublicKey, Transaction, SystemProgram } from "@solana/web3.js";

// ============================================================================
// YCSB CONFIGURATION
// ============================================================================

export interface YcsbConfig {
  // Data parameters
  recordCount: number;          // Total number of records
  operationCount: number;       // Number of operations to perform
  fieldCount: number;           // Fields per record
  fieldLength: number;          // Bytes per field
  
  // Workload parameters
  workload: YcsbWorkloadType;
  readProportion: number;       // 0.0 - 1.0
  updateProportion: number;
  insertProportion: number;
  scanProportion: number;
  readModifyWriteProportion: number;
  
  // Distribution parameters
  requestDistribution: RequestDistribution;
  zipfianConstant: number;      // For Zipfian distribution (default 0.99)
  hotspotDataFraction: number;  // Fraction of data in hotspot
  hotspotOpnFraction: number;   // Fraction of operations on hotspot
  
  // Scan parameters
  maxScanLength: number;
  scanLengthDistribution: "uniform" | "zipfian";
  
  // Execution parameters
  target: number;               // Target ops/sec (0 = unlimited)
  measurementType: "histogram" | "timeseries" | "raw";
}

export enum YcsbWorkloadType {
  A = "a",  // Update heavy
  B = "b",  // Read mostly
  C = "c",  // Read only
  D = "d",  // Read latest
  E = "e",  // Short ranges
  F = "f",  // Read-modify-write
}

export enum RequestDistribution {
  UNIFORM = "uniform",
  ZIPFIAN = "zipfian",
  LATEST = "latest",
  HOTSPOT = "hotspot",
  EXPONENTIAL = "exponential",
}

export const YCSB_WORKLOAD_CONFIGS: Record<YcsbWorkloadType, Partial<YcsbConfig>> = {
  [YcsbWorkloadType.A]: {
    readProportion: 0.5,
    updateProportion: 0.5,
    insertProportion: 0,
    scanProportion: 0,
    readModifyWriteProportion: 0,
    requestDistribution: RequestDistribution.ZIPFIAN,
  },
  [YcsbWorkloadType.B]: {
    readProportion: 0.95,
    updateProportion: 0.05,
    insertProportion: 0,
    scanProportion: 0,
    readModifyWriteProportion: 0,
    requestDistribution: RequestDistribution.ZIPFIAN,
  },
  [YcsbWorkloadType.C]: {
    readProportion: 1.0,
    updateProportion: 0,
    insertProportion: 0,
    scanProportion: 0,
    readModifyWriteProportion: 0,
    requestDistribution: RequestDistribution.ZIPFIAN,
  },
  [YcsbWorkloadType.D]: {
    readProportion: 0.95,
    updateProportion: 0,
    insertProportion: 0.05,
    scanProportion: 0,
    readModifyWriteProportion: 0,
    requestDistribution: RequestDistribution.LATEST,
  },
  [YcsbWorkloadType.E]: {
    readProportion: 0,
    updateProportion: 0,
    insertProportion: 0.05,
    scanProportion: 0.95,
    readModifyWriteProportion: 0,
    requestDistribution: RequestDistribution.ZIPFIAN,
    maxScanLength: 100,
  },
  [YcsbWorkloadType.F]: {
    readProportion: 0.5,
    updateProportion: 0,
    insertProportion: 0,
    scanProportion: 0,
    readModifyWriteProportion: 0.5,
    requestDistribution: RequestDistribution.ZIPFIAN,
  },
};

// ============================================================================
// YCSB OPERATION TYPES
// ============================================================================

export enum YcsbOperation {
  READ = "READ",
  UPDATE = "UPDATE",
  INSERT = "INSERT",
  SCAN = "SCAN",
  READ_MODIFY_WRITE = "READ_MODIFY_WRITE",
  DELETE = "DELETE",
}

export interface YcsbTransaction {
  operation: YcsbOperation;
  key: string;
  value?: Uint8Array;
  fields?: string[];
  startKey?: string;
  recordCount?: number;
}

export interface YcsbResult {
  operation: YcsbOperation;
  key: string;
  success: boolean;
  latencyUs: number;
  bytesRead?: number;
  bytesWritten?: number;
  error?: string;
}

export interface YcsbMetrics {
  // Throughput
  throughput: number;
  
  // Operation counts
  totalOps: number;
  readOps: number;
  updateOps: number;
  insertOps: number;
  scanOps: number;
  rmwOps: number;
  
  // Success/failure
  successfulOps: number;
  failedOps: number;
  
  // Latency (microseconds)
  avgLatencyUs: number;
  minLatencyUs: number;
  maxLatencyUs: number;
  
  // Latency percentiles
  p50LatencyUs: number;
  p90LatencyUs: number;
  p95LatencyUs: number;
  p99LatencyUs: number;
  p999LatencyUs: number;
  
  // Per-operation latency
  readAvgLatencyUs: number;
  updateAvgLatencyUs: number;
  insertAvgLatencyUs: number;
  scanAvgLatencyUs: number;
  rmwAvgLatencyUs: number;
  
  // Duration
  durationMs: number;
}

// ============================================================================
// KEY GENERATORS
// ============================================================================

export class KeyGenerator {
  private recordCount: number;
  
  constructor(recordCount: number) {
    this.recordCount = recordCount;
  }

  /**
   * Generate key with uniform distribution
   */
  uniformKey(): string {
    const keyNum = Math.floor(Math.random() * this.recordCount);
    return this.buildKey(keyNum);
  }

  /**
   * Generate key with Zipfian distribution
   * Popular items are accessed much more frequently
   */
  zipfianKey(theta: number = 0.99): string {
    const keyNum = this.zipfianRandom(this.recordCount, theta);
    return this.buildKey(keyNum);
  }

  /**
   * Generate key with latest distribution
   * Recently inserted items are most likely to be read
   */
  latestKey(insertCount: number): string {
    const keyNum = Math.max(0, insertCount - this.zipfianRandom(insertCount, 0.99) - 1);
    return this.buildKey(keyNum);
  }

  /**
   * Generate key with hotspot distribution
   */
  hotspotKey(hotFraction: number = 0.2, hotOpFraction: number = 0.8): string {
    const hotsetSize = Math.floor(this.recordCount * hotFraction);
    
    if (Math.random() < hotOpFraction) {
      // Access hotspot
      const keyNum = Math.floor(Math.random() * hotsetSize);
      return this.buildKey(keyNum);
    } else {
      // Access rest
      const keyNum = hotsetSize + Math.floor(Math.random() * (this.recordCount - hotsetSize));
      return this.buildKey(keyNum);
    }
  }

  /**
   * Generate sequential key for insert operations
   */
  sequentialKey(counter: number): string {
    return this.buildKey(counter);
  }

  private buildKey(keyNum: number): string {
    return `user${keyNum.toString().padStart(10, '0')}`;
  }

  private zipfianRandom(n: number, theta: number): number {
    // Rejection sampling for Zipfian distribution
    const alpha = 1 / (1 - theta);
    const zetan = this.zetaN(n, theta);
    const eta = (1 - Math.pow(2 / n, 1 - theta)) / (1 - 1 / zetan);
    
    const u = Math.random();
    const uz = u * zetan;
    
    if (uz < 1) return 0;
    if (uz < 1 + Math.pow(0.5, theta)) return 1;
    
    return Math.floor(n * Math.pow(eta * u - eta + 1, alpha));
  }

  private zetaN(n: number, theta: number): number {
    // Approximate zeta function
    let sum = 0;
    for (let i = 1; i <= n; i++) {
      sum += 1 / Math.pow(i, theta);
    }
    return sum;
  }
}

// ============================================================================
// VALUE GENERATOR
// ============================================================================

export class ValueGenerator {
  private fieldLength: number;
  
  constructor(fieldLength: number = 100) {
    this.fieldLength = fieldLength;
  }

  /**
   * Generate random value of specified length
   */
  generateValue(): Uint8Array {
    const value = new Uint8Array(this.fieldLength);
    for (let i = 0; i < this.fieldLength; i++) {
      value[i] = Math.floor(Math.random() * 256);
    }
    return value;
  }

  /**
   * Generate value with specific pattern for verification
   */
  generateVerifiableValue(key: string): Uint8Array {
    const value = new Uint8Array(this.fieldLength);
    const keyBytes = new TextEncoder().encode(key);
    
    for (let i = 0; i < this.fieldLength; i++) {
      value[i] = keyBytes[i % keyBytes.length] ^ (i & 0xFF);
    }
    
    return value;
  }
}

// ============================================================================
// YCSB WORKLOAD GENERATOR
// ============================================================================

export class YcsbWorkload {
  private config: YcsbConfig;
  private keyGenerator: KeyGenerator;
  private valueGenerator: ValueGenerator;
  private results: YcsbResult[] = [];
  private startTime: number = 0;
  private insertKeyCounter: number = 0;
  
  constructor(config: Partial<YcsbConfig> = {}) {
    // Merge with default config
    const workloadType = config.workload || YcsbWorkloadType.A;
    const workloadDefaults = YCSB_WORKLOAD_CONFIGS[workloadType];
    
    this.config = {
      recordCount: 10000,
      operationCount: 1000,
      fieldCount: 10,
      fieldLength: 100,
      workload: workloadType,
      readProportion: 0.5,
      updateProportion: 0.5,
      insertProportion: 0,
      scanProportion: 0,
      readModifyWriteProportion: 0,
      requestDistribution: RequestDistribution.ZIPFIAN,
      zipfianConstant: 0.99,
      hotspotDataFraction: 0.2,
      hotspotOpnFraction: 0.8,
      maxScanLength: 100,
      scanLengthDistribution: "uniform",
      target: 0,
      measurementType: "histogram",
      ...workloadDefaults,
      ...config,
    };
    
    this.keyGenerator = new KeyGenerator(this.config.recordCount);
    this.valueGenerator = new ValueGenerator(this.config.fieldLength);
    this.insertKeyCounter = this.config.recordCount;
  }

  /**
   * Select next operation based on workload proportions
   */
  selectOperation(): YcsbOperation {
    const rand = Math.random();
    let cumulative = 0;
    
    cumulative += this.config.readProportion;
    if (rand < cumulative) return YcsbOperation.READ;
    
    cumulative += this.config.updateProportion;
    if (rand < cumulative) return YcsbOperation.UPDATE;
    
    cumulative += this.config.insertProportion;
    if (rand < cumulative) return YcsbOperation.INSERT;
    
    cumulative += this.config.scanProportion;
    if (rand < cumulative) return YcsbOperation.SCAN;
    
    cumulative += this.config.readModifyWriteProportion;
    if (rand < cumulative) return YcsbOperation.READ_MODIFY_WRITE;
    
    return YcsbOperation.READ;
  }

  /**
   * Generate key based on distribution
   */
  selectKey(): string {
    switch (this.config.requestDistribution) {
      case RequestDistribution.UNIFORM:
        return this.keyGenerator.uniformKey();
      case RequestDistribution.ZIPFIAN:
        return this.keyGenerator.zipfianKey(this.config.zipfianConstant);
      case RequestDistribution.LATEST:
        return this.keyGenerator.latestKey(this.insertKeyCounter);
      case RequestDistribution.HOTSPOT:
        return this.keyGenerator.hotspotKey(
          this.config.hotspotDataFraction,
          this.config.hotspotOpnFraction
        );
      default:
        return this.keyGenerator.uniformKey();
    }
  }

  /**
   * Generate a YCSB transaction
   */
  generateTransaction(): YcsbTransaction {
    const operation = this.selectOperation();
    
    switch (operation) {
      case YcsbOperation.INSERT:
        const insertKey = this.keyGenerator.sequentialKey(this.insertKeyCounter++);
        return {
          operation,
          key: insertKey,
          value: this.valueGenerator.generateValue(),
        };
        
      case YcsbOperation.UPDATE:
        return {
          operation,
          key: this.selectKey(),
          value: this.valueGenerator.generateValue(),
        };
        
      case YcsbOperation.READ:
        return {
          operation,
          key: this.selectKey(),
        };
        
      case YcsbOperation.SCAN:
        const scanLength = this.config.scanLengthDistribution === "uniform"
          ? Math.floor(Math.random() * this.config.maxScanLength) + 1
          : Math.min(
              Math.floor(Math.pow(Math.random(), 2) * this.config.maxScanLength) + 1,
              this.config.maxScanLength
            );
        return {
          operation,
          startKey: this.selectKey(),
          recordCount: scanLength,
          key: this.selectKey(),
        };
        
      case YcsbOperation.READ_MODIFY_WRITE:
        return {
          operation,
          key: this.selectKey(),
          value: this.valueGenerator.generateValue(),
        };
        
      default:
        return {
          operation: YcsbOperation.READ,
          key: this.selectKey(),
        };
    }
  }

  /**
   * Record transaction result
   */
  recordResult(result: YcsbResult): void {
    this.results.push(result);
  }

  /**
   * Run the workload (simulation mode)
   */
  async run(options: {
    durationMs?: number;
    maxOperations?: number;
    concurrency?: number;
  } = {}): Promise<YcsbMetrics> {
    const {
      durationMs = 30000,
      maxOperations = this.config.operationCount,
      concurrency = 1,
    } = options;

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log(`║     YCSB Workload ${this.config.workload.toUpperCase()} Benchmark                             ║`);
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    console.log('Configuration:');
    console.log(`  Workload: ${this.config.workload.toUpperCase()}`);
    console.log(`  Records: ${this.config.recordCount}`);
    console.log(`  Operations: ${maxOperations}`);
    console.log(`  Distribution: ${this.config.requestDistribution}`);
    console.log(`  Read/Update/Insert: ${this.config.readProportion}/${this.config.updateProportion}/${this.config.insertProportion}`);
    console.log(`  Concurrency: ${concurrency}\n`);

    this.results = [];
    this.startTime = Date.now();
    const endTime = this.startTime + durationMs;
    let completed = 0;

    console.log('🚀 Running YCSB workload...\n');

    // Run operations
    while (Date.now() < endTime && completed < maxOperations) {
      const tx = this.generateTransaction();
      const start = performance.now();
      
      // Simulate execution with realistic latency
      const baseLatency = this.simulateLatency(tx.operation);
      await new Promise(resolve => setTimeout(resolve, baseLatency));
      
      const latencyUs = (performance.now() - start) * 1000;
      
      this.recordResult({
        operation: tx.operation,
        key: tx.key,
        success: Math.random() > 0.001, // 99.9% success rate
        latencyUs,
      });
      
      completed++;
      
      if (completed % 100 === 0) {
        process.stdout.write(`\r  Completed: ${completed} operations`);
      }
    }
    
    console.log('\n');
    
    return this.calculateMetrics();
  }

  private simulateLatency(operation: YcsbOperation): number {
    // Simulate realistic latencies (ms)
    switch (operation) {
      case YcsbOperation.READ:
        return 1 + Math.random() * 2;
      case YcsbOperation.UPDATE:
        return 2 + Math.random() * 3;
      case YcsbOperation.INSERT:
        return 3 + Math.random() * 4;
      case YcsbOperation.SCAN:
        return 5 + Math.random() * 10;
      case YcsbOperation.READ_MODIFY_WRITE:
        return 4 + Math.random() * 5;
      default:
        return 2;
    }
  }

  /**
   * Calculate YCSB metrics
   */
  calculateMetrics(): YcsbMetrics {
    const successful = this.results.filter(r => r.success);
    const durationMs = Date.now() - this.startTime;
    
    // Operation counts
    const readResults = this.results.filter(r => r.operation === YcsbOperation.READ);
    const updateResults = this.results.filter(r => r.operation === YcsbOperation.UPDATE);
    const insertResults = this.results.filter(r => r.operation === YcsbOperation.INSERT);
    const scanResults = this.results.filter(r => r.operation === YcsbOperation.SCAN);
    const rmwResults = this.results.filter(r => r.operation === YcsbOperation.READ_MODIFY_WRITE);
    
    // Latencies
    const latencies = successful.map(r => r.latencyUs).sort((a, b) => a - b);
    const avgLatency = latencies.length > 0 
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length 
      : 0;
    
    const percentile = (arr: number[], p: number) => {
      if (arr.length === 0) return 0;
      const index = Math.ceil(arr.length * p) - 1;
      return arr[Math.max(0, index)];
    };
    
    const avgLatencyForOp = (results: YcsbResult[]) => {
      const successLatencies = results.filter(r => r.success).map(r => r.latencyUs);
      return successLatencies.length > 0 
        ? successLatencies.reduce((a, b) => a + b, 0) / successLatencies.length 
        : 0;
    };
    
    const metrics: YcsbMetrics = {
      throughput: successful.length / (durationMs / 1000),
      totalOps: this.results.length,
      readOps: readResults.length,
      updateOps: updateResults.length,
      insertOps: insertResults.length,
      scanOps: scanResults.length,
      rmwOps: rmwResults.length,
      successfulOps: successful.length,
      failedOps: this.results.length - successful.length,
      avgLatencyUs: avgLatency,
      minLatencyUs: latencies.length > 0 ? latencies[0] : 0,
      maxLatencyUs: latencies.length > 0 ? latencies[latencies.length - 1] : 0,
      p50LatencyUs: percentile(latencies, 0.50),
      p90LatencyUs: percentile(latencies, 0.90),
      p95LatencyUs: percentile(latencies, 0.95),
      p99LatencyUs: percentile(latencies, 0.99),
      p999LatencyUs: percentile(latencies, 0.999),
      readAvgLatencyUs: avgLatencyForOp(readResults),
      updateAvgLatencyUs: avgLatencyForOp(updateResults),
      insertAvgLatencyUs: avgLatencyForOp(insertResults),
      scanAvgLatencyUs: avgLatencyForOp(scanResults),
      rmwAvgLatencyUs: avgLatencyForOp(rmwResults),
      durationMs,
    };
    
    this.printMetrics(metrics);
    
    return metrics;
  }

  private printMetrics(metrics: YcsbMetrics): void {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`  YCSB WORKLOAD ${this.config.workload.toUpperCase()} RESULTS`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    console.log('📊 Throughput:');
    console.log(`   ${metrics.throughput.toFixed(2)} ops/sec\n`);

    console.log('📈 Operations:');
    console.log(`   Total: ${metrics.totalOps}`);
    console.log(`   Successful: ${metrics.successfulOps}`);
    console.log(`   Failed: ${metrics.failedOps}`);
    console.log(`   Read: ${metrics.readOps}`);
    console.log(`   Update: ${metrics.updateOps}`);
    console.log(`   Insert: ${metrics.insertOps}`);
    console.log(`   Scan: ${metrics.scanOps}`);
    console.log(`   RMW: ${metrics.rmwOps}\n`);

    console.log('⏱️  Latency (µs):');
    console.log(`   Average: ${metrics.avgLatencyUs.toFixed(2)}`);
    console.log(`   Min: ${metrics.minLatencyUs.toFixed(2)}`);
    console.log(`   Max: ${metrics.maxLatencyUs.toFixed(2)}`);
    console.log(`   p50: ${metrics.p50LatencyUs.toFixed(2)}`);
    console.log(`   p90: ${metrics.p90LatencyUs.toFixed(2)}`);
    console.log(`   p95: ${metrics.p95LatencyUs.toFixed(2)}`);
    console.log(`   p99: ${metrics.p99LatencyUs.toFixed(2)}`);
    console.log(`   p99.9: ${metrics.p999LatencyUs.toFixed(2)}\n`);

    console.log('📋 Per-Operation Latency (µs):');
    if (metrics.readOps > 0) console.log(`   Read: ${metrics.readAvgLatencyUs.toFixed(2)}`);
    if (metrics.updateOps > 0) console.log(`   Update: ${metrics.updateAvgLatencyUs.toFixed(2)}`);
    if (metrics.insertOps > 0) console.log(`   Insert: ${metrics.insertAvgLatencyUs.toFixed(2)}`);
    if (metrics.scanOps > 0) console.log(`   Scan: ${metrics.scanAvgLatencyUs.toFixed(2)}`);
    if (metrics.rmwOps > 0) console.log(`   RMW: ${metrics.rmwAvgLatencyUs.toFixed(2)}`);
    console.log('');
  }
}

// ============================================================================
// CLI EXECUTION
// ============================================================================

const isMainModule = import.meta.url === `file://${process.argv[1]}` ||
    process.argv[1]?.endsWith('ycsb-workload.ts');

if (isMainModule) {
  const workloadArg = process.argv[2]?.toLowerCase() || 'a';
  const workload = (Object.values(YcsbWorkloadType).find(w => w === workloadArg) 
    || YcsbWorkloadType.A) as YcsbWorkloadType;

  const ycsbWorkload = new YcsbWorkload({
    workload,
    recordCount: 10000,
    operationCount: 1000,
  });

  ycsbWorkload.run({
    durationMs: 30000,
    maxOperations: 1000,
    concurrency: 1,
  }).then(metrics => {
    console.log('\n✅ YCSB Benchmark Complete');
    console.log(JSON.stringify(metrics, null, 2));
  }).catch(console.error);
}
