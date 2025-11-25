/**
 * Advanced Load Testing Framework for GridTokenX
 * Provides comprehensive load testing capabilities for P2P energy trading platform
 */

import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { TestUtils } from "../utils/index.js";

export interface LoadTestConfig {
  concurrentUsers: number;
  duration: number; // in seconds
  rampUpTime: number; // in seconds
  transactionsPerSecond: number;
  testType: 'trading' | 'energy-transfer' | 'registry' | 'governance';
  networkConditions?: NetworkConditions;
  resourceMonitoring?: boolean;
}

export interface NetworkConditions {
  latency: number; // in ms
  packetLoss: number; // percentage 0-100
  bandwidth: number; // in Mbps
  jitter: number; // in ms
}

export interface LoadTestMetrics {
  totalTransactions: number;
  successfulTransactions: number;
  failedTransactions: number;
  averageLatency: number;
  p95Latency: number;
  p99Latency: number;
  throughput: number; // transactions per second
  errorRate: number; // percentage
  memoryUsage: MemoryUsage;
  cpuUsage: number;
  networkMetrics?: NetworkMetrics;
  resourceEfficiency?: ResourceEfficiency;
}

export interface NetworkMetrics {
  actualLatency: number;
  packetLossRate: number;
  bandwidthUtilization: number;
  connectionErrors: number;
  timeoutErrors: number;
}

export interface ResourceEfficiency {
  computeUnitsPerTransaction: number;
  memoryEfficiency: number;
  costPerTransaction: number;
  resourceUtilizationScore: number;
}

export interface MemoryUsage {
  used: number;
  total: number;
  percentage: number;
  peakUsage: number;
  leakDetection?: MemoryLeakDetection;
}

export interface MemoryLeakDetection {
  suspectedLeaks: number;
  leakRate: number; // MB per hour
  criticalThreshold: boolean;
}

export interface UserSimulation {
  userId: string;
  wallet: Keypair;
  connection: Connection;
  startTime: number;
  transactionCount: number;
  errors: number;
  latencies: number[];
  lastActivity: number;
  status: 'active' | 'idle' | 'error' | 'completed';
}

/**
 * Load Test Framework
 * Orchestrates complex load testing scenarios with real-time monitoring
 */
export class LoadTestFramework {
  private connection: Connection;
  private provider: anchor.AnchorProvider;
  private activeUsers: Map<string, UserSimulation> = new Map();
  private metrics: LoadTestMetrics;
  private startTime: number = 0;
  private monitoringInterval?: NodeJS.Timeout;
  private memoryBaseline: number = 0;
  private latencyMeasurements: number[] = [];
  private testResults: Map<string, any> = new Map();

  constructor(connection?: Connection) {
    this.connection = connection || new Connection("http://localhost:8899", "confirmed");
    const wallet = Keypair.generate();
    this.provider = new anchor.AnchorProvider(this.connection, new anchor.Wallet(wallet), {
      commitment: "confirmed",
      preflightCommitment: "confirmed"
    });
    
    this.metrics = this.initializeMetrics();
  }

