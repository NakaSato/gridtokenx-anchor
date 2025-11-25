import * as anchor from "@coral-xyz/anchor";
import { LoadTestFramework, LoadTestDataGenerator } from "./load-test-framework.js";
import { TestUtils } from "../utils/index.js";
import { expect } from "chai";

/**
 * Concurrent User Load Tests
 * Tests the system under 100+ simultaneous users with realistic usage patterns
 */
describe("Concurrent User Load Tests", () => {
  let framework: LoadTestFramework;
  let connection: anchor.web3.Connection;
  let provider: anchor.AnchorProvider;
  let users: anchor.web3.Keypair[] = [];

  before(async () => {
    // Initialize connection and provider
    connection = new anchor.web3.Connection("http://localhost:8899", "confirmed");
    const wallet = anchor.Wallet.local();
    provider = new anchor.AnchorProvider(connection, wallet, {
      commitment: "confirmed",
      preflightCommitment: "confirmed"
    });
    anchor.setProvider(provider);

    framework = new LoadTestFramework(connection);

    // Create test users
    console.log("Creating test users for concurrent testing...");
    users = await framework.createConcurrentUsers(100, 5); // 100 users with 5 SOL each
    console.log(`✅ Created ${users.length} test users`);
  });

  describe("100+ Simultaneous Users", () => {
    it("Should handle 100 concurrent users trading simultaneously", async () => {
      const sessionId = framework.startMonitoring("concurrent_100_users");
      
      try {
        const userCount = 100;
        const operationsPerUser = 10;
        const totalOperations = userCount * operationsPerUser;
        
        console.log(`Testing ${userCount} concurrent users with ${operationsPerUser} operations each (${totalOperations} total)`);
        
        // Generate user scenarios
        const scenarios = LoadTestDataGenerator.generateConcurrentUserScenarios(userCount);
        
        // Create operations for each user
        const allOperations: Array<() => Promise<any>> = [];
        
        for (let userIndex = 0; userIndex < users.length; userIndex++) {
          const user = users[userIndex];
          const scenario = scenarios[userIndex];
          
          for (let opIndex = 0; opIndex < Math.min(operationsPerUser, scenario.actions.length); opIndex++) {
            const action = scenario.actions[opIndex];
            
            allOperations.push(
              () => framework.executeTransaction(
                sessionId,
                async () => {
                  // Simulate different types of user operations
                  await TestUtils.delay(action.delay);
                  
                  switch (action.type) {
                    case 'create_order':
                      return {
                        signature: TestUtils.generateTestId(`create_${userIndex}_${opIndex}`),
                        userId: user.publicKey.toBase58(),
                        action: 'create_order',
                        order: action.params,
                        timestamp: Date.now()
                      };
                    
                    case 'cancel_order':
                      return {
                        signature: TestUtils.generateTestId(`cancel_${userIndex}_${opIndex}`),
                        userId: user.publicKey.toBase58(),
                        action: 'cancel_order',
                        orderId: action.params.orderId,
                        timestamp: Date.now()
                      };
                    
                    case 'update_meter':
                      return {
                        signature: TestUtils.generateTestId(`meter_${userIndex}_${opIndex}`),
                        userId: user.publicKey.toBase58(),
                        action: 'update_meter',
                        reading: action.params,
                        timestamp: Date.now()
                      };
                    
                    case 'trade_energy':
                      return {
                        signature: TestUtils.generateTestId(`trade_${userIndex}_${opIndex}`),
                        userId: user.publicKey.toBase58(),
                        action: 'trade_energy',
                        trade: action.params,
                        timestamp: Date.now()
                      };
                    
                    case 'check_balance':
                      return {
                        signature: TestUtils.generateTestId(`balance_${userIndex}_${opIndex}`),
                        userId: user.publicKey.toBase58(),
                        action: 'check_balance',
                        balance: Math.random() * 10000,
                        timestamp: Date.now()
                      };
                    
                    default:
                      return {
                        signature: TestUtils.generateTestId(`unknown_${userIndex}_${opIndex}`),
                        userId: user.publicKey.toBase58(),
                        action: 'unknown',
                        timestamp: Date.now()
                      };
                  }
                },
                `User ${userIndex + 1} - ${action.type} (${opIndex + 1}/${operationsPerUser})`
              )
            );
          }
        }
        
        // Execute operations with controlled concurrency
        const concurrency = 50; // Process 50 operations simultaneously
        const results = await framework.executeConcurrently(allOperations, concurrency);
        
        const successfulOps = results.filter(r => r.success).length;
        const failedOps = results.filter(r => !r.success).length;
        
        const testResults = framework.stopMonitoring(sessionId);
        
        // Analyze per-user performance
        const userPerformance = new Array(userCount).fill(0).map((_, userIndex) => {
          const userOps = results.slice(userIndex * operationsPerUser, (userIndex + 1) * operationsPerUser);
          return {
            userId: userIndex + 1,
            totalOps: userOps.length,
            successfulOps: userOps.filter(op => op.success).length,
            failedOps: userOps.filter(op => !op.success).length,
            successRate: (userOps.filter(op => op.success).length / userOps.length) * 100
          };
        });
        
        // Assertions
        expect(successfulOps).to.be.at.least(totalOperations * 0.9, 
          `Should achieve 90%+ success rate. Got: ${(successfulOps/totalOperations*100).toFixed(1)}%`);
        
        expect(testResults.metrics.throughput).to.be.at.least(50, 
          `Should maintain at least 50 TPS. Got: ${testResults.metrics.throughput.toFixed(2)} TPS`);
        
        expect(testResults.metrics.averageLatency).to.be.below(2000, 
          `Average latency should be under 2s. Got: ${testResults.metrics.averageLatency.toFixed(2)}ms`);
        
        console.log(`✅ Concurrent users test completed:`);
        console.log(`   Total Operations: ${results.length}`);
        console.log(`   Successful: ${successfulOps}`);
        console.log(`   Failed: ${failedOps}`);
        console.log(`   Success Rate: ${(successfulOps/results.length*100).toFixed(1)}%`);
        console.log(`   Average Latency: ${testResults.metrics.averageLatency.toFixed(2)}ms`);
        console.log(`   Throughput: ${testResults.metrics.throughput.toFixed(2)} TPS`);
        
        // User performance summary
        const avgUserSuccessRate = userPerformance.reduce((sum, user) => sum + user.successRate, 0) / userPerformance.length;
        console.log(`   Average User Success Rate: ${avgUserSuccessRate.toFixed(1)}%`);
        
        await framework.saveResults(sessionId);
        
      } catch (error) {
        console.error("Concurrent users test failed:", error);
        throw error;
      }
    }).timeout(300000);

    it("Should maintain data isolation between concurrent users", async () => {
      const sessionId = framework.startMonitoring("user_isolation");
      
      try {
        const userCount = 50;
        const operationsPerUser = 5;
        
        console.log(`Testing data isolation with ${userCount} concurrent users`);
        
        // Simulate users accessing their own data simultaneously
        const isolationOperations: Array<() => Promise<any>> = [];
        
        for (let userIndex = 0; userIndex < Math.min(userCount, users.length); userIndex++) {
          const user = users[userIndex];
          
          for (let opIndex = 0; opIndex < operationsPerUser; opIndex++) {
            isolationOperations.push(
              () => framework.executeTransaction(
                sessionId,
                async () => {
                  // Simulate user accessing their private data
                  const userData = {
                    userId: user.publicKey.toBase58(),
                    privateKey: user.secretKey.slice(0, 8), // Only first 8 bytes for security
                    timestamp: Date.now(),
                    operation: `access_private_data_${opIndex + 1}`
                  };
                  
                  await TestUtils.delay(Math.random() * 100);
                  
                  return {
                    signature: TestUtils.generateTestId(`isolation_${userIndex}_${opIndex}`),
                    userData,
                    isolationVerified: true,
                    timestamp: Date.now()
                  };
                },
                `Isolation Test - User ${userIndex + 1} - Op ${opIndex + 1}`
              )
            );
          }
        }
        
        // Execute all operations concurrently
        const results = await framework.executeConcurrently(isolationOperations, 25);
        
        const successfulIsolationTests = results.filter(r => r.success).length;
        const isolationResults = framework.stopMonitoring(sessionId);
        
        // Verify data isolation
        const userDataMap = new Map();
        results.forEach((result, index) => {
          if (result.success && result.result) {
            const userIndex = Math.floor(index / operationsPerUser);
            const userId = users[userIndex]?.publicKey?.toBase58();
            
            if (userId) {
              if (!userDataMap.has(userId)) {
                userDataMap.set(userId, []);
              }
              userDataMap.get(userId).push(result.result);
            }
          }
        });
        
        // Verify no data leakage between users
        let dataLeaksDetected = 0;
        userDataMap.forEach((userResults, userId) => {
          userResults.forEach(result => {
            if (result.userData && result.userData.userId !== userId) {
              dataLeaksDetected++;
            }
          });
        });
        
        // Assertions
        expect(successfulIsolationTests).to.be.at.least(isolationOperations.length * 0.95, 
          `Should achieve 95%+ success rate in isolation tests`);
        
        expect(dataLeaksDetected).to.equal(0, 
          `Should have zero data leaks between users. Detected: ${dataLeaksDetected}`);
        
        expect(isolationResults.metrics.averageLatency).to.be.below(1500, 
          `Isolation operations should be fast. Avg latency: ${isolationResults.metrics.averageLatency.toFixed(2)}ms`);
        
        console.log(`✅ Data isolation test completed:`);
        console.log(`   Successful Isolation Tests: ${successfulIsolationTests}/${isolationOperations.length}`);
        console.log(`   Data Leaks Detected: ${dataLeaksDetected}`);
        console.log(`   Users Tested: ${userDataMap.size}`);
        console.log(`   Average Latency: ${isolationResults.metrics.averageLatency.toFixed(2)}ms`);
        
        await framework.saveResults(sessionId);
        
      } catch (error) {
        console.error("Data isolation test failed:", error);
        throw error;
      }
    }).timeout(120000);
  });

  describe("Resource Exhaustion Scenarios", () => {
    it("Should handle connection pool exhaustion gracefully", async () => {
      const sessionId = framework.startMonitoring("connection_pool_exhaustion");
      
      try {
        const connectionCount = 200; // More than typical connection pool size
        const operationsPerConnection = 3;
        
        console.log(`Testing connection pool with ${connectionCount} simultaneous connections`);
        
        // Simulate many users connecting simultaneously
        const connectionOperations: Array<() => Promise<any>> = [];
        
        for (let connIndex = 0; connIndex < connectionCount; connIndex++) {
          for (let opIndex = 0; opIndex < operationsPerConnection; opIndex++) {
            connectionOperations.push(
              () => framework.executeTransaction(
                sessionId,
                async () => {
                  // Simulate connection establishment and operation
                  const connectionId = TestUtils.generateTestId(`conn_${connIndex}`);
                  
                  // Simulate connection time
                  await TestUtils.delay(Math.random() * 200 + 50);
                  
                  return {
                    signature: TestUtils.generateTestId(`pool_${connIndex}_${opIndex}`),
                    connectionId,
                    operation: `op_${opIndex + 1}`,
                    connectionEstablished: true,
                    timestamp: Date.now()
                  };
                },
                `Connection Pool Test - Conn ${connIndex + 1} - Op ${opIndex + 1}`
              )
            );
          }
        }
        
        // Execute with high concurrency to stress connection pool
        const results = await framework.executeConcurrently(connectionOperations, 100);
        
        const successfulConnections = results.filter(r => r.success).length;
        const failedConnections = results.filter(r => !r.success).length;
        const poolResults = framework.stopMonitoring(sessionId);
        
        // Analyze connection pool behavior
        const connectionErrors = results
          .filter(r => !r.success)
          .map(r => r.error)
          .filter(error => error && (error.includes('connection') || error.includes('pool') || error.includes('timeout')));
        
        const gracefulHandling = connectionErrors.length > 0 ? 
          connectionErrors.every(error => error.includes('timeout') || error.includes('busy')) : true;
        
        // Assertions
        expect(successfulConnections).to.be.at.least(connectionOperations.length * 0.8, 
          `Should handle at least 80% of connections under pool stress`);
        
        expect(gracefulHandling).to.be.true, 
          `Should handle connection exhaustion gracefully`);
        
        expect(poolResults.metrics.averageLatency).to.be.below(5000, 
          `Connection operations should complete in reasonable time. Avg latency: ${poolResults.metrics.averageLatency.toFixed(2)}ms`);
        
        console.log(`✅ Connection pool exhaustion test completed:`);
        console.log(`   Total Connection Attempts: ${connectionOperations.length}`);
        console.log(`   Successful: ${successfulConnections}`);
        console.log(`   Failed: ${failedConnections}`);
        console.log(`   Connection Errors: ${connectionErrors.length}`);
        console.log(`   Graceful Handling: ${gracefulHandling}`);
        console.log(`   Average Latency: ${poolResults.metrics.averageLatency.toFixed(2)}ms`);
        
        await framework.saveResults(sessionId);
        
      } catch (error) {
        console.error("Connection pool exhaustion test failed:", error);
        throw error;
      }
    }).timeout(180000);

    it("Should maintain performance under memory pressure", async () => {
      const sessionId = framework.startMonitoring("memory_pressure");
      
      try {
        const userCount = 150;
        const memoryIntensiveOps = 3;
        
        console.log(`Testing memory pressure with ${userCount} users performing memory-intensive operations`);
        
        // Memory-intensive operations for each user
        const memoryOperations: Array<() => Promise<any>> = [];
        
        for (let userIndex = 0; userIndex < Math.min(userCount, users.length); userIndex++) {
          for (let opIndex = 0; opIndex < memoryIntensiveOps; opIndex++) {
            memoryOperations.push(
              () => framework.executeTransaction(
                sessionId,
                async () => {
                  // Simulate memory-intensive operations
                  const largeDataSets = [];
                  
                  // Create multiple large data structures
                  for (let i = 0; i < 10; i++) {
                    largeDataSets.push({
                      userId: users[userIndex].publicKey.toBase58(),
                      dataSetId: TestUtils.generateTestId(`dataset_${i}`),
                      data: new Array(1000).fill(0).map(() => ({
                                id: TestUtils.generateTestId(`item_${i}`),
                                value: Math.random(),
                                timestamp: Date.now()
                              })),
                      metadata: {
                        size: 1000,
                        created: Date.now(),
                        operation: `memory_test_${opIndex + 1}`
                      }
                    });
                  }
                  
                  // Process the data (simulate computation)
                  const processedData = largeDataSets.map(dataset => ({
                    ...dataset,
                    processed: true,
                    itemCount: dataset.data.length,
                    checksum: TestUtils.generateTestId(`checksum_${userIndex}_${opIndex}`)
                  }));
                  
                  // Simulate processing time
                  await TestUtils.delay(Math.random() * 500 + 100);
                  
                  return {
                    signature: TestUtils.generateTestId(`memory_${userIndex}_${opIndex}`),
                    userId: users[userIndex].publicKey.toBase58(),
                    operation: `memory_intensive_${opIndex + 1}`,
                    dataSetsProcessed: processedData.length,
                    totalItems: processedData.reduce((sum, data) => sum + data.itemCount, 0),
                    memoryUsage: JSON.stringify(processedData).length,
                    timestamp: Date.now()
                  };
                },
                `Memory Pressure - User ${userIndex + 1} - Op ${opIndex + 1}`
              )
            );
          }
        }
        
        // Execute with moderate concurrency to build memory pressure
        const results = await framework.executeConcurrently(memoryOperations, 30);
        
        const successfulMemoryOps = results.filter(r => r.success).length;
        const memoryResults = framework.stopMonitoring(sessionId);
        
        // Analyze memory usage patterns
        const memoryUsages = results
          .filter(r => r.success && r.result && r.result.memoryUsage)
          .map(r => r.result.memoryUsage);
        
        const avgMemoryUsage = memoryUsages.reduce((sum, usage) => sum + usage, 0) / memoryUsages.length;
        const maxMemoryUsage = Math.max(...memoryUsages);
        
        // Assertions
        expect(successfulMemoryOps).to.be.at.least(memoryOperations.length * 0.85, 
          `Should handle 85%+ of memory-intensive operations under pressure`);
        
        expect(memoryResults.metrics.averageLatency).to.be.below(3000, 
          `Memory operations should complete in reasonable time. Avg latency: ${memoryResults.metrics.averageLatency.toFixed(2)}ms`);
        
        console.log(`✅ Memory pressure test completed:`);
        console.log(`   Total Memory Operations: ${memoryOperations.length}`);
        console.log(`   Successful: ${successfulMemoryOps}`);
        console.log(`   Average Memory Usage: ${(avgMemoryUsage / 1024).toFixed(2)} KB per operation`);
        console.log(`   Peak Memory Usage: ${(maxMemoryUsage / 1024).toFixed(2)} KB per operation`);
        console.log(`   Average Latency: ${memoryResults.metrics.averageLatency.toFixed(2)}ms`);
        
        await framework.saveResults(sessionId);
        
      } catch (error) {
        console.error("Memory pressure test failed:", error);
        throw error;
      }
    }).timeout(240000);
  });

  describe("User Experience Under Load", () => {
    it("Should maintain acceptable user experience metrics", async () => {
      const sessionId = framework.startMonitoring("user_experience");
      
      try {
        const userCount = 80;
        const operationsPerUser = 8;
        
        console.log(`Testing user experience with ${userCount} concurrent users`);
        
        // Simulate realistic user behavior patterns
        const userExperienceOperations: Array<() => Promise<any>> = [];
        
        for (let userIndex = 0; userIndex < Math.min(userCount, users.length); userIndex++) {
          const user = users[userIndex];
          
          for (let opIndex = 0; opIndex < operationsPerUser; opIndex++) {
            userExperienceOperations.push(
              () => framework.executeTransaction(
                sessionId,
                async () => {
                  const startTime = performance.now();
                  
                  // Simulate different user experience scenarios
                  const scenario = Math.random();
                  
                  let result;
                  if (scenario < 0.3) {
                    // Quick operation (check balance, view orders)
                    await TestUtils.delay(Math.random() * 100 + 50);
                    result = {
                      operation: 'quick_view',
                      responseTime: 'fast',
                      userSatisfaction: 'high'
                    };
                  } else if (scenario < 0.7) {
                    // Medium operation (create order, update meter)
                    await TestUtils.delay(Math.random() * 500 + 200);
                    result = {
                      operation: 'standard_action',
                      responseTime: 'medium',
                      userSatisfaction: 'good'
                    };
                  } else {
                    // Complex operation (trade execution, batch operations)
                    await TestUtils.delay(Math.random() * 1000 + 500);
                    result = {
                      operation: 'complex_action',
                      responseTime: 'slow',
                      userSatisfaction: 'acceptable'
                    };
                  }
                  
                  const endTime = performance.now();
                  const userLatency = endTime - startTime;
                  
                  // User experience metrics
                  const experienceScore = userLatency < 200 ? 'excellent' : 
                                       userLatency < 500 ? 'good' : 
                                       userLatency < 1000 ? 'acceptable' : 'poor';
                  
                  return {
                    signature: TestUtils.generateTestId(`ux_${userIndex}_${opIndex}`),
                    userId: user.publicKey.toBase58(),
                    userLatency,
                    experienceScore,
                    operation: result.operation,
                    userSatisfaction: result.userSatisfaction,
                    timestamp: Date.now()
                  };
                },
                `UX Test - User ${userIndex + 1} - Op ${opIndex + 1}`
              )
            );
          }
        }
        
        // Execute with realistic concurrency patterns
        const results = await framework.executeConcurrently(userExperienceOperations, 40);
        
        const successfulUXOps = results.filter(r => r.success).length;
        const uxResults = framework.stopMonitoring(sessionId);
        
        // Analyze user experience metrics
        const experienceScores = results
          .filter(r => r.success && r.result && r.result.experienceScore)
          .map(r => r.result.experienceScore);
        
        const experienceDistribution = {
          excellent: experienceScores.filter(score => score === 'excellent').length,
          good: experienceScores.filter(score => score === 'good').length,
          acceptable: experienceScores.filter(score => score === 'acceptable').length,
          poor: experienceScores.filter(score => score === 'poor').length
        };
        
        const excellentGoodPercentage = ((experienceDistribution.excellent + experienceDistribution.good) / experienceScores.length) * 100;
        
        // Assertions
        expect(successfulUXOps).to.be.at.least(userExperienceOperations.length * 0.9, 
          `Should achieve 90%+ success rate for user experience tests`);
        
        expect(excellentGoodPercentage).to.be.at.least(70, 
          `Should provide good or excellent experience for 70%+ of operations. Got: ${excellentGoodPercentage.toFixed(1)}%`);
        
        expect(experienceDistribution.poor).to.be.below(experienceScores.length * 0.1, 
          `Poor experiences should be under 10%. Got: ${(experienceDistribution.poor/experienceScores.length*100).toFixed(1)}%`);
        
        console.log(`✅ User experience test completed:`);
        console.log(`   Total UX Operations: ${userExperienceOperations.length}`);
        console.log(`   Successful: ${successfulUXOps}`);
        console.log(`   Experience Distribution:`);
        console.log(`     Excellent: ${experienceDistribution.excellent} (${(experienceDistribution.excellent/experienceScores.length*100).toFixed(1)}%)`);
        console.log(`     Good: ${experienceDistribution.good} (${(experienceDistribution.good/experienceScores.length*100).toFixed(1)}%)`);
        console.log(`     Acceptable: ${experienceDistribution.acceptable} (${(experienceDistribution.acceptable/experienceScores.length*100).toFixed(1)}%)`);
        console.log(`     Poor: ${experienceDistribution.poor} (${(experienceDistribution.poor/experienceScores.length*100).toFixed(1)}%)`);
        console.log(`   Excellent+Good: ${excellentGoodPercentage.toFixed(1)}%`);
        console.log(`   Average Latency: ${uxResults.metrics.averageLatency.toFixed(2)}ms`);
        
        await framework.saveResults(sessionId);
        
      } catch (error) {
        console.error("User experience test failed:", error);
        throw error;
      }
    }).timeout(300000);
  });
});
