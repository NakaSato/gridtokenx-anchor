/**
 * Load Testing Framework
 * Provides infrastructure for comprehensive load testing of GridTokenX
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Load test result interface
 */
class LoadTestResult {
  constructor(testName, success, duration, timestamp, error = null) {
    this.testName = testName;
    this.success = success;
    this.duration = duration;
    this.timestamp = timestamp;
    this.error = error;
  }
}

/**
 * Performance metrics interface
 */
class PerformanceMetrics {
  constructor() {
    this.startTime = Date.now();
    this.endTime = null;
    this.totalTransactions = 0;
    this.successfulTransactions = 0;
    this.failedTransactions = 0;
    this.latencies = [];
    this.memoryUsage = {
      initial: this.getMemoryUsage(),
      peak: 0,
      final: 0
    };
    this.cpuUsage = {
      initial: this.getCpuUsage(),
      samples: []
    };
  }

  getMemoryUsage() {
    const usage = process.memoryUsage();
    return {
      rss: usage.rss,
      heapTotal: usage.heapTotal,
      heapUsed: usage.heapUsed,
      external: usage.external,
      timestamp: Date.now()
    };
  }

  getCpuUsage() {
    const usage = process.cpuUsage();
    return {
      user: usage.user,
      system: usage.system,
      timestamp: Date.now()
    };
  }

  recordTransaction(success, latency) {
    this.totalTransactions++;
    if (success) {
      this.successfulTransactions++;
      this.latencies.push(latency);
    } else {
      this.failedTransactions++;
    }

    // Update memory usage
    const currentMemory = this.getMemoryUsage();
    if (currentMemory.heapUsed > this.memoryUsage.peak.heapUsed) {
      this.memoryUsage.peak = currentMemory;
    }

    // Sample CPU usage periodically
    if (this.totalTransactions % 10 === 0) {
      this.cpuUsage.samples.push(this.getCpuUsage());
    }
  }

  finalize() {
    this.endTime = Date.now();
    this.memoryUsage.final = this.getMemoryUsage();
  }

  get averageLatency() {
    if (this.latencies.length === 0) return 0;
    return this.latencies.reduce((sum, lat) => sum + lat, 0) / this.latencies.length;
  }

  get p95Latency() {
    if (this.latencies.length === 0) return 0;
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const index = Math.floor(sorted.length * 0.95);
    return sorted[index] || 0;
  }

  get throughput() {
    const duration = (this.endTime || Date.now()) - this.startTime;
    return (this.successfulTransactions / duration) * 1000; // TPS
  }
}

/**
 * Load Test Framework
 */
class LoadTestFramework {
  constructor(connection) {
    this.connection = connection;
    this.activeSessions = new Map();
    this.results = [];
  }

  /**
   * Start monitoring a new test session
   */
  startMonitoring(sessionId) {
    const metrics = new PerformanceMetrics();
    this.activeSessions.set(sessionId, metrics);
    
    console.log(`📊 Started monitoring session: ${sessionId}`);
    return sessionId;
  }

  /**
   * Execute a transaction and record metrics
   */
  async executeTransaction(sessionId, transactionFunction, description = 'Transaction') {
    const metrics = this.activeSessions.get(sessionId);
    if (!metrics) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const startTime = Date.now();
    let success = false;
    let result = null;
    let error = null;

    try {
      result = await transactionFunction();
      success = true;
    } catch (err) {
      error = err;
      success = false;
    }

    const latency = Date.now() - startTime;
    metrics.recordTransaction(success, latency);

    if (success) {
      return {
        success: true,
        result,
        latency,
        description
      };
    } else {
      return {
        success: false,
        error: error.message || String(error),
        latency,
        description
      };
    }
  }

  /**
   * Execute multiple transactions concurrently
   */
  async executeConcurrently(transactionFunctions, concurrency = 10) {
    const results = [];
    
    // Process in batches to control concurrency
    for (let i = 0; i < transactionFunctions.length; i += concurrency) {
      const batch = transactionFunctions.slice(i, i + concurrency);
      const batchResults = await Promise.allSettled(
        batch.map(fn => fn())
      );
      
      results.push(...batchResults.map(result => {
        if (result.status === 'fulfilled') {
          return result.value;
        } else {
          return {
            success: false,
            error: result.reason?.message || String(result.reason),
            latency: 0
          };
        }
      }));
    }
    
    return results;
  }

