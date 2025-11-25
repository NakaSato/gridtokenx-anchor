/**
 * Performance Tracker for high-precision timing measurements
 */

export interface ActiveMeasurement {
  id: string;
  programId: string;
  instruction: string;
  startTime: number;
  startTimestamp: number;
}

export class PerformanceTracker {
  private activeMeasurements: Map<string, ActiveMeasurement> = new Map();
  private measurementCounter: number = 0;

  /**
   * Start a new measurement
   */
  startMeasurement(programId: string, instruction: string): string {
    const measurementId = `measurement_${++this.measurementCounter}_${Date.now()}`;
    
    const measurement: ActiveMeasurement = {
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
  endMeasurement(measurementId: string): Omit<ActiveMeasurement, 'id'> {
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
  cancelMeasurement(measurementId: string): boolean {
    return this.activeMeasurements.delete(measurementId);
  }

  /**
   * Get all active measurements
   */
  getActiveMeasurements(): ActiveMeasurement[] {
    return Array.from(this.activeMeasurements.values());
  }

  /**
   * Get measurement duration
   */
  getMeasurementDuration(measurementId: string): number | null {
    const measurement = this.activeMeasurements.get(measurementId);
    
    if (!measurement) {
      return null;
    }

    return performance.now() - measurement.startTime;
  }

  /**
   * Clear all active measurements
   */
  clear(): void {
    this.activeMeasurements.clear();
    this.measurementCounter = 0;
  }

  /**
   * Get number of active measurements
   */
  getActiveCount(): number {
    return this.activeMeasurements.size;
  }

  /**
   * Check if measurement exists
   */
  hasMeasurement(measurementId: string): boolean {
    return this.activeMeasurements.has(measurementId);
  }

  /**
   * Get measurements by program ID
   */
  getMeasurementsByProgram(programId: string): ActiveMeasurement[] {
    return Array.from(this.activeMeasurements.values())
      .filter(m => m.programId === programId);
  }

  /**
   * Get measurements by instruction
   */
  getMeasurementsByInstruction(instruction: string): ActiveMeasurement[] {
    return Array.from(this.activeMeasurements.values())
      .filter(m => m.instruction.includes(instruction));
  }

  /**
   * Cleanup old measurements (prevent memory leaks)
   */
  cleanup(maxAgeMs: number = 60000): number {
    const now = performance.now();
    const toDelete: string[] = [];

    for (const [id, measurement] of this.activeMeasurements.entries()) {
      if (now - measurement.startTime > maxAgeMs) {
        toDelete.push(id);
      }
    }

    toDelete.forEach(id => this.activeMeasurements.delete(id));
    
    return toDelete.length;
  }
}
