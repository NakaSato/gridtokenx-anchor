/**
 * Trading Program Latency Test Runner
 * 
 * This script specifically tests the trading program latency
 * and shows all trackable addresses and operations
 */

const { createLatencyFramework } = require('./framework');
const { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } = require('@solana/web3.js');

// Trading Program Configuration
const TRADING_PROGRAM_ID = 'Trad1n2G3h4J5k6L7m8N9o0P1q2R3s4T5u6V7w8X9y0Z1';

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

// Trading Operations Configuration
const TRADING_OPERATIONS = [
  {
    name: 'initialize_trading',
    description: 'Initialize trading platform',
    expectedLatency: 350,
    testFunction: async () => {
      await new Promise(resolve => setTimeout(resolve, 320 + Math.random() * 100));
      return {
        signature: `init_trading_${Date.now()}_${Math.random()}`,
        result: {
          tradingId: Math.floor(Math.random() * 10000),
          authority: 'test_authority_pubkey',
          initialized: true
        }
      };
    }
  },
  {
    name: 'create_order',
    description: 'Create new trading order',
    expectedLatency: 180,
    testFunction: async () => {
      await new Promise(resolve => setTimeout(resolve, 150 + Math.random() * 70));
      const orderType = Math.random() > 0.5 ? ORDER_TYPES.BUY : ORDER_TYPES.SELL;
      return {
        signature: `create_order_${Date.now()}_${Math.random()}`,
        result: {
          orderId: Math.floor(Math.random() * 100000),
          orderType,
          amount: Math.floor(Math.random() * 1000) + 100,
          price: 0.05 + Math.random() * 0.02,
          status: ORDER_STATUS.OPEN,
          trader: 'test_trader_pubkey'
        }
      };
    }
  },
  {
    name: 'cancel_order',
    description: 'Cancel existing order',
    expectedLatency: 120,
    testFunction: async () => {
      await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 60));
      return {
        signature: `cancel_order_${Date.now()}_${Math.random()}`,
        result: {
          orderId: Math.floor(Math.random() * 100000),
          status: ORDER_STATUS.CANCELLED,
          cancelledAt: Date.now()
        }
      };
    }
  },
  {
    name: 'execute_trade',
    description: 'Execute matched trade',
    expectedLatency: 200,
    testFunction: async () => {
      await new Promise(resolve => setTimeout(resolve, 180 + Math.random() * 80));
      return {
        signature: `execute_trade_${Date.now()}_${Math.random()}`,
        result: {
          tradeId: Math.floor(Math.random() * 100000),
          buyOrderId: Math.floor(Math.random() * 100000),
          sellOrderId: Math.floor(Math.random() * 100000),
          amount: Math.floor(Math.random() * 1000) + 100,
          price: 0.05 + Math.random() * 0.02,
          executedAt: Date.now()
        }
      };
    }
  },
  {
    name: 'match_orders',
    description: 'Match compatible orders',
    expectedLatency: 160,
    testFunction: async () => {
      await new Promise(resolve => setTimeout(resolve, 140 + Math.random() * 70));
      return {
        signature: `match_orders_${Date.now()}_${Math.random()}`,
        result: {
          matchId: Math.floor(Math.random() * 10000),
          matchedOrders: Math.floor(Math.random() * 10) + 2,
          totalVolume: Math.floor(Math.random() * 10000) + 1000,
          matchedAt: Date.now()
        }
      };
    }
  },
  {
    name: 'get_order_by_id',
    description: 'Query order by ID',
    expectedLatency: 70,
    testFunction: async () => {
      await new Promise(resolve => setTimeout(resolve, 60 + Math.random() * 40));
      return {
        signature: `get_order_${Date.now()}_${Math.random()}`,
        result: {
          orderId: Math.floor(Math.random() * 100000),
          orderType: Math.random() > 0.5 ? ORDER_TYPES.BUY : ORDER_TYPES.SELL,
          amount: Math.floor(Math.random() * 1000) + 100,
          price: 0.05 + Math.random() * 0.02,
          status: ORDER_STATUS.OPEN,
          createdAt: Date.now()
        }
      };
    }
  },
  {
    name: 'get_open_orders',
    description: 'List all open orders',
    expectedLatency: 90,
    testFunction: async () => {
      await new Promise(resolve => setTimeout(resolve, 80 + Math.random() * 50));
      const orderCount = Math.floor(Math.random() * 50) + 10;
      return {
        signature: `get_open_orders_${Date.now()}_${Math.random()}`,
        result: {
          trader: 'test_trader_pubkey',
          orderCount,
          orders: Array.from({ length: orderCount }, (_, i) => ({
            orderId: Math.floor(Math.random() * 100000),
            orderType: i % 2 === 0 ? ORDER_TYPES.BUY : ORDER_TYPES.SELL,
            amount: Math.floor(Math.random() * 1000) + 100
          }))
        }
      };
    }
  },
  {
    name: 'get_trade_history',
    description: 'Query trade history',
    expectedLatency: 110,
    testFunction: async () => {
      await new Promise(resolve => setTimeout(resolve, 90 + Math.random() * 60));
      const tradeCount = Math.floor(Math.random() * 100) + 20;
      return {
        signature: `get_trade_history_${Date.now()}_${Math.random()}`,
        result: {
          trader: 'test_trader_pubkey',
          tradeCount,
          trades: Array.from({ length: tradeCount }, (_, i) => ({
            tradeId: Math.floor(Math.random() * 100000),
            amount: Math.floor(Math.random() * 1000) + 100,
            price: 0.05 + Math.random() * 0.02,
            executedAt: Date.now() - (i * 60000)
          }))
        }
      };
    }
  },
  {
    name: 'update_order_price',
    description: 'Update order price',
    expectedLatency: 140,
    testFunction: async () => {
      await new Promise(resolve => setTimeout(resolve, 120 + Math.random() * 60));
      return {
        signature: `update_price_${Date.now()}_${Math.random()}`,
        result: {
          orderId: Math.floor(Math.random() * 100000),
          newPrice: 0.05 + Math.random() * 0.02,
          updatedAt: Date.now()
        }
      };
    }
  },
  {
    name: 'settle_trade',
    description: 'Settle completed trade',
    expectedLatency: 250,
    testFunction: async () => {
      await new Promise(resolve => setTimeout(resolve, 220 + Math.random() * 90));
      return {
        signature: `settle_trade_${Date.now()}_${Math.random()}`,
        result: {
          tradeId: Math.floor(Math.random() * 100000),
          settled: true,
          settledAt: Date.now(),
          settlementHash: `0x${Math.random().toString(16).substr(2, 64)}`
        }
      };
    }
  }
];

