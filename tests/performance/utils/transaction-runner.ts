import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
  ComputeBudgetProgram,
  ConfirmedSignatureInfo,
} from "@solana/web3.js";
import { GetProgramAccountsFilter, AccountInfo } from "@solana/web3.js";

/**
 * Transaction runner utility for measuring performance
 * Handles different transaction types and collects detailed metrics
 */
export class TransactionRunner {
  private connection: Connection;
  private payer: Keypair;

  constructor(connection: Connection, payer: Keypair) {
    this.connection = connection;
    this.payer = payer;
  }

  /**
   * Run a transaction and measure its performance
   */
  async runTransaction(
    transaction: Transaction,
    transactionType: string,
    computeUnits?: number
  ): Promise<TransactionResult> {
    const startTime = Date.now();
    let signature: string = "";
    let computeUnitsUsed = 0;
    let error: Error | null = null;
    let accountSizeChange = 0;

    try {
      // Add compute budget instruction if specified
      if (computeUnits) {
        transaction.add(
          ComputeBudgetProgram.setComputeUnitLimit({
            units: computeUnits,
          })
        );
      }

      // Get initial account state for size change calculation
      const initialAccountState = await this.getAccountStateSnapshot(
        this.payer.publicKey
      );

      // Send and confirm transaction
      signature = await sendAndConfirmTransaction(this.connection, transaction, [
        this.payer,
      ]);

      // Get transaction details
      const txDetails = await this.connection.getTransaction(signature, {
        maxSupportedTransactionVersion: 0,
      });

      // Extract compute units used
      if (txDetails && txDetails.meta) {
        computeUnitsUsed = txDetails.meta.computeUnitsConsumed || 0;
      }

      // Calculate account size change
      const finalAccountState = await this.getAccountStateSnapshot(
        this.payer.publicKey
      );
      accountSizeChange = this.calculateAccountSizeChange(
        initialAccountState,
        finalAccountState
      );

      const latency = Date.now() - startTime;

      return {
        success: true,
        signature,
        latency,
        computeUnitsUsed,
        accountSizeChange,
        transactionType,
        error: null,
      };
    } catch (err) {
      const latency = Date.now() - startTime;
      error = err as Error;

      return {
        success: false,
        signature,
        latency,
        computeUnitsUsed,
        accountSizeChange,
        transactionType,
        error,
      };
    }
  }

  /**
   * Run multiple transactions in parallel and measure performance
   */
  async runParallelTransactions(
    transactions: Array<{ tx: Transaction; type: string; computeUnits?: number }>
  ): Promise<TransactionResult[]> {
    const promises = transactions.map(({ tx, type, computeUnits }) =>
      this.runTransaction(tx, type, computeUnits)
    );

    return Promise.all(promises);
  }

  /**
   * Run transactions sequentially with optional delay between them
   */
  async runSequentialTransactions(
    transactions: Array<{ tx: Transaction; type: string; computeUnits?: number; delay?: number }>
  ): Promise<TransactionResult[]> {
    const results: TransactionResult[] = [];

    for (const { tx, type, computeUnits, delay } of transactions) {
      const result = await this.runTransaction(tx, type, computeUnits);
      results.push(result);

      // Add delay if specified
      if (delay && delay > 0 && result.success) {
        await this.sleep(delay);
      }
    }

    return results;
  }

  /**
   * Create a basic transfer transaction
   */
  createTransferTransaction(
    fromPubkey: PublicKey,
    toPubkey: PublicKey,
    lamports: number
  ): Transaction {
    return new Transaction().add(
      SystemProgram.transfer({
        fromPubkey,
        toPubkey,
        lamports,
      })
    );
  }

  /**
   * Create a custom transaction with multiple instructions
   */
  createCustomTransaction(instructions: any[]): Transaction {
    return new Transaction().add(...instructions);
  }

  /**
   * Get current account state snapshot
   */
  private async getAccountStateSnapshot(pubkey: PublicKey): Promise<AccountState> {
    try {
      const accountInfo = await this.connection.getAccountInfo(pubkey);
      return {
        exists: accountInfo !== null,
        lamports: accountInfo?.lamports || 0,
        dataLength: accountInfo?.data.length || 0,
        owner: accountInfo?.owner || new PublicKey("11111111111111111111111111111111"),
      };
    } catch {
      return {
        exists: false,
        lamports: 0,
        dataLength: 0,
        owner: new PublicKey("11111111111111111111111111111111"),
      };
    }
  }

