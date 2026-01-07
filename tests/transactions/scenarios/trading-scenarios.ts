/**
 * Trading Program Transaction Test Scenarios
 * 
 * Tests market operations, order creation, matching, and execution
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import KeypairManager from "../keypair-manager.js";
import { TransactionReporter, StateValidator } from "../utils/index.js";

export class TradingScenarios {
  private program: anchor.Program;
  private keypairManager: KeypairManager;
  private reporter: TransactionReporter;
  private validator: StateValidator;

  constructor(
    program: anchor.Program,
    keypairManager: KeypairManager,
    reporter: TransactionReporter,
    validator: StateValidator
  ) {
    this.program = program;
    this.keypairManager = keypairManager;
    this.reporter = reporter;
    this.validator = validator;
  }

  async runAllScenarios(): Promise<void> {
    await this.testMarketInitialization();
    await this.testUpdateMarketParams();
  }

  /**
   * Scenario 1: Market Initialization
   * Initialize the trading market with authority
   */
  async testMarketInitialization(): Promise<void> {
    this.reporter.startScenario("Market Initialization", "Trading");

    const authority = this.keypairManager.getDevWallet();
    const startTime = Date.now();

    try {
      // Find market PDA
      const [marketPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("market")],
        this.program.programId
      );

      // Check if already initialized
      try {
        await (this.program.account as any).market.fetch(marketPda);
        const duration = Date.now() - startTime;
        this.reporter.recordTransaction({
          program: "Trading",
          operation: "initializeMarket",
          keypair: "dev-wallet",
          success: true,
          duration,
          timestamp: startTime,
          error: "Already initialized (expected)",
        });
      } catch (e: any) {
        // Not initialized, initialize it
        const signature = await this.program.methods
          .initializeMarket()
          .accounts({
            market: marketPda,
            authority: authority.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([authority])
          .rpc();

        const duration = Date.now() - startTime;
        this.reporter.recordTransaction({
          program: "Trading",
          operation: "initializeMarket",
          keypair: "dev-wallet",
          signature,
          success: true,
          duration,
          timestamp: startTime,
        });
      }
    } catch (error: any) {
      const duration = Date.now() - startTime;
      this.reporter.recordTransaction({
        program: "Trading",
        operation: "initializeMarket",
        keypair: "dev-wallet",
        success: false,
        duration,
        timestamp: startTime,
        error: error.message?.slice(0, 100),
      });
    }

    this.reporter.endScenario();
  }

  /**
   * Scenario 2: Update Market Params
   * Update market parameters (fee, clearing enabled)
   */
  async testUpdateMarketParams(): Promise<void> {
    this.reporter.startScenario("Update Market Params", "Trading");

    const authority = this.keypairManager.getDevWallet();
    const startTime = Date.now();

    try {
      const [marketPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("market")],
        this.program.programId
      );

      const signature = await this.program.methods
        .updateMarketParams(
          25,    // market_fee_bps (0.25%)
          true   // clearing_enabled
        )
        .accounts({
          market: marketPda,
          authority: authority.publicKey,
        })
        .signers([authority])
        .rpc();

      const duration = Date.now() - startTime;
      this.reporter.recordTransaction({
        program: "Trading",
        operation: "updateMarketParams",
        keypair: "dev-wallet",
        signature,
        success: true,
        duration,
        timestamp: startTime,
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      this.reporter.recordTransaction({
        program: "Trading",
        operation: "updateMarketParams",
        keypair: "dev-wallet",
        success: false,
        duration,
        timestamp: startTime,
        error: error.message?.slice(0, 100),
      });
    }

    this.reporter.endScenario();
  }
}

export default TradingScenarios;