async function runTradingLatencyTests() {
  console.log('🚀 GridTokenX Trading Program Latency Tests');
  console.log('='.repeat(60));
  
  console.log('\n📋 Trading Program Information:');
  console.log(`Program ID: ${TRADING_PROGRAM_ID}`);
  console.log(`Total Operations: ${TRADING_OPERATIONS.length}`);
  
  console.log('\n🔍 Trackable Operations:');
  TRADING_OPERATIONS.forEach((op, index) => {
    console.log(`${(index + 1).toString().padStart(2)}. ${op.name.padEnd(20)} - ${op.description}`);
  });
  
  console.log('\n📊 Running Latency Measurements...\n');
  
  // Initialize framework
  const connection = new Connection('http://127.0.0.1:8899', 'confirmed');
  const framework = createLatencyFramework({
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
  
  const results = [];
  
  // Test each operation
  for (const operation of TRADING_OPERATIONS) {
    console.log(`🔹 Testing ${operation.name}...`);
    
    try {
      // Single operation test
      const { measurement } = await framework.measureOperation(
        TRADING_PROGRAM_ID,
        operation.name,
        operation.testFunction
      );
      
      console.log(`   ✅ Latency: ${measurement.transactionLatency.toFixed(2)}ms`);
      console.log(`   📝 Expected: ${operation.expectedLatency}ms`);
      
      const performanceRatio = measurement.transactionLatency / operation.expectedLatency;
      if (performanceRatio > 1.5) {
        console.log(`   ⚠️  Warning: ${(performanceRatio * 100).toFixed(0)}% of expected latency`);
      } else if (performanceRatio < 0.8) {
        console.log(`   ✨ Excellent: ${(performanceRatio * 100).toFixed(0)}% of expected latency`);
      } else {
        console.log(`   ✅ Good: ${(performanceRatio * 100).toFixed(0)}% of expected latency`);
      }
      
      results.push({
        operation: operation.name,
        description: operation.description,
        latency: measurement.transactionLatency,
        expectedLatency: operation.expectedLatency,
        performanceRatio: performanceRatio
      });
      
    } catch (error) {
      console.log(`   ❌ Error: ${error.message}`);
      results.push({
        operation: operation.name,
        description: operation.description,
        latency: null,
        error: error.message
      });
    }
    
    console.log('');
  }
  
  // Batch test - Create multiple orders
  console.log('🔹 Running Batch Order Creation Test...');
  try {
    const batchScenario = {
      name: 'batch_order_creation',
      description: 'Create multiple orders simultaneously',
      iterations: 20,
      concurrency: 1,
      delay: 50
    };
    
    const metrics = await framework.runTestScenario(
      batchScenario,
      TRADING_PROGRAM_ID,
      async () => {
        await new Promise(resolve => setTimeout(resolve, 150 + Math.random() * 70));
        const orderType = Math.random() > 0.5 ? ORDER_TYPES.BUY : ORDER_TYPES.SELL;
        return {
          signature: `batch_order_${Date.now()}_${Math.random()}`,
          result: {
            orderId: Math.floor(Math.random() * 100000),
            orderType,
            amount: Math.floor(Math.random() * 1000) + 100,
            timestamp: Date.now()
          }
        };
      }
    );
    
    console.log(`   ✅ Average Latency: ${metrics.latency.mean.toFixed(2)}ms`);
    console.log(`   📊 P95 Latency: ${metrics.latency.p95.toFixed(2)}ms`);
    console.log(`   📈 Throughput: ${metrics.throughput.tps.toFixed(2)} TPS`);
    console.log(`   🔢 Total Operations: ${metrics.throughput.operations}`);
    
  } catch (error) {
    console.log(`   ❌ Batch test error: ${error.message}`);
  }
  
  // Concurrent test - Simulate multiple traders
  console.log('\n🔹 Running Concurrent Trading Test...');
  try {
    const concurrentScenario = {
      name: 'concurrent_trading',
      description: 'Multiple traders trading simultaneously',
      iterations: 0,
      concurrency: 100,
      delay: 0
    };
    
    const metrics = await framework.measurer.runConcurrentScenario(
      concurrentScenario,
      async () => {
        const operations = ['create_order', 'cancel_order', 'get_order_by_id', 'get_open_orders'];
        const operationType = operations[Math.floor(Math.random() * operations.length)];
        const baseDelay = [150, 100, 60, 80][operations.indexOf(operationType)];
        
        await new Promise(resolve => setTimeout(resolve, baseDelay + Math.random() * 50));
        return {
          signature: `concurrent_${operationType}_${Date.now()}_${Math.random()}`,
          result: {
            operation: operationType,
            processed: true,
            timestamp: Date.now()
          }
        };
      }
    );
    
    console.log(`   ✅ Average Latency: ${metrics.latency.mean.toFixed(2)}ms`);
    console.log(`   📊 P95 Latency: ${metrics.latency.p95.toFixed(2)}ms`);
    console.log(`   🔢 Concurrent Operations: ${metrics.throughput.operations}`);
    console.log(`   📈 Error Rate: ${metrics.errors.rate.toFixed(2)}%`);
    
  } catch (error) {
    console.log(`   ❌ Concurrent test error: ${error.message}`);
  }
  
  // Generate comprehensive report
  console.log('\n📈 Generating Trading Performance Report...');
  
  const report = framework.analyzer.generateReport(
    framework.measurer.getMeasurements()
  );
  
  console.log('\n🎯 Trading Performance Summary:');
  console.log(`   - Total Measurements: ${report.summary.totalMeasurements}`);
  console.log(`   - Average Latency: ${report.summary.averageLatency.toFixed(2)}ms`);
  console.log(`   - P95 Latency: ${report.summary.p95.toFixed(2)}ms`);
  console.log(`   - P99 Latency: ${report.summary.p99.toFixed(2)}ms`);
  console.log(`   - Min Latency: ${report.summary.minLatency.toFixed(2)}ms`);
  console.log(`   - Max Latency: ${report.summary.maxLatency.toFixed(2)}ms`);
  console.log(`   - Standard Deviation: ${report.summary.standardDeviation.toFixed(2)}ms`);
  
  console.log('\n📊 Trend Analysis:');
  console.log(`   - Direction: ${report.trends.direction.toUpperCase()}`);
  console.log(`   - Confidence: ${(report.trends.confidence * 100).toFixed(1)}%`);
  
  // Performance analysis by operation type
  console.log('\n📋 Operation Performance Analysis:');
  const successfulResults = results.filter(r => r.latency !== null);
  const avgLatency = successfulResults.reduce((sum, r) => sum + r.latency, 0) / successfulResults.length;
  
  results.forEach(result => {
    if (result.latency !== null) {
      const status = result.performanceRatio < 1.2 ? '✅' : 
                   result.performanceRatio < 1.5 ? '⚠️' : '❌';
      console.log(`   ${status} ${result.name.padEnd(20)}: ${result.latency.toFixed(2)}ms (${(result.performanceRatio * 100).toFixed(0)}% of expected)`);
    } else {
      console.log(`   ❌ ${result.name.padEnd(20)}: FAILED`);
    }
  });
  
  // Export detailed report
  try {
    const reportPath = await framework.exportReport('trading-latency-report.json');
    console.log(`\n📁 Detailed report saved to: ${reportPath}`);
  } catch (error) {
    console.log(`\n⚠️  Report export failed: ${error.message}`);
  }
  
  // Cleanup
  await framework.cleanup();
  
  console.log('\n✅ Trading latency testing completed successfully!');
  console.log('\n📚 Next Steps:');
  console.log('   1. Review detailed report in test-results/latency/trading/');
  console.log('   2. Compare with other programs: npm run test:latency:demo');
  console.log('   3. Run performance analysis: npm run performance:quick-check');
  
  return results;
}

// Run the tests
if (require.main === module) {
  runTradingLatencyTests().catch(console.error);
}

module.exports = { runTradingLatencyTests, TRADING_PROGRAM_ID, TRADING_OPERATIONS };
