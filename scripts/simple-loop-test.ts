#!/usr/bin/env ts-node

/**
 * GridTokenX Simple Loop Transfer Test
 *
 * A simplified version of the loop transfer test that uses the existing
 * token manager script to perform transfers, avoiding token program compatibility issues.
 *
 * Usage: ts-node scripts/simple-loop-test.ts <iterations> <amount> [delay]
 *
 * Parameters:
 * - iterations: Number of transfer operations to perform
 * - amount: Amount of tokens to transfer in each transaction
 * - delay: Optional delay between transactions in milliseconds (default: 100)
 */

import { spawn } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

// Color codes for output
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
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

// Execute token transfer using the token manager
function executeTransfer(fromWallet: string, toWallet: string, amount: string): Promise<{ success: boolean; latency: number; error?: string }> {
  return new Promise((resolve) => {
    const startTime = Date.now();

    // Execute token transfer command
    const process = spawn('pnpm', ['run', 'token:transfer', fromWallet, toWallet, amount], {
      stdio: 'pipe',
      shell: true
    });

    let output = '';
    let errorOutput = '';

    process.stdout?.on('data', (data) => {
      output += data.toString();
    });

    process.stderr?.on('data', (data) => {
      errorOutput += data.toString();
    });

    process.on('close', (code) => {
      const endTime = Date.now();
      const latency = endTime - startTime;

      if (code === 0) {
        // Success
        resolve({ success: true, latency });
      } else {
        // Failure
        const errorMessage = errorOutput || output || `Process exited with code ${code}`;
        resolve({ success: false, latency, error: errorMessage });
      }
    });
  });
}

