/**
 * Trading Program Latency Tests
 * 
 * This test suite measures latency for all critical operations
 * in Trading program for P2P energy trading
 */

import * as anchor from '@coral-xyz/anchor';
import { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createLatencyFramework, TestScenario } from '../framework';

// Mock constants for testing
const PROGRAM_IDS = {
  trading: 'Trad1n2G3h4J5k6L7m8N9o0P1q2R3s4T5u6V7w8X9y0Z1'
};

const ORDER_TYPES = {
  BUY: 'BUY',
  SELL: 'SELL'
};

const ORDER_STATUS = {
  OPEN: 'OPEN',
  FILLED: 'FILLED',
  CANCELLED: 'CANCELLED',
  PARTIALLY_FILLED: 'PARTIALLY_FILLED'
};

const TRADE_TYPES = {
  IMMEDIATE: 'IMMEDIATE',
  LIMIT: 'LIMIT',
  AUCTION: 'AUCTION'
};

describe('Trading Program Latency Tests', () => {
  let connection: Connection;
  let framework: any;
  let provider: anchor.AnchorProvider;
  let tradingProgram: any;
  
  // Test wallets
  let authority: Keypair;
  let buyer: Keypair;
  let seller: Keypair;
  let marketMaker: Keypair;

  before('Setup test environment', async () => {
    connection = new Connection('http://127.0.0.1:8899', 'confirmed');
    
    // Initialize latency framework
    framework = createLatencyFramework({
      connection,
      dataCollection: {
        outputDirectory: './test-results/latency/trading',
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
    buyer = Keypair.generate();
    seller = Keypair.generate();
    marketMaker = Keypair.generate();

    // Fund wallets
    await connection.requestAirdrop(authority.publicKey, 10 * LAMPORTS_PER_SOL);
    await connection.requestAirdrop(buyer.publicKey, 10 * LAMPORTS_PER_SOL);
    await connection.requestAirdrop(seller.publicKey, 10 * LAMPORTS_PER_SOL);
    await connection.requestAirdrop(marketMaker.publicKey, 10 * LAMPORTS_PER_SOL);

    provider = new anchor.AnchorProvider(
      connection,
      new anchor.Wallet(authority),
      { commitment: 'confirmed' }
    );

    // Mock trading program
    tradingProgram = {
      methods: {
        initializeTrading: () => ({ rpc: async () => 'mock_init_trading_signature' }),
        createOrder: () => ({ rpc: async () => 'mock_create_order_signature' }),
        cancelOrder: () => ({ rpc: async () => 'mock_cancel_order_signature' }),
        executeTrade: () => ({ rpc: async () => 'mock_execute_trade_signature' }),
        matchOrders: () => ({ rpc: async () => 'mock_match_orders_signature' }),
        getOrderById: () => ({ rpc: async () => 'mock_get_order_signature' }),
        getOpenOrders: () => ({ rpc: async () => 'mock_get_open_orders_signature' }),
        getTradeHistory: () => ({ rpc: async () => 'mock_get_trade_history_signature' }),
        updateOrderPrice: () => ({ rpc: async () => 'mock_update_price_signature' }),
        settleTrade: () => ({ rpc: async () => 'mock_settle_trade_signature' })
      }
    } as any;
  });

  after('Cleanup', async () => {
    await framework.cleanup();
  });

  describe('Trading Initialization Operations', () => {
    it('should measure initialize_trading latency', async () => {
      const testName = 'initialize_trading';
      
      const operation = async () => {
        // Simulate trading platform initialization
        await new Promise(resolve => setTimeout(resolve, 350));
        const signature = 'mock_initialize_trading_signature';
        return { 
          signature, 
          result: { 
            tradingId: Math.floor(Math.random() * 10000),
            authority: authority.publicKey.toString(),
            initialized: true
          } 
        };
      };

      const { measurement } = await framework.measureOperation(
        PROGRAM_IDS.trading,
        testName,
        operation
      );

      console.log(`Initialize Trading Latency: ${measurement.transactionLatency.toFixed(2)}ms`);
      console.log(`Compute Units: ${measurement.metadata.computeUnits}`);
      
      if (measurement.transactionLatency > 900) {
        throw new Error(`Trading initialization exceeded threshold: ${measurement.transactionLatency}ms`);
      }
    });

    it('should measure batch trading initialization', async () => {
      const scenario: TestScenario = {
        name: 'batch_trading_init',
        description: 'Batch trading initialization operations',
        iterations: 2,
        concurrency: 1,
        delay: 500
      };

      const operation = async () => {
        // Simulate batch trading initialization
        await new Promise(resolve => setTimeout(resolve, 400));
        const signature = `mock_batch_init_${Date.now()}`;
        return { 
          signature, 
          result: { 
            tradingId: Math.floor(Math.random() * 10000),
            marketId: Math.floor(Math.random() * 100)
          } 
        };
      };

      const metrics = await framework.runTestScenario(
        scenario,
        PROGRAM_IDS.trading,
        operation
      );

      console.log(`Batch Trading Init Results:`);
      console.log(`- Average Latency: ${metrics.latency.mean.toFixed(2)}ms`);
      console.log(`- P95 Latency: ${metrics.latency.p95.toFixed(2)}ms`);
      console.log(`- TPS: ${metrics.throughput.tps.toFixed(2)}`);

      if (metrics.latency.mean > 600) {
        throw new Error(`Batch trading init exceeded threshold: ${metrics.latency.mean}ms`);
      }
    });
  });

  describe('Order Creation Operations', () => {
    it('should measure create_order latency', async () => {
      const testName = 'create_order';
      
      const operation = async () => {
        // Simulate order creation
        await new Promise(resolve => setTimeout(resolve, 180));
        const signature = 'mock_create_order_signature';
        return { 
          signature, 
          result: { 
            orderId: Math.floor(Math.random() * 100000),
            orderType: ORDER_TYPES.BUY,
            amount: Math.floor(Math.random() * 1000) + 100,
            price: 0.05 + Math.random() * 0.02,
            status: ORDER_STATUS.OPEN,
            trader: buyer.publicKey.toString()
          } 
        };
      };

      const { measurement } = await framework.measureOperation(
        PROGRAM_IDS.trading,
        testName,
        operation
      );

      console.log(`Create Order Latency: ${measurement.transactionLatency.toFixed(2)}ms`);
      
      if (measurement.transactionLatency > 400) {
        throw new Error(`Order creation exceeded threshold: ${measurement.transactionLatency}ms`);
      }
    });

    it('should measure high-frequency order creation', async () => {
      const scenario: TestScenario = {
        name: 'high_frequency_order_creation',
        description: 'High frequency order creation operations',
        iterations: 100,
        concurrency: 1,
        delay: 50
      };

      const operation = async () => {
        // Simulate high-frequency order creation
        await new Promise(resolve => setTimeout(resolve, 150 + Math.random() * 70));
        const orderTypes = [ORDER_TYPES.BUY, ORDER_TYPES.SELL];
        const orderType = orderTypes[Math.floor(Math.random() * orderTypes.length)];
        const signature = `mock_hf_order_${Date.now()}_${Math.random()}`;
        return { 
          signature, 
          result: { 
            orderId: Math.floor(Math.random() * 100000),
            orderType,
            amount: Math.floor(Math.random() * 1000) + 100,
            timestamp: Date.now()
          } 
        };
      };

      const metrics = await framework.runTestScenario(
        scenario,
        PROGRAM_IDS.trading,
        operation
      );

      console.log(`High Frequency Order Creation Results:`);
      console.log(`- Average Latency: ${metrics.latency.mean.toFixed(2)}ms`);
      console.log(`- P95 Latency: ${metrics.latency.p95.toFixed(2)}ms`);
      console.log(`- Throughput: ${metrics.throughput.tps.toFixed(2)} TPS`);

      if (metrics.latency.mean > 250) {
        throw new Error(`HF order creation exceeded threshold: ${metrics.latency.mean}ms`);
      }
      if (metrics.throughput.tps < 15) {
        throw new Error(`HF order creation TPS below threshold: ${metrics.throughput.tps}`);
      }
    });

    it('should measure concurrent order creation', async () => {
      const scenario: TestScenario = {
        name: 'concurrent_order_creation',
        description: 'Concurrent order creation operations',
        iterations: 0,
        concurrency: 200,
        delay: 0
      };

      const operation = async () => {
        // Simulate concurrent order creation
        await new Promise(resolve => setTimeout(resolve, 120 + Math.random() * 80));
        const orderTypes = [ORDER_TYPES.BUY, ORDER_TYPES.SELL];
        const orderType = orderTypes[Math.floor(Math.random() * orderTypes.length)];
        const signature = `mock_concurrent_order_${Date.now()}_${Math.random()}`;
        return { 
          signature, 
          result: { 
            orderId: Math.floor(Math.random() * 100000),
            orderType,
            trader: Math.random() > 0.5 ? buyer.publicKey.toString() : seller.publicKey.toString(),
            timestamp: Date.now()
          } 
        };
      };

      const metrics = await framework.measurer.runConcurrentScenario(scenario, operation);
      await framework.collector.recordMeasurements(
        framework.measurer.getMeasurementsByProgram(PROGRAM_IDS.trading)
      );

      console.log(`Concurrent Order Creation Results:`);
      console.log(`- Average Latency: ${metrics.latency.mean.toFixed(2)}ms`);
      console.log(`- P95 Latency: ${metrics.latency.p95.toFixed(2)}ms`);
      console.log(`- Successful Operations: ${metrics.throughput.operations}`);
      console.log(`- Error Rate: ${metrics.errors.rate}%`);

      if (metrics.latency.mean > 220) {
        throw new Error(`Concurrent order creation exceeded threshold: ${metrics.latency.mean}ms`);
      }
      if (metrics.errors.rate > 15) {
        throw new Error(`Concurrent order creation error rate exceeded threshold: ${metrics.errors.rate}%`);
      }
    });
  });

  describe('Order Management Operations', () => {
    it('should measure cancel_order latency', async () => {
      const testName = 'cancel_order';
      
      const operation = async () => {
        // Simulate order cancellation
        await new Promise(resolve => setTimeout(resolve, 120));
        const signature = 'mock_cancel_order_signature';
        return { 
          signature, 
          result: { 
            orderId: Math.floor(Math.random() * 100000),
            status: ORDER_STATUS.CANCELLED,
            cancelledAt: Date.now()
          } 
        };
      };

      const { measurement } = await framework.measureOperation(
        PROGRAM_IDS.trading,
        testName,
        operation
      );

      console.log(`Cancel Order Latency: ${measurement.transactionLatency.toFixed(2)}ms`);
      
      if (measurement.transactionLatency > 250) {
        throw new Error(`Order cancellation exceeded threshold: ${measurement.transactionLatency}ms`);
      }
    });

    it('should measure update_order_price latency', async () => {
      const testName = 'update_order_price';
      
      const operation = async () => {
        // Simulate order price update
        await new Promise(resolve => setTimeout(resolve, 140));
        const signature = 'mock_update_price_signature';
        return { 
          signature, 
          result: { 
            orderId: Math.floor(Math.random() * 100000),
            newPrice: 0.05 + Math.random() * 0.02,
            updatedAt: Date.now()
          } 
        };
      };

      const { measurement } = await framework.measureOperation(
        PROGRAM_IDS.trading,
        testName,
        operation
      );

      console.log(`Update Order Price Latency: ${measurement.transactionLatency.toFixed(2)}ms`);
      
      if (measurement.transactionLatency > 280) {
        throw new Error(`Order price update exceeded threshold: ${measurement.transactionLatency}ms`);
      }
    });

    it('should measure concurrent order management', async () => {
      const scenario: TestScenario = {
        name: 'concurrent_order_management',
        description: 'Concurrent order management operations',
        iterations: 0,
        concurrency: 150,
        delay: 0
      };

      const operation = async () => {
        // Simulate concurrent order management
        await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 60));
        const operations = ['cancel', 'update_price', 'modify'];
        const operationType = operations[Math.floor(Math.random() * operations.length)];
        const signature = `mock_concurrent_mgmt_${Date.now()}_${Math.random()}`;
        return { 
          signature, 
          result: { 
            orderId: Math.floor(Math.random() * 100000),
            operation: operationType,
            processed: true
          } 
        };
      };

      const metrics = await framework.measurer.runConcurrentScenario(scenario, operation);
      await framework.collector.recordMeasurements(
        framework.measurer.getMeasurementsByProgram(PROGRAM_IDS.trading)
      );

      console.log(`Concurrent Order Management Results:`);
      console.log(`- Average Latency: ${metrics.latency.mean.toFixed(2)}ms`);
      console.log(`- P95 Latency: ${metrics.latency.p95.toFixed(2)}ms`);
      console.log(`- Successful Operations: ${metrics.throughput.operations}`);
      console.log(`- Error Rate: ${metrics.errors.rate}%`);

      if (metrics.latency.mean > 200) {
        throw new Error(`Concurrent order management exceeded threshold: ${metrics.latency.mean}ms`);
      }
      if (metrics.errors.rate > 12) {
        throw new Error(`Concurrent order management error rate exceeded threshold: ${metrics.errors.rate}%`);
      }
    });
  });

  describe('Trade Execution Operations', () => {
    it('should measure execute_trade latency', async () => {
      const testName = 'execute_trade';
      
      const operation = async () => {
        // Simulate trade execution
        await new Promise(resolve => setTimeout(resolve, 200));
        const signature = 'mock_execute_trade_signature';
        return { 
          signature, 
          result: { 
            tradeId: Math.floor(Math.random() * 100000),
            buyOrderId: Math.floor(Math.random() * 100000),
            sellOrderId: Math.floor(Math.random() * 100000),
            amount: Math.floor(Math.random() * 1000) + 100,
            price: 0.05 + Math.random() * 0.02,
            executedAt: Date.now()
          } 
        };
      };

      const { measurement } = await framework.measureOperation(
        PROGRAM_IDS.trading,
        testName,
        operation
      );

      console.log(`Execute Trade Latency: ${measurement.transactionLatency.toFixed(2)}ms`);
      
      if (measurement.transactionLatency > 400) {
        throw new Error(`Trade execution exceeded threshold: ${measurement.transactionLatency}ms`);
      }
    });

    it('should measure match_orders latency', async () => {
      const testName = 'match_orders';
      
      const operation = async () => {
        // Simulate order matching
        await new Promise(resolve => setTimeout(resolve, 160));
        const signature = 'mock_match_orders_signature';
        return { 
          signature, 
          result: { 
            matchId: Math.floor(Math.random() * 10000),
            matchedOrders: Math.floor(Math.random() * 10) + 2,
            totalVolume: Math.floor(Math.random() * 10000) + 1000,
            matchedAt: Date.now()
          } 
        };
      };

      const { measurement } = await framework.measureOperation(
        PROGRAM_IDS.trading,
        testName,
        operation
      );

      console.log(`Match Orders Latency: ${measurement.transactionLatency.toFixed(2)}ms`);
      
      if (measurement.transactionLatency > 350) {
        throw new Error(`Order matching exceeded threshold: ${measurement.transactionLatency}ms`);
      }
    });

    it('should measure settle_trade latency', async () => {
      const testName = 'settle_trade';
      
      const operation = async () => {
        // Simulate trade settlement
        await new Promise(resolve => setTimeout(resolve, 250));
        const signature = 'mock_settle_trade_signature';
        return { 
          signature, 
          result: { 
            tradeId: Math.floor(Math.random() * 100000),
            settled: true,
            settledAt: Date.now(),
            settlementHash: `0x${Math.random().toString(16).substr(2, 64)}`
          } 
        };
      };

      const { measurement } = await framework.measureOperation(
        PROGRAM_IDS.trading,
        testName,
        operation
      );

      console.log(`Settle Trade Latency: ${measurement.transactionLatency.toFixed(2)}ms`);
      
      if (measurement.transactionLatency > 500) {
        throw new Error(`Trade settlement exceeded threshold: ${measurement.transactionLatency}ms`);
      }
    });

    it('should measure high-frequency trade execution', async () => {
      const scenario: TestScenario = {
        name: 'high_frequency_trades',
        description: 'High frequency trade execution operations',
        iterations: 80,
        concurrency: 1,
        delay: 80
      };

      const operation = async () => {
        // Simulate high-frequency trade execution
        await new Promise(resolve => setTimeout(resolve, 180 + Math.random() * 90));
        const signature = `mock_hf_trade_${Date.now()}_${Math.random()}`;
        return { 
          signature, 
          result: { 
            tradeId: Math.floor(Math.random() * 100000),
            amount: Math.floor(Math.random() * 500) + 50,
            timestamp: Date.now()
          } 
        };
      };

      const metrics = await framework.runTestScenario(
        scenario,
        PROGRAM_IDS.trading,
        operation
      );

      console.log(`High Frequency Trade Execution Results:`);
      console.log(`- Average Latency: ${metrics.latency.mean.toFixed(2)}ms`);
      console.log(`- P95 Latency: ${metrics.latency.p95.toFixed(2)}ms`);
      console.log(`- Throughput: ${metrics.throughput.tps.toFixed(2)} TPS`);

      if (metrics.latency.mean > 300) {
        throw new Error(`HF trade execution exceeded threshold: ${metrics.latency.mean}ms`);
      }
      if (metrics.throughput.tps < 8) {
        throw new Error(`HF trade execution TPS below threshold: ${metrics.throughput.tps}`);
      }
    });
  });

  describe('Order Query Operations', () => {
    it('should measure get_order_by_id latency', async () => {
      const testName = 'get_order_by_id';
      
      const operation = async () => {
        // Simulate order query by ID
        await new Promise(resolve => setTimeout(resolve, 70));
        const signature = 'mock_get_order_signature';
        return { 
          signature, 
          result: { 
            orderId: Math.floor(Math.random() * 100000),
            orderType: ORDER_TYPES.BUY,
            amount: Math.floor(Math.random() * 1000) + 100,
            price: 0.05 + Math.random() * 0.02,
            status: ORDER_STATUS.OPEN,
            createdAt: Date.now()
          } 
        };
      };

      const { measurement } = await framework.measureOperation(
        PROGRAM_IDS.trading,
        testName,
        operation
      );

      console.log(`Get Order by ID Latency: ${measurement.transactionLatency.toFixed(2)}ms`);
      
      if (measurement.transactionLatency > 150) {
        throw new Error(`Get order by ID exceeded threshold: ${measurement.transactionLatency}ms`);
      }
    });

    it('should measure get_open_orders latency', async () => {
      const testName = 'get_open_orders';
      
      const operation = async () => {
        // Simulate getting open orders
        await new Promise(resolve => setTimeout(resolve, 90));
        const signature = 'mock_get_open_orders_signature';
        const orderCount = Math.floor(Math.random() * 50) + 10;
        return { 
          signature, 
          result: { 
            trader: buyer.publicKey.toString(),
            orderCount,
            orders: Array.from({ length: orderCount }, (_, i) => ({
              orderId: Math.floor(Math.random() * 100000),
              orderType: i % 2 === 0 ? ORDER_TYPES.BUY : ORDER_TYPES.SELL,
              amount: Math.floor(Math.random() * 1000) + 100
            }))
          } 
        };
      };

      const { measurement } = await framework.measureOperation(
        PROGRAM_IDS.trading,
        testName,
        operation
      );

      console.log(`Get Open Orders Latency: ${measurement.transactionLatency.toFixed(2)}ms`);
      
      if (measurement.transactionLatency > 180) {
        throw new Error(`Get open orders exceeded threshold: ${measurement.transactionLatency}ms`);
      }
    });

    it('should measure get_trade_history latency', async () => {
      const testName = 'get_trade_history';
      
      const operation = async () => {
        // Simulate getting trade history
        await new Promise(resolve => setTimeout(resolve, 110));
        const signature = 'mock_get_trade_history_signature';
        const tradeCount = Math.floor(Math.random() * 100) + 20;
        return { 
          signature, 
          result: { 
            trader: buyer.publicKey.toString(),
            tradeCount,
            trades: Array.from({ length: tradeCount }, (_, i) => ({
              tradeId: Math.floor(Math.random() * 100000),
              amount: Math.floor(Math.random() * 1000) + 100,
              price: 0.05 + Math.random() * 0.02,
              executedAt: Date.now() - (i * 60000) // i minutes ago
            }))
          } 
        };
      };

      const { measurement } = await framework.measureOperation(
        PROGRAM_IDS.trading,
        testName,
        operation
      );

      console.log(`Get Trade History Latency: ${measurement.transactionLatency.toFixed(2)}ms`);
      
      if (measurement.transactionLatency > 200) {
        throw new Error(`Get trade history exceeded threshold: ${measurement.transactionLatency}ms`);
      }
    });

    it('should measure high-frequency order queries', async () => {
      const scenario: TestScenario = {
        name: 'high_frequency_order_queries',
        description: 'High frequency order query operations',
        iterations: 200,
        concurrency: 1,
        delay: 25
      };

      const operation = async () => {
        // Simulate high-frequency order queries
        await new Promise(resolve => setTimeout(resolve, 40 + Math.random() * 30));
        const queryTypes = ['single_order', 'open_orders', 'trade_history'];
        const queryType = queryTypes[Math.floor(Math.random() * queryTypes.length)];
        const signature = `mock_hf_query_${Date.now()}_${Math.random()}`;
        return { 
          signature, 
          result: { 
            queryType,
            timestamp: Date.now()
          } 
        };
      };

      const metrics = await framework.runTestScenario(
        scenario,
        PROGRAM_IDS.trading,
        operation
      );

      console.log(`High Frequency Order Query Results:`);
      console.log(`- Average Latency: ${metrics.latency.mean.toFixed(2)}ms`);
      console.log(`- P95 Latency: ${metrics.latency.p95.toFixed(2)}ms`);
      console.log(`- Throughput: ${metrics.throughput.tps.toFixed(2)} TPS`);

      if (metrics.latency.mean > 80) {
        throw new Error(`HF order query exceeded threshold: ${metrics.latency.mean}ms`);
      }
      if (metrics.throughput.tps < 25) {
        throw new Error(`HF order query TPS below threshold: ${metrics.throughput.tps}`);
      }
    });
  });

  describe('Trading Performance Analysis', () => {
    it('should generate comprehensive trading performance report', async () => {
      // Run various trading operations
      const operations = [
        'initialize_trading',
        'create_order',
        'cancel_order',
        'execute_trade',
        'match_orders',
        'get_order_by_id',
        'get_open_orders',
        'settle_trade',
        'update_order_price'
      ];

      for (const operation of operations) {
        const scenario: TestScenario = {
          name: `trading_report_${operation}`,
          description: `Trading performance test for ${operation}`,
          iterations: 30,
          concurrency: 1,
          delay: 40
        };

        await framework.runTestScenario(scenario, PROGRAM_IDS.trading, async () => {
          // Simulate operation with varying latency patterns
          let delay: number;
          switch (operation) {
            case 'initialize_trading':
              delay = 350 + Math.random() * 100;
              break;
            case 'create_order':
              delay = 180 + Math.random() * 70;
              break;
            case 'cancel_order':
              delay = 120 + Math.random() * 60;
              break;
            case 'execute_trade':
              delay = 200 + Math.random() * 80;
              break;
            case 'match_orders':
              delay = 160 + Math.random() * 70;
              break;
            case 'get_order_by_id':
              delay = 70 + Math.random() * 40;
              break;
            case 'get_open_orders':
              delay = 90 + Math.random() * 50;
              break;
            case 'settle_trade':
              delay = 250 + Math.random() * 90;
              break;
            case 'update_order_price':
              delay = 140 + Math.random() * 60;
              break;
            default:
              delay = 180 + Math.random() * 80;
          }
          
          await new Promise(resolve => setTimeout(resolve, delay));
          return { 
            signature: `trading_${operation}_${Date.now()}_${Math.random()}`, 
            result: { operation, processed: true } 
          };
        });
      }

      // Generate comprehensive report
      const report = framework.analyzer.generateReport(
        framework.measurer.getMeasurements()
      );
      
      console.log('=== Trading Performance Report ===');
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
      const reportPath = await framework.exportReport('trading-performance-report.json');
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

  describe('Trading Load Testing', () => {
    it('should handle trading peak load scenarios', async () => {
      const scenario: TestScenario = {
        name: 'trading_peak_load',
        description: 'Trading system peak load test',
        iterations: 0,
        concurrency: 250,
        delay: 0
      };

      const operation = async () => {
        // Simulate various trading operations during peak load
        const operationType = Math.floor(Math.random() * 9); // 9 different operations
        const baseDelay = [350, 180, 120, 200, 160, 70, 90, 250, 140][operationType];
        const variance = Math.random() * 100;
        
        await new Promise(resolve => setTimeout(resolve, baseDelay + variance));
        const signature = `trading_peak_${Date.now()}_${Math.random()}`;
        return { 
          signature, 
          result: { 
            operation: ['initialize', 'create_order', 'cancel_order', 'execute_trade', 'match_orders', 'get_order', 'get_open', 'settle', 'update_price'][operationType],
            processed: true 
          } 
        };
      };

      const metrics = await framework.measurer.runConcurrentScenario(scenario, operation);
      await framework.collector.recordMeasurements(
        framework.measurer.getMeasurementsByProgram(PROGRAM_IDS.trading)
      );

      console.log(`Trading Peak Load Results:`);
      console.log(`- Average Latency: ${metrics.latency.mean.toFixed(2)}ms`);
      console.log(`- P95 Latency: ${metrics.latency.p95.toFixed(2)}ms`);
      console.log(`- Successful Operations: ${metrics.throughput.operations}`);
      console.log(`- Error Rate: ${metrics.errors.rate}%`);

      // Peak load performance assertions
      if (metrics.latency.mean > 1000) {
        throw new Error(`Trading peak load latency exceeded threshold: ${metrics.latency.mean}ms`);
      }
      if (metrics.errors.rate > 30) {
        throw new Error(`Trading peak load error rate exceeded threshold: ${metrics.errors.rate}%`);
      }
    });
  });
});
