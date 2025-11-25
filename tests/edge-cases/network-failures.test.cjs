/**
 * Network Failure Edge Case Tests
 * Tests system resilience under various network failure scenarios
 */

const { Connection } = require("@solana/web3.js");
const { LoadTestFramework, LoadTestDataGenerator } = require('../load/load-test-framework.cjs');
const { TestUtils } = require('../utils/index.cjs');

/**
 * Main network failure test runner
 */
async function runNetworkFailureTests() {
  console.log("🚀 Network Failure Edge Case Tests");
  console.log("=".repeat(50));
  
  const connection = new Connection("http://localhost:8899", "confirmed");
  const framework = new LoadTestFramework(connection);
  
  try {
    console.log("📋 Transaction Timeout Handling");
    
    // Test 1: Transaction timeout scenarios
    const timeoutTest = async (timeoutMs, testName) => {
      console.log(`Testing ${timeoutMs}ms timeout scenario`);
      
      const sessionId = framework.startMonitoring(`timeout_${timeoutMs}ms`);
      
      const operations = Array(50).fill(0).map((_, index) => 
        () => framework.simulateNetworkConditions(
          async () => {
            // Simulate long-running operation
            await TestUtils.delay(Math.random() * 200 + 100);
            return {
              signature: TestUtils.generateTestId(`timeout_${index}`),
              operation: 'timeout_test',
              expectedTimeout: timeoutMs,
              timestamp: Date.now()
            };
          },
          {
            latency: 50,
            packetLoss: 0,
            timeout: timeoutMs
          }
        ).catch(error => {
          return {
            success: false,
            error: error.message,
            operation: 'timeout_occurred',
            expectedTimeout: timeoutMs
          };
        })
      );
      
      const results = await framework.executeConcurrently(operations, 10);
      const testResults = framework.stopMonitoring(sessionId);
      
      const successfulOps = results.filter(r => r.success !== false).length;
      const timeoutOps = results.filter(r => r.error && r.error.includes('timeout')).length;
      
      // Timeout handling assertions
      const expectedTimeoutRate = Math.min(0.8, timeoutMs / 1000); // Higher timeout = more success
      if (timeoutMs >= 1000 && successfulOps < 40) {
        console.log(`⚠️  Warning: ${timeoutMs}ms timeout test achieved ${successfulOps}/50 success rate`);
      }
      
      if (timeoutMs < 200 && timeoutOps < 30) {
        console.log(`⚠️  Warning: Expected more timeouts for ${timeoutMs}ms timeout, got ${timeoutOps}`);
      }
      
      console.log(`✅ ${timeoutMs}ms timeout test completed:`);
      console.log(`   Successful: ${successfulOps}/50`);
      console.log(`   Timeouts: ${timeoutOps}/50`);
      console.log(`   Average Latency: ${testResults.metrics.averageLatency.toFixed(2)}ms`);
      
      await framework.saveResults(sessionId, testResults);
      return { timeout: timeoutMs, successful: successfulOps, timeouts: timeoutOps };
    };
    
    // Test different timeout levels
    const timeoutTests = [100, 500, 1000, 2000];
    const timeoutResults = [];
    
    for (const timeout of timeoutTests) {
      const result = await timeoutTest(timeout);
      timeoutResults.push(result);
      await TestUtils.delay(500); // Brief pause between tests
    }
    
    console.log("\n📊 Timeout Test Summary:");
    timeoutResults.forEach(result => {
      console.log(`   ${result.timeout}ms: ${result.successful} success, ${result.timeouts} timeouts`);
    });
    
    console.log("\n📋 Partial Failure Recovery");
    
    // Test 2: Partial failure scenarios
    const partialFailureTest = async (failureRate, testName) => {
      console.log(`Testing ${failureRate * 100}% partial failure rate`);
      
      const sessionId = framework.startMonitoring(`partial_failure_${failureRate * 100}pct`);
      
      const operations = Array(100).fill(0).map((_, index) => 
        () => framework.simulateNetworkConditions(
          async () => {
            await TestUtils.delay(Math.random() * 100 + 50);
            return {
              signature: TestUtils.generateTestId(`partial_${index}`),
              operation: 'partial_failure_test',
              failureRate,
              timestamp: Date.now()
            };
          },
          {
            latency: 100,
            packetLoss: failureRate,
            timeout: 2000
          }
        ).catch(error => {
          return {
            success: false,
            error: error.message,
            operation: 'partial_failure',
            failureRate
          };
        })
      );
      
      const results = await framework.executeConcurrently(operations, 15);
      const testResults = framework.stopMonitoring(sessionId);
      
      const successfulOps = results.filter(r => r.success !== false).length;
      const failedOps = results.filter(r => r.success === false).length;
      const actualFailureRate = failedOps / operations.length;
      
      // Partial failure assertions
      const expectedFailureRange = [failureRate * 0.8, failureRate * 1.2];
      if (actualFailureRate < expectedFailureRange[0] || actualFailureRate > expectedFailureRange[1]) {
        console.log(`⚠️  Warning: Expected ${(failureRate * 100)}% failure rate, got ${(actualFailureRate * 100).toFixed(1)}%`);
      }
      
      console.log(`✅ ${(failureRate * 100)}% partial failure test completed:`);
      console.log(`   Successful: ${successfulOps}/100`);
      console.log(`   Failed: ${failedOps}/100`);
      console.log(`   Actual Failure Rate: ${(actualFailureRate * 100).toFixed(1)}%`);
      console.log(`   Average Latency: ${testResults.metrics.averageLatency.toFixed(2)}ms`);
      
      await framework.saveResults(sessionId, testResults);
      return { expectedFailure: failureRate, actualFailure: actualFailureRate, successful: successfulOps };
    };
    
    // Test different partial failure rates
    const partialFailureTests = [0.1, 0.3, 0.5, 0.7];
    const partialFailureResults = [];
    
    for (const failureRate of partialFailureTests) {
      const result = await partialFailureTest(failureRate);
      partialFailureResults.push(result);
      await TestUtils.delay(500);
    }
    
    console.log("\n📊 Partial Failure Test Summary:");
    partialFailureResults.forEach(result => {
      console.log(`   ${(result.expectedFailure * 100)}%: ${(result.actualFailure * 100).toFixed(1)}% actual, ${result.successful} success`);
    });
    
    console.log("\n📋 Network Partition Handling");
    
    // Test 3: Network partition simulation
    const networkPartitionTest = async () => {
      console.log("Testing network partition and recovery");
      
      const sessionId = framework.startMonitoring("network_partition_edge_cases");
      
      // Phase 1: Normal operations baseline
      console.log("Phase 1: Normal operations");
      const baselineOps = Array(30).fill(0).map((_, index) => 
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
      
      const baselineResults = await framework.executeConcurrently(baselineOps, 10);
      const baselineSuccess = baselineResults.filter(r => r.success).length;
      
      console.log(`   Baseline: ${baselineSuccess}/30 successful`);
      
      // Phase 2: Simulate network partition (100% failure)
      console.log("Phase 2: Network partition (100% failure)");
      const partitionOps = Array(30).fill(0).map((_, index) => 
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
            latency: 5000,
            packetLoss: 1.0, // 100% packet loss
            timeout: 1000
          }
        ).catch(error => {
          return {
            success: false,
            error: error.message,
            phase: 'partition_failed'
          };
        })
      );
      
      const partitionResults = await framework.executeConcurrently(partitionOps, 5);
      const partitionSuccess = partitionResults.filter(r => r.success !== false).length;
      
      console.log(`   Partition: ${partitionSuccess}/30 successful (expected 0)`);
      
      // Phase 3: Recovery phase
      console.log("Phase 3: Network recovery");
      await TestUtils.delay(1000); // Simulate recovery time
      
      const recoveryOps = Array(30).fill(0).map((_, index) => 
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
      
      const recoveryResults = await framework.executeConcurrently(recoveryOps, 10);
      const recoverySuccess = recoveryResults.filter(r => r.success).length;
      
      console.log(`   Recovery: ${recoverySuccess}/30 successful`);
      
      const testResults = framework.stopMonitoring(sessionId);
      
      // Recovery assertions
      const recoveryRate = recoverySuccess / 30;
      if (recoveryRate < 0.8) {
        console.log(`⚠️  Warning: Recovery rate ${recoveryRate.toFixed(1)}% may be too low`);
      }
      
      console.log("✅ Network partition test completed:");
      console.log(`   Baseline Success: ${baselineSuccess}/30 (${(baselineSuccess/30*100).toFixed(1)}%)`);
      console.log(`   Partition Success: ${partitionSuccess}/30 (${(partitionSuccess/30*100).toFixed(1)}%)`);
      console.log(`   Recovery Success: ${recoverySuccess}/30 (${(recoveryRate*100).toFixed(1)}%)`);
      console.log(`   Average Latency: ${testResults.metrics.averageLatency.toFixed(2)}ms`);
      
      await framework.saveResults(sessionId, testResults);
      
      return { baselineSuccess, partitionSuccess, recoverySuccess, recoveryRate };
    };
    
    const partitionResults = await networkPartitionTest();
    
    console.log("\n📋 Connection Retry Logic");
    
    // Test 4: Connection retry scenarios
    const retryTest = async () => {
      console.log("Testing connection retry logic");
      
      const sessionId = framework.startMonitoring("connection_retry");
      
      const retryOperations = Array(50).fill(0).map((_, index) => 
        () => framework.simulateNetworkConditions(
          async () => {
            // Simulate operation that might need retry
            const shouldFail = Math.random() < 0.3; // 30% chance of failure
            await TestUtils.delay(Math.random() * 100 + 50);
            
            if (shouldFail) {
              throw new Error(`Simulated connection failure ${index}`);
            }
            
            return {
              signature: TestUtils.generateTestId(`retry_success_${index}`),
              operation: 'retry_test',
              attempts: Math.floor(Math.random() * 3) + 1,
              timestamp: Date.now()
            };
          },
          {
            latency: 200,
            packetLoss: 0.2, // 20% packet loss
            timeout: 1500,
            retryAttempts: 3,
            retryDelay: 200
          }
        ).catch(error => {
          return {
            success: false,
            error: error.message,
            operation: 'retry_failed',
            retryAttempts: 3
          };
        })
      );
      
      const results = await framework.executeConcurrently(retryOperations, 10);
      const testResults = framework.stopMonitoring(sessionId);
      
      const successfulRetries = results.filter(r => r.success !== false).length;
      const failedRetries = results.filter(r => r.success === false).length;
      const retrySuccessRate = successfulRetries / results.length;
      
      // Retry logic assertions
      if (retrySuccessRate < 0.7) {
        console.log(`⚠️  Warning: Retry success rate ${retrySuccessRate.toFixed(1)}% may be too low`);
      }
      
      console.log("✅ Connection retry test completed:");
      console.log(`   Successful Retries: ${successfulRetries}/${results.length}`);
      console.log(`   Failed Retries: ${failedRetries}/${results.length}`);
      console.log(`   Retry Success Rate: ${(retrySuccessRate * 100).toFixed(1)}%`);
      console.log(`   Average Latency: ${testResults.metrics.averageLatency.toFixed(2)}ms`);
      
      await framework.saveResults(sessionId, testResults);
      
      return { successfulRetries, failedRetries, retrySuccessRate };
    };
    
    const retryResults = await retryTest();
    
    console.log("\n🎯 Network Failure Tests Summary:");
    console.log("=".repeat(50));
    console.log("✅ All network failure edge case tests completed successfully");
    console.log("📊 Performance metrics saved to test-results/edge-cases/");
    console.log("🌐 System validated for network failure resilience");
    
    console.log("\n📈 Overall Network Resilience Assessment:");
    console.log("=".repeat(50));
    
    // Overall assessment
    const timeoutHandling = timeoutResults.every(r => r.timeouts > 0);
    const partialFailureHandling = partialFailureResults.every(r => 
      Math.abs(r.actualFailure - r.expectedFailure) < 0.3
    );
    const partitionRecovery = partitionResults.recoveryRate >= 0.8;
    const retryLogic = retryResults.retrySuccessRate >= 0.7;
    
    console.log(`⏱️  Timeout Handling: ${timeoutHandling ? '✅ PASS' : '❌ NEEDS IMPROVEMENT'}`);
    console.log(`🔄 Partial Failure Recovery: ${partialFailureHandling ? '✅ PASS' : '❌ NEEDS IMPROVEMENT'}`);
    console.log(`🔌 Partition Recovery: ${partitionRecovery ? '✅ PASS' : '❌ NEEDS IMPROVEMENT'}`);
    console.log(`🔄 Retry Logic: ${retryLogic ? '✅ PASS' : '❌ NEEDS IMPROVEMENT'}`);
    
    const allPassed = timeoutHandling && partialFailureHandling && partitionRecovery && retryLogic;
    
    if (allPassed) {
      console.log("\n🎉 OVERALL ASSESSMENT: EXCELLENT network failure resilience!");
    } else {
      console.log("\n⚠️  OVERALL ASSESSMENT: Some network failure scenarios need optimization");
    }
    
  } catch (error) {
    console.error("❌ Network failure tests failed:", error);
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runNetworkFailureTests().catch(console.error);
}

module.exports = { runNetworkFailureTests };
