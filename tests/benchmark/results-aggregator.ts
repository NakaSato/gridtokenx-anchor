/**
 * Research Paper Results Aggregator
 * 
 * Consolidates all benchmark results into research paper format
 * Generates tables, statistics, and export files
 */

import * as fs from "fs";
import * as path from "path";
import { RESULTS_PATH } from "./benchmark-engine";

// ============================================================================
// DATA STRUCTURES
// ============================================================================

interface AggregatedResults {
  metadata: {
    timestamp: string;
    environment: string;
    solanaVersion: string;
    platform: string;
  };
  throughput: {
    baseline: ThroughputSummary;
    sustained: ThroughputSummary;
    peak: number;
  };
  latency: {
    cold: LatencySummary;
    warm: LatencySummary;
    underLoad: LoadLatencySummary[];
  };
  concurrency: {
    scenarios: ConcurrencySummary[];
    scalability: ScalabilityPoint[];
  };
}

interface ThroughputSummary {
  avgTPS: number;
  peakTPS: number;
  minTPS: number;
  stdDev: number;
}

interface LatencySummary {
  count: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  stdDevMs: number;
}

interface LoadLatencySummary {
  concurrentUsers: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
}

interface ConcurrencySummary {
  scenario: string;
  users: number;
  transactions: number;
  effectiveTPS: number;
  avgLatencyMs: number;
  p99LatencyMs: number;
  successRate: number;
}

interface ScalabilityPoint {
  users: number;
  tps: number;
  avgLatencyMs: number;
  p99LatencyMs: number;
}

// ============================================================================
// RESULT FILE PARSERS
// ============================================================================

function loadJsonFile<T>(filename: string): T | null {
  const filepath = path.join(RESULTS_PATH, filename);
  if (fs.existsSync(filepath)) {
    try {
      return JSON.parse(fs.readFileSync(filepath, "utf-8")) as T;
    } catch {
      console.warn(`Warning: Could not parse ${filename}`);
    }
  }
  return null;
}

function loadAllResults(): Partial<AggregatedResults> {
  const results: Partial<AggregatedResults> = {
    metadata: {
      timestamp: new Date().toISOString(),
      environment: "LiteSVM (In-Process Solana VM)",
      solanaVersion: "1.18.x compatible",
      platform: process.platform,
    },
  };

  // Load latency under load
  const latencyUnderLoad = loadJsonFile<LoadLatencySummary[]>("latency-under-load.json");
  if (latencyUnderLoad) {
    results.latency = {
      cold: { count: 0, avgMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0, stdDevMs: 0 },
      warm: { count: 0, avgMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0, stdDevMs: 0 },
      underLoad: latencyUnderLoad,
    };
  }

  // Load scalability analysis - map from raw JSON format to expected format
  const scalabilityRaw = loadJsonFile<any[]>("scalability-analysis.json");
  if (scalabilityRaw) {
    const scalability: ScalabilityPoint[] = scalabilityRaw.map(s => ({
      users: s.users,
      tps: s.tps,
      avgLatencyMs: s.avgLatency || s.avgLatencyMs || 0,
      p99LatencyMs: s.p99Latency || s.p99LatencyMs || 0,
    }));
    results.concurrency = {
      scenarios: [],
      scalability,
    };
  }

  // Load concurrent test results
  const concurrentScenarios = [
    "low_load",
    "medium_load",
    "high_load",
    "stress_test",
    "burst_load",
  ];

  const scenarios: ConcurrencySummary[] = [];
  for (const scenario of concurrentScenarios) {
    const data = loadJsonFile<any>(`concurrent-${scenario}.json`);
    if (data) {
      scenarios.push({
        scenario,
        users: data.config?.userCount || 0,
        transactions: data.totalTransactions || 0,
        effectiveTPS: data.effectiveTPS || 0,
        avgLatencyMs: data.latencyStats?.avgMs || 0,
        p99LatencyMs: data.latencyStats?.p99Ms || 0,
        successRate: data.latencyStats?.successRate || 0,
      });
    }
  }

  if (scenarios.length > 0 && results.concurrency) {
    results.concurrency.scenarios = scenarios;
  }

  return results;
}

// ============================================================================
// REPORT GENERATORS
// ============================================================================