  /**
   * Simulate network conditions
   */
  async simulateNetworkConditions(transactionFunction, conditions = {}) {
    const {
      latency = 0,
      packetLoss = 0,
      timeout = 5000
    } = conditions;

    // Simulate packet loss
    if (Math.random() < packetLoss) {
      throw new Error('Simulated packet loss');
    }

    // Simulate network latency
    if (latency > 0) {
      await this.delay(latency);
    }

    // Execute with timeout
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Network timeout')), timeout);
    });

    try {
      return await Promise.race([transactionFunction(), timeoutPromise]);
    } catch (error) {
      throw new Error(`Network simulation error: ${error.message}`);
    }
  }

  /**
   * Create concurrent users for load testing
   */
  async createConcurrentUsers(count, solPerUser = 1) {
    const users = [];
    
    for (let i = 0; i < count; i++) {
      // Simulate user creation with wallet setup
      users.push({
        userId: `user_${i}_${Date.now()}`,
        wallet: `wallet_${i}`,
        balance: solPerUser * 1e9, // Convert to lamports
        createdAt: Date.now()
      });
    }
    
    console.log(`👥 Created ${count} concurrent users with ${solPerUser} SOL each`);
    return users;
  }

  /**
   * Stop monitoring and return results
   */
  stopMonitoring(sessionId) {
    const metrics = this.activeSessions.get(sessionId);
    if (!metrics) {
      throw new Error(`Session ${sessionId} not found`);
    }

    metrics.finalize();
    this.activeSessions.delete(sessionId);

    const result = {
      sessionId,
      metrics: {
        totalTransactions: metrics.totalTransactions,
        successfulTransactions: metrics.successfulTransactions,
        failedTransactions: metrics.failedTransactions,
        averageLatency: metrics.averageLatency,
        p95Latency: metrics.p95Latency,
        throughput: metrics.throughput,
        memoryUsage: metrics.memoryUsage,
        cpuUsage: metrics.cpuUsage,
        duration: metrics.endTime - metrics.startTime
      }
    };

    this.results.push(result);
    return result;
  }

  /**
   * Save results to file
   */
  async saveResults(sessionId, results) {
    const resultsDir = path.join(process.cwd(), 'test-results', 'load');
    
    // Ensure directory exists
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }

    const filename = `load-test-${sessionId}-${Date.now()}.json`;
    const filepath = path.join(resultsDir, filename);
    
    const reportData = {
      sessionId,
      timestamp: new Date().toISOString(),
      results,
      summary: {
        totalTransactions: results.metrics.totalTransactions,
        successRate: (results.metrics.successfulTransactions / results.metrics.totalTransactions * 100).toFixed(2) + '%',
        averageLatency: results.metrics.averageLatency.toFixed(2) + 'ms',
        p95Latency: results.metrics.p95Latency.toFixed(2) + 'ms',
        throughput: results.metrics.throughput.toFixed(2) + ' TPS',
        peakMemoryUsage: (results.metrics.memoryUsage.peak.heapUsed / 1024 / 1024).toFixed(2) + ' MB'
      }
    };

    fs.writeFileSync(filepath, JSON.stringify(reportData, null, 2));
    console.log(`💾 Results saved to: ${filepath}`);
  }

  /**
   * Delay utility
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Generate test report
   */
  generateReport() {
    const report = {
      timestamp: new Date().toISOString(),
      totalSessions: this.results.length,
      sessions: this.results,
      summary: {
        totalTransactions: this.results.reduce((sum, r) => sum + r.metrics.totalTransactions, 0),
        totalSuccessful: this.results.reduce((sum, r) => sum + r.metrics.successfulTransactions, 0),
        totalFailed: this.results.reduce((sum, r) => sum + r.metrics.failedTransactions, 0),
        averageLatency: this.results.reduce((sum, r) => sum + r.metrics.averageLatency, 0) / this.results.length,
        totalThroughput: this.results.reduce((sum, r) => sum + r.metrics.throughput, 0)
      }
    };

    return report;
  }
}

