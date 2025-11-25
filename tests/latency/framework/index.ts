/**
 * Latency Measurement Framework - Main Export
 * 
 * This framework provides comprehensive latency measurement capabilities
 * for GridTokenX Anchor programs with high-precision timing,
 * statistical analysis, and performance monitoring.
 */

export { LatencyMeasurer, createLatencyMeasurer } from './latency-measurer';
export { PerformanceTracker } from './performance-tracker';
export { DataCollector } from './data-collector';
export { PerformanceAnalyzer } from './performance-analyzer';

export type {
  LatencyMeasurement,
  TestScenario,
  PerformanceMetrics
} from './latency-measurer';

export type {
  ActiveMeasurement
} from './performance-tracker';

export type {
  AnalysisConfig,
  PerformanceSummary,
  TrendAnalysis,
  RegressionDetection
} from './performance-analyzer';

export type {
  DataCollectionConfig
} from './data-collector';

/**
 * Factory function to create a complete latency measurement setup
 */
import { Connection } from '@solana/web3.js';
import { LatencyMeasurer } from './latency-measurer';
import { DataCollector, DataCollectionConfig } from './data-collector';
import { PerformanceAnalyzer, AnalysisConfig } from './performance-analyzer';
import { TestScenario } from './latency-measurer';

export interface LatencyFrameworkConfig {
  connection: Connection;
  dataCollection?: Partial<DataCollectionConfig>;
  analysis?: Partial<AnalysisConfig>;
}

export function createLatencyFramework(config: LatencyFrameworkConfig) {
  const { connection, dataCollection, analysis } = config;
  
  const measurer = new LatencyMeasurer(connection);
  const collector = new DataCollector(dataCollection);
  const analyzer = new PerformanceAnalyzer(analysis);
  
  return {
    measurer,
    collector,
    analyzer,
    
    // Convenience methods
    async measureOperation<T>(
      programId: string,
      instruction: string,
      operation: () => Promise<{ signature: string; result: T }>
    ) {
      const result = await measurer.measureOperation(programId, instruction, operation);
      await collector.recordMeasurement(result.measurement);
      return result;
    },
    
    async runTestScenario(
      scenario: TestScenario,
      programId: string,
      operation: () => Promise<{ signature: string; result: any }>
    ) {
      const metrics = await measurer.runScenario(scenario, operation);
      await collector.recordMeasurements(measurer.getMeasurementsByProgram(programId));
      return metrics;
    },
    
    generateReport() {
      const measurements = measurer.getMeasurements();
      return analyzer.generateReport(measurements);
    },
    
    exportReport(filename?: string) {
      return collector.exportToFile(filename);
    },
    
    cleanup() {
      collector.cleanup();
      measurer.clearMeasurements();
    }
  };
}
