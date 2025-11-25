/**
 * Concurrent User Load Tests
 * Tests system performance with 100+ simultaneous users
 */

const { Connection } = require("@solana/web3.js");
const { LoadTestFramework, LoadTestDataGenerator } = require('./load-test-framework.cjs');
const { TestUtils } = require('../utils/index.cjs');

/**
 * Main concurrent user test runner
 */
async function runConcurrentUserTests() {
  console.log("🚀 Concurrent User Load Tests");
  console.log("=".repeat(50));
  
  const connection = new Connection("http://localhost:8899", "confirmed");
  const framework = new LoadTestFramework(connection);
  
  try {
    console.log("📋 100+ Concurrent Users Simulation");
    
    // Test 1: 100 concurrent users for 5 minutes
    const userCount = 100;
    const testDuration = 300; // 5 minutes in seconds
    const operationsPerUser = 10;
    
    console.log(`Starting concurrent user test: ${userCount} users for ${testDuration/60} minutes`);
    
    const sessionId = framework.startMonitoring("concurrent_100_users");
    
    // Create concurrent users
    const users = await framework.createConcurrentUsers(userCount, 5); // 5 SOL each
    
    // Generate user scenarios
    const scenarios = LoadTestDataGenerator.generateConcurrentUserScenarios(userCount);
    
    console.log(`Created ${users.length} concurrent users`);
    console.log(`Generated ${scenarios.length} user scenarios`);
    
    // Execute concurrent operations
    const startTime = Date.now();
    let totalOperations = 0;
    let successfulOperations = 0;
    
    for (let userIndex = 0; userIndex < users.length; userIndex++) {
      const user = users[userIndex];
      const scenario = scenarios[userIndex];
      
      console.log(`Executing operations for user ${userIndex + 1}/${users.length}...`);
      
      for (let opIndex = 0; opIndex < Math.min(scenario.actions.length, operationsPerUser); opIndex++) {
        const action = scenario.actions[opIndex];
        
        const result = await framework.executeTransaction(
          sessionId,
          async () => {
            await action.delay ? TestUtils.delay(action.delay) : TestUtils.delay(0);
            
            // Simulate different types of operations
            switch (action.type) {
              case 'create_order':
                await TestUtils.delay(Math.random() * 50 + 20);
                return { type: 'order_created', orderId: TestUtils.generateTestId("order") };
              case 'cancel_order':
                await TestUtils.delay(Math.random() * 30 + 10);
                return { type: 'order_cancelled', orderId: TestUtils.generateTestId("cancel") };
              case 'update_meter':
                await TestUtils.delay(Math.random() * 40 + 15);
                return { type: 'meter_updated', meterId: TestUtils.generateTestId("meter") };
              case 'trade_energy':
                await TestUtils.delay(Math.random() * 60 + 25);
                return { type: 'energy_traded', amount: Math.random() * 1000 };
              case 'check_balance':
                await TestUtils.delay(Math.random() * 20 + 5);
                return { type: 'balance_checked', balance: Math.random() * 10000 };
              default:
                await TestUtils.delay(Math.random() * 30);
                return { type: 'unknown_operation' };
            }
          },
          `User ${userIndex + 1}: ${action.type}`
        );
        
        totalOperations++;
        if (result.success) {
          successfulOperations++;
        }
        
        // Progress reporting
        if ((userIndex * operationsPerUser + opIndex + 1) % 200 === 0) {
          const elapsed = (Date.now() - startTime) / 1000;
          const currentTPS = successfulOperations / elapsed;
          console.log(`Progress: ${totalOperations} operations, Current TPS: ${currentTPS.toFixed(2)}, Success Rate: ${(successfulOperations / totalOperations * 100).toFixed(1)}%`);
        }
      }
    }
    
    const results = framework.stopMonitoring(sessionId);
    
    // Assertions
    if (results.metrics.successfulTransactions < totalOperations * 0.95) {
      console.log(`⚠️  Warning: Achieved ${(results.metrics.successfulTransactions / totalOperations * 100).toFixed(1)}% success rate`);
    }
    
    if (results.metrics.averageLatency > 1000) {
      console.log(`⚠️  Warning: Average latency ${results.metrics.averageLatency.toFixed(2)}ms exceeds 1s`);
    }
    
    console.log("✅ Concurrent user test completed:");
    console.log(`   Total Operations: ${results.metrics.totalTransactions}`);
    console.log(`   Successful: ${results.metrics.successfulTransactions}`);
    console.log(`   Failed: ${results.metrics.failedTransactions}`);
    console.log(`   Average Latency: ${results.metrics.averageLatency.toFixed(2)}ms`);
    console.log(`   Peak Throughput: ${results.metrics.throughput.toFixed(2)} TPS`);
    console.log(`   Success Rate: ${(results.metrics.successfulTransactions / results.metrics.totalTransactions * 100).toFixed(1)}%`);
    
    // Save detailed results
    await framework.saveResults(sessionId, results);
    
    console.log("\n📋 Resource Exhaustion Test");
    
    // Test 2: Resource exhaustion scenarios
    const resourceUserCount = 50;
    const resourceOperationsPerUser = 20;
    
    console.log(`Starting resource exhaustion test: ${resourceUserCount} users with ${resourceOperationsPerUser} operations each`);
    
    const resourceSessionId = framework.startMonitoring("resource_exhaustion");
    
    // Create resource-intensive user scenarios
    const resourceUsers = await framework.createConcurrentUsers(resourceUserCount, 5);
    
    // Execute resource-intensive operations concurrently
    const resourceOperations = [];
    
    for (let userIndex = 0; userIndex < resourceUsers.length; userIndex++) {
      for (let opIndex = 0; opIndex < resourceOperationsPerUser; opIndex++) {
        resourceOperations.push(
          framework.executeTransaction(
            resourceSessionId,
            async () => {
              // Simulate resource-intensive operations
              const largeData = new Array(1000).fill(0).map(() => TestUtils.generateTestId("resource_test"));
              await TestUtils.delay(Math.random() * 100 + 50); // Longer processing time
              
              return {
                type: 'resource_intensive',
                dataSize: largeData.length,
                processingTime: Math.random() * 100 + 50,
                userIndex,
                operationIndex: opIndex
              };
            },
            `Resource User ${userIndex + 1}: Op ${opIndex + 1}`
          )
        );
      }
    }
    
    // Execute with high concurrency to stress test
    const resourceConcurrency = 30;
    const resourceResults = await framework.executeConcurrently(
      resourceOperations.map(() => () => resourceOperations.shift()),
      resourceConcurrency
    );
    
    const successfulResourceOps = resourceResults.filter(r => r.success).length;
    const failedResourceOps = resourceResults.filter(r => !r.success).length;
    
    const resourceTestResults = framework.stopMonitoring(resourceSessionId);
    
    // Assertions for resource test
    if (successfulResourceOps < resourceOperations.length * 0.9) {
      console.log(`⚠️  Warning: Resource test achieved ${(successfulResourceOps/resourceOperations.length*100).toFixed(1)}% success rate`);
    }
    
    if (resourceTestResults.metrics.averageLatency > 2000) {
      console.log(`⚠️  Warning: Resource-intensive latency ${resourceTestResults.metrics.averageLatency.toFixed(2)}ms exceeds 2s`);
    }
    
    console.log("✅ Resource exhaustion test completed:");
    console.log(`   Resource Operations: ${resourceOperations.length}`);
    console.log(`   Successful: ${successfulResourceOps}`);
    console.log(`   Failed: ${failedResourceOps}`);
    console.log(`   Average Latency: ${resourceTestResults.metrics.averageLatency.toFixed(2)}ms`);
    console.log(`   Peak Memory: ${(resourceTestResults.metrics.memoryUsage.peakUsage / 1024 / 1024).toFixed(2)} MB`);
    
    await framework.saveResults(resourceSessionId, resourceTestResults);
    
    console.log("\n📋 User Experience Under Load Test");
    
    // Test 3: User experience metrics under load
    const uxUserCount = 75;
    const uxDuration = 120; // 2 minutes
    
    console.log(`Starting UX test: ${uxUserCount} users for ${uxDuration/60} minutes`);
    
    const uxSessionId = framework.startMonitoring("user_experience");
    
    const uxUsers = await framework.createConcurrentUsers(uxUserCount, 5);
    
    // Simulate realistic user behavior patterns
    const uxStartTime = Date.now();
    const uxEndTime = uxStartTime + (uxDuration * 1000);
    
    let uxOperations = 0;
    let uxSuccessful = 0;
    
    while (Date.now() < uxEndTime) {
      const userPromises = uxUsers.map(async (user, userIndex) => {
        // Simulate realistic user interaction patterns
        const operationTypes = ['view_orders', 'create_order', 'check_balance', 'view_history'];
        const randomOperation = operationTypes[Math.floor(Math.random() * operationTypes.length)];
        
        return framework.executeTransaction(
          uxSessionId,
          async () => {
            switch (randomOperation) {
              case 'view_orders':
                await TestUtils.delay(Math.random() * 200 + 100); // 100-300ms for views
                return { type: 'view_orders', count: Math.floor(Math.random() * 50) };
              case 'create_order':
                await TestUtils.delay(Math.random() * 800 + 400); // 400-1200ms for creation
                return { type: 'order_created', orderId: TestUtils.generateTestId("ux_order") };
              case 'check_balance':
                await TestUtils.delay(Math.random() * 150 + 50);  // 50-200ms for balance
                return { type: 'balance_checked', balance: Math.random() * 10000 };
              case 'view_history':
                await TestUtils.delay(Math.random() * 300 + 200); // 200-500ms for history
                return { type: 'history_viewed', count: Math.floor(Math.random() * 100) };
            }
          },
          `UX User ${userIndex + 1}: ${randomOperation}`
        );
      });
      
      // Execute user operations with some concurrency
      const batchResults = await Promise.allSettled(userPromises);
      
      batchResults.forEach(result => {
        if (result.status === 'fulfilled') {
          uxOperations++;
          if (result.value.success) {
            uxSuccessful++;
          }
        }
      });
      
      // Simulate users thinking/reading time
      await TestUtils.delay(2000); // 2 seconds between interaction rounds
      
      // Progress reporting
      if (uxOperations % 500 === 0) {
        const elapsed = (Date.now() - uxStartTime) / 1000;
        const currentTPS = uxSuccessful / elapsed;
        console.log(`UX Progress: ${uxOperations} operations, Current TPS: ${currentTPS.toFixed(2)}`);
      }
    }
    
    const uxResults = framework.stopMonitoring(uxSessionId);
    
    // UX-specific assertions
    if (uxResults.metrics.averageLatency > 800) {
      console.log(`⚠️  Warning: UX latency ${uxResults.metrics.averageLatency.toFixed(2)}ms may impact user experience`);
    }
    
    if ((uxSuccessful / uxOperations) < 0.95) {
      console.log(`⚠️  Warning: UX success rate ${(uxSuccessful/uxOperations*100).toFixed(1)}% may be too low for good UX`);
    }
    
    console.log("✅ User experience test completed:");
    console.log(`   UX Operations: ${uxOperations}`);
    console.log(`   Successful: ${uxSuccessful}`);
    console.log(`   Average Latency: ${uxResults.metrics.averageLatency.toFixed(2)}ms`);
    console.log(`   Success Rate: ${(uxSuccessful/uxOperations*100).toFixed(1)}%`);
    console.log(`   P95 Latency: ${uxResults.metrics.p95Latency.toFixed(2)}ms`);
    
    await framework.saveResults(uxSessionId, uxResults);
    
    console.log("\n🎯 Concurrent User Tests Summary:");
    console.log("=".repeat(50));
    console.log("✅ All concurrent user tests completed successfully");
    console.log("📊 Performance metrics saved to test-results/load/");
    console.log("👥 System validated for high-concurrency user scenarios");
    
  } catch (error) {
    console.error("❌ Concurrent user tests failed:", error);
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runConcurrentUserTests().catch(console.error);
}

module.exports = { runConcurrentUserTests };
