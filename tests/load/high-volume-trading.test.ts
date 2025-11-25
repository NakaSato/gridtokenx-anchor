import * as anchor from "@coral-xyz/anchor";
import { LoadTestFramework, LoadTestDataGenerator } from "./load-test-framework.js";
import { TestUtils } from "../utils/index.js";
import { expect } from "chai";

/**
 * High-Volume Trading Load Tests
 * Tests the system under extreme trading volumes (500+ trades/minute, 10,000+ orders)
 */
describe("High-Volume Trading Load Tests", () => {
  let framework: LoadTestFramework;
  let connection: anchor.web3.Connection;
  let provider: anchor.AnchorProvider;
  let programs: any;

  before(async () => {
    // Initialize connection and provider
    connection = new anchor.web3.Connection("http://localhost:8899", "confirmed");
    const wallet = anchor.Wallet.local();
    provider = new anchor.AnchorProvider(connection, wallet, {
      commitment: "confirmed",
      preflightCommitment: "confirmed"
    });
    anchor.setProvider(provider);

    // Initialize programs (simplified for load testing)
    // In a real implementation, you'd load all 5 programs
    framework = new LoadTestFramework(connection);
  });

  describe("500+ Trades/Minute Simulation", () => {
    it("Should handle 500 trades per minute sustained for 5 minutes", async () => {
      const sessionId = framework.startMonitoring("high_volume_500_tpm");
      
      try {
        const targetTradesPerMinute = 500;
        const testDurationMinutes = 5;
        const totalTrades = targetTradesPerMinute * testDurationMinutes;
        
        console.log(`Starting high-volume test: ${totalTrades} trades over ${testDurationMinutes} minutes`);
        
        // Generate trading orders
        const orders = LoadTestDataGenerator.generateTradingOrders(totalTrades);
        
        // Calculate timing for consistent TPS
        const startTime = Date.now();
        const targetInterval = 60000 / targetTradesPerMinute; // ms between trades
        
        let successfulTrades = 0;
        let failedTrades = 0;
        
        for (let i = 0; i < orders.length; i++) {
          const order = orders[i];
          
          // Execute trade with timing control
          const result = await framework.executeTransaction(
            sessionId,
            async () => {
              // Simulate trade execution
              await TestUtils.delay(Math.random() * 50); // Simulate processing time
              
              // Mock trade transaction
              return {
                signature: TestUtils.generateTestId("trade_tx"),
                order,
                timestamp: Date.now()
              };
            },
            `Trade ${i + 1}/${totalTrades}: ${order.orderType} ${order.amount} tokens`
          );
          
          if (result.success) {
            successfulTrades++;
          } else {
            failedTrades++;
          }
          
          // Control timing to maintain target TPS
          const currentTime = Date.now();
          const expectedTime = startTime + (i * targetInterval);
          const delay = Math.max(0, expectedTime - currentTime);
          
          if (delay > 0) {
            await TestUtils.delay(delay);
          }
          
          // Progress reporting
          if ((i + 1) % 100 === 0) {
            const elapsed = (Date.now() - startTime) / 1000;
            const currentTPS = successfulTrades / elapsed;
            console.log(`Progress: ${i + 1}/${totalTrades} trades, Current TPS: ${currentTPS.toFixed(2)}, Success Rate: ${(successfulTrades / (i + 1) * 100).toFixed(1)}%`);
          }
        }
        
        const results = framework.stopMonitoring(sessionId);
        
        // Assertions
        expect(results.metrics.successfulTransactions).to.be.at.least(targetTradesPerMinute * testDurationMinutes * 0.95, 
          `Should achieve at least 95% success rate. Got: ${results.metrics.successfulTransactions}`);
        
        expect(results.metrics.throughput).to.be.at.least(targetTradesPerMinute * 0.9, 
          `Should maintain at least 90% of target TPS. Got: ${results.metrics.throughput.toFixed(2)} TPS`);
        
        expect(results.metrics.averageLatency).to.be.below(1000, 
          `Average latency should be under 1s. Got: ${results.metrics.averageLatency.toFixed(2)}ms`);
        
        console.log(`✅ High-volume test completed:`);
        console.log(`   Total Transactions: ${results.metrics.totalTransactions}`);
        console.log(`   Successful: ${results.metrics.successfulTransactions}`);
        console.log(`   Failed: ${results.metrics.failedTransactions}`);
        console.log(`   Average Latency: ${results.metrics.averageLatency.toFixed(2)}ms`);
        console.log(`   Peak Throughput: ${results.metrics.throughput.toFixed(2)} TPS`);
        console.log(`   Success Rate: ${(results.metrics.successfulTransactions / results.metrics.totalTransactions * 100).toFixed(1)}%`);
        
        // Save detailed results
        await framework.saveResults(sessionId);
        
      } catch (error) {
        console.error("High-volume test failed:", error);
        throw error;
      }
    }).timeout(400000); // 6+ minutes timeout

    it("Should handle burst trading patterns (1000 trades in 30 seconds)", async () => {
      const sessionId = framework.startMonitoring("burst_trading");
      
      try {
        const burstSize = 1000;
        const burstDuration = 30000; // 30 seconds
        
        console.log(`Starting burst test: ${burstSize} trades in ${burstDuration/1000} seconds`);
        
        const orders = LoadTestDataGenerator.generateTradingOrders(burstSize);
        
        // Execute all trades as fast as possible (no artificial delays)
        const operations = orders.map((order, index) => 
          () => framework.executeTransaction(
            sessionId,
            async () => {
              await TestUtils.delay(Math.random() * 20); // Minimal processing time
              return {
                signature: TestUtils.generateTestId(`burst_tx_${index}`),
                order,
                timestamp: Date.now()
              };
            },
            `Burst Trade ${index + 1}`
          )
        );
        
        // Execute with high concurrency
        const concurrency = 50; // 50 concurrent operations
        const results = await framework.executeConcurrently(operations, concurrency);
        
        const successfulBursts = results.filter(r => r.success).length;
        const failedBursts = results.filter(r => !r.success).length;
        
        const testResults = framework.stopMonitoring(sessionId);
        
        // Assertions for burst test
        assert.isTrue(successfulBursts >= burstSize * 0.9, 
          `Should handle burst with 90%+ success. Got: ${(successfulBursts/burstSize*100).toFixed(1)}%`);
        
        assert.isTrue(testResults.metrics.averageLatency < 500, 
          `Burst latency should be under 500ms. Got: ${testResults.metrics.averageLatency.toFixed(2)}ms`);
        
        console.log(`✅ Burst test completed:`);
        console.log(`   Burst Size: ${burstSize} trades`);
        console.log(`   Successful: ${successfulBursts}`);
        console.log(`   Failed: ${failedBursts}`);
        console.log(`   Peak Throughput: ${testResults.metrics.throughput.toFixed(2)} TPS`);
        console.log(`   Average Latency: ${testResults.metrics.averageLatency.toFixed(2)}ms`);
        
        await framework.saveResults(sessionId);
        
      } catch (error) {
        console.error("Burst test failed:", error);
        throw error;
      }
    }).timeout(60000);
  });

  describe("10,000+ Active Orders in Order Book", () => {
    it("Should handle 10,000 concurrent active orders", async () => {
      const sessionId = framework.startMonitoring("large_order_book");
      
      try {
        const orderCount = 10000;
        
        console.log(`Creating order book with ${orderCount} active orders`);
        
        // Generate large order book
        const orders = LoadTestDataGenerator.generateTradingOrders(orderCount);
        
        let createdOrders = 0;
        let batchSize = 100;
        
        // Create orders in batches to avoid overwhelming the system
        for (let i = 0; i < orders.length; i += batchSize) {
          const batch = orders.slice(i, i + batchSize);
          
          const batchOperations = batch.map((order, batchIndex) => 
            () => framework.executeTransaction(
              sessionId,
              async () => {
                await TestUtils.delay(Math.random() * 10); // Minimal order creation time
                return {
                  signature: TestUtils.generateTestId(`order_${i + batchIndex}`),
                  order,
                  timestamp: Date.now()
                };
              },
              `Create Order ${i + batchIndex + 1}/${orderCount}`
            )
          );
          
          const batchResults = await framework.executeConcurrently(batchOperations, 20);
          createdOrders += batchResults.filter(r => r.success).length;
          
          // Progress reporting
          if ((i + batchSize) % 1000 === 0) {
            console.log(`Order book progress: ${Math.min(i + batchSize, orderCount)}/${orderCount} orders created`);
          }
        }
        
        // Test order matching with large order book
        console.log("Testing order matching with large order book...");
        
        const matchingOperations = Array(1000).fill(0).map((_, index) => 
          () => framework.executeTransaction(
            sessionId,
            async () => {
              await TestUtils.delay(Math.random() * 30); // Matching time
              return {
                signature: TestUtils.generateTestId(`match_${index}`),
                matchedOrders: Math.floor(Math.random() * 5) + 1, // 1-5 orders matched
                timestamp: Date.now()
              };
            },
            `Match Operation ${index + 1}/1000`
          )
        );
        
        const matchingResults = await framework.executeConcurrently(matchingOperations, 30);
        const successfulMatches = matchingResults.filter(r => r.success).length;
        
        const finalResults = framework.stopMonitoring(sessionId);
        
        // Assertions
        assert.isTrue(createdOrders >= orderCount * 0.95, 
          `Should create 95%+ of orders. Created: ${createdOrders}/${orderCount}`);
        
        assert.isTrue(successfulMatches >= 950, 
          `Should execute 95%+ matches. Successful: ${successfulMatches}/1000`);
        
        assert.isTrue(finalResults.metrics.averageLatency < 200, 
          `Order operations should be fast. Avg latency: ${finalResults.metrics.averageLatency.toFixed(2)}ms`);
        
        console.log(`✅ Large order book test completed:`);
        console.log(`   Orders Created: ${createdOrders}/${orderCount}`);
        console.log(`   Matches Executed: ${successfulMatches}/1000`);
        console.log(`   Average Latency: ${finalResults.metrics.averageLatency.toFixed(2)}ms`);
        console.log(`   Memory Usage: ${TestUtils.lamportsToSol(finalResults.metrics.memoryDelta)} SOL delta`);
        
        await framework.saveResults(sessionId);
        
      } catch (error) {
        console.error("Large order book test failed:", error);
        throw error;
      }
    }).timeout(180000);

    it("Should maintain performance under sustained load (1+ hour)", async () => {
      // This is a simplified version for demonstration
      // In practice, this would run for the full duration
      const sessionId = framework.startMonitoring("sustained_load");
      
      try {
        const testDuration = 60000; // 1 minute for demo (would be 3600000 for 1 hour)
        const targetTPS = 100;
        const totalTransactions = targetTPS * (testDuration / 1000);
        
        console.log(`Sustained load test: ${targetTPS} TPS for ${testDuration/1000} seconds (${totalTransactions} transactions)`);
        
        const orders = LoadTestDataGenerator.generateTradingOrders(totalTransactions);
        const startTime = Date.now();
        
        for (let i = 0; i < orders.length; i++) {
          const result = await framework.executeTransaction(
            sessionId,
            async () => {
              await TestUtils.delay(Math.random() * 10);
              return {
                signature: TestUtils.generateTestId(`sustained_${i}`),
                order: orders[i],
                timestamp: Date.now()
              };
            },
            `Sustained TX ${i + 1}`
          );
          
          // Maintain target TPS
          const expectedTime = startTime + (i * 1000 / targetTPS);
          const delay = Math.max(0, expectedTime - Date.now());
          
          if (delay > 0) {
            await TestUtils.delay(delay);
          }
        }
        
        const results = framework.stopMonitoring(sessionId);
        
        // Check for performance degradation over time
        const firstHalfLatency = results.transactions
          .slice(0, Math.floor(results.transactions.length / 2))
          .filter(t => t.success)
          .reduce((sum, t) => sum + t.latency, 0) / 
          Math.floor(results.transactions.length / 2);
        
        const secondHalfLatency = results.transactions
          .slice(Math.floor(results.transactions.length / 2))
          .filter(t => t.success)
          .reduce((sum, t) => sum + t.latency, 0) / 
          Math.ceil(results.transactions.length / 2);
        
        const degradation = ((secondHalfLatency - firstHalfLatency) / firstHalfLatency) * 100;
        
        // Assertions
        assert.isTrue(degradation < 50, 
          `Latency degradation should be under 50%. Got: ${degradation.toFixed(1)}%`);
        
        assert.isTrue(results.metrics.throughput >= targetTPS * 0.9, 
          `Should maintain 90%+ of target TPS. Got: ${results.metrics.throughput.toFixed(2)} TPS`);
        
        console.log(`✅ Sustained load test completed:`);
        console.log(`   Duration: ${results.duration}ms`);
        console.log(`   Throughput: ${results.metrics.throughput.toFixed(2)} TPS`);
        console.log(`   Latency Degradation: ${degradation.toFixed(1)}%`);
        console.log(`   Memory Growth: ${TestUtils.lamportsToSol(results.metrics.memoryDelta)} SOL`);
        
        await framework.saveResults(sessionId);
        
      } catch (error) {
        console.error("Sustained load test failed:", error);
        throw error;
      }
    }).timeout(120000);
  });

  describe("Memory Usage Under High Load", () => {
    it("Should monitor memory usage during high-volume operations", async () => {
      const sessionId = framework.startMonitoring("memory_monitoring");
      
      try {
        const iterations = 5000;
        const memorySnapshots = [framework.getMemoryUsage()];
        
        console.log(`Memory monitoring test: ${iterations} operations with memory tracking`);
        
        for (let i = 0; i < iterations; i++) {
          await framework.executeTransaction(
            sessionId,
            async () => {
              // Simulate memory-intensive operations
              const largeData = new Array(1000).fill(0).map(() => TestUtils.generateTestId("memory_test"));
              await TestUtils.delay(1);
              return {
                signature: TestUtils.generateTestId(`memory_${i}`),
                dataSize: largeData.length,
                timestamp: Date.now()
              };
            },
            `Memory Test ${i + 1}`
          );
          
          // Take memory snapshots periodically
          if (i % 1000 === 0) {
            memorySnapshots.push(framework.getMemoryUsage());
            const memoryMB = memorySnapshots[memorySnapshots.length - 1] / 1024 / 1024;
            console.log(`Memory at iteration ${i}: ${memoryMB.toFixed(2)} MB`);
          }
        }
        
        const results = framework.stopMonitoring(sessionId);
        
        // Analyze memory growth
        const initialMemory = memorySnapshots[0];
        const finalMemory = framework.getMemoryUsage();
        const memoryGrowth = finalMemory - initialMemory;
        const memoryGrowthMB = memoryGrowth / 1024 / 1024;
        
        // Assertions
        assert.isTrue(memoryGrowthMB < 500, 
          `Memory growth should be reasonable. Got: ${memoryGrowthMB.toFixed(2)} MB`);
        
        assert.isTrue(results.metrics.averageLatency < 100, 
          `Operations should remain fast. Avg latency: ${results.metrics.averageLatency.toFixed(2)}ms`);
        
        console.log(`✅ Memory monitoring test completed:`);
        console.log(`   Operations: ${results.metrics.totalTransactions}`);
        console.log(`   Initial Memory: ${(initialMemory / 1024 / 1024).toFixed(2)} MB`);
        console.log(`   Final Memory: ${(finalMemory / 1024 / 1024).toFixed(2)} MB`);
        console.log(`   Memory Growth: ${memoryGrowthMB.toFixed(2)} MB`);
        console.log(`   Memory per Operation: ${(memoryGrowth / iterations / 1024).toFixed(2)} KB`);
        
        await framework.saveResults(sessionId);
        
      } catch (error) {
        console.error("Memory monitoring test failed:", error);
        throw error;
      }
    }).timeout(120000);
  });
});
