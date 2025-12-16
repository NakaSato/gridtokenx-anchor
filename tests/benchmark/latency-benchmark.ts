/**
 * Latency Distribution Benchmark Tests
 * 
 * Detailed latency analysis with percentile distributions
 * For research paper: Transaction latency characterization
 */

import {
  BenchmarkEngine,
  BenchmarkConfig,
  BenchmarkResults,
  LatencyMeasurement,
  ThroughputWindow,
  calculateLatencyStatistics,
  calculateThroughputStatistics,
  calculateComputeUnitStats,
  saveResults,
  exportLatenciesToCSV,
  RESULTS_PATH,
} from "./benchmark-engine";
import * as fs from "fs";
import * as path from "path";

// ============================================================================
// LATENCY TEST CONFIGURATIONS
// ============================================================================

interface LatencyTestConfig {
  name: string;
  description: string;
  iterations: number;
  warmupIterations: number;
  delayBetweenTxMs: number; // Delay between transactions
}

const LATENCY_CONFIGS: LatencyTestConfig[] = [
  {
    name: "cold_start",
    description: "Cold start latency - first transactions",
    iterations: 100,
    warmupIterations: 0,
    delayBetweenTxMs: 100,
  },
  {
    name: "warm_sequential",
    description: "Warm state - sequential transactions",
    iterations: 1000,
    warmupIterations: 100,
    delayBetweenTxMs: 0,
  },
  {
    name: "burst_mode",
    description: "Burst mode - rapid fire transactions",
    iterations: 5000,
    warmupIterations: 200,
    delayBetweenTxMs: 0,
  },
  {
    name: "paced_realistic",
    description: "Paced mode - realistic intervals",
    iterations: 500,
    warmupIterations: 50,
    delayBetweenTxMs: 10,
  },
];

// ============================================================================
// LATENCY DISTRIBUTION ANALYZER
// ============================================================================

interface LatencyDistribution {
  buckets: Map<number, number>; // bucket_ms -> count
  histogram: { range: string; count: number; percentage: number }[];
}

function analyzeLatencyDistribution(measurements: LatencyMeasurement[]): LatencyDistribution {
  const successfulLatencies = measurements.filter(m => m.success).map(m => m.latencyMs);
  const buckets = new Map<number, number>();

  // Define bucket ranges (0-1ms, 1-2ms, 2-5ms, 5-10ms, 10-20ms, 20-50ms, 50-100ms, 100+ms)
  const ranges = [1, 2, 5, 10, 20, 50, 100, Infinity];
  const labels = ["0-1ms", "1-2ms", "2-5ms", "5-10ms", "10-20ms", "20-50ms", "50-100ms", "100+ms"];

  ranges.forEach(r => buckets.set(r, 0));

  for (const latency of successfulLatencies) {
    for (const range of ranges) {
      if (latency <= range) {
        buckets.set(range, (buckets.get(range) || 0) + 1);
        break;
      }
    }
  }

  const total = successfulLatencies.length;
  const histogram = ranges.map((range, i) => ({
    range: labels[i],
    count: buckets.get(range) || 0,
    percentage: total > 0 ? ((buckets.get(range) || 0) / total) * 100 : 0,
  }));

  return { buckets, histogram };
}

function printHistogram(histogram: { range: string; count: number; percentage: number }[]): void {
  console.log("\n   Latency Distribution Histogram:");
  console.log("   " + "─".repeat(50));

  const maxCount = Math.max(...histogram.map(h => h.count));
  const barWidth = 30;

  for (const bucket of histogram) {
    const barLength = maxCount > 0 ? Math.round((bucket.count / maxCount) * barWidth) : 0;
    const bar = "█".repeat(barLength) + "░".repeat(barWidth - barLength);
    console.log(
      `   ${bucket.range.padEnd(10)} | ${bar} | ${bucket.count.toString().padStart(5)} (${bucket.percentage.toFixed(1)}%)`
    );
  }
}

// ============================================================================
// LATENCY TEST RUNNER
// ============================================================================

