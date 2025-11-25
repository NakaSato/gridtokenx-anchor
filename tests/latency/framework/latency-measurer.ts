/**
 * Latency Measurement Framework for GridTokenX Anchor Programs
 * Provides high-precision timing and performance measurement capabilities
 */

import { Connection, PublicKey, Transaction, TransactionSignature } from '@solana/web3.js';
import { PerformanceTracker } from './performance-tracker';
import { DataCollector } from './data-collector';
import { PerformanceAnalyzer } from './performance-analyzer';

/**
 * Latency measurement types
 */
export interface LatencyMeasurement {
  timestamp: number;
  programId: string;
  instruction: string;
  transactionLatency: number;
  instructionLatency: number;
  cpiLatency?: number;
  endToEndLatency?: number;
  metadata: {
    blockHeight: number;
    slot: number;
    computeUnits: number;
    priorityFee: number;
    transactionSignature: string;
  };
}

export interface TestScenario {
  name: string;
  description: string;
  iterations: number;
  concurrency: number;
  delay: number;
}

export interface PerformanceMetrics {
  timestamp: number;
  programId: string;
  operation: string;
  latency: {
    min: number;
    max: number;
    mean: number;
    p50: number;
    p95: number;
    p99: number;
  };
  throughput: {
    operations: number;
    duration: number;
    tps: number;
  };
  errors: {
    count: number;
    rate: number;
    types: string[];
  };
}

/**
 * Main Latency Measurer Class
 */
export class LatencyMeasurer {
  private connection: Connection;
  private tracker: PerformanceTracker;
  private collector: DataCollector;
  private analyzer: PerformanceAnalyzer;
  private measurements: LatencyMeasurement[] = [];

  constructor(connection: Connection) {
    this.connection = connection;
    this.tracker = new PerformanceTracker();
    this.collector = new DataCollector();
    this.analyzer = new PerformanceAnalyzer();
  }

  /**
   * Start measuring a transaction
   */
  startMeasurement(programId: string, instruction: string): string {
    return this.tracker.startMeasurement(programId, instruction);
  }

  /**
   * End measurement and record results
   */
  async endMeasurement(
    measurementId: string,
    transactionSignature: TransactionSignature
  ): Promise<LatencyMeasurement> {
    const endTime = performance.now();
    const measurement = this.tracker.endMeasurement(measurementId);

    // Get transaction details
    const transaction = await this.connection.getTransaction(transactionSignature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0
    });

    if (!transaction) {
      throw new Error(`Transaction not found: ${transactionSignature}`);
    }

    const latencyMeasurement: LatencyMeasurement = {
      timestamp: Date.now(),
      programId: measurement.programId,
      instruction: measurement.instruction,
      transactionLatency: endTime - measurement.startTime,
      instructionLatency: endTime - measurement.startTime,
      metadata: {
        blockHeight: transaction.slot || 0,
        slot: transaction.slot || 0,
        computeUnits: transaction.meta?.computeUnitsConsumed || 0,
        priorityFee: transaction.meta?.fee || 0,
        transactionSignature
      }
    };

    this.measurements.push(latencyMeasurement);
    await this.collector.recordMeasurement(latencyMeasurement);

