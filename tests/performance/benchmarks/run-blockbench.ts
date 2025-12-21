/**
 * BLOCKBENCH Micro-benchmark Runner
 * 
 * Executes the complete BLOCKBENCH micro-benchmark suite:
 * - DoNothing: Consensus layer baseline
 * - CPUHeavy: Execution layer stress test
 * - IOHeavy: Data model layer stress test
 * - Analytics: Query layer stress test
 * 
 * Based on BLOCKBENCH methodology (SIGMOD 2017)
 */

import { BlockbenchEngine, WorkloadType, DistributionType, BlockbenchConfig } from "./blockbench-framework.js";
import { YcsbWorkload, YcsbWorkloadType } from "./ycsb-workload.js";
import { SmallbankWorkload } from "./smallbank-workload.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// BENCHMARK CONFIGURATIONS
// ============================================================================

const MICRO_BENCHMARK_CONFIGS = {
  doNothing: {
    name: "DoNothing Consensus Stress Test",
    description: "Measures pure consensus overhead without execution or storage",
    workloadType: WorkloadType.DO_NOTHING,
    warmupIterations: 100,
    testIterations: 1000,
    concurrency: 1,
  } as BlockbenchConfig,

  cpuHeavySort: {
    name: "CPUHeavy Sort - Execution Layer",
    description: "Quicksort algorithm to stress BPF/SBF VM",
    workloadType: WorkloadType.CPU_HEAVY_SORT,
    warmupIterations: 50,
    testIterations: 500,
    concurrency: 1,
  } as BlockbenchConfig,

  cpuHeavyLoop: {
    name: "CPUHeavy Loop - Execution Layer",
    description: "Tight loop with mathematical operations",
    workloadType: WorkloadType.CPU_HEAVY_LOOP,
    warmupIterations: 50,
    testIterations: 500,
    concurrency: 1,
  } as BlockbenchConfig,

  cpuHeavyHash: {
    name: "CPUHeavy Hash - Execution Layer",
    description: "Iterative SHA-256 hashing",
    workloadType: WorkloadType.CPU_HEAVY_HASH,
    warmupIterations: 50,
    testIterations: 500,
    concurrency: 1,
  } as BlockbenchConfig,

  ioHeavyWrite: {
    name: "IOHeavy Write - Data Model Layer",
    description: "Sequential write operations to storage",
    workloadType: WorkloadType.IO_HEAVY_WRITE,
    warmupIterations: 50,
    testIterations: 500,
    concurrency: 1,
  } as BlockbenchConfig,

  ioHeavyRead: {
    name: "IOHeavy Read - Data Model Layer",
    description: "Random read operations from storage",
    workloadType: WorkloadType.IO_HEAVY_READ,
    warmupIterations: 50,
    testIterations: 500,
    concurrency: 1,
  } as BlockbenchConfig,

  ioHeavyMixed: {
    name: "IOHeavy Mixed - Data Model Layer",
    description: "Mixed read/write operations",
    workloadType: WorkloadType.IO_HEAVY_MIXED,
    warmupIterations: 50,
    testIterations: 500,
    concurrency: 1,
  } as BlockbenchConfig,
};

const YCSB_CONFIGS = {
  ycsbA: {
    name: "YCSB Workload A - Update Heavy",
    description: "50% read, 50% update",
    workloadType: WorkloadType.YCSB_A,
    warmupIterations: 100,
    testIterations: 1000,
    concurrency: 1,
    recordCount: 10000,
    readRatio: 50,
    updateRatio: 50,
    distribution: DistributionType.ZIPFIAN,
  } as BlockbenchConfig,

  ycsbB: {
    name: "YCSB Workload B - Read Heavy",
    description: "95% read, 5% update",
    workloadType: WorkloadType.YCSB_B,
    warmupIterations: 100,
    testIterations: 1000,
    concurrency: 1,
    recordCount: 10000,
    readRatio: 95,
    updateRatio: 5,
    distribution: DistributionType.ZIPFIAN,
  } as BlockbenchConfig,

  ycsbC: {
    name: "YCSB Workload C - Read Only",
    description: "100% read",
    workloadType: WorkloadType.YCSB_C,
    warmupIterations: 100,
    testIterations: 1000,
    concurrency: 1,
    recordCount: 10000,
    readRatio: 100,
    updateRatio: 0,
    distribution: DistributionType.ZIPFIAN,
  } as BlockbenchConfig,

  ycsbF: {
    name: "YCSB Workload F - Read-Modify-Write",
    description: "50% read, 50% RMW",
    workloadType: WorkloadType.YCSB_F,
    warmupIterations: 100,
    testIterations: 1000,
    concurrency: 1,
    recordCount: 10000,
    readRatio: 50,
    updateRatio: 50,
    distribution: DistributionType.ZIPFIAN,
  } as BlockbenchConfig,
};

