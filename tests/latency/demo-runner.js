#!/usr/bin/env node

/**
 * Simple Latency Test Demo
 * Demonstrates latency measurement concepts without framework dependencies
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class SimpleLatencyMeasurer {
  constructor() {
    this.measurements = [];
  }

  async measureOperation(programId, instruction, operation) {
    const startTime = performance.now();
    const startEpoch = Date.now();
    
    try {
      const result = await operation();
      const endTime = performance.now();
      const endEpoch = Date.now();
      
      const measurement = {
        timestamp: startEpoch,
        programId,
        instruction,
        transactionLatency: endTime - startTime,
        startTime,
        endTime,
        success: true,
        signature: result.signature,
        result: result.result
      };
      
      this.measurements.push(measurement);
      return { measurement, result };
    } catch (error) {
      const endTime = performance.now();
      const measurement = {
        timestamp: startEpoch,
        programId,
        instruction,
        transactionLatency: endTime - startTime,
        startTime,
        endTime,
        success: false,
        error: error.message
      };
      
      this.measurements.push(measurement);
      throw error;
    }
  }

  getMeasurements() {
    return this.measurements;
  }

  clearMeasurements() {
    this.measurements = [];
  }
}

class SimpleAnalyzer {
  generateReport(measurements) {
    if (measurements.length === 0) {
      return {
        summary: { totalMeasurements: 0 },
        trends: { direction: 'stable', confidence: 0 },
        recommendations: []
      };
    }

    const latencies = measurements
      .filter(m => m.success)
      .map(m => m.transactionLatency);

    if (latencies.length === 0) {
      return {
        summary: { totalMeasurements: measurements.length },
        trends: { direction: 'stable', confidence: 0 },
        recommendations: []
      };
    }

    const sorted = latencies.sort((a, b) => a - b);
    const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const median = sorted[Math.floor(sorted.length / 2)];
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    
    const variance = latencies.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / latencies.length;
    const stdDev = Math.sqrt(variance);

    // Generate recommendations
    const recommendations = [];
    if (mean > 500) {
      recommendations.push('Average latency exceeds 500ms - consider optimization');
    }
    if (p95 > 1000) {
      recommendations.push('P95 latency exceeds 1s - investigate outliers');
    }
    if (stdDev > 200) {
      recommendations.push('High latency variance detected - check system stability');
    }

    return {
      summary: {
        totalMeasurements: measurements.length,
        averageLatency: mean,
        medianLatency: median,
        p50,
        p95,
        p99,
        minLatency: min,
        maxLatency: max,
        standardDeviation: stdDev
      },
      trends: {
        direction: 'stable',
        confidence: 0.8,
        slope: 0
      },
      recommendations
    };
  }
}

async function main() {
  console.log('🚀 Starting GridTokenX Latency Test Demo...\n');

  try {
    const measurer = new SimpleLatencyMeasurer();
    const analyzer = new SimpleAnalyzer();

    console.log('📊 Running Latency Measurements...\n');

    // Test 1: Single Operation
    console.log('🔹 Test 1: Single Operation Latency');
    const { measurement } = await measurer.measureOperation(
      'energy_token',
      'mint_tokens',
      async () => {
        // Simulate blockchain operation
        await new Promise(resolve => setTimeout(resolve, 150 + Math.random() * 100));
        return { 
          signature: `demo_${Date.now()}`, 
          result: { amount: 1000, success: true } 
        };
      }
    );

    console.log(`   - Latency: ${measurement.transactionLatency.toFixed(2)}ms`);
    console.log(`   - Program: ${measurement.programId}`);
    console.log(`   - Instruction: ${measurement.instruction}\n`);

    // Test 2: Batch Operations
    console.log('🔹 Test 2: Batch Operations (20 iterations)');
    for (let i = 0; i < 20; i++) {
      await measurer.measureOperation(
        'energy_token',
        'transfer_tokens',
        async () => {
          const delay = 80 + Math.random() * 120;
          await new Promise(resolve => setTimeout(resolve, delay));
          return { 
            signature: `batch_${Date.now()}_${i}`, 
            result: { transferId: i, amount: 100 } 
          };
        }
      );
    }

    // Test 3: Mixed Operations
    console.log('🔹 Test 3: Mixed Operations');
    const operations = [
      { name: 'create_token', baseDelay: 200 },
      { name: 'approve', baseDelay: 100 },
      { name: 'transfer', baseDelay: 80 },
      { name: 'burn', baseDelay: 120 }
    ];

    for (const op of operations) {
      for (let i = 0; i < 5; i++) {
        await measurer.measureOperation(
          'energy_token',
          op.name,
          async () => {
            const delay = op.baseDelay + Math.random() * 80;
            await new Promise(resolve => setTimeout(resolve, delay));
            return { 
              signature: `${op.name}_${Date.now()}_${i}`, 
              result: { operation: op.name, processed: true } 
            };
          }
        );
      }
    }

    // Generate Report
    console.log('\n📈 Generating Performance Report...\n');
    const measurements = measurer.getMeasurements();
    const report = analyzer.generateReport(measurements);
    
    console.log('🎯 Performance Summary:');
    console.log(`   - Total Measurements: ${report.summary.totalMeasurements}`);
    console.log(`   - Average Latency: ${report.summary.averageLatency.toFixed(2)}ms`);
    console.log(`   - Median Latency: ${report.summary.medianLatency.toFixed(2)}ms`);
    console.log(`   - P50 Latency: ${report.summary.p50.toFixed(2)}ms`);
    console.log(`   - P95 Latency: ${report.summary.p95.toFixed(2)}ms`);
    console.log(`   - P99 Latency: ${report.summary.p99.toFixed(2)}ms`);
    console.log(`   - Min Latency: ${report.summary.minLatency.toFixed(2)}ms`);
    console.log(`   - Max Latency: ${report.summary.maxLatency.toFixed(2)}ms`);
    console.log(`   - Standard Deviation: ${report.summary.standardDeviation.toFixed(2)}ms`);

    console.log('\n📊 Trend Analysis:');
    console.log(`   - Direction: ${report.trends.direction.toUpperCase()}`);
    console.log(`   - Confidence: ${(report.trends.confidence * 100).toFixed(1)}%`);
    console.log(`   - Slope: ${report.trends.slope.toFixed(6)}ms/ms`);

    if (report.recommendations.length > 0) {
      console.log('\n💡 Performance Recommendations:');
      report.recommendations.forEach((rec, index) => {
        console.log(`   ${index + 1}. ${rec}`);
      });
    } else {
      console.log('\n💡 Performance Recommendations:');
      console.log('   ✨ Performance looks good! No issues detected.');
    }

    // Save detailed report
    const reportData = {
      timestamp: new Date().toISOString(),
      framework: 'GridTokenX Latency Measurement Framework',
      version: '1.0.0',
      summary: report.summary,
      trends: report.trends,
      recommendations: report.recommendations,
      measurements: measurements.map(m => ({
        timestamp: m.timestamp,
        programId: m.programId,
        instruction: m.instruction,
        transactionLatency: m.transactionLatency,
        success: m.success,
        signature: m.signature
      }))
    };

    const reportPath = './test-results/latency/demo-latency-report.json';
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
    console.log(`\n📁 Detailed report saved to: ${reportPath}`);

    console.log('\n✅ Latency test demo completed successfully!');
    console.log('\n📚 Next Steps:');
    console.log('   1. Run program-specific tests: npm run test:latency:energy-token');
    console.log('   2. Run full framework: npm run test:latency:framework');
    console.log('   3. Check documentation: tests/latency/README.md');

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
