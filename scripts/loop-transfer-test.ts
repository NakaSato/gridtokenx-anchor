#!/usr/bin/env ts-node

/**
 * GridTokenX Transaction Performance Test
 *
 * Measures throughput and latency of token transfers on Solana blockchain
 * Used to evaluate system performance under different load conditions
 *
 * Usage: ts-node scripts/loop-transfer-test.ts <iterations> <amount> [delay]
 *
 * Parameters:
 * - iterations: Number of transfer operations to perform
 * - amount: Amount of tokens to transfer in each transaction
 * - delay: Optional delay between transactions in milliseconds (default: 100)
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  clusterApiUrl,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createTransferInstruction,
  getAccount,
} from "@solana/spl-token";
import * as fs from "fs";

// Configuration
const CONFIG = {
  wallet1Path: "./wallet-1-keypair.json",
  wallet2Path: "./wallet-2-keypair.json",
  mintInfoPath: "./grx-token-info.json",
  rpcUrl: process.env.ANCHOR_PROVIDER_URL || "http://localhost:8899",
  tokenDecimals: 9,
  defaultDelay: 100, // Default delay between transactions in ms
};

// Performance metrics collector
interface PerformanceMetrics {
  totalTransactions: number;
  successfulTransactions: number;
  failedTransactions: number;
  totalTime: number; // Total time in milliseconds
  averageLatency: number; // Average transaction time in ms
  minLatency: number; // Fastest transaction time in ms
  maxLatency: number; // Slowest transaction time in ms
  throughput: number; // Transactions per second
  errors: string[]; // Error messages
}

// Color codes for output
const colors = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  reset: "\x1b[0m",
};

// Helper functions
function log(message: string, color: string = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logInfo(message: string) {
  log(`[INFO] ${message}`, colors.blue);
}

function logSuccess(message: string) {
  log(`[SUCCESS] ${message}`, colors.green);
}

function logError(message: string) {
  log(`[ERROR] ${message}`, colors.red);
}

function logWarning(message: string) {
  log(`[WARNING] ${message}`, colors.yellow);
}

// Load keypair from file
function loadKeypair(filePath: string): Keypair {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Keypair file not found: ${filePath}`);
  }

  const keypairData = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return Keypair.fromSecretKey(new Uint8Array(keypairData));
}

// Load token info
function loadMintInfo() {
  if (!fs.existsSync(CONFIG.mintInfoPath)) {
    throw new Error(`Token info file not found: ${CONFIG.mintInfoPath}`);
  }

  const tokenInfo = JSON.parse(fs.readFileSync(CONFIG.mintInfoPath, "utf8"));
  return tokenInfo;
}

// Format token amount with decimals
function formatTokenAmount(amount: bigint | number, decimals: number): string {
  const divisor = Math.pow(10, decimals);
  const formattedAmount = Number(amount) / divisor;
  return formattedAmount.toLocaleString(undefined, {
    maximumFractionDigits: decimals,
  });
}

// Calculate latency of a transaction
function measureTransactionLatency(startTime: number, endTime: number): number {
  return endTime - startTime;
}

// Main performance test function
async function runPerformanceTest(
  iterations: number,
  transferAmount: number,
  delay: number,
): Promise<PerformanceMetrics> {
  logInfo(`Starting performance test with ${iterations} iterations`);
  logInfo(`Transfer amount: ${transferAmount} GRX`);
  logInfo(`Delay between transactions: ${delay}ms`);

  // Load wallets and token info
  const wallet1 = loadKeypair(CONFIG.wallet1Path);
  const wallet2 = loadKeypair(CONFIG.wallet2Path);
  const tokenInfo = loadMintInfo();
  const mintAddress = tokenInfo.mint || tokenInfo.mintAddress;
  const mint = new PublicKey(mintAddress);

  const connection = new Connection(CONFIG.rpcUrl, "confirmed");

  // Get token accounts
  // Try to determine which token program was used to create the accounts
  let tokenProgramId;
  try {
    // First try with Token-2022
    await getAccount(
      connection,
      getAssociatedTokenAddressSync(
        mint,
        wallet1.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );
    tokenProgramId = TOKEN_2022_PROGRAM_ID;
  } catch {
    // If that fails, fall back to legacy Token program
    tokenProgramId = TOKEN_PROGRAM_ID;
  }

  const fromTokenAccount = getAssociatedTokenAddressSync(
    mint,
    wallet1.publicKey,
    false,
    tokenProgramId,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const toTokenAccount = getAssociatedTokenAddressSync(
    mint,
    wallet2.publicKey,
    false,
    tokenProgramId,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  // Check if accounts exist
  try {
    await getAccount(connection, fromTokenAccount, undefined, tokenProgramId);
  } catch (error) {
    logError(`Source token account not found: ${fromTokenAccount.toBase58()}`);
    throw error;
  }

  try {
    await getAccount(connection, toTokenAccount, undefined, tokenProgramId);
  } catch (error) {
    logError(
      `Destination token account not found: ${toTokenAccount.toBase58()}`,
    );
    throw error;
  }

  // Performance tracking
  const latencies: number[] = [];
  let successCount = 0;
  let failureCount = 0;
  const errors: string[] = [];

  // Get initial balances
  const initialFromBalance = (
    await getAccount(connection, fromTokenAccount, undefined, tokenProgramId)
  ).amount;
  const initialToBalance = (
    await getAccount(connection, toTokenAccount, undefined, tokenProgramId)
  ).amount;

  logInfo(`Initial balances:`);
  logInfo(
    `  From Wallet (${wallet1.publicKey.toBase58()}): ${formatTokenAmount(initialFromBalance, CONFIG.tokenDecimals)} GRX`,
  );
  logInfo(
    `  To Wallet (${wallet2.publicKey.toBase58()}): ${formatTokenAmount(initialToBalance, CONFIG.tokenDecimals)} GRX`,
  );

  const totalStartTime = Date.now();

  // Run the transfer loop
  for (let i = 0; i < iterations; i++) {
    try {
      const startTime = Date.now();

      // Create transfer instruction
      const transferInstruction = createTransferInstruction(
        fromTokenAccount,
        toTokenAccount,
        wallet1.publicKey,
        BigInt(transferAmount * Math.pow(10, CONFIG.tokenDecimals)),
      );

      const transaction = new Transaction();

      // Always use regular transfer for simplicity
      transaction.add(transferInstruction);

      const signature = await sendAndConfirmTransaction(
        connection,
        transaction,
        [wallet1],
      );

      const endTime = Date.now();
      const latency = measureTransactionLatency(startTime, endTime);
      latencies.push(latency);
      successCount++;

      log(`Transaction ${i + 1}/${iterations}: ${signature} (${latency}ms)`);
    } catch (error) {
      failureCount++;
      const errorMessage = `Transaction ${i + 1} failed: ${error}`;
      errors.push(errorMessage);
      logError(errorMessage);
    }

    // Add delay between transactions
    if (delay > 0 && i < iterations - 1) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  const totalEndTime = Date.now();
  const totalTime = totalEndTime - totalStartTime;

  // Calculate metrics
  const averageLatency =
    latencies.length > 0
      ? latencies.reduce((sum, latency) => sum + latency, 0) / latencies.length
      : 0;

  const minLatency = latencies.length > 0 ? Math.min(...latencies) : 0;

  const maxLatency = latencies.length > 0 ? Math.max(...latencies) : 0;

  const throughput = totalTime > 0 ? (successCount / totalTime) * 1000 : 0;

  // Get final balances
  const finalFromBalance = (
    await getAccount(connection, fromTokenAccount, undefined, tokenProgramId)
  ).amount;
  const finalToBalance = (
    await getAccount(connection, toTokenAccount, undefined, tokenProgramId)
  ).amount;

  // Verify expected amounts
  const expectedFromBalance =
    initialFromBalance -
    BigInt(transferAmount * Math.pow(10, CONFIG.tokenDecimals)) *
      BigInt(successCount);
  const expectedToBalance =
    initialToBalance +
    BigInt(transferAmount * Math.pow(10, CONFIG.tokenDecimals)) *
      BigInt(successCount);

  const balanceMatch =
    finalFromBalance === expectedFromBalance &&
    finalToBalance === expectedToBalance;

  logInfo(`Final balances:`);
  logInfo(
    `  From Wallet (${wallet1.publicKey.toBase58()}): ${formatTokenAmount(finalFromBalance, CONFIG.tokenDecimals)} GRX`,
  );
  logInfo(
    `  To Wallet (${wallet2.publicKey.toBase58()}): ${formatTokenAmount(finalToBalance, CONFIG.tokenDecimals)} GRX`,
  );
  if (balanceMatch) {
    logSuccess("Balance verification passed!");
  } else {
    logError("Balance verification failed!");
  }

  return {
    totalTransactions: iterations,
    successfulTransactions: successCount,
    failedTransactions: failureCount,
    totalTime,
    averageLatency,
    minLatency,
    maxLatency,
    throughput,
    errors,
  };
}

// Display performance results
function displayResults(metrics: PerformanceMetrics) {
  console.log("\n" + "=".repeat(70));
  log("PERFORMANCE TEST RESULTS", colors.cyan);
  console.log("=".repeat(70));

  console.log(`\n${colors.yellow}Transaction Summary:${colors.reset}`);
  console.log(`  Total Transactions: ${metrics.totalTransactions}`);
  console.log(
    `  Successful: ${metrics.successfulTransactions} (${((metrics.successfulTransactions / metrics.totalTransactions) * 100).toFixed(2)}%)`,
  );
  console.log(
    `  Failed: ${metrics.failedTransactions} (${((metrics.failedTransactions / metrics.totalTransactions) * 100).toFixed(2)}%)`,
  );

  console.log(`\n${colors.yellow}Performance Metrics:${colors.reset}`);
  console.log(`  Total Time: ${(metrics.totalTime / 1000).toFixed(2)} seconds`);
  console.log(`  Average Latency: ${metrics.averageLatency.toFixed(2)} ms`);
  console.log(`  Min Latency: ${metrics.minLatency} ms`);
  console.log(`  Max Latency: ${metrics.maxLatency} ms`);
  console.log(`  Throughput: ${metrics.throughput.toFixed(2)} TPS`);

  if (metrics.errors.length > 0) {
    console.log(`\n${colors.yellow}Errors:${colors.reset}`);
    metrics.errors.forEach((error, index) => {
      console.log(`  ${index + 1}. ${error}`);
    });
  }

  console.log("\n" + "=".repeat(70));

  // Performance evaluation
  if (metrics.successfulTransactions === metrics.totalTransactions) {
    logSuccess("All transactions completed successfully!");
  } else {
    logWarning(
      `${metrics.failedTransactions} transactions failed out of ${metrics.totalTransactions}`,
    );
  }

  if (metrics.throughput > 5) {
    logSuccess(`Excellent throughput: ${metrics.throughput.toFixed(2)} TPS`);
  } else if (metrics.throughput > 2) {
    logWarning(`Moderate throughput: ${metrics.throughput.toFixed(2)} TPS`);
  } else {
    logError(`Low throughput: ${metrics.throughput.toFixed(2)} TPS`);
  }

  if (metrics.averageLatency < 500) {
    logSuccess(
      `Excellent latency: ${metrics.averageLatency.toFixed(2)} ms average`,
    );
  } else if (metrics.averageLatency < 1000) {
    logWarning(
      `Moderate latency: ${metrics.averageLatency.toFixed(2)} ms average`,
    );
  } else {
    logError(`High latency: ${metrics.averageLatency.toFixed(2)} ms average`);
  }
}

// Main execution function
async function main() {
  // Parse command line arguments
  const iterations = parseInt(process.argv[2]) || 10;
  const transferAmount = parseFloat(process.argv[3]) || 0.5;
  const delay = parseInt(process.argv[4]) || CONFIG.defaultDelay;

  if (isNaN(iterations) || iterations <= 0) {
    logError("Iterations must be a positive number");
    process.exit(1);
  }

  if (isNaN(transferAmount) || transferAmount <= 0) {
    logError("Amount must be a positive number");
    process.exit(1);
  }

  log("GridTokenX Transaction Performance Test", colors.cyan);
  console.log("=".repeat(70));

  try {
    // Run performance test
    const metrics = await runPerformanceTest(iterations, transferAmount, delay);

    // Display results
    displayResults(metrics);

    // Save results to file
    const resultsPath = `./performance-results-${Date.now()}.json`;
    fs.writeFileSync(resultsPath, JSON.stringify(metrics, null, 2));
    log(`\nDetailed results saved to: ${resultsPath}`, colors.blue);
  } catch (error: any) {
    logError(`Performance test failed: ${error.message}`);
    process.exit(1);
  }
}

// Run the script
main().catch((error) => {
  logError(`Fatal error: ${error.message}`);
  process.exit(1);
});
