import { existsSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * Performance metrics collector for GridTokenX architecture
 * Provides comprehensive analysis of throughput and transaction latency
 */
export class PerformanceMetricsCollector {
  private latencies: number[] = [];
  private errors: Error[] = [];
  private transactionTypes: Map<string, number> = new Map();
  private timestamps: number[] = [];
  private computeUnitUsage: number[] = [];
  private accountSizeChanges: Map<string, number> = new Map();

  /**
   * Record a successful transaction with its latency
   */
  recordSuccess(latency: number, transactionType: string, computeUnits?: number, accountSizeChange?: number): void {
    this.latencies.push(latency);
    this.timestamps.push(Date.now());
    this.transactionTypes.set(transactionType, (this.transactionTypes.get(transactionType) || 0) + 1);

    if (computeUnits !== undefined) {
      this.computeUnitUsage.push(computeUnits);
    }

    if (accountSizeChange !== undefined && accountSizeChange > 0) {
      this.accountSizeChanges.set(transactionType, (this.accountSizeChanges.get(transactionType) || 0) + accountSizeChange);
    }
  }

  /**
   * Record a failed transaction with its error
   */
  recordFailure(error: Error, transactionType: string): void {
    this.errors.push(error);
    this.transactionTypes.set(transactionType, (this.transactionTypes.get(transactionType) || 0) + 1);
  }

  /**
   * Generate comprehensive performance report
   */
  generateReport(totalDuration: number): PerformanceReport {
    const sortedLatencies = [...this.latencies].sort((a, b) => a - b);
    const count = this.latencies.length;

    // Calculate percentile values
    const p50 = count > 0 ? sortedLatencies[Math.floor(count * 0.5)] : 0;
    const p95 = count > 0 ? sortedLatencies[Math.floor(count * 0.95)] : 0;
    const p99 = count > 0 ? sortedLatencies[Math.floor(count * 0.99)] : 0;

    // Calculate average compute unit usage
    const avgComputeUnits = this.computeUnitUsage.length > 0
      ? this.computeUnitUsage.reduce((sum, cu) => sum + cu, 0) / this.computeUnitUsage.length
      : 0;

    // Calculate average account size change
    let totalAccountSizeChange = 0;
    for (const size of this.accountSizeChanges.values()) {
      totalAccountSizeChange += size;
    }
    const avgAccountSizeChange = this.accountSizeChanges.size > 0
      ? totalAccountSizeChange / this.accountSizeChanges.size
      : 0;

    return {
      totalTransactions: count + this.errors.length,
      successfulTransactions: count,
      failedTransactions: this.errors.length,
      totalDuration,
      throughput: totalDuration > 0 ? (count / (totalDuration / 1000)) : 0,
      latencies: this.latencies,
      avgLatency: count > 0 ? this.latencies.reduce((sum, lat) => sum + lat, 0) / count : 0,
      minLatency: count > 0 ? Math.min(...this.latencies) : 0,
      maxLatency: count > 0 ? Math.max(...this.latencies) : 0,
      p50Latency: p50,
      p95Latency: p95,
      p99Latency: p99,
      errorRate: count + this.errors.length > 0 ? this.errors.length / (count + this.errors.length) : 0,
      errors: this.errors.map(e => e.message),
      transactionTypes: Object.fromEntries(this.transactionTypes),
      avgComputeUnits,
      avgAccountSizeChange,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Save report to JSON file
   */
  saveReport(report: PerformanceReport, filePath?: string): void {
    const path = filePath || join(
      process.cwd(),
      "tests",
      "performance",
      "reports",
      `performance-report-${Date.now()}.json`
    );

    writeFileSync(path, JSON.stringify(report, null, 2));
    console.log(`Performance report saved to: ${path}`);
  }

  /**
   * Reset all collected metrics
   */
  reset(): void {
    this.latencies = [];
    this.errors = [];
    this.transactionTypes.clear();
    this.timestamps = [];
    this.computeUnitUsage = [];
    this.accountSizeChanges.clear();
  }
}

/**
 * Comprehensive performance report interface
 */
export interface PerformanceReport {
  totalTransactions: number;
  successfulTransactions: number;
  failedTransactions: number;
  totalDuration: number;
  throughput: number;
  latencies: number[];
  avgLatency: number;
  minLatency: number;
  maxLatency: number;
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
  errorRate: number;
  errors: string[];
  transactionTypes: Record<string, number>;
  avgComputeUnits: number;
  avgAccountSizeChange: number;
  timestamp: string;
}

/**
 * Print formatted performance report to console
 */
export function printPerformanceReport(testName: string, report: PerformanceReport): void {
  console.log("\n" + "=".repeat(80));
  console.log(`  ${testName}`);
  console.log("=".repeat(80));

  console.log("\n" + "--- Transaction Summary ---");
  console.log(`  Total Transactions:        ${report.totalTransactions}`);
  console.log(`  Successful:               ${report.successfulTransactions} (${(report.successfulTransactions / report.totalTransactions * 100).toFixed(2)}%)`);
  console.log(`  Failed:                   ${report.failedTransactions} (${(report.errorRate * 100).toFixed(2)}%)`);

  console.log("\n" + "--- Performance Metrics ---");
  console.log(`  Total Duration:           ${(report.totalDuration / 1000).toFixed(2)} seconds`);
  console.log(`  Throughput:               ${report.throughput.toFixed(2)} TPS`);
  console.log(`  Error Rate:               ${(report.errorRate * 100).toFixed(2)}%`);

  console.log("\n" + "--- Latency Analysis ---");
  console.log(`  Average:                  ${report.avgLatency.toFixed(2)} ms`);
  console.log(`  Min:                      ${report.minLatency} ms`);
  console.log(`  Max:                      ${report.maxLatency} ms`);
  console.log(`  P50 (Median):             ${report.p50Latency} ms`);
  console.log(`  P95:                      ${report.p95Latency} ms`);
  console.log(`  P99:                      ${report.p99Latency} ms`);

  console.log("\n" + "--- Resource Usage ---");
  console.log(`  Avg Compute Units:        ${report.avgComputeUnits.toFixed(0)}`);
  console.log(`  Avg Account Size Change:  ${report.avgAccountSizeChange.toFixed(0)} bytes`);

  if (Object.keys(report.transactionTypes).length > 0) {
    console.log("\n" + "--- Transaction Types ---");
    for (const [type, count] of Object.entries(report.transactionTypes)) {
      console.log(`  ${type}:                 ${count}`);
    }
  }

  if (report.errors.length > 0) {
    console.log("\n" + "--- Error Summary ---");
    report.errors.slice(0, 5).forEach((error, index) => {
      console.log(`  ${index + 1}. ${error.substring(0, 80)}${error.length > 80 ? "..." : ""}`);
    });
    if (report.errors.length > 5) {
      console.log(`  ... and ${report.errors.length - 5} more errors`);
    }
  }

  // Performance evaluation
  console.log("\n" + "--- Performance Evaluation ---");

  // Evaluate throughput
  if (report.throughput > 50) {
    console.log(`  ✓ Excellent throughput: ${report.throughput.toFixed(2)} TPS`);
  } else if (report.throughput > 20) {
    console.log(`  ⚠ Good throughput: ${report.throughput.toFixed(2)} TPS`);
  } else {
    console.log(`  ✗ Low throughput: ${report.throughput.toFixed(2)} TPS`);
  }

  // Evaluate latency
  if (report.avgLatency < 300) {
    console.log(`  ✓ Excellent latency: ${report.avgLatency.toFixed(2)} ms average`);
  } else if (report.avgLatency < 700) {
    console.log(`  ⚠ Moderate latency: ${report.avgLatency.toFixed(2)} ms average`);
  } else {
    console.log(`  ✗ High latency: ${report.avgLatency.toFixed(2)} ms average`);
  }

  // Evaluate error rate
  if (report.errorRate < 0.01) {
    console.log(`  ✓ Excellent reliability: ${(report.errorRate * 100).toFixed(2)}% error rate`);
  } else if (report.errorRate < 0.05) {
    console.log(`  ⚠ Moderate reliability: ${(report.errorRate * 100).toFixed(2)}% error rate`);
  } else {
    console.log(`  ✗ Poor reliability: ${(report.errorRate * 100).toFixed(2)}% error rate`);
  }

  console.log("=".repeat(80) + "\n");
}

/**
 * Generate performance benchmark score
 */
export function generateBenchmarkScore(report: PerformanceReport): BenchmarkScore {
  // Normalize scores (0-100)
  const throughputScore = Math.min(100, (report.throughput / 50) * 100);
  const latencyScore = report.avgLatency > 0 ? Math.min(100, 1000 / report.avgLatency) : 0;
  const reliabilityScore = (1 - report.errorRate) * 100;

  // Weighted average (40% throughput, 40% latency, 20% reliability)
  const overallScore = (throughputScore * 0.4) + (latencyScore * 0.4) + (reliabilityScore * 0.2);

  return {
    overall: Math.round(overallScore),
    throughput: Math.round(throughputScore),
    latency: Math.round(latencyScore),
    reliability: Math.round(reliabilityScore),
    grade: overallScore >= 80 ? 'A' : overallScore >= 60 ? 'B' : overallScore >= 40 ? 'C' : 'D'
  };
}

/**
 * Performance benchmark score interface
 */
export interface BenchmarkScore {
  overall: number;
  throughput: number;
  latency: number;
  reliability: number;
  grade: 'A' | 'B' | 'C' | 'D';
}
