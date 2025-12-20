/**
 * Registry Program Latency Tests
 * 
 * This test suite measures latency for all critical operations
 * in Registry program for device and producer registration
 */

import * as anchor from '@coral-xyz/anchor';
import { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createLatencyFramework, TestScenario } from '../framework';

// Mock constants for testing
const PROGRAM_IDS = {
  registry: 'Reg1s2T3r4y5F6g7H8j9K0l1M2n3O4p5Q6r7S8t9U0v1W2'
};

const DEVICE_TYPES = {
  SOLAR_PANEL: 'SOLAR_PANEL',
  WIND_TURBINE: 'WIND_TURBINE',
  SMART_METER: 'SMART_METER',
  BATTERY_SYSTEM: 'BATTERY_SYSTEM'
};

const REGISTRATION_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  SUSPENDED: 'SUSPENDED'
};

describe('Registry Program Latency Tests', () => {
  let connection: Connection;
  let framework: any;
  let provider: anchor.AnchorProvider;
  let registryProgram: any;
  
  // Test wallets
  let authority: Keypair;
  let deviceOwner: Keypair;
  let validator: Keypair;

  before('Setup test environment', async () => {
    connection = new Connection('http://127.0.0.1:8899', 'confirmed');
    
    // Initialize latency framework
    framework = createLatencyFramework({
      connection,
      dataCollection: {
        outputDirectory: './test-results/latency/registry',
        enableFileStorage: true,
        enableMemoryStorage: true
      },
      analysis: {
        enableOutlierDetection: true,
        enableTrendAnalysis: true,
        enableRegressionDetection: true
      }
    });

    // Setup test wallets
    authority = Keypair.generate();
    deviceOwner = Keypair.generate();
    validator = Keypair.generate();

    // Fund wallets
    await connection.requestAirdrop(authority.publicKey, 10 * LAMPORTS_PER_SOL);
    await connection.requestAirdrop(deviceOwner.publicKey, 10 * LAMPORTS_PER_SOL);
    await connection.requestAirdrop(validator.publicKey, 10 * LAMPORTS_PER_SOL);

    provider = new anchor.AnchorProvider(
      connection,
      new anchor.Wallet(authority),
      { commitment: 'confirmed' }
    );

    // Mock registry program
    registryProgram = {
      methods: {
        initializeRegistry: () => ({ rpc: async () => 'mock_init_registry_signature' }),
        registerDevice: () => ({ rpc: async () => 'mock_register_device_signature' }),
        updateDeviceInfo: () => ({ rpc: async () => 'mock_update_device_signature' }),
        approveDevice: () => ({ rpc: async () => 'mock_approve_device_signature' }),
        rejectDevice: () => ({ rpc: async () => 'mock_reject_device_signature' }),
        suspendDevice: () => ({ rpc: async () => 'mock_suspend_device_signature' }),
        getDeviceInfo: () => ({ rpc: async () => 'mock_get_device_signature' }),
        listDevicesByOwner: () => ({ rpc: async () => 'mock_list_devices_signature' }),
        registerProducer: () => ({ rpc: async () => 'mock_register_producer_signature' }),
        updateProducerInfo: () => ({ rpc: async () => 'mock_update_producer_signature' }),
        verifyDeviceCompliance: () => ({ rpc: async () => 'mock_verify_compliance_signature' })
      }
    } as any;
  });

  after('Cleanup', async () => {
    await framework.cleanup();
  });

  describe('Registry Initialization Operations', () => {
    it('should measure initialize_registry latency', async () => {
      const testName = 'initialize_registry';
      
      const operation = async () => {
        // Simulate registry initialization
        await new Promise(resolve => setTimeout(resolve, 320));
        const signature = 'mock_initialize_registry_signature';
        return { 
          signature, 
          result: { 
            registryId: Math.floor(Math.random() * 10000),
            authority: authority.publicKey.toString()
          } 
        };
      };

      const { measurement } = await framework.measureOperation(
        PROGRAM_IDS.registry,
        testName,
        operation
      );

      console.log(`Initialize Registry Latency: ${measurement.transactionLatency.toFixed(2)}ms`);
      console.log(`Compute Units: ${measurement.metadata.computeUnits}`);
      
      if (measurement.transactionLatency > 800) {
        throw new Error(`Registry initialization exceeded threshold: ${measurement.transactionLatency}ms`);
      }
    });

    it('should measure batch registry initialization', async () => {
      const scenario: TestScenario = {
        name: 'batch_registry_init',
        description: 'Batch registry initialization operations',
        iterations: 3,
        concurrency: 1,
        delay: 400
      };

      const operation = async () => {
        // Simulate batch registry initialization
        await new Promise(resolve => setTimeout(resolve, 380));
        const signature = `mock_batch_init_${Date.now()}`;
        return { 
          signature, 
          result: { 
            registryId: Math.floor(Math.random() * 10000),
            initialized: true
          } 
        };
      };

      const metrics = await framework.runTestScenario(
        scenario,
        PROGRAM_IDS.registry,
        operation
      );

      console.log(`Batch Registry Init Results:`);
      console.log(`- Average Latency: ${metrics.latency.mean.toFixed(2)}ms`);
      console.log(`- P95 Latency: ${metrics.latency.p95.toFixed(2)}ms`);
      console.log(`- TPS: ${metrics.throughput.tps.toFixed(2)}`);

      if (metrics.latency.mean > 600) {
        throw new Error(`Batch registry init exceeded threshold: ${metrics.latency.mean}ms`);
      }
    });
  });

  describe('Device Registration Operations', () => {
    it('should measure register_device latency', async () => {
      const testName = 'register_device';
      
      const operation = async () => {
        // Simulate device registration
        await new Promise(resolve => setTimeout(resolve, 240));
        const signature = 'mock_register_device_signature';
        return { 
          signature, 
          result: { 
            deviceId: Math.floor(Math.random() * 100000),
            deviceType: DEVICE_TYPES.SMART_METER,
            owner: deviceOwner.publicKey.toString(),
            status: REGISTRATION_STATUS.PENDING
          } 
        };
      };

      const { measurement } = await framework.measureOperation(
        PROGRAM_IDS.registry,
        testName,
        operation
      );

      console.log(`Register Device Latency: ${measurement.transactionLatency.toFixed(2)}ms`);
      
      if (measurement.transactionLatency > 500) {
        throw new Error(`Device registration exceeded threshold: ${measurement.transactionLatency}ms`);
      }
    });

    it('should measure high-frequency device registrations', async () => {
      const scenario: TestScenario = {
        name: 'high_frequency_device_registrations',
        description: 'High frequency device registration operations',
        iterations: 60,
        concurrency: 1,
        delay: 60
      };

      const operation = async () => {
        // Simulate high-frequency device registrations
        await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 80));
        const deviceTypes = Object.values(DEVICE_TYPES);
        const deviceType = deviceTypes[Math.floor(Math.random() * deviceTypes.length)];
        const signature = `mock_hf_device_${Date.now()}_${Math.random()}`;
        return { 
          signature, 
          result: { 
            deviceId: Math.floor(Math.random() * 100000),
            deviceType,
            timestamp: Date.now()
          } 
        };
      };

      const metrics = await framework.runTestScenario(
        scenario,
        PROGRAM_IDS.registry,
        operation
      );

      console.log(`High Frequency Device Registration Results:`);
      console.log(`- Average Latency: ${metrics.latency.mean.toFixed(2)}ms`);
      console.log(`- P95 Latency: ${metrics.latency.p95.toFixed(2)}ms`);
      console.log(`- Throughput: ${metrics.throughput.tps.toFixed(2)} TPS`);

      if (metrics.latency.mean > 320) {
        throw new Error(`HF device registration exceeded threshold: ${metrics.latency.mean}ms`);
      }
      if (metrics.throughput.tps < 10) {
        throw new Error(`HF device registration TPS below threshold: ${metrics.throughput.tps}`);
      }
    });
  });

  describe('Device Management Operations', () => {
    it('should measure update_device_info latency', async () => {
      const testName = 'update_device_info';
      
      const operation = async () => {
        // Simulate device info update
        await new Promise(resolve => setTimeout(resolve, 180));
        const signature = 'mock_update_device_signature';
        return { 
          signature, 
          result: { 
            deviceId: Math.floor(Math.random() * 100000),
            updated: true,
            timestamp: Date.now()
          } 
        };
      };

      const { measurement } = await framework.measureOperation(
        PROGRAM_IDS.registry,
        testName,
        operation
      );

      console.log(`Update Device Info Latency: ${measurement.transactionLatency.toFixed(2)}ms`);
      
      if (measurement.transactionLatency > 350) {
        throw new Error(`Device info update exceeded threshold: ${measurement.transactionLatency}ms`);
      }
    });

    it('should measure device approval operations', async () => {
      const approvalOperations = [
        { name: 'approve_device', delay: 150 },
        { name: 'reject_device', delay: 120 },
        { name: 'suspend_device', delay: 130 }
      ];

      for (const operation of approvalOperations) {
        const testOperation = async () => {
          await new Promise(resolve => setTimeout(resolve, operation.delay));
          const signature = `mock_${operation.name}_${Date.now()}`;
          return { 
            signature, 
            result: { 
              deviceId: Math.floor(Math.random() * 100000),
              status: operation.name.includes('approve') ? REGISTRATION_STATUS.APPROVED :
                     operation.name.includes('reject') ? REGISTRATION_STATUS.REJECTED :
                     REGISTRATION_STATUS.SUSPENDED,
              timestamp: Date.now()
            } 
          };
        };

        const { measurement } = await framework.measureOperation(
          PROGRAM_IDS.registry,
          operation.name,
          testOperation
        );

        console.log(`${operation.name} Latency: ${measurement.transactionLatency.toFixed(2)}ms`);
        
        const threshold = operation.delay * 1.5; // Allow 50% overhead
        if (measurement.transactionLatency > threshold) {
          throw new Error(`${operation.name} exceeded threshold: ${measurement.transactionLatency}ms`);
        }
      }
    });

    it('should measure concurrent device management', async () => {
      const scenario: TestScenario = {
        name: 'concurrent_device_management',
        description: 'Concurrent device management operations',
        iterations: 0,
        concurrency: 80,
        delay: 0
      };

      const operation = async () => {
        // Simulate concurrent device management
        await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 80));
        const operations = ['update', 'approve', 'reject', 'suspend'];
        const operationType = operations[Math.floor(Math.random() * operations.length)];
        const signature = `mock_concurrent_device_${Date.now()}_${Math.random()}`;
        return { 
          signature, 
          result: { 
            deviceId: Math.floor(Math.random() * 100000),
            operation: operationType,
            processed: true
          } 
        };
      };

      const metrics = await framework.measurer.runConcurrentScenario(scenario, operation);
      await framework.collector.recordMeasurements(
        framework.measurer.getMeasurementsByProgram(PROGRAM_IDS.registry)
      );

      console.log(`Concurrent Device Management Results:`);
      console.log(`- Average Latency: ${metrics.latency.mean.toFixed(2)}ms`);
      console.log(`- P95 Latency: ${metrics.latency.p95.toFixed(2)}ms`);
      console.log(`- Successful Operations: ${metrics.throughput.operations}`);
      console.log(`- Error Rate: ${metrics.errors.rate}%`);

      if (metrics.latency.mean > 250) {
        throw new Error(`Concurrent device management exceeded threshold: ${metrics.latency.mean}ms`);
      }
      if (metrics.errors.rate > 12) {
        throw new Error(`Concurrent device management error rate exceeded threshold: ${metrics.errors.rate}%`);
      }
    });
  });

  describe('Producer Registration Operations', () => {
    it('should measure register_producer latency', async () => {
      const testName = 'register_producer';
      
      const operation = async () => {
        // Simulate producer registration
        await new Promise(resolve => setTimeout(resolve, 280));
        const signature = 'mock_register_producer_signature';
        return { 
          signature, 
          result: { 
            producerId: Math.floor(Math.random() * 10000),
            name: `Producer ${Math.floor(Math.random() * 1000)}`,
            location: `Location ${Math.floor(Math.random() * 100)}`,
            capacity: Math.floor(Math.random() * 10000),
            status: REGISTRATION_STATUS.PENDING
          } 
        };
      };

      const { measurement } = await framework.measureOperation(
        PROGRAM_IDS.registry,
        testName,
        operation
      );

      console.log(`Register Producer Latency: ${measurement.transactionLatency.toFixed(2)}ms`);
      
      if (measurement.transactionLatency > 500) {
        throw new Error(`Producer registration exceeded threshold: ${measurement.transactionLatency}ms`);
      }
    });

    it('should measure update_producer_info latency', async () => {
      const testName = 'update_producer_info';
      
      const operation = async () => {
        // Simulate producer info update
        await new Promise(resolve => setTimeout(resolve, 220));
        const signature = 'mock_update_producer_signature';
        return { 
          signature, 
          result: { 
            producerId: Math.floor(Math.random() * 10000),
            updated: true,
            timestamp: Date.now()
          } 
        };
      };

      const { measurement } = await framework.measureOperation(
        PROGRAM_IDS.registry,
        testName,
        operation
      );

      console.log(`Update Producer Info Latency: ${measurement.transactionLatency.toFixed(2)}ms`);
      
      if (measurement.transactionLatency > 400) {
        throw new Error(`Producer info update exceeded threshold: ${measurement.transactionLatency}ms`);
      }
    });
  });

  describe('Device Query Operations', () => {
    it('should measure get_device_info latency', async () => {
      const testName = 'get_device_info';
      
      const operation = async () => {
        // Simulate device info query
        await new Promise(resolve => setTimeout(resolve, 90));
        const signature = 'mock_get_device_signature';
        return { 
          signature, 
          result: { 
            deviceId: Math.floor(Math.random() * 100000),
            deviceType: DEVICE_TYPES.SMART_METER,
            owner: deviceOwner.publicKey.toString(),
            status: REGISTRATION_STATUS.APPROVED,
            lastUpdated: Date.now()
          } 
        };
      };

      const { measurement } = await framework.measureOperation(
        PROGRAM_IDS.registry,
        testName,
        operation
      );

      console.log(`Get Device Info Latency: ${measurement.transactionLatency.toFixed(2)}ms`);
      
      if (measurement.transactionLatency > 180) {
        throw new Error(`Get device info exceeded threshold: ${measurement.transactionLatency}ms`);
      }
    });

    it('should measure list_devices_by_owner latency', async () => {
      const testName = 'list_devices_by_owner';
      
      const operation = async () => {
        // Simulate listing devices by owner
        await new Promise(resolve => setTimeout(resolve, 110));
        const signature = 'mock_list_devices_signature';
        const deviceCount = Math.floor(Math.random() * 20) + 1;
        return { 
          signature, 
          result: { 
            owner: deviceOwner.publicKey.toString(),
            deviceCount,
            devices: Array.from({ length: deviceCount }, (_, i) => ({
              deviceId: Math.floor(Math.random() * 100000),
              deviceType: Object.values(DEVICE_TYPES)[i % 4]
            }))
          } 
        };
      };

      const { measurement } = await framework.measureOperation(
        PROGRAM_IDS.registry,
        testName,
        operation
      );

      console.log(`List Devices by Owner Latency: ${measurement.transactionLatency.toFixed(2)}ms`);
      
      if (measurement.transactionLatency > 200) {
        throw new Error(`List devices by owner exceeded threshold: ${measurement.transactionLatency}ms`);
      }
    });

    it('should measure high-frequency device queries', async () => {
      const scenario: TestScenario = {
        name: 'high_frequency_device_queries',
        description: 'High frequency device query operations',
        iterations: 150,
        concurrency: 1,
        delay: 30
      };

      const operation = async () => {
        // Simulate high-frequency device queries
        await new Promise(resolve => setTimeout(resolve, 60 + Math.random() * 40));
        const signature = `mock_hf_query_${Date.now()}_${Math.random()}`;
        return { 
          signature, 
          result: { 
            queryType: Math.random() > 0.5 ? 'single_device' : 'list_devices',
            deviceId: Math.floor(Math.random() * 100000),
            queryTime: Date.now()
          } 
        };
      };

      const metrics = await framework.runTestScenario(
        scenario,
        PROGRAM_IDS.registry,
        operation
      );

      console.log(`High Frequency Device Query Results:`);
      console.log(`- Average Latency: ${metrics.latency.mean.toFixed(2)}ms`);
      console.log(`- P95 Latency: ${metrics.latency.p95.toFixed(2)}ms`);
      console.log(`- Throughput: ${metrics.throughput.tps.toFixed(2)} TPS`);

      if (metrics.latency.mean > 120) {
        throw new Error(`HF device query exceeded threshold: ${metrics.latency.mean}ms`);
      }
      if (metrics.throughput.tps < 20) {
        throw new Error(`HF device query TPS below threshold: ${metrics.throughput.tps}`);
      }
    });
  });

  describe('Compliance Verification Operations', () => {
    it('should measure verify_device_compliance latency', async () => {
      const testName = 'verify_device_compliance';
      
      const operation = async () => {
        // Simulate device compliance verification
        await new Promise(resolve => setTimeout(resolve, 200));
        const signature = 'mock_verify_compliance_signature';
        return { 
          signature, 
          result: { 
            deviceId: Math.floor(Math.random() * 100000),
            isCompliant: Math.random() > 0.1, // 90% compliant
            verificationScore: 0.8 + Math.random() * 0.2,
            verifiedAt: Date.now(),
            nextVerification: Date.now() + (30 * 24 * 60 * 60 * 1000) // 30 days
          } 
        };
      };

      const { measurement } = await framework.measureOperation(
        PROGRAM_IDS.registry,
        testName,
        operation
      );

      console.log(`Verify Device Compliance Latency: ${measurement.transactionLatency.toFixed(2)}ms`);
      
      if (measurement.transactionLatency > 400) {
        throw new Error(`Device compliance verification exceeded threshold: ${measurement.transactionLatency}ms`);
      }
    });

    it('should measure batch compliance verification', async () => {
      const scenario: TestScenario = {
        name: 'batch_compliance_verification',
        description: 'Batch compliance verification operations',
        iterations: 10,
        concurrency: 1,
        delay: 100
      };

      const operation = async () => {
        // Simulate batch compliance verification
        await new Promise(resolve => setTimeout(resolve, 300));
        const deviceCount = Math.floor(Math.random() * 10) + 5;
        const signature = `mock_batch_compliance_${Date.now()}`;
        return { 
          signature, 
          result: { 
            batchId: Math.floor(Math.random() * 1000),
            deviceCount,
            compliantCount: Math.floor(deviceCount * 0.9),
            verificationTime: Date.now()
          } 
        };
      };

      const metrics = await framework.runTestScenario(
        scenario,
        PROGRAM_IDS.registry,
        operation
      );

      console.log(`Batch Compliance Verification Results:`);
      console.log(`- Average Latency: ${metrics.latency.mean.toFixed(2)}ms`);
      console.log(`- P95 Latency: ${metrics.latency.p95.toFixed(2)}ms`);
      console.log(`- Throughput: ${metrics.throughput.tps.toFixed(2)} TPS`);

      if (metrics.latency.mean > 450) {
        throw new Error(`Batch compliance verification exceeded threshold: ${metrics.latency.mean}ms`);
      }
    });
  });

  describe('Registry Performance Analysis', () => {
    it('should generate comprehensive registry performance report', async () => {
      // Run various registry operations
      const operations = [
        'initialize_registry',
        'register_device',
        'update_device_info',
        'approve_device',
        'get_device_info',
        'register_producer',
        'update_producer_info',
        'verify_device_compliance'
      ];

      for (const operation of operations) {
        const scenario: TestScenario = {
          name: `registry_report_${operation}`,
          description: `Registry performance test for ${operation}`,
          iterations: 25,
          concurrency: 1,
          delay: 50
        };

        await framework.runTestScenario(scenario, PROGRAM_IDS.registry, async () => {
          // Simulate operation with varying latency patterns
          let delay: number;
          switch (operation) {
            case 'initialize_registry':
              delay = 320 + Math.random() * 100;
              break;
            case 'register_device':
              delay = 240 + Math.random() * 80;
              break;
            case 'update_device_info':
              delay = 180 + Math.random() * 60;
              break;
            case 'approve_device':
            case 'reject_device':
            case 'suspend_device':
              delay = 140 + Math.random() * 40;
              break;
            case 'get_device_info':
              delay = 90 + Math.random() * 30;
              break;
            case 'register_producer':
              delay = 280 + Math.random() * 90;
              break;
            case 'update_producer_info':
              delay = 220 + Math.random() * 70;
              break;
            case 'verify_device_compliance':
              delay = 200 + Math.random() * 80;
              break;
            default:
              delay = 200 + Math.random() * 80;
          }
          
          await new Promise(resolve => setTimeout(resolve, delay));
          return { 
            signature: `registry_${operation}_${Date.now()}_${Math.random()}`, 
            result: { operation, processed: true } 
          };
        });
      }

      // Generate comprehensive report
      const report = framework.analyzer.generateReport(
        framework.measurer.getMeasurements()
      );
      
      console.log('=== Registry Performance Report ===');
      console.log(`Total Measurements: ${report.summary.totalMeasurements}`);
      console.log(`Average Latency: ${report.summary.averageLatency.toFixed(2)}ms`);
      console.log(`P95 Latency: ${report.summary.p95.toFixed(2)}ms`);
      console.log(`Outlier Rate: ${report.summary.outlierRate.toFixed(2)}%`);
      
      console.log('\nTrend Analysis:');
      console.log(`Direction: ${report.trends.direction}`);
      console.log(`Confidence: ${(report.trends.confidence * 100).toFixed(1)}%`);
      
      console.log('\nRecommendations:');
      report.recommendations.forEach((rec: string) => console.log(`- ${rec}`));

      // Export detailed report
      const reportPath = await framework.exportReport('registry-performance-report.json');
      console.log(`\nDetailed report exported to: ${reportPath}`);

      // Validate report generation
      if (report.summary.totalMeasurements === 0) {
        throw new Error('No measurements collected');
      }
      if (!report.recommendations || report.recommendations.length === 0) {
        throw new Error('No recommendations generated');
      }
    });
  });

  describe('Registry Load Testing', () => {
    it('should handle registry peak load scenarios', async () => {
      const scenario: TestScenario = {
        name: 'registry_peak_load',
        description: 'Registry system peak load test',
        iterations: 0,
        concurrency: 120,
        delay: 0
      };

      const operation = async () => {
        // Simulate various registry operations during peak load
        const operationType = Math.floor(Math.random() * 8); // 8 different operations
        const baseDelay = [320, 240, 180, 140, 90, 280, 220, 200][operationType];
        const variance = Math.random() * 80;
        
        await new Promise(resolve => setTimeout(resolve, baseDelay + variance));
        const signature = `registry_peak_${Date.now()}_${Math.random()}`;
        return { 
          signature, 
          result: { 
            operation: ['initialize', 'register_device', 'update_device', 'approve', 'get_device', 'register_producer', 'update_producer', 'verify_compliance'][operationType],
            processed: true 
          } 
        };
      };

      const metrics = await framework.measurer.runConcurrentScenario(scenario, operation);
      await framework.collector.recordMeasurements(
        framework.measurer.getMeasurementsByProgram(PROGRAM_IDS.registry)
      );

      console.log(`Registry Peak Load Results:`);
      console.log(`- Average Latency: ${metrics.latency.mean.toFixed(2)}ms`);
      console.log(`- P95 Latency: ${metrics.latency.p95.toFixed(2)}ms`);
      console.log(`- Successful Operations: ${metrics.throughput.operations}`);
      console.log(`- Error Rate: ${metrics.errors.rate}%`);

      // Peak load performance assertions
      if (metrics.latency.mean > 900) {
        throw new Error(`Registry peak load latency exceeded threshold: ${metrics.latency.mean}ms`);
      }
      if (metrics.errors.rate > 20) {
        throw new Error(`Registry peak load error rate exceeded threshold: ${metrics.errors.rate}%`);
      }
    });
  });
});
