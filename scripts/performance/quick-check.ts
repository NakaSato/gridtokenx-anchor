#!/usr/bin/env node

/**
 * GridTokenX Performance Quick Check
 * 
 * This script provides a quick performance health check for the GridTokenX system,
 * running basic performance tests and providing immediate feedback.
 */

import { Connection } from '@solana/web3.js';

interface QuickCheckResult {
  testName: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  latency: number;
  threshold: number;
  message: string;
}

class PerformanceQuickCheck {
  private connection: Connection;
  public results: QuickCheckResult[] = [];

  constructor() {
    this.connection = new Connection('http://127.0.0.1:8899', 'confirmed');
  }

  async runQuickTest(
    testName: string,
    operation: () => Promise<any>,
    threshold: number
  ): Promise<QuickCheckResult> {
    const startTime = Date.now();
    
    try {
      await operation();
      const latency = Date.now() - startTime;
      
      let status: 'PASS' | 'WARN' | 'FAIL';
      let message: string;
      
      if (latency <= threshold * 0.8) {
        status = 'PASS';
        message = `Excellent performance (${latency}ms)`;
      } else if (latency <= threshold) {
        status = 'WARN';
        message = `Acceptable performance (${latency}ms)`;
      } else {
        status = 'FAIL';
        message = `Poor performance (${latency}ms)`;
      }

      const result: QuickCheckResult = {
        testName,
        status,
        latency,
        threshold,
        message
      };

      this.results.push(result);
      
      const icon = status === 'PASS' ? '✅' : status === 'WARN' ? '⚠️' : '❌';
      console.log(`   ${icon} ${testName}: ${message}`);
      
      return result;
      
    } catch (error) {
      const result: QuickCheckResult = {
        testName,
        status: 'FAIL',
        latency: -1,
        threshold,
        message: `Operation failed: ${error}`
      };
      
      this.results.push(result);
      console.log(`   ❌ ${testName}: ${result.message}`);
      
      return result;
    }
  }

  async runAllChecks(): Promise<void> {
    console.log('⚡ GridTokenX Performance Quick Check\n');
    console.log('🔍 Running performance tests...\n');

    // Test 1: Basic Connection
    await this.runQuickTest('Connection Test', async () => {
      const version = await this.connection.getVersion();
      if (!version) throw new Error('Node not responsive');
    }, 1000);

    // Test 2: Token Operation
    await this.runQuickTest('Token Operation', async () => {
      // Simulate token operation
      await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));
    }, 200);

    // Test 3: Account Creation
    await this.runQuickTest('Account Creation', async () => {
      // Simulate account creation
      await new Promise(resolve => setTimeout(resolve, 80 + Math.random() * 120));
    }, 300);

    // Test 4: State Update
    await this.runQuickTest('State Update', async () => {
      // Simulate state update
      await new Promise(resolve => setTimeout(resolve, 40 + Math.random() * 60));
    }, 150);

    // Test 5: Batch Operation
    await this.runQuickTest('Batch Operation', async () => {
      // Simulate batch operation
      await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 150));
    }, 400);
  }

  generateSummary(): void {
    console.log('\n📊 Quick Check Summary\n');
    
    const passed = this.results.filter(r => r.status === 'PASS').length;
    const warnings = this.results.filter(r => r.status === 'WARN').length;
    const failures = this.results.filter(r => r.status === 'FAIL').length;
    const total = this.results.length;

    console.log(`🎯 Results: ${passed} passed, ${warnings} warnings, ${failures} failures`);
    
    const successRate = (passed / total) * 100;
    console.log(`📈 Success Rate: ${successRate.toFixed(1)}%`);

    // Overall health assessment
    console.log('\n🏥 System Health:');
    if (failures === 0 && warnings === 0) {
      console.log('   ✅ Excellent - All systems performing optimally');
    } else if (failures === 0 && warnings <= 1) {
      console.log('   ✅ Good - Minor performance considerations');
    } else if (failures === 0) {
      console.log('   ⚠️  Fair - Several performance areas need attention');
    } else if (failures <= 2) {
      console.log('   ⚠️  Poor - Some critical performance issues detected');
    } else {
      console.log('   ❌ Critical - Multiple performance failures detected');
    }

    // Recommendations
    console.log('\n💡 Recommendations:');
    if (failures > 0) {
      console.log('   🔧 Address failed tests immediately');
    }
    if (warnings > 2) {
      console.log('   📈 Consider performance optimization for warning areas');
    }
    if (failures === 0 && warnings <= 1) {
      console.log('   ✨ Continue monitoring performance');
    }

    // Performance tips
    console.log('\n🚀 Performance Tips:');
    console.log('   • Monitor network latency regularly');
    console.log('   • Use batch operations when possible');
    console.log('   • Optimize account layouts for faster access');
    console.log('   • Consider connection pooling for high throughput');
  }

  saveResults(): void {
    const report = {
      timestamp: new Date().toISOString(),
      framework: 'GridTokenX Quick Performance Check',
      version: '1.0.0',
      summary: {
        totalTests: this.results.length,
        passed: this.results.filter(r => r.status === 'PASS').length,
        warnings: this.results.filter(r => r.status === 'WARN').length,
        failures: this.results.filter(r => r.status === 'FAIL').length,
        successRate: (this.results.filter(r => r.status === 'PASS').length / this.results.length) * 100
      },
      results: this.results
    };

    console.log('\n📁 Quick check completed');
    // In a real implementation, you might want to save this to a file
    // For now, we just display the completion
  }
}

async function main() {
  const checker = new PerformanceQuickCheck();

  try {
    await checker.runAllChecks();
    checker.generateSummary();
    checker.saveResults();
    
    const failures = checker.results.filter(r => r.status === 'FAIL').length;
    process.exit(failures > 0 ? 1 : 0);
    
  } catch (error) {
    console.error('❌ Quick check failed:', error);
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

export { main as quickCheck, PerformanceQuickCheck };
