/**
 * Throughput Benchmark Tests
 * 
 * Measures sustained TPS under various load conditions
 * For research paper: Transaction throughput analysis
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
} from "./benchmark-engine";

// ============================================================================
// THROUGHPUT TEST CONFIGURATIONS
// ============================================================================

const THROUGHPUT_CONFIGS: BenchmarkConfig[] = [
  {
    name: "baseline_light",
    description: "Light load - 10 concurrent users",
    warmupIterations: 100,
    testIterations: 1000,
    concurrentUsers: 10,
    transactionType: "sol_transfer",
  },
  {
    name: "baseline_medium",
    description: "Medium load - 50 concurrent users",
    warmupIterations: 100,
    testIterations: 2000,
    concurrentUsers: 50,
    transactionType: "sol_transfer",
  },
  {
    name: "baseline_heavy",
    description: "Heavy load - 100 concurrent users",
    warmupIterations: 100,
    testIterations: 3000,
    concurrentUsers: 100,
    transactionType: "sol_transfer",
  },
  {
    name: "stress_test",
    description: "Stress test - 200 concurrent users",
    warmupIterations: 50,
    testIterations: 2000,
    concurrentUsers: 200,
    transactionType: "sol_transfer",
  },
];

// ============================================================================
// THROUGHPUT TEST RUNNER
// ============================================================================

async function runThroughputTest(config: BenchmarkConfig): Promise<BenchmarkResults> {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  📈 Throughput Test: ${config.name}`);
  console.log(`  ${config.description}`);
  console.log(`${"═".repeat(60)}\n`);

  const engine = new BenchmarkEngine();
  await engine.initialize(config.concurrentUsers);

  const measurements: LatencyMeasurement[] = [];
  const windows: ThroughputWindow[] = [];

  // Warmup phase
  console.log(`🔥 Warmup phase (${config.warmupIterations} iterations)...`);
  for (let i = 0; i < config.warmupIterations; i++) {
    const tx = engine.createTransaction(config.transactionType, i);
    engine.executeTransaction(tx, engine.getUser(i));
  }
  console.log("   Warmup complete\n");

  // Test phase
  console.log(`📊 Test phase (${config.testIterations} iterations)...`);
  const testStartTime = performance.now();
  const windowSize = 1000; // 1 second windows
  let windowStartTime = testStartTime;
  let windowTxCount = 0;
  let windowSuccessCount = 0;

  for (let i = 0; i < config.testIterations; i++) {
    const tx = engine.createTransaction(config.transactionType, i);
    const measurement = engine.executeTransaction(tx, engine.getUser(i));
    measurements.push(measurement);

    windowTxCount++;
    if (measurement.success) windowSuccessCount++;

    // Check if we should close this window
    const currentTime = performance.now();
    if (currentTime - windowStartTime >= windowSize) {
      const windowDuration = (currentTime - windowStartTime) / 1000;
      windows.push({
        startTime: windowStartTime,
        endTime: currentTime,
        transactions: windowTxCount,
        successful: windowSuccessCount,
        tps: windowTxCount / windowDuration,
      });

      // Progress update
      const progress = ((i + 1) / config.testIterations * 100).toFixed(1);
      const currentTps = (windowTxCount / windowDuration).toFixed(1);
      process.stdout.write(`\r   Progress: ${progress}% | Current TPS: ${currentTps}    `);

      // Reset window
      windowStartTime = currentTime;
      windowTxCount = 0;
      windowSuccessCount = 0;
    }
  }

  // Close final window
  const testEndTime = performance.now();
  if (windowTxCount > 0) {
    const windowDuration = (testEndTime - windowStartTime) / 1000;
    windows.push({
      startTime: windowStartTime,
      endTime: testEndTime,
      transactions: windowTxCount,
      successful: windowSuccessCount,
      tps: windowTxCount / windowDuration,
    });
  }

  console.log("\n\n   Test complete\n");

  // Calculate statistics
  const latencyStats = calculateLatencyStatistics(measurements);
  const throughputStats = calculateThroughputStatistics(windows, testEndTime - testStartTime);
  const cuStats = calculateComputeUnitStats(measurements);

  // Print summary
  console.log("📊 Results Summary:");
  console.log(`   Total Transactions: ${throughputStats.totalTransactions}`);
  console.log(`   Success Rate: ${latencyStats.successRate.toFixed(2)}%`);
  console.log(`   Duration: ${throughputStats.durationSeconds.toFixed(2)}s`);
  console.log(`\n   Throughput:`);
  console.log(`     Average TPS: ${throughputStats.avgTps.toFixed(2)}`);
  console.log(`     Peak TPS: ${throughputStats.peakTps.toFixed(2)}`);
  console.log(`     Sustained TPS: ${throughputStats.sustainedTps.toFixed(2)}`);
  console.log(`\n   Latency:`);
  console.log(`     Average: ${latencyStats.avgMs.toFixed(2)}ms`);
  console.log(`     p50: ${latencyStats.p50Ms.toFixed(2)}ms`);
  console.log(`     p95: ${latencyStats.p95Ms.toFixed(2)}ms`);
  console.log(`     p99: ${latencyStats.p99Ms.toFixed(2)}ms`);

  const results: BenchmarkResults = {
    testId: `throughput_${config.name}`,
    testName: config.name,
    timestamp: new Date().toISOString(),
    environment: "litesvm",
    config,
    latencyResults: {
      measurements,
      statistics: latencyStats,
    },
    throughputResults: {
      windows,
      statistics: throughputStats,
    },
    resourceResults: {
      computeUnits: cuStats,
    },
  };

  return results;
}

// ============================================================================
// SUSTAINED THROUGHPUT TEST
// ============================================================================

async function runSustainedThroughputTest(
  durationSeconds: number = 60,
  targetTps: number = 100
): Promise<BenchmarkResults> {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  📈 Sustained Throughput Test`);
  console.log(`  Duration: ${durationSeconds}s | Target TPS: ${targetTps}`);
  console.log(`${"═".repeat(60)}\n`);

  const engine = new BenchmarkEngine();
  await engine.initialize(200);

  const measurements: LatencyMeasurement[] = [];
  const windows: ThroughputWindow[] = [];

  // Calculate delay between transactions to achieve target TPS
  const delayMs = 1000 / targetTps;
  
  console.log(`📊 Running sustained test...`);
  const testStartTime = performance.now();
  const testEndTime = testStartTime + (durationSeconds * 1000);
  
  let windowStartTime = testStartTime;
  let windowTxCount = 0;
  let windowSuccessCount = 0;
  let txIndex = 0;

  while (performance.now() < testEndTime) {
    const tx = engine.createTransaction("sol_transfer", txIndex);
    const measurement = engine.executeTransaction(tx, engine.getUser(txIndex));
    measurements.push(measurement);
    
    windowTxCount++;
    if (measurement.success) windowSuccessCount++;
    txIndex++;

    // Check window
    const currentTime = performance.now();
    if (currentTime - windowStartTime >= 1000) {
      const windowDuration = (currentTime - windowStartTime) / 1000;
      windows.push({
        startTime: windowStartTime,
        endTime: currentTime,
        transactions: windowTxCount,
        successful: windowSuccessCount,
        tps: windowTxCount / windowDuration,
      });

      const elapsed = (currentTime - testStartTime) / 1000;
      const currentTps = (windowTxCount / windowDuration).toFixed(1);
      process.stdout.write(`\r   Elapsed: ${elapsed.toFixed(0)}s | TPS: ${currentTps}    `);

      windowStartTime = currentTime;
      windowTxCount = 0;
      windowSuccessCount = 0;
    }

    // Minimal delay to prevent CPU saturation (optional)
    // In LiteSVM, we can push as fast as possible
  }

  // Close final window
  const finalTime = performance.now();
  if (windowTxCount > 0) {
    windows.push({
      startTime: windowStartTime,
      endTime: finalTime,
      transactions: windowTxCount,
      successful: windowSuccessCount,
      tps: windowTxCount / ((finalTime - windowStartTime) / 1000),
    });
  }

  console.log("\n\n   Test complete\n");

  const latencyStats = calculateLatencyStatistics(measurements);
  const throughputStats = calculateThroughputStatistics(windows, finalTime - testStartTime);
  const cuStats = calculateComputeUnitStats(measurements);

  console.log("📊 Sustained Test Results:");
  console.log(`   Total Transactions: ${throughputStats.totalTransactions}`);
  console.log(`   Sustained TPS: ${throughputStats.sustainedTps.toFixed(2)}`);
  console.log(`   Peak TPS: ${throughputStats.peakTps.toFixed(2)}`);
  console.log(`   Average Latency: ${latencyStats.avgMs.toFixed(2)}ms`);

  const config: BenchmarkConfig = {
    name: "sustained_throughput",
    description: `Sustained throughput test for ${durationSeconds}s`,
    warmupIterations: 0,
    testIterations: measurements.length,
    concurrentUsers: 200,
    transactionType: "sol_transfer",
  };

  return {
    testId: `sustained_${durationSeconds}s`,
    testName: "sustained_throughput",
    timestamp: new Date().toISOString(),
    environment: "litesvm",
    config,
    latencyResults: { measurements, statistics: latencyStats },
    throughputResults: { windows, statistics: throughputStats },
    resourceResults: { computeUnits: cuStats },
  };
}

// ============================================================================
// MAIN RUNNER
// ============================================================================

async function main() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║     GridTokenX Throughput Benchmark Suite                  ║");
  console.log("║     For Research Paper Analysis                            ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  const allResults: BenchmarkResults[] = [];

  // Run each configuration
  for (const config of THROUGHPUT_CONFIGS) {
    try {
      const results = await runThroughputTest(config);
      allResults.push(results);
      saveResults(results);
      exportLatenciesToCSV(
        results.latencyResults.measurements,
        `latencies-${config.name}.csv`
      );
    } catch (error) {
      console.error(`Error in test ${config.name}:`, error);
    }
  }

  // Run sustained test
  try {
    const sustainedResults = await runSustainedThroughputTest(30, 100);
    allResults.push(sustainedResults);
    saveResults(sustainedResults);
  } catch (error) {
    console.error("Error in sustained test:", error);
  }

  // Print final summary
  console.log("\n" + "═".repeat(60));
  console.log("  📊 FINAL SUMMARY");
  console.log("═".repeat(60) + "\n");

  console.log("| Test Name           | Avg TPS  | Peak TPS | Avg Latency | p99 Latency |");
  console.log("|---------------------|----------|----------|-------------|-------------|");
  
  for (const result of allResults) {
    const tp = result.throughputResults.statistics;
    const lat = result.latencyResults.statistics;
    console.log(
      `| ${result.testName.padEnd(19)} | ${tp.avgTps.toFixed(1).padStart(8)} | ${tp.peakTps.toFixed(1).padStart(8)} | ${lat.avgMs.toFixed(2).padStart(9)}ms | ${lat.p99Ms.toFixed(2).padStart(9)}ms |`
    );
  }

  console.log("\n✅ All benchmarks complete!");
  console.log(`📁 Results saved to: test-results/benchmark/`);
}

main().catch(console.error);
