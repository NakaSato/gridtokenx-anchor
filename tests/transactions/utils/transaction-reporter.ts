import * as fs from "fs";
import * as path from "path";

/**
 * Transaction execution result
 */
export interface TransactionResult {
  program: string;
  operation: string;
  keypair: string;
  signature?: string;
  success: boolean;
  duration: number;
  timestamp: number;
  error?: string;
  computeUnits?: number;
}

/**
 * Test scenario result
 */
export interface ScenarioResult {
  scenarioName: string;
  program: string;
  totalTransactions: number;
  successfulTransactions: number;
  failedTransactions: number;
  totalDuration: number;
  averageDuration: number;
  transactions: TransactionResult[];
}

/**
 * Overall test suite report
 */
export interface TestSuiteReport {
  testSuiteName: string;
  startTime: number;
  endTime: number;
  totalDuration: number;
  scenarios: ScenarioResult[];
  summary: TestSummary;
}

/**
 * Test summary statistics
 */
export interface TestSummary {
  totalScenarios: number;
  totalTransactions: number;
  successfulTransactions: number;
  failedTransactions: number;
  successRate: number;
  averageTransactionDuration: number;
  throughput: number; // transactions per second
  programStats: Map<string, ProgramStats>;
  keypairStats: Map<string, KeypairStats>;
}

/**
 * Per-program statistics
 */
export interface ProgramStats {
  program: string;
  totalTransactions: number;
  successfulTransactions: number;
  failedTransactions: number;
  averageDuration: number;
  totalComputeUnits: number;
}

/**
 * Per-keypair statistics
 */
export interface KeypairStats {
  keypair: string;
  totalTransactions: number;
  successfulTransactions: number;
  failedTransactions: number;
  averageDuration: number;
}

/**
 * Comprehensive transaction reporter for test suite
 */
export class TransactionReporter {
  private scenarios: ScenarioResult[] = [];
  private currentScenario: ScenarioResult | null = null;
  private testSuiteName: string;
  private startTime: number;
  private outputDir: string;

