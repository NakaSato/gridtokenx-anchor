#!/usr/bin/env node

/**
 * GridTokenX Integration Test Runner
 * 
 * This script runs comprehensive integration tests for the GridTokenX platform,
 * testing cross-program workflows and end-to-end scenarios.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { TestEnvironment } from '../setup';
import { TestUtils } from '../utils/index';
import { EnergyTradingWorkflowTest } from './energy-trading-workflow.test';
import { CpiPerformanceTest } from './cpi-performance.test';
import { ErrorPropagationTest } from './error-propagation.test';
import { MultiUserTradingTest } from './multi-user-trading.test';
import { EnergyDataPipelineTest } from './energy-data-pipeline.test';
import { EmergencyResponseTest } from './emergency-response.test';

interface IntegrationTestConfig {
  testSuite?: 'all' | 'workflow' | 'cpi' | 'error' | 'multi-user' | 'pipeline' | 'emergency';
  verbose?: boolean;
  saveResults?: boolean;
  parallel?: boolean;
}

interface IntegrationTestResult {
  testName: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  error?: string;
  details?: any;
}

interface IntegrationTestSummary {
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  totalDuration: number;
  results: IntegrationTestResult[];
}

class IntegrationTestRunner {
  private connection: Connection;
  private env: TestEnvironment | null = null;
  private results: IntegrationTestResult[] = [];

  constructor() {
    this.connection = new Connection('http://127.0.0.1:8899', 'confirmed');
  }

  async initialize(): Promise<void> {
    console.log('🚀 Initializing GridTokenX Integration Test Environment...\n');
    
    try {
      this.env = await TestEnvironment.create();
      console.log('✅ Test environment initialized successfully');
    } catch (error: any) {
      console.error('❌ Failed to initialize test environment:', error.message);
      throw error;
    }
  }

  async runTest(testName: string, testFunction: () => Promise<void>): Promise<IntegrationTestResult> {
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
        error: error.message,
        details: error.stack
      };
    }
  }

  async runEnergyTradingWorkflowTests(): Promise<IntegrationTestResult[]> {
    if (!this.env) throw new Error('Test environment not initialized');
    
    const workflowTest = new EnergyTradingWorkflowTest(this.env, this.connection);
    
    return [
      await this.runTest('Complete Energy Trading Journey', async () => { 
        await workflowTest.testCompleteEnergyTradingJourney();
      }),
      await this.runTest('User Registration Flow', async () => { 
        await workflowTest.testUserRegistrationFlow();
      }),
      await this.runTest('Token Minting Flow', async () => { 
        await workflowTest.testTokenMintingFlow();
      }),
      await this.runTest('Order Execution Flow', async () => { 
        await workflowTest.testOrderExecutionFlow();
      }),
    ];
  }

  async runCpiPerformanceTests(): Promise<IntegrationTestResult[]> {
    if (!this.env) throw new Error('Test environment not initialized');
    
    const cpiTest = new CpiPerformanceTest(this.env, this.connection);
    
    return [
      await this.runTest('CPI Call Overhead Measurement', () => 
        cpiTest.testCpiCallOverhead()
      ),
      await this.runTest('Data Serialization Costs', () => 
        cpiTest.testDataSerializationCosts()
      ),
      await this.runTest('Context Switching Performance', () => 
        cpiTest.testContextSwitchingPerformance()
      ),
    ];
  }

  async runErrorPropagationTests(): Promise<IntegrationTestResult[]> {
    if (!this.env) throw new Error('Test environment not initialized');
    
    const errorTest = new ErrorPropagationTest(this.env, this.connection);
    
    return [
      await this.runTest('Cross-Program Error Handling', () => 
        errorTest.testCrossProgramErrorHandling()
      ),
      await this.runTest('Error Message Propagation', () => 
        errorTest.testErrorMessagePropagation()
      ),
      await this.runTest('Rollback Scenarios', () => 
        errorTest.testRollbackScenarios()
      ),
    ];
  }

  async runMultiUserTradingTests(): Promise<IntegrationTestResult[]> {
    if (!this.env) throw new Error('Test environment not initialized');
    
    const multiUserTest = new MultiUserTradingTest(this.env, this.connection);
    
    return [
      await this.runTest('Concurrent User Trading', () => 
        multiUserTest.testConcurrentUserTrading()
      ),
      await this.runTest('Order Book Consistency', () => 
        multiUserTest.testOrderBookConsistency()
      ),
      await this.runTest('User Data Isolation', () => 
        multiUserTest.testUserDataIsolation()
      ),
    ];
  }

  async runEnergyDataPipelineTests(): Promise<IntegrationTestResult[]> {
    if (!this.env) throw new Error('Test environment not initialized');
    
    const pipelineTest = new EnergyDataPipelineTest(this.env, this.connection);
    
    return [
      await this.runTest('Meter Reading Pipeline', () => 
        pipelineTest.testMeterReadingPipeline()
      ),
      await this.runTest('Data Flow Validation', () => 
        pipelineTest.testDataFlowValidation()
      ),
      await this.runTest('Pipeline Performance', () => 
        pipelineTest.testPipelinePerformance()
      ),
    ];
  }

  async runEmergencyResponseTests(): Promise<IntegrationTestResult[]> {
    if (!this.env) throw new Error('Test environment not initialized');
    
    const emergencyTest = new EmergencyResponseTest(this.env, this.connection);
    
    return [
      await this.runTest('Emergency Pause Workflow', () => 
        emergencyTest.testEmergencyPauseWorkflow()
      ),
      await this.runTest('Recovery Scenarios', () => 
        emergencyTest.testRecoveryScenarios()
      ),
      await this.runTest('Emergency Data Consistency', () => 
        emergencyTest.testEmergencyDataConsistency()
      ),
    ];
  }

  async runAllTests(config: IntegrationTestConfig): Promise<IntegrationTestSummary> {
    const startTime = Date.now();
    console.log('🎯 Starting GridTokenX Integration Tests\n');

    const testSuites: { [key: string]: () => Promise<IntegrationTestResult[]> } = {
      workflow: () => this.runEnergyTradingWorkflowTests(),
      cpi: () => this.runCpiPerformanceTests(),
      error: () => this.runErrorPropagationTests(),
      'multi-user': () => this.runMultiUserTradingTests(),
      pipeline: () => this.runEnergyDataPipelineTests(),
      emergency: () => this.runEmergencyResponseTests(),
    };

    const suitesToRun = config.testSuite === 'all' 
      ? Object.keys(testSuites)
      : config.testSuite 
        ? [config.testSuite]
        : Object.keys(testSuites);

    for (const suite of suitesToRun) {
      if (testSuites[suite]) {
        console.log(`\n📋 Running ${suite} test suite...`);
        const suiteResults = await testSuites[suite]();
        this.results.push(...suiteResults);
      }
    }

    const totalDuration = Date.now() - startTime;
    const summary = this.generateSummary(totalDuration);

    this.printSummary(summary);

    if (config.saveResults) {
      await this.saveResults(summary);
    }

    return summary;
  }

  generateSummary(totalDuration: number): IntegrationTestSummary {
    const passed = this.results.filter(r => r.status === 'passed').length;
    const failed = this.results.filter(r => r.status === 'failed').length;
    const skipped = this.results.filter(r => r.status === 'skipped').length;

    return {
      totalTests: this.results.length,
      passed,
      failed,
      skipped,
      totalDuration,
      results: this.results,
    };
  }

  printSummary(summary: IntegrationTestSummary): void {
    console.log('\n📊 Integration Test Summary\n');
    console.log(`Total Tests: ${summary.totalTests}`);
    console.log(`✅ Passed: ${summary.passed}`);
    console.log(`❌ Failed: ${summary.failed}`);
    console.log(`⏭️  Skipped: ${summary.skipped}`);
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

  async saveResults(summary: IntegrationTestSummary): Promise<void> {
    const fs = await import('fs/promises');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `integration-test-results-${timestamp}.json`;
    const filepath = `./test-results/integration/${filename}`;

    try {
      await fs.mkdir('./test-results/integration', { recursive: true });
      
      const report = {
        timestamp: new Date().toISOString(),
        framework: 'GridTokenX Integration Testing',
        version: '1.0.0',
        summary,
        environment: {
          connection: this.connection.rpcEndpoint,
          testWallets: this.env ? {
            authority: this.env.authority.publicKey.toBase58(),
            testUser: this.env.testUser.publicKey.toBase58(),
          } : null
        }
      };

      await fs.writeFile(filepath, JSON.stringify(report, null, 2));
      console.log(`\n📁 Integration test results saved to: ${filepath}`);
    } catch (error: any) {
      console.error('❌ Failed to save test results:', error.message);
    }
  }

  async cleanup(): Promise<void> {
    console.log('\n🧹 Cleaning up integration test environment...');
    // Cleanup any test data if needed
    console.log('✅ Cleanup completed');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const config: IntegrationTestConfig = {};

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--test-suite' && args[i + 1]) {
      config.testSuite = args[i + 1] as any;
      i++;
    } else if (arg === '--verbose') {
      config.verbose = true;
    } else if (arg === '--save-results') {
      config.saveResults = true;
    } else if (arg === '--parallel') {
      config.parallel = true;
    }
  }

  const runner = new IntegrationTestRunner();

  try {
    await runner.initialize();
    const summary = await runner.runAllTests(config);
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

export { main as runIntegrationTests, IntegrationTestRunner };
export type { IntegrationTestConfig, IntegrationTestResult, IntegrationTestSummary };