// ============================================================================
// BENCHMARK SUITE RUNNER
// ============================================================================

interface BenchmarkSuiteResults {
  timestamp: string;
  environment: string;
  microBenchmarks: Record<string, any>;
  macroBenchmarks: Record<string, any>;
  summary: BenchmarkSummary;
}

interface BenchmarkSummary {
  totalBenchmarks: number;
  completedBenchmarks: number;
  failedBenchmarks: number;
  totalDurationSeconds: number;
  consensusLayerTps: number;
  executionLayerTps: number;
  dataModelLayerTps: number;
  ycsbThroughput: number;
  smallbankThroughput: number;
}

async function runMicroBenchmarks(engine: BlockbenchEngine): Promise<Record<string, any>> {
  console.log("\n\n▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓");
  console.log("▓                                                             ▓");
  console.log("▓     BLOCKBENCH MICRO-BENCHMARK SUITE                        ▓");
  console.log("▓     Layer-wise Performance Analysis                         ▓");
  console.log("▓                                                             ▓");
  console.log("▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓\n");

  const results: Record<string, any> = {};

  // 1. DoNothing - Consensus Layer
  console.log("\n[1/4] CONSENSUS LAYER TEST");
  console.log("════════════════════════════════════════════════════════════════");
  try {
    const doNothingResults = await engine.runDoNothing(MICRO_BENCHMARK_CONFIGS.doNothing);
    engine.printResults(doNothingResults);
    results.doNothing = doNothingResults;
  } catch (e) {
    console.error("DoNothing benchmark failed:", e);
    results.doNothing = { error: String(e) };
  }

  // 2. CPUHeavy - Execution Layer
  console.log("\n[2/4] EXECUTION LAYER TEST - CPU Heavy");
  console.log("════════════════════════════════════════════════════════════════");
  try {
    // Sort variant (256 elements)
    const cpuSortResults = await engine.runCpuHeavy(
      MICRO_BENCHMARK_CONFIGS.cpuHeavySort,
      "sort",
      256
    );
    engine.printResults(cpuSortResults);
    results.cpuHeavySort = cpuSortResults;
  } catch (e) {
    console.error("CPUHeavy Sort benchmark failed:", e);
    results.cpuHeavySort = { error: String(e) };
  }

  // 3. IOHeavy - Data Model Layer
  console.log("\n[3/4] DATA MODEL LAYER TEST - IO Heavy");
  console.log("════════════════════════════════════════════════════════════════");
  try {
    const ioWriteResults = await engine.runIoHeavy(
      MICRO_BENCHMARK_CONFIGS.ioHeavyWrite,
      "write",
      5
    );
    engine.printResults(ioWriteResults);
    results.ioHeavyWrite = ioWriteResults;
  } catch (e) {
    console.error("IOHeavy Write benchmark failed:", e);
    results.ioHeavyWrite = { error: String(e) };
  }

  // 4. IO Mixed
  console.log("\n[4/4] DATA MODEL LAYER TEST - IO Mixed");
  console.log("════════════════════════════════════════════════════════════════");
  try {
    const ioMixedResults = await engine.runIoHeavy(
      MICRO_BENCHMARK_CONFIGS.ioHeavyMixed,
      "mixed",
      5
    );
    engine.printResults(ioMixedResults);
    results.ioHeavyMixed = ioMixedResults;
  } catch (e) {
    console.error("IOHeavy Mixed benchmark failed:", e);
    results.ioHeavyMixed = { error: String(e) };
  }

  return results;
}