  /**
   * Execute a comprehensive load test with enhanced monitoring
   */
  async runLoadTest(config: LoadTestConfig): Promise<LoadTestMetrics> {
    console.log(`🚀 Starting enhanced load test: ${config.testType} with ${config.concurrentUsers} users`);
    console.log(`📊 Target: ${config.transactionsPerSecond} TPS for ${config.duration}s`);
    
    if (config.networkConditions) {
      console.log(`🌐 Network conditions: ${config.networkConditions.latency}ms latency, ${config.networkConditions.packetLoss}% packet loss`);
    }
    
    this.startTime = Date.now();
    this.metrics = this.initializeMetrics();
    this.memoryBaseline = await this.getMemoryUsage();
    
    try {
      // Start resource monitoring
      if (config.resourceMonitoring) {
        this.startResourceMonitoring();
      }
      
      // Phase 1: User ramp-up
      await this.rampUpUsers(config);
      
      // Phase 2: Sustained load testing
      await this.sustainLoad(config);
      
      // Phase 3: Graceful shutdown
      await this.rampDownUsers();
      
      // Stop monitoring and calculate final metrics
      this.stopResourceMonitoring();
      const finalMetrics = await this.calculateFinalMetrics();
      
      console.log("✅ Enhanced load test completed successfully");
      console.log(`📈 Final throughput: ${finalMetrics.throughput} TPS`);
      console.log(`⏱️  Average latency: ${finalMetrics.averageLatency}ms`);
      console.log(`🚨 Error rate: ${finalMetrics.errorRate}%`);
      
      if (finalMetrics.resourceEfficiency) {
        console.log(`💰 Cost per transaction: $${finalMetrics.resourceEfficiency.costPerTransaction}`);
        console.log(`⚡ CU efficiency: ${finalMetrics.resourceEfficiency.computeUnitsPerTransaction} CU/tx`);
      }
      
      if (finalMetrics.memoryUsage.leakDetection) {
        console.log(`🔍 Memory leak detection: ${finalMetrics.memoryUsage.leakDetection.suspectedLeaks} potential leaks`);
      }
      
      return finalMetrics;
      
    } catch (error) {
      this.stopResourceMonitoring();
      console.error("❌ Enhanced load test failed:", error);
      throw error;
    }
  }

  /**
   * Start performance monitoring for a test
   */
  startMonitoring(testName: string): string {
    const sessionId = TestUtils.generateTestId(`load_${testName}`);
    
    this.testResults.set(sessionId, {
      testName,
      startTime: Date.now(),
      startMemory: this.getMemoryUsage(),
      transactions: [],
      errors: [],
      metrics: {
        totalTransactions: 0,
        successfulTransactions: 0,
        failedTransactions: 0,
        averageLatency: 0,
        maxLatency: 0,
        minLatency: Infinity,
        throughput: 0
      }
    });

    return sessionId;
  }

  /**
   * Stop monitoring and generate report
   */
  stopMonitoring(sessionId: string): any {
    const result = this.testResults.get(sessionId);
    if (!result) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const endTime = Date.now();
    const endMemory = this.getMemoryUsage();
    const duration = endTime - result.startTime;

    // Calculate final metrics
    const metrics = result.metrics;
    metrics.averageLatency = this.calculateAverageLatency(result.transactions);
    metrics.throughput = (metrics.successfulTransactions / duration) * 1000; // TPS
    metrics.duration = duration;
    metrics.memoryDelta = endMemory - result.startMemory;
    metrics.peakMemory = this.getPeakMemory(result);

    const finalResult = {
      ...result,
      endTime,
      endMemory,
      duration,
      metrics
    };

    this.testResults.set(sessionId, finalResult);
    return finalResult;
  }

  /**
   * Create multiple concurrent users for testing
   */
  async createConcurrentUsers(count: number, solAmount: number = 5): Promise<Keypair[]> {
    const users: Keypair[] = [];
    
    for (let i = 0; i < count; i++) {
      const user = await TestUtils.createFundedKeypair(this.connection, solAmount);
      users.push(user);
    }

    return users;
  }

