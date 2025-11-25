#!/usr/bin/env node

/**
 * Simple Latency Test Runner
 * Uses direct imports to avoid ES module issues
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import framework components directly
import { LatencyMeasurer } from './framework/latency-measurer.js';
import { DataCollector } from './framework/data-collector.js';
import { PerformanceAnalyzer } from './framework/performance-analyzer.js';
import { PerformanceTracker } from './framework/performance-tracker.js';

async function main() {
  console.log('🚀 Starting GridTokenX Latency Tests...\n');

  try {
    // Initialize framework components directly
    const tracker = new PerformanceTracker();
    const measurer = new LatencyMeasurer(null); // Mock connection for demo
    const collector = new DataCollector({
      outputDirectory: './test-results/latency',
      enableFileStorage: true,
      enableMemoryStorage: true
    });
    const analyzer = new PerformanceAnalyzer({
      enableOutlierDetection: true,
      enableTrendAnalysis: true
    });

    console.log('📊 Running Basic Latency Measurements...\n');

    // Test 1: Single Operation Measurement
    console.log('🔹 Test 1: Single Operation Latency');
    const measurement = await measurer.measureOperation(
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

    await collector.recordMeasurement(measurement.measurement);
    console.log(`   - Latency: ${measurement.measurement.transactionLatency.toFixed(2)}ms`);
    console.log(`   - Program: ${measurement.measurement.programId}`);
    console.log(`   - Instruction: ${measurement.measurement.instruction}\n`);

    // Test 2: Multiple Operations
    console.log('🔹 Test 2: Batch Operations');
    const measurements = [];
    for (let i = 0; i < 20; i++) {
      const batchMeasurement = await measurer.measureOperation(
        'energy_token_batch',
        'batch_operation',
        async () => {
          const delay = 100 + Math.random() * 200;
          await new Promise(resolve => setTimeout(resolve, delay));
          return { 
            signature: `batch_op_${Date.now()}_${i}`, 
            result: { batchId: i } 
          };
        }
      );
      measurements.push(batchMeasurement.measurement);
      await new Promise(resolve => setTimeout(resolve, 50)); // Delay between operations
    }

    await collector.recordMeasurements(measurements);
    
    // Calculate basic metrics
    const latencies = measurements.map(m => m.transactionLatency);
    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const sortedLatencies = latencies.sort((a, b) => a - b);
    const p95 = sortedLatencies[Math.floor(sortedLatencies.length * 0.95)];
    const p99 = sortedLatencies[Math.floor(sortedLatencies.length * 0.99)];

    console.log(`   - Average Latency: ${avgLatency.toFixed(2)}ms`);
    console.log(`   - P95 Latency: ${p95.toFixed(2)}ms`);
    console.log(`   - P99 Latency: ${p99.toFixed(2)}ms`);
    console.log(`   - Operations: ${measurements.length}\n`);

    // Test 3: Performance Report
    console.log('📈 Generating Performance Report...\n');
    const allMeasurements = measurer.getMeasurements();
    const report = analyzer.generateReport(allMeasurements);
    
    console.log('🎯 Performance Summary:');
    console.log(`   - Total Measurements: ${report.summary.totalMeasurements}`);
    console.log(`   - Average Latency: ${report.summary.averageLatency.toFixed(2)}ms`);
    console.log(`   - Median Latency: ${report.summary.medianLatency.toFixed(2)}ms`);
    console.log(`   - P95 Latency: ${report.summary.p95.toFixed(2)}ms`);
    console.log(`   - Standard Deviation: ${report.summary.standardDeviation.toFixed(2)}ms`);

    console.log('\n💡 Performance Recommendations:');
    if (report.recommendations && report.recommendations.length > 0) {
      report.recommendations.forEach((rec, index) => {
        console.log(`   ${index + 1}. ${rec}`);
      });
    } else {
      console.log('   No specific recommendations at this time.');
    }

    // Export report
    const reportData = {
      timestamp: new Date().toISOString(),
      summary: report.summary,
      trends: report.trends,
      recommendations: report.recommendations || [],
      measurements: allMeasurements
    };

    const reportPath = './test-results/latency/gridtokenx-latency-report.json';
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
    console.log(`\n📁 Report saved to: ${reportPath}`);

    console.log('\n✅ Latency testing completed successfully!');

  } catch (error) {
    console.error('❌ Error during latency testing:', error);
    process.exit(1);
  }
}

// Run main function
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