async function runMacroBenchmarks(engine: BlockbenchEngine): Promise<Record<string, any>> {
  console.log("\n\n▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓");
  console.log("▓                                                             ▓");
  console.log("▓     BLOCKBENCH MACRO-BENCHMARK SUITE                        ▓");
  console.log("▓     YCSB & Smallbank Workloads                              ▓");
  console.log("▓                                                             ▓");
  console.log("▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓\n");

  const results: Record<string, any> = {};

  // 1. YCSB Workload A (Update Heavy)
  console.log("\n[1/3] YCSB WORKLOAD A - Update Heavy (50/50)");
  console.log("════════════════════════════════════════════════════════════════");
  try {
    const ycsbAWorkload = new YcsbWorkload({
      workload: YcsbWorkloadType.A,
      recordCount: 10000,
      operationCount: 1000,
    });
    const ycsbAResults = await ycsbAWorkload.run({
      durationMs: 30000,
      maxOperations: 1000,
    });
    results.ycsbA = ycsbAResults;
  } catch (e) {
    console.error("YCSB Workload A failed:", e);
    results.ycsbA = { error: String(e) };
  }

  // 2. YCSB Workload C (Read Only)
  console.log("\n[2/3] YCSB WORKLOAD C - Read Only (100% Read)");
  console.log("════════════════════════════════════════════════════════════════");
  try {
    const ycsbCWorkload = new YcsbWorkload({
      workload: YcsbWorkloadType.C,
      recordCount: 10000,
      operationCount: 1000,
    });
    const ycsbCResults = await ycsbCWorkload.run({
      durationMs: 30000,
      maxOperations: 1000,
    });
    results.ycsbC = ycsbCResults;
  } catch (e) {
    console.error("YCSB Workload C failed:", e);
    results.ycsbC = { error: String(e) };
  }

  // 3. Smallbank
  console.log("\n[3/3] SMALLBANK - OLTP Banking Workload");
  console.log("════════════════════════════════════════════════════════════════");
  try {
    const smallbankWorkload = new SmallbankWorkload({
      accountCount: 10000,
      hotspotPercentage: 10,
    });
    const smallbankResults = await smallbankWorkload.run({
      durationMs: 30000,
      concurrency: 5,
    });
    results.smallbank = smallbankResults;
  } catch (e) {
    console.error("Smallbank benchmark failed:", e);
    results.smallbank = { error: String(e) };
  }

  return results;
}

function computeSummary(
  microResults: Record<string, any>,
  macroResults: Record<string, any>
): BenchmarkSummary {
  let completedBenchmarks = 0;
  let failedBenchmarks = 0;

  // Count results
  for (const result of Object.values(microResults)) {
    if (result.error) failedBenchmarks++;
    else completedBenchmarks++;
  }
  for (const result of Object.values(macroResults)) {
    if (result.error) failedBenchmarks++;
    else completedBenchmarks++;
  }

  // Extract TPS values
  const consensusLayerTps = microResults.doNothing?.throughput?.avgTps || 0;
  const executionLayerTps = microResults.cpuHeavySort?.throughput?.avgTps || 0;
  const dataModelLayerTps = microResults.ioHeavyWrite?.throughput?.avgTps || 0;
  const ycsbThroughput = macroResults.ycsbA?.throughput || 0;
  const smallbankThroughput = macroResults.smallbank?.tps || 0;

  // Compute total duration
  const totalDuration = [
    microResults.doNothing?.durationSeconds,
    microResults.cpuHeavySort?.durationSeconds,
    microResults.ioHeavyWrite?.durationSeconds,
    microResults.ioHeavyMixed?.durationSeconds,
  ].filter(d => d).reduce((a, b) => a + b, 0);

  return {
    totalBenchmarks: Object.keys(microResults).length + Object.keys(macroResults).length,
    completedBenchmarks,
    failedBenchmarks,
    totalDurationSeconds: totalDuration,
    consensusLayerTps,
    executionLayerTps,
    dataModelLayerTps,
    ycsbThroughput,
    smallbankThroughput,
  };
}