function generateMarkdownReport(results: Partial<AggregatedResults>): string {
  const lines: string[] = [];

  lines.push("# GridTokenX Performance Benchmark Results");
  lines.push("");
  lines.push("## Executive Summary");
  lines.push("");
  lines.push(`- **Test Environment**: ${results.metadata?.environment || "LiteSVM"}`);
  lines.push(`- **Timestamp**: ${results.metadata?.timestamp || new Date().toISOString()}`);
  lines.push(`- **Platform**: ${results.metadata?.platform || process.platform}`);
  lines.push("");

  // Latency Under Load Table
  if (results.latency?.underLoad && results.latency.underLoad.length > 0) {
    lines.push("## Latency Under Load Analysis");
    lines.push("");
    lines.push("| Concurrent Users | Avg Latency (ms) | p50 (ms) | p95 (ms) | p99 (ms) |");
    lines.push("|------------------|------------------|----------|----------|----------|");
    for (const point of results.latency.underLoad) {
      lines.push(
        `| ${point.concurrentUsers} | ${point.avgLatencyMs.toFixed(2)} | ${point.p50LatencyMs.toFixed(2)} | ${point.p95LatencyMs.toFixed(2)} | ${point.p99LatencyMs.toFixed(2)} |`
      );
    }
    lines.push("");
  }

  // Concurrent Scenarios Table
  if (results.concurrency?.scenarios && results.concurrency.scenarios.length > 0) {
    lines.push("## Concurrent User Simulation Results");
    lines.push("");
    lines.push("| Scenario | Users | Total Tx | Effective TPS | Avg Latency | p99 Latency | Success Rate |");
    lines.push("|----------|-------|----------|---------------|-------------|-------------|--------------|");
    for (const scenario of results.concurrency.scenarios) {
      const tps = scenario.effectiveTPS ?? 0;
      const avgLatency = scenario.avgLatencyMs ?? 0;
      const p99Latency = scenario.p99LatencyMs ?? 0;
      const successRate = scenario.successRate ?? 0;
      lines.push(
        `| ${scenario.scenario} | ${scenario.users} | ${scenario.transactions} | ${tps.toFixed(1)} | ${avgLatency.toFixed(2)}ms | ${p99Latency.toFixed(2)}ms | ${successRate.toFixed(1)}% |`
      );
    }
    lines.push("");
  }

  // Scalability Table
  if (results.concurrency?.scalability && results.concurrency.scalability.length > 0) {
    lines.push("## Scalability Analysis");
    lines.push("");
    lines.push("| Users | Throughput (TPS) | Avg Latency (ms) | p99 Latency (ms) |");
    lines.push("|-------|------------------|------------------|------------------|");
    for (const point of results.concurrency.scalability) {
      const tps = point.tps ?? 0;
      const avgLatency = point.avgLatencyMs ?? 0;
      const p99Latency = point.p99LatencyMs ?? 0;
      lines.push(
        `| ${point.users} | ${tps.toFixed(0)} | ${avgLatency.toFixed(2)} | ${p99Latency.toFixed(2)} |`
      );
    }
    lines.push("");
  }

  lines.push("## Key Findings");
  lines.push("");

  // Calculate key metrics
  if (results.concurrency?.scalability && results.concurrency.scalability.length > 0) {
    const peakTPS = Math.max(...results.concurrency.scalability.map(s => s.tps || 0));
    const validLatencies = results.concurrency.scalability.filter(s => s.avgLatencyMs !== undefined);
    const avgLatency = validLatencies.length > 0
      ? validLatencies.reduce((sum, s) => sum + (s.avgLatencyMs || 0), 0) / validLatencies.length
      : 0;
    
    lines.push(`1. **Peak Throughput**: ${peakTPS.toFixed(0)} TPS`);
    lines.push(`2. **Average Latency**: ${avgLatency.toFixed(2)}ms across all load levels`);
  }

  if (results.latency?.underLoad && results.latency.underLoad.length > 0) {
    const validLatencies = results.latency.underLoad.filter(l => l.avgLatencyMs !== undefined);
    if (validLatencies.length > 0) {
      const minLatency = Math.min(...validLatencies.map(l => l.avgLatencyMs || 0));
      lines.push(`3. **Minimum Latency**: ${minLatency.toFixed(2)}ms (low load conditions)`);
    }
  }

  lines.push("");
  lines.push("## Methodology");
  lines.push("");
  lines.push("- Tests were conducted using LiteSVM, an in-process Solana Virtual Machine");
  lines.push("- Each test iteration includes transaction creation, signing, and execution");
  lines.push("- Latency measurements use high-resolution performance timers");
  lines.push("- Statistical analysis includes percentile calculations (p50, p95, p99)");
  lines.push("");

  return lines.join("\n");
}