async function runLatencyTest(config: LatencyTestConfig): Promise<{
  measurements: LatencyMeasurement[];
  distribution: LatencyDistribution;
}> {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ⏱️  Latency Test: ${config.name}`);
  console.log(`  ${config.description}`);
  console.log(`${"═".repeat(60)}\n`);

  const engine = new BenchmarkEngine();
  await engine.initialize(50);

  const measurements: LatencyMeasurement[] = [];

  // Warmup phase
  if (config.warmupIterations > 0) {
    console.log(`🔥 Warmup phase (${config.warmupIterations} iterations)...`);
    for (let i = 0; i < config.warmupIterations; i++) {
      const tx = engine.createTransaction("sol_transfer", i);
      engine.executeTransaction(tx, engine.getUser(i));
    }
    console.log("   Warmup complete\n");
  }

  // Test phase
  console.log(`📊 Test phase (${config.iterations} iterations)...`);
  const startTime = performance.now();

  for (let i = 0; i < config.iterations; i++) {
    const tx = engine.createTransaction("sol_transfer", i);
    const measurement = engine.executeTransaction(tx, engine.getUser(i));
    measurements.push(measurement);

    // Progress update every 10%
    if ((i + 1) % Math.floor(config.iterations / 10) === 0) {
      const progress = ((i + 1) / config.iterations * 100).toFixed(0);
      process.stdout.write(`\r   Progress: ${progress}%`);
    }

    // Optional delay between transactions
    if (config.delayBetweenTxMs > 0) {
      await new Promise(resolve => setTimeout(resolve, config.delayBetweenTxMs));
    }
  }

  const duration = performance.now() - startTime;
  console.log(`\n   Test complete (${(duration / 1000).toFixed(2)}s)\n`);

  // Analyze distribution
  const distribution = analyzeLatencyDistribution(measurements);
  const stats = calculateLatencyStatistics(measurements);

  // Print results
  console.log("📊 Latency Statistics:");
  console.log(`   Sample Size: ${stats.count}`);
  console.log(`   Success Rate: ${stats.successRate.toFixed(2)}%`);
  console.log(`\n   Latency Percentiles:`);
  console.log(`     Min:    ${stats.minMs.toFixed(3)}ms`);
  console.log(`     p50:    ${stats.p50Ms.toFixed(3)}ms`);
  console.log(`     p75:    ${stats.p75Ms.toFixed(3)}ms`);
  console.log(`     p90:    ${stats.p90Ms.toFixed(3)}ms`);
  console.log(`     p95:    ${stats.p95Ms.toFixed(3)}ms`);
  console.log(`     p99:    ${stats.p99Ms.toFixed(3)}ms`);
  console.log(`     Max:    ${stats.maxMs.toFixed(3)}ms`);
  console.log(`     Avg:    ${stats.avgMs.toFixed(3)}ms`);
  console.log(`     StdDev: ${stats.stdDevMs.toFixed(3)}ms`);

  printHistogram(distribution.histogram);

  return { measurements, distribution };
}

// ============================================================================
// COMPARATIVE LATENCY ANALYSIS
// ============================================================================

interface ComparativeResult {
  testName: string;
  stats: ReturnType<typeof calculateLatencyStatistics>;
  distribution: LatencyDistribution;
}

async function runComparativeAnalysis(): Promise<ComparativeResult[]> {
  console.log("\n" + "═".repeat(60));
  console.log("  📊 COMPARATIVE LATENCY ANALYSIS");
  console.log("═".repeat(60) + "\n");

  const results: ComparativeResult[] = [];

  for (const config of LATENCY_CONFIGS) {
    const { measurements, distribution } = await runLatencyTest(config);
    const stats = calculateLatencyStatistics(measurements);

    results.push({
      testName: config.name,
      stats,
      distribution,
    });

    // Export individual CSV
    exportLatenciesToCSV(measurements, `latency-${config.name}.csv`);
  }

  // Print comparison table
  console.log("\n" + "═".repeat(80));
  console.log("  COMPARISON TABLE");
  console.log("═".repeat(80) + "\n");

  console.log("| Test Name        | Count | Avg (ms) | p50 (ms) | p95 (ms) | p99 (ms) | Max (ms) |");
  console.log("|------------------|-------|----------|----------|----------|----------|----------|");

  for (const result of results) {
    const s = result.stats;
    console.log(
      `| ${result.testName.padEnd(16)} | ${s.count.toString().padStart(5)} | ${s.avgMs.toFixed(2).padStart(8)} | ${s.p50Ms.toFixed(2).padStart(8)} | ${s.p95Ms.toFixed(2).padStart(8)} | ${s.p99Ms.toFixed(2).padStart(8)} | ${s.maxMs.toFixed(2).padStart(8)} |`
    );
  }

  return results;
}

// ============================================================================
// LATENCY UNDER LOAD ANALYSIS
// ============================================================================

async function runLatencyUnderLoad(): Promise<void> {
  console.log("\n" + "═".repeat(60));
  console.log("  📈 LATENCY UNDER LOAD ANALYSIS");
  console.log("═".repeat(60) + "\n");

  const loadLevels = [10, 25, 50, 100, 200];
  const resultsPerLoad: { load: number; stats: ReturnType<typeof calculateLatencyStatistics> }[] = [];

  for (const load of loadLevels) {
    console.log(`\n📊 Testing with ${load} concurrent simulated users...`);
    
    const engine = new BenchmarkEngine();
    await engine.initialize(load);

    const measurements: LatencyMeasurement[] = [];
    const iterations = 500;

    // Warmup
    for (let i = 0; i < 50; i++) {
      const tx = engine.createTransaction("sol_transfer", i);
      engine.executeTransaction(tx, engine.getUser(i));
    }

    // Test
    for (let i = 0; i < iterations; i++) {
      const tx = engine.createTransaction("sol_transfer", i);
      const measurement = engine.executeTransaction(tx, engine.getUser(i));
      measurements.push(measurement);
    }

    const stats = calculateLatencyStatistics(measurements);
    resultsPerLoad.push({ load, stats });

    console.log(`   Load ${load}: Avg=${stats.avgMs.toFixed(2)}ms, p99=${stats.p99Ms.toFixed(2)}ms`);
  }

  // Print load vs latency table
  console.log("\n" + "─".repeat(60));
  console.log("  LOAD vs LATENCY ANALYSIS");
  console.log("─".repeat(60) + "\n");

  console.log("| Concurrent Users | Avg Latency | p50 Latency | p95 Latency | p99 Latency |");
  console.log("|------------------|-------------|-------------|-------------|-------------|");

  for (const { load, stats } of resultsPerLoad) {
    console.log(
      `| ${load.toString().padStart(16)} | ${stats.avgMs.toFixed(2).padStart(9)}ms | ${stats.p50Ms.toFixed(2).padStart(9)}ms | ${stats.p95Ms.toFixed(2).padStart(9)}ms | ${stats.p99Ms.toFixed(2).padStart(9)}ms |`
    );
  }

  // Export for research paper
  const exportData = resultsPerLoad.map(r => ({
    concurrentUsers: r.load,
    avgLatencyMs: r.stats.avgMs,
    p50LatencyMs: r.stats.p50Ms,
    p95LatencyMs: r.stats.p95Ms,
    p99LatencyMs: r.stats.p99Ms,
    maxLatencyMs: r.stats.maxMs,
  }));

  if (!fs.existsSync(RESULTS_PATH)) {
    fs.mkdirSync(RESULTS_PATH, { recursive: true });
  }

  fs.writeFileSync(
    path.join(RESULTS_PATH, "latency-under-load.json"),
    JSON.stringify(exportData, null, 2)
  );
  console.log(`\n📁 Results saved to: test-results/benchmark/latency-under-load.json`);
}

// ============================================================================
// MAIN RUNNER
// ============================================================================

async function main() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║     GridTokenX Latency Benchmark Suite                     ║");
  console.log("║     For Research Paper Analysis                            ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  // Run comparative analysis
  const comparativeResults = await runComparativeAnalysis();

  // Run latency under load
  await runLatencyUnderLoad();

  console.log("\n" + "═".repeat(60));
  console.log("  ✅ ALL LATENCY BENCHMARKS COMPLETE");
  console.log("═".repeat(60));
  console.log(`\n📁 Results saved to: test-results/benchmark/`);
}

main().catch(console.error);