function printFinalSummary(summary: BenchmarkSummary): void {
  console.log("\n\n");
  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║                                                                  ║");
  console.log("║     BLOCKBENCH SUITE FINAL SUMMARY                               ║");
  console.log("║                                                                  ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");
  console.log("");
  console.log("┌──────────────────────────────────────────────────────────────────┐");
  console.log("│  BENCHMARK EXECUTION STATUS                                      │");
  console.log("├──────────────────────────────────────────────────────────────────┤");
  console.log(`│  Total Benchmarks:    ${summary.totalBenchmarks.toString().padEnd(40)}│`);
  console.log(`│  Completed:           ${summary.completedBenchmarks.toString().padEnd(40)}│`);
  console.log(`│  Failed:              ${summary.failedBenchmarks.toString().padEnd(40)}│`);
  console.log(`│  Duration:            ${summary.totalDurationSeconds.toFixed(2).padEnd(37)}s │`);
  console.log("└──────────────────────────────────────────────────────────────────┘");
  console.log("");
  console.log("┌──────────────────────────────────────────────────────────────────┐");
  console.log("│  LAYER-WISE THROUGHPUT (TPS)                                     │");
  console.log("├──────────────────────────────────────────────────────────────────┤");
  console.log(`│  Consensus Layer:     ${summary.consensusLayerTps.toFixed(2).padEnd(40)}│`);
  console.log(`│  Execution Layer:     ${summary.executionLayerTps.toFixed(2).padEnd(40)}│`);
  console.log(`│  Data Model Layer:    ${summary.dataModelLayerTps.toFixed(2).padEnd(40)}│`);
  console.log("└──────────────────────────────────────────────────────────────────┘");
  console.log("");
  console.log("┌──────────────────────────────────────────────────────────────────┐");
  console.log("│  MACRO-BENCHMARK THROUGHPUT                                      │");
  console.log("├──────────────────────────────────────────────────────────────────┤");
  console.log(`│  YCSB Throughput:     ${summary.ycsbThroughput.toFixed(2).padEnd(37)}ops/s │`);
  console.log(`│  Smallbank Throughput: ${summary.smallbankThroughput.toFixed(2).padEnd(36)}tps │`);
  console.log("└──────────────────────────────────────────────────────────────────┘");
  console.log("");
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("  BLOCKBENCH Analysis Complete");
  console.log("═══════════════════════════════════════════════════════════════════\n");
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main(): Promise<void> {
  console.log("\n");
  console.log("████████████████████████████████████████████████████████████████████");
  console.log("██                                                                ██");
  console.log("██    ██████╗ ██╗      ██████╗  ██████╗██╗  ██╗██████╗ ███████╗   ██");
  console.log("██    ██╔══██╗██║     ██╔═══██╗██╔════╝██║ ██╔╝██╔══██╗██╔════╝   ██");
  console.log("██    ██████╔╝██║     ██║   ██║██║     █████╔╝ ██████╔╝█████╗     ██");
  console.log("██    ██╔══██╗██║     ██║   ██║██║     ██╔═██╗ ██╔══██╗██╔══╝     ██");
  console.log("██    ██████╔╝███████╗╚██████╔╝╚██████╗██║  ██╗██████╔╝███████╗   ██");
  console.log("██    ╚═════╝ ╚══════╝ ╚═════╝  ╚═════╝╚═╝  ╚═╝╚═════╝ ╚══════╝   ██");
  console.log("██                                                                ██");
  console.log("██    Framework for Analyzing Private Blockchain Performance      ██");
  console.log("██    Adapted for Solana/Anchor                                   ██");
  console.log("██                                                                ██");
  console.log("████████████████████████████████████████████████████████████████████\n");

  const startTime = Date.now();

  // Initialize engine
  const engine = new BlockbenchEngine();
  await engine.initialize(100);

  // Run benchmarks
  const microResults = await runMicroBenchmarks(engine);
  const macroResults = await runMacroBenchmarks(engine);

  // Compute summary
  const summary = computeSummary(microResults, macroResults);

  // Compile results
  const suiteResults: BenchmarkSuiteResults = {
    timestamp: new Date().toISOString(),
    environment: "litesvm",
    microBenchmarks: microResults,
    macroBenchmarks: macroResults,
    summary,
  };

  // Print final summary
  printFinalSummary(summary);

  // Save results
  const resultsDir = path.join(__dirname, "../../../test-results/blockbench");
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  const filename = `blockbench-suite-${Date.now()}.json`;
  const filepath = path.join(resultsDir, filename);
  
  fs.writeFileSync(filepath, JSON.stringify(suiteResults, null, 2));
  console.log(`📁 Full results saved to: ${filepath}`);
  
  const totalDuration = (Date.now() - startTime) / 1000;
  console.log(`\n⏱️  Total execution time: ${totalDuration.toFixed(2)} seconds\n`);
}

// Run if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}` ||
    process.argv[1]?.endsWith('run-blockbench.ts');

if (isMainModule) {
  main().catch(console.error);
}

export { main as runBlockbenchSuite };
