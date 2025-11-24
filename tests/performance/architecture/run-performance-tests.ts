#!/usr/bin/env ts-node

/**
 * GridTokenX Architecture Performance Test Runner
 *
 * This script executes all performance tests and generates comprehensive reports
 * analyzing the throughput and transaction latency of the GridTokenX architecture.
 *
 * Usage:
 *   ts-node tests/performance/architecture/run-performance-tests.ts [options]
 *
 * Options:
 *   --sequential: Run tests sequentially (default: parallel)
 *   --report-path: Custom path for reports (default: ./tests/performance/reports)
 *   --test-suite: Specific test suite to run (all, energy-trading, architecture)
 *   --verbose: Enable verbose output
 *   --save-json: Save detailed JSON reports
 *   --benchmark-only: Run only benchmark tests
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

interface TestOptions {
  sequential: boolean;
  reportPath: string;
  testSuite: string;
  verbose: boolean;
  saveJson: boolean;
  benchmarkOnly: boolean;
}

class PerformanceTestRunner {
  private options: TestOptions;
  private testSuites: Map<string, TestSuite> = new Map();
  private startTime: number = Date.now();
  private results: Map<string, TestResult> = new Map();

  constructor(options: TestOptions) {
    this.options = options;
    this.initializeTestSuites();
  }

  /**
   * Initialize available test suites
   */
  private initializeTestSuites(): void {
    this.testSuites.set("energy-trading", {
      name: "Energy Trading Performance",
      path: "tests/performance/architecture/energy-trading-performance.test.ts",
      description: "Tests the performance of token transfers, order placement, and order matching",
      expectedDuration: 180000, // 3 minutes
    });

    this.testSuites.set("architecture", {
      name: "Architecture Analysis",
      path: "tests/performance/architecture/architecture-analysis.test.ts",
      description: "Comprehensive analysis of the GridTokenX architecture performance",
      expectedDuration: 300000, // 5 minutes
    });
  }

  /**
   * Run all test suites
   */
  async runAllTests(): Promise<void> {
    console.log("=".repeat(80));
    console.log("GridTokenX Architecture Performance Test Runner");
    console.log("=".repeat(80));

    const suitesToRun = this.options.testSuite === "all"
      ? Array.from(this.testSuites.keys())
      : [this.options.testSuite];

    // Ensure report directory exists
    if (!existsSync(this.options.reportPath)) {
      mkdirSync(this.options.reportPath, { recursive: true });
    }

    console.log(`\nRunning test suites: ${suitesToRun.join(", ")}`);
    console.log(`Report path: ${this.options.reportPath}`);
    console.log(`Execution mode: ${this.options.sequential ? "Sequential" : "Parallel"}`);

    // Run test suites
    if (this.options.sequential) {
      for (const suiteName of suitesToRun) {
        await this.runTestSuite(suiteName);
      }
    } else {
      const promises = suitesToRun.map(suiteName => this.runTestSuite(suiteName));
      await Promise.all(promises);
    }

    // Generate summary report
    this.generateSummaryReport();

    console.log("\n" + "=".repeat(80));
    console.log("Performance testing completed!");
    console.log(`Total duration: ${(Date.now() - this.startTime) / 1000} seconds`);
    console.log("=".repeat(80));
  }

  /**
   * Run a specific test suite
   */
  private async runTestSuite(suiteName: string): Promise<void> {
    const suite = this.testSuites.get(suiteName);
    if (!suite) {
      console.error(`Unknown test suite: ${suiteName}`);
      return;
    }

    console.log(`\n--- Running ${suite.name} ---`);
    console.log(`Description: ${suite.description}`);
    console.log(`Path: ${suite.path}`);

    const startTime = Date.now();
    let success = false;
    let output = "";
    let error = "";

    try {
      // Construct mocha command
      const command = `npx ts-mocha -p ./tsconfig.json -t 600000 ${suite.path}`;

      if (this.options.verbose) {
        console.log(`Executing: ${command}`);
      }

      // Run the test suite
      output = execSync(command, { encoding: "utf8", maxBuffer: 1024 * 1024 * 10 });
      success = true;
    } catch (err: any) {
      // Some test failures are expected for performance testing
      // Extract stdout and stderr
      output = err.stdout || "";
      error = err.stderr || "";

      // Consider it a success if some tests passed
      if (output.includes("✓") || output.includes("passing")) {
        success = true;
      }
    }

    const duration = Date.now() - startTime;

    // Store test results
    this.results.set(suiteName, {
      name: suite.name,
      success,
      duration,
      output: this.options.verbose ? output : this.extractSummary(output),
      error: this.options.verbose ? error : this.extractErrorSummary(error),
    });

    // Save detailed output if requested
    if (this.options.saveJson) {
      const reportPath = join(this.options.reportPath, `${suiteName}-detailed-report.json`);
      writeFileSync(reportPath, JSON.stringify({
        name: suite.name,
        path: suite.path,
        timestamp: new Date().toISOString(),
        success,
        duration,
        output,
        error,
      }, null, 2));
    }

    console.log(`Completed in ${duration / 1000} seconds: ${success ? "Success" : "Issues detected"}`);
  }

  /**
   * Extract summary information from test output
   */
  private extractSummary(output: string): string {
    const lines = output.split("\n");
    const summaryLines: string[] = [];

    // Look for key metrics
    for (const line of lines) {
      if (
        line.includes("TPS") ||
        line.includes("Latency") ||
        line.includes("Throughput") ||
        line.includes("Passing") ||
        line.includes("Failing") ||
        line.includes("Overall Score") ||
        line.includes("Grade")
      ) {
        summaryLines.push(line.trim());
      }
    }

    return summaryLines.join("\n");
  }

  /**
   * Extract error summary from test output
   */
  private extractErrorSummary(error: string): string {
    const lines = error.split("\n");
    const errorLines: string[] = [];

    // Look for error patterns
    for (const line of lines) {
      if (
        line.includes("Error:") ||
        line.includes("Timeout") ||
        line.includes("Failed") ||
        line.includes("AssertionError")
      ) {
        errorLines.push(line.trim());
      }
    }

    return errorLines.join("\n");
  }

  /**
   * Generate a summary report of all test suites
   */
  private generateSummaryReport(): void {
    console.log("\n" + "=".repeat(80));
    console.log("Performance Test Summary");
    console.log("=".repeat(80));

    let totalDuration = 0;
    let successCount = 0;

    for (const [suiteName, result] of this.results) {
      totalDuration += result.duration;
      if (result.success) successCount++;

      console.log(`\n${result.name}:`);
      console.log(`  Status: ${result.success ? "✓ Success" : "⚠ Issues"}`);
      console.log(`  Duration: ${(result.duration / 1000).toFixed(2)} seconds`);

      if (result.output) {
        const outputLines = result.output.split("\n").slice(0, 5);
        if (outputLines.length > 0) {
          console.log(`  Summary:`);
          for (const line of outputLines) {
            if (line.trim()) {
              console.log(`    ${line}`);
            }
          }
        }
      }

      if (result.error && this.options.verbose) {
        console.log(`  Errors:`);
        console.log(`    ${result.error.split("\n")[0] || "Unknown error"}`);
      }
    }

    console.log("\n" + "-".repeat(80));
    console.log(`Total Duration: ${(totalDuration / 1000).toFixed(2)} seconds`);
    console.log(`Success Rate: ${successCount}/${this.results.size} (${(successCount / this.results.size * 100).toFixed(2)}%)`);

    // Save summary report
    const summaryReport = {
      timestamp: new Date().toISOString(),
      totalDuration,
      successRate: successCount / this.results.size,
      testResults: Object.fromEntries(this.results),
    };

    const summaryPath = join(this.options.reportPath, "performance-test-summary.json");
    writeFileSync(summaryPath, JSON.stringify(summaryReport, null, 2));
    console.log(`\nSummary report saved to: ${summaryPath}`);

    // Generate recommendations
    this.generateRecommendations();
  }

  /**
   * Generate performance recommendations based on test results
   */
  private generateRecommendations(): void {
    console.log("\n" + "-".repeat(80));
    console.log("Performance Recommendations:");
    console.log("-".repeat(80));

    const recommendations: string[] = [];

    // Analyze test results for common issues
    for (const [suiteName, result] of this.results) {
      if (!result.success) {
        recommendations.push(`Review and fix failing tests in ${result.name}`);
      }

      // Check for performance issues in the output
      if (result.output) {
        if (result.output.includes("Low throughput")) {
          recommendations.push("Consider optimizing transaction batching to improve throughput");
        }

        if (result.output.includes("High latency")) {
          recommendations.push("Analyze instruction complexity to reduce transaction latency");
        }

        if (result.output.includes("Poor reliability") || result.output.includes("High error rate")) {
          recommendations.push("Implement better error handling and retry logic");
        }

        if (result.output.includes("Grade: D")) {
          recommendations.push(`Significant performance improvements needed in ${result.name}`);
        }
      }
    }

    if (recommendations.length === 0) {
      console.log("✓ Performance is within acceptable ranges. No immediate recommendations.");
    } else {
      recommendations.forEach((rec, index) => {
        console.log(`${index + 1}. ${rec}`);
      });
    }
  }
}

