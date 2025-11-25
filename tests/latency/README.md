# GridTokenX Latency Measurement Framework

This framework provides comprehensive latency measurement and performance analysis capabilities for all GridTokenX Anchor programs. It enables systematic testing, monitoring, and optimization of blockchain operations.

## 🎯 Features

- **High-Precision Timing**: Sub-millisecond accuracy using `performance.now()`
- **Multi-Dimensional Tracking**: Transaction, instruction, CPI, and end-to-end latency
- **Statistical Analysis**: Mean, median, percentiles, and outlier detection
- **Real-time Monitoring**: Live performance dashboards
- **Automated Reporting**: Scheduled performance reports with recommendations
- **Load Testing**: Concurrent user simulation and throughput analysis
- **Trend Analysis**: Performance degradation/improvement detection
- **Regression Detection**: Automatic identification of performance regressions

## 📁 Framework Structure

```
tests/latency/
├── framework/
│   ├── index.ts                    # Main exports and factory functions
│   ├── latency-measurer.ts         # Core measurement engine
│   ├── performance-tracker.ts       # High-precision timing
│   ├── data-collector.ts           # Data storage and management
│   └── performance-analyzer.ts     # Statistical analysis
├── programs/
│   └── energy-token-latency.test.ts # Energy Token tests
├── run-latency-tests.ts           # Test runner script
└── README.md                      # This file
```

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Run Basic Latency Tests

```bash
# Run demonstration test suite (demo - works without compilation)
npm run test:latency:demo

# Run full framework (requires TypeScript compilation)
npm run test:latency

# Run program-specific tests
npm run test:latency:energy-token
npm run test:latency:governance
npm run test:latency:oracle
npm run test:latency:registry
npm run test:latency:trading
```

### 3. Run Program-Specific Tests

```bash
# Run Energy Token latency tests
npm test -- tests/latency/programs/energy-token-latency.test.ts
```

## Usage Examples

### Basic Operation Measurement

```typescript
import { createLatencyFramework } from './tests/latency/framework';

// Initialize framework
const framework = createLatencyFramework({
  connection: new Connection('http://127.0.0.1:8899'),
  dataCollection: {
    enableFileStorage: true,
    outputDirectory: './test-results/latency'
  },
  analysis: {
    enableOutlierDetection: true,
    enableTrendAnalysis: true
  }
});

// Measure a single operation
const { measurement } = await framework.measureOperation(
  'energy_token_program',
  'mint_tokens',
  async () => {
    const signature = await energyTokenProgram.methods.mintTokens(amount).rpc();
    return { signature, result: { success: true } };
  }
);

console.log(`Latency: ${measurement.transactionLatency}ms`);
```

### Batch Testing

```typescript
// Run a test scenario with multiple iterations
const metrics = await framework.runTestScenario(
  {
    name: 'batch_minting',
    description: 'Test batch token minting performance',
    iterations: 100,
    concurrency: 1,
    delay: 50 // 50ms between operations
  },
  'energy_token_program',
  async () => {
    const signature = await energyTokenProgram.methods.mintTokens(amount).rpc();
    return { signature, result: { processed: true } };
  }
);

console.log(`Average Latency: ${metrics.latency.mean}ms`);
console.log(`P95 Latency: ${metrics.latency.p95}ms`);
console.log(`Throughput: ${metrics.throughput.tps} TPS`);
```

### Concurrent Testing

```typescript
// Test concurrent operations
const concurrentMetrics = await framework.measurer.runConcurrentScenario(
  {
    name: 'concurrent_operations',
    description: 'Test concurrent user operations',
    iterations: 0,
    concurrency: 50,
    delay: 0
  },
  async () => {
    const signature = await energyTokenProgram.methods.mintTokens(amount).rpc();
    return { signature, result: { userId: Math.random() } };
  }
);

console.log(`Concurrent Average: ${concurrentMetrics.latency.mean}ms`);
console.log(`Error Rate: ${concurrentMetrics.errors.rate}%`);
```

### Performance Analysis

```typescript
// Generate comprehensive performance report
const report = framework.generateReport();

console.log('Performance Summary:');
console.log(`- Total Measurements: ${report.summary.totalMeasurements}`);
console.log(`- Average Latency: ${report.summary.averageLatency}ms`);
console.log(`- P95 Latency: ${report.summary.p95}ms`);
console.log(`- Outlier Rate: ${report.summary.outlierRate}%`);

console.log('Trend Analysis:');
console.log(`- Direction: ${report.trends.direction}`);
console.log(`- Confidence: ${(report.trends.confidence * 100)}%`);

console.log('Recommendations:');
report.recommendations.forEach(rec => console.log(`- ${rec}`));

// Export detailed report
await framework.exportReport('performance-report.json');
```

## Configuration Options

### Data Collection Config

```typescript
interface DataCollectionConfig {
  outputDirectory: string;           // Output directory for reports
  enableFileStorage: boolean;         // Save measurements to files
  enableMemoryStorage: boolean;        // Keep measurements in memory
  maxMemoryRecords: number;           // Maximum records in memory
  autoSave: boolean;                  // Enable auto-save
  autoSaveInterval: number;            // Auto-save interval (ms)
}
```

### Analysis Config

