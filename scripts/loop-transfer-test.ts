#!/usr/bin/env ts-node
/**
 * Loop Transfer Performance Test Script
 * 
 * Tests transaction latency and throughput by looping transfers between 2 wallets.
 * Measures: latency (min/max/avg/p95/p99), throughput (tx/sec), success rate
 * 
 * Usage: ts-node scripts/loop-transfer-test.ts [iterations] [amount]
 * 
 * Examples:
 *   ts-node scripts/loop-transfer-test.ts           # Default: 100 iterations, 1 GRX
 *   ts-node scripts/loop-transfer-test.ts 50        # 50 iterations, 1 GRX
 *   ts-node scripts/loop-transfer-test.ts 200 0.5   # 200 iterations, 0.5 GRX
 */

import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount,
  transfer,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import * as fs from "fs";

// Configuration
const CONFIG = {
  wallet1Path: "./wallet-1-keypair.json",
  wallet2Path: "./wallet-2-keypair.json",
  mintInfoPath: "./grx-token-info.json",
  tokenDecimals: 9,
  rpcUrl: process.env.ANCHOR_PROVIDER_URL || "http://localhost:8899",
};

// Performance metrics interface
interface PerformanceMetrics {
  totalTransactions: number;
  successfulTransactions: number;
  failedTransactions: number;
  totalDuration: number; // milliseconds
  latencies: number[]; // milliseconds per tx
  throughput: number; // tx/sec
  avgLatency: number;
  minLatency: number;
  maxLatency: number;
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
}

// Helper functions
function loadKeypair(filePath: string): Keypair {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Keypair file not found: ${filePath}. Run 'ts-node scripts/grx-wallet-manager.ts setup' first.`);
  }
  const keypairData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(keypairData));
}

function loadMintInfo(): { mint: PublicKey; name: string; symbol: string } {
  if (!fs.existsSync(CONFIG.mintInfoPath)) {
    throw new Error(`Mint info not found: ${CONFIG.mintInfoPath}. Run create-grx-token.ts first.`);
  }
  const mintInfo = JSON.parse(fs.readFileSync(CONFIG.mintInfoPath, "utf-8"));
  return {
    mint: new PublicKey(mintInfo.mint),
    name: mintInfo.name,
    symbol: mintInfo.symbol,
  };
}

function parseTokenAmount(amount: number | string): bigint {
  return BigInt(Math.floor(Number(amount) * Math.pow(10, CONFIG.tokenDecimals)));
}

function formatTokenAmount(amount: bigint): string {
  return (Number(amount) / Math.pow(10, CONFIG.tokenDecimals)).toFixed(CONFIG.tokenDecimals);
}

// Calculate performance metrics
function calculateMetrics(
  latencies: number[],
  totalDuration: number,
  failed: number
): PerformanceMetrics {
  if (latencies.length === 0) {
    return {
      totalTransactions: failed,
      successfulTransactions: 0,
      failedTransactions: failed,
      totalDuration,
      latencies: [],
      throughput: 0,
      avgLatency: 0,
      minLatency: 0,
      maxLatency: 0,
      p50Latency: 0,
      p95Latency: 0,
      p99Latency: 0,
    };
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const sum = latencies.reduce((acc, val) => acc + val, 0);

  return {
    totalTransactions: latencies.length + failed,
    successfulTransactions: latencies.length,
    failedTransactions: failed,
    totalDuration,
    latencies,
    throughput: (latencies.length / totalDuration) * 1000, // tx/sec
    avgLatency: sum / latencies.length,
    minLatency: sorted[0],
    maxLatency: sorted[sorted.length - 1],
    p50Latency: sorted[Math.floor(sorted.length * 0.5)],
    p95Latency: sorted[Math.floor(sorted.length * 0.95)],
    p99Latency: sorted[Math.floor(sorted.length * 0.99)],
  };
}

// Print formatted performance report
function printReport(testName: string, metrics: PerformanceMetrics, symbol: string) {
  console.log("\n" + "=".repeat(70));
  console.log(`  ${testName}`);
  console.log("=".repeat(70));
  console.log(`  Total Transactions:      ${metrics.totalTransactions}`);
  console.log(`  Successful:              ${metrics.successfulTransactions} ✅`);
  console.log(`  Failed:                  ${metrics.failedTransactions} ❌`);
  console.log(`  Total Duration:          ${metrics.totalDuration.toFixed(2)} ms`);
  console.log(`  Throughput:              ${metrics.throughput.toFixed(4)} tx/sec`);
  console.log("-".repeat(70));
  console.log(`  Avg Latency:             ${metrics.avgLatency.toFixed(2)} ms`);
  console.log(`  Min Latency:             ${metrics.minLatency.toFixed(2)} ms`);
  console.log(`  Max Latency:             ${metrics.maxLatency.toFixed(2)} ms`);
  console.log(`  P50 Latency (Median):    ${metrics.p50Latency.toFixed(2)} ms`);
  console.log(`  P95 Latency:             ${metrics.p95Latency.toFixed(2)} ms`);
  console.log(`  P99 Latency:             ${metrics.p99Latency.toFixed(2)} ms`);
  console.log("=".repeat(70));

  // Performance criteria
  const successRate = (metrics.successfulTransactions / metrics.totalTransactions) * 100;
  console.log("\n📊 Performance Criteria:");
  console.log(`  Throughput:      ${metrics.throughput.toFixed(4)} tx/sec ${metrics.throughput > 0.5 ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`  Avg Latency:     ${metrics.avgLatency.toFixed(2)} ms ${metrics.avgLatency < 5000 ? "✅ PASS" : "⚠️  WARNING"}`);
  console.log(`  P95 Latency:     ${metrics.p95Latency.toFixed(2)} ms ${metrics.p95Latency < 10000 ? "✅ PASS" : "⚠️  WARNING"}`);
  console.log(`  Success Rate:    ${successRate.toFixed(2)}% ${successRate > 90 ? "✅ PASS" : "❌ FAIL"}`);
  console.log("");
}

