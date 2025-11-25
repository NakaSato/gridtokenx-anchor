/**
 * Data Collector for storing and managing latency measurements
 */

import * as fs from 'fs';
import * as path from 'path';
import { LatencyMeasurement } from './latency-measurer';

export interface DataCollectionConfig {
  outputDirectory: string;
  enableFileStorage: boolean;
  enableMemoryStorage: boolean;
  maxMemoryRecords: number;
  autoSave: boolean;
  autoSaveInterval: number;
}

export class DataCollector {
  private config: DataCollectionConfig;
  private measurements: LatencyMeasurement[] = [];
  private autoSaveTimer?: NodeJS.Timeout;

  constructor(config: Partial<DataCollectionConfig> = {}) {
    this.config = {
      outputDirectory: './test-results/latency',
      enableFileStorage: true,
      enableMemoryStorage: true,
      maxMemoryRecords: 10000,
      autoSave: true,
      autoSaveInterval: 30000, // 30 seconds
      ...config
    };

    // Ensure output directory exists
    if (this.config.enableFileStorage) {
      this.ensureDirectoryExists(this.config.outputDirectory);
    }

    // Start auto-save if enabled
    if (this.config.autoSave) {
      this.startAutoSave();
    }
  }

  /**
   * Record a new measurement
   */
  async recordMeasurement(measurement: LatencyMeasurement): Promise<void> {
    if (this.config.enableMemoryStorage) {
      this.measurements.push(measurement);
      
      // Trim memory records if exceed max
      if (this.measurements.length > this.config.maxMemoryRecords) {
        this.measurements = this.measurements.slice(-this.config.maxMemoryRecords);
      }
    }

    if (this.config.enableFileStorage) {
      await this.saveMeasurementToFile(measurement);
    }
  }

  /**
   * Record multiple measurements
   */
  async recordMeasurements(measurements: LatencyMeasurement[]): Promise<void> {
    if (this.config.enableMemoryStorage) {
      this.measurements.push(...measurements);
      
      // Trim memory records if exceed max
      if (this.measurements.length > this.config.maxMemoryRecords) {
        this.measurements = this.measurements.slice(-this.config.maxMemoryRecords);
      }
    }

    if (this.config.enableFileStorage) {
      await this.saveMeasurementsToFile(measurements);
    }
  }

  /**
   * Get all measurements from memory
   */
  getMeasurements(): LatencyMeasurement[] {
    return [...this.measurements];
  }

  /**
   * Get measurements by program ID
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
   * Get measurements by time range
   */
  getMeasurementsByTimeRange(startTime: number, endTime: number): LatencyMeasurement[] {
    return this.measurements.filter(
      m => m.timestamp >= startTime && m.timestamp <= endTime
    );
  }

  /**
   * Get measurements by latency range
   */
  getMeasurementsByLatencyRange(minLatency: number, maxLatency: number): LatencyMeasurement[] {
    return this.measurements.filter(
      m => m.transactionLatency >= minLatency && m.transactionLatency <= maxLatency
    );
  }

  /**
   * Clear measurements from memory
   */
  clearMeasurements(): void {
    this.measurements = [];
  }

  /**
   * Export measurements to JSON
   */
  async exportToFile(filename?: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const defaultFilename = `latency-measurements-${timestamp}.json`;
    const finalFilename = filename || defaultFilename;
    
    const filePath = path.join(this.config.outputDirectory, finalFilename);
    const exportData = {
      exportTime: new Date().toISOString(),
      totalMeasurements: this.measurements.length,
      measurements: this.measurements
    };

    await fs.promises.writeFile(filePath, JSON.stringify(exportData, null, 2));
    
    return filePath;
  }

  /**
   * Import measurements from JSON file
   */
  async importFromFile(filePath: string): Promise<LatencyMeasurement[]> {
    try {
      const data = await fs.promises.readFile(filePath, 'utf8');
      const parsed = JSON.parse(data);
      
      let measurements: LatencyMeasurement[];
      if (Array.isArray(parsed)) {
        // Legacy format - direct array
        measurements = parsed;
      } else if (parsed.measurements && Array.isArray(parsed.measurements)) {
        // New format - with metadata
        measurements = parsed.measurements;
      } else {
        throw new Error('Invalid file format');
      }

      if (this.config.enableMemoryStorage) {
        this.measurements.push(...measurements);
      }

      return measurements;
    } catch (error) {
      throw new Error(`Failed to import measurements from ${filePath}: ${error}`);
    }
  }

