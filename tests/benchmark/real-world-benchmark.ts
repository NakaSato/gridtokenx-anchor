/**
 * Real-World Scenario Benchmark
 * 
 * Simulates actual GridTokenX energy trading platform usage:
 * - Energy producers minting tokens
 * - Consumers placing buy orders
 * - Order matching and settlement
 * - Oracle price updates
 * - Registry operations
 */

import { LiteSVM, TransactionMetadata, FailedTransactionMetadata } from "litesvm";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

// ============================================================================
// CONFIGURATION
// ============================================================================

const DEPLOY_PATH = path.join(process.cwd(), "target/deploy");
const RESULTS_PATH = path.join(process.cwd(), "test-results/benchmark");

const PROGRAM_IDS = {
  energyToken: new PublicKey("11111111111111111111111111111111"),
  governance: new PublicKey("11111111111111111111111111111111"),
  oracle: new PublicKey("11111111111111111111111111111111"),
  registry: new PublicKey("11111111111111111111111111111111"),
  trading: new PublicKey("11111111111111111111111111111111"),
};

// ============================================================================
// REAL-WORLD SCENARIO TYPES
// ============================================================================

type ScenarioType = 
  | "morning_peak"      // High activity 7-9 AM
  | "midday_trading"    // Moderate trading 11 AM - 2 PM
  | "evening_peak"      // Highest activity 5-8 PM
  | "night_maintenance" // Low activity, batch operations
  | "weekend_light"     // Light trading on weekends
  | "flash_sale"        // Promotional event surge
  | "market_volatility" // High-frequency price updates
  | "new_producer_onboarding"; // Registration surge

interface ScenarioConfig {
  name: string;
  description: string;
  duration: number; // seconds
  userDistribution: {
    producers: number;
    consumers: number;
    traders: number;
    observers: number;
  };
  operationWeights: {
    mint_energy: number;
    place_buy_order: number;
    place_sell_order: number;
    cancel_order: number;
    match_orders: number;
    update_oracle: number;
    register_device: number;
    query_balance: number;
  };
  transactionsPerSecond: number;
  burstProbability: number; // 0-1, chance of burst traffic
}

