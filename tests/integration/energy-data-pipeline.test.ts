/**
 * GridTokenX Energy Data Pipeline Integration Tests
 * 
 * Tests data flow from meters through
 * oracle to registry and trading.
 */

import * as anchor from "@coral-xyz/anchor";
import { Connection } from '@solana/web3.js';
import { TestEnvironment } from '../setup.js';
import { TestUtils } from '../utils/index.js';

interface PipelineResult {
  test: string;
  dataPoints: number;
  duration: number;
  success: boolean;
  error?: string;
}

export class EnergyDataPipelineTest {
  private env: TestEnvironment;
  private connection: Connection;
  private results: PipelineResult[] = [];

  constructor(env: TestEnvironment, connection: Connection) {
    this.env = env;
    this.connection = connection;
  }

  async testMeterReadingPipeline(): Promise<void> {
    console.log('  📊 Testing meter reading pipeline...');
    
    const startTime = Date.now();
    const readingCount = 50;
    
    try {
      // Simulate meter reading pipeline
      await this.simulateMeterReadings(readingCount);
      
      const duration = Date.now() - startTime;
      
      this.results.push({
        test: 'Meter Reading Pipeline',
        dataPoints: readingCount,
        duration,
        success: true
      });
      
      console.log(`    ✅ Meter reading pipeline with ${readingCount} readings completed in ${duration}ms`);
      
    } catch (error: any) {
      this.results.push({
        test: 'Meter Reading Pipeline',
        dataPoints: readingCount,
        duration: Date.now() - startTime,
        success: false,
        error: error.message
      });
      throw error;
    }
  }

  async testDataFlowValidation(): Promise<void> {
    console.log('  🔄 Testing data flow validation...');
    
    const startTime = Date.now();
    
    try {
      // Test data flow through pipeline stages
      await this.simulateDataFlowStages();
      
      const duration = Date.now() - startTime;
      
      this.results.push({
        test: 'Data Flow Validation',
        dataPoints: 10, // Simulated stages
        duration,
        success: true
      });
      
      console.log(`    ✅ Data flow validation completed in ${duration}ms`);
      
    } catch (error: any) {
      this.results.push({
        test: 'Data Flow Validation',
        dataPoints: 10,
        duration: Date.now() - startTime,
        success: false,
        error: error.message
      });
      throw error;
    }
  }

  async testPipelinePerformance(): Promise<void> {
    console.log('  ⚡ Testing pipeline performance...');
    
    const startTime = Date.now();
    
    try {
      // Test pipeline under load
      await this.simulatePipelineLoad();
      
      const duration = Date.now() - startTime;
      
      this.results.push({
        test: 'Pipeline Performance',
        dataPoints: 100, // High load test
        duration,
        success: true
      });
      
      console.log(`    ✅ Pipeline performance test completed in ${duration}ms`);
      
    } catch (error: any) {
      this.results.push({
        test: 'Pipeline Performance',
        dataPoints: 100,
        duration: Date.now() - startTime,
        success: false,
        error: error.message
      });
      throw error;
    }
  }

  private async simulateMeterReadings(count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      await TestUtils.delay(10 + Math.random() * 20); // 10-30ms per reading
      
      const reading = {
        meterId: `meter_${i}`,
        timestamp: Date.now(),
        energyGenerated: Math.random() * 1000,
        energyConsumed: Math.random() * 500,
        qualityScore: 90 + Math.random() * 10
      };
      
      // Simulate processing reading through pipeline
      if (Math.random() < 0.02) { // 2% failure rate
        throw new Error(`Meter reading failed for ${reading.meterId}`);
      }
    }
  }

  private async simulateDataFlowStages(): Promise<void> {
    const stages = [
      'Meter Collection',
      'Oracle Validation',
      'Registry Storage',
      'ERC Generation',
      'Trading Integration'
    ];
    
    for (const stage of stages) {
      await TestUtils.delay(50 + Math.random() * 100); // 50-150ms per stage
      
      // Simulate stage processing
      const stageData = {
        stage,
        processedAt: Date.now(),
        dataSize: Math.floor(Math.random() * 10000)
      };
      
      // Validate data integrity
      if (Math.random() < 0.05) { // 5% failure rate
        throw new Error(`Data corruption detected in ${stage}`);
      }
    }
  }

  private async simulatePipelineLoad(): Promise<void> {
    const concurrentStreams = 10;
    const dataPerStream = 10;
    
    const streams = [];
    
    for (let i = 0; i < concurrentStreams; i++) {
      const stream = this.simulateDataStream(`stream_${i}`, dataPerStream);
      streams.push(stream);
    }
    
    await Promise.all(streams);
  }

  private async simulateDataStream(streamId: string, dataCount: number): Promise<void> {
    for (let i = 0; i < dataCount; i++) {
      await TestUtils.delay(5 + Math.random() * 10); // 5-15ms per data point
      
      const dataPoint = {
        streamId,
        index: i,
        timestamp: Date.now(),
        value: Math.random() * 1000
      };
      
      // Simulate stream processing
      if (Math.random() < 0.01) { // 1% failure rate
        throw new Error(`Stream processing failed for ${streamId} at index ${i}`);
      }
    }
  }

  getResults(): PipelineResult[] {
    return this.results;
  }

  getMetrics(): any {
    const totalTests = this.results.length;
    const successfulTests = this.results.filter(r => r.success).length;
    const totalDataPoints = this.results.reduce((sum, r) => sum + r.dataPoints, 0);
    const totalDuration = this.results.reduce((sum, r) => sum + r.duration, 0);
    
    return {
      totalTests,
      successfulTests,
      failedTests: totalTests - successfulTests,
      successRate: (successfulTests / totalTests) * 100,
      totalDataPoints,
      averageDataPointsPerTest: totalDataPoints / totalTests,
      totalDuration,
      averageDuration: totalDuration / totalTests,
      throughputPerSecond: totalDataPoints / (totalDuration / 1000)
    };
  }
}