function generateLatexTables(results: Partial<AggregatedResults>): string {
  const lines: string[] = [];

  lines.push("% GridTokenX Performance Benchmark Tables for LaTeX");
  lines.push("% Generated: " + new Date().toISOString());
  lines.push("");

  // Latency Under Load Table
  if (results.latency?.underLoad && results.latency.underLoad.length > 0) {
    lines.push("% Latency Under Load Table");
    lines.push("\\begin{table}[h]");
    lines.push("\\centering");
    lines.push("\\caption{Transaction Latency Under Varying Load Conditions}");
    lines.push("\\label{tab:latency-load}");
    lines.push("\\begin{tabular}{rrrrrr}");
    lines.push("\\toprule");
    lines.push("Users & Avg (ms) & p50 (ms) & p95 (ms) & p99 (ms) \\\\");
    lines.push("\\midrule");
    for (const point of results.latency.underLoad) {
      const avg = point.avgLatencyMs ?? 0;
      const p50 = point.p50LatencyMs ?? 0;
      const p95 = point.p95LatencyMs ?? 0;
      const p99 = point.p99LatencyMs ?? 0;
      lines.push(
        `${point.concurrentUsers} & ${avg.toFixed(2)} & ${p50.toFixed(2)} & ${p95.toFixed(2)} & ${p99.toFixed(2)} \\\\`
      );
    }
    lines.push("\\bottomrule");
    lines.push("\\end{tabular}");
    lines.push("\\end{table}");
    lines.push("");
  }

  // Scalability Table
  if (results.concurrency?.scalability && results.concurrency.scalability.length > 0) {
    lines.push("% Scalability Analysis Table");
    lines.push("\\begin{table}[h]");
    lines.push("\\centering");
    lines.push("\\caption{System Scalability Analysis}");
    lines.push("\\label{tab:scalability}");
    lines.push("\\begin{tabular}{rrrr}");
    lines.push("\\toprule");
    lines.push("Users & TPS & Avg Latency (ms) & p99 Latency (ms) \\\\");
    lines.push("\\midrule");
    for (const point of results.concurrency.scalability) {
      const tps = point.tps ?? 0;
      const avg = point.avgLatencyMs ?? 0;
      const p99 = point.p99LatencyMs ?? 0;
      lines.push(
        `${point.users} & ${tps.toFixed(0)} & ${avg.toFixed(2)} & ${p99.toFixed(2)} \\\\`
      );
    }
    lines.push("\\bottomrule");
    lines.push("\\end{tabular}");
    lines.push("\\end{table}");
    lines.push("");
  }

  return lines.join("\n");
}

function generateCSVExports(results: Partial<AggregatedResults>): void {
  // Latency under load CSV
  if (results.latency?.underLoad) {
    const csv = [
      "concurrent_users,avg_latency_ms,p50_latency_ms,p95_latency_ms,p99_latency_ms",
      ...results.latency.underLoad.map(
        p => `${p.concurrentUsers},${(p.avgLatencyMs ?? 0).toFixed(3)},${(p.p50LatencyMs ?? 0).toFixed(3)},${(p.p95LatencyMs ?? 0).toFixed(3)},${(p.p99LatencyMs ?? 0).toFixed(3)}`
      ),
    ].join("\n");

    fs.writeFileSync(path.join(RESULTS_PATH, "latency-under-load.csv"), csv);
  }

  // Concurrency scenarios CSV
  if (results.concurrency?.scenarios) {
    const csv = [
      "scenario,users,transactions,effective_tps,avg_latency_ms,p99_latency_ms,success_rate",
      ...results.concurrency.scenarios.map(
        s => `${s.scenario},${s.users},${s.transactions},${(s.effectiveTPS ?? 0).toFixed(2)},${(s.avgLatencyMs ?? 0).toFixed(3)},${(s.p99LatencyMs ?? 0).toFixed(3)},${(s.successRate ?? 0).toFixed(2)}`
      ),
    ].join("\n");

    fs.writeFileSync(path.join(RESULTS_PATH, "concurrent-scenarios.csv"), csv);
  }
}

// ============================================================================
// MAIN AGGREGATOR
// ============================================================================

async function main() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║     GridTokenX Research Paper Results Aggregator           ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  // Ensure results directory exists
  if (!fs.existsSync(RESULTS_PATH)) {
    fs.mkdirSync(RESULTS_PATH, { recursive: true });
  }

  // Load all results
  console.log("📂 Loading benchmark results...\n");
  const results = loadAllResults();

  // Generate Markdown report
  console.log("📝 Generating Markdown report...");
  const markdownReport = generateMarkdownReport(results);
  fs.writeFileSync(path.join(RESULTS_PATH, "BENCHMARK_REPORT.md"), markdownReport);
  console.log("   ✓ Saved: BENCHMARK_REPORT.md");

  // Generate LaTeX tables
  console.log("📊 Generating LaTeX tables...");
  const latexTables = generateLatexTables(results);
  fs.writeFileSync(path.join(RESULTS_PATH, "tables.tex"), latexTables);
  console.log("   ✓ Saved: tables.tex");

  // Generate CSV exports
  console.log("📈 Generating CSV exports...");
  generateCSVExports(results);
  console.log("   ✓ Saved: *.csv files");

  // Save aggregated JSON
  console.log("💾 Saving aggregated results...");
  fs.writeFileSync(
    path.join(RESULTS_PATH, "aggregated-results.json"),
    JSON.stringify(results, null, 2)
  );
  console.log("   ✓ Saved: aggregated-results.json");

  // Print summary
  console.log("\n" + "═".repeat(60));
  console.log("  📋 AGGREGATION COMPLETE");
  console.log("═".repeat(60) + "\n");

  console.log("Generated files:");
  console.log("  • BENCHMARK_REPORT.md   - Human-readable report");
  console.log("  • tables.tex            - LaTeX tables for paper");
  console.log("  • aggregated-results.json - Machine-readable data");
  console.log("  • *.csv                 - Spreadsheet-compatible data");

  console.log(`\n📁 All results in: test-results/benchmark/`);

  // Print report preview
  console.log("\n" + "─".repeat(60));
  console.log("  REPORT PREVIEW");
  console.log("─".repeat(60) + "\n");
  console.log(markdownReport.split("\n").slice(0, 30).join("\n"));
  console.log("\n... (truncated)");
}

main().catch(console.error);
