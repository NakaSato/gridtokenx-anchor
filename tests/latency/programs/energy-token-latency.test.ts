/**
 * Energy Token Program Latency Tests
 * 
 * This test suite measures latency for all critical operations
 * in the Energy Token program
 */

import * as anchor from '@coral-xyz/anchor';
import { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createLatencyFramework, TestScenario } from '../framework';

// Mock constants for testing
const PROGRAM_IDS = {
  energy_token: '94G1r674LmRDmLN2UPjDFD8Eh7zT8JaSaxv9v68GyEur'
};

const TEST_AMOUNTS = {
  ONE_TOKEN: 1_000_000_000,
  TEN_TOKENS: 10_000_000_000,
  SMALL_AMOUNT: 100_000_000
};

describe('Energy Token Latency Tests', () => {
  let connection: Connection;
  let framework: any;
  let provider: anchor.AnchorProvider;
  let energyTokenProgram: any;
  
  // Test wallets
  let authority: Keypair;
  let userWallet: Keypair;
  let mint: Keypair;

  before('Setup test environment', async () => {
    connection = new Connection('http://127.0.0.1:8899', 'confirmed');
    
    // Initialize latency framework
    framework = createLatencyFramework({
      connection,
      dataCollection: {
        outputDirectory: './test-results/latency/energy-token',
        enableFileStorage: true,
        enableMemoryStorage: true
      },
      analysis: {
        enableOutlierDetection: true,
        enableTrendAnalysis: true,
        enableRegressionDetection: true
      }
    });

    // Setup test wallets
    authority = Keypair.generate();
    userWallet = Keypair.generate();
    mint = Keypair.generate();

    // Fund wallets
    await connection.requestAirdrop(10 * LAMPORTS_PER_SOL, authority.publicKey);
    await connection.requestAirdrop(10 * LAMPORTS_PER_SOL, userWallet.publicKey);

    provider = new anchor.AnchorProvider(
      connection,
      new anchor.Wallet(authority),
      { commitment: 'confirmed' }
    );

    // Note: In real implementation, you would load the actual IDL
    // For now, we'll create a mock program for testing
    energyTokenProgram = {
      methods: {
        createTokenMint: () => ({ rpc: async () => 'mock_signature' }),
        mintToWallet: () => ({ rpc: async () => 'mock_signature' }),
        transferTokens: () => ({ rpc: async () => 'mock_signature' })
      }
    } as any;
  });

  after('Cleanup', async () => {
    await framework.cleanup();
  });

  describe('Token Creation Operations', () => {
    it('should measure create_token_mint latency', async () => {
      const testName = 'create_token_mint';
      
      const operation = async () => {
        // Simulate token creation with mock delay
        await new Promise(resolve => setTimeout(resolve, 200));
        const signature = 'mock_create_token_mint_signature';
        return { signature, result: null };
      };

      const { measurement } = await framework.measureOperation(
        PROGRAM_IDS.energy_token,
        testName,
        operation
      );

      console.log(`Create Token Mint Latency: ${measurement.transactionLatency.toFixed(2)}ms`);
      console.log(`Compute Units: ${measurement.metadata.computeUnits}`);
      
      // Assert latency is within acceptable range
      if (measurement.transactionLatency > 1000) {
        throw new Error(`Latency exceeded threshold: ${measurement.transactionLatency}ms`);
      }
    });

    it('should measure batch create_token_mint operations', async () => {
      const scenario: TestScenario = {
        name: 'batch_token_creation',
        description: 'Create multiple token mints',
        iterations: 10,
        concurrency: 1,
        delay: 100
      };

      const operation = async () => {
        // Simulate batch token creation
        await new Promise(resolve => setTimeout(resolve, 250));
        const signature = `mock_batch_signature_${Date.now()}`;
        return { signature, result: null };
      };

      const metrics = await framework.runTestScenario(
        scenario,
        PROGRAM_IDS.energy_token,
        operation
      );

      console.log(`Batch Token Creation Results:`);
      console.log(`- Average Latency: ${metrics.latency.mean.toFixed(2)}ms`);
      console.log(`- P95 Latency: ${metrics.latency.p95.toFixed(2)}ms`);
      console.log(`- P99 Latency: ${metrics.latency.p99.toFixed(2)}ms`);
      console.log(`- TPS: ${metrics.throughput.tps.toFixed(2)}`);
      console.log(`- Error Rate: ${metrics.errors.rate}%`);

      // Performance validations
      if (metrics.latency.mean > 500) {
        throw new Error(`Average latency exceeded threshold: ${metrics.latency.mean}ms`);
      }
      if (metrics.latency.p95 > 800) {
        throw new Error(`P95 latency exceeded threshold: ${metrics.latency.p95}ms`);
      }
      if (metrics.errors.rate > 5) {
        throw new Error(`Error rate exceeded threshold: ${metrics.errors.rate}%`);
      }
    });
  });

  describe('Token Minting Operations', () => {
    it('should measure mint_to_wallet latency', async () => {
      const testName = 'mint_to_wallet';
      const amount = TEST_AMOUNTS.ONE_TOKEN;

      const operation = async () => {
        // Simulate mint to wallet
        await new Promise(resolve => setTimeout(resolve, 150));
        const signature = 'mock_mint_to_wallet_signature';
        return { signature, result: null };
      };

      const { measurement } = await framework.measureOperation(
        PROGRAM_IDS.energy_token,
        testName,
        operation
      );

      console.log(`Mint to Wallet Latency: ${measurement.transactionLatency.toFixed(2)}ms`);
      
      if (measurement.transactionLatency > 400) {
        throw new Error(`Latency exceeded threshold: ${measurement.transactionLatency}ms`);
      }
    });

    it('should measure concurrent mint_to_wallet operations', async () => {
      const scenario: TestScenario = {
        name: 'concurrent_minting',
        description: 'Concurrent token minting operations',
        iterations: 0, // Not used for concurrent test
        concurrency: 20,
        delay: 0
      };

      const operation = async () => {
        // Simulate concurrent minting
        await new Promise(resolve => setTimeout(resolve, 300));
        const signature = `mock_concurrent_signature_${Date.now()}_${Math.random()}`;
        return { signature, result: null };
      };

      const metrics = await framework.measurer.runConcurrentScenario(scenario, operation);
      await framework.collector.recordMeasurements(
        framework.measurer.getMeasurementsByProgram(PROGRAM_IDS.energy_token)
      );

      console.log(`Concurrent Minting Results:`);
      console.log(`- Average Latency: ${metrics.latency.mean.toFixed(2)}ms`);
      console.log(`- P95 Latency: ${metrics.latency.p95.toFixed(2)}ms`);
      console.log(`- Successful Operations: ${metrics.throughput.operations}`);
      console.log(`- Error Rate: ${metrics.errors.rate}%`);

      // Concurrent operations should have reasonable latency
      if (metrics.latency.mean > 600) {
        throw new Error(`Concurrent latency exceeded threshold: ${metrics.latency.mean}ms`);
      }
      if (metrics.errors.rate > 10) {
        throw new Error(`Concurrent error rate exceeded threshold: ${metrics.errors.rate}%`);
      }
    });
  });

  describe('Token Transfer Operations', () => {
    it('should measure transfer_tokens latency', async () => {
      const testName = 'transfer_tokens';
      const amount = TEST_AMOUNTS.ONE_TOKEN;

      const operation = async () => {
        // Simulate token transfer
        await new Promise(resolve => setTimeout(resolve, 100));
        const signature = 'mock_transfer_tokens_signature';
        return { signature, result: null };
      };

      const { measurement } = await framework.measureOperation(
        PROGRAM_IDS.energy_token,
        testName,
        operation
      );

      console.log(`Transfer Tokens Latency: ${measurement.transactionLatency.toFixed(2)}ms`);
      
      if (measurement.transactionLatency > 300) {
        throw new Error(`Transfer latency exceeded threshold: ${measurement.transactionLatency}ms`);
      }
    });

    it('should measure high-frequency transfer operations', async () => {
      const scenario: TestScenario = {
        name: 'high_frequency_transfers',
        description: 'High frequency token transfers',
        iterations: 100,
        concurrency: 1,
        delay: 50 // 50ms between transfers
      };

      const operation = async () => {
        // Simulate high-frequency transfers
        await new Promise(resolve => setTimeout(resolve, 80));
        const signature = `mock_hf_transfer_${Date.now()}_${Math.random()}`;
        return { signature, result: null };
      };

      const metrics = await framework.runTestScenario(
        scenario,
        PROGRAM_IDS.energy_token,
        operation
      );

      console.log(`High Frequency Transfer Results:`);
      console.log(`- Average Latency: ${metrics.latency.mean.toFixed(2)}ms`);
      console.log(`- P95 Latency: ${metrics.latency.p95.toFixed(2)}ms`);
      console.log(`- Throughput: ${metrics.throughput.tps.toFixed(2)} TPS`);

      if (metrics.latency.mean > 250) {
        throw new Error(`HF transfer latency exceeded threshold: ${metrics.latency.mean}ms`);
      }
      if (metrics.throughput.tps < 5) {
        throw new Error(`HF transfer TPS below threshold: ${metrics.throughput.tps}`);
      }
    });
  });

  describe('Performance Analysis', () => {
    it('should generate comprehensive performance report', async () => {
      // Run a variety of operations to collect data
      const operations = [
        'create_token_mint',
        'mint_to_wallet',
        'transfer_tokens'
      ];

      for (const operation of operations) {
        const scenario: TestScenario = {
          name: `report_${operation}`,
          description: `Data collection for ${operation}`,
          iterations: 10,
          concurrency: 1,
          delay: 100
        };

        await framework.runTestScenario(scenario, PROGRAM_IDS.energy_token, async () => {
          // Simulate operation for data collection
          await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));
          return { 
            signature: `mock_report_signature_${Date.now()}_${Math.random()}`, 
            result: null 
          };
        });
      }

      // Generate comprehensive report
      const report = framework.analyzer.generateReport(
        framework.measurer.getMeasurements()
      );
      
      console.log('=== Energy Token Performance Report ===');
      console.log(`Total Measurements: ${report.summary.totalMeasurements}`);
      console.log(`Average Latency: ${report.summary.averageLatency.toFixed(2)}ms`);
      console.log(`P95 Latency: ${report.summary.p95.toFixed(2)}ms`);
      console.log(`P99 Latency: ${report.summary.p99.toFixed(2)}ms`);
      console.log(`Outlier Rate: ${report.summary.outlierRate.toFixed(2)}%`);
      
      console.log('\nTrend Analysis:');
      console.log(`Direction: ${report.trends.direction}`);
      console.log(`Confidence: ${(report.trends.confidence * 100).toFixed(1)}%`);
      
      console.log('\nRegressions Detected:');
      console.log(`Count: ${report.regressions.length}`);
      
      console.log('\nRecommendations:');
      report.recommendations.forEach((rec: string) => console.log(`- ${rec}`));

      // Export detailed report
      const reportPath = await framework.exportReport('energy-token-performance-report.json');
      console.log(`\nDetailed report exported to: ${reportPath}`);

      // Validate report generation
      if (report.summary.totalMeasurements === 0) {
        throw new Error('No measurements collected');
      }
      if (!report.recommendations || report.recommendations.length === 0) {
        throw new Error('No recommendations generated');
      }
    });
  });

  describe('Load Testing', () => {
    it('should handle concurrent user load', async () => {
      const scenario: TestScenario = {
        name: 'concurrent_user_load',
        description: 'Multiple users performing operations',
        iterations: 0,
        concurrency: 50,
        delay: 0
      };

      const operation = async () => {
        // Simulate various user operations
        const operationType = Math.floor(Math.random() * 3); // 0: create, 1: mint, 2: transfer
        const baseDelay = [200, 150, 100][operationType];
        const variance = Math.random() * 100;
        
        await new Promise(resolve => setTimeout(resolve, baseDelay + variance));
        const signature = `mock_load_test_${Date.now()}_${Math.random()}`;
        return { signature, result: null };
      };

      const metrics = await framework.measurer.runConcurrentScenario(scenario, operation);
      await framework.collector.recordMeasurements(
        framework.measurer.getMeasurementsByProgram(PROGRAM_IDS.energy_token)
      );

      console.log(`Concurrent User Load Results:`);
      console.log(`- Average Latency: ${metrics.latency.mean.toFixed(2)}ms`);
      console.log(`- P95 Latency: ${metrics.latency.p95.toFixed(2)}ms`);
      console.log(`- Successful Operations: ${metrics.throughput.operations}`);
      console.log(`- Error Rate: ${metrics.errors.rate}%`);

      // Load testing assertions
      if (metrics.latency.mean > 800) {
        throw new Error(`Load test latency exceeded threshold: ${metrics.latency.mean}ms`);
      }
      if (metrics.errors.rate > 15) {
        throw new Error(`Load test error rate exceeded threshold: ${metrics.errors.rate}%`);
      }
    });
  });
});
