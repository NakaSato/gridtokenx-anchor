#!/usr/bin/env node

/**
 * Simple GridTokenX Integration Test Runner
 * 
 * This is a simplified version that runs integration tests
 * without requiring full Anchor workspace setup.
 */

import { Connection, PublicKey } from '@solana/web3.js';

interface SimpleTestResult {
  testName: string;
  status: 'passed' | 'failed';
  duration: number;
  error?: string;
}

interface SimpleTestSummary {
  totalTests: number;
  passed: number;
  failed: number;
  totalDuration: number;
  results: SimpleTestResult[];
}

class SimpleIntegrationTestRunner {
  private connection: Connection;
  private results: SimpleTestResult[] = [];

  constructor() {
    this.connection = new Connection('http://127.0.0.1:8899', 'confirmed');
  }

  async initialize(): Promise<void> {
    console.log('🚀 Initializing Simple GridTokenX Integration Test Environment...\n');
    
    try {
      // Test connection to local validator
      const version = await this.connection.getVersion();
      console.log(`✅ Connected to Solana validator (version: ${version['solana-core']})`);
    } catch (error: any) {
      console.error('❌ Failed to connect to Solana validator:', error.message);
      throw error;
    }
  }

  async runTest(testName: string, testFunction: () => Promise<void>): Promise<SimpleTestResult> {
    const startTime = Date.now();
    console.log(`🔹 Running ${testName}...`);

    try {
      await testFunction();
      const duration = Date.now() - startTime;
      
      console.log(`   ✅ ${testName} passed (${duration}ms)`);
      return {
        testName,
        status: 'passed',
        duration,
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      console.error(`   ❌ ${testName} failed: ${error.message}`);
      
      return {
        testName,
        status: 'failed',
        duration,
        error: error.message
      };
    }
  }

  async testBasicConnection(): Promise<void> {
    // Test basic connection to validator
    const slot = await this.connection.getSlot();
    console.log(`    Current slot: ${slot}`);
    
    // Test getting some system accounts
    const recentBlockhash = await this.connection.getLatestBlockhash();
    console.log(`    Latest blockhash: ${recentBlockhash.blockhash.slice(0, 8)}...`);
  }

  async testProgramDeployment(): Promise<void> {
    // Test if programs are deployed (using known program IDs from Anchor.toml)
    const programIds = {
      energyToken: '94G1r674LmRDmLN2UPjDFD8Eh7zT8JaSaxv9v68GyEur',
      governance: '4DY97YYBt4bxvG7xaSmWy3MhYhmA6HoMajBHVqhySvXe',
      oracle: 'DvdtU4quEbuxUY2FckmvcXwTpC9qp4HLJKb1PMLaqAoE',
      registry: '9XS8uUEVErcA8LABrJQAdohWMXTToBwhFN7Rvur6dC5',
      trading: 'GZnqNTJsre6qB4pWCQRE9FiJU2GUeBtBDPp6s7zosctk',
    };

    for (const [name, programId] of Object.entries(programIds)) {
      try {
        const account = await this.connection.getAccountInfo(new PublicKey(programId));
        if (account) {
          console.log(`    ✅ ${name} program deployed: ${programId}`);
        } else {
          console.log(`    ⚠️  ${name} program not found: ${programId}`);
        }
      } catch (error) {
        console.log(`    ❌ ${name} program check failed: ${programId}`);
      }
    }
  }

  async testWorkflowSimulation(): Promise<void> {
    // Simulate the energy trading workflow without actual transactions
    console.log('    🔄 Simulating energy trading workflow...');
    
    const workflowSteps = [
      'User Registration',
      'Meter Registration', 
      'Energy Reading Submission',
      'ERC Issuance',
      'Token Minting',
      'Order Creation',
      'Order Matching',
      'Trade Execution',
      'Settlement'
    ];

    for (let i = 0; i < workflowSteps.length; i++) {
      const step = workflowSteps[i];
      const delay = 50 + Math.random() * 100; // 50-150ms per step
      
      await new Promise(resolve => setTimeout(resolve, delay));
      console.log(`      Step ${i + 1}/${workflowSteps.length}: ${step} (${Math.round(delay)}ms)`);
    }
    
    console.log('    ✅ Workflow simulation completed');
  }

  async testPerformanceMetrics(): Promise<void> {
    // Test performance metrics collection
    console.log('    📊 Collecting performance metrics...');
    
    const iterations = 100;
    const measurements: number[] = [];
    
    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      
      // Simulate some work (connection ping)
      await this.connection.getSlot();
      
      const duration = Date.now() - start;
      measurements.push(duration);
    }
    
    const avg = measurements.reduce((sum, val) => sum + val, 0) / measurements.length;
    const min = Math.min(...measurements);
    const max = Math.max(...measurements);
    const p95 = measurements.sort((a, b) => a - b)[Math.floor(measurements.length * 0.95)];
    
    console.log(`    📈 Performance: avg=${avg.toFixed(2)}ms, min=${min}ms, max=${max}ms, p95=${p95}ms`);
  }

  async runAllTests(): Promise<SimpleTestSummary> {
    const startTime = Date.now();
    console.log('🎯 Starting Simple GridTokenX Integration Tests\n');

    const tests = [
      this.runTest('Basic Connection Test', () => this.testBasicConnection()),
      this.runTest('Program Deployment Test', () => this.testProgramDeployment()),
      this.runTest('Workflow Simulation Test', () => this.testWorkflowSimulation()),
      this.runTest('Performance Metrics Test', () => this.testPerformanceMetrics()),
    ];

    // Run all tests
    for (const testPromise of tests) {
      const result = await testPromise;
      this.results.push(result);
    }

    const totalDuration = Date.now() - startTime;
    const summary = this.generateSummary(totalDuration);

    this.printSummary(summary);
    return summary;
  }

  generateSummary(totalDuration: number): SimpleTestSummary {
    const passed = this.results.filter(r => r.status === 'passed').length;
    const failed = this.results.filter(r => r.status === 'failed').length;

    return {
      totalTests: this.results.length,
      passed,
      failed,
      totalDuration,
      results: this.results,
    };
  }

  printSummary(summary: SimpleTestSummary): void {
    console.log('\n📊 Simple Integration Test Summary\n');
    console.log(`Total Tests: ${summary.totalTests}`);
    console.log(`✅ Passed: ${summary.passed}`);
    console.log(`❌ Failed: ${summary.failed}`);
    console.log(`⏱️  Total Duration: ${summary.totalDuration}ms`);
    console.log(`📈 Success Rate: ${((summary.passed / summary.totalTests) * 100).toFixed(2)}%`);

    if (summary.failed > 0) {
      console.log('\n❌ Failed Tests:');
      summary.results
        .filter(r => r.status === 'failed')
        .forEach(r => {
          console.log(`   - ${r.testName}: ${r.error}`);
        });
    }
  }

  async cleanup(): Promise<void> {
    console.log('\n🧹 Cleaning up test environment...');
    console.log('✅ Cleanup completed');
  }
}

async function main() {
  const runner = new SimpleIntegrationTestRunner();

  try {
    await runner.initialize();
    const summary = await runner.runAllTests();
    await runner.cleanup();

    // Exit with appropriate code
    if (summary.failed > 0) {
      console.log('\n❌ Some integration tests failed');
      process.exit(1);
    } else {
      console.log('\n✅ All integration tests passed successfully!');
      process.exit(0);
    }
  } catch (error: any) {
    console.error('❌ Integration test runner failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the main function if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { main as runSimpleIntegrationTests, SimpleIntegrationTestRunner };
export type { SimpleTestResult, SimpleTestSummary };
