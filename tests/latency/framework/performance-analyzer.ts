/**
 * Performance Analyzer for calculating metrics and analyzing latency data
 */

import { LatencyMeasurement, PerformanceMetrics } from './latency-measurer';

export interface AnalysisConfig {
  enableOutlierDetection: boolean;
  outlierThreshold: number; // Standard deviations from mean
  enableTrendAnalysis: boolean;
  enablePercentileCalculation: boolean;
  enableRegressionDetection: boolean;
}

export interface PerformanceSummary {
  totalMeasurements: number;
  averageLatency: number;
  medianLatency: number;
  minLatency: number;
  maxLatency: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  standardDeviation: number;
  outliers: number;
  outlierRate: number;
}

export interface TrendAnalysis {
  direction: 'improving' | 'degrading' | 'stable';
  confidence: number; // 0-1
  slope: number; // Latency change per unit time
  correlation: number; // Correlation coefficient
}

export interface RegressionDetection {
  detected: boolean;
  baselineLatency: number;
  currentLatency: number;
  regressionPercentage: number;
  confidence: number;
}

export class PerformanceAnalyzer {
  private config: AnalysisConfig;
  private baselineMetrics: Map<string, PerformanceSummary> = new Map();

  constructor(config: Partial<AnalysisConfig> = {}) {
    this.config = {
      enableOutlierDetection: true,
      outlierThreshold: 2.0,
      enableTrendAnalysis: true,
      enablePercentileCalculation: true,
      enableRegressionDetection: true,
      ...config
    };
  }

  /**
   * Calculate performance metrics from measurements
   */
  calculateMetrics(
    operation: string,
    measurements: LatencyMeasurement[],
    duration: number,
    errors: { type: string; count: number }[] = []
  ): PerformanceMetrics {
    if (measurements.length === 0) {
      return this.createEmptyMetrics(operation);
    }

    const latencies = measurements.map(m => m.transactionLatency);
    const latencyStats = this.calculateLatencyStats(latencies);
    const throughput = this.calculateThroughput(measurements.length, duration);
    const errorStats = this.calculateErrorStats(errors, measurements.length);

    return {
      timestamp: Date.now(),
      programId: measurements[0]?.programId || 'unknown',
      operation,
      latency: latencyStats,
      throughput,
      errors: errorStats
    };
  }

  /**
   * Calculate comprehensive latency statistics
   */
  calculateLatencyStats(latencies: number[]): PerformanceMetrics['latency'] {
    const sorted = [...latencies].sort((a, b) => a - b);
    const mean = latencies.reduce((sum, l) => sum + l, 0) / latencies.length;
    const variance = latencies.reduce((sum, l) => sum + Math.pow(l - mean, 2), 0) / latencies.length;
    const stdDev = Math.sqrt(variance);

    const outliers = this.config.enableOutlierDetection 
      ? this.detectOutliers(latencies, mean, stdDev)
      : [];

    return {
      min: Math.min(...latencies),
      max: Math.max(...latencies),
      mean,
      p50: this.percentile(sorted, 50),
      p95: this.percentile(sorted, 95),
      p99: this.percentile(sorted, 99)
    };
  }

  /**
   * Calculate throughput metrics
   */
  private calculateThroughput(operations: number, duration: number): PerformanceMetrics['throughput'] {
    return {
      operations,
      duration,
      tps: duration > 0 ? (operations / duration) * 1000 : 0 // Convert to operations per second
    };
  }

  /**
   * Calculate error statistics
   */
  private calculateErrorStats(
    errors: { type: string; count: number }[],
    totalOperations: number
  ): PerformanceMetrics['errors'] {
    const totalErrors = errors.reduce((sum, e) => sum + e.count, 0);
    const errorTypes = errors.map(e => e.type);

    return {
      count: totalErrors,
      rate: totalOperations > 0 ? (totalErrors / totalOperations) * 100 : 0,
      types: [...new Set(errorTypes)]
    };
  }

  /**
   * Detect outliers in latency data
   */
  private detectOutliers(latencies: number[], mean: number, stdDev: number): number[] {
    const threshold = this.config.outlierThreshold * stdDev;
    return latencies.filter(latency => 
      Math.abs(latency - mean) > threshold
    );
  }