    return latencyMeasurement;
  }

  /**
   * Measure a single operation
   */
  async measureOperation<T>(
    programId: string,
    instruction: string,
    operation: () => Promise<{ signature: TransactionSignature; result: T }>
  ): Promise<{ measurement: LatencyMeasurement; result: T }> {
    const measurementId = this.startMeasurement(programId, instruction);
    
    try {
      const { signature, result } = await operation();
      const measurement = await this.endMeasurement(measurementId, signature);
      
      return { measurement, result };
    } catch (error) {
      this.tracker.cancelMeasurement(measurementId);
      throw error;
    }
  }

  /**
   * Run a test scenario with multiple iterations
   */
  async runScenario(
    scenario: TestScenario,
    operation: () => Promise<{ signature: TransactionSignature; result: any }>
  ): Promise<PerformanceMetrics> {
    const measurements: LatencyMeasurement[] = [];
    const errors: { type: string; count: number }[] = [];
    const startTime = performance.now();

    // Run iterations
    for (let i = 0; i < scenario.iterations; i++) {
      try {
        const { measurement } = await this.measureOperation(
          `scenario_${scenario.name}`,
          `iteration_${i}`,
          operation
        );
        measurements.push(measurement);

        // Add delay between iterations if specified
        if (scenario.delay > 0 && i < scenario.iterations - 1) {
          await this.sleep(scenario.delay);
        }
      } catch (error) {
        const errorType = error instanceof Error ? error.constructor.name : 'Unknown';
        errors.push({ type: errorType, count: 1 });
      }
    }

    const endTime = performance.now();
    const duration = endTime - startTime;

    // Calculate performance metrics
    const metrics = this.analyzer.calculateMetrics(
      scenario.name,
      measurements,
      duration,
      errors
    );

    return metrics;
  }

  /**
   * Run concurrent operations
   */
  async runConcurrentScenario(
    scenario: TestScenario,
    operation: () => Promise<{ signature: TransactionSignature; result: any }>
  ): Promise<PerformanceMetrics> {
    const promises: Promise<LatencyMeasurement>[] = [];
    const errors: { type: string; count: number }[] = [];
    const startTime = performance.now();

    // Create concurrent operations
    for (let i = 0; i < scenario.concurrency; i++) {
      const promise = this.measureOperation(
        `concurrent_${scenario.name}`,
        `worker_${i}`,
        operation
      ).then(({ measurement }) => measurement)
       .catch(error => {
         const errorType = error instanceof Error ? error.constructor.name : 'Unknown';
         errors.push({ type: errorType, count: 1 });
         throw error;
       });
      
      promises.push(promise);
    }

    // Wait for all operations to complete
    const measurements = await Promise.allSettled(promises);
    const successfulMeasurements = measurements
      .filter(result => result.status === 'fulfilled')
      .map(result => (result as PromiseFulfilledResult<LatencyMeasurement>).value);

    const endTime = performance.now();
    const duration = endTime - startTime;

    // Calculate performance metrics
    const metrics = this.analyzer.calculateMetrics(
      `concurrent_${scenario.name}`,
      successfulMeasurements,
      duration,
      errors
    );

    return metrics;
  }

  /**
   * Get all measurements
   */
  getMeasurements(): LatencyMeasurement[] {
    return [...this.measurements];
  }

  /**
   * Get measurements by program
   */
  getMeasurementsByProgram(programId: string): LatencyMeasurement[] {
    return this.measurements.filter(m => m.programId === programId);
  }

  /**
   * Get measurements by instruction
   */
  getMeasurementsByInstruction(instruction: string): LatencyMeasurement[] {
    return this.measurements.filter(m => m.instruction.includes(instruction));
  }

  /**
   * Export measurements to JSON
   */
  exportMeasurements(): string {
    return JSON.stringify(this.measurements, null, 2);
  }

  /**
   * Clear all measurements
   */
  clearMeasurements(): void {
    this.measurements = [];
    this.tracker.clear();
  }

  /**
   * Utility function for delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get performance summary
   */
  getPerformanceSummary(): {
    totalMeasurements: number;
    averageLatency: number;
    programs: { [key: string]: number };
    instructions: { [key: string]: number };
  } {
    const totalMeasurements = this.measurements.length;
    const averageLatency = totalMeasurements > 0 
      ? this.measurements.reduce((sum, m) => sum + m.transactionLatency, 0) / totalMeasurements
      : 0;

    const programs: { [key: string]: number } = {};
    const instructions: { [key: string]: number } = {};

    this.measurements.forEach(measurement => {
      programs[measurement.programId] = (programs[measurement.programId] || 0) + 1;
      instructions[measurement.instruction] = (instructions[measurement.instruction] || 0) + 1;
    });

    return {
      totalMeasurements,
      averageLatency,
      programs,
      instructions
    };
  }
}

/**
 * Factory function to create latency measurer
 */
export function createLatencyMeasurer(connection: Connection): LatencyMeasurer {
  return new LatencyMeasurer(connection);
}
