/**
 * Performance Tracker for high-precision timing measurements
 */
export class PerformanceTracker {
    constructor() {
        this.activeMeasurements = new Map();
        this.measurementCounter = 0;
    }
    /**
     * Start a new measurement
     */
    startMeasurement(programId, instruction) {
        const measurementId = `measurement_${++this.measurementCounter}_${Date.now()}`;
        const measurement = {
            id: measurementId,
            programId,
            instruction,
            startTime: performance.now(),
            startTimestamp: Date.now()
        };
        this.activeMeasurements.set(measurementId, measurement);
        return measurementId;
    }
    /**
     * End a measurement and return the result
     */
    endMeasurement(measurementId) {
        const measurement = this.activeMeasurements.get(measurementId);
        if (!measurement) {
            throw new Error(`Measurement not found: ${measurementId}`);
        }
        this.activeMeasurements.delete(measurementId);
        return {
            programId: measurement.programId,
            instruction: measurement.instruction,
            startTime: measurement.startTime,
            startTimestamp: measurement.startTimestamp
        };
    }
    /**
     * Cancel a measurement
     */
    cancelMeasurement(measurementId) {
        return this.activeMeasurements.delete(measurementId);
    }
    /**
     * Get all active measurements
     */
    getActiveMeasurements() {
        return Array.from(this.activeMeasurements.values());
    }
    /**
     * Get measurement duration
     */
    getMeasurementDuration(measurementId) {
        const measurement = this.activeMeasurements.get(measurementId);
        if (!measurement) {
            return null;
        }
        return performance.now() - measurement.startTime;
    }
    /**
     * Clear all active measurements
     */
    clear() {
        this.activeMeasurements.clear();
        this.measurementCounter = 0;
    }
    /**
     * Get number of active measurements
     */
    getActiveCount() {
        return this.activeMeasurements.size;
    }
    /**
     * Check if measurement exists
     */
    hasMeasurement(measurementId) {
        return this.activeMeasurements.has(measurementId);
    }
    /**
     * Get measurements by program ID
     */
    getMeasurementsByProgram(programId) {
        return Array.from(this.activeMeasurements.values())
            .filter(m => m.programId === programId);
    }
    /**
     * Get measurements by instruction
     */
    getMeasurementsByInstruction(instruction) {
        return Array.from(this.activeMeasurements.values())
            .filter(m => m.instruction.includes(instruction));
    }
    /**
     * Cleanup old measurements (prevent memory leaks)
     */
    cleanup(maxAgeMs = 60000) {
        const now = performance.now();
        const toDelete = [];
        for (const [id, measurement] of this.activeMeasurements.entries()) {
            if (now - measurement.startTime > maxAgeMs) {
                toDelete.push(id);
            }
        }
        toDelete.forEach(id => this.activeMeasurements.delete(id));
        return toDelete.length;
    }
}
