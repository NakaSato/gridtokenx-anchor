/**
 * Data Collector for storing and managing latency measurements
 */
import * as fs from 'fs';
import * as path from 'path';
export class DataCollector {
    constructor(config = {}) {
        this.measurements = [];
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
    async recordMeasurement(measurement) {
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
    async recordMeasurements(measurements) {
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
    getMeasurements() {
        return [...this.measurements];
    }
    /**
     * Get measurements by program ID
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
     * Get measurements by time range
     */
    getMeasurementsByTimeRange(startTime, endTime) {
        return this.measurements.filter(m => m.timestamp >= startTime && m.timestamp <= endTime);
    }
    /**
     * Get measurements by latency range
     */
    getMeasurementsByLatencyRange(minLatency, maxLatency) {
        return this.measurements.filter(m => m.transactionLatency >= minLatency && m.transactionLatency <= maxLatency);
    }
    /**
     * Clear measurements from memory
     */
    clearMeasurements() {
        this.measurements = [];
    }
    /**
     * Export measurements to JSON
     */
    async exportToFile(filename) {
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
    async importFromFile(filePath) {
        try {
            const data = await fs.promises.readFile(filePath, 'utf8');
            const parsed = JSON.parse(data);
            let measurements;
            if (Array.isArray(parsed)) {
                // Legacy format - direct array
                measurements = parsed;
            }
            else if (parsed.measurements && Array.isArray(parsed.measurements)) {
                // New format - with metadata
                measurements = parsed.measurements;
            }
            else {
                throw new Error('Invalid file format');
            }
            if (this.config.enableMemoryStorage) {
                this.measurements.push(...measurements);
            }
            return measurements;
        }
        catch (error) {
            throw new Error(`Failed to import measurements from ${filePath}: ${error}`);
        }
    }
    /**
     * Get performance statistics
     */
    getStatistics() {
        if (this.measurements.length === 0) {
            return {
                totalMeasurements: 0,
                programs: {},
                instructions: {},
                latencyStats: { min: 0, max: 0, mean: 0, median: 0 },
                timeRange: { earliest: 0, latest: 0 }
            };
        }
        const programs = {};
        const instructions = {};
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
    async saveMeasurementToFile(measurement) {
        const filename = this.generateDailyFilename();
        const filePath = path.join(this.config.outputDirectory, filename);
        try {
            // Try to read existing file
            let existingData = [];
            try {
                const existingContent = await fs.promises.readFile(filePath, 'utf8');
                const parsed = JSON.parse(existingContent);
                existingData = Array.isArray(parsed) ? parsed : parsed.measurements || [];
            }
            catch {
                // File doesn't exist or is empty
            }
            existingData.push(measurement);
            const fileData = {
                lastUpdated: new Date().toISOString(),
                totalMeasurements: existingData.length,
                measurements: existingData
            };
            await fs.promises.writeFile(filePath, JSON.stringify(fileData, null, 2));
        }
        catch (error) {
            console.error(`Failed to save measurement to ${filePath}:`, error);
        }
    }
    /**
     * Save multiple measurements to file
     */
    async saveMeasurementsToFile(measurements) {
        const filename = this.generateDailyFilename();
        const filePath = path.join(this.config.outputDirectory, filename);
        try {
            // Try to read existing file
            let existingData = [];
            try {
                const existingContent = await fs.promises.readFile(filePath, 'utf8');
                const parsed = JSON.parse(existingContent);
                existingData = Array.isArray(parsed) ? parsed : parsed.measurements || [];
            }
            catch {
                // File doesn't exist or is empty
            }
            existingData.push(...measurements);
            const fileData = {
                lastUpdated: new Date().toISOString(),
                totalMeasurements: existingData.length,
                measurements: existingData
            };
            await fs.promises.writeFile(filePath, JSON.stringify(fileData, null, 2));
        }
        catch (error) {
            console.error(`Failed to save measurements to ${filePath}:`, error);
        }
    }
    /**
     * Generate daily filename for measurements
     */
    generateDailyFilename() {
        const today = new Date().toISOString().split('T')[0];
        return `daily-measurements-${today}.json`;
    }
    /**
     * Ensure directory exists
     */
    ensureDirectoryExists(dirPath) {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
    }
    /**
     * Start auto-save timer
     */
    startAutoSave() {
        this.autoSaveTimer = setInterval(async () => {
            try {
                await this.exportToFile('auto-save-latest.json');
            }
            catch (error) {
                console.error('Auto-save failed:', error);
            }
        }, this.config.autoSaveInterval);
    }
    /**
     * Stop auto-save timer
     */
    stopAutoSave() {
        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
            this.autoSaveTimer = undefined;
        }
    }
    /**
     * Cleanup resources
     */
    cleanup() {
        this.stopAutoSave();
        this.clearMeasurements();
    }
}
