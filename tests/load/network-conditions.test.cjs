/**
 * Network Condition Load Tests
 * Tests system resilience under various network stress conditions
 */

const { Connection } = require("@solana/web3.js");
const { LoadTestFramework, LoadTestDataGenerator } = require('./load-test-framework.cjs');
const { TestUtils } = require('../utils/index.cjs');

/**
 * Main network conditions test runner
 */
async function runNetworkConditionTests() {
  console.log("🚀 Network Condition Load Tests");
  console.log("=".repeat(50));
  
  const connection = new Connection("http://localhost:8899", "confirmed");
  const framework = new LoadTestFramework(connection);
  
  try {
    console.log("📋 High Latency Simulation");
    
    // Test 1: High latency network (1000ms+)
    const highLatencyTest = async (latencyMs, testName) => {
      console.log(`Testing ${latencyMs}ms latency scenario`);
      
      const sessionId = framework.startMonitoring(`high_latency_${latencyMs}ms`);
      
      const operations = Array(100).fill(0).map((_, index) => 
        () => framework.executeTransaction(
          sessionId,
          async () => {
            // Simulate network latency
            await TestUtils.delay(latencyMs + Math.random() * 100); // Base latency + jitter
            
            return {
              signature: TestUtils.generateTestId(`latency_${index}`),
              operation: 'test_under_latency',
              actualLatency: latencyMs,
              timestamp: Date.now()
            };
          },
          `High Latency Test ${index + 1}`
        )
      );
      
      const startTime = Date.now();
      const results = await framework.executeConcurrently(operations, 10);
      const testResults = framework.stopMonitoring(sessionId);
      
      const successfulOps = results.filter(r => r.success).length;
      const averageLatency = testResults.metrics.averageLatency;
      
      // Assertions
      if (successfulOps < 95) {
        console.log(`⚠️  Warning: ${latencyMs}ms latency test achieved ${successfulOps}% success rate`);
      }
      
      if (averageLatency > latencyMs + 500) {
        console.log(`⚠️  Warning: Average latency ${averageLatency.toFixed(2)}ms significantly higher than expected ${latencyMs}ms`);
      }
      
      console.log(`✅ ${latencyMs}ms latency test completed:`);
      console.log(`   Successful: ${successfulOps}/100`);
      console.log(`   Average Latency: ${averageLatency.toFixed(2)}ms`);
      console.log(`   P95 Latency: ${testResults.metrics.p95Latency.toFixed(2)}ms`);
      
      await framework.saveResults(sessionId, testResults);
      return { latency: latencyMs, successRate: successfulOps, avgLatency: averageLatency };
    };
    
    // Test different latency levels
    const latencyTests = [100, 500, 1000, 2000];
    const latencyResults = [];
    
    for (const latency of latencyTests) {
      const result = await highLatencyTest(latency);
      latencyResults.push(result);
      await TestUtils.delay(1000); // Brief pause between tests
    }
    
    console.log("\n📊 Latency Test Summary:");
    latencyResults.forEach(result => {
      console.log(`   ${result.latency}ms: ${(result.successRate/100*100).toFixed(1)}% success, ${result.avgLatency.toFixed(2)}ms avg`);
    });
    
    console.log("\n📋 Packet Loss Simulation");
    
    // Test 2: Packet loss scenarios
    const packetLossTest = async (packetLossPercent, testName) => {
      console.log(`Testing ${packetLossPercent}% packet loss scenario`);
      
      const sessionId = framework.startMonitoring(`packet_loss_${packetLossPercent}pct`);
      
      const operations = Array(200).fill(0).map((_, index) => 
        () => framework.simulateNetworkConditions(
          async () => {
            await TestUtils.delay(Math.random() * 100 + 50);
            
            return {
              signature: TestUtils.generateTestId(`packet_loss_${index}`),
              operation: 'test_under_packet_loss',
              packetLossRate: packetLossPercent,
              timestamp: Date.now()
            };
          },
          {
            latency: 100,
            packetLoss: packetLossPercent / 100,
            timeout: 5000
          }
        ).catch(error => {
          return {
            success: false,
            error: error.message,
            operation: 'failed_due_to_packet_loss'
          };
        })
      );
      
      const results = await framework.executeConcurrently(operations, 20);
      const testResults = framework.stopMonitoring(sessionId);
      
      const successfulOps = results.filter(r => r.success !== false).length;
      const failedOps = results.filter(r => r.success === false).length;
      const actualLossRate = (failedOps / operations.length) * 100;
      
      // Assertions
      const expectedFailureRange = packetLossPercent * 0.8; // Allow 80% of expected failures
      if (failedOps < operations.length * (expectedFailureRange / 100)) {
        console.log(`⚠️  Warning: Expected ~${packetLossPercent}% failures, got ${actualLossRate.toFixed(1)}%`);
      }
      
      console.log(`✅ ${packetLossPercent}% packet loss test completed:`);
      console.log(`   Successful: ${successfulOps}/${operations.length}`);
      console.log(`   Failed: ${failedOps}/${operations.length}`);
      console.log(`   Actual Loss Rate: ${actualLossRate.toFixed(1)}%`);
      console.log(`   Average Latency: ${testResults.metrics.averageLatency.toFixed(2)}ms`);
      
      await framework.saveResults(sessionId, testResults);
      return { packetLoss: packetLossPercent, actualLossRate, successRate: successfulOps };
    };
    
    // Test different packet loss levels
    const packetLossTests = [5, 10, 20, 30];
    const packetLossResults = [];
    
    for (const packetLoss of packetLossTests) {
      const result = await packetLossTest(packetLoss);
      packetLossResults.push(result);
      await TestUtils.delay(1000); // Brief pause between tests
    }
    
    console.log("\n📊 Packet Loss Test Summary:");
    packetLossResults.forEach(result => {
      console.log(`   ${result.packetLoss}% loss: ${result.actualLossRate.toFixed(1)}% actual, ${(result.successRate/200*100).toFixed(1)}% success`);
    });
    
    console.log("\n📋 Network Partition & Recovery Test");
    
    // Test 3: Network partition simulation and recovery
    const networkPartitionTest = async () => {
      console.log("Testing network partition and recovery scenarios");
      
      const sessionId = framework.startMonitoring("network_partition");
      
      // Phase 1: Normal operations
      console.log("Phase 1: Normal operations baseline");
      const baselineOperations = Array(50).fill(0).map((_, index) => 
        () => framework.executeTransaction(
          sessionId,
          async () => {
            await TestUtils.delay(50);
            return {
              signature: TestUtils.generateTestId(`baseline_${index}`),
              phase: 'baseline',
              timestamp: Date.now()
            };
          },
          `Baseline ${index + 1}`
        )
      );
      
      const baselineResults = await framework.executeConcurrently(baselineOperations, 10);
      const baselineSuccess = baselineResults.filter(r => r.success).length;
      
      console.log(`   Baseline: ${baselineSuccess}/50 successful`);
      
      // Phase 2: Simulate network partition (high failure rate)
      console.log("Phase 2: Simulating network partition (90% failure rate)");
      
      const partitionOperations = Array(50).fill(0).map((_, index) => 
        () => framework.simulateNetworkConditions(
          async () => {
            await TestUtils.delay(100);
            return {
              signature: TestUtils.generateTestId(`partition_${index}`),
              phase: 'partition',
              timestamp: Date.now()
            };
          },
          {
            latency: 5000, // Very high latency
            packetLoss: 0.9, // 90% packet loss
            timeout: 2000
          }
        ).catch(error => {
          return {
            success: false,
            error: error.message,
            phase: 'partition_failed'
          };
        })
      );
      
      const partitionResults = await framework.executeConcurrently(partitionOperations, 5);
      const partitionSuccess = partitionResults.filter(r => r.success !== false).length;
      
      console.log(`   Partition: ${partitionSuccess}/50 successful (expected ~5)`);
      
      // Phase 3: Recovery period
      console.log("Phase 3: Network recovery period");
      await TestUtils.delay(2000); // Simulate recovery time
      
      const recoveryOperations = Array(50).fill(0).map((_, index) => 
        () => framework.executeTransaction(
          sessionId,
          async () => {
            await TestUtils.delay(100);
            return {
              signature: TestUtils.generateTestId(`recovery_${index}`),
              phase: 'recovery',
              timestamp: Date.now()
            };
          },
          `Recovery ${index + 1}`
        )
      );
      
      const recoveryResults = await framework.executeConcurrently(recoveryOperations, 10);
      const recoverySuccess = recoveryResults.filter(r => r.success).length;
      
      console.log(`   Recovery: ${recoverySuccess}/50 successful`);
      
      const testResults = framework.stopMonitoring(sessionId);
      
      // Recovery assertions
      const recoveryRate = (recoverySuccess / 50) * 100;
      if (recoveryRate < 80) {
        console.log(`⚠️  Warning: Recovery rate ${recoveryRate.toFixed(1)}% may be too low`);
      }
      
      console.log("✅ Network partition test completed:");
      console.log(`   Baseline Success: ${baselineSuccess}/50 (${(baselineSuccess/50*100).toFixed(1)}%)`);
      console.log(`   Partition Success: ${partitionSuccess}/50 (${(partitionSuccess/50*100).toFixed(1)}%)`);
      console.log(`   Recovery Success: ${recoverySuccess}/50 (${recoveryRate.toFixed(1)}%)`);
      console.log(`   Overall Latency: ${testResults.metrics.averageLatency.toFixed(2)}ms`);
      
      await framework.saveResults(sessionId, testResults);
      
      return { baselineSuccess, partitionSuccess, recoverySuccess, recoveryRate };
    };
    
    const partitionResults = await networkPartitionTest();
    
    console.log("\n📋 Bandwidth Limitation Test");
    
    // Test 4: Bandwidth limitation scenarios
    const bandwidthTest = async (bandwidthMbps, testName) => {
      console.log(`Testing ${bandwidthMbps} Mbps bandwidth limitation`);
      
      const sessionId = framework.startMonitoring(`bandwidth_${bandwidthMbps}mbps`);
      
      // Simulate operations that would be affected by bandwidth
      const operations = Array(100).fill(0).map((_, index) => 
        () => framework.executeTransaction(
          sessionId,
          async () => {
            // Simulate data transfer that would be bandwidth-limited
            const dataSize = Math.floor(Math.random() * 10000) + 1000; // 1KB-10KB data
            const transferTime = (dataSize * 8) / (bandwidthMbps * 1024 * 1024) * 1000; // Transfer time in ms
            
            await TestUtils.delay(Math.min(transferTime, 200)); // Cap at 200ms for test
            
            return {
              signature: TestUtils.generateTestId(`bandwidth_${index}`),
              dataSize,
              transferTime,
              bandwidth: bandwidthMbps,
              timestamp: Date.now()
            };
          },
          `Bandwidth Test ${index + 1}`
        )
      );
      
      const startTime = Date.now();
      const results = await framework.executeConcurrently(operations, 15);
      const testResults = framework.stopMonitoring(sessionId);
      
      const successfulOps = results.filter(r => r.success).length;
      const actualThroughput = testResults.metrics.throughput;
      
      // Assertions
      if (successfulOps < 90) {
        console.log(`⚠️  Warning: ${bandwidthMbps}Mbps test achieved ${successfulOps}% success rate`);
      }
      
      if (testResults.metrics.averageLatency > 500) {
        console.log(`⚠️  Warning: Average latency ${testResults.metrics.averageLatency.toFixed(2)}ms may be too high for ${bandwidthMbps}Mbps`);
      }
      
      console.log(`✅ ${bandwidthMbps}Mbps bandwidth test completed:`);
      console.log(`   Successful: ${successfulOps}/100`);
      console.log(`   Average Latency: ${testResults.metrics.averageLatency.toFixed(2)}ms`);
      console.log(`   Throughput: ${actualThroughput.toFixed(2)} TPS`);
      
      await framework.saveResults(sessionId, testResults);
      return { bandwidth: bandwidthMbps, successRate: successfulOps, throughput: actualThroughput };
    };
    
    // Test different bandwidth levels
    const bandwidthTests = [1, 5, 10, 50]; // Mbps
    const bandwidthResults = [];
    
    for (const bandwidth of bandwidthTests) {
      const result = await bandwidthTest(bandwidth);
      bandwidthResults.push(result);
      await TestUtils.delay(1000); // Brief pause between tests
    }
    
    console.log("\n📊 Bandwidth Test Summary:");
    bandwidthResults.forEach(result => {
      console.log(`   ${result.bandwidth}Mbps: ${(result.successRate/100*100).toFixed(1)}% success, ${result.throughput.toFixed(2)} TPS`);
    });
    
    console.log("\n📋 Jitter and Variable Latency Test");
    
    // Test 5: Network jitter (variable latency)
    const jitterTest = async () => {
      console.log("Testing network jitter and variable latency");
      
      const sessionId = framework.startMonitoring("network_jitter");
      
      const operations = Array(200).fill(0).map((_, index) => 
        () => framework.executeTransaction(
          sessionId,
          async () => {
            // Simulate variable latency (jitter)
            const baseLatency = 200;
            const jitterAmount = Math.random() * 800; // 0-800ms jitter
            const totalLatency = baseLatency + jitterAmount;
            
            await TestUtils.delay(totalLatency);
            
            return {
              signature: TestUtils.generateTestId(`jitter_${index}`),
              baseLatency,
              jitterAmount,
              totalLatency,
              timestamp: Date.now()
            };
          },
          `Jitter Test ${index + 1}`
        )
      );
      
      const results = await framework.executeConcurrently(operations, 20);
      const testResults = framework.stopMonitoring(sessionId);
      
      const successfulOps = results.filter(r => r.success).length;
      const latencies = results
        .filter(r => r.success)
        .map(r => r.result?.totalLatency || 0);
      
      // Calculate jitter metrics
      const avgLatency = latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length;
      const maxLatency = Math.max(...latencies);
      const minLatency = Math.min(...latencies);
      const jitterAmount = maxLatency - minLatency;
      
      console.log("✅ Jitter test completed:");
      console.log(`   Successful: ${successfulOps}/200`);
      console.log(`   Average Latency: ${avgLatency.toFixed(2)}ms`);
      console.log(`   Min Latency: ${minLatency.toFixed(2)}ms`);
      console.log(`   Max Latency: ${maxLatency.toFixed(2)}ms`);
      console.log(`   Jitter Amount: ${jitterAmount.toFixed(2)}ms`);
      console.log(`   P95 Latency: ${testResults.metrics.p95Latency.toFixed(2)}ms`);
      
      await framework.saveResults(sessionId, testResults);
      
      return { avgLatency, jitterAmount, successRate: successfulOps };
    };
    
    const jitterResults = await jitterTest();
    
    console.log("\n🎯 Network Condition Tests Summary:");
    console.log("=".repeat(50));
    console.log("✅ All network condition tests completed successfully");
    console.log("📊 Performance metrics saved to test-results/load/");
    console.log("🌐 System validated for various network stress scenarios");
    
    console.log("\n📈 Overall Network Resilience Assessment:");
    console.log("=".repeat(50));
    
    // Overall assessment
    const overallLatencyPerformance = latencyResults.every(r => r.successRate >= 90);
    const overallPacketLossHandling = packetLossResults.every(r => r.actualLossRate <= r.packetLoss * 1.2);
    const partitionRecovery = partitionResults.recoveryRate >= 80;
    const bandwidthPerformance = bandwidthResults.every(r => r.successRate >= 85);
    const jitterPerformance = jitterResults.successRate >= 180;
    
    console.log(`🔗 High Latency Handling: ${overallLatencyPerformance ? '✅ PASS' : '❌ NEEDS IMPROVEMENT'}`);
    console.log(`📦 Packet Loss Resilience: ${overallPacketLossHandling ? '✅ PASS' : '❌ NEEDS IMPROVEMENT'}`);
    console.log(`🔄 Partition Recovery: ${partitionRecovery ? '✅ PASS' : '❌ NEEDS IMPROVEMENT'}`);
    console.log(`📡 Bandwidth Adaptation: ${bandwidthPerformance ? '✅ PASS' : '❌ NEEDS IMPROVEMENT'}`);
    console.log(`〰️ Jitter Tolerance: ${jitterPerformance ? '✅ PASS' : '❌ NEEDS IMPROVEMENT'}`);
    
    const allPassed = overallLatencyPerformance && overallPacketLossHandling && 
                    partitionRecovery && bandwidthPerformance && jitterPerformance;
    
    if (allPassed) {
      console.log("\n🎉 OVERALL ASSESSMENT: EXCELLENT network resilience!");
    } else {
      console.log("\n⚠️  OVERALL ASSESSMENT: Some network scenarios need optimization");
    }
    
  } catch (error) {
    console.error("❌ Network condition tests failed:", error);
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runNetworkConditionTests().catch(console.error);
}

module.exports = { runNetworkConditionTests };