  /**
   * Get performance statistics
   */
  getStatistics(): {
    totalMeasurements: number;
    programs: { [key: string]: number };
    instructions: { [key: string]: number };
    latencyStats: {
      min: number;
      max: number;
      mean: number;
      median: number;
    };
    timeRange: {
      earliest: number;
      latest: number;
    };
  } {
    if (this.measurements.length === 0) {
      return {
        totalMeasurements: 0,
        programs: {},
        instructions: {},
        latencyStats: { min: 0, max: 0, mean: 0, median: 0 },
        timeRange: { earliest: 0, latest: 0 }
      };
    }

    const programs: { [key: string]: number } = {};
    const instructions: { [key: string]: number } = {};
    const latencies = this.measurements.map(m => m.transactionLatency);
    const timestamps = this.measurements.map(m => m.timestamp);

    this.measurements.forEach(measurement => {
      programs[measurement.programId] = (programs[measurement.programId] || 0) + 1;
      instructions[measurement.instruction] = (instructions[measurement.instruction] || 0) + 1;
    });

    latencies.sort((a, b) => a - b);
    
    return {
      totalMeasurements: this.measurements.length,
      programs,
      instructions,
      latencyStats: {
        min: Math.min(...latencies),
        max: Math.max(...latencies),
        mean: latencies.reduce((sum, l) => sum + l, 0) / latencies.length,
        median: latencies[Math.floor(latencies.length / 2)]
      },
      timeRange: {
        earliest: Math.min(...timestamps),
        latest: Math.max(...timestamps)
      }
    };
  }

  /**
   * Save single measurement to file
   */
  private async saveMeasurementToFile(measurement: LatencyMeasurement): Promise<void> {
    const filename = this.generateDailyFilename();
    const filePath = path.join(this.config.outputDirectory, filename);
    
    try {
      // Try to read existing file
      let existingData: LatencyMeasurement[] = [];
      try {
        const existingContent = await fs.promises.readFile(filePath, 'utf8');
        const parsed = JSON.parse(existingContent);
        existingData = Array.isArray(parsed) ? parsed : parsed.measurements || [];
      } catch {
        // File doesn't exist or is empty
      }

      existingData.push(measurement);
      
      const fileData = {
        lastUpdated: new Date().toISOString(),
        totalMeasurements: existingData.length,
        measurements: existingData
      };

      await fs.promises.writeFile(filePath, JSON.stringify(fileData, null, 2));
    } catch (error) {
      console.error(`Failed to save measurement to ${filePath}:`, error);
    }
  }

  /**
   * Save multiple measurements to file
   */
  private async saveMeasurementsToFile(measurements: LatencyMeasurement[]): Promise<void> {
    const filename = this.generateDailyFilename();
    const filePath = path.join(this.config.outputDirectory, filename);
    
    try {
      // Try to read existing file
      let existingData: LatencyMeasurement[] = [];
      try {
        const existingContent = await fs.promises.readFile(filePath, 'utf8');
        const parsed = JSON.parse(existingContent);
        existingData = Array.isArray(parsed) ? parsed : parsed.measurements || [];
      } catch {
        // File doesn't exist or is empty
      }

      existingData.push(...measurements);
      
      const fileData = {
        lastUpdated: new Date().toISOString(),
        totalMeasurements: existingData.length,
        measurements: existingData
      };

      await fs.promises.writeFile(filePath, JSON.stringify(fileData, null, 2));
    } catch (error) {
      console.error(`Failed to save measurements to ${filePath}:`, error);
    }
  }

  /**
   * Generate daily filename for measurements
   */
  private generateDailyFilename(): string {
    const today = new Date().toISOString().split('T')[0];
    return `daily-measurements-${today}.json`;
  }

  /**
   * Ensure directory exists
   */
  private ensureDirectoryExists(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  /**
   * Start auto-save timer
   */
  private startAutoSave(): void {
    this.autoSaveTimer = setInterval(async () => {
      try {
        await this.exportToFile('auto-save-latest.json');
      } catch (error) {
        console.error('Auto-save failed:', error);
      }
    }, this.config.autoSaveInterval);
  }

  /**
   * Stop auto-save timer
   */
  stopAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = undefined;
    }
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    this.stopAutoSave();
    this.clearMeasurements();
  }
}
