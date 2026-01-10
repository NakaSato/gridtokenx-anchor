/**
 * Governance Program Transaction Test Scenarios
 * 
 * Tests ERC issuance, validation, and governance controls
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import KeypairManager from "../keypair-manager.js";
import { TransactionReporter, StateValidator } from "../utils/index.js";

export class GovernanceScenarios {
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
    await this.testPoaInitialization();
    await this.testEmergencyPause();
    await this.testEmergencyUnpause();
  }

  /**
   * Scenario 1: PoA Initialization
   * Initialize the Proof of Authority governance
   */
  async testPoaInitialization(): Promise<void> {
    this.reporter.startScenario("PoA Initialization", "Governance");

    const governanceAuthority = this.keypairManager.getGovernanceAuthority();
    const startTime = Date.now();

    try {
      // Find governance state PDA
      const [governanceStatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("governance_state")],
        this.program.programId
      );

      // Check if already initialized
      try {
        await (this.program.account as any).governanceState.fetch(governanceStatePda);
        const duration = Date.now() - startTime;
        this.reporter.recordTransaction({
          program: "Governance",
          operation: "initializePoa",
          keypair: "governance-authority",
          success: true,
          duration,
          timestamp: startTime,
          error: "Already initialized (expected)",
        });
      } catch (e: any) {
        // Not initialized, initialize it
        const signature = await this.program.methods
          .initializePoa()
          .accounts({
            governanceState: governanceStatePda,
            authority: governanceAuthority.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([governanceAuthority])
          .rpc();

        const duration = Date.now() - startTime;
        this.reporter.recordTransaction({
          program: "Governance",
          operation: "initializePoa",
          keypair: "governance-authority",
          signature,
          success: true,
          duration,
          timestamp: startTime,
        });
      }
    } catch (error: any) {
      const duration = Date.now() - startTime;
      this.reporter.recordTransaction({
        program: "Governance",
        operation: "initializePoa",
        keypair: "governance-authority",
        success: false,
        duration,
        timestamp: startTime,
        error: error.message?.slice(0, 100),
      });
    }

    this.reporter.endScenario();
  }

  /**
   * Scenario 2: Emergency Pause
   * Test emergency pause functionality
   */
  async testEmergencyPause(): Promise<void> {
    this.reporter.startScenario("Emergency Pause", "Governance");

    const governanceAuthority = this.keypairManager.getGovernanceAuthority();
    const startTime = Date.now();

    try {
      const [governanceStatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("governance_state")],
        this.program.programId
      );

      const signature = await this.program.methods
        .emergencyPause()
        .accounts({
          governanceState: governanceStatePda,
          authority: governanceAuthority.publicKey,
        })
        .signers([governanceAuthority])
        .rpc();

      const duration = Date.now() - startTime;
      this.reporter.recordTransaction({
        program: "Governance",
        operation: "emergencyPause",
        keypair: "governance-authority",
        signature,
        success: true,
        duration,
        timestamp: startTime,
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      this.reporter.recordTransaction({
        program: "Governance",
        operation: "emergencyPause",
        keypair: "governance-authority",
        success: false,
        duration,
        timestamp: startTime,
        error: error.message?.slice(0, 100),
      });
    }

    this.reporter.endScenario();
  }

  /**
   * Scenario 3: Emergency Unpause
   * Test emergency unpause functionality
   */
  async testEmergencyUnpause(): Promise<void> {
    this.reporter.startScenario("Emergency Unpause", "Governance");

    const governanceAuthority = this.keypairManager.getGovernanceAuthority();
    const startTime = Date.now();

    try {
      const [governanceStatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("governance_state")],
        this.program.programId
      );

      const signature = await this.program.methods
        .emergencyUnpause()
        .accounts({
          governanceState: governanceStatePda,
          authority: governanceAuthority.publicKey,
        })
        .signers([governanceAuthority])
        .rpc();

      const duration = Date.now() - startTime;
      this.reporter.recordTransaction({
        program: "Governance",
        operation: "emergencyUnpause",
        keypair: "governance-authority",
        signature,
        success: true,
        duration,
        timestamp: startTime,
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      this.reporter.recordTransaction({
        program: "Governance",
        operation: "emergencyUnpause",
        keypair: "governance-authority",
        success: false,
        duration,
        timestamp: startTime,
        error: error.message?.slice(0, 100),
      });
    }

    this.reporter.endScenario();
  }
}

export default GovernanceScenarios;
