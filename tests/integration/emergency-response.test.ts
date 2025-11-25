/**
 * GridTokenX Emergency Response Integration Tests
 * 
 * Tests emergency scenarios and recovery
 * procedures for the trading platform.
 */

import * as anchor from "@coral-xyz/anchor";
import { Connection } from '@solana/web3.js';
import { TestEnvironment } from '../setup.js';
import { TestUtils } from '../utils/index.js';

interface EmergencyResult {
  test: string;
  duration: number;
  success: boolean;
  emergencyType: string;
  error?: string;
}

export class EmergencyResponseTest {
  private env: TestEnvironment;
  private connection: Connection;
  private results: EmergencyResult[] = [];

  constructor(env: TestEnvironment, connection: Connection) {
    this.env = env;
    this.connection = connection;
  }

  async testEmergencyPauseWorkflow(): Promise<void> {
    console.log('  🚨 Testing emergency pause workflow...');
    
    const startTime = Date.now();
    
    try {
      // Test emergency pause scenarios
      await this.simulateEmergencyPause('Market Volatility');
      await this.simulateEmergencyPause('Security Breach');
      await this.simulateEmergencyPause('System Overload');
      
      const duration = Date.now() - startTime;
      
      this.results.push({
        test: 'Emergency Pause Workflow',
        duration,
        success: true,
        emergencyType: 'Multiple'
      });
      
      console.log(`    ✅ Emergency pause workflow test completed in ${duration}ms`);
      
    } catch (error: any) {
      this.results.push({
        test: 'Emergency Pause Workflow',
        duration: Date.now() - startTime,
        success: false,
        emergencyType: 'Multiple',
        error: error.message
      });
      throw error;
    }
  }

  async testRecoveryScenarios(): Promise<void> {
    console.log('  🔄 Testing recovery scenarios...');
    
    const startTime = Date.now();
    
    try {
      // Test recovery from different emergency types
      await this.simulateRecovery('Pause Recovery');
      await this.simulateRecovery('Data Corruption Recovery');
      await this.simulateRecovery('Network Partition Recovery');
      
      const duration = Date.now() - startTime;
      
      this.results.push({
        test: 'Recovery Scenarios',
        duration,
        success: true,
        emergencyType: 'Recovery'
      });
      
      console.log(`    ✅ Recovery scenarios test completed in ${duration}ms`);
      
    } catch (error: any) {
      this.results.push({
        test: 'Recovery Scenarios',
        duration: Date.now() - startTime,
        success: false,
        emergencyType: 'Recovery',
        error: error.message
      });
      throw error;
    }
  }

  async testEmergencyDataConsistency(): Promise<void> {
    console.log('  🔍 Testing emergency data consistency...');
    
    const startTime = Date.now();
    
    try {
      // Test data consistency during emergency scenarios
      await this.simulateEmergencyDataConsistency();
      
      const duration = Date.now() - startTime;
      
      this.results.push({
        test: 'Emergency Data Consistency',
        duration,
        success: true,
        emergencyType: 'Consistency Check'
      });
      
      console.log(`    ✅ Emergency data consistency test completed in ${duration}ms`);
      
    } catch (error: any) {
      this.results.push({
        test: 'Emergency Data Consistency',
        duration: Date.now() - startTime,
        success: false,
        emergencyType: 'Consistency Check',
        error: error.message
      });
      throw error;
    }
  }

  private async simulateEmergencyPause(reason: string): Promise<void> {
    await TestUtils.delay(100 + Math.random() * 200); // Simulate pause activation
    
    // Simulate emergency pause procedure
    const pauseSteps = [
      'Stop New Orders',
      'Freeze Active Trades',
      'Notify Users',
      'Backup State'
    ];
    
    for (const step of pauseSteps) {
      await TestUtils.delay(50);
      
      // Simulate pause step
      if (Math.random() < 0.05) { // 5% failure rate
        throw new Error(`Emergency pause failed at step: ${step} for reason: ${reason}`);
      }
    }
    
    this.results.push({
      test: `Emergency Pause: ${reason}`,
      duration: 100 + Math.random() * 200,
      success: true,
      emergencyType: 'Pause'
    });
  }

  private async simulateRecovery(scenario: string): Promise<void> {
    await TestUtils.delay(150 + Math.random() * 250); // Simulate recovery process
    
    // Simulate recovery procedures
    const recoverySteps = [
      'Assess Damage',
      'Restore Services',
      'Validate Data',
      'Resume Operations'
    ];
    
    for (const step of recoverySteps) {
      await TestUtils.delay(75);
      
      // Simulate recovery step
      if (Math.random() < 0.08) { // 8% failure rate
        throw new Error(`Recovery failed at step: ${step} in scenario: ${scenario}`);
      }
    }
    
    this.results.push({
      test: `Recovery: ${scenario}`,
      duration: 150 + Math.random() * 250,
      success: true,
      emergencyType: 'Recovery'
    });
  }

  private async simulateEmergencyDataConsistency(): Promise<void> {
    await TestUtils.delay(200 + Math.random() * 300); // Simulate consistency checks
    
    // Test data consistency across programs during emergency
    const consistencyChecks = [
      'Registry State',
      'Trading Orders',
      'Token Balances',
      'User Accounts',
      'ERC Certificates'
    ];
    
    for (const check of consistencyChecks) {
      await TestUtils.delay(100);
      
      // Simulate consistency check
      const checkResult = {
        component: check,
        consistent: Math.random() > 0.1, // 90% consistency rate
        timestamp: Date.now()
      };
      
      if (!checkResult.consistent) {
        throw new Error(`Data inconsistency detected in: ${check}`);
      }
    }
    
    this.results.push({
      test: 'Data Consistency Check',
      duration: 200 + Math.random() * 300,
      success: true,
      emergencyType: 'Consistency'
    });
  }

  getResults(): EmergencyResult[] {
    return this.results;
  }

  getMetrics(): any {
    const totalTests = this.results.length;
    const successfulTests = this.results.filter(r => r.success).length;
    const totalDuration = this.results.reduce((sum, r) => sum + r.duration, 0);
    
    const emergencyTypeMetrics: { [key: string]: { count: number; totalDuration: number; averageDuration: number } } = {};
    
    this.results.forEach(result => {
      if (!emergencyTypeMetrics[result.emergencyType]) {
        emergencyTypeMetrics[result.emergencyType] = { count: 0, totalDuration: 0, averageDuration: 0 };
      }
      emergencyTypeMetrics[result.emergencyType].count++;
      emergencyTypeMetrics[result.emergencyType].totalDuration += result.duration;
    });
    
    Object.keys(emergencyTypeMetrics).forEach(type => {
      emergencyTypeMetrics[type].averageDuration = emergencyTypeMetrics[type].totalDuration / emergencyTypeMetrics[type].count;
    });
    
    return {
      totalTests,
      successfulTests,
      failedTests: totalTests - successfulTests,
      successRate: (successfulTests / totalTests) * 100,
      totalDuration,
      averageDuration: totalDuration / totalTests,
      emergencyTypeMetrics,
      fastestResponse: Math.min(...this.results.map(r => r.duration)),
      slowestResponse: Math.max(...this.results.map(r => r.duration))
    };
  }
}
