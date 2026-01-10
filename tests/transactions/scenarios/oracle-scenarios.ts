/**
 * Oracle Program Transaction Test Scenarios
 * 
 * Tests meter reading submission and data validation
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import KeypairManager from "../keypair-manager.js";
import { TransactionReporter, StateValidator } from "../utils/index.js";

export class OracleScenarios {
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
    await this.testOracleInitialization();
    await this.testUpdateOracleStatus();
    await this.testUpdateValidationConfig();
  }

  /**
   * Scenario 1: Oracle Initialization
   * Initialize the oracle with an API gateway and verify state
   */
  async testOracleInitialization(): Promise<void> {
    this.reporter.startScenario("Oracle Initialization", "Oracle");

    const authority = this.keypairManager.getDevWallet();
    const oracleAuthority = this.keypairManager.getOracleAuthority();
    const startTime = Date.now();

    try {
      // Find oracle data PDA
      const [oracleDataPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("oracle_data")],
        this.program.programId
      );

      // Check if already initialized
      try {
        await (this.program.account as any).oracleData.fetch(oracleDataPda);
        const duration = Date.now() - startTime;
        this.reporter.recordTransaction({
          program: "Oracle",
          operation: "initializeOracle",
          keypair: "oracle-authority",
          success: true,
          duration,
          timestamp: startTime,
          error: "Already initialized (expected)",
        });
      } catch (e: any) {
        // Not initialized, initialize it
        // Use dev wallet as API gateway for testing
        const signature = await this.program.methods
          .initialize(authority.publicKey)
          .accounts({
            oracleData: oracleDataPda,
            authority: oracleAuthority.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([oracleAuthority])
          .rpc();

        const duration = Date.now() - startTime;
        this.reporter.recordTransaction({
          program: "Oracle",
          operation: "initializeOracle",
          keypair: "oracle-authority",
          signature,
          success: true,
          duration,
          timestamp: startTime,
        });
      }
    } catch (error: any) {
      const duration = Date.now() - startTime;
      this.reporter.recordTransaction({
        program: "Oracle",
        operation: "initializeOracle",
        keypair: "oracle-authority",
        success: false,
        duration,
        timestamp: startTime,
        error: error.message,
      });
    }

    this.reporter.endScenario();
  }

  /**
   * Scenario 2: Update Oracle Status
   * Toggle oracle active status
   */
  async testUpdateOracleStatus(): Promise<void> {
    this.reporter.startScenario("Update Oracle Status", "Oracle");

    const oracleAuthority = this.keypairManager.getOracleAuthority();
    const startTime = Date.now();

    try {
      const [oracleDataPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("oracle_data")],
        this.program.programId
      );

      // Update status to active
      const signature = await this.program.methods
        .updateOracleStatus(true)
        .accounts({
          oracleData: oracleDataPda,
          authority: oracleAuthority.publicKey,
        })
        .signers([oracleAuthority])
        .rpc();

      const duration = Date.now() - startTime;
      this.reporter.recordTransaction({
        program: "Oracle",
        operation: "updateOracleStatus",
        keypair: "oracle-authority",
        signature,
        success: true,
        duration,
        timestamp: startTime,
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      this.reporter.recordTransaction({
        program: "Oracle",
        operation: "updateOracleStatus",
        keypair: "oracle-authority",
        success: false,
        duration,
        timestamp: startTime,
        error: error.message?.slice(0, 100),
      });
    }

    this.reporter.endScenario();
  }

  /**
   * Scenario 3: Update Validation Config
   * Configure validation parameters
   */
  async testUpdateValidationConfig(): Promise<void> {
    this.reporter.startScenario("Update Validation Config", "Oracle");

    const oracleAuthority = this.keypairManager.getOracleAuthority();
    const startTime = Date.now();

    try {
      const [oracleDataPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("oracle_data")],
        this.program.programId
      );

      const signature = await this.program.methods
        .updateValidationConfig(
          new anchor.BN(0),          // min_energy_value
          new anchor.BN(2000000),    // max_energy_value (2M kWh)
          true,                       // anomaly_detection_enabled
          75,                         // max_reading_deviation_percent
          false                       // require_consensus
        )
        .accounts({
          oracleData: oracleDataPda,
          authority: oracleAuthority.publicKey,
        })
        .signers([oracleAuthority])
        .rpc();

      const duration = Date.now() - startTime;
      this.reporter.recordTransaction({
        program: "Oracle",
        operation: "updateValidationConfig",
        keypair: "oracle-authority",
        signature,
        success: true,
        duration,
        timestamp: startTime,
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      this.reporter.recordTransaction({
        program: "Oracle",
        operation: "updateValidationConfig",
        keypair: "oracle-authority",
        success: false,
        duration,
        timestamp: startTime,
        error: error.message?.slice(0, 100),
      });
    }

    this.reporter.endScenario();
  }
}

export default OracleScenarios;
