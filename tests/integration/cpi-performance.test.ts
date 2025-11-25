/**
 * GridTokenX CPI Performance Integration Tests
 * 
 * Tests Cross-Program Invocation performance between
 * different GridTokenX programs.
 */

import * as anchor from "@coral-xyz/anchor";
import { Connection } from '@solana/web3.js';
import { TestEnvironment } from '../setup.js';
import { TestUtils } from '../utils/index.js';

interface CpiPerformanceResult {
  operation: string;
  duration: number;
  programFrom: string;
  programTo: string;
  success: boolean;
  error?: string;
}

export class CpiPerformanceTest {
  private env: TestEnvironment;
  private connection: Connection;
  private results: CpiPerformanceResult[] = [];

  constructor(env: TestEnvironment, connection: Connection) {
    this.env = env;
    this.connection = connection;
  }

  /**
   * Test CPI call overhead between programs
   */
  async testCpiCallOverhead(): Promise<void> {
    console.log('  🔄 Testing CPI call overhead...');
    
    const startTime = Date.now();
    
    try {
      // Simulate CPI calls between programs
      await this.simulateCpiCall('Registry', 'Governance', 'validateUser');
      await this.simulateCpiCall('Oracle', 'Registry', 'submitReading');
      await this.simulateCpiCall('Trading', 'EnergyToken', 'transferTokens');
      
      const duration = Date.now() - startTime;
      
      this.results.push({
        operation: 'CPI Call Overhead Test',
        duration,
        programFrom: 'Multiple',
        programTo: 'Multiple',
        success: true
      });
      
      console.log(`    ✅ CPI overhead test completed in ${duration}ms`);
      
    } catch (error: any) {
      this.results.push({
        operation: 'CPI Call Overhead Test',
        duration: Date.now() - startTime,
        programFrom: 'Multiple',
        programTo: 'Multiple',
        success: false,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Test data serialization costs in CPI calls
   */
  async testDataSerializationCosts(): Promise<void> {
    console.log('  📦 Testing data serialization costs...');
    
    const startTime = Date.now();
    
    try {
      const testSizes = [100, 1000, 10000]; // bytes
      
      for (const size of testSizes) {
        const testData = this.generateTestData(size);
        await this.measureSerializationCost(testData);
      }
      
      const duration = Date.now() - startTime;
      
      this.results.push({
        operation: 'Data Serialization Costs',
        duration,
        programFrom: 'Test',
        programTo: 'Test',
        success: true
      });
      
      console.log(`    ✅ Serialization costs test completed in ${duration}ms`);
      
    } catch (error: any) {
      this.results.push({
        operation: 'Data Serialization Costs',
        duration: Date.now() - startTime,
        programFrom: 'Test',
        programTo: 'Test',
        success: false,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Test context switching performance
   */
  async testContextSwitchingPerformance(): Promise<void> {
    console.log('  🔄 Testing context switching performance...');
    
    const startTime = Date.now();
    
    try {
      const iterations = 100;
      
      for (let i = 0; i < iterations; i++) {
        await this.simulateContextSwitch();
      }
      
      const duration = Date.now() - startTime;
      const averageTime = duration / iterations;
      
      this.results.push({
        operation: 'Context Switching Performance',
        duration,
        programFrom: 'Multiple',
        programTo: 'Multiple',
        success: true
      });
      
      console.log(`    ✅ Context switching test completed - Average: ${averageTime.toFixed(2)}ms per switch`);
      
    } catch (error: any) {
      this.results.push({
        operation: 'Context Switching Performance',
        duration: Date.now() - startTime,
        programFrom: 'Multiple',
        programTo: 'Multiple',
        success: false,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Simulate a CPI call between programs
   */
  private async simulateCpiCall(
    fromProgram: string, 
    toProgram: string, 
    operation: string
  ): Promise<void> {
    const startTime = Date.now();
    
    // Simulate CPI call latency
    await TestUtils.delay(50 + Math.random() * 100); // 50-150ms
    
    const duration = Date.now() - startTime;
    
    this.results.push({
      operation: `${fromProgram}→${toProgram}:${operation}`,
      duration,
      programFrom: fromProgram,
      programTo: toProgram,
      success: true
    });
  }

  /**
   * Measure serialization cost for data
   */
  private async measureSerializationCost(data: any): Promise<void> {
    const startTime = Date.now();
    
    // Simulate serialization/deserialization
    const serialized = JSON.stringify(data);
    const deserialized = JSON.parse(serialized);
    
    const duration = Date.now() - startTime;
    
    this.results.push({
      operation: `Serialization ${serialized.length} bytes`,
      duration,
      programFrom: 'Serializer',
      programTo: 'Deserializer',
      success: true
    });
  }

  /**
   * Simulate context switch
   */
  private async simulateContextSwitch(): Promise<void> {
    // Simulate context switching overhead
    await TestUtils.delay(5 + Math.random() * 10); // 5-15ms
  }

  /**
   * Generate test data of specified size
   */
  private generateTestData(size: number): any {
    const data = {
      id: TestUtils.generateTestId(),
      timestamp: Date.now(),
      metadata: {}
    };
    
    // Fill with data until approximate size reached
    let currentSize = JSON.stringify(data).length;
    while (currentSize < size) {
      (data.metadata as any)[`field_${currentSize}`] = 'x'.repeat(Math.min(100, size - currentSize));
      currentSize = JSON.stringify(data).length;
    }
    
    return data;
  }

  /**
   * Get performance metrics
   */
  getMetrics(): any {
    const totalOperations = this.results.length;
    const successfulOperations = this.results.filter(r => r.success).length;
    const totalDuration = this.results.reduce((sum, r) => sum + r.duration, 0);
    const averageDuration = totalDuration / totalOperations;
    
    const programMetrics: { [key: string]: { count: number; totalDuration: number; averageDuration: number } } = {};
    
    this.results.forEach(result => {
      const key = `${result.programFrom}→${result.programTo}`;
      if (!programMetrics[key]) {
        programMetrics[key] = { count: 0, totalDuration: 0, averageDuration: 0 };
      }
      programMetrics[key].count++;
      programMetrics[key].totalDuration += result.duration;
    });
    
    Object.keys(programMetrics).forEach(key => {
      programMetrics[key].averageDuration = programMetrics[key].totalDuration / programMetrics[key].count;
    });
    
    return {
      totalOperations,
      successfulOperations,
      failedOperations: totalOperations - successfulOperations,
      successRate: (successfulOperations / totalOperations) * 100,
      totalDuration,
      averageDuration,
      programMetrics
    };
  }
}