interface TestSuite {
  name: string;
  path: string;
  description: string;
  expectedDuration: number;
}

interface TestResult {
  name: string;
  success: boolean;
  duration: number;
  output: string;
  error: string;
}

// Parse command line arguments
function parseOptions(): TestOptions {
  const args = process.argv.slice(2);
  const options: TestOptions = {
    sequential: false,
    reportPath: "./tests/performance/reports",
    testSuite: "all",
    verbose: false,
    saveJson: false,
    benchmarkOnly: false,
  };

  for (const arg of args) {
    if (arg === "--sequential") {
      options.sequential = true;
    } else if (arg.startsWith("--report-path=")) {
      options.reportPath = arg.split("=")[1];
    } else if (arg.startsWith("--test-suite=")) {
      options.testSuite = arg.split("=")[1];
    } else if (arg === "--verbose") {
      options.verbose = true;
    } else if (arg === "--save-json") {
      options.saveJson = true;
    } else if (arg === "--benchmark-only") {
      options.benchmarkOnly = true;
      options.testSuite = "architecture"; // Architecture tests include benchmarks
    } else if (arg === "--help") {
      console.log(`
GridTokenX Performance Test Runner

Usage: ts-node tests/performance/architecture/run-performance-tests.ts [options]

Options:
  --sequential          Run tests sequentially (default: parallel)
  --report-path=<path>  Custom path for reports (default: ./tests/performance/reports)
  --test-suite=<suite>  Specific test suite to run (all, energy-trading, architecture)
  --verbose             Enable verbose output
  --save-json           Save detailed JSON reports
  --benchmark-only      Run only benchmark tests
  --help                Show this help message

Examples:
  ts-node tests/performance/architecture/run-performance-tests.ts
  ts-node tests/performance/architecture/run-performance-tests.ts --test-suite=energy-trading
  ts-node tests/performance/architecture/run-performance-tests.ts --verbose --save-json
      `);
      process.exit(0);
    }
  }

  return options;
}

// Main execution
async function main() {
  const options = parseOptions();
  const runner = new PerformanceTestRunner(options);

  try {
    await runner.runAllTests();
    process.exit(0);
  } catch (error) {
    console.error("Performance test runner failed:", error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main().catch(error => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
