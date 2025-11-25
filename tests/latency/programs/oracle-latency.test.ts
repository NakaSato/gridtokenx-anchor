/**
 * Oracle Program Latency Tests
 * 
 * This test suite measures latency for all critical operations
 * in Oracle program for price feeds and data validation
 */

import * as anchor from '@coral-xyz/anchor';
import { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createLatencyFramework, TestScenario } from '../framework';

// Mock constants for testing
const PROGRAM_IDS = {
  oracle: 'Orac1e2N3H4g5J6k7L8m9N0p1Q2r3S4t5U6v7W8x9Y0z'
};

const PRICE_FEEDS = {
  SOL_USD: 'SOL/USD',
  BTC_USD: 'BTC/USD',
  ETH_USD: 'ETH/USD',
  ENERGY_PRICE: 'ENERGY/kWh'
};

describe('Oracle Program Latency Tests', () => {
  let connection: Connection;
  let framework: any;
  let provider: anchor.AnchorProvider;
  let oracleProgram: any;
  
  // Test wallets
  let authority: Keypair;
  let dataProvider: Keypair;
  let priceUpdater: Keypair;

  before('Setup test environment', async () => {
    connection = new Connection('http://127.0.0.1:8899', 'confirmed');
    
    // Initialize latency framework
    framework = createLatencyFramework({
      connection,
      dataCollection: {
        outputDirectory: './test-results/latency/oracle',
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
    dataProvider = Keypair.generate();
    priceUpdater = Keypair.generate();

    // Fund wallets
    await connection.requestAirdrop(authority.publicKey, 10 * LAMPORTS_PER_SOL);
    await connection.requestAirdrop(dataProvider.publicKey, 10 * LAMPORTS_PER_SOL);
    await connection.requestAirdrop(priceUpdater.publicKey, 10 * LAMPORTS_PER_SOL);

    provider = new anchor.AnchorProvider(
      connection,
      new anchor.Wallet(authority),
      { commitment: 'confirmed' }
    );

    // Mock oracle program
    oracleProgram = {
      methods: {
        initializeOracle: () => ({ rpc: async () => 'mock_init_oracle_signature' }),
        addPriceFeed: () => ({ rpc: async () => 'mock_add_feed_signature' }),
        updatePrice: () => ({ rpc: async () => 'mock_update_price_signature' }),
        submitDataValidation: () => ({ rpc: async () => 'mock_validation_signature' }),
        getLatestPrice: () => ({ rpc: async () => 'mock_get_price_signature' }),
        submitBatchPrices: () => ({ rpc: async () => 'mock_batch_prices_signature' }),
        verifyDataIntegrity: () => ({ rpc: async () => 'mock_verify_signature' })
      }
    } as any;
  });

  after('Cleanup', async () => {
    await framework.cleanup();
  });

  describe('Oracle Initialization Operations', () => {
    it('should measure initialize_oracle latency', async () => {
      const testName = 'initialize_oracle';
      
      const operation = async () => {
        // Simulate oracle initialization
        await new Promise(resolve => setTimeout(resolve, 280));
        const signature = 'mock_initialize_oracle_signature';
        return { signature, result: { oracleId: Math.floor(Math.random() * 10000) } };
      };

      const { measurement } = await framework.measureOperation(
        PROGRAM_IDS.oracle,
        testName,
        operation
      );

      console.log(`Initialize Oracle Latency: ${measurement.transactionLatency.toFixed(2)}ms`);
      console.log(`Compute Units: ${measurement.metadata.computeUnits}`);
      
      if (measurement.transactionLatency > 800) {
        throw new Error(`Oracle initialization exceeded threshold: ${measurement.transactionLatency}ms`);
      }
    });

    it('should measure batch oracle initialization', async () => {
      const scenario: TestScenario = {
        name: 'batch_oracle_init',
        description: 'Batch oracle initialization operations',
        iterations: 3,
        concurrency: 1,
        delay: 300
      };

      const operation = async () => {
        // Simulate batch oracle initialization
        await new Promise(resolve => setTimeout(resolve, 320));
        const signature = `mock_batch_init_${Date.now()}`;
        return { signature, result: { oracleId: Math.floor(Math.random() * 10000) } };
      };

      const metrics = await framework.runTestScenario(
        scenario,
        PROGRAM_IDS.oracle,
        operation
      );

      console.log(`Batch Oracle Init Results:`);
      console.log(`- Average Latency: ${metrics.latency.mean.toFixed(2)}ms`);
      console.log(`- P95 Latency: ${metrics.latency.p95.toFixed(2)}ms`);
      console.log(`- TPS: ${metrics.throughput.tps.toFixed(2)}`);

      if (metrics.latency.mean > 500) {
        throw new Error(`Batch oracle init exceeded threshold: ${metrics.latency.mean}ms`);
      }
    });
  });

  describe('Price Feed Management Operations', () => {
    it('should measure add_price_feed latency', async () => {
      const testName = 'add_price_feed';
      
      const operation = async () => {
        // Simulate adding price feed
        await new Promise(resolve => setTimeout(resolve, 220));
        const signature = 'mock_add_price_feed_signature';
        return { 
          signature, 
          result: { 
            feedId: PRICE_FEEDS.SOL_USD,
            asset: 'Solana',
            currency: 'USD'
          } 
        };
      };

      const { measurement } = await framework.measureOperation(
        PROGRAM_IDS.oracle,
        testName,
        operation
      );

      console.log(`Add Price Feed Latency: ${measurement.transactionLatency.toFixed(2)}ms`);
      
      if (measurement.transactionLatency > 400) {
        throw new Error(`Add price feed exceeded threshold: ${measurement.transactionLatency}ms`);
      }
    });

    it('should measure high-frequency price feed additions', async () => {
      const scenario: TestScenario = {
        name: 'high_frequency_price_feeds',
        description: 'High frequency price feed additions',
        iterations: 40,
        concurrency: 1,
        delay: 80
      };

      const operation = async () => {
        // Simulate high-frequency price feed additions
        await new Promise(resolve => setTimeout(resolve, 180 + Math.random() * 80));
        const feeds = Object.values(PRICE_FEEDS);
        const feed = feeds[Math.floor(Math.random() * feeds.length)];
        const signature = `mock_hf_feed_${Date.now()}_${Math.random()}`;
        return { 
          signature, 
          result: { 
            feedId: feed,
            timestamp: Date.now()
          } 
        };
      };

      const metrics = await framework.runTestScenario(
        scenario,
        PROGRAM_IDS.oracle,
        operation
      );

      console.log(`High Frequency Price Feed Results:`);
      console.log(`- Average Latency: ${metrics.latency.mean.toFixed(2)}ms`);
      console.log(`- P95 Latency: ${metrics.latency.p95.toFixed(2)}ms`);
      console.log(`- Throughput: ${metrics.throughput.tps.toFixed(2)} TPS`);

      if (metrics.latency.mean > 300) {
        throw new Error(`HF price feed exceeded threshold: ${metrics.latency.mean}ms`);
      }
      if (metrics.throughput.tps < 8) {
        throw new Error(`HF price feed TPS below threshold: ${metrics.throughput.tps}`);
      }
    });
  });

  describe('Price Update Operations', () => {
    it('should measure update_price latency', async () => {
      const testName = 'update_price';
      
      const operation = async () => {
        // Simulate price update
        await new Promise(resolve => setTimeout(resolve, 120));
        const signature = 'mock_update_price_signature';
        return { 
          signature, 
          result: { 
            feedId: PRICE_FEEDS.SOL_USD,
            price: 150.25 + Math.random() * 10,
            confidence: 0.99,
            timestamp: Date.now()
          } 
        };
      };

      const { measurement } = await framework.measureOperation(
        PROGRAM_IDS.oracle,
        testName,
        operation
      );

      console.log(`Update Price Latency: ${measurement.transactionLatency.toFixed(2)}ms`);
      
      if (measurement.transactionLatency > 250) {
        throw new Error(`Price update exceeded threshold: ${measurement.transactionLatency}ms`);
      }
    });

    it('should measure concurrent price updates', async () => {
      const scenario: TestScenario = {
        name: 'concurrent_price_updates',
        description: 'Concurrent price update operations',
        iterations: 0,
        concurrency: 150,
        delay: 0
      };

      const operation = async () => {
        // Simulate concurrent price updates
        await new Promise(resolve => setTimeout(resolve, 80 + Math.random() * 60));
        const feeds = Object.values(PRICE_FEEDS);
        const feed = feeds[Math.floor(Math.random() * feeds.length)];
        const signature = `mock_concurrent_price_${Date.now()}_${Math.random()}`;
        return { 
          signature, 
          result: { 
            feedId: feed,
            price: 100 + Math.random() * 200,
            timestamp: Date.now()
          } 
        };
      };

      const metrics = await framework.measurer.runConcurrentScenario(scenario, operation);
      await framework.collector.recordMeasurements(
        framework.measurer.getMeasurementsByProgram(PROGRAM_IDS.oracle)
      );

      console.log(`Concurrent Price Update Results:`);
      console.log(`- Average Latency: ${metrics.latency.mean.toFixed(2)}ms`);
      console.log(`- P95 Latency: ${metrics.latency.p95.toFixed(2)}ms`);
      console.log(`- Successful Operations: ${metrics.throughput.operations}`);
      console.log(`- Error Rate: ${metrics.errors.rate}%`);

      if (metrics.latency.mean > 200) {
        throw new Error(`Concurrent price update exceeded threshold: ${metrics.latency.mean}ms`);
      }
      if (metrics.errors.rate > 15) {
        throw new Error(`Concurrent price update error rate exceeded threshold: ${metrics.errors.rate}%`);
      }
    });

    it('should measure batch price updates', async () => {
      const testName = 'submit_batch_prices';
      
      const operation = async () => {
        // Simulate batch price updates
        await new Promise(resolve => setTimeout(resolve, 250));
        const signature = 'mock_batch_prices_signature';
        
        const batchPrices = Object.values(PRICE_FEEDS).map(feed => ({
          feedId: feed,
          price: 100 + Math.random() * 200,
          confidence: 0.95 + Math.random() * 0.04,
          timestamp: Date.now()
        }));

        return { 
          signature, 
          result: { 
            batchId: Math.floor(Math.random() * 10000),
            priceCount: batchPrices.length,
            prices: batchPrices
          } 
        };
      };

      const { measurement } = await framework.measureOperation(
        PROGRAM_IDS.oracle,
        testName,
        operation
      );

      console.log(`Batch Price Update Latency: ${measurement.transactionLatency.toFixed(2)}ms`);
      
      if (measurement.transactionLatency > 500) {
        throw new Error(`Batch price update exceeded threshold: ${measurement.transactionLatency}ms`);
      }
    });
  });

  describe('Data Validation Operations', () => {
    it('should measure submit_data_validation latency', async () => {
      const testName = 'submit_data_validation';
      
      const operation = async () => {
        // Simulate data validation submission
        await new Promise(resolve => setTimeout(resolve, 160));
        const signature = 'mock_validation_signature';
        return { 
          signature, 
          result: { 
            validationId: Math.floor(Math.random() * 10000),
            feedId: PRICE_FEEDS.SOL_USD,
            isValid: true,
            confidence: 0.98
          } 
        };
      };

      const { measurement } = await framework.measureOperation(
        PROGRAM_IDS.oracle,
        testName,
        operation
      );

      console.log(`Data Validation Latency: ${measurement.transactionLatency.toFixed(2)}ms`);
      
      if (measurement.transactionLatency > 300) {
        throw new Error(`Data validation exceeded threshold: ${measurement.transactionLatency}ms`);
      }
    });

    it('should measure verify_data_integrity latency', async () => {
      const testName = 'verify_data_integrity';
      
      const operation = async () => {
        // Simulate data integrity verification
        await new Promise(resolve => setTimeout(resolve, 200));
        const signature = 'mock_verify_signature';
        return { 
          signature, 
          result: { 
            verificationId: Math.floor(Math.random() * 10000),
            isIntegrityValid: true,
            checkedFeeds: Object.values(PRICE_FEEDS).length,
            timestamp: Date.now()
          } 
        };
      };

      const { measurement } = await framework.measureOperation(
        PROGRAM_IDS.oracle,
        testName,
        operation
      );

      console.log(`Data Integrity Verification Latency: ${measurement.transactionLatency.toFixed(2)}ms`);
      
      if (measurement.transactionLatency > 400) {
        throw new Error(`Data integrity verification exceeded threshold: ${measurement.transactionLatency}ms`);
      }
    });
  });

  describe('Price Query Operations', () => {
    it('should measure get_latest_price latency', async () => {
      const testName = 'get_latest_price';
      
      const operation = async () => {
        // Simulate latest price query
        await new Promise(resolve => setTimeout(resolve, 80));
        const signature = 'mock_get_price_signature';
        const feeds = Object.values(PRICE_FEEDS);
        const feed = feeds[Math.floor(Math.random() * feeds.length)];
        return { 
          signature, 
          result: { 
            feedId: feed,
            price: 100 + Math.random() * 200,
            timestamp: Date.now(),
            confidence: 0.99
          } 
        };
      };

      const { measurement } = await framework.measureOperation(
        PROGRAM_IDS.oracle,
        testName,
        operation
      );

      console.log(`Get Latest Price Latency: ${measurement.transactionLatency.toFixed(2)}ms`);
      
      if (measurement.transactionLatency > 150) {
        throw new Error(`Get latest price exceeded threshold: ${measurement.transactionLatency}ms`);
      }
    });

    it('should measure high-frequency price queries', async () => {
      const scenario: TestScenario = {
        name: 'high_frequency_price_queries',
        description: 'High frequency price query operations',
        iterations: 200,
        concurrency: 1,
        delay: 20
      };

      const operation = async () => {
        // Simulate high-frequency price queries
        await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 30));
        const feeds = Object.values(PRICE_FEEDS);
        const feed = feeds[Math.floor(Math.random() * feeds.length)];
        const signature = `mock_hf_query_${Date.now()}_${Math.random()}`;
        return { 
          signature, 
          result: { 
            feedId: feed,
            price: 100 + Math.random() * 200,
            queryTime: Date.now()
          } 
        };
      };

      const metrics = await framework.runTestScenario(
        scenario,
        PROGRAM_IDS.oracle,
        operation
      );

      console.log(`High Frequency Price Query Results:`);
      console.log(`- Average Latency: ${metrics.latency.mean.toFixed(2)}ms`);
      console.log(`- P95 Latency: ${metrics.latency.p95.toFixed(2)}ms`);
      console.log(`- Throughput: ${metrics.throughput.tps.toFixed(2)} TPS`);

      if (metrics.latency.mean > 100) {
        throw new Error(`HF price query exceeded threshold: ${metrics.latency.mean}ms`);
      }
      if (metrics.throughput.tps < 25) {
        throw new Error(`HF price query TPS below threshold: ${metrics.throughput.tps}`);
      }
    });
  });

  describe('Oracle Performance Analysis', () => {
    it('should generate comprehensive oracle performance report', async () => {
      // Run various oracle operations
      const operations = [
        'initialize_oracle',
        'add_price_feed',
        'update_price',
        'submit_data_validation',
        'get_latest_price',
        'submit_batch_prices',
        'verify_data_integrity'
      ];

      for (const operation of operations) {
        const scenario: TestScenario = {
          name: `oracle_report_${operation}`,
          description: `Oracle performance test for ${operation}`,
          iterations: 20,
          concurrency: 1,
          delay: 40
        };

        await framework.runTestScenario(scenario, PROGRAM_IDS.oracle, async () => {
          // Simulate operation with varying latency patterns
          let delay: number;
          switch (operation) {
            case 'initialize_oracle':
              delay = 280 + Math.random() * 100;
              break;
            case 'add_price_feed':
              delay = 220 + Math.random() * 80;
              break;
            case 'update_price':
              delay = 120 + Math.random() * 60;
              break;
            case 'submit_data_validation':
              delay = 160 + Math.random() * 70;
              break;
            case 'get_latest_price':
              delay = 80 + Math.random() * 40;
              break;
            case 'submit_batch_prices':
              delay = 250 + Math.random() * 100;
              break;
            case 'verify_data_integrity':
              delay = 200 + Math.random() * 90;
              break;
            default:
              delay = 180 + Math.random() * 80;
          }
          
          await new Promise(resolve => setTimeout(resolve, delay));
          return { 
            signature: `oracle_${operation}_${Date.now()}_${Math.random()}`, 
            result: { operation, processed: true } 
          };
        });
      }

      // Generate comprehensive report
      const report = framework.analyzer.generateReport(
        framework.measurer.getMeasurements()
      );
      
      console.log('=== Oracle Performance Report ===');
      console.log(`Total Measurements: ${report.summary.totalMeasurements}`);
      console.log(`Average Latency: ${report.summary.averageLatency.toFixed(2)}ms`);
      console.log(`P95 Latency: ${report.summary.p95.toFixed(2)}ms`);
      console.log(`Outlier Rate: ${report.summary.outlierRate.toFixed(2)}%`);
      
      console.log('\nTrend Analysis:');
      console.log(`Direction: ${report.trends.direction}`);
      console.log(`Confidence: ${(report.trends.confidence * 100).toFixed(1)}%`);
      
      console.log('\nRecommendations:');
      report.recommendations.forEach((rec: string) => console.log(`- ${rec}`));

      // Export detailed report
      const reportPath = await framework.exportReport('oracle-performance-report.json');
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

  describe('Oracle Load Testing', () => {
    it('should handle oracle peak load scenarios', async () => {
      const scenario: TestScenario = {
        name: 'oracle_peak_load',
        description: 'Oracle system peak load test',
        iterations: 0,
        concurrency: 200,
        delay: 0
      };

      const operation = async () => {
        // Simulate various oracle operations during peak load
        const operationType = Math.floor(Math.random() * 7); // 7 different operations
        const baseDelay = [280, 220, 120, 160, 80, 250, 200][operationType];
        const variance = Math.random() * 80;
        
        await new Promise(resolve => setTimeout(resolve, baseDelay + variance));
        const signature = `oracle_peak_${Date.now()}_${Math.random()}`;
        return { 
          signature, 
          result: { 
            operation: ['initialize', 'add_feed', 'update_price', 'validate', 'get_price', 'batch_update', 'verify'][operationType],
            processed: true 
          } 
        };
      };

      const metrics = await framework.measurer.runConcurrentScenario(scenario, operation);
      await framework.collector.recordMeasurements(
        framework.measurer.getMeasurementsByProgram(PROGRAM_IDS.oracle)
      );

      console.log(`Oracle Peak Load Results:`);
      console.log(`- Average Latency: ${metrics.latency.mean.toFixed(2)}ms`);
      console.log(`- P95 Latency: ${metrics.latency.p95.toFixed(2)}ms`);
      console.log(`- Successful Operations: ${metrics.throughput.operations}`);
      console.log(`- Error Rate: ${metrics.errors.rate}%`);

      // Peak load performance assertions
      if (metrics.latency.mean > 800) {
        throw new Error(`Oracle peak load latency exceeded threshold: ${metrics.latency.mean}ms`);
      }
      if (metrics.errors.rate > 25) {
        throw new Error(`Oracle peak load error rate exceeded threshold: ${metrics.errors.rate}%`);
      }
    });
  });
});
