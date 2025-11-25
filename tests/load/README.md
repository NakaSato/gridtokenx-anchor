# GridTokenX Load Testing Framework

This directory contains comprehensive load testing components for the GridTokenX P2P energy trading platform. The framework tests system behavior under extreme conditions including high transaction volume, concurrent users, and adverse network conditions.

## 📁 File Structure

```
tests/load/
├── load-test-framework.ts      # Core load testing framework
├── high-volume-trading.test.ts # High-volume trading tests (500+ TPM)
├── concurrent-users.test.ts      # Concurrent user tests (100+ users)
├── network-conditions.test.ts    # Network resilience tests
├── run-load-tests.ts          # Test runner and reporting
└── README.md                  # This documentation
```

## 🚀 Quick Start

### Run All Load Tests
```bash
npm run test:load
```

### Run Specific Test Categories
```bash
# High-volume trading tests
npm run test:load:high-volume

# Concurrent user tests  
npm run test:load:concurrent

# Network condition tests
npm run test:load:network

# Using the advanced runner
npm run test:load -- --category high-volume
npm run test:load -- --category concurrent
npm run test:load -- --category network
```

## 📊 Test Categories

### 1. High-Volume Trading Tests (`high-volume-trading.test.ts`)

Tests the system under extreme trading volumes:

- **500+ Trades/Minute Simulation**: Sustained high-volume trading for 5+ minutes
- **Burst Trading Patterns**: 1000 trades in 30 seconds
- **10,000+ Active Orders**: Large order book management
- **Sustained Load Testing**: Performance over extended periods
- **Memory Usage Monitoring**: Resource consumption under load

**Success Criteria:**
- ≥95% success rate for sustained operations
- ≥90% success rate for burst operations
- Average latency <1s for normal operations
- Memory growth <500MB during tests

### 2. Concurrent User Tests (`concurrent-users.test.ts`)

Tests system behavior with many simultaneous users:

- **100+ Simultaneous Users**: Realistic multi-user scenarios
- **Data Isolation**: Verify user data privacy and separation
- **Connection Pool Exhaustion**: Graceful handling of resource limits
- **Memory Pressure**: Performance under memory constraints
- **User Experience Metrics**: Response time and satisfaction

**Success Criteria:**
- ≥90% success rate with 100 concurrent users
- Zero data leakage between users
- ≥70% good/excellent user experience ratings
- Graceful degradation under resource pressure

### 3. Network Condition Tests (`network-conditions.test.ts`)

Tests resilience under adverse network conditions:

- **High Latency**: 1000ms+ network delays
- **Variable Latency**: Fluctuating network conditions (100-2100ms)
- **Packet Loss**: 5-15% packet loss with retry mechanisms
- **Network Partitions**: Temporary disconnections and recovery
- **Bandwidth Limitation**: Limited transfer rates

**Success Criteria:**
- ≥95% success rate under 1000ms latency
- ≥85% success rate with 5% packet loss
- Effective retry mechanisms
- Graceful recovery from partitions

## 🛠️ Framework Components

### LoadTestFramework (`load-test-framework.ts`)

Core testing infrastructure providing:

- **Session Management**: Track test sessions and metrics
- **Performance Monitoring**: Real-time metrics collection
- **Network Simulation**: Latency, packet loss, partition simulation
- **Concurrent Execution**: Controlled parallel operation execution
- **Result Storage**: Automatic result saving and analysis

### LoadTestDataGenerator

Generates realistic test data:

- **Trading Orders**: Various order types and sizes
- **User Scenarios**: Different user behavior patterns
- **Network Conditions**: Configurable network stress scenarios
- **Market Data**: Realistic energy trading data

## 📈 Metrics and Reporting

### Collected Metrics

- **Throughput**: Transactions per second (TPS)
- **Latency**: Response times (average, P95, P99)
- **Success Rate**: Percentage of successful operations
- **Memory Usage**: Resource consumption tracking
- **Error Analysis**: Failure categorization and trends

### Report Generation

