/**
 * Edge Case Test Runner
 * Orchestrates all edge case and error handling tests
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL';
  duration: number;
  timestamp: string;
  error?: string;
  metrics?: any;
}

interface EdgeCaseTestSummary {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  totalDuration: number;
  results: TestResult[];
  startTime: string;
  endTime: string;
}

/**
 * Run individual edge case test
 */
async function runEdgeCaseTest(testName: string, scriptPath: string): Promise<TestResult> {
  console.log(`\n🚀 Running ${testName}...`);
  console.log('='.repeat(50));

  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  try {
    // Execute the test script
    const output = execSync(`node ${scriptPath}`, {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 300000 // 5 minutes timeout
    });

    const endTime = Date.now();
    const duration = endTime - startTime;

    // Parse output for results
    const hasErrors = output.includes('❌') || output.includes('ERROR') || output.includes('FAILED');

    if (hasErrors) {
      console.log(`❌ ${testName} failed`);
      console.log('Output:', output);

      return {
        name: testName,
        status: 'FAIL',
        duration,
        timestamp,
        error: output.substring(0, 500) // First 500 chars of error
      };
    } else {
      console.log(`✅ ${testName} completed successfully`);

      // Extract metrics if available
      const metrics = extractMetrics(output);

      return {
        name: testName,
        status: 'PASS',
        duration,
        timestamp,
        metrics
      };
    }
  } catch (error: any) {
    const endTime = Date.now();
    const duration = endTime - startTime;

    console.log(`❌ ${testName} failed with exception:`, error.message);

    return {
      name: testName,
      status: 'FAIL',
      duration,
      timestamp,
      error: error.message
    };
  }
}

/**
 * Extract metrics from test output
 */
function extractMetrics(output: string): any {
  const metrics: any = {};

  // Extract performance metrics
  const latencyMatch = output.match(/Average Latency:\s*([\d.]+)ms/);
  if (latencyMatch) {
    metrics.averageLatency = parseFloat(latencyMatch[1]);
  }

  // Extract success rates
  const successRateMatches = output.match(/Success Rate:\s*([\d.]+)%/g);
  if (successRateMatches) {
    metrics.successRates = successRateMatches.map(rate =>
      parseFloat(rate.replace(/[^0-9.]/g, ''))
    );
  }

  // Extract test counts
  const testCounts = output.match(/(\d+)\/(\d+)/g);
  if (testCounts) {
    metrics.testCounts = testCounts;
  }

  // Extract assessment results
  const assessments = output.match(/✅ PASS|❌ NEEDS IMPROVEMENT/g);
  if (assessments) {
    metrics.assessments = assessments;
    const passCount = assessments.filter(a => a.includes('✅ PASS')).length;
    metrics.assessmentPassRate = (passCount / assessments.length) * 100;
  }

  return metrics;
}

/**
 * Save test results to file
 */
function saveResults(summary: EdgeCaseTestSummary): string {
  const resultsDir = path.join(process.cwd(), 'test-results', 'edge-cases');

  // Ensure directory exists
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `edge-case-test-summary-${timestamp}.json`;
  const filepath = path.join(resultsDir, filename);

  fs.writeFileSync(filepath, JSON.stringify(summary, null, 2));

  return filepath;
}

/**
 * Print comprehensive summary
 */