  /**
   * Calculate account size change between snapshots
   */
  private calculateAccountSizeChange(
    before: AccountState,
    after: AccountState
  ): number {
    if (!before.exists && after.exists) {
      return after.dataLength;
    }
    if (before.exists && !after.exists) {
      return -before.dataLength;
    }
    if (before.exists && after.exists) {
      return after.dataLength - before.dataLength;
    }
    return 0;
  }

  /**
   * Sleep utility for adding delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get recent transaction history for analysis
   */
  async getRecentTransactionHistory(
    limit: number = 100
  ): Promise<ConfirmedSignatureInfo[]> {
    try {
      return await this.connection.getSignaturesForAddress(
        this.payer.publicKey,
        { limit }
      );
    } catch (error) {
      console.error("Error fetching transaction history:", error);
      return [];
    }
  }

  /**
   * Analyze transaction performance trends
   */
  analyzePerformanceTrends(
    results: TransactionResult[]
  ): PerformanceTrends {
    if (results.length === 0) {
      return {
        avgLatencyTrend: "stable",
        errorRateTrend: "stable",
        computeUnitsTrend: "stable",
      };
    }

    // Simple trend analysis based on first half vs second half
    const midpoint = Math.floor(results.length / 2);
    const firstHalf = results.slice(0, midpoint);
    const secondHalf = results.slice(midpoint);

    const firstHalfAvgLatency = this.calculateAverageLatency(firstHalf);
    const secondHalfAvgLatency = this.calculateAverageLatency(secondHalf);

    const firstHalfErrorRate = this.calculateErrorRate(firstHalf);
    const secondHalfErrorRate = this.calculateErrorRate(secondHalf);

    const firstHalfAvgComputeUnits = this.calculateAverageComputeUnits(firstHalf);
    const secondHalfAvgComputeUnits = this.calculateAverageComputeUnits(secondHalf);

    const latencyChange = (secondHalfAvgLatency - firstHalfAvgLatency) / firstHalfAvgLatency;
    const errorRateChange = (secondHalfErrorRate - firstHalfErrorRate) / Math.max(firstHalfErrorRate, 0.01);
    const computeUnitsChange = (secondHalfAvgComputeUnits - firstHalfAvgComputeUnits) / Math.max(firstHalfAvgComputeUnits, 1);

    return {
      avgLatencyTrend: latencyChange > 0.1 ? "increasing" : latencyChange < -0.1 ? "decreasing" : "stable",
      errorRateTrend: errorRateChange > 0.1 ? "increasing" : errorRateChange < -0.1 ? "decreasing" : "stable",
      computeUnitsTrend: computeUnitsChange > 0.1 ? "increasing" : computeUnitsChange < -0.1 ? "decreasing" : "stable",
    };
  }

  /**
   * Calculate average latency from transaction results
   */
  private calculateAverageLatency(results: TransactionResult[]): number {
    if (results.length === 0) return 0;
    const sum = results.reduce((acc, result) => acc + result.latency, 0);
    return sum / results.length;
  }

  /**
   * Calculate error rate from transaction results
   */
  private calculateErrorRate(results: TransactionResult[]): number {
    if (results.length === 0) return 0;
    const errors = results.filter(result => !result.success).length;
    return errors / results.length;
  }

  /**
   * Calculate average compute units from transaction results
   */
  private calculateAverageComputeUnits(results: TransactionResult[]): number {
    if (results.length === 0) return 0;
    const sum = results.reduce((acc, result) => acc + result.computeUnitsUsed, 0);
    return sum / results.length;
  }
}

/**
 * Transaction result interface
 */
export interface TransactionResult {
  success: boolean;
  signature: string;
  latency: number;
  computeUnitsUsed: number;
  accountSizeChange: number;
  transactionType: string;
  error: Error | null;
}

/**
 * Account state interface
 */
interface AccountState {
  exists: boolean;
  lamports: number;
  dataLength: number;
  owner: PublicKey;
}

/**
 * Performance trends interface
 */
export interface PerformanceTrends {
  avgLatencyTrend: "increasing" | "decreasing" | "stable";
  errorRateTrend: "increasing" | "decreasing" | "stable";
  computeUnitsTrend: "increasing" | "decreasing" | "stable";
}