  constructor(testSuiteName: string, outputDir: string = "./test-results/transactions") {
    this.testSuiteName = testSuiteName;
    this.startTime = Date.now();
    this.outputDir = outputDir;

    // Ensure output directory exists
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Start a new test scenario
   */
  startScenario(scenarioName: string, program: string): void {
    if (this.currentScenario) {
      this.endScenario();
    }

    this.currentScenario = {
      scenarioName,
      program,
      totalTransactions: 0,
      successfulTransactions: 0,
      failedTransactions: 0,
      totalDuration: 0,
      averageDuration: 0,
      transactions: [],
    };

    console.log(`\n📋 Starting scenario: ${scenarioName} (${program})`);
  }

  /**
   * End the current scenario
   */
  endScenario(): void {
    if (!this.currentScenario) return;

    // Calculate average duration
    if (this.currentScenario.totalTransactions > 0) {
      this.currentScenario.averageDuration =
        this.currentScenario.totalDuration / this.currentScenario.totalTransactions;
    }

    this.scenarios.push(this.currentScenario);

    console.log(
      `✓ Completed scenario: ${this.currentScenario.scenarioName} ` +
      `(${this.currentScenario.successfulTransactions}/${this.currentScenario.totalTransactions} succeeded)`
    );

    this.currentScenario = null;
  }

  /**
   * Record a transaction result
   */
  recordTransaction(result: TransactionResult): void {
    if (!this.currentScenario) {
      throw new Error("No active scenario. Call startScenario() first.");
    }

    this.currentScenario.transactions.push(result);
    this.currentScenario.totalTransactions++;
    this.currentScenario.totalDuration += result.duration;

    if (result.success) {
      this.currentScenario.successfulTransactions++;
      console.log(
        `  ✓ ${result.operation} (${result.keypair}): ${result.duration}ms` +
        (result.signature ? ` [${result.signature.substring(0, 8)}...]` : "")
      );
    } else {
      this.currentScenario.failedTransactions++;
      console.error(
        `  ✗ ${result.operation} (${result.keypair}): ${result.error || "Unknown error"}`
      );
    }
  }

  /**
   * Generate comprehensive test suite report
   */
  generateReport(): TestSuiteReport {
    // End current scenario if any
    if (this.currentScenario) {
      this.endScenario();
    }

    const endTime = Date.now();
    const totalDuration = endTime - this.startTime;

    // Calculate summary statistics
    const summary = this.calculateSummary(totalDuration);

    const report: TestSuiteReport = {
      testSuiteName: this.testSuiteName,
      startTime: this.startTime,
      endTime,
      totalDuration,
      scenarios: this.scenarios,
      summary,
    };

    return report;
  }

  /**
   * Calculate summary statistics
   */
  private calculateSummary(totalDuration: number): TestSummary {
    let totalTransactions = 0;
    let successfulTransactions = 0;
    let failedTransactions = 0;
    let totalTransactionDuration = 0;

    const programStatsMap = new Map<string, ProgramStats>();
    const keypairStatsMap = new Map<string, KeypairStats>();

    // Aggregate scenario statistics
    for (const scenario of this.scenarios) {
      totalTransactions += scenario.totalTransactions;
      successfulTransactions += scenario.successfulTransactions;
      failedTransactions += scenario.failedTransactions;

      // Process each transaction
      for (const tx of scenario.transactions) {
        totalTransactionDuration += tx.duration;

        // Update program stats
        if (!programStatsMap.has(tx.program)) {
          programStatsMap.set(tx.program, {
            program: tx.program,
            totalTransactions: 0,
            successfulTransactions: 0,
            failedTransactions: 0,
            averageDuration: 0,
            totalComputeUnits: 0,
          });
        }

        const programStats = programStatsMap.get(tx.program)!;
        programStats.totalTransactions++;
        if (tx.success) {
          programStats.successfulTransactions++;
        } else {
          programStats.failedTransactions++;
        }
        if (tx.computeUnits) {
          programStats.totalComputeUnits += tx.computeUnits;
        }

        // Update keypair stats
        if (!keypairStatsMap.has(tx.keypair)) {
          keypairStatsMap.set(tx.keypair, {
            keypair: tx.keypair,
            totalTransactions: 0,
            successfulTransactions: 0,
            failedTransactions: 0,
            averageDuration: 0,
          });
        }

        const keypairStats = keypairStatsMap.get(tx.keypair)!;
        keypairStats.totalTransactions++;
        if (tx.success) {
          keypairStats.successfulTransactions++;
        } else {
          keypairStats.failedTransactions++;
        }
      }
    }

    // Calculate averages for program stats
    for (const stats of programStatsMap.values()) {
      const programTxs = this.scenarios.flatMap((s) =>
        s.transactions.filter((tx) => tx.program === stats.program)
      );
      const totalDuration = programTxs.reduce((sum, tx) => sum + tx.duration, 0);
      stats.averageDuration = programTxs.length > 0 ? totalDuration / programTxs.length : 0;
    }

    // Calculate averages for keypair stats
    for (const stats of keypairStatsMap.values()) {
      const keypairTxs = this.scenarios.flatMap((s) =>
        s.transactions.filter((tx) => tx.keypair === stats.keypair)
      );
      const totalDuration = keypairTxs.reduce((sum, tx) => sum + tx.duration, 0);
      stats.averageDuration = keypairTxs.length > 0 ? totalDuration / keypairTxs.length : 0;
    }

    return {
      totalScenarios: this.scenarios.length,
      totalTransactions,
      successfulTransactions,
      failedTransactions,
      successRate: totalTransactions > 0 ? (successfulTransactions / totalTransactions) * 100 : 0,
      averageTransactionDuration:
        totalTransactions > 0 ? totalTransactionDuration / totalTransactions : 0,
      throughput: totalDuration > 0 ? (totalTransactions / totalDuration) * 1000 : 0, // tx/s
      programStats: programStatsMap,
      keypairStats: keypairStatsMap,
    };
  }

  /**
   * Print summary to console
   */
  printSummary(): void {
    const report = this.generateReport();
    const summary = report.summary;

    console.log("\n" + "═".repeat(80));
    console.log(`📊 Test Suite Report: ${this.testSuiteName}`);
    console.log("═".repeat(80));

    console.log(`\n📈 Overall Statistics:`);
    console.log(`  Total Scenarios:      ${summary.totalScenarios}`);
    console.log(`  Total Transactions:   ${summary.totalTransactions}`);
    console.log(`  Successful:           ${summary.successfulTransactions} (${summary.successRate.toFixed(2)}%)`);
    console.log(`  Failed:               ${summary.failedTransactions}`);
    console.log(`  Average Duration:     ${summary.averageTransactionDuration.toFixed(2)}ms`);
    console.log(`  Throughput:           ${summary.throughput.toFixed(2)} tx/s`);
    console.log(`  Total Duration:       ${(report.totalDuration / 1000).toFixed(2)}s`);

    console.log(`\n🔧 Program Statistics:`);
    for (const [program, stats] of summary.programStats) {
      console.log(`  ${program}:`);
      console.log(`    Total:     ${stats.totalTransactions} tx`);
      console.log(`    Success:   ${stats.successfulTransactions} (${((stats.successfulTransactions / stats.totalTransactions) * 100).toFixed(2)}%)`);
      console.log(`    Avg Time:  ${stats.averageDuration.toFixed(2)}ms`);
      if (stats.totalComputeUnits > 0) {
        console.log(`    CU Total:  ${stats.totalComputeUnits.toLocaleString()}`);
      }
    }

    console.log(`\n👥 Keypair Statistics (Top 10):`);
    const sortedKeypairs = Array.from(summary.keypairStats.values())
      .sort((a, b) => b.totalTransactions - a.totalTransactions)
      .slice(0, 10);

    for (const stats of sortedKeypairs) {
      console.log(
        `  ${stats.keypair.padEnd(25)}: ${stats.totalTransactions.toString().padStart(3)} tx, ` +
        `${stats.successfulTransactions} success, ${stats.averageDuration.toFixed(2)}ms avg`
      );
    }

    console.log("\n" + "═".repeat(80) + "\n");
  }

  /**
   * Save report to JSON file
   */
  saveReport(filename?: string): string {
    const report = this.generateReport();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outputFilename = filename || `transaction-report-${timestamp}.json`;
    const outputPath = path.join(this.outputDir, outputFilename);

    // Convert Maps to objects for JSON serialization
    const serializable = {
      ...report,
      summary: {
        ...report.summary,
        programStats: Object.fromEntries(report.summary.programStats),
        keypairStats: Object.fromEntries(report.summary.keypairStats),
      },
    };

    fs.writeFileSync(outputPath, JSON.stringify(serializable, null, 2));
    console.log(`💾 Report saved to: ${outputPath}`);

    return outputPath;
  }

  /**
   * Save report to CSV file
   */
  saveReportCSV(filename?: string): string {
    const report = this.generateReport();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outputFilename = filename || `transaction-report-${timestamp}.csv`;
    const outputPath = path.join(this.outputDir, outputFilename);

    // CSV header
    const headers = [
      "Scenario",
      "Program",
      "Operation",
      "Keypair",
      "Success",
      "Duration(ms)",
      "Timestamp",
      "Signature",
      "Error",
    ];

    const rows: string[] = [headers.join(",")];

    // Add transaction rows
    for (const scenario of report.scenarios) {
      for (const tx of scenario.transactions) {
        const row = [
          scenario.scenarioName,
          tx.program,
          tx.operation,
          tx.keypair,
          tx.success.toString(),
          tx.duration.toString(),
          new Date(tx.timestamp).toISOString(),
          tx.signature || "",
          tx.error || "",
        ];
        rows.push(row.map((field) => `"${field}"`).join(","));
      }
    }

    fs.writeFileSync(outputPath, rows.join("\n"));
    console.log(`💾 CSV report saved to: ${outputPath}`);

    return outputPath;
  }
}

export default TransactionReporter;