// Main performance test function
async function runPerformanceTest(
  iterations: number,
  transferAmount: string,
  delay: number
): Promise<PerformanceMetrics> {
  logInfo(`Starting performance test with ${iterations} iterations`);
  logInfo(`Transfer amount: ${transferAmount} GRX`);
  logInfo(`Delay between transactions: ${delay}ms`);

  // Performance tracking
  const latencies: number[] = [];
  let successCount = 0;
  let failureCount = 0;
  const errors: string[] = [];

  // Get initial balances
  logInfo(`Getting initial balances...`);

  const fromWallet = '1';
  const toWallet = '2';

  let fromBalance = '0';
  let toBalance = '0';

  try {
    // Get initial balance
    const balanceProcess = spawn('pnpm', ['run', 'wallet:balance', fromWallet], {
      stdio: 'pipe',
      shell: true
    });

    let balanceOutput = '';
    balanceProcess.stdout?.on('data', (data) => {
      balanceOutput += data.toString();
    });

    await new Promise<void>((resolve) => {
      balanceProcess.on('close', () => {
        const balanceMatch = balanceOutput.match(/Balance: ([\d,.]+) GRX/);
        if (balanceMatch) {
          fromBalance = balanceMatch[1];
        }
        resolve();
      });
    });

    // Get destination balance
    const toBalanceProcess = spawn('pnpm', ['run', 'wallet:balance', toWallet], {
      stdio: 'pipe',
      shell: true
    });

    let toBalanceOutput = '';
    toBalanceProcess.stdout?.on('data', (data) => {
      toBalanceOutput += data.toString();
    });

    await new Promise<void>((resolve) => {
      toBalanceProcess.on('close', () => {
        const balanceMatch = toBalanceOutput.match(/Balance: ([\d,.]+) GRX/);
        if (balanceMatch) {
          toBalance = balanceMatch[1];
        }
        resolve();
      });
    });

    logInfo(`Initial balances:`);
    logInfo(`  Wallet 1: ${fromBalance} GRX`);
    logInfo(`  Wallet 2: ${toBalance} GRX`);
  } catch (error) {
    logError(`Failed to get initial balances: ${error}`);
  }

  const totalStartTime = Date.now();

  // Run transfer loop
  for (let i = 0; i < iterations; i++) {
    try {
      const result = await executeTransfer(fromWallet, toWallet, transferAmount);

      if (result.success) {
        latencies.push(result.latency);
        successCount++;
        log(`Transaction ${i + 1}/${iterations}: Success (${result.latency}ms)`);
      } else {
        failureCount++;
        const errorMessage = `Transaction ${i + 1} failed: ${result.error}`;
        errors.push(errorMessage);
        logError(errorMessage);
      }
    } catch (error) {
      failureCount++;
      const errorMessage = `Transaction ${i + 1} failed: ${error}`;
      errors.push(errorMessage);
      logError(errorMessage);
    }

    // Add delay between transactions
    if (delay > 0 && i < iterations - 1) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  const totalEndTime = Date.now();
  const totalTime = totalEndTime - totalStartTime;

  // Calculate metrics
  const averageLatency = latencies.length > 0
    ? latencies.reduce((sum, latency) => sum + latency, 0) / latencies.length
    : 0;

  const minLatency = latencies.length > 0
    ? Math.min(...latencies)
    : 0;

  const maxLatency = latencies.length > 0
    ? Math.max(...latencies)
    : 0;

  const throughput = totalTime > 0
    ? (successCount / totalTime) * 1000
    : 0;

  // Get final balances
  logInfo(`Getting final balances...`);

  let finalFromBalance = fromBalance;
  let finalToBalance = toBalance;

  try {
    // Get final balance from wallet
    const fromBalanceProcess = spawn('pnpm', ['run', 'wallet:balance', fromWallet], {
      stdio: 'pipe',
      shell: true
    });

    let fromBalanceOutput = '';
    fromBalanceProcess.stdout?.on('data', (data) => {
      fromBalanceOutput += data.toString();
    });

    await new Promise<void>((resolve) => {
      fromBalanceProcess.on('close', () => {
        const balanceMatch = fromBalanceOutput.match(/Balance: ([\d,.]+) GRX/);
        if (balanceMatch) {
          finalFromBalance = balanceMatch[1];
        }
        resolve();
      });
    });

    // Get final balance to wallet
    const toBalanceProcess = spawn('pnpm', ['run', 'wallet:balance', toWallet], {
      stdio: 'pipe',
      shell: true
    });

    let toBalanceOutput = '';
    toBalanceProcess.stdout?.on('data', (data) => {
      toBalanceOutput += data.toString();
    });

    await new Promise<void>((resolve) => {
      toBalanceProcess.on('close', () => {
        const balanceMatch = toBalanceOutput.match(/Balance: ([\d,.]+) GRX/);
        if (balanceMatch) {
          finalToBalance = balanceMatch[1];
        }
        resolve();
      });
    });

    logInfo(`Final balances:`);
    logInfo(`  Wallet 1: ${finalFromBalance} GRX`);
    logInfo(`  Wallet 2: ${finalToBalance} GRX`);

    // Verify expected amounts
    const expectedTransfers = parseFloat(transferAmount) * successCount;
    const expectedFromBalance = parseFloat(fromBalance) - expectedTransfers;
    const expectedToBalance = parseFloat(toBalance) + expectedTransfers;

    const balanceMatch =
      Math.abs(parseFloat(finalFromBalance) - expectedFromBalance) < 0.01 &&
      Math.abs(parseFloat(finalToBalance) - expectedToBalance) < 0.01;

    if (balanceMatch) {
      logSuccess("Balance verification passed!");
    } else {
      logError("Balance verification failed!");
    }
  } catch (error) {
    logError(`Failed to get final balances: ${error}`);
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
  console.log(`  Successful: ${metrics.successfulTransactions} (${(metrics.successfulTransactions / metrics.totalTransactions * 100).toFixed(2)}%)`);
  console.log(`  Failed: ${metrics.failedTransactions} (${(metrics.failedTransactions / metrics.totalTransactions * 100).toFixed(2)}%)`);

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
    logWarning(`${metrics.failedTransactions} transactions failed out of ${metrics.totalTransactions}`);
  }

  if (metrics.throughput > 5) {
    logSuccess(`Excellent throughput: ${metrics.throughput.toFixed(2)} TPS`);
  } else if (metrics.throughput > 2) {
    logWarning(`Moderate throughput: ${metrics.throughput.toFixed(2)} TPS`);
  } else {
    logError(`Low throughput: ${metrics.throughput.toFixed(2)} TPS`);
  }

  if (metrics.averageLatency < 500) {
    logSuccess(`Excellent latency: ${metrics.averageLatency.toFixed(2)} ms average`);
  } else if (metrics.averageLatency < 1000) {
    logWarning(`Moderate latency: ${metrics.averageLatency.toFixed(2)} ms average`);
  } else {
    logError(`High latency: ${metrics.averageLatency.toFixed(2)} ms average`);
  }
}

// Main execution function
async function main() {
  // Parse command line arguments
  const iterations = parseInt(process.argv[2]) || 10;
  const transferAmount = process.argv[3] || "0.5";
  const delay = parseInt(process.argv[4]) || 100;

  if (isNaN(iterations) || iterations <= 0) {
    logError("Iterations must be a positive number");
    process.exit(1);
  }

  if (isNaN(parseFloat(transferAmount)) || parseFloat(transferAmount) <= 0) {
    logError("Amount must be a positive number");
    process.exit(1);
  }

  log("GridTokenX Simple Transaction Performance Test", colors.cyan);
  console.log("=".repeat(70));

  try {
    // Run performance test
    const metrics = await runPerformanceTest(iterations, transferAmount, delay);

    // Display results
    displayResults(metrics);

    // Save results to file
    const resultsPath = `./simple-performance-results-${Date.now()}.json`;
    writeFileSync(resultsPath, JSON.stringify(metrics, null, 2));
    log(`\nDetailed results saved to: ${resultsPath}`, colors.blue);

  } catch (error: any) {
    logError(`Performance test failed: ${error.message}`);
    process.exit(1);
  }
}

// Run script
main().catch(error => {
  logError(`Fatal error: ${error.message}`);
  process.exit(1);
});
