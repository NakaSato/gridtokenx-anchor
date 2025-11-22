import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import { GridTokenXClient } from "../src/client/js/gridtokenx-client";

describe("Performance Benchmark - Transaction Latency & Throughput", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  let client: GridTokenXClient;

  // Performance metrics storage
  interface PerformanceMetrics {
    totalTransactions: number;
    successfulTransactions: number;
    failedTransactions: number;
    totalDuration: number;
    latencies: number[];
    throughput: number;
    avgLatency: number;
    minLatency: number;
    maxLatency: number;
    p50Latency: number;
    p95Latency: number;
    p99Latency: number;
  }

  before(async () => {
    client = new GridTokenXClient({
      connection: provider.connection,
      wallet: (provider.wallet as anchor.Wallet).payer,
    });

    console.log("Initializing programs for benchmark...");

    // Initialize Token Program
    try {
      console.log("Attempting to initialize Token Program...");
      await client.initializeToken();
      console.log("Token Program initialized successfully.");
    } catch (e: any) {
      console.log(
        "Token Program initialization skipped (likely already initialized):",
        e.message
      );
    }

    // Initialize Trading Market
    try {
      console.log("Attempting to initialize Trading Market...");
      await client.initializeMarket();
      console.log("Trading Market initialized successfully.");
    } catch (e: any) {
      console.log(
        "Trading Market initialization skipped (likely already initialized):",
        e.message
      );
    }

    // Initialize Registry if needed
    try {
      await client.initializeRegistry().catch(() => {});
    } catch (e) {}

    // Mint tokens to the payer wallet for testing
    try {
      console.log("Minting initial tokens to payer wallet...");
      await client.mintTokens(
        BigInt(1_000_000_000),
        client.getWalletAddress().toString()
      );
      console.log("Initial tokens minted.");
    } catch (e: any) {
      console.log("Error minting initial tokens:", e.message);
    }
  });

  /**
   * Calculate performance metrics from latency measurements
   */
  function calculateMetrics(
    latencies: number[],
    totalDuration: number,
    failed: number
  ): PerformanceMetrics {
    const sorted = [...latencies].sort((a, b) => a - b);
    const count = latencies.length;

    return {
      totalTransactions: count + failed,
      successfulTransactions: count,
      failedTransactions: failed,
      totalDuration,
      latencies,
      throughput: totalDuration > 0 ? count / (totalDuration / 1000) : 0,
      avgLatency:
        count > 0 ? latencies.reduce((sum, lat) => sum + lat, 0) / count : 0,
      minLatency: count > 0 ? Math.min(...sorted) : 0,
      maxLatency: count > 0 ? Math.max(...sorted) : 0,
      p50Latency: count > 0 ? sorted[Math.floor(count * 0.5)] : 0,
      p95Latency: count > 0 ? sorted[Math.floor(count * 0.95)] : 0,
      p99Latency: count > 0 ? sorted[Math.floor(count * 0.99)] : 0,
    };
  }

  /**
   * Print formatted performance report
   */
  function printReport(testName: string, metrics: PerformanceMetrics) {
    console.log("\n" + "=".repeat(70));
    console.log(`  ${testName}`);
    console.log("=".repeat(70));
    console.log(`  Total Transactions:      ${metrics.totalTransactions}`);
    console.log(`  Successful:              ${metrics.successfulTransactions}`);
    console.log(`  Failed:                  ${metrics.failedTransactions}`);
    console.log(
      `  Total Duration:          ${metrics.totalDuration.toFixed(2)} ms`
    );
    console.log(
      `  Throughput:              ${metrics.throughput.toFixed(2)} tx/sec`
    );
    console.log("-".repeat(70));
    console.log(
      `  Avg Latency:             ${metrics.avgLatency.toFixed(2)} ms`
    );
    console.log(
      `  Min Latency:             ${metrics.minLatency.toFixed(2)} ms`
    );
    console.log(
      `  Max Latency:             ${metrics.maxLatency.toFixed(2)} ms`
    );
    console.log(
      `  P50 Latency (Median):    ${metrics.p50Latency.toFixed(2)} ms`
    );
    console.log(
      `  P95 Latency:             ${metrics.p95Latency.toFixed(2)} ms`
    );
    console.log(
      `  P99 Latency:             ${metrics.p99Latency.toFixed(2)} ms`
    );
    console.log("=".repeat(70) + "\n");
  }

  describe("Sequential Transaction Loop", () => {
    it("should measure latency for 50 sequential token transfers", async function (this: Mocha.Context) {
      this.timeout(300000); // 5 minutes

      const iterations = 50;
      const latencies: number[] = [];
      let failed = 0;

      const recipient = anchor.web3.Keypair.generate();
      const transferAmount = BigInt(1_000_000); // 1M tokens per transfer

      console.log(
        `\n🚀 Starting sequential transaction test (${iterations} iterations)...`
      );
      const startTime = Date.now();

      for (let i = 0; i < iterations; i++) {
        const txStart = Date.now();
        try {
          await client.transferTokens(
            recipient.publicKey.toString(),
            transferAmount
          );
          const txEnd = Date.now();
          const latency = txEnd - txStart;
          latencies.push(latency);

          if ((i + 1) % 10 === 0) {
            console.log(`  ✓ Completed ${i + 1}/${iterations} transactions`);
          }
        } catch (error: any) {
          failed++;
          console.log(`  ✗ Transaction ${i + 1} failed: ${error.message}`);
        }
      }

      const endTime = Date.now();
      const totalDuration = endTime - startTime;

      const metrics = calculateMetrics(latencies, totalDuration, failed);
      printReport("Sequential Token Transfers", metrics);

      expect(metrics.successfulTransactions).to.be.greaterThan(0);
      expect(metrics.avgLatency).to.be.lessThan(10000); // Should average < 10s per tx
    });

    it.only("should measure latency for 30 sequential order placements", async function (this: Mocha.Context) {
      this.timeout(300000); // 5 minutes

      const iterations = 30;
      const latencies: number[] = [];
      let failed = 0;

      console.log(
        `\n🚀 Starting sequential order placement test (${iterations} iterations)...`
      );
      const startTime = Date.now();

      for (let i = 0; i < iterations; i++) {
        const txStart = Date.now();
        try {
          const side = i % 2 === 0 ? "buy" : "sell";
          const energyAmount = BigInt(50 + i * 10);
          const price = BigInt(45 + (i % 20));

          await client.placeOrder(side, energyAmount, price);
          const txEnd = Date.now();
          const latency = txEnd - txStart;
          latencies.push(latency);

          if ((i + 1) % 5 === 0) {
            console.log(`  ✓ Completed ${i + 1}/${iterations} orders`);
          }
        } catch (error: any) {
          failed++;
          console.log(`  ✗ Order ${i + 1} failed: ${error.message}`);
        }
      }

      const endTime = Date.now();
      const totalDuration = endTime - startTime;

      const metrics = calculateMetrics(latencies, totalDuration, failed);
      printReport("Sequential Order Placements", metrics);

      expect(metrics.successfulTransactions).to.be.greaterThan(0);
    });

    it("should measure latency for 20 sequential REC validator additions", async function (this: Mocha.Context) {
      this.timeout(300000); // 5 minutes

      const iterations = 20;
      const latencies: number[] = [];
      let failed = 0;

      console.log(
        `\n🚀 Starting sequential REC validator addition test (${iterations} iterations)...`
      );
      const startTime = Date.now();

      for (let i = 0; i < iterations; i++) {
        const txStart = Date.now();
        try {
          const validator = anchor.web3.Keypair.generate();
          const authorityName = `Authority_${i}_${Date.now()}`;

          await client.addRecValidator(
            validator.publicKey.toString(),
            authorityName
          );
          const txEnd = Date.now();
          const latency = txEnd - txStart;
          latencies.push(latency);

          if ((i + 1) % 5 === 0) {
            console.log(`  ✓ Completed ${i + 1}/${iterations} validators`);
          }
        } catch (error: any) {
          failed++;
          console.log(`  ✗ Validator ${i + 1} failed: ${error.message}`);
        }
      }

      const endTime = Date.now();
      const totalDuration = endTime - startTime;

      const metrics = calculateMetrics(latencies, totalDuration, failed);
      printReport("Sequential REC Validator Additions", metrics);

      expect(metrics.successfulTransactions).to.be.greaterThan(0);
    });
  });

  describe("Batch Transaction Loop", () => {
    it("should measure throughput for 100 token transfers in batches of 10", async function (this: Mocha.Context) {
      this.timeout(600000); // 10 minutes

      const totalIterations = 100;
      const batchSize = 10;
      const latencies: number[] = [];
      let failed = 0;

      const recipient = anchor.web3.Keypair.generate();
      const transferAmount = BigInt(500_000); // 500K tokens per transfer

      console.log(
        `\n🚀 Starting batch transaction test (${totalIterations} total, batches of ${batchSize})...`
      );
      const startTime = Date.now();

      for (let batch = 0; batch < totalIterations / batchSize; batch++) {
        const batchPromises = [];

        for (let i = 0; i < batchSize; i++) {
          const txStart = Date.now();
          const promise = client
            .transferTokens(recipient.publicKey.toString(), transferAmount)
            .then(() => {
              const latency = Date.now() - txStart;
              latencies.push(latency);
            })
            .catch((error: any) => {
              failed++;
              console.log(
                `  ✗ Batch ${batch} tx ${i} failed: ${error.message}`
              );
            });

          batchPromises.push(promise);
        }

        await Promise.all(batchPromises);
        console.log(
          `  ✓ Completed batch ${batch + 1}/${totalIterations / batchSize} (${
            latencies.length
          } successful)`
        );
      }

      const endTime = Date.now();
      const totalDuration = endTime - startTime;

      const metrics = calculateMetrics(latencies, totalDuration, failed);
      printReport("Batch Token Transfers", metrics);

      expect(metrics.successfulTransactions).to.be.greaterThan(50);
    });

    it("should measure throughput for 60 order placements in batches of 5", async function (this: Mocha.Context) {
      this.timeout(600000); // 10 minutes

      const totalIterations = 60;
      const batchSize = 5;
      const latencies: number[] = [];
      let failed = 0;

      console.log(
        `\n🚀 Starting batch order placement test (${totalIterations} total, batches of ${batchSize})...`
      );
      const startTime = Date.now();

      for (let batch = 0; batch < totalIterations / batchSize; batch++) {
        const batchPromises = [];

        for (let i = 0; i < batchSize; i++) {
          const txIndex = batch * batchSize + i;
          const txStart = Date.now();
          const side = txIndex % 2 === 0 ? "buy" : "sell";
          const energyAmount = BigInt(100 + txIndex * 5);
          const price = BigInt(50 + (txIndex % 15));

          const promise = client
            .placeOrder(side, energyAmount, price)
            .then(() => {
              const latency = Date.now() - txStart;
              latencies.push(latency);
            })
            .catch((error: any) => {
              failed++;
              console.log(
                `  ✗ Batch ${batch} order ${i} failed: ${error.message}`
              );
            });

          batchPromises.push(promise);
        }

        await Promise.all(batchPromises);
        console.log(
          `  ✓ Completed batch ${batch + 1}/${totalIterations / batchSize} (${
            latencies.length
          } successful)`
        );
      }

      const endTime = Date.now();
      const totalDuration = endTime - startTime;

      const metrics = calculateMetrics(latencies, totalDuration, failed);
      printReport("Batch Order Placements", metrics);

      expect(metrics.successfulTransactions).to.be.greaterThan(30);
    });
  });

  describe("Sustained Load Test", () => {
    it("should handle sustained load of 200 mixed transactions", async function (this: Mocha.Context) {
      this.timeout(900000); // 15 minutes

      const iterations = 200;
      const latencies: number[] = [];
      let failed = 0;

      const recipient = anchor.web3.Keypair.generate();

      console.log(
        `\n🚀 Starting sustained load test (${iterations} mixed transactions)...`
      );
      const startTime = Date.now();

      for (let i = 0; i < iterations; i++) {
        const txStart = Date.now();
        try {
          // Alternate between different transaction types
          const txType = i % 4;

          switch (txType) {
            case 0: // Token transfer
              await client.transferTokens(
                recipient.publicKey.toString(),
                BigInt(100_000 + i * 1000)
              );
              break;

            case 1: // Buy order
              await client.placeOrder(
                "buy",
                BigInt(50 + (i % 100)),
                BigInt(40 + (i % 30))
              );
              break;

            case 2: // Sell order
              await client.placeOrder(
                "sell",
                BigInt(50 + (i % 100)),
                BigInt(40 + (i % 30))
              );
              break;

            case 3: // Token burn
              await client.burnTokens(BigInt(10_000 + i * 100));
              break;
          }

          const txEnd = Date.now();
          const latency = txEnd - txStart;
          latencies.push(latency);

          if ((i + 1) % 25 === 0) {
            console.log(`  ✓ Completed ${i + 1}/${iterations} transactions`);
          }
        } catch (error: any) {
          failed++;
          console.log(`  ✗ Transaction ${i + 1} failed: ${error.message}`);
        }
      }

      const endTime = Date.now();
      const totalDuration = endTime - startTime;

      const metrics = calculateMetrics(latencies, totalDuration, failed);
      printReport("Sustained Mixed Load Test", metrics);

      expect(metrics.successfulTransactions).to.be.greaterThan(100);

      // Performance assertions
      console.log("\n📊 Performance Criteria:");
      console.log(
        `  ✓ Throughput: ${metrics.throughput.toFixed(2)} tx/sec ${
          metrics.throughput > 0.5 ? "(PASS)" : "(FAIL)"
        }`
      );
      console.log(
        `  ✓ Avg Latency: ${metrics.avgLatency.toFixed(2)} ms ${
          metrics.avgLatency < 15000 ? "(PASS)" : "(FAIL)"
        }`
      );
      console.log(
        `  ✓ P95 Latency: ${metrics.p95Latency.toFixed(2)} ms ${
          metrics.p95Latency < 20000 ? "(PASS)" : "(FAIL)"
        }`
      );
      console.log(
        `  ✓ Success Rate: ${(
          (metrics.successfulTransactions / metrics.totalTransactions) *
          100
        ).toFixed(2)}% ${
          metrics.successfulTransactions / metrics.totalTransactions > 0.7
            ? "(PASS)"
            : "(FAIL)"
        }\n`
      );
    });
  });

  describe("Stress Test - High Volume", () => {
    it("should stress test with 500 rapid token burns", async function (this: Mocha.Context) {
      this.timeout(1800000); // 30 minutes

      const iterations = 500;
      const latencies: number[] = [];
      let failed = 0;

      console.log(`\n🚀 Starting stress test (${iterations} token burns)...`);
      const startTime = Date.now();

      for (let i = 0; i < iterations; i++) {
        const txStart = Date.now();
        try {
          await client.burnTokens(BigInt(1_000 + i * 10));
          const txEnd = Date.now();
          const latency = txEnd - txStart;
          latencies.push(latency);

          if ((i + 1) % 50 === 0) {
            const currentMetrics = calculateMetrics(
              latencies,
              Date.now() - startTime,
              failed
            );
            console.log(
              `  ✓ ${
                i + 1
              }/${iterations} | Throughput: ${currentMetrics.throughput.toFixed(
                2
              )} tx/sec | Avg Latency: ${currentMetrics.avgLatency.toFixed(
                2
              )} ms`
            );
          }
        } catch (error: any) {
          failed++;
          if (failed % 10 === 0) {
            console.log(`  ⚠ ${failed} transactions failed so far`);
          }
        }
      }

      const endTime = Date.now();
      const totalDuration = endTime - startTime;

      const metrics = calculateMetrics(latencies, totalDuration, failed);
      printReport("Stress Test - Token Burns", metrics);

      expect(metrics.successfulTransactions).to.be.greaterThan(250);
    });
  });

  describe("Latency Distribution Analysis", () => {
    it("should analyze latency distribution across 100 transfers", async function (this: Mocha.Context) {
      this.timeout(600000); // 10 minutes

      const iterations = 100;
      const latencies: number[] = [];
      let failed = 0;

      const recipient = anchor.web3.Keypair.generate();

      console.log(
        `\n🚀 Collecting latency samples (${iterations} transactions)...`
      );
      const startTime = Date.now();

      for (let i = 0; i < iterations; i++) {
        const txStart = Date.now();
        try {
          await client.transferTokens(
            recipient.publicKey.toString(),
            BigInt(1_000_000)
          );
          const latency = Date.now() - txStart;
          latencies.push(latency);
        } catch (error: any) {
          failed++;
        }
      }

      const totalDuration = Date.now() - startTime;
      const metrics = calculateMetrics(latencies, totalDuration, failed);

      // Calculate latency buckets
      const buckets = {
        "0-1s": 0,
        "1-2s": 0,
        "2-5s": 0,
        "5-10s": 0,
        "10s+": 0,
      };

      latencies.forEach((lat) => {
        if (lat < 1000) buckets["0-1s"]++;
        else if (lat < 2000) buckets["1-2s"]++;
        else if (lat < 5000) buckets["2-5s"]++;
        else if (lat < 10000) buckets["5-10s"]++;
        else buckets["10s+"]++;
      });

      printReport("Latency Distribution Analysis", metrics);

      console.log("📊 Latency Distribution:");
      console.log(
        `  0-1s:     ${buckets["0-1s"].toString().padStart(4)} (${(
          (buckets["0-1s"] / latencies.length) *
          100
        ).toFixed(1)}%)`
      );
      console.log(
        `  1-2s:     ${buckets["1-2s"].toString().padStart(4)} (${(
          (buckets["1-2s"] / latencies.length) *
          100
        ).toFixed(1)}%)`
      );
      console.log(
        `  2-5s:     ${buckets["2-5s"].toString().padStart(4)} (${(
          (buckets["2-5s"] / latencies.length) *
          100
        ).toFixed(1)}%)`
      );
      console.log(
        `  5-10s:    ${buckets["5-10s"].toString().padStart(4)} (${(
          (buckets["5-10s"] / latencies.length) *
          100
        ).toFixed(1)}%)`
      );
      console.log(
        `  10s+:     ${buckets["10s+"].toString().padStart(4)} (${(
          (buckets["10s+"] / latencies.length) *
          100
        ).toFixed(1)}%)\n`
      );

      expect(metrics.successfulTransactions).to.be.greaterThan(50);
    });
  });
});