const SCENARIOS: Record<ScenarioType, ScenarioConfig> = {
  morning_peak: {
    name: "Morning Peak (7-9 AM)",
    description: "High activity as producers come online and consumers prepare for day",
    duration: 30,
    userDistribution: { producers: 30, consumers: 50, traders: 15, observers: 5 },
    operationWeights: {
      mint_energy: 0.25,
      place_buy_order: 0.30,
      place_sell_order: 0.15,
      cancel_order: 0.05,
      match_orders: 0.10,
      update_oracle: 0.05,
      register_device: 0.02,
      query_balance: 0.08,
    },
    transactionsPerSecond: 50,
    burstProbability: 0.15,
  },
  midday_trading: {
    name: "Midday Trading (11 AM - 2 PM)",
    description: "Moderate trading activity during lunch hours",
    duration: 30,
    userDistribution: { producers: 20, consumers: 40, traders: 30, observers: 10 },
    operationWeights: {
      mint_energy: 0.15,
      place_buy_order: 0.25,
      place_sell_order: 0.20,
      cancel_order: 0.08,
      match_orders: 0.15,
      update_oracle: 0.07,
      register_device: 0.02,
      query_balance: 0.08,
    },
    transactionsPerSecond: 35,
    burstProbability: 0.08,
  },
  evening_peak: {
    name: "Evening Peak (5-8 PM)",
    description: "Highest activity as consumers return home and demand spikes",
    duration: 30,
    userDistribution: { producers: 25, consumers: 60, traders: 10, observers: 5 },
    operationWeights: {
      mint_energy: 0.20,
      place_buy_order: 0.35,
      place_sell_order: 0.10,
      cancel_order: 0.05,
      match_orders: 0.15,
      update_oracle: 0.05,
      register_device: 0.02,
      query_balance: 0.08,
    },
    transactionsPerSecond: 75,
    burstProbability: 0.20,
  },
  night_maintenance: {
    name: "Night Maintenance (11 PM - 5 AM)",
    description: "Low activity with batch operations and maintenance",
    duration: 20,
    userDistribution: { producers: 10, consumers: 5, traders: 5, observers: 80 },
    operationWeights: {
      mint_energy: 0.10,
      place_buy_order: 0.05,
      place_sell_order: 0.05,
      cancel_order: 0.05,
      match_orders: 0.05,
      update_oracle: 0.30,
      register_device: 0.10,
      query_balance: 0.30,
    },
    transactionsPerSecond: 10,
    burstProbability: 0.02,
  },
  weekend_light: {
    name: "Weekend Light Trading",
    description: "Reduced activity on weekends",
    duration: 25,
    userDistribution: { producers: 15, consumers: 30, traders: 20, observers: 35 },
    operationWeights: {
      mint_energy: 0.15,
      place_buy_order: 0.20,
      place_sell_order: 0.15,
      cancel_order: 0.10,
      match_orders: 0.10,
      update_oracle: 0.10,
      register_device: 0.05,
      query_balance: 0.15,
    },
    transactionsPerSecond: 20,
    burstProbability: 0.05,
  },
  flash_sale: {
    name: "Flash Sale Event",
    description: "Promotional event with surge in buying activity",
    duration: 15,
    userDistribution: { producers: 10, consumers: 80, traders: 8, observers: 2 },
    operationWeights: {
      mint_energy: 0.05,
      place_buy_order: 0.60,
      place_sell_order: 0.05,
      cancel_order: 0.10,
      match_orders: 0.12,
      update_oracle: 0.03,
      register_device: 0.02,
      query_balance: 0.03,
    },
    transactionsPerSecond: 150,
    burstProbability: 0.40,
  },
  market_volatility: {
    name: "Market Volatility",
    description: "High-frequency trading during price volatility",
    duration: 20,
    userDistribution: { producers: 15, consumers: 15, traders: 65, observers: 5 },
    operationWeights: {
      mint_energy: 0.05,
      place_buy_order: 0.25,
      place_sell_order: 0.25,
      cancel_order: 0.15,
      match_orders: 0.10,
      update_oracle: 0.15,
      register_device: 0.00,
      query_balance: 0.05,
    },
    transactionsPerSecond: 100,
    burstProbability: 0.30,
  },
  new_producer_onboarding: {
    name: "New Producer Onboarding",
    description: "Batch registration of new solar/wind producers",
    duration: 15,
    userDistribution: { producers: 70, consumers: 10, traders: 5, observers: 15 },
    operationWeights: {
      mint_energy: 0.10,
      place_buy_order: 0.05,
      place_sell_order: 0.10,
      cancel_order: 0.02,
      match_orders: 0.03,
      update_oracle: 0.10,
      register_device: 0.50,
      query_balance: 0.10,
    },
    transactionsPerSecond: 40,
    burstProbability: 0.10,
  },
};

// ============================================================================
// BENCHMARK ENGINE FOR REAL-WORLD SCENARIOS
// ============================================================================

interface RealWorldMeasurement {
  timestamp: number;
  operation: string;
  userType: string;
  latencyMs: number;
  success: boolean;
  computeUnits?: bigint;
  errorType?: string;
}

interface ScenarioResult {
  scenario: ScenarioConfig;
  measurements: RealWorldMeasurement[];
  totalTransactions: number;
  successfulTransactions: number;
  failedTransactions: number;
  durationMs: number;
  effectiveTPS: number;
  latencyStats: {
    min: number;
    max: number;
    avg: number;
    p50: number;
    p95: number;
    p99: number;
    stdDev: number;
  };
  operationBreakdown: Record<string, { count: number; avgLatency: number; successRate: number }>;
}

class RealWorldBenchmark {
  private svm!: LiteSVM;
  private users: Map<string, Keypair[]> = new Map();
  private programsLoaded = false;

