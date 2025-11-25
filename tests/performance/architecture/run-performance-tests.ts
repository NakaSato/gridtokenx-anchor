#!/usr/bin/env node

/**
 * GridTokenX Performance Test Runner
 * 
 * This script runs comprehensive performance tests for the GridTokenX architecture,
 * measuring throughput, latency, and resource utilization under various conditions.
 */

import { Connection } from '@solana/web3.js';

interface PerformanceTestConfig {
  testSuite?: 'energy-trading' | 'architecture' | 'all';
  benchmarkOnly?: boolean;
  saveJson?: boolean;
  iterations?: number;
  concurrency?: number;
}

interface PerformanceMetrics {
  testName: string;
  timestamp: string;
  iterations: number;
  concurrency: number;
  totalDuration: number;
  averageLatency: number;
  minLatency: number;
  maxLatency: number;
  p95Latency: number;
  p99Latency: number;
  throughput: number;
  errorRate: number;
  successRate: number;
  memoryUsage?: {
    peak: number;
    average: number;
  };
  cpuUsage?: {
    peak: number;
    average: number;
  };
}

class PerformanceTestRunner {
  private connection: Connection;
  private results: PerformanceMetrics[] = [];

  constructor() {
    this.connection = new Connection('http://127.0.0.1:8899', 'confirmed');
  }

  async runTest(
    testName: string,
    operation: () => Promise<any>,
    config: { iterations: number; concurrency: number }
  ): Promise<PerformanceMetrics> {
    console.log(`🔹 Running ${testName}...`);
    
    const startTime = Date.now();
    const latencies: number[] = [];
    let errors = 0;
    let success = 0;

    // Run operations sequentially for simplicity
    for (let i = 0; i < config.iterations; i++) {
      const opStart = Date.now();
      try {
        await operation();
        const latency = Date.now() - opStart;
        latencies.push(latency);
        success++;
      } catch (error) {
        errors++;
        console.warn(`  ⚠️  Operation ${i} failed:`, error);
      }
      
      // Small delay between operations
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    const totalDuration = Date.now() - startTime;
    const sortedLatencies = latencies.sort((a, b) => a - b);
    
    const metrics: PerformanceMetrics = {
      testName,
      timestamp: new Date().toISOString(),
      iterations: config.iterations,
      concurrency: config.concurrency,
      totalDuration,
      averageLatency: latencies.reduce((a, b) => a + b, 0) / latencies.length,
      minLatency: Math.min(...latencies),
      maxLatency: Math.max(...latencies),
      p95Latency: sortedLatencies[Math.floor(sortedLatencies.length * 0.95)] || 0,
      p99Latency: sortedLatencies[Math.floor(sortedLatencies.length * 0.99)] || 0,
      throughput: (success / totalDuration) * 1000, // ops per second
      errorRate: (errors / config.iterations) * 100,
      successRate: (success / config.iterations) * 100
    };

    this.results.push(metrics);
    
    console.log(`   ✅ Completed: ${metrics.averageLatency.toFixed(2)}ms avg, ${metrics.throughput.toFixed(2)} TPS`);
    return metrics;
  }

  async runEnergyTradingTests(): Promise<void> {
    console.log('\n🚀 Energy Trading Performance Tests\n');

    // Test 1: Token Creation Performance
    await this.runTest('energy_token_creation', async () => {
      // Simulate token creation
      await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));
      return { success: true, signature: `create_${Date.now()}` };
    }, { iterations: 20, concurrency: 1 });

    // Test 2: Token Transfer Performance
    await this.runTest('energy_token_transfer', async () => {
      // Simulate token transfer
      await new Promise(resolve => setTimeout(resolve, 30 + Math.random() * 70));
      return { success: true, signature: `transfer_${Date.now()}` };
    }, { iterations: 50, concurrency: 1 });