The framework automatically generates comprehensive reports:

```json
{
  "summary": {
    "totalTests": 3,
    "passed": 2,
    "failed": 1,
    "successRate": 66.7,
    "totalDuration": 1800000,
    "timestamp": "2025-11-25T10:00:00.000Z"
  },
  "results": [...],
  "recommendations": [...]
}
```

### Result Storage

Results are saved to `test-results/load/`:
- `load-test-report-{timestamp}.json`: Detailed test reports
- `auto-save-latest.json`: Most recent results
- Historical comparison data

## ⚙️ Configuration

### Environment Setup

Ensure the following are available:
- Local Solana validator running on `http://localhost:8899`
- Sufficient system resources (8GB+ RAM recommended)
- Node.js 18+ with TypeScript support

### Test Parameters

Key configuration options:

```typescript
interface LoadTestConfig {
  targetTPS: number;           // Target transactions per second
  testDuration: number;         // Test duration in milliseconds
  concurrency: number;          // Concurrent operations
  networkLatency: number;       // Simulated network delay
  packetLossRate: number;       // Packet loss percentage (0-1)
  memoryThreshold: number;       // Memory limit in bytes
}
```

## 🔍 Troubleshooting

### Common Issues

1. **Test Timeouts**
   - Increase timeout values in test configuration
   - Check system resource availability
   - Verify Solana validator is running

2. **High Failure Rates**
   - Review network condition simulations
   - Check for resource exhaustion
   - Validate test data generation

3. **Performance Degradation**
   - Monitor memory usage during tests
   - Check for connection pool limits
   - Analyze garbage collection impact

### Debug Mode

Enable detailed logging:

```bash
DEBUG=load-testing npm run test:load
```

## 📋 Best Practices

### Test Execution

1. **Environment Isolation**: Use dedicated test environment
2. **Resource Monitoring**: Monitor system resources during tests
3. **Baseline Comparison**: Compare with previous test results
4. **Gradual Scaling**: Start with smaller loads and increase gradually

### Performance Optimization

1. **Connection Pooling**: Reuse connections when possible
2. **Batch Operations**: Group related transactions
3. **Caching**: Implement intelligent caching strategies
4. **Retry Logic**: Handle transient failures gracefully

### Production Deployment

1. **Load Testing**: Run comprehensive tests before releases
2. **Monitoring**: Set up production performance monitoring
3. **Alerting**: Configure performance-based alerts
4. **Capacity Planning**: Plan for peak loads

## 🔗 Integration with CI/CD

### GitHub Actions Example

```yaml
name: Load Tests
on: [push, pull_request]
jobs:
  load-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      - run: npm install
      - run: npm run test:load
      - uses: actions/upload-artifact@v2
        with:
          name: load-test-results
          path: test-results/load/
```

### Performance Gates

Set performance thresholds in your CI pipeline:

```json
{
  "performanceGates": {
    "minSuccessRate": 95,
    "maxAverageLatency": 1000,
    "minThroughput": 50,
    "maxMemoryGrowth": 500000000
  }
}
```

## 📚 Advanced Usage

### Custom Test Scenarios

Create custom load tests by extending the framework:

```typescript
import { LoadTestFramework } from './load-test-framework.js';

const framework = new LoadTestFramework(connection);

// Custom test logic
await framework.executeTransaction(
  sessionId,
  async () => {
    // Your custom operation
    return result;
  },
  "Custom Test Description"
);
```

### Performance Benchmarking

Generate performance benchmarks:

```bash
npm run test:load:high-volume -- --benchmark
npm run test:load:concurrent -- --benchmark  
npm run test:load:network -- --benchmark
```

## 🤝 Contributing

When adding new load tests:

1. Follow the existing test patterns
2. Include comprehensive error handling
3. Add performance assertions
4. Update documentation
5. Add relevant NPM scripts

## 📞 Support

For issues or questions about the load testing framework:

1. Check this README for troubleshooting
2. Review test results and logs
3. Examine the testing implementation files
4. Consider system resources and environment
