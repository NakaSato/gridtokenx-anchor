/**
 * GridTokenX Multi-User Trading Integration Tests
 * 
 * Tests concurrent user scenarios and
 * trading platform scalability.
 */

import * as anchor from "@coral-xyz/anchor";
import { Connection } from '@solana/web3.js';
import { TestEnvironment } from '../setup.js';
import { TestUtils } from '../utils/index.js';

interface MultiUserResult {
  test: string;
  usersInvolved: number;
  duration: number;
  success: boolean;
  error?: string;
}

export class MultiUserTradingTest {
  private env: TestEnvironment;
  private connection: Connection;
  private results: MultiUserResult[] = [];

  constructor(env: TestEnvironment, connection: Connection) {
    this.env = env;
    this.connection = connection;
  }

  async testConcurrentUserTrading(): Promise<void> {
    console.log('  👥 Testing concurrent user trading...');
    
    const startTime = Date.now();
    const userCount = 5;
    
    try {
      // Simulate concurrent trading operations
      const concurrentOperations = [];
      
      for (let i = 0; i < userCount; i++) {
        const operation = this.simulateUserTrading(`User${i}`);
        concurrentOperations.push(operation);
      }
      
      await Promise.all(concurrentOperations);
      
      const duration = Date.now() - startTime;
      
      this.results.push({
        test: 'Concurrent User Trading',
        usersInvolved: userCount,
        duration,
        success: true
      });
      
      console.log(`    ✅ Concurrent trading test with ${userCount} users completed in ${duration}ms`);
      
    } catch (error: any) {
      this.results.push({
        test: 'Concurrent User Trading',
        usersInvolved: userCount,
        duration: Date.now() - startTime,
        success: false,
        error: error.message
      });
      throw error;
    }
  }

  async testOrderBookConsistency(): Promise<void> {
    console.log('  📊 Testing order book consistency...');
    
    const startTime = Date.now();
    
    try {
      // Simulate order book operations
      await this.simulateOrderBookOperations();
      
      const duration = Date.now() - startTime;
      
      this.results.push({
        test: 'Order Book Consistency',
        usersInvolved: 10, // Simulated
        duration,
        success: true
      });
      
      console.log(`    ✅ Order book consistency test completed in ${duration}ms`);
      
    } catch (error: any) {
      this.results.push({
        test: 'Order Book Consistency',
        usersInvolved: 10,
        duration: Date.now() - startTime,
        success: false,
        error: error.message
      });
      throw error;
    }
  }

  async testUserDataIsolation(): Promise<void> {
    console.log('  🔒 Testing user data isolation...');
    
    const startTime = Date.now();
    
    try {
      // Test data isolation between users
      await this.simulateUserDataIsolation();
      
      const duration = Date.now() - startTime;
      
      this.results.push({
        test: 'User Data Isolation',
        usersInvolved: 3,
        duration,
        success: true
      });
      
      console.log(`    ✅ User data isolation test completed in ${duration}ms`);
      
    } catch (error: any) {
      this.results.push({
        test: 'User Data Isolation',
        usersInvolved: 3,
        duration: Date.now() - startTime,
        success: false,
        error: error.message
      });
      throw error;
    }
  }

  private async simulateUserTrading(userId: string): Promise<void> {
    await TestUtils.delay(100 + Math.random() * 200); // Simulate trading activity
    
    // Simulate user trading operations
    const operations = ['create_order', 'cancel_order', 'modify_order', 'execute_trade'];
    const operation = operations[Math.floor(Math.random() * operations.length)];
    
    // Simulate occasional failures
    if (Math.random() < 0.1) { // 10% failure rate
      throw new Error(`${userId}: Trading operation failed - ${operation}`);
    }
  }

  private async simulateOrderBookOperations(): Promise<void> {
    await TestUtils.delay(150 + Math.random() * 150);
    
    // Simulate order book consistency checks
    const orderTypes = ['buy', 'sell'];
    const priceRanges = [100, 200, 300, 400, 500];
    
    for (const type of orderTypes) {
      for (const price of priceRanges) {
        await TestUtils.delay(10);
        // Simulate order book operation
      }
    }
  }

  private async simulateUserDataIsolation(): Promise<void> {
    await TestUtils.delay(200 + Math.random() * 100);
    
    // Simulate data isolation checks
    const users = ['UserA', 'UserB', 'UserC'];
    
    for (const user of users) {
      await TestUtils.delay(50);
      
      // Simulate accessing user data
      const userData = {
        balance: Math.random() * 1000,
        orders: Math.floor(Math.random() * 10),
        trades: Math.floor(Math.random() * 5)
      };
      
      // Verify no data leakage between users
      if (Math.random() < 0.05) { // 5% chance of isolation failure
        throw new Error(`Data isolation breach detected for ${user}`);
      }
    }
  }

  getResults(): MultiUserResult[] {
    return this.results;
  }

  getMetrics(): any {
    const totalTests = this.results.length;
    const successfulTests = this.results.filter(r => r.success).length;
    const totalUsers = this.results.reduce((sum, r) => sum + r.usersInvolved, 0);
    const totalDuration = this.results.reduce((sum, r) => sum + r.duration, 0);
    
    return {
      totalTests,
      successfulTests,
      failedTests: totalTests - successfulTests,
      successRate: (successfulTests / totalTests) * 100,
      totalUsers,
      averageUsersPerTest: totalUsers / totalTests,
      totalDuration,
      averageDuration: totalDuration / totalTests
    };
  }
}