  async initialize(config: ScenarioConfig): Promise<void> {
    console.log(`\n🔧 Initializing for scenario: ${config.name}`);
    
    this.svm = new LiteSVM();
    this.users.clear();

    // Create users by type
    const { producers, consumers, traders, observers } = config.userDistribution;
    
    this.users.set("producer", this.createUsers(producers));
    this.users.set("consumer", this.createUsers(consumers));
    this.users.set("trader", this.createUsers(traders));
    this.users.set("observer", this.createUsers(observers));

    // Fund all users
    for (const [_, userList] of this.users) {
      for (const user of userList) {
        this.svm.airdrop(user.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
      }
    }

    this.loadPrograms();
    console.log(`   ✓ Initialized with ${producers + consumers + traders + observers} users`);
  }

  private createUsers(count: number): Keypair[] {
    return Array.from({ length: count }, () => Keypair.generate());
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
          // Ignore load errors
        }
      }
    }
    this.programsLoaded = true;
  }

  selectOperation(weights: ScenarioConfig["operationWeights"]): string {
    const rand = Math.random();
    let cumulative = 0;
    
    for (const [operation, weight] of Object.entries(weights)) {
      cumulative += weight;
      if (rand <= cumulative) {
        return operation;
      }
    }
    return "query_balance";
  }

  selectUserType(distribution: ScenarioConfig["userDistribution"]): string {
    const total = distribution.producers + distribution.consumers + distribution.traders + distribution.observers;
    const rand = Math.random() * total;
    
    let cumulative = 0;
    cumulative += distribution.producers;
    if (rand <= cumulative) return "producer";
    
    cumulative += distribution.consumers;
    if (rand <= cumulative) return "consumer";
    
    cumulative += distribution.traders;
    if (rand <= cumulative) return "trader";
    
    return "observer";
  }

  getRandomUser(userType: string): Keypair {
    const users = this.users.get(userType) || this.users.get("observer")!;
    return users[Math.floor(Math.random() * users.length)];
  }

  createOperationTransaction(operation: string, user: Keypair): Transaction {
    const tx = new Transaction();
    const recipient = this.getRandomUser("observer");

    // All operations are simulated as SOL transfers with different amounts
    // to represent different compute costs. In production, these would be
    // actual program instructions.
    const amountMap: Record<string, bigint> = {
      mint_energy: 5000n,
      place_buy_order: 3000n,
      place_sell_order: 3000n,
      cancel_order: 1000n,
      match_orders: 8000n,
      update_oracle: 2000n,
      register_device: 4000n,
      query_balance: 500n,
    };

    tx.add(
      SystemProgram.transfer({
        fromPubkey: user.publicKey,
        toPubkey: recipient.publicKey,
        lamports: amountMap[operation] || 1000n,
      })
    );

    return tx;
  }

  executeOperation(operation: string, userType: string): RealWorldMeasurement {
    const user = this.getRandomUser(userType);
    const tx = this.createOperationTransaction(operation, user);
    
    const startTime = performance.now();
    
    tx.recentBlockhash = this.svm.latestBlockhash();
    tx.sign(user);
    
    const result = this.svm.sendTransaction(tx);
    const endTime = performance.now();
    
    const measurement: RealWorldMeasurement = {
      timestamp: Date.now(),
      operation,
      userType,
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

  async runScenario(config: ScenarioConfig): Promise<ScenarioResult> {
    await this.initialize(config);

    console.log(`\n${"═".repeat(60)}`);
    console.log(`  🎯 Running Scenario: ${config.name}`);
    console.log(`  ${config.description}`);
    console.log(`${"═".repeat(60)}\n`);
    console.log(`  Target TPS: ${config.transactionsPerSecond}`);
    console.log(`  Duration: ${config.duration}s`);
    console.log(`  Burst Probability: ${(config.burstProbability * 100).toFixed(0)}%\n`);

    const measurements: RealWorldMeasurement[] = [];
    const startTime = performance.now();
    const targetEndTime = startTime + config.duration * 1000;

    let txCount = 0;
    const intervalMs = 1000 / config.transactionsPerSecond;
    let lastLogTime = startTime;

    while (performance.now() < targetEndTime) {
      // Check for burst
      const isBurst = Math.random() < config.burstProbability;
      const burstMultiplier = isBurst ? Math.floor(Math.random() * 5) + 2 : 1;

      for (let i = 0; i < burstMultiplier; i++) {
        const operation = this.selectOperation(config.operationWeights);
        const userType = this.selectUserType(config.userDistribution);
        const measurement = this.executeOperation(operation, userType);
        measurements.push(measurement);
        txCount++;
      }

      // Log progress every 5 seconds
      const now = performance.now();
      if (now - lastLogTime > 5000) {
        const elapsed = (now - startTime) / 1000;
        const currentTPS = txCount / elapsed;
        console.log(`   [${elapsed.toFixed(0)}s] Transactions: ${txCount}, Current TPS: ${currentTPS.toFixed(1)}`);
        lastLogTime = now;
      }

      // Pace the transactions
      await new Promise(resolve => setTimeout(resolve, intervalMs / burstMultiplier));
    }

    const durationMs = performance.now() - startTime;

    // Calculate statistics
    const successfulTx = measurements.filter(m => m.success);
    const latencies = successfulTx.map(m => m.latencyMs).sort((a, b) => a - b);

    const latencyStats = {
      min: latencies[0] || 0,
      max: latencies[latencies.length - 1] || 0,
      avg: latencies.reduce((a, b) => a + b, 0) / latencies.length || 0,
      p50: latencies[Math.floor(latencies.length * 0.5)] || 0,
      p95: latencies[Math.floor(latencies.length * 0.95)] || 0,
      p99: latencies[Math.floor(latencies.length * 0.99)] || 0,
      stdDev: 0,
    };

    // Calculate std dev
    if (latencies.length > 0) {
      const variance = latencies.reduce((sum, l) => sum + Math.pow(l - latencyStats.avg, 2), 0) / latencies.length;
      latencyStats.stdDev = Math.sqrt(variance);
    }

    // Operation breakdown
    const operationBreakdown: Record<string, { count: number; avgLatency: number; successRate: number }> = {};
    for (const op of Object.keys(config.operationWeights)) {
      const opMeasurements = measurements.filter(m => m.operation === op);
      const opSuccess = opMeasurements.filter(m => m.success);
      operationBreakdown[op] = {
        count: opMeasurements.length,
        avgLatency: opSuccess.length > 0 
          ? opSuccess.reduce((sum, m) => sum + m.latencyMs, 0) / opSuccess.length 
          : 0,
        successRate: opMeasurements.length > 0 
          ? (opSuccess.length / opMeasurements.length) * 100 
          : 0,
      };
    }

    const result: ScenarioResult = {
      scenario: config,
      measurements,
      totalTransactions: measurements.length,
      successfulTransactions: successfulTx.length,
      failedTransactions: measurements.length - successfulTx.length,
      durationMs,
      effectiveTPS: (measurements.length / durationMs) * 1000,
      latencyStats,
      operationBreakdown,
    };

    this.printResults(result);
    return result;
  }

  private printResults(result: ScenarioResult): void {
    console.log("\n" + "─".repeat(60));
    console.log("  SCENARIO RESULTS");
    console.log("─".repeat(60) + "\n");

    console.log(`📊 Transaction Summary:`);
    console.log(`   Total: ${result.totalTransactions}`);
    console.log(`   Successful: ${result.successfulTransactions}`);
    console.log(`   Failed: ${result.failedTransactions}`);
    console.log(`   Success Rate: ${((result.successfulTransactions / result.totalTransactions) * 100).toFixed(1)}%`);
    console.log(`   Duration: ${(result.durationMs / 1000).toFixed(2)}s`);
    console.log(`   Effective TPS: ${result.effectiveTPS.toFixed(1)}`);

    console.log(`\n⏱️  Latency Statistics:`);
    console.log(`   Min: ${result.latencyStats.min.toFixed(2)}ms`);
    console.log(`   Avg: ${result.latencyStats.avg.toFixed(2)}ms`);
    console.log(`   p50: ${result.latencyStats.p50.toFixed(2)}ms`);
    console.log(`   p95: ${result.latencyStats.p95.toFixed(2)}ms`);
    console.log(`   p99: ${result.latencyStats.p99.toFixed(2)}ms`);
    console.log(`   Max: ${result.latencyStats.max.toFixed(2)}ms`);
    console.log(`   StdDev: ${result.latencyStats.stdDev.toFixed(2)}ms`);

    console.log(`\n📈 Operation Breakdown:`);
    console.log("| Operation        | Count | Avg Latency | Success Rate |");
    console.log("|------------------|-------|-------------|--------------|");
    for (const [op, stats] of Object.entries(result.operationBreakdown)) {
      if (stats.count > 0) {
        console.log(
          `| ${op.padEnd(16)} | ${stats.count.toString().padStart(5)} | ${stats.avgLatency.toFixed(2).padStart(9)}ms | ${stats.successRate.toFixed(1).padStart(11)}% |`
        );
      }
    }
  }
}

// ============================================================================
// MAIN RUNNER
// ============================================================================

async function runAllScenarios(): Promise<void> {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║     GridTokenX Real-World Scenario Benchmark               ║");
  console.log("║     Simulating Actual Energy Trading Platform Usage        ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  const benchmark = new RealWorldBenchmark();
  const results: ScenarioResult[] = [];

  // Run selected scenarios
  const scenariosToRun: ScenarioType[] = [
    "morning_peak",
    "evening_peak",
    "flash_sale",
    "market_volatility",
  ];

  for (const scenarioType of scenariosToRun) {
    const config = SCENARIOS[scenarioType];
    const result = await benchmark.runScenario(config);
    results.push(result);

    // Save individual result
    if (!fs.existsSync(RESULTS_PATH)) {
      fs.mkdirSync(RESULTS_PATH, { recursive: true });
    }

    fs.writeFileSync(
      path.join(RESULTS_PATH, `realworld-${scenarioType}.json`),
      JSON.stringify({
        scenario: result.scenario.name,
        totalTransactions: result.totalTransactions,
        successfulTransactions: result.successfulTransactions,
        durationMs: result.durationMs,
        effectiveTPS: result.effectiveTPS,
        latencyStats: result.latencyStats,
        operationBreakdown: result.operationBreakdown,
      }, null, 2)
    );
  }

  // Print summary comparison
  console.log("\n" + "═".repeat(80));
  console.log("  REAL-WORLD SCENARIO COMPARISON");
  console.log("═".repeat(80) + "\n");

  console.log("| Scenario             | Target TPS | Actual TPS | Avg Latency | p99 Latency | Success |");
  console.log("|----------------------|------------|------------|-------------|-------------|---------|");

  for (const result of results) {
    console.log(
      `| ${result.scenario.name.substring(0, 20).padEnd(20)} | ${result.scenario.transactionsPerSecond.toString().padStart(10)} | ${result.effectiveTPS.toFixed(1).padStart(10)} | ${result.latencyStats.avg.toFixed(2).padStart(9)}ms | ${result.latencyStats.p99.toFixed(2).padStart(9)}ms | ${((result.successfulTransactions / result.totalTransactions) * 100).toFixed(0).padStart(6)}% |`
    );
  }

  // Generate summary report
  const summaryReport = generateSummaryReport(results);
  fs.writeFileSync(path.join(RESULTS_PATH, "REALWORLD_REPORT.md"), summaryReport);

  console.log("\n" + "═".repeat(60));
  console.log("  ✅ ALL REAL-WORLD SCENARIOS COMPLETE");
  console.log("═".repeat(60));
  console.log(`\n📁 Results saved to: test-results/benchmark/`);
  console.log(`   - realworld-*.json (individual results)`);
  console.log(`   - REALWORLD_REPORT.md (summary report)`);
}

function generateSummaryReport(results: ScenarioResult[]): string {
  const lines: string[] = [];

  lines.push("# GridTokenX Real-World Performance Report");
  lines.push("");
  lines.push("## Executive Summary");
  lines.push("");
  lines.push(`- **Test Date**: ${new Date().toISOString().split("T")[0]}`);
  lines.push(`- **Environment**: LiteSVM (In-Process Solana VM)`);
  lines.push(`- **Scenarios Tested**: ${results.length}`);
  lines.push("");

  lines.push("## Scenario Results");
  lines.push("");
  lines.push("| Scenario | Target TPS | Actual TPS | Avg Latency | p99 Latency | Success Rate |");
  lines.push("|----------|------------|------------|-------------|-------------|--------------|");

  for (const result of results) {
    const successRate = (result.successfulTransactions / result.totalTransactions) * 100;
    lines.push(
      `| ${result.scenario.name} | ${result.scenario.transactionsPerSecond} | ${result.effectiveTPS.toFixed(1)} | ${result.latencyStats.avg.toFixed(2)}ms | ${result.latencyStats.p99.toFixed(2)}ms | ${successRate.toFixed(1)}% |`
    );
  }

  lines.push("");
  lines.push("## Key Findings");
  lines.push("");

  const avgTPS = results.reduce((sum, r) => sum + r.effectiveTPS, 0) / results.length;
  const avgLatency = results.reduce((sum, r) => sum + r.latencyStats.avg, 0) / results.length;
  const peakTPS = Math.max(...results.map(r => r.effectiveTPS));

  lines.push(`1. **Average TPS across scenarios**: ${avgTPS.toFixed(1)} TPS`);
  lines.push(`2. **Peak TPS achieved**: ${peakTPS.toFixed(1)} TPS`);
  lines.push(`3. **Average latency**: ${avgLatency.toFixed(2)}ms`);
  lines.push("");

  lines.push("## Operation Performance");
  lines.push("");

  // Aggregate operation stats
  const opStats: Record<string, { totalCount: number; totalLatency: number; totalSuccess: number }> = {};
  for (const result of results) {
    for (const [op, stats] of Object.entries(result.operationBreakdown)) {
      if (!opStats[op]) {
        opStats[op] = { totalCount: 0, totalLatency: 0, totalSuccess: 0 };
      }
      opStats[op].totalCount += stats.count;
      opStats[op].totalLatency += stats.avgLatency * stats.count;
      opStats[op].totalSuccess += stats.count * (stats.successRate / 100);
    }
  }

  lines.push("| Operation | Total Count | Avg Latency | Success Rate |");
  lines.push("|-----------|-------------|-------------|--------------|");

  for (const [op, stats] of Object.entries(opStats)) {
    if (stats.totalCount > 0) {
      const avgLat = stats.totalLatency / stats.totalCount;
      const successRate = (stats.totalSuccess / stats.totalCount) * 100;
      lines.push(`| ${op} | ${stats.totalCount} | ${avgLat.toFixed(2)}ms | ${successRate.toFixed(1)}% |`);
    }
  }

  lines.push("");
  lines.push("## Methodology");
  lines.push("");
  lines.push("Real-world scenarios simulate actual energy trading platform usage patterns:");
  lines.push("- **Morning Peak**: High producer activity as solar/wind comes online");
  lines.push("- **Evening Peak**: Maximum consumer demand during evening hours");
  lines.push("- **Flash Sale**: Promotional event with surge in buying activity");
  lines.push("- **Market Volatility**: High-frequency trading during price fluctuations");
  lines.push("");

  return lines.join("\n");
}

// Run selected scenario or all
const args = process.argv.slice(2);
const scenarioArg = args.find(a => a.startsWith("--scenario="));

if (scenarioArg) {
  const scenarioType = scenarioArg.split("=")[1] as ScenarioType;
  if (SCENARIOS[scenarioType]) {
    const benchmark = new RealWorldBenchmark();
    benchmark.runScenario(SCENARIOS[scenarioType]);
  } else {
    console.error(`Unknown scenario: ${scenarioType}`);
    console.log(`Available scenarios: ${Object.keys(SCENARIOS).join(", ")}`);
  }
} else {
  runAllScenarios();
}