// Print latency distribution
function printLatencyDistribution(latencies: number[]) {
  const buckets = {
    "0-100ms": 0,
    "100-500ms": 0,
    "500ms-1s": 0,
    "1-2s": 0,
    "2-5s": 0,
    "5s+": 0,
  };

  latencies.forEach((lat) => {
    if (lat < 100) buckets["0-100ms"]++;
    else if (lat < 500) buckets["100-500ms"]++;
    else if (lat < 1000) buckets["500ms-1s"]++;
    else if (lat < 2000) buckets["1-2s"]++;
    else if (lat < 5000) buckets["2-5s"]++;
    else buckets["5s+"]++;
  });

  console.log("📊 Latency Distribution:");
  Object.entries(buckets).forEach(([range, count]) => {
    const percentage = ((count / latencies.length) * 100).toFixed(1);
    const bar = "█".repeat(Math.floor((count / latencies.length) * 50));
    console.log(`  ${range.padEnd(12)} ${count.toString().padStart(4)} (${percentage.padStart(5)}%) ${bar}`);
  });
  console.log("");
}

// Check and display wallet balances
async function checkBalances(
  connection: Connection,
  wallet1: Keypair,
  wallet2: Keypair,
  mint: PublicKey,
  symbol: string
) {
  const wallet1TokenAccount = getAssociatedTokenAddressSync(
    mint,
    wallet1.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const wallet2TokenAccount = getAssociatedTokenAddressSync(
    mint,
    wallet2.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  let wallet1Balance = BigInt(0);
  let wallet2Balance = BigInt(0);

  try {
    const account1 = await getAccount(connection, wallet1TokenAccount, undefined, TOKEN_2022_PROGRAM_ID);
    wallet1Balance = account1.amount;
  } catch (e) {
    // Account doesn't exist
  }

  try {
    const account2 = await getAccount(connection, wallet2TokenAccount, undefined, TOKEN_2022_PROGRAM_ID);
    wallet2Balance = account2.amount;
  } catch (e) {
    // Account doesn't exist
  }

  console.log("\n💰 Wallet Balances:");
  console.log(`  Wallet 1: ${formatTokenAmount(wallet1Balance)} ${symbol}`);
  console.log(`  Wallet 2: ${formatTokenAmount(wallet2Balance)} ${symbol}`);
  console.log(`  Total:    ${formatTokenAmount(wallet1Balance + wallet2Balance)} ${symbol}`);
}

// Main loop transfer test function
async function runLoopTransferTest(iterations: number, transferAmount: bigint) {
  console.log("🚀 GridTokenX Loop Transfer Performance Test\n");
  console.log("=".repeat(70));

  // Setup connection
  const connection = new Connection(CONFIG.rpcUrl, "confirmed");
  console.log(`RPC Endpoint:     ${CONFIG.rpcUrl}`);

  // Load wallets and mint
  const wallet1 = loadKeypair(CONFIG.wallet1Path);
  const wallet2 = loadKeypair(CONFIG.wallet2Path);
  const mintInfo = loadMintInfo();

  console.log(`Wallet 1:         ${wallet1.publicKey.toBase58()}`);
  console.log(`Wallet 2:         ${wallet2.publicKey.toBase58()}`);
  console.log(`Token Mint:       ${mintInfo.mint.toBase58()}`);
  console.log(`Token Symbol:     ${mintInfo.symbol}`);
  console.log(`Iterations:       ${iterations}`);
  console.log(`Amount per TX:    ${formatTokenAmount(transferAmount)} ${mintInfo.symbol}`);
  console.log("=".repeat(70));

  // Check initial balances
  await checkBalances(connection, wallet1, wallet2, mintInfo.mint, mintInfo.symbol);

  // Get token accounts
  const wallet1TokenAccount = getAssociatedTokenAddressSync(
    mintInfo.mint,
    wallet1.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const wallet2TokenAccount = getAssociatedTokenAddressSync(
    mintInfo.mint,
    wallet2.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  // Verify token accounts exist
  try {
    await getAccount(connection, wallet1TokenAccount, undefined, TOKEN_2022_PROGRAM_ID);
    await getAccount(connection, wallet2TokenAccount, undefined, TOKEN_2022_PROGRAM_ID);
  } catch (error) {
    console.error("\n❌ Error: Token accounts not initialized.");
    console.error("   Run: ts-node scripts/grx-wallet-manager.ts mint 1 1000");
    console.error("   Run: ts-node scripts/grx-wallet-manager.ts mint 2 1000");
    process.exit(1);
  }

  console.log("\n🔄 Starting loop transfer test...");
  console.log("   Press Ctrl+C to stop early\n");

  const latencies: number[] = [];
  let failedCount = 0;
  const startTime = Date.now();

  // Loop through iterations
  for (let i = 0; i < iterations; i++) {
    // Alternate direction: even iterations go wallet1->wallet2, odd go wallet2->wallet1
    const fromWallet = i % 2 === 0 ? wallet1 : wallet2;
    const fromAccount = i % 2 === 0 ? wallet1TokenAccount : wallet2TokenAccount;
    const toAccount = i % 2 === 0 ? wallet2TokenAccount : wallet1TokenAccount;
    const direction = i % 2 === 0 ? "Wallet 1 → Wallet 2" : "Wallet 2 → Wallet 1";

    const txStart = Date.now();

    try {
      const signature = await transfer(
        connection,
        fromWallet, // payer
        fromAccount, // source
        toAccount, // destination
        fromWallet, // owner
        transferAmount,
        [],
        { commitment: "confirmed" },
        TOKEN_2022_PROGRAM_ID
      );

      const txEnd = Date.now();
      const latency = txEnd - txStart;
      latencies.push(latency);

      if ((i + 1) % 10 === 0 || i === 0) {
        console.log(
          `  [${(i + 1).toString().padStart(3)}/${iterations}] ` +
          `${direction.padEnd(25)} ` +
          `${latency.toFixed(0).padStart(5)}ms ` +
          `✅`
        );
      }
    } catch (error: any) {
      failedCount++;
      const errorMsg = error.message || String(error);
      console.log(
        `  [${(i + 1).toString().padStart(3)}/${iterations}] ` +
        `${direction.padEnd(25)} ` +
        `FAILED ❌ ${errorMsg.substring(0, 40)}`
      );
    }

    // Small delay to avoid overwhelming the RPC
    if (i < iterations - 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  const endTime = Date.now();
  const totalDuration = endTime - startTime;

  // Calculate and print metrics
  const metrics = calculateMetrics(latencies, totalDuration, failedCount);
  printReport(`Loop Transfer Test (${iterations} iterations)`, metrics, mintInfo.symbol);
  printLatencyDistribution(latencies);

  // Check final balances
  await checkBalances(connection, wallet1, wallet2, mintInfo.mint, mintInfo.symbol);

  console.log("✅ Loop transfer test completed!\n");
}

// Main function
async function main() {
  const iterations = parseInt(process.argv[2] || "100");
  const amount = parseFloat(process.argv[3] || "1");

  if (isNaN(iterations) || iterations <= 0) {
    console.error("❌ Invalid iterations. Must be a positive number.");
    process.exit(1);
  }

  if (isNaN(amount) || amount <= 0) {
    console.error("❌ Invalid amount. Must be a positive number.");
    process.exit(1);
  }

  const transferAmount = parseTokenAmount(amount);

  console.log("⚙️  Configuration:");
  console.log(`   Iterations: ${iterations}`);
  console.log(`   Amount per transfer: ${amount} tokens`);
  console.log(`   Amount in base units: ${transferAmount.toString()}\n`);

  await runLoopTransferTest(iterations, transferAmount);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Fatal Error:", error.message || error);
    console.error("\nMake sure:");
    console.error("  1. Solana validator is running (anchor localnet)");
    console.error("  2. Wallets are set up (ts-node scripts/grx-wallet-manager.ts setup)");
    console.error("  3. Wallets have tokens (ts-node scripts/grx-wallet-manager.ts mint 1 1000)");
    console.error("  4. Token accounts are initialized for both wallets");
    process.exit(1);
  });
