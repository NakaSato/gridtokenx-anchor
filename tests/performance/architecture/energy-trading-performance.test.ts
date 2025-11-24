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

// Test configuration
const TEST_CONFIG = {
  // Performance test parameters
  sequentialTransfers: {
    count: 50,
    amount: 0.1,
    delay: 100,
  },
  parallelTransfers: {
    count: 100,
    amount: 0.1,
    batchSize: 10,
  },
  orderPlacement: {
    count: 30,
    energyAmount: 100,
    priceRange: [100, 200],
  },
  orderMatching: {
    count: 20,
    batchSize: 5,
  },
  mixedWorkload: {
    totalTransactions: 200,
    transferRatio: 0.6,
    orderRatio: 0.3,
    matchRatio: 0.1,
  },
  sustainedLoad: {
    duration: 30000, // 30 seconds
    targetTPS: 20,
  },
};

describe("Energy Trading Architecture Performance Analysis", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  let client: GridTokenXClient;
  let transactionRunner: TransactionRunner;
  let metricsCollector: PerformanceMetricsCollector;
  let testWallets: Keypair[] = [];

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
    console.log("Setting up test wallets...");
    for (let i = 0; i < 5; i++) {
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

    // Initialize programs
    try {
      await client.initializeToken();
      await client.initializeMarket();
      console.log("Programs initialized successfully.");
    } catch (e) {
      console.log("Program initialization skipped (already initialized):", e);
    }
  });

  describe("Token Transfer Performance", () => {
    it("should measure latency for sequential token transfers", async () => {
      console.log("\n=== Sequential Token Transfer Performance Test ===");
      const { count, amount, delay } = TEST_CONFIG.sequentialTransfers;

      const startTime = Date.now();
      const results: TransactionResult[] = [];

      for (let i = 0; i < count; i++) {
        const fromIndex = i % testWallets.length;
        const toIndex = (i + 1) % testWallets.length;
        const from = testWallets[fromIndex];
        const to = testWallets[toIndex];

        try {
          // Create and execute transfer transaction
          const transferTx = await client.createTransferTransaction(
            from.publicKey,
            to.publicKey,
            amount,
          );

          const result = await transactionRunner.runTransaction(
            transferTx,
            "token-transfer",
            200000, // Set compute unit limit
          );

          results.push(result);

          if (result.success) {
            metricsCollector.recordSuccess(
              result.latency,
              "token-transfer",
              result.computeUnitsUsed,
              result.accountSizeChange,
            );
          } else {
            metricsCollector.recordFailure(result.error!, "token-transfer");
          }
        } catch (error) {
          metricsCollector.recordFailure(error as Error, "token-transfer");
        }

        // Add delay between transactions
        if (delay > 0 && i < count - 1) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      const totalDuration = Date.now() - startTime;
      const report = metricsCollector.generateReport(totalDuration);

      printPerformanceReport("Sequential Token Transfers", report);

      // Performance assertions
      expect(report.successfulTransactions).to.be.greaterThan(0);
      expect(report.avgLatency).to.be.lessThan(2000);
      expect(report.throughput).to.be.greaterThan(0.5);

      // Save detailed report
      metricsCollector.saveReport(
        report,
        "tests/performance/reports/sequential-transfer-performance.json",
      );

      metricsCollector.reset();
    });

    it("should measure throughput for parallel token transfers", async () => {
      console.log("\n=== Parallel Token Transfer Performance Test ===");
      const { count, amount, batchSize } = TEST_CONFIG.parallelTransfers;

      const startTime = Date.now();
      const allResults: TransactionResult[] = [];

      // Process transactions in batches
      for (let i = 0; i < count; i += batchSize) {
        const batch = [];
        const end = Math.min(i + batchSize, count);

        for (let j = i; j < end; j++) {
          const fromIndex = j % testWallets.length;
          const toIndex = (j + 1) % testWallets.length;
          const from = testWallets[fromIndex];
          const to = testWallets[toIndex];

          const transferTx = client.createTransferTransaction(
            from.publicKey,
            to.publicKey,
            amount,
          );

          batch.push({
            tx: transferTx,
            type: "token-transfer",
            computeUnits: 200000,
          });
        }

        const batchResults =
          await transactionRunner.runParallelTransactions(batch);
        allResults.push(...batchResults);

        // Record metrics
        for (const result of batchResults) {
          if (result.success) {
            metricsCollector.recordSuccess(
              result.latency,
              "token-transfer-parallel",
              result.computeUnitsUsed,
              result.accountSizeChange,
            );
          } else {
            metricsCollector.recordFailure(
              result.error!,
              "token-transfer-parallel",
            );
          }
        }
      }

      const totalDuration = Date.now() - startTime;
      const report = metricsCollector.generateReport(totalDuration);

      printPerformanceReport("Parallel Token Transfers", report);

      // Performance assertions
      expect(report.successfulTransactions).to.be.greaterThan(0);
      expect(report.avgLatency).to.be.lessThan(5000);
      expect(report.throughput).to.be.greaterThan(1.0);

      // Analyze performance trends
      const trends = transactionRunner.analyzePerformanceTrends(allResults);
      console.log("\nPerformance Trends:", trends);

      // Save detailed report
      metricsCollector.saveReport(
        report,
        "tests/performance/reports/parallel-transfer-performance.json",
      );

      metricsCollector.reset();
    });
  });

  describe("Order Placement Performance", () => {
    it("should measure performance for buy/sell order placement", async () => {
      console.log("\n=== Order Placement Performance Test ===");
      const { count, energyAmount, priceRange } = TEST_CONFIG.orderPlacement;

      const startTime = Date.now();
      const orderIds: string[] = [];

      for (let i = 0; i < count; i++) {
        const isSell = i % 2 === 0;
        const price =
          priceRange[0] + Math.random() * (priceRange[1] - priceRange[0]);
        const wallet = testWallets[i % testWallets.length];

        try {
          let result;

          if (isSell) {
            // Create sell order
            const sellOrderTx = await client.createSellOrderTransaction(
              wallet.publicKey,
              energyAmount,
              Math.floor(price),
            );

            result = await transactionRunner.runTransaction(
              sellOrderTx,
              "sell-order",
              250000, // Higher compute units for order placement
            );
          } else {
            // Create buy order
            const buyOrderTx = await client.createBuyOrderTransaction(
              wallet.publicKey,
              energyAmount,
              Math.floor(price),
            );

            result = await transactionRunner.runTransaction(
              buyOrderTx,
              "buy-order",
              250000,
            );
          }

          if (result.success) {
            metricsCollector.recordSuccess(
              result.latency,
              isSell ? "sell-order" : "buy-order",
              result.computeUnitsUsed,
              result.accountSizeChange,
            );

            // Store order ID for potential matching
            if (result.signature) {
              orderIds.push(result.signature);
            }
          } else {
            metricsCollector.recordFailure(
              result.error!,
              isSell ? "sell-order" : "buy-order",
            );
          }
        } catch (error) {
          metricsCollector.recordFailure(
            error as Error,
            isSell ? "sell-order" : "buy-order",
          );
        }
      }

      const totalDuration = Date.now() - startTime;
      const report = metricsCollector.generateReport(totalDuration);

      printPerformanceReport("Order Placement", report);

      // Performance assertions
      expect(report.successfulTransactions).to.be.greaterThan(0);
      expect(report.avgLatency).to.be.lessThan(3000);

      // Save detailed report
      metricsCollector.saveReport(
        report,
        "tests/performance/reports/order-placement-performance.json",
      );

      metricsCollector.reset();
    });
  });

  describe("Order Matching Performance", () => {
    it("should measure performance for order matching operations", async () => {
      console.log("\n=== Order Matching Performance Test ===");
      const { count, batchSize } = TEST_CONFIG.orderMatching;

      // First create some orders to match
      console.log("Creating orders for matching test...");
      const sellOrderIds: string[] = [];
      const buyOrderIds: string[] = [];

      // Create sell orders
      for (let i = 0; i < count; i++) {
        const price = 100 + i * 2; // Increasing prices
        const wallet = testWallets[i % testWallets.length];

        try {
          const sellOrderTx = await client.createSellOrderTransaction(
            wallet.publicKey,
            100, // Fixed energy amount
            price,
          );

          const result = await transactionRunner.runTransaction(
            sellOrderTx,
            "sell-order-for-matching",
            250000,
          );

          if (result.success && result.signature) {
            sellOrderIds.push(result.signature);
          }
        } catch (error) {
          // Continue even if some orders fail
        }
      }

      // Create buy orders
      for (let i = 0; i < count; i++) {
        const price = 150 + i * 2; // Higher prices than sell orders
        const wallet = testWallets[i % testWallets.length];

        try {
          const buyOrderTx = await client.createBuyOrderTransaction(
            wallet.publicKey,
            100, // Fixed energy amount
            price,
          );

          const result = await transactionRunner.runTransaction(
            buyOrderTx,
            "buy-order-for-matching",
            250000,
          );

          if (result.success && result.signature) {
            buyOrderIds.push(result.signature);
          }
        } catch (error) {
          // Continue even if some orders fail
        }
      }

      console.log(
        `Created ${sellOrderIds.length} sell orders and ${buyOrderIds.length} buy orders`,
      );

      // Now match orders
      console.log("Starting order matching performance test...");
      const startTime = Date.now();

      for (
        let i = 0;
        i < Math.min(sellOrderIds.length, buyOrderIds.length);
        i++
      ) {
        try {
          const matchTx = await client.createMatchOrdersTransaction(
            sellOrderIds[i],
            buyOrderIds[i],
            50, // Match amount
          );

          const result = await transactionRunner.runTransaction(
            matchTx,
            "order-matching",
            300000, // Higher compute units for matching
          );

          if (result.success) {
            metricsCollector.recordSuccess(
              result.latency,
              "order-matching",
              result.computeUnitsUsed,
              result.accountSizeChange,
            );
          } else {
            metricsCollector.recordFailure(result.error!, "order-matching");
          }
        } catch (error) {
          metricsCollector.recordFailure(error as Error, "order-matching");
        }
      }

      const totalDuration = Date.now() - startTime;
      const report = metricsCollector.generateReport(totalDuration);

      printPerformanceReport("Order Matching", report);

      // Performance assertions
      expect(report.successfulTransactions).to.be.greaterThan(0);
      expect(report.avgLatency).to.be.lessThan(4000);

      // Save detailed report
      metricsCollector.saveReport(
        report,
        "tests/performance/reports/order-matching-performance.json",
      );

      metricsCollector.reset();
    });
  });

  describe("Mixed Workload Performance", () => {
    it("should handle mixed transaction workload", async () => {
      console.log("\n=== Mixed Workload Performance Test ===");
      const { totalTransactions, transferRatio, orderRatio, matchRatio } =
        TEST_CONFIG.mixedWorkload;

      const startTime = Date.now();

      for (let i = 0; i < totalTransactions; i++) {
        let transactionType;
        const rand = Math.random();

        try {
          let result;

          if (rand < transferRatio) {
            // Token transfer
            transactionType = "token-transfer";
            const from = testWallets[i % testWallets.length];
            const to = testWallets[(i + 1) % testWallets.length];

            const transferTx = client.createTransferTransaction(
              from.publicKey,
              to.publicKey,
              0.1,
            );

            result = await transactionRunner.runTransaction(
              transferTx,
              transactionType,
              200000,
            );
          } else if (rand < transferRatio + orderRatio) {
            // Order placement
            transactionType = "order-placement";
            const wallet = testWallets[i % testWallets.length];
            const isSell = i % 2 === 0;

            if (isSell) {
              const sellOrderTx = await client.createSellOrderTransaction(
                wallet.publicKey,
                100,
                100 + Math.random() * 100,
              );

              result = await transactionRunner.runTransaction(
                sellOrderTx,
                transactionType,
                250000,
              );
            } else {
              const buyOrderTx = await client.createBuyOrderTransaction(
                wallet.publicKey,
                100,
                100 + Math.random() * 100,
              );

              result = await transactionRunner.runTransaction(
                buyOrderTx,
                transactionType,
                250000,
              );
            }
          } else {
            // Order matching
            transactionType = "order-matching";

            // For this test, we'll just simulate a matching transaction
            // without actual order IDs to simplify the test
            const mockMatchTx = new Transaction().add(
              ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 }),
            );

            result = await transactionRunner.runTransaction(
              mockMatchTx,
              transactionType,
              300000,
            );
          }

          if (result.success) {
            metricsCollector.recordSuccess(
              result.latency,
              transactionType,
              result.computeUnitsUsed,
              result.accountSizeChange,
            );
          } else {
            metricsCollector.recordFailure(result.error!, transactionType);
          }
        } catch (error) {
          metricsCollector.recordFailure(
            error as Error,
            transactionType || "unknown",
          );
        }
      }

      const totalDuration = Date.now() - startTime;
      const report = metricsCollector.generateReport(totalDuration);

      printPerformanceReport("Mixed Workload", report);

      // Performance assertions
      expect(report.successfulTransactions).to.be.greaterThan(0);
      expect(report.avgLatency).to.be.lessThan(3000);
      expect(report.throughput).to.be.greaterThan(1.0);

      // Save detailed report
      metricsCollector.saveReport(
        report,
        "tests/performance/reports/mixed-workload-performance.json",
      );

      metricsCollector.reset();
    });
  });

  describe("Sustained Load Performance", () => {
    it("should handle sustained transaction load", async () => {
      console.log("\n=== Sustained Load Performance Test ===");
      const { duration, targetTPS } = TEST_CONFIG.sustainedLoad;

      const startTime = Date.now();
      let transactionCount = 0;
      const intervalMs = 1000 / targetTPS;

      while (Date.now() - startTime < duration) {
        try {
          const wallet = testWallets[transactionCount % testWallets.length];
          const transferTx = client.createTransferTransaction(
            wallet.publicKey,
            testWallets[(transactionCount + 1) % testWallets.length].publicKey,
            0.01,
          );

          const result = await transactionRunner.runTransaction(
            transferTx,
            "sustained-load-transfer",
            200000,
          );

          transactionCount++;

          if (result.success) {
            metricsCollector.recordSuccess(
              result.latency,
              "sustained-load-transfer",
              result.computeUnitsUsed,
              result.accountSizeChange,
            );
          } else {
            metricsCollector.recordFailure(
              result.error!,
              "sustained-load-transfer",
            );
          }

          // Wait to maintain target TPS
          const elapsed = Date.now() - startTime;
          const expectedElapsed = transactionCount * intervalMs;
          const waitTime = expectedElapsed - elapsed;

          if (waitTime > 0) {
            await new Promise((resolve) => setTimeout(resolve, waitTime));
          }
        } catch (error) {
          metricsCollector.recordFailure(
            error as Error,
            "sustained-load-transfer",
          );
        }
      }

      const totalDuration = Date.now() - startTime;
      const report = metricsCollector.generateReport(totalDuration);

      printPerformanceReport("Sustained Load", report);

      // Performance assertions
      expect(report.successfulTransactions).to.be.greaterThan(0);
      expect(report.throughput).to.be.greaterThan(targetTPS * 0.8); // 80% of target

      // Save detailed report
      metricsCollector.saveReport(
        report,
        "tests/performance/reports/sustained-load-performance.json",
      );

      metricsCollector.reset();
    });
  });

  describe("Performance Benchmark Scoring", () => {
    it("should generate overall performance benchmark score", async () => {
      console.log("\n=== Overall Performance Benchmark ===");

      // Run a standard benchmark
      const startTime = Date.now();
      const benchmarkTxCount = 50;

      for (let i = 0; i < benchmarkTxCount; i++) {
        try {
          const wallet = testWallets[i % testWallets.length];
          const transferTx = client.createTransferTransaction(
            wallet.publicKey,
            testWallets[(i + 1) % testWallets.length].publicKey,
            0.1,
          );

          const result = await transactionRunner.runTransaction(
            transferTx,
            "benchmark-transfer",
            200000,
          );

          if (result.success) {
            metricsCollector.recordSuccess(
              result.latency,
              "benchmark-transfer",
              result.computeUnitsUsed,
              result.accountSizeChange,
            );
          } else {
            metricsCollector.recordFailure(result.error!, "benchmark-transfer");
          }
        } catch (error) {
          metricsCollector.recordFailure(error as Error, "benchmark-transfer");
        }
      }

      const totalDuration = Date.now() - startTime;
      const report = metricsCollector.generateReport(totalDuration);

      printPerformanceReport("Overall Benchmark", report);

      // Generate benchmark score
      const benchmarkScore = generateBenchmarkScore(report);

      console.log("\n--- Benchmark Score ---");
      console.log(`Overall Score: ${benchmarkScore.overall}/100`);
      console.log(`Throughput Score: ${benchmarkScore.throughput}/100`);
      console.log(`Latency Score: ${benchmarkScore.latency}/100`);
      console.log(`Reliability Score: ${benchmarkScore.reliability}/100`);
      console.log(`Grade: ${benchmarkScore.grade}`);

      // Save detailed report
      metricsCollector.saveReport(
        report,
        "tests/performance/reports/overall-benchmark.json",
      );

      // Performance assertions based on grade
      expect(benchmarkScore.grade).to.not.equal("D");
      expect(report.successfulTransactions).to.be.greaterThan(0);

      metricsCollector.reset();
    });
  });
});