  /**
   * Calculate percentile value
   */
  private percentile(sorted: number[], p: number): number {
    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    
    if (lower === upper) {
      return sorted[lower];
    }
    
    const weight = index - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  /**
   * Create empty metrics structure
   */
  private createEmptyMetrics(operation: string): PerformanceMetrics {
    return {
      timestamp: Date.now(),
      programId: 'unknown',
      operation,
      latency: {
        min: 0,
        max: 0,
        mean: 0,
        p50: 0,
        p95: 0,
        p99: 0
      },
      throughput: {
        operations: 0,
        duration: 0,
        tps: 0
      },
      errors: {
        count: 0,
        rate: 0,
        types: []
      }
    };
  }

  /**
   * Analyze performance trends over time
   */
  analyzeTrends(measurements: LatencyMeasurement[], windowSize: number = 100): TrendAnalysis {
    if (measurements.length < windowSize || !this.config.enableTrendAnalysis) {
      return {
        direction: 'stable',
        confidence: 0,
        slope: 0,
        correlation: 0
      };
    }

    // Use sliding window analysis
    const windows: Array<{ time: number; avgLatency: number }> = [];
    
    for (let i = windowSize; i <= measurements.length; i++) {
      const window = measurements.slice(i - windowSize, i);
      const avgLatency = window.reduce((sum, m) => sum + m.transactionLatency, 0) / window.length;
      windows.push({
        time: window[window.length - 1].timestamp,
        avgLatency
      });
    }

    if (windows.length < 2) {
      return {
        direction: 'stable',
        confidence: 0,
        slope: 0,
        correlation: 0
      };
    }

    return this.calculateLinearRegression(windows);
  }

  /**
   * Calculate linear regression for trend analysis
   */
  private calculateLinearRegression(points: Array<{ time: number; avgLatency: number }>): TrendAnalysis {
    const n = points.length;
    const sumX = points.reduce((sum, p) => sum + p.time, 0);
    const sumY = points.reduce((sum, p) => sum + p.avgLatency, 0);
    const sumXY = points.reduce((sum, p) => sum + p.time * p.avgLatency, 0);
    const sumXX = points.reduce((sum, p) => sum + p.time * p.time, 0);
    const sumYY = points.reduce((sum, p) => sum + p.avgLatency * p.avgLatency, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const correlation = (n * sumXY - sumX * sumY) / 
      Math.sqrt((n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY));

    let direction: 'improving' | 'degrading' | 'stable';
    const slopeThreshold = 0.01; // ms per millisecond threshold
    
    if (slope > slopeThreshold) {
      direction = 'degrading';
    } else if (slope < -slopeThreshold) {
      direction = 'improving';
    } else {
      direction = 'stable';
    }

    const confidence = Math.abs(correlation);

    return {
      direction,
      confidence,
      slope,
      correlation
    };
  }

  /**
   * Detect performance regression
   */
  detectRegression(
    currentMetrics: PerformanceMetrics,
    baselineOperation?: string
  ): RegressionDetection {
    if (!this.config.enableRegressionDetection) {
      return {
        detected: false,
        baselineLatency: 0,
        currentLatency: 0,
        regressionPercentage: 0,
        confidence: 0
      };
    }

    const operation = baselineOperation || currentMetrics.operation;
    const baseline = this.baselineMetrics.get(operation);

    if (!baseline) {
      // Set current as baseline if none exists
      this.baselineMetrics.set(operation, currentMetrics.latency);
      return {
        detected: false,
        baselineLatency: currentMetrics.latency.mean,
        currentLatency: currentMetrics.latency.mean,
        regressionPercentage: 0,
        confidence: 0
      };
    }

    const regressionThreshold = 0.20; // 20% degradation threshold
    const currentLatency = currentMetrics.latency.mean;
    const baselineLatency = baseline.mean;
    const regressionPercentage = ((currentLatency - baselineLatency) / baselineLatency) * 100;

    const detected = regressionPercentage > (regressionThreshold * 100);
    const confidence = Math.min(Math.abs(regressionPercentage) / 100, 1);

    return {
      detected,
      baselineLatency,
      currentLatency,
      regressionPercentage,
      confidence
    };
  }

  /**
   * Set baseline metrics for comparison
   */
  setBaseline(operation: string, metrics: PerformanceSummary): void {
    this.baselineMetrics.set(operation, metrics);
  }

  /**
   * Get baseline metrics
   */
  getBaseline(operation: string): PerformanceSummary | undefined {
    return this.baselineMetrics.get(operation);
  }

  /**
   * Compare two performance metrics
   */
  compareMetrics(
    metrics1: PerformanceMetrics,
    metrics2: PerformanceMetrics
  ): {
    latencyImprovement: number;
    throughputImprovement: number;
    errorRateChange: number;
    recommendation: string;
  } {
    const latencyImprovement = ((metrics1.latency.mean - metrics2.latency.mean) / metrics1.latency.mean) * 100;
    const throughputImprovement = ((metrics2.throughput.tps - metrics1.throughput.tps) / metrics1.throughput.tps) * 100;
    const errorRateChange = metrics2.errors.rate - metrics1.errors.rate;

    let recommendation = 'No significant change in performance';
    
    if (Math.abs(latencyImprovement) > 10) {
      if (latencyImprovement > 0) {
        recommendation = 'Latency has improved significantly';
      } else {
        recommendation = 'Latency has degraded significantly';
      }
    } else if (Math.abs(throughputImprovement) > 10) {
      if (throughputImprovement > 0) {
        recommendation = 'Throughput has improved significantly';
      } else {
        recommendation = 'Throughput has degraded significantly';
      }
    } else if (Math.abs(errorRateChange) > 5) {
      if (errorRateChange > 0) {
        recommendation = 'Error rate has increased significantly';
      } else {
        recommendation = 'Error rate has improved';
      }
    }

    return {
      latencyImprovement,
      throughputImprovement,
      errorRateChange,
      recommendation
    };
  }

  /**
   * Generate performance report
   */
  generateReport(measurements: LatencyMeasurement[]): {
    summary: PerformanceSummary;
    trends: TrendAnalysis;
    regressions: RegressionDetection[];
    recommendations: string[];
  } {
    const latencies = measurements.map(m => m.transactionLatency);
    const summary: PerformanceSummary = {
      totalMeasurements: measurements.length,
      averageLatency: latencies.reduce((sum, l) => sum + l, 0) / latencies.length,
      medianLatency: this.percentile([...latencies].sort((a, b) => a - b), 50),
      minLatency: Math.min(...latencies),
      maxLatency: Math.max(...latencies),
      p50: this.percentile([...latencies].sort((a, b) => a - b), 50),
      p90: this.percentile([...latencies].sort((a, b) => a - b), 90),
      p95: this.percentile([...latencies].sort((a, b) => a - b), 95),
      p99: this.percentile([...latencies].sort((a, b) => a - b), 99),
      standardDeviation: Math.sqrt(
        latencies.reduce((sum, l) => sum + Math.pow(l - (latencies.reduce((s, li) => s + li, 0) / latencies.length), 2), 0) / latencies.length
      ),
      outliers: this.detectOutliers(latencies, latencies.reduce((sum, l) => sum + l, 0) / latencies.length, Math.sqrt(latencies.reduce((sum, l) => sum + Math.pow(l - (latencies.reduce((s, li) => s + li, 0) / latencies.length), 2), 0) / latencies.length)).length,
      outlierRate: (this.detectOutliers(latencies, latencies.reduce((sum, l) => sum + l, 0) / latencies.length, Math.sqrt(latencies.reduce((sum, l) => sum + Math.pow(l - (latencies.reduce((s, li) => s + li, 0) / latencies.length), 2), 0) / latencies.length)).length / latencies.length) * 100
    };

    const trends = this.analyzeTrends(measurements);
    
    // Check for regressions in different program operations
    const programGroups = this.groupMeasurementsByProgram(measurements);
    const regressions: RegressionDetection[] = [];
    
    for (const [programId, programMeasurements] of programGroups.entries()) {
      const metrics = this.calculateMetrics(programId, programMeasurements, 0);
      const regression = this.detectRegression(metrics);
      if (regression.detected) {
        regressions.push(regression);
      }
    }

    const recommendations = this.generateRecommendations(summary, trends, regressions);

    return {
      summary,
      trends,
      regressions,
      recommendations
    };
  }

  /**
   * Group measurements by program ID
   */
  private groupMeasurementsByProgram(measurements: LatencyMeasurement[]): Map<string, LatencyMeasurement[]> {
    const groups = new Map<string, LatencyMeasurement[]>();
    
    measurements.forEach(measurement => {
      const programMeasurements = groups.get(measurement.programId) || [];
      programMeasurements.push(measurement);
      groups.set(measurement.programId, programMeasurements);
    });

    return groups;
  }

  /**
   * Generate performance recommendations
   */
  private generateRecommendations(
    summary: PerformanceSummary,
    trends: TrendAnalysis,
    regressions: RegressionDetection[]
  ): string[] {
    const recommendations: string[] = [];

    // Latency recommendations
    if (summary.averageLatency > 500) {
      recommendations.push('Average latency exceeds 500ms - consider optimizing critical paths');
    }

    if (summary.p95 > 1000) {
      recommendations.push('P95 latency exceeds 1 second - investigate performance bottlenecks');
    }

    // Outlier recommendations
    if (summary.outlierRate > 10) {
      recommendations.push('High outlier rate detected - investigate system stability');
    }

    // Trend recommendations
    if (trends.direction === 'degrading' && trends.confidence > 0.7) {
      recommendations.push('Performance degrading over time - conduct root cause analysis');
    }

    // Regression recommendations
    if (regressions.length > 0) {
      recommendations.push(`Performance regressions detected in ${regressions.length} programs`);
    }

    // Variability recommendations
    const coefficientOfVariation = summary.standardDeviation / summary.averageLatency;
    if (coefficientOfVariation > 0.3) {
      recommendations.push('High latency variability - system may be unstable');
    }

    if (recommendations.length === 0) {
      recommendations.push('Performance is within acceptable parameters');
    }

    return recommendations;
  }
}