/**
 * Load Test Data Generator
 */
class LoadTestDataGenerator {
  /**
   * Generate high-volume trading scenarios
   */
  static generateHighVolumeTradingScenarios(orderCount) {
    const scenarios = [];
    
    for (let i = 0; i < orderCount; i++) {
      const type = Math.random() > 0.5 ? 'buy' : 'sell';
      const price = 1000 + Math.random() * 500; // 1000-1500 energy units
      const quantity = 100 + Math.random() * 1000; // 100-1100 kWh
      
      scenarios.push({
        orderId: `order_${i}_${Date.now()}`,
        type,
        price: Math.floor(price * 100), // Store as integer
        quantity: Math.floor(quantity * 100),
        timestamp: Date.now() + i * 10, // Staggered by 10ms
        userId: `user_${i % 100}` // Rotate through 100 users
      });
    }
    
    return scenarios;
  }

  /**
   * Generate trading orders for load testing
   */
  static generateTradingOrders(orderCount) {
    const orders = [];
    
    for (let i = 0; i < orderCount; i++) {
      const isBuy = Math.random() > 0.5;
      orders.push({
        orderId: `order_${i}_${Date.now()}`,
        orderType: isBuy ? 'buy' : 'sell',
        energyType: ['solar', 'wind', 'hydro', 'grid'][Math.floor(Math.random() * 4)],
        amount: 100 + Math.random() * 10000, // 100-10,100 kWh
        price: 0.05 + Math.random() * 0.5, // $0.05-$0.55 per kWh
        userId: `user_${Math.floor(Math.random() * 100)}`,
        timestamp: Date.now() + i * 10
      });
    }
    
    return orders;
  }

  /**
   * Generate concurrent user scenarios
   */
  static generateConcurrentUserScenarios(userCount) {
    const scenarios = [];
    const actionTypes = ['create_order', 'cancel_order', 'update_meter', 'trade_energy', 'check_balance'];
    
    for (let i = 0; i < userCount; i++) {
      const actions = [];
      const actionCount = 5 + Math.floor(Math.random() * 10); // 5-15 actions per user
      
      for (let j = 0; j < actionCount; j++) {
        actions.push({
          type: actionTypes[Math.floor(Math.random() * actionTypes.length)],
          delay: Math.random() * 1000, // 0-1s between actions
          timestamp: Date.now() + j * 1000 + Math.random() * 500
        });
      }
      
      scenarios.push({
        userId: `user_${i}`,
        actions
      });
    }
    
    return scenarios;
  }

  /**
   * Generate network condition scenarios
   */
  static generateNetworkConditionScenarios() {
    return [
      {
        name: 'high_latency',
        conditions: { latency: 500, packetLoss: 0 },
        description: 'High latency (500ms)'
      },
      {
        name: 'packet_loss',
        conditions: { latency: 100, packetLoss: 0.1 },
        description: '10% packet loss'
      },
      {
        name: 'poor_network',
        conditions: { latency: 1000, packetLoss: 0.2 },
        description: 'Poor network conditions'
      },
      {
        name: 'excellent_network',
        conditions: { latency: 10, packetLoss: 0 },
        description: 'Excellent network conditions'
      }
    ];
  }

  /**
   * Generate stress test scenarios
   */
  static generateStressTestScenarios() {
    return [
      {
        name: 'burst_load',
        duration: 60000, // 1 minute
        intensity: 100, // 100 TPS
        pattern: 'burst'
      },
      {
        name: 'sustained_load',
        duration: 300000, // 5 minutes
        intensity: 50, // 50 TPS
        pattern: 'constant'
      },
      {
        name: 'ramp_up',
        duration: 180000, // 3 minutes
        intensity: 20, // Start at 20 TPS
        pattern: 'ramp',
        maxIntensity: 100
      }
    ];
  }
}

module.exports = {
  LoadTestFramework,
  LoadTestDataGenerator,
  LoadTestResult,
  PerformanceMetrics
};