  /**
   * Execute operations concurrently with controlled concurrency
   */
  async executeConcurrently<T>(
    operations: (() => Promise<T>)[],
    concurrency: number = 10
  ): Promise<Array<{ success: boolean; result?: T; error?: string }>> {
    const results: Array<{ success: boolean; result?: T; error?: string }> = [];
    
    for (let i = 0; i < operations.length; i += concurrency) {
      const batch = operations.slice(i, i + concurrency);
      const batchPromises = batch.map(async (op, index) => {
        try {
          const result = await op();
          return { success: true, result, index: i + index };
        } catch (error: any) {
          return { success: false, error: error.message, index: i + index };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Simulate network conditions with delays and failures
   */
  async simulateNetworkConditions(
    operation: () => Promise<any>,
    options: {
      latency?: number;
      packetLoss?: number;
      timeout?: number;
    } = {}
  ): Promise<any> {
    const { latency = 0, packetLoss = 0, timeout = 30000 } = options;

    // Simulate packet loss
    if (packetLoss > 0 && Math.random() < packetLoss) {
      throw new Error(`Simulated packet loss (${(packetLoss * 100).toFixed(1)}% chance)`);
    }

    // Simulate latency
    if (latency > 0) {
      await TestUtils.delay(latency);
    }

    // Execute with timeout
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Operation timeout after ${timeout}ms`)), timeout);
    });

    try {
      return await Promise.race([operation(), timeoutPromise]);
    } catch (error: any) {
      throw error;
    }
  }

  /**
   * Execute a single transaction with latency tracking
   */
  async executeTransaction(
    operation: () => Promise<any>,
    operationType: string = "unknown"
  ): Promise<{ success: boolean; result?: any; latency: number; error?: string }> {
    const startTime = Date.now();
    
    try {
      const result = await operation();
      const latency = Date.now() - startTime;
      
      this.latencyMeasurements.push(latency);
      
      return {
        success: true,
        result,
        latency
      };
    } catch (error: any) {
      const latency = Date.now() - startTime;
      
      return {
        success: false,
        error: error.message,
        latency
      };
    }
  }

  /**
   * Save test results to storage
   */
  async saveResults(sessionId: string, results: any): Promise<void> {
    const reportsDir = './test-results/load';
    const filename = `load-test-results-${Date.now()}.json`;
    const filepath = `${reportsDir}/${filename}`;
    
    try {
      await TestUtils.ensureDirectoryExists(reportsDir);
      await TestUtils.writeJsonFile(filepath, results);
      console.log(`📄 Load test results saved to: ${filepath}`);
    } catch (error: any) {
      console.error(`❌ Failed to save results: ${error.message}`);
    }
  }

  /**
   * Monitor memory usage during testing
   */
  getMemoryUsage(): number {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      return process.memoryUsage().heapUsed;
    }
    return 0;
  }

  // Private helper methods
  private initializeMetrics(): LoadTestMetrics {
    return {
      totalTransactions: 0,
      successfulTransactions: 0,
      failedTransactions: 0,
      averageLatency: 0,
      p95Latency: 0,
      p99Latency: 0,
      throughput: 0,
      errorRate: 0,
      memoryUsage: {
        used: 0,
        total: 0,
        percentage: 0,
        peakUsage: 0
      },
      cpuUsage: 0
    };
  }

  private async rampUpUsers(config: LoadTestConfig): Promise<void> {
    console.log(`📈 Ramp-up phase: Adding ${config.concurrentUsers} users over ${config.rampUpTime}s`);
    
    const users = await this.createConcurrentUsers(config.concurrentUsers);
    const rampUpInterval = config.rampUpTime * 1000 / config.concurrentUsers;
    
    for (let i = 0; i < users.length; i++) {
      const user: UserSimulation = {
        userId: `user_${i}`,
        wallet: users[i],
        connection: this.connection,
        startTime: Date.now(),
        transactionCount: 0,
        errors: 0,
        latencies: [],
        lastActivity: Date.now(),
        status: 'active'
      };
      
      this.activeUsers.set(user.userId, user);
      
      if (i < users.length - 1) {
        await TestUtils.delay(rampUpInterval);
      }
    }
    
    console.log(`✅ Ramp-up completed: ${this.activeUsers.size} active users`);
  }

  private async sustainLoad(config: LoadTestConfig): Promise<void> {
    console.log(`⏳ Sustained load phase: ${config.duration}s at ${config.transactionsPerSecond} TPS`);
    
    const endTime = Date.now() + (config.duration * 1000);
    const targetInterval = 1000 / config.transactionsPerSecond;
    
    while (Date.now() < endTime) {
      const promises: Promise<any>[] = [];
      
      for (const [userId, user] of this.activeUsers) {
        if (user.status === 'active') {
          promises.push(this.executeUserOperation(user, config.testType));
        }
      }
      
      if (promises.length > 0) {
        await Promise.allSettled(promises);
      }
      
      await TestUtils.delay(Math.min(targetInterval, 100));
    }
    
    console.log(`✅ Sustained load phase completed`);
  }

  private async rampDownUsers(): Promise<void> {
    console.log(`📉 Ramp-down phase: Gracefully stopping all users`);
    
    for (const [userId, user] of this.activeUsers) {
      user.status = 'completed';
      user.lastActivity = Date.now();
    }
    
    this.activeUsers.clear();
    console.log(`✅ All users stopped gracefully`);
  }

  private async executeUserOperation(user: UserSimulation, testType: string): Promise<void> {
    try {
      const startTime = Date.now();
      
      switch (testType) {
        case 'trading':
          await this.executeTradingOperation(user);
          break;
        case 'energy-transfer':
          await this.executeEnergyTransferOperation(user);
          break;
        case 'registry':
          await this.executeRegistryOperation(user);
          break;
        case 'governance':
          await this.executeGovernanceOperation(user);
          break;
      }
      
      const latency = Date.now() - startTime;
      user.latencies.push(latency);
      user.transactionCount++;
      user.lastActivity = Date.now();
      
    } catch (error: any) {
      user.errors++;
      user.status = 'error';
      console.error(`User ${user.userId} operation failed: ${error.message}`);
    }
  }

  private async executeTradingOperation(user: UserSimulation): Promise<void> {
    // Simulate trading operation
    const orderData = TestUtils.generateTradingData();
    // Implementation would call actual trading program
    await TestUtils.delay(Math.random() * 100 + 50); // Simulate processing time
  }

  private async executeEnergyTransferOperation(user: UserSimulation): Promise<void> {
    // Simulate energy transfer operation
    const transferData = TestUtils.generateEnergyTransferData();
    // Implementation would call actual energy token program
    await TestUtils.delay(Math.random() * 80 + 30); // Simulate processing time
  }

  private async executeRegistryOperation(user: UserSimulation): Promise<void> {
    // Simulate registry operation
    const registryData = TestUtils.generateRegistryData();
    // Implementation would call actual registry program
    await TestUtils.delay(Math.random() * 60 + 20); // Simulate processing time
  }

  private async executeGovernanceOperation(user: UserSimulation): Promise<void> {
    // Simulate governance operation
    const governanceData = TestUtils.generateGovernanceData();
    // Implementation would call actual governance program
    await TestUtils.delay(Math.random() * 120 + 40); // Simulate processing time
  }

  private startResourceMonitoring(): void {
    this.monitoringInterval = setInterval(() => {
      const currentMemory = this.getMemoryUsage();
      this.metrics.memoryUsage.used = currentMemory;
      this.metrics.memoryUsage.peakUsage = Math.max(this.metrics.memoryUsage.peakUsage, currentMemory);
      this.metrics.memoryUsage.percentage = (currentMemory / this.memoryBaseline) * 100;
    }, 1000); // Monitor every second
  }

  private stopResourceMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
  }

  private async calculateFinalMetrics(): Promise<LoadTestMetrics> {
    const allLatencies = Array.from(this.activeUsers.values())
      .flatMap(user => user.latencies)
      .concat(this.latencyMeasurements);
    
    if (allLatencies.length > 0) {
      allLatencies.sort((a, b) => a - b);
      
      this.metrics.averageLatency = allLatencies.reduce((sum, lat) => sum + lat, 0) / allLatencies.length;
      this.metrics.p95Latency = allLatencies[Math.floor(allLatencies.length * 0.95)];
      this.metrics.p99Latency = allLatencies[Math.floor(allLatencies.length * 0.99)];
    }
    
    const totalTransactions = Array.from(this.activeUsers.values())
      .reduce((sum, user) => sum + user.transactionCount, 0) + this.latencyMeasurements.length;
    
    const totalErrors = Array.from(this.activeUsers.values())
      .reduce((sum, user) => sum + user.errors, 0);
    
    this.metrics.totalTransactions = totalTransactions;
    this.metrics.successfulTransactions = totalTransactions - totalErrors;
    this.metrics.failedTransactions = totalErrors;
    this.metrics.errorRate = totalTransactions > 0 ? (totalErrors / totalTransactions) * 100 : 0;
    
    const duration = (Date.now() - this.startTime) / 1000; // in seconds
    this.metrics.throughput = duration > 0 ? this.metrics.successfulTransactions / duration : 0;
    
    // Calculate resource efficiency
    this.metrics.resourceEfficiency = {
      computeUnitsPerTransaction: 15000, // Placeholder - would calculate actual CU usage
      memoryEfficiency: this.metrics.memoryUsage.percentage,
      costPerTransaction: 0.0001, // Placeholder - would calculate actual cost
      resourceUtilizationScore: this.metrics.memoryUsage.percentage
    };
    
    // Memory leak detection
    const currentMemory = this.getMemoryUsage();
    const memoryIncrease = currentMemory - this.memoryBaseline;
    const testDurationHours = duration / 3600;
    
    this.metrics.memoryUsage.leakDetection = {
      suspectedLeaks: memoryIncrease > 100 * 1024 * 1024, // 100MB increase
      leakRate: testDurationHours > 0 ? memoryIncrease / testDurationHours : 0,
      criticalThreshold: memoryIncrease > 500 * 1024 * 1024 // 500MB increase
    };
    
    return this.metrics;
  }

  private calculateAverageLatency(transactions: any[]): number {
    if (transactions.length === 0) return 0;
    
    const successfulTransactions = transactions.filter(t => t.success);
    if (successfulTransactions.length === 0) return 0;
    
    const totalLatency = successfulTransactions.reduce((sum, t) => sum + t.latency, 0);
    return totalLatency / successfulTransactions.length;
  }

  private getPeakMemory(result: any): number {
    // In a real implementation, this would track memory over time
    // For now, return end memory as an approximation
    return result.endMemory || 0;
  }
}

/**
 * Load test data generator
 */
export class LoadTestDataGenerator {
  /**
   * Generate大量交易订单
   */
  static generateTradingOrders(count: number): Array<{
    orderId: string;
    amount: number;
    price: number;
    orderType: "buy" | "sell";
  }> {
    const orders = [];
    
    for (let i = 0; i < count; i++) {
      orders.push({
        orderId: TestUtils.generateTestId(`order_${i}`),
        amount: Math.floor(Math.random() * 10000) + 100, // 100-10100 tokens
        price: parseFloat((Math.random() * 100 + 1).toFixed(2)), // 1.00-101.00
        orderType: (Math.random() > 0.5 ? "buy" : "sell") as "buy" | "sell"
      });
    }

    return orders;
  }

  /**
   * Generate energy data for multiple users
   */
  static generateEnergyData(userCount: number, readingsPerUser: number = 10): Array<{
    userId: string;
    meterId: string;
    readings: Array<{
      timestamp: number;
      generation: number;
      consumption: number;
    }>;
  }> {
    const userData = [];
    
    for (let i = 0; i < userCount; i++) {
      const userId = TestUtils.generateTestId(`user_${i}`);
      const meterId = TestUtils.generateTestId(`meter_${i}`);
      const readings = [];
      
      for (let j = 0; j < readingsPerUser; j++) {
        readings.push({
          timestamp: Date.now() - (j * 3600000), // Hourly readings going back
          generation: Math.floor(Math.random() * 1000) + 100, // 100-1100 kWh
          consumption: Math.floor(Math.random() * 800) + 50   // 50-850 kWh
        });
      }
      
      userData.push({ userId, meterId, readings });
    }

    return userData;
  }

  /**
   * Generate concurrent user scenarios
   */
  static generateConcurrentUserScenarios(userCount: number): Array<{
    userId: string;
    actions: Array<{
      type: string;
      delay: number;
      params: any;
    }>;
  }> {
    const scenarios = [];
    const actionTypes = ['create_order', 'cancel_order', 'update_meter', 'trade_energy', 'check_balance'];
    
    for (let i = 0; i < userCount; i++) {
      const actionCount = Math.floor(Math.random() * 10) + 5; // 5-15 actions per user
      const actions = [];
      
      for (let j = 0; j < actionCount; j++) {
        actions.push({
          type: actionTypes[Math.floor(Math.random() * actionTypes.length)],
          delay: Math.random() * 5000, // 0-5 seconds between actions
          params: TestUtils.generateTradingData()
        });
      }
      
      scenarios.push({
        userId: TestUtils.generateTestId(`user_${i}`),
        actions
      });
    }

    return scenarios;
  }
}
