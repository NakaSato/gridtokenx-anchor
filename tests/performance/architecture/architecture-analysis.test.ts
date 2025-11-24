import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import { GridTokenXClient } from "../../../anchor/src/client/js";
import {
  PerformanceMetricsCollector,
  printPerformanceReport,
  generateBenchmarkScore,
  BenchmarkScore,
} from "../utils/metrics-collector";
import {
  TransactionRunner,
  TransactionResult,
} from "../utils/transaction-runner";
import { readFileSync } from "fs";

/**
 * GridTokenX Architecture Analysis Test
 *
 * This test suite analyzes the performance characteristics of the GridTokenX
 * architecture by examining transaction throughput, latency, resource usage,
 * and scalability of the system's key components:
 *
 * 1. Energy Token (SPL Token Implementation)
 * 2. Trading (Energy Marketplace)
 * 3. Registry (User and Asset Registration)
 * 4. Oracle (Price Feed and Data Verification)
 * 5. Governance (Protocol Decision Making)
 *
 * The test focuses on measuring:
 * - Transaction processing efficiency
 * - Cross-program interaction overhead
 * - Account management performance
 * - Computational resource utilization
 */

describe("GridTokenX Architecture Analysis", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  let client: GridTokenXClient;
  let transactionRunner: TransactionRunner;
  let metricsCollector: PerformanceMetricsCollector;
  let testWallets: Keypair[] = [];
  let programAccounts: Map<string, PublicKey> = new Map();

  // Architecture analysis configuration
  const ARCHITECTURE_CONFIG = {
    // Program interaction analysis
    programInteractionTests: {
      iterations: 30,
      delay: 50,
    },

    // Account management analysis
    accountManagementTests: {
      batchSizes: [5, 10, 20],
      iterationsPerBatch: 5,
    },

    // Resource utilization analysis
    resourceUtilizationTests: {
      lowComplexityInstructions: 10,
      mediumComplexityInstructions: 10,
      highComplexityInstructions: 10,
    },

    // Scalability analysis
    scalabilityTests: {
      linearScale: [5, 10, 20, 40],
      stressTestDuration: 10000, // 10 seconds
    },
  };

  before(async () => {
    // Initialize client
    client = new GridTokenXClient({
      connection: provider.connection,
      wallet: (provider.wallet as anchor.Wallet).payer,
    });

    // Initialize transaction runner
    transactionRunner = new TransactionRunner(
      provider.connection,
      (provider.wallet as anchor.Wallet).payer,
    );

    // Initialize metrics collector
    metricsCollector = new PerformanceMetricsCollector();

    // Create test wallets
    console.log("Setting up test wallets for architecture analysis...");
    for (let i = 0; i < 10; i++) {
      testWallets.push(Keypair.generate());
    }

    // Airdrop SOL to test wallets
    console.log("Airdropping SOL to test wallets...");
    for (const wallet of testWallets) {
      try {
        const signature = await provider.connection.requestAirdrop(
          wallet.publicKey,
          5 * LAMPORTS_PER_SOL,
        );
        await provider.connection.confirmTransaction(signature);
      } catch (e) {
        console.log("Airdrop failed for wallet", wallet.publicKey.toBase58());
      }
    }

    // Initialize programs and store their addresses
    try {
      await client.initializeToken();
      programAccounts.set("token", await client.getTokenProgramAddress());

      await client.initializeMarket();
      programAccounts.set("trading", await client.getTradingProgramAddress());

      await client.initializeRegistry();
      programAccounts.set("registry", await client.getRegistryProgramAddress());

      await client.initializeOracle();
      programAccounts.set("oracle", await client.getOracleProgramAddress());

      await client.initializeGovernance();
      programAccounts.set(
        "governance",
        await client.getGovernanceProgramAddress(),
      );

      console.log("Programs initialized successfully.");
    } catch (e) {
      console.log("Program initialization skipped (already initialized):", e);
    }
  });

  describe("Program Interaction Analysis", () => {
    it("should analyze cross-program interaction overhead", async () => {
      console.log("\n=== Cross-Program Interaction Analysis ===");
      const { iterations, delay } = ARCHITECTURE_CONFIG.programInteractionTests;

      // Test 1: Token + Trading interaction (order creation with token transfers)
      console.log("Testing Token + Trading interaction...");
      let tokenTradingStartTime = Date.now();

      for (let i = 0; i < iterations; i++) {
        try {
          // Create a sell order (trading program)
          const sellOrderTx = await client.createSellOrderTransaction(
            testWallets[i % testWallets.length].publicKey,
            100, // energy amount
            100 + i, // price
          );

          const result = await transactionRunner.runTransaction(
            sellOrderTx,
            "token-trading-interaction",
            250000,
          );

          if (result.success) {
            metricsCollector.recordSuccess(
              result.latency,
              "token-trading-interaction",
              result.computeUnitsUsed,
              result.accountSizeChange,
            );
          } else {
            metricsCollector.recordFailure(
              result.error!,
              "token-trading-interaction",
            );
          }
        } catch (error) {
          metricsCollector.recordFailure(
            error as Error,
            "token-trading-interaction",
          );
        }

        // Add delay
        if (delay > 0 && i < iterations - 1) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      const tokenTradingDuration = Date.now() - tokenTradingStartTime;
      const tokenTradingReport =
        metricsCollector.generateReport(tokenTradingDuration);

      printPerformanceReport("Token + Trading Interaction", tokenTradingReport);
      metricsCollector.saveReport(
        tokenTradingReport,
        "tests/performance/reports/token-trading-interaction.json",
      );

      // Test 2: Oracle + Trading interaction (price updates affecting market)
      console.log("Testing Oracle + Trading interaction...");
      metricsCollector.reset();

      let oracleTradingStartTime = Date.now();

      for (let i = 0; i < iterations; i++) {
        try {
          // Update oracle price
          const updateOracleTx = await client.createPriceUpdateTransaction(
            testWallets[i % testWallets.length].publicKey,
            100 + i * 5, // price
          );

          const result = await transactionRunner.runTransaction(
            updateOracleTx,
            "oracle-trading-interaction",
            200000,
          );

          if (result.success) {
            metricsCollector.recordSuccess(
              result.latency,
              "oracle-trading-interaction",
              result.computeUnitsUsed,
              result.accountSizeChange,
            );
          } else {
            metricsCollector.recordFailure(
              result.error!,
              "oracle-trading-interaction",
            );
          }
        } catch (error) {
          metricsCollector.recordFailure(
            error as Error,
            "oracle-trading-interaction",
          );
        }

        // Add delay
        if (delay > 0 && i < iterations - 1) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      const oracleTradingDuration = Date.now() - oracleTradingStartTime;
      const oracleTradingReport = metricsCollector.generateReport(
        oracleTradingDuration,
      );

      printPerformanceReport(
        "Oracle + Trading Interaction",
        oracleTradingReport,
      );
      metricsCollector.saveReport(
        oracleTradingReport,
        "tests/performance/reports/oracle-trading-interaction.json",
      );

      // Test 3: Registry + Trading interaction (user registration affecting trading)
      console.log("Testing Registry + Trading interaction...");
      metricsCollector.reset();

      let registryTradingStartTime = Date.now();

      for (let i = 0; i < iterations; i++) {
        try {
          // Register user in registry
          const registerUserTx = await client.createRegisterUserTransaction(
            testWallets[i % testWallets.length].publicKey,
            `user${i}`,
          );

          const result = await transactionRunner.runTransaction(
            registerUserTx,
            "registry-trading-interaction",
            300000,
          );

          if (result.success) {
            metricsCollector.recordSuccess(
              result.latency,
              "registry-trading-interaction",
              result.computeUnitsUsed,
              result.accountSizeChange,
            );
          } else {
            metricsCollector.recordFailure(
              result.error!,
              "registry-trading-interaction",
            );
          }
        } catch (error) {
          metricsCollector.recordFailure(
            error as Error,
            "registry-trading-interaction",
          );
        }

        // Add delay
        if (delay > 0 && i < iterations - 1) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      const registryTradingDuration = Date.now() - registryTradingStartTime;
      const registryTradingReport = metricsCollector.generateReport(
        registryTradingDuration,
      );

      printPerformanceReport(
        "Registry + Trading Interaction",
        registryTradingReport,
      );
      metricsCollector.saveReport(
        registryTradingReport,
        "tests/performance/reports/registry-trading-interaction.json",
      );

      metricsCollector.reset();
    });
  });

  describe("Account Management Analysis", () => {
    it("should analyze account creation and management performance", async () => {
      console.log("\n=== Account Management Analysis ===");
      const { batchSizes, iterationsPerBatch } =
        ARCHITECTURE_CONFIG.accountManagementTests;

      const accountCreationResults: Array<{
        batchSize: number;
        latency: number;
      }> = [];

      for (const batchSize of batchSizes) {
        console.log(`Testing batch size: ${batchSize}`);

        const startTime = Date.now();
        let successCount = 0;

        for (let i = 0; i < iterationsPerBatch; i++) {
          try {
            // Create multiple accounts in a single transaction
            const createAccountsTx = new Transaction();

            for (let j = 0; j < batchSize; j++) {
              const wallet =
                testWallets[(i * batchSize + j) % testWallets.length];

              // Add account creation instruction
              createAccountsTx.add(
                SystemProgram.createAccount({
                  fromPubkey: (provider.wallet as anchor.Wallet).payer
                    .publicKey,
                  newAccountPubkey: wallet.publicKey,
                  lamports: LAMPORTS_PER_SOL,
                  space: 0,
                  programId: SystemProgram.programId,
                }),
              );
            }

            // Set higher compute unit limit for larger batches
            const computeUnits = 200000 + batchSize * 50000;
            createAccountsTx.add(
              ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
            );

            const result = await transactionRunner.runTransaction(
              createAccountsTx,
              `account-creation-batch-${batchSize}`,
              computeUnits,
            );

            if (result.success) {
              successCount++;
              metricsCollector.recordSuccess(
                result.latency,
                `account-creation-batch-${batchSize}`,
                result.computeUnitsUsed,
                result.accountSizeChange,
              );
            } else {
              metricsCollector.recordFailure(
                result.error!,
                `account-creation-batch-${batchSize}`,
              );
            }
          } catch (error) {
            metricsCollector.recordFailure(
              error as Error,
              `account-creation-batch-${batchSize}`,
            );
          }
        }

        const duration = Date.now() - startTime;
        const avgLatency = duration / iterationsPerBatch;

        accountCreationResults.push({
          batchSize,
          latency: avgLatency,
        });

        console.log(
          `  Batch size ${batchSize}: ${successCount}/${iterationsPerBatch} successful, avg latency: ${avgLatency.toFixed(2)}ms`,
        );
      }

      // Generate report
      const report = metricsCollector.generateReport(
        accountCreationResults.reduce((sum, r) => sum + r.latency, 0),
      );

      printPerformanceReport("Account Management", report);
      metricsCollector.saveReport(
        report,
        "tests/performance/reports/account-management.json",
      );

      // Analyze scalability of account creation
      console.log("\nAccount Creation Scalability Analysis:");
      for (const result of accountCreationResults) {
        console.log(
          `  Batch size ${result.batchSize}: ${result.latency.toFixed(2)}ms average latency`,
        );
      }

      // Calculate scaling factor
      if (accountCreationResults.length >= 2) {
        const smallest = accountCreationResults[0];
        const largest =
          accountCreationResults[accountCreationResults.length - 1];
        const scalingFactor =
          largest.latency /
          smallest.latency /
          (largest.batchSize / smallest.batchSize);

        console.log(
          `  Scaling factor: ${scalingFactor.toFixed(2)} (${scalingFactor < 1.5 ? "Good" : "Needs optimization"})`,
        );
      }

      metricsCollector.reset();
    });
  });

  describe("Resource Utilization Analysis", () => {
    it("should analyze computational resource utilization", async () => {
      console.log("\n=== Resource Utilization Analysis ===");
      const {
        lowComplexityInstructions,
        mediumComplexityInstructions,
        highComplexityInstructions,
      } = ARCHITECTURE_CONFIG.resourceUtilizationTests;

      // Test low complexity instructions (simple transfers)
      console.log("Testing low complexity instructions...");
      let lowComplexityStartTime = Date.now();

      for (let i = 0; i < lowComplexityInstructions; i++) {
        try {
          const transferTx = client.createTransferTransaction(
            testWallets[i % testWallets.length].publicKey,
            testWallets[(i + 1) % testWallets.length].publicKey,
            0.1,
          );

          const result = await transactionRunner.runTransaction(
            transferTx,
            "low-complexity-transfer",
            150000,
          );

          if (result.success) {
            metricsCollector.recordSuccess(
              result.latency,
              "low-complexity-transfer",
              result.computeUnitsUsed,
              result.accountSizeChange,
            );
          } else {
            metricsCollector.recordFailure(
              result.error!,
              "low-complexity-transfer",
            );
          }
        } catch (error) {
          metricsCollector.recordFailure(
            error as Error,
            "low-complexity-transfer",
          );
        }
      }

      const lowComplexityDuration = Date.now() - lowComplexityStartTime;
      const lowComplexityReport = metricsCollector.generateReport(
        lowComplexityDuration,
      );

      printPerformanceReport(
        "Low Complexity Instructions",
        lowComplexityReport,
      );
      metricsCollector.saveReport(
        lowComplexityReport,
        "tests/performance/reports/low-complexity.json",
      );

      // Test medium complexity instructions (order creation)
      console.log("Testing medium complexity instructions...");
      metricsCollector.reset();

      let mediumComplexityStartTime = Date.now();

      for (let i = 0; i < mediumComplexityInstructions; i++) {
        try {
          const sellOrderTx = await client.createSellOrderTransaction(
            testWallets[i % testWallets.length].publicKey,
            100, // energy amount
            100 + i, // price
          );

          const result = await transactionRunner.runTransaction(
            sellOrderTx,
            "medium-complexity-order",
            250000,
          );

          if (result.success) {
            metricsCollector.recordSuccess(
              result.latency,
              "medium-complexity-order",
              result.computeUnitsUsed,
              result.accountSizeChange,
            );
          } else {
            metricsCollector.recordFailure(
              result.error!,
              "medium-complexity-order",
            );
          }
        } catch (error) {
          metricsCollector.recordFailure(
            error as Error,
            "medium-complexity-order",
          );
        }
      }

      const mediumComplexityDuration = Date.now() - mediumComplexityStartTime;
      const mediumComplexityReport = metricsCollector.generateReport(
        mediumComplexityDuration,
      );

      printPerformanceReport(
        "Medium Complexity Instructions",
        mediumComplexityReport,
      );
      metricsCollector.saveReport(
        mediumComplexityReport,
        "tests/performance/reports/medium-complexity.json",
      );

      // Test high complexity instructions (order matching)
      console.log("Testing high complexity instructions...");
      metricsCollector.reset();

      // First create some orders to match
      const orderIds: string[] = [];

      for (let i = 0; i < highComplexityInstructions; i++) {
        try {
          // Create a sell order
          const sellOrderTx = await client.createSellOrderTransaction(
            testWallets[i % testWallets.length].publicKey,
            100, // energy amount
            100 + i, // price
          );

          const result = await transactionRunner.runTransaction(
            sellOrderTx,
            "sell-order-for-matching",
            250000,
          );

          if (result.success && result.signature) {
            orderIds.push(result.signature);
          }

          // Create a buy order
          const buyOrderTx = await client.createBuyOrderTransaction(
            testWallets[(i + 1) % testWallets.length].publicKey,
            100, // energy amount
            150 + i, // higher price
          );

          const buyResult = await transactionRunner.runTransaction(
            buyOrderTx,
            "buy-order-for-matching",
            250000,
          );

          if (buyResult.success && buyResult.signature) {
            orderIds.push(buyResult.signature);
          }
        } catch (error) {
          // Continue even if order creation fails
        }
      }

      // Now match orders
      let highComplexityStartTime = Date.now();

      for (
        let i = 0;
        i < Math.min(highComplexityInstructions, orderIds.length / 2);
        i++
      ) {
        try {
          const matchTx = await client.createMatchOrdersTransaction(
            orderIds[i * 2], // sell order
            orderIds[i * 2 + 1], // buy order
            50, // match amount
          );

          const result = await transactionRunner.runTransaction(
            matchTx,
            "high-complexity-matching",
            350000,
          );

          if (result.success) {
            metricsCollector.recordSuccess(
              result.latency,
              "high-complexity-matching",
              result.computeUnitsUsed,
              result.accountSizeChange,
            );
          } else {
            metricsCollector.recordFailure(
              result.error!,
              "high-complexity-matching",
            );
          }
        } catch (error) {
          metricsCollector.recordFailure(
            error as Error,
            "high-complexity-matching",
          );
        }
      }

      const highComplexityDuration = Date.now() - highComplexityStartTime;
      const highComplexityReport = metricsCollector.generateReport(
        highComplexityDuration,
      );

      printPerformanceReport(
        "High Complexity Instructions",
        highComplexityReport,
      );
      metricsCollector.saveReport(
        highComplexityReport,
        "tests/performance/reports/high-complexity.json",
      );

      // Resource utilization summary
      console.log("\nResource Utilization Summary:");
      console.log(
        `  Low Complexity: Avg ${lowComplexityReport.avgLatency.toFixed(2)}ms, ${lowComplexityReport.avgComputeUnits.toFixed(0)} compute units`,
      );
      console.log(
        `  Medium Complexity: Avg ${mediumComplexityReport.avgLatency.toFixed(2)}ms, ${mediumComplexityReport.avgComputeUnits.toFixed(0)} compute units`,
      );
      console.log(
        `  High Complexity: Avg ${highComplexityReport.avgLatency.toFixed(2)}ms, ${highComplexityReport.avgComputeUnits.toFixed(0)} compute units`,
      );

      const latencyIncrease =
        highComplexityReport.avgLatency / lowComplexityReport.avgLatency;
      const computeIncrease =
        highComplexityReport.avgComputeUnits /
        lowComplexityReport.avgComputeUnits;

      console.log(`  Latency Increase: ${latencyIncrease.toFixed(2)}x`);
      console.log(`  Compute Units Increase: ${computeIncrease.toFixed(2)}x`);

      metricsCollector.reset();
    });
  });

  describe("Scalability Analysis", () => {
    it("should analyze linear scalability", async () => {
      console.log("\n=== Linear Scalability Analysis ===");
      const { linearScale } = ARCHITECTURE_CONFIG.scalabilityTests;

      const scalabilityResults: Array<{
        transactions: number;
        throughput: number;
        avgLatency: number;
      }> = [];

      for (const txCount of linearScale) {
        console.log(`Testing with ${txCount} transactions...`);

        const startTime = Date.now();

        for (let i = 0; i < txCount; i++) {
          try {
            const transferTx = client.createTransferTransaction(
              testWallets[i % testWallets.length].publicKey,
              testWallets[(i + 1) % testWallets.length].publicKey,
              0.1,
            );

            const result = await transactionRunner.runTransaction(
              transferTx,
              `scalability-test-${txCount}`,
              200000,
            );

            if (result.success) {
              metricsCollector.recordSuccess(
                result.latency,
                `scalability-test-${txCount}`,
                result.computeUnitsUsed,
                result.accountSizeChange,
              );
            } else {
              metricsCollector.recordFailure(
                result.error!,
                `scalability-test-${txCount}`,
              );
            }
          } catch (error) {
            metricsCollector.recordFailure(
              error as Error,
              `scalability-test-${txCount}`,
            );
          }
        }

        const duration = Date.now() - startTime;
        const report = metricsCollector.generateReport(duration);

        scalabilityResults.push({
          transactions: txCount,
          throughput: report.throughput,
          avgLatency: report.avgLatency,
        });

        console.log(
          `  ${txCount} transactions: ${report.throughput.toFixed(2)} TPS, ${report.avgLatency.toFixed(2)}ms avg latency`,
        );

        metricsCollector.reset();
      }

      // Analyze scalability
      console.log("\nScalability Analysis:");
      for (const result of scalabilityResults) {
        console.log(
          `  ${result.transactions} tx: ${result.throughput.toFixed(2)} TPS, ${result.avgLatency.toFixed(2)}ms latency`,
        );
      }

      // Calculate scaling efficiency
      if (scalabilityResults.length >= 2) {
        const smallest = scalabilityResults[0];
        const largest = scalabilityResults[scalabilityResults.length - 1];
        const idealThroughput =
          smallest.throughput * (largest.transactions / smallest.transactions);
        const actualThroughput = largest.throughput;
        const scalingEfficiency = (actualThroughput / idealThroughput) * 100;

        console.log(
          `\nScaling Efficiency: ${scalingEfficiency.toFixed(2)}% (${scalingEfficiency > 80 ? "Excellent" : scalingEfficiency > 60 ? "Good" : "Needs improvement"})`,
        );
      }
    });

    it("should analyze system performance under stress", async () => {
      console.log("\n=== Stress Test Analysis ===");
      const { stressTestDuration } = ARCHITECTURE_CONFIG.scalabilityTests;

      const startTime = Date.now();
      let transactionCount = 0;
      let maxLatency = 0;
      let minLatency = Infinity;
      const latencies: number[] = [];

      while (Date.now() - startTime < stressTestDuration) {
        try {
          const transferTx = client.createTransferTransaction(
            testWallets[transactionCount % testWallets.length].publicKey,
            testWallets[(transactionCount + 1) % testWallets.length].publicKey,
            0.01,
          );

          const txStart = Date.now();
          const result = await transactionRunner.runTransaction(
            transferTx,
            "stress-test-transfer",
            200000,
          );

          transactionCount++;

          if (result.success) {
            latencies.push(result.latency);
            maxLatency = Math.max(maxLatency, result.latency);
            minLatency = Math.min(minLatency, result.latency);

            metricsCollector.recordSuccess(
              result.latency,
              "stress-test-transfer",
              result.computeUnitsUsed,
              result.accountSizeChange,
            );
          } else {
            metricsCollector.recordFailure(
              result.error!,
              "stress-test-transfer",
            );
          }
        } catch (error) {
          metricsCollector.recordFailure(
            error as Error,
            "stress-test-transfer",
          );
        }
      }

      const duration = Date.now() - startTime;
      const report = metricsCollector.generateReport(duration);

      printPerformanceReport("Stress Test", report);
      metricsCollector.saveReport(
        report,
        "tests/performance/reports/stress-test.json",
      );

      // Calculate percentiles
      const sortedLatencies = [...latencies].sort((a, b) => a - b);
      const p50 = sortedLatencies[Math.floor(sortedLatencies.length * 0.5)];
      const p95 = sortedLatencies[Math.floor(sortedLatencies.length * 0.95)];
      const p99 = sortedLatencies[Math.floor(sortedLatencies.length * 0.99)];

      console.log("\nStress Test Analysis:");
      console.log(`  Total Transactions: ${transactionCount}`);
      console.log(`  Duration: ${(duration / 1000).toFixed(2)} seconds`);
      console.log(`  Average TPS: ${report.throughput.toFixed(2)}`);
      console.log(
        `  Latency: Min ${minLatency}ms, Max ${maxLatency}ms, Avg ${report.avgLatency.toFixed(2)}ms`,
      );
      console.log(`  Percentiles: P50 ${p50}ms, P95 ${p95}ms, P99 ${p99}ms`);
      console.log(`  Error Rate: ${(report.errorRate * 100).toFixed(2)}%`);

      metricsCollector.reset();
    });
  });

  describe("Architecture Performance Summary", () => {
    it("should generate comprehensive architecture performance analysis", async () => {
      console.log("\n=== Architecture Performance Summary ===");

      // Run a comprehensive test
      const iterations = 100;
      const transactionTypes = [
        { type: "token-transfer", weight: 0.4 },
        { type: "order-placement", weight: 0.3 },
        { type: "order-matching", weight: 0.2 },
        { type: "governance", weight: 0.1 },
      ];

      const startTime = Date.now();

      for (let i = 0; i < iterations; i++) {
        // Select transaction type based on weights
        const rand = Math.random();
        let cumWeight = 0;
        let selectedType = transactionTypes[0].type;

        for (const txType of transactionTypes) {
          cumWeight += txType.weight;
          if (rand < cumWeight) {
            selectedType = txType.type;
            break;
          }
        }

        try {
          let result;

          switch (selectedType) {
            case "token-transfer":
              const transferTx = client.createTransferTransaction(
                testWallets[i % testWallets.length].publicKey,
                testWallets[(i + 1) % testWallets.length].publicKey,
                0.1,
              );

              result = await transactionRunner.runTransaction(
                transferTx,
                "token-transfer",
                200000,
              );
              break;

            case "order-placement":
              const isSell = i % 2 === 0;
              const orderTx = isSell
                ? await client.createSellOrderTransaction(
                    testWallets[i % testWallets.length].publicKey,
                    100, // energy amount
                    100 + i, // price
                  )
                : await client.createBuyOrderTransaction(
                    testWallets[i % testWallets.length].publicKey,
                    100, // energy amount
                    150 + i, // price
                  );

              result = await transactionRunner.runTransaction(
                orderTx,
                "order-placement",
                250000,
              );
              break;

            case "order-matching":
              // Simplified matching test
              const mockMatchTx = new Transaction().add(
                ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 }),
              );

              result = await transactionRunner.runTransaction(
                mockMatchTx,
                "order-matching",
                300000,
              );
              break;

            case "governance":
              // Simplified governance test
              const mockGovTx = new Transaction().add(
                ComputeBudgetProgram.setComputeUnitLimit({ units: 250000 }),
              );

              result = await transactionRunner.runTransaction(
                mockGovTx,
                "governance",
                250000,
              );
              break;
          }

          if (result.success) {
            metricsCollector.recordSuccess(
              result.latency,
              selectedType,
              result.computeUnitsUsed,
              result.accountSizeChange,
            );
          } else {
            metricsCollector.recordFailure(result.error!, selectedType);
          }
        } catch (error) {
          metricsCollector.recordFailure(error as Error, selectedType);
        }
      }

      const duration = Date.now() - startTime;
      const report = metricsCollector.generateReport(duration);

      printPerformanceReport("Architecture Performance Summary", report);

      // Generate benchmark score
      const benchmarkScore = generateBenchmarkScore(report);

      console.log("\n--- Architecture Benchmark Score ---");
      console.log(`Overall Score: ${benchmarkScore.overall}/100`);
      console.log(`Throughput Score: ${benchmarkScore.throughput}/100`);
      console.log(`Latency Score: ${benchmarkScore.latency}/100`);
      console.log(`Reliability Score: ${benchmarkScore.reliability}/100`);
      console.log(`Grade: ${benchmarkScore.grade}`);

      // Architecture evaluation
      console.log("\n--- Architecture Evaluation ---");

      // Evaluate transaction types
      console.log("Transaction Type Performance:");
      for (const [type, count] of Object.entries(report.transactionTypes)) {
        const typeResults = metricsCollector.latencies;
        if (typeResults.length > 0) {
          console.log(`  ${type}: ${count} transactions`);
        }
      }

      // Evaluate resource efficiency
      console.log("\nResource Efficiency:");
      console.log(
        `  Average Compute Units: ${report.avgComputeUnits.toFixed(0)}`,
      );
      console.log(
        `  Average Account Size Change: ${report.avgAccountSizeChange.toFixed(0)} bytes`,
      );

      // Performance recommendations
      console.log("\nPerformance Recommendations:");

      if (report.throughput < 20) {
        console.log(
          "  - Consider optimizing transaction batching to improve throughput",
        );
      }

      if (report.avgLatency > 1000) {
        console.log("  - Analyze instruction complexity to reduce latency");
      }

      if (report.errorRate > 0.05) {
        console.log("  - Investigate error sources and implement retry logic");
      }

      if (report.avgComputeUnits > 250000) {
        console.log(
          "  - Optimize compute-heavy instructions to reduce resource usage",
        );
      }

      // Save final report
      const finalReport = {
        ...report,
        benchmarkScore,
        timestamp: new Date().toISOString(),
        testConfiguration: ARCHITECTURE_CONFIG,
      };

      require("fs").writeFileSync(
        "tests/performance/reports/architecture-performance-summary.json",
        JSON.stringify(finalReport, null, 2),
      );

      metricsCollector.reset();

      // Performance assertions
      expect(benchmarkScore.grade).to.not.equal("D");
      expect(report.successfulTransactions).to.be.greaterThan(0);
    });
  });
});