```typescript
interface AnalysisConfig {
  enableOutlierDetection: boolean;     // Detect outlier measurements
  outlierThreshold: number;            // Standard deviation threshold
  enableTrendAnalysis: boolean;       // Analyze performance trends
  enablePercentileCalculation: boolean; // Calculate percentiles
  enableRegressionDetection: boolean;   // Detect performance regressions
}
```

## 📈 Performance Metrics

The framework tracks the following metrics:

### Latency Metrics
- **Transaction Latency**: Total time from submission to confirmation
- **Instruction Latency**: Time spent in program instruction execution
- **CPI Latency**: Time spent in cross-program invocations
- **End-to-End Latency**: Complete workflow latency

### Statistical Metrics
- **Mean**: Average latency across all measurements
- **Median**: 50th percentile latency
- **Percentiles**: P50, P90, P95, P99
- **Standard Deviation**: Latency variability
- **Outlier Rate**: Percentage of outlier measurements

### Performance Metrics
- **Throughput**: Transactions per second (TPS)
- **Error Rate**: Percentage of failed operations
- **Success Rate**: Percentage of successful operations

## 🎯 Test Scenarios

### Single Operation Tests
Measure individual operation latency for baseline performance characterization.

### Batch Operation Tests
Test performance under sustained load with multiple sequential operations.

### Concurrent Operation Tests
Evaluate system behavior under concurrent user load.

### Mixed Workload Tests
Simulate real-world usage patterns with varied operation types.

### Load Testing
Test system limits with high-volume operation scenarios.

## 📊 Reports and Analysis

### Performance Summary
Comprehensive overview of all performance metrics with statistical analysis.

### Trend Analysis
Performance evolution over time with directional indicators.

### Regression Detection
Automatic identification of performance degradations.

### Recommendations
Actionable insights for performance optimization.

## 🔍 Integration with CI/CD

### GitHub Actions Example

```yaml
name: Latency Tests
on: [push, pull_request]

jobs:
  latency-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Setup Solana
        run: |
          sh -c "$(curl -sSfL https://release.solana.com/v1.10.32/install)"
      - name: Install Dependencies
        run: npm install
      - name: Start Local Validator
        run: solana-test-validator &
      - name: Run Latency Tests
        run: npm run test:latency
      - name: Upload Reports
        uses: actions/upload-artifact@v2
        with:
          name: latency-reports
          path: test-results/latency/
```

### Performance Gates

Configure automated checks to prevent performance regressions:

```typescript
// Example: Fail if latency exceeds thresholds
if (metrics.latency.mean > 500) {
  throw new Error('Average latency exceeds 500ms threshold');
}

if (metrics.latency.p95 > 1000) {
  throw new Error('P95 latency exceeds 1000ms threshold');
}

if (metrics.throughput.tps < 10) {
  throw new Error('Throughput below 10 TPS threshold');
}
```

## 🛠️ Development

### Adding New Programs

1. Create test file in `tests/latency/programs/`
2. Import the framework:
   ```typescript
   import { createLatencyFramework } from '../framework';
   ```
3. Define program ID and operations
4. Implement test scenarios using framework methods
5. Add performance assertions and thresholds

### Extending Framework

The framework is modular and extensible:

- **PerformanceTracker**: Add new timing methods
- **DataCollector**: Add new storage backends
- **PerformanceAnalyzer**: Add new analysis algorithms
- **LatencyMeasurer**: Add new measurement types

## 📝️ Best Practices

### Test Design
- Use realistic workloads that mirror production usage
- Include both happy path and edge case scenarios
- Test under varying network conditions
- Measure during different times of day

### Performance Targets
- Set specific, measurable targets for each operation
- Consider both average and percentile targets
- Account for network variability
- Include safety margins in targets

### Data Analysis
- Look for patterns in performance degradation
- Correlate performance with system metrics
- Identify bottlenecks through measurement segmentation
- Track improvements over time

## 🐛 Troubleshooting

### Common Issues

**High Latency Measurements**
- Check network connectivity
- Verify validator health
- Monitor compute unit consumption
- Review transaction size

**Inconsistent Measurements**
- Ensure consistent test environment
- Check for network congestion
- Verify test data consistency
- Review measurement methodology

**Memory Issues**
- Reduce `maxMemoryRecords` setting
- Enable file-based storage
- Increase cleanup frequency
- Monitor memory usage during tests

### Debug Mode

Enable detailed logging:

```typescript
const framework = createLatencyFramework({
  connection,
  analysis: {
    enableDebugLogging: true // Enable verbose output
  }
});
```

## 📚 API Reference

### Core Classes

- **LatencyMeasurer**: Main measurement engine
- **PerformanceTracker**: High-precision timing utilities
- **DataCollector**: Data storage and export
- **PerformanceAnalyzer**: Statistical analysis and reporting

### Key Interfaces

- **LatencyMeasurement**: Individual measurement data
- **TestScenario**: Test configuration
- **PerformanceMetrics**: Calculated performance data
- **PerformanceSummary**: Statistical summary

## 🤝 Contributing

1. Fork the repository
2. Create feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit pull request with detailed description

## 📄 License

This framework is part of the GridTokenX project and follows the same licensing terms.

## 📞 Support

For questions, issues, or contributions:
- Create an issue in the project repository
- Review the planning document: `docs/latency-measurement-plan.md`
- Check existing test examples for patterns