function printSummary(summary: EdgeCaseTestSummary): void {
  console.log('\n🎯 EDGE CASE TESTS SUMMARY');
  console.log('='.repeat(60));

  console.log(`\n📊 OVERALL RESULTS:`);
  console.log(`   Total Tests: ${summary.totalTests}`);
  console.log(`   Passed: ${summary.passedTests} ✅`);
  console.log(`   Failed: ${summary.failedTests} ❌`);
  console.log(`   Success Rate: ${((summary.passedTests / summary.totalTests) * 100).toFixed(1)}%`);
  console.log(`   Total Duration: ${(summary.totalDuration / 1000).toFixed(1)}s`);

  console.log(`\n📋 DETAILED RESULTS:`);
  summary.results.forEach((result, index) => {
    const statusIcon = result.status === 'PASS' ? '✅' : '❌';
    const durationStr = (result.duration / 1000).toFixed(1);

    console.log(`   ${index + 1}. ${result.name} ${statusIcon} (${durationStr}s)`);

    if (result.error) {
      console.log(`      Error: ${result.error.substring(0, 100)}...`);
    }

    if (result.metrics) {
      if (result.metrics.averageLatency) {
        console.log(`      Avg Latency: ${result.metrics.averageLatency.toFixed(2)}ms`);
      }
      if (result.metrics.assessmentPassRate) {
        console.log(`      Assessment Pass Rate: ${result.metrics.assessmentPassRate.toFixed(1)}%`);
      }
    }
  });

  console.log(`\n📈 PERFORMANCE ANALYSIS:`);

  // Calculate average latency across all tests
  const latencies = summary.results
    .map(r => r.metrics?.averageLatency)
    .filter(lat => lat !== undefined) as number[];

  if (latencies.length > 0) {
    const avgLatency = latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length;
    const maxLatency = Math.max(...latencies);
    const minLatency = Math.min(...latencies);

    console.log(`   Average Latency: ${avgLatency.toFixed(2)}ms`);
    console.log(`   Min Latency: ${minLatency.toFixed(2)}ms`);
    console.log(`   Max Latency: ${maxLatency.toFixed(2)}ms`);
  }

  // Overall assessment
  console.log(`\n🏆 OVERALL ASSESSMENT:`);

  if (summary.failedTests === 0) {
    console.log(`   🎉 EXCELLENT: All edge case tests passed!`);
    console.log(`   ✅ System demonstrates robust edge case handling`);
    console.log(`   🛡️  Production-ready error management validated`);
  } else if (summary.failedTests <= summary.totalTests * 0.2) {
    console.log(`   ⚠️  GOOD: Most edge case tests passed`);
    console.log(`   🔧 Minor optimizations needed for production readiness`);
  } else {
    console.log(`   ❌ NEEDS IMPROVEMENT: Significant edge case issues detected`);
    console.log(`   🚨 Critical fixes required before production deployment`);
  }

  console.log(`\n📁 Detailed results saved to: test-results/edge-cases/`);
}

/**
 * Main edge case test runner
 */
async function runEdgeCaseTests(): Promise<void> {
  console.log('🎯 GridTokenX Edge Case & Error Handling Test Suite');
  console.log('='.repeat(60));
  console.log(`Started at: ${new Date().toISOString()}`);

  const startTime = Date.now();
  const summary: EdgeCaseTestSummary = {
    totalTests: 0,
    passedTests: 0,
    failedTests: 0,
    totalDuration: 0,
    results: [],
    startTime: new Date().toISOString(),
    endTime: ''
  };

  try {
    // Define all edge case tests
    const edgeCaseTests = [
      {
        name: 'Network Failure Tests',
        script: 'tests/edge-cases/network-failures.test.cjs'
      },
      {
        name: 'Data Consistency Tests',
        script: 'tests/edge-cases/data-consistency.test.cjs'
      },
      {
        name: 'Boundary Value Tests',
        script: 'tests/edge-cases/boundary-values.test.cjs'
      }
    ];

    summary.totalTests = edgeCaseTests.length;

    // Run each test
    for (const test of edgeCaseTests) {
      const result = await runEdgeCaseTest(test.name, test.script);
      summary.results.push(result);

      if (result.status === 'PASS') {
        summary.passedTests++;
      } else {
        summary.failedTests++;
      }

      summary.totalDuration += result.duration;

      // Brief pause between tests
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    const endTime = Date.now();
    summary.totalDuration = endTime - startTime;
    summary.endTime = new Date().toISOString();

    // Save results
    const resultsPath = saveResults(summary);

    // Print comprehensive summary
    printSummary(summary);

    console.log(`\n💾 Results saved to: ${resultsPath}`);

    // Exit with appropriate code
    if (summary.failedTests > 0) {
      console.log(`\n❌ ${summary.failedTests} edge case test(s) failed`);
      process.exit(1);
    } else {
      console.log(`\n✅ All edge case tests completed successfully`);
      process.exit(0);
    }

  } catch (error) {
    console.error('❌ Edge case test suite failed:', error);
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runEdgeCaseTests().catch(console.error);
}

export { runEdgeCaseTests };
export type { TestResult, EdgeCaseTestSummary };
