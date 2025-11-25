/**
 * Latency Measurement Framework for GridTokenX Anchor Programs
 * Provides high-precision timing and performance measurement capabilities
 */
import { PerformanceTracker } from './performance-tracker.js';
import { DataCollector } from './data-collector.js';
import { PerformanceAnalyzer } from './performance-analyzer.js';
/**
 * Main Latency Measurer Class
 */
export class LatencyMeasurer {
    constructor(connection) {
        this.measurements = [];
        this.connection = connection;
        this.tracker = new PerformanceTracker();
        this.collector = new DataCollector();
        this.analyzer = new PerformanceAnalyzer();
    }
    /**
     * Start measuring a transaction
     */
    startMeasurement(programId, instruction) {
        return this.tracker.startMeasurement(programId, instruction);
    }
    /**
     * End measurement and record results
     */
    async endMeasurement(measurementId, transactionSignature) {
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
        const latencyMeasurement = {
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
    async measureOperation(programId, instruction, operation) {
        const measurementId = this.startMeasurement(programId, instruction);
        try {
            const { signature, result } = await operation();
            const measurement = await this.endMeasurement(measurementId, signature);
            return { measurement, result };
        }
        catch (error) {
            this.tracker.cancelMeasurement(measurementId);
            throw error;
        }
    }
    /**
     * Run a test scenario with multiple iterations
     */
    async runScenario(scenario, operation) {
        const measurements = [];
        const errors = [];
        const startTime = performance.now();
        // Run iterations
        for (let i = 0; i < scenario.iterations; i++) {
            try {
                const { measurement } = await this.measureOperation(`scenario_${scenario.name}`, `iteration_${i}`, operation);
                measurements.push(measurement);
                // Add delay between iterations if specified
                if (scenario.delay > 0 && i < scenario.iterations - 1) {
                    await this.sleep(scenario.delay);
                }
            }
            catch (error) {
                const errorType = error instanceof Error ? error.constructor.name : 'Unknown';
                errors.push({ type: errorType, count: 1 });
            }
        }
        const endTime = performance.now();
        const duration = endTime - startTime;
        // Calculate performance metrics
        const metrics = this.analyzer.calculateMetrics(scenario.name, measurements, duration, errors);
        return metrics;
    }
    /**
     * Run concurrent operations
     */
    async runConcurrentScenario(scenario, operation) {
        const promises = [];
        const errors = [];
        const startTime = performance.now();
        // Create concurrent operations
        for (let i = 0; i < scenario.concurrency; i++) {
            const promise = this.measureOperation(`concurrent_${scenario.name}`, `worker_${i}`, operation).then(({ measurement }) => measurement)
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
            .map(result => result.value);
        const endTime = performance.now();
        const duration = endTime - startTime;
        // Calculate performance metrics
        const metrics = this.analyzer.calculateMetrics(`concurrent_${scenario.name}`, successfulMeasurements, duration, errors);
        return metrics;
    }
    /**
     * Get all measurements
     */
    getMeasurements() {
        return [...this.measurements];
    }
    /**
     * Get measurements by program
     */
    getMeasurementsByProgram(programId) {
        return this.measurements.filter(m => m.programId === programId);
    }
    /**
     * Get measurements by instruction
     */
    getMeasurementsByInstruction(instruction) {
        return this.measurements.filter(m => m.instruction.includes(instruction));
    }
    /**
     * Export measurements to JSON
     */
    exportMeasurements() {
        return JSON.stringify(this.measurements, null, 2);
    }
    /**
     * Clear all measurements
     */
    clearMeasurements() {
        this.measurements = [];
        this.tracker.clear();
    }
    /**
     * Utility function for delays
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    /**
     * Get performance summary
     */
    getPerformanceSummary() {
        const totalMeasurements = this.measurements.length;
        const averageLatency = totalMeasurements > 0
            ? this.measurements.reduce((sum, m) => sum + m.transactionLatency, 0) / totalMeasurements
            : 0;
        const programs = {};
        const instructions = {};
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
export function createLatencyMeasurer(connection) {
    return new LatencyMeasurer(connection);
}
