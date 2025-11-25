/**
 * Latency Measurement Framework - Main Export
 *
 * This framework provides comprehensive latency measurement capabilities
 * for GridTokenX Anchor programs with high-precision timing,
 * statistical analysis, and performance monitoring.
 */
export { LatencyMeasurer, createLatencyMeasurer } from './latency-measurer.js';
export { PerformanceTracker } from './performance-tracker.js';
export { DataCollector } from './data-collector.js';
export { PerformanceAnalyzer } from './performance-analyzer.js';
import { LatencyMeasurer } from './latency-measurer.js';
import { DataCollector } from './data-collector.js';
import { PerformanceAnalyzer } from './performance-analyzer.js';
export function createLatencyFramework(config) {
    const { connection, dataCollection, analysis } = config;
    const measurer = new LatencyMeasurer(connection);
    const collector = new DataCollector(dataCollection);
    const analyzer = new PerformanceAnalyzer(analysis);
    return {
        measurer,
        collector,
        analyzer,
        // Convenience methods
        async measureOperation(programId, instruction, operation) {
            const result = await measurer.measureOperation(programId, instruction, operation);
            await collector.recordMeasurement(result.measurement);
            return result;
        },
        async runTestScenario(scenario, programId, operation) {
            const metrics = await measurer.runScenario(scenario, operation);
            await collector.recordMeasurements(measurer.getMeasurementsByProgram(programId));
            return metrics;
        },
        generateReport() {
            const measurements = measurer.getMeasurements();
            return analyzer.generateReport(measurements);
        },
        exportReport(filename) {
            return collector.exportToFile(filename);
        },
        cleanup() {
            collector.cleanup();
            measurer.clearMeasurements();
        }
    };
}
