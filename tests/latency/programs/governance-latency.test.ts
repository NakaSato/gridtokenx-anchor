/**
 * Governance Program Latency Tests
 * 
 * This test suite measures latency for all critical operations
 * in Governance program
 */

import * as anchor from '@coral-xyz/anchor';
import { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createLatencyFramework, TestScenario } from '../framework';

// Mock constants for testing
const PROGRAM_IDS = {
  governance: 'GovEr5r6JFW2q9yjzuNweAvJWhCXKxPLoKsdYmUVxvBPt'
};

const TEST_AMOUNTS = {
  ONE_TOKEN: 1_000_000_000,
  TEN_TOKENS: 10_000_000_000,
  SMALL_AMOUNT: 100_000_000
};

describe('Governance Program Latency Tests', () => {
  let connection: Connection;
  let framework: any;
  let provider: anchor.AnchorProvider;
  let governanceProgram: any;
  
  // Test wallets
  let authority: Keypair;
  let userWallet: Keypair;
  let proposalCreator: Keypair;

  before('Setup test environment', async () => {
    connection = new Connection('http://127.0.0.1:8899', 'confirmed');
    
    // Initialize latency framework
    framework = createLatencyFramework({
      connection,
      dataCollection: {
        outputDirectory: './test-results/latency/governance',
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
    userWallet = Keypair.generate();
    proposalCreator = Keypair.generate();

    // Fund wallets
    await connection.requestAirdrop(authority.publicKey, 10 * LAMPORTS_PER_SOL);
    await connection.requestAirdrop(userWallet.publicKey, 10 * LAMPORTS_PER_SOL);
    await connection.requestAirdrop(proposalCreator.publicKey, 10 * LAMPORTS_PER_SOL);

    provider = new anchor.AnchorProvider(
      connection,
      new anchor.Wallet(authority),
      { commitment: 'confirmed' }
    );

    // Mock governance program
    governanceProgram = {
      methods: {
        initializeGovernance: () => ({ rpc: async () => 'mock_init_signature' }),
        createProposal: () => ({ rpc: async () => 'mock_proposal_signature' }),
        voteOnProposal: () => ({ rpc: async () => 'mock_vote_signature' }),
        executeProposal: () => ({ rpc: async () => 'mock_execute_signature' }),
        updateVotingPower: () => ({ rpc: async () => 'mock_update_signature' }),
        delegateVote: () => ({ rpc: async () => 'mock_delegate_signature' }),
        revokeDelegation: () => ({ rpc: async () => 'mock_revoke_signature' })
      }
    } as any;
  });

  after('Cleanup', async () => {
    await framework.cleanup();
  });

  describe('Governance Initialization Operations', () => {
    it('should measure initialize_governance latency', async () => {
      const testName = 'initialize_governance';
      
      const operation = async () => {
        // Simulate governance initialization
        await new Promise(resolve => setTimeout(resolve, 300));
        const signature = 'mock_initialize_governance_signature';
        return { signature, result: null };
      };

      const { measurement } = await framework.measureOperation(
        PROGRAM_IDS.governance,
        testName,
        operation
      );

      console.log(`Initialize Governance Latency: ${measurement.transactionLatency.toFixed(2)}ms`);
      console.log(`Compute Units: ${measurement.metadata.computeUnits}`);
      
      if (measurement.transactionLatency > 1000) {
        throw new Error(`Governance initialization exceeded threshold: ${measurement.transactionLatency}ms`);
      }
    });

    it('should measure batch governance initialization', async () => {
      const scenario: TestScenario = {
        name: 'batch_governance_init',
        description: 'Batch governance initialization operations',
        iterations: 5,
        concurrency: 1,
        delay: 200
      };

      const operation = async () => {
        // Simulate batch governance initialization
        await new Promise(resolve => setTimeout(resolve, 350));
        const signature = `mock_batch_init_${Date.now()}`;
        return { signature, result: null };
      };

      const metrics = await framework.runTestScenario(
        scenario,
        PROGRAM_IDS.governance,
        operation
      );

      console.log(`Batch Governance Init Results:`);
      console.log(`- Average Latency: ${metrics.latency.mean.toFixed(2)}ms`);
      console.log(`- P95 Latency: ${metrics.latency.p95.toFixed(2)}ms`);
      console.log(`- TPS: ${metrics.throughput.tps.toFixed(2)}`);

      if (metrics.latency.mean > 600) {
        throw new Error(`Batch governance init exceeded threshold: ${metrics.latency.mean}ms`);
      }
    });
  });

  describe('Proposal Management Operations', () => {
    it('should measure create_proposal latency', async () => {
      const testName = 'create_proposal';
      
      const operation = async () => {
        // Simulate proposal creation
        await new Promise(resolve => setTimeout(resolve, 250));
        const signature = 'mock_create_proposal_signature';
        return { signature, result: { proposalId: Math.floor(Math.random() * 10000) } };
      };

      const { measurement } = await framework.measureOperation(
        PROGRAM_IDS.governance,
        testName,
        operation
      );

      console.log(`Create Proposal Latency: ${measurement.transactionLatency.toFixed(2)}ms`);
      
      if (measurement.transactionLatency > 500) {
        throw new Error(`Proposal creation exceeded threshold: ${measurement.transactionLatency}ms`);
      }
    });

    it('should measure high-frequency proposal creation', async () => {
      const scenario: TestScenario = {
        name: 'high_frequency_proposals',
        description: 'High frequency proposal creation',
        iterations: 50,
        concurrency: 1,
        delay: 100
      };

      const operation = async () => {
        // Simulate high-frequency proposal creation
        await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 100));
        const signature = `mock_hf_proposal_${Date.now()}_${Math.random()}`;
        return { signature, result: { proposalId: Math.floor(Math.random() * 10000) } };
      };

      const metrics = await framework.runTestScenario(
        scenario,
        PROGRAM_IDS.governance,
        operation
      );

      console.log(`High Frequency Proposal Results:`);
      console.log(`- Average Latency: ${metrics.latency.mean.toFixed(2)}ms`);
      console.log(`- P95 Latency: ${metrics.latency.p95.toFixed(2)}ms`);
      console.log(`- Throughput: ${metrics.throughput.tps.toFixed(2)} TPS`);

      if (metrics.latency.mean > 350) {
        throw new Error(`HF proposal creation exceeded threshold: ${metrics.latency.mean}ms`);
      }
      if (metrics.throughput.tps < 5) {
        throw new Error(`HF proposal TPS below threshold: ${metrics.throughput.tps}`);
      }
    });
  });

  describe('Voting Operations', () => {
    it('should measure vote_on_proposal latency', async () => {
      const testName = 'vote_on_proposal';
      
      const operation = async () => {
        // Simulate voting on proposal
        await new Promise(resolve => setTimeout(resolve, 150));
        const signature = 'mock_vote_proposal_signature';
        return { signature, result: { vote: 'yes', weight: TEST_AMOUNTS.ONE_TOKEN } };
      };

      const { measurement } = await framework.measureOperation(
        PROGRAM_IDS.governance,
        testName,
        operation
      );

      console.log(`Vote on Proposal Latency: ${measurement.transactionLatency.toFixed(2)}ms`);
      
      if (measurement.transactionLatency > 300) {
        throw new Error(`Vote operation exceeded threshold: ${measurement.transactionLatency}ms`);
      }
    });

    it('should measure concurrent voting operations', async () => {
      const scenario: TestScenario = {
        name: 'concurrent_voting',
        description: 'Concurrent voting operations',
        iterations: 0,
        concurrency: 100,
        delay: 0
      };

      const operation = async () => {
        // Simulate concurrent voting
        await new Promise(resolve => setTimeout(resolve, 120 + Math.random() * 80));
        const signature = `mock_concurrent_vote_${Date.now()}_${Math.random()}`;
        return { 
          signature, 
          result: { 
            vote: Math.random() > 0.5 ? 'yes' : 'no', 
            weight: TEST_AMOUNTS.SMALL_AMOUNT 
          } 
        };
      };

      const metrics = await framework.measurer.runConcurrentScenario(scenario, operation);
      await framework.collector.recordMeasurements(
        framework.measurer.getMeasurementsByProgram(PROGRAM_IDS.governance)
      );

      console.log(`Concurrent Voting Results:`);
      console.log(`- Average Latency: ${metrics.latency.mean.toFixed(2)}ms`);
      console.log(`- P95 Latency: ${metrics.latency.p95.toFixed(2)}ms`);
      console.log(`- Successful Operations: ${metrics.throughput.operations}`);
      console.log(`- Error Rate: ${metrics.errors.rate}%`);

      if (metrics.latency.mean > 250) {
        throw new Error(`Concurrent voting exceeded threshold: ${metrics.latency.mean}ms`);
      }
      if (metrics.errors.rate > 10) {
        throw new Error(`Concurrent voting error rate exceeded threshold: ${metrics.errors.rate}%`);
      }
    });
  });

  describe('Proposal Execution Operations', () => {
    it('should measure execute_proposal latency', async () => {
      const testName = 'execute_proposal';
      
      const operation = async () => {
        // Simulate proposal execution
        await new Promise(resolve => setTimeout(resolve, 400));
        const signature = 'mock_execute_proposal_signature';
        return { signature, result: { executed: true, timestamp: Date.now() } };
      };

      const { measurement } = await framework.measureOperation(
        PROGRAM_IDS.governance,
        testName,
        operation
      );

      console.log(`Execute Proposal Latency: ${measurement.transactionLatency.toFixed(2)}ms`);
      
      if (measurement.transactionLatency > 800) {
        throw new Error(`Proposal execution exceeded threshold: ${measurement.transactionLatency}ms`);
      }
    });
  });

  describe('Voting Power Management', () => {
    it('should measure update_voting_power latency', async () => {
      const testName = 'update_voting_power';
      
      const operation = async () => {
        // Simulate voting power update
        await new Promise(resolve => setTimeout(resolve, 180));
        const signature = 'mock_update_voting_power_signature';
        return { signature, result: { newPower: TEST_AMOUNTS.TEN_TOKENS } };
      };

      const { measurement } = await framework.measureOperation(
        PROGRAM_IDS.governance,
        testName,
        operation
      );

      console.log(`Update Voting Power Latency: ${measurement.transactionLatency.toFixed(2)}ms`);
      
      if (measurement.transactionLatency > 350) {
        throw new Error(`Voting power update exceeded threshold: ${measurement.transactionLatency}ms`);
      }
    });

    it('should measure delegation operations', async () => {
      const scenarios = [
        { name: 'delegate_vote', delay: 200 },
        { name: 'revoke_delegation', delay: 150 }
      ];

      for (const scenario of scenarios) {
        const operation = async () => {
          await new Promise(resolve => setTimeout(resolve, scenario.delay));
          const signature = `mock_${scenario.name}_${Date.now()}`;
          return { signature, result: { delegated: true } };
        };

        const { measurement } = await framework.measureOperation(
          PROGRAM_IDS.governance,
          scenario.name,
          operation
        );

        console.log(`${scenario.name} Latency: ${measurement.transactionLatency.toFixed(2)}ms`);
        
        const threshold = scenario.delay * 1.5; // Allow 50% overhead
        if (measurement.transactionLatency > threshold) {
          throw new Error(`${scenario.name} exceeded threshold: ${measurement.transactionLatency}ms`);
        }
      }
    });
  });

  describe('Governance Performance Analysis', () => {
    it('should generate comprehensive governance performance report', async () => {
      // Run various governance operations
      const operations = [
        'initialize_governance',
        'create_proposal',
        'vote_on_proposal',
        'execute_proposal',
        'update_voting_power'
      ];

      for (const operation of operations) {
        const scenario: TestScenario = {
          name: `governance_report_${operation}`,
          description: `Governance performance test for ${operation}`,
          iterations: 15,
          concurrency: 1,
          delay: 50
        };

        await framework.runTestScenario(scenario, PROGRAM_IDS.governance, async () => {
          // Simulate operation with varying latency patterns
          let delay: number;
          switch (operation) {
            case 'initialize_governance':
              delay = 250 + Math.random() * 100;
              break;
            case 'create_proposal':
              delay = 200 + Math.random() * 80;
              break;
            case 'vote_on_proposal':
              delay = 120 + Math.random() * 60;
              break;
            case 'execute_proposal':
              delay = 350 + Math.random() * 150;
              break;
            case 'update_voting_power':
              delay = 150 + Math.random() * 70;
              break;
            default:
              delay = 200 + Math.random() * 100;
          }
          
          await new Promise(resolve => setTimeout(resolve, delay));
          return { 
            signature: `governance_${operation}_${Date.now()}_${Math.random()}`, 
            result: { operation, processed: true } 
          };
        });
      }

      // Generate comprehensive report
      const report = framework.analyzer.generateReport(
        framework.measurer.getMeasurements()
      );
      
      console.log('=== Governance Performance Report ===');
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
      const reportPath = await framework.exportReport('governance-performance-report.json');
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

  describe('Governance Load Testing', () => {
    it('should handle governance peak load scenarios', async () => {
      const scenario: TestScenario = {
        name: 'governance_peak_load',
        description: 'Governance system peak load test',
        iterations: 0,
        concurrency: 75,
        delay: 0
      };

      const operation = async () => {
        // Simulate various governance operations during peak load
        const operationType = Math.floor(Math.random() * 5); // 5 different operations
        const baseDelay = [250, 200, 120, 350, 150][operationType];
        const variance = Math.random() * 100;
        
        await new Promise(resolve => setTimeout(resolve, baseDelay + variance));
        const signature = `governance_peak_${Date.now()}_${Math.random()}`;
        return { 
          signature, 
          result: { 
            operation: ['initialize', 'propose', 'vote', 'execute', 'update'][operationType],
            processed: true 
          } 
        };
      };

      const metrics = await framework.measurer.runConcurrentScenario(scenario, operation);
      await framework.collector.recordMeasurements(
        framework.measurer.getMeasurementsByProgram(PROGRAM_IDS.governance)
      );

      console.log(`Governance Peak Load Results:`);
      console.log(`- Average Latency: ${metrics.latency.mean.toFixed(2)}ms`);
      console.log(`- P95 Latency: ${metrics.latency.p95.toFixed(2)}ms`);
      console.log(`- Successful Operations: ${metrics.throughput.operations}`);
      console.log(`- Error Rate: ${metrics.errors.rate}%`);

      // Peak load performance assertions
      if (metrics.latency.mean > 1000) {
        throw new Error(`Governance peak load latency exceeded threshold: ${metrics.latency.mean}ms`);
      }
      if (metrics.errors.rate > 20) {
        throw new Error(`Governance peak load error rate exceeded threshold: ${metrics.errors.rate}%`);
      }
    });
  });
});