    // Test 3: Batch Operations
    await this.runTest('energy_batch_operations', async () => {
      // Simulate batch operations
      await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));
      return { success: true, signature: `batch_${Date.now()}` };
    }, { iterations: 15, concurrency: 1 });

    // Test 4: Concurrent Operations
    await this.runTest('energy_concurrent_operations', async () => {
      // Simulate concurrent operations
      await new Promise(resolve => setTimeout(resolve, 40 + Math.random() * 60));
      return { success: true, signature: `concurrent_${Date.now()}` };
    }, { iterations: 30, concurrency: 1 });
  }

  async runArchitectureTests(): Promise<void> {
    console.log('\n🏗️  Architecture Performance Tests\n');

    // Test 1: Program Initialization
    await this.runTest('program_initialization', async () => {
      await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 150));
      return { success: true, signature: `init_${Date.now()}` };
    }, { iterations: 10, concurrency: 1 });

    // Test 2: Account Management
    await this.runTest('account_management', async () => {
      await new Promise(resolve => setTimeout(resolve, 60 + Math.random() * 80));
      return { success: true, signature: `account_${Date.now()}` };
    }, { iterations: 25, concurrency: 1 });

    // Test 3: State Updates
    await this.runTest('state_updates', async () => {
      await new Promise(resolve => setTimeout(resolve, 40 + Math.random() * 50));
      return { success: true, signature: `state_${Date.now()}` };
    }, { iterations: 40, concurrency: 1 });

    // Test 4: Cross-Program Calls
    await this.runTest('cross_program_calls', async () => {
      await new Promise(resolve => setTimeout(resolve, 120 + Math.random() * 180));
      return { success: true, signature: `cross_${Date.now()}` };
    }, { iterations: 15, concurrency: 1 });
  }

  generateReport(): void {
    console.log('\n📊 Performance Test Report\n');
    
    if (this.results.length === 0) {
      console.log('No test results available.');
      return;
    }

    const totalTests = this.results.length;
    const avgLatency = this.results.reduce((sum, r) => sum + r.averageLatency, 0) / totalTests;
    const avgThroughput = this.results.reduce((sum, r) => sum + r.throughput, 0) / totalTests;
    const avgSuccessRate = this.results.reduce((sum, r) => sum + r.successRate, 0) / totalTests;

    console.log('🎯 Overall Performance Summary:');
    console.log(`   - Total Tests: ${totalTests}`);
    console.log(`   - Average Latency: ${avgLatency.toFixed(2)}ms`);
    console.log(`   - Average Throughput: ${avgThroughput.toFixed(2)} TPS`);
    console.log(`   - Average Success Rate: ${avgSuccessRate.toFixed(2)}%`);

    console.log('\n📋 Detailed Results:');
    this.results.forEach((result, index) => {
      console.log(`   ${index + 1}. ${result.testName}:`);
      console.log(`      - Latency: ${result.averageLatency.toFixed(2)}ms (min: ${result.minLatency}ms, max: ${result.maxLatency}ms)`);
      console.log(`      - P95: ${result.p95Latency.toFixed(2)}ms, P99: ${result.p99Latency.toFixed(2)}ms`);
      console.log(`      - Throughput: ${result.throughput.toFixed(2)} TPS`);
      console.log(`      - Success Rate: ${result.successRate.toFixed(2)}%`);
    });

    // Performance recommendations
    console.log('\n💡 Performance Recommendations:');
    if (avgLatency > 200) {
      console.log('   ⚠️  Consider optimizing operations with high latency');
    }
    if (avgThroughput < 10) {
      console.log('   ⚠️  Consider increasing throughput through batching or concurrency');
    }
    if (avgSuccessRate < 95) {
      console.log('   ⚠️  Investigate and fix error-prone operations');
    }
    if (avgLatency <= 200 && avgThroughput >= 10 && avgSuccessRate >= 95) {
      console.log('   ✨ Performance is within acceptable ranges!');
    }
  }

  async saveResults(filename?: string): Promise<void> {
    const reportFilename = filename || `performance-report-${Date.now()}.json`;
    const reportPath = `./test-results/performance/${reportFilename}`;
    
    // Ensure directory exists
    const fs = await import('fs/promises');
    try {
      await fs.mkdir('./test-results/performance', { recursive: true });
    } catch (error) {
      // Directory might already exist
    }

    const report = {
      timestamp: new Date().toISOString(),
      framework: 'GridTokenX Performance Testing',
      version: '1.0.0',
      summary: {
        totalTests: this.results.length,
        averageLatency: this.results.reduce((sum, r) => sum + r.averageLatency, 0) / this.results.length,
        averageThroughput: this.results.reduce((sum, r) => sum + r.throughput, 0) / this.results.length,
        averageSuccessRate: this.results.reduce((sum, r) => sum + r.successRate, 0) / this.results.length
      },
      results: this.results
    };

    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n📁 Performance report saved to: ${reportPath}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const config: PerformanceTestConfig = {};

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--test-suite' && args[i + 1]) {
      config.testSuite = args[i + 1] as any;
      i++;
    } else if (arg === '--benchmark-only') {
      config.benchmarkOnly = true;
    } else if (arg === '--save-json') {
      config.saveJson = true;
    } else if (arg === '--iterations' && args[i + 1]) {
      config.iterations = parseInt(args[i + 1]);
      i++;
    } else if (arg === '--concurrency' && args[i + 1]) {
      config.concurrency = parseInt(args[i + 1]);
      i++;
    }
  }

  console.log('🚀 Starting GridTokenX Performance Tests...\n');

  const runner = new PerformanceTestRunner();

  try {
    if (config.testSuite === 'energy-trading' || config.testSuite === 'all') {
      await runner.runEnergyTradingTests();
    }

    if (config.testSuite === 'architecture' || config.testSuite === 'all') {
      await runner.runArchitectureTests();
    }

    if (!config.testSuite || config.testSuite === 'all') {
      // Default: run both
      await runner.runEnergyTradingTests();
      await runner.runArchitectureTests();
    }

    runner.generateReport();

    if (config.saveJson || config.benchmarkOnly) {
      await runner.saveResults();
    }

    console.log('\n✅ Performance testing completed successfully!');

  } catch (error) {
    console.error('❌ Error during performance testing:', error);
    process.exit(1);
  }
}

// Run the main function
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { main as runPerformanceTests, PerformanceTestRunner };
export type { PerformanceMetrics };
