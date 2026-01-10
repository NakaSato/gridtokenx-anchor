#!/usr/bin/env node

/**
 * GridTokenX Latency Test Runner
 * 
 * This script demonstrates the latency measurement framework
 * by running sample tests and generating performance reports.
 */

import { Connection } from '@solana/web3.js';
import { createLatencyFramework } from './framework/index.js';

async function main() {
  console.log('🚀 Starting GridTokenX Latency Tests...\n');

  // Initialize connection to local validator
  const connection = new Connection('http://127.0.0.1:8899', 'confirmed');
  
  // Create latency framework
  const framework = createLatencyFramework({
    connection,
    dataCollection: {
      outputDirectory: './test-results/latency',
      enableFileStorage: true,
      enableMemoryStorage: true,
      maxMemoryRecords: 1000,
      autoSave: true,
      autoSaveInterval: 10000 // 10 seconds
    },
    analysis: {
      enableOutlierDetection: true,
      outlierThreshold: 2.0,
      enableTrendAnalysis: true,
      enablePercentileCalculation: true,
      enableRegressionDetection: true
    }
  });

  try {
    console.log('📊 Running Basic Latency Measurements...\n');

    // Test 1: Single Operation Latency
    console.log('🔹 Test 1: Single Operation Latency');
    const { measurement } = await framework.measureOperation(
      'energy_token_test',
      'mock_operation',
      async () => {
        // Simulate a blockchain operation
        await new Promise(resolve => setTimeout(resolve, 150 + Math.random() * 100));
        return { 
          signature: `single_op_${Date.now()}`, 
          result: { success: true } 
        };
      }
    );

    console.log(`   - Latency: ${measurement.transactionLatency.toFixed(2)}ms`);
    console.log(`   - Program: ${measurement.programId}`);
    console.log(`   - Instruction: ${measurement.instruction}\n`);

    // Test 2: Batch Operations
    console.log('🔹 Test 2: Batch Operations');
    const batchMetrics = await framework.runTestScenario(
      {
        name: 'batch_test',
        description: 'Batch operation latency test',
        iterations: 20,
        concurrency: 1,
        delay: 50
      },
      'energy_token_batch',
      async () => {
        // Simulate batch operations with varying latency
        const delay = 100 + Math.random() * 200;
        await new Promise(resolve => setTimeout(resolve, delay));
        return { 
          signature: `batch_op_${Date.now()}_${Math.random()}`, 
          result: { batchId: Math.floor(Math.random() * 1000) } 
        };
      }
    );

    console.log(`   - Average Latency: ${batchMetrics.latency.mean.toFixed(2)}ms`);
    console.log(`   - P95 Latency: ${batchMetrics.latency.p95.toFixed(2)}ms`);
    console.log(`   - P99 Latency: ${batchMetrics.latency.p99.toFixed(2)}ms`);
    console.log(`   - Throughput: ${batchMetrics.throughput.tps.toFixed(2)} TPS`);
    console.log(`   - Error Rate: ${batchMetrics.errors.rate.toFixed(2)}%\n`);

    // Test 3: Concurrent Operations
    console.log('🔹 Test 3: Concurrent Operations');
    const concurrentMetrics = await framework.measurer.runConcurrentScenario(
      {
        name: 'concurrent_test',
        description: 'Concurrent operation latency test',
        iterations: 0,
        concurrency: 25,
        delay: 0
      },
      async () => {
        // Simulate concurrent operations
        const delay = 80 + Math.random() * 120;
        await new Promise(resolve => setTimeout(resolve, delay));
        return { 
          signature: `concurrent_op_${Date.now()}_${Math.random()}`, 
          result: { threadId: Math.floor(Math.random() * 100) } 
        };
      }
    );

    console.log(`   - Average Latency: ${concurrentMetrics.latency.mean.toFixed(2)}ms`);
    console.log(`   - P95 Latency: ${concurrentMetrics.latency.p95.toFixed(2)}ms`);
    console.log(`   - Successful Operations: ${concurrentMetrics.throughput.operations}`);
    console.log(`   - Error Rate: ${concurrentMetrics.errors.rate.toFixed(2)}%\n`);

    // Test 4: Mixed Workload
    console.log('🔹 Test 4: Mixed Workload Simulation');
    const mixedOperations = ['create_token', 'mint_tokens', 'transfer_tokens', 'burn_tokens'];
    
    for (const operation of mixedOperations) {
      const operationMetrics = await framework.runTestScenario(
        {
          name: `mixed_${operation}`,
          description: `Mixed workload test for ${operation}`,
          iterations: 15,
          concurrency: 1,
          delay: 30
        },
        'energy_token_mixed',
        async () => {
          // Simulate different operation types with different latency patterns
          let delay: number;
          switch (operation) {
            case 'create_token':
              delay = 200 + Math.random() * 150; // Slower operations
              break;
            case 'mint_tokens':
              delay = 120 + Math.random() * 80;
              break;
            case 'transfer_tokens':
              delay = 80 + Math.random() * 60; // Faster operations
              break;
            case 'burn_tokens':
              delay = 100 + Math.random() * 70;
              break;
            default:
              delay = 100 + Math.random() * 100;
          }
          
          await new Promise(resolve => setTimeout(resolve, delay));
          return { 
            signature: `${operation}_${Date.now()}_${Math.random()}`, 
            result: { operation, processed: true } 
          };
        }
      );

      console.log(`   - ${operation}:`);
      console.log(`     * Avg: ${operationMetrics.latency.mean.toFixed(2)}ms`);
      console.log(`     * P95: ${operationMetrics.latency.p95.toFixed(2)}ms`);
      console.log(`     * TPS: ${operationMetrics.throughput.tps.toFixed(2)}`);
    }

    console.log('\n📈 Generating Performance Report...\n');

    // Generate comprehensive report
    const report = framework.generateReport();
    
    console.log('🎯 Performance Summary:');
    console.log(`   - Total Measurements: ${report.summary.totalMeasurements}`);
    console.log(`   - Average Latency: ${report.summary.averageLatency.toFixed(2)}ms`);
    console.log(`   - Median Latency: ${report.summary.medianLatency.toFixed(2)}ms`);
    console.log(`   - P95 Latency: ${report.summary.p95.toFixed(2)}ms`);
    console.log(`   - P99 Latency: ${report.summary.p99.toFixed(2)}ms`);
    console.log(`   - Min Latency: ${report.summary.minLatency.toFixed(2)}ms`);
    console.log(`   - Max Latency: ${report.summary.maxLatency.toFixed(2)}ms`);
    console.log(`   - Standard Deviation: ${report.summary.standardDeviation.toFixed(2)}ms`);
    console.log(`   - Outlier Rate: ${report.summary.outlierRate.toFixed(2)}%`);

    console.log('\n📊 Trend Analysis:');
    console.log(`   - Direction: ${report.trends.direction.toUpperCase()}`);
    console.log(`   - Confidence: ${(report.trends.confidence * 100).toFixed(1)}%`);
    console.log(`   - Slope: ${report.trends.slope.toFixed(6)}ms/ms`);

    if (report.regressions.length > 0) {
      console.log('\n⚠️  Performance Regressions Detected:');
      report.regressions.forEach((regression, index) => {
        console.log(`   ${index + 1}. Regression: ${regression.regressionPercentage.toFixed(1)}%`);
        console.log(`      Baseline: ${regression.baselineLatency.toFixed(2)}ms`);
        console.log(`      Current: ${regression.currentLatency.toFixed(2)}ms`);
        console.log(`      Confidence: ${(regression.confidence * 100).toFixed(1)}%`);
      });
    }

    console.log('\n💡 Performance Recommendations:');
    report.recommendations.forEach((rec, index) => {
      console.log(`   ${index + 1}. ${rec}`);
    });

    // Export detailed report
    const reportPath = await framework.exportReport('gridtokenx-latency-report.json');
    console.log(`\n📁 Detailed report saved to: ${reportPath}`);

    // Export measurements data
    const measurementsPath = await framework.exportReport('gridtokenx-measurements.json');
    console.log(`📁 Raw measurements saved to: ${measurementsPath}`);

    console.log('\n✅ Latency testing completed successfully!');

  } catch (error) {
    console.error('❌ Error during latency testing:', error);
    process.exit(1);
  } finally {
    // Cleanup resources
    await framework.cleanup();
    console.log('\n🧹 Cleanup completed.');
  }
}

// Run the main function
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { main as runLatencyTests };
