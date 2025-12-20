import { execSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * Load Test Runner
 * Orchestrates all load testing components and provides comprehensive reporting
 */

export interface LoadTestResult {
  testName: string;
  success: boolean;
  duration: number;
  timestamp: Date;
  error?: string;
}

export interface LoadTestReport {
  summary: {
    totalTests: number;
    passed: number;
    failed: number;
    totalDuration: number;
    timestamp: Date;
  };
  results: LoadTestResult[];
}

class LoadTestRunner {
  private results: LoadTestResult[] = [];
  private startTime: Date = new Date();

  constructor() {
    this.ensureDirectories();
  }

  /**
   * Ensure required directories exist
   */
  private ensureDirectories(): void {
    const directories = [
      "test-results",
      "test-results/load",
      "test-results/load/reports"
    ];

    directories.forEach(dir => {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    });
  }

  /**
   * Run a single load test and capture results
   */
  private async runLoadTest(testName: string, command: string): Promise<LoadTestResult> {
    console.log(`\n🚀 Starting ${testName}...`);
    const startTime = Date.now();

    try {
      console.log(`Executing: ${command}`);
      execSync(command, { 
        stdio: 'inherit',
        cwd: process.cwd(),
        timeout: 600000 // 10 minutes timeout per test
      });

      const duration = Date.now() - startTime;
      const result: LoadTestResult = {
        testName,
        success: true,
        duration,
        timestamp: new Date()
      };

      console.log(`✅ ${testName} completed successfully in ${duration}ms`);
      return result;

    } catch (error: any) {
      const duration = Date.now() - startTime;
      const result: LoadTestResult = {
        testName,
        success: false,
        duration,
        timestamp: new Date(),
        error: error.message || String(error)
      };

      console.log(`❌ ${testName} failed after ${duration}ms: ${error.message}`);
      return result;
    }
  }

  /**
   * Run all load tests
   */
  async runAllLoadTests(): Promise<void> {
    console.log("🎯 GridTokenX Load Testing Suite");
    console.log("=" .repeat(50));
    console.log(`Started at: ${this.startTime.toISOString()}`);

    const loadTests = [
      {
        name: "High-Volume Trading Tests",
        command: "node tests/load/high-volume-trading.test.cjs",
        description: "Tests system under 500+ trades/minute"
      },
      {
        name: "Concurrent User Tests", 
        command: "node tests/load/concurrent-users.test.cjs",
        description: "Tests 100+ simultaneous users"
      },
      {
        name: "Network Condition Tests",
        command: "node tests/load/network-conditions.test.cjs", 
        description: "Tests resilience under network stress"
      }
    ];

    // Run each test
    for (const test of loadTests) {
      console.log(`\n📋 ${test.name}`);
      console.log(`   Description: ${test.description}`);
      
      const result = await this.runLoadTest(test.name, test.command);
      this.results.push(result);

      // Brief pause between tests
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Generate final report
    this.generateReport();
  }

  /**
   * Run specific load test category
   */
  async runTestCategory(category: 'high-volume' | 'concurrent' | 'network'): Promise<void> {
    const tests = {
      'high-volume': {
        name: "High-Volume Trading Tests",
        command: "node tests/load/high-volume-trading.test.cjs"
      },
      'concurrent': {
        name: "Concurrent User Tests", 
        command: "node tests/load/concurrent-users.test.cjs"
      },
      'network': {
        name: "Network Condition Tests",
        command: "node tests/load/network-conditions.test.cjs"
      }
    };

    const test = tests[category];
    if (test) {
      const result = await this.runLoadTest(test.name, test.command);
      this.results.push(result);
      this.generateReport();
    }
  }

  /**
   * Generate comprehensive load test report
   */
  private generateReport(): void {
    const endTime = new Date();
    const totalDuration = endTime.getTime() - this.startTime.getTime();

    const report: LoadTestReport = {
      summary: {
        totalTests: this.results.length,
        passed: this.results.filter(r => r.success).length,
        failed: this.results.filter(r => !r.success).length,
        totalDuration,
        timestamp: endTime
      },
      results: this.results
    };

    // Console summary
    console.log("\n" + "=".repeat(50));
    console.log("📊 LOAD TEST SUMMARY");
    console.log("=".repeat(50));
    console.log(`Total Tests: ${report.summary.totalTests}`);
    console.log(`Passed: ${report.summary.passed}`);
    console.log(`Failed: ${report.summary.failed}`);
    console.log(`Success Rate: ${(report.summary.passed / report.summary.totalTests * 100).toFixed(1)}%`);
    console.log(`Total Duration: ${(report.summary.totalDuration / 1000).toFixed(1)}s`);
    console.log(`Completed: ${report.summary.timestamp.toISOString()}`);

    // Detailed results
    console.log("\n📋 DETAILED RESULTS:");
    this.results.forEach((result, index) => {
      console.log(`\n${index + 1}. ${result.testName}`);
      console.log(`   Status: ${result.success ? '✅ PASSED' : '❌ FAILED'}`);
      console.log(`   Duration: ${(result.duration / 1000).toFixed(1)}s`);
      console.log(`   Timestamp: ${result.timestamp.toISOString()}`);
      if (result.error) {
        console.log(`   Error: ${result.error}`);
      }
    });

    // Save JSON report
    const reportPath = join(process.cwd(), 'test-results', 'load', `load-test-report-${Date.now()}.json`);
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n📁 Detailed report saved to: ${reportPath}`);

    // Performance recommendations
    this.generateRecommendations(report);
  }

  /**
   * Generate performance recommendations based on test results
   */
  private generateRecommendations(report: LoadTestReport): void {
    console.log("\n💡 PERFORMANCE RECOMMENDATIONS:");
    console.log("-".repeat(30));

    const failedTests = report.results.filter(r => !r.success);
    const slowTests = report.results.filter(r => r.duration > 300000); // > 5 minutes

    if (failedTests.length === 0 && slowTests.length === 0) {
      console.log("🎉 All load tests passed within acceptable time limits!");
      console.log("✅ System is ready for production load");
    } else {
      if (failedTests.length > 0) {
        console.log(`⚠️  ${failedTests.length} test(s) failed. Review:`);
        failedTests.forEach(test => {
          console.log(`   - ${test.testName}: ${test.error}`);
        });
      }

      if (slowTests.length > 0) {
        console.log(`⏱️  ${slowTests.length} test(s) took longer than expected. Consider:`);
        slowTests.forEach(test => {
          console.log(`   - ${test.testName}: ${(test.duration / 1000).toFixed(1)}s`);
        });
        console.log("   Recommendations:");
        console.log("     * Optimize database queries");
        console.log("     * Increase connection pool size");
        console.log("     * Implement better caching strategies");
        console.log("     * Consider horizontal scaling");
      }
    }

    console.log("\n📈 Next Steps:");
    console.log("1. Review failed tests and fix underlying issues");
    console.log("2. Optimize slow operations");
    console.log("3. Run load tests regularly in CI/CD pipeline");
    console.log("4. Set up monitoring for production environment");
  }

  /**
   * Generate comparison with previous results
   */
  private compareWithPrevious(currentReport: LoadTestReport): void {
    // This could be implemented to compare with historical test results
    // For now, just show the current results
    console.log("\n📊 PERFORMANCE TRENDS:");
    console.log("(Historical comparison not yet implemented)");
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const runner = new LoadTestRunner();

  try {
    if (args.length === 0) {
      // Run all tests
      await runner.runAllLoadTests();
    } else if (args[0] === '--category') {
      const category = args[1] as 'high-volume' | 'concurrent' | 'network';
      if (category && ['high-volume', 'concurrent', 'network'].includes(category)) {
        await runner.runTestCategory(category);
      } else {
        console.log('Invalid category. Use: high-volume, concurrent, or network');
        process.exit(1);
      }
    } else if (args[0] === '--help') {
      console.log(`
GridTokenX Load Test Runner

Usage:
  node run-load-tests.ts                    # Run all load tests
  node run-load-tests.ts --category <type>  # Run specific test category

Categories:
  high-volume    - High-volume trading tests (500+ trades/minute)
  concurrent     - Concurrent user tests (100+ simultaneous users)
  network        - Network condition tests (latency, packet loss, partitions)

Examples:
  node run-load-tests.ts
  node run-load-tests.ts --category high-volume
  node run-load-tests.ts --category concurrent
  node run-load-tests.ts --category network
      `);
    } else {
      console.log('Invalid arguments. Use --help for usage information.');
      process.exit(1);
    }
  } catch (error) {
    console.error('Load test runner failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
