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
    // ERC Lifecycle Integration Tests
    await this.testErcFullLifecycle();
    await this.testErcBatchIssuance();
    await this.testErcValidationEdgeCases();
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

  // ========== ERC LIFECYCLE INTEGRATION TESTS ==========

  /**
   * Scenario 4: Full ERC Lifecycle
   * Issue -> Validate -> Transfer -> Revoke
   */
  async testErcFullLifecycle(): Promise<void> {
    this.reporter.startScenario("ERC Full Lifecycle", "Governance");

    const governanceAuthority = this.keypairManager.getGovernanceAuthority();

    // Step 1: Issue ERC Certificate
    await this.issueErcCertificate(
      governanceAuthority,
      "test-erc-lifecycle-001",
      1000000000n, // 1 token worth of energy
      "Solar",
    );

    // Step 2: Validate ERC for Trading
    await this.validateErcForTrading(governanceAuthority, "test-erc-lifecycle-001");

    // Step 3: Transfer ERC (simulate trade)
    const recipient = this.keypairManager.getMintAuthority(); // Use another keypair as recipient
    await this.transferErc(governanceAuthority, "test-erc-lifecycle-001", recipient.publicKey);

    // Step 4: Revoke ERC (cleanup or fraud detection)
    await this.revokeErc(governanceAuthority, "test-erc-lifecycle-001", "Test lifecycle completion");

    this.reporter.endScenario();
  }

  /**
   * Scenario 5: ERC Issuance - Multiple Certificates
   */
  async testErcBatchIssuance(): Promise<void> {
    this.reporter.startScenario("ERC Batch Issuance", "Governance");

    const governanceAuthority = this.keypairManager.getGovernanceAuthority();
    const certificates = [
      { id: "batch-erc-001", energy: 500000000n, source: "Solar" },
      { id: "batch-erc-002", energy: 750000000n, source: "Wind" },
      { id: "batch-erc-003", energy: 1000000000n, source: "Hydro" },
      { id: "batch-erc-004", energy: 250000000n, source: "Solar" },
      { id: "batch-erc-005", energy: 2000000000n, source: "Biomass" },
    ];

    for (const cert of certificates) {
      await this.issueErcCertificate(
        governanceAuthority,
        cert.id,
        cert.energy,
        cert.source,
      );
    }

    this.reporter.endScenario();
  }

  /**
   * Scenario 6: ERC Validation Edge Cases
   */
  async testErcValidationEdgeCases(): Promise<void> {
    this.reporter.startScenario("ERC Validation Edge Cases", "Governance");

    const governanceAuthority = this.keypairManager.getGovernanceAuthority();

    // Issue certificates with edge case amounts
    const edgeCases = [
      { id: "edge-min", energy: 1n, source: "Solar" }, // Minimum
      { id: "edge-small", energy: 100n, source: "Wind" }, // Very small
      { id: "edge-large", energy: 100000000000n, source: "Hydro" }, // Large
    ];

    for (const cert of edgeCases) {
      await this.issueErcCertificate(
        governanceAuthority,
        cert.id,
        cert.energy,
        cert.source,
      );
      await this.validateErcForTrading(governanceAuthority, cert.id);
    }

    this.reporter.endScenario();
  }

  // ========== HELPER METHODS ==========

  private async issueErcCertificate(
    authority: anchor.web3.Keypair,
    certificateId: string,
    energyAmount: bigint,
    renewableSource: string,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      const [governanceStatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("governance_state")],
        this.program.programId
      );

      const [ercCertificatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("erc_certificate"), Buffer.from(certificateId)],
        this.program.programId
      );

      const signature = await this.program.methods
        .issueErc(certificateId, new anchor.BN(energyAmount.toString()), renewableSource, "validated")
        .accounts({
          governanceState: governanceStatePda,
          ercCertificate: ercCertificatePda,
          authority: authority.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      const duration = Date.now() - startTime;
      this.reporter.recordTransaction({
        program: "Governance",
        operation: "issueErc",
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
        operation: "issueErc",
        keypair: "governance-authority",
        success: false,
        duration,
        timestamp: startTime,
        error: error.message?.slice(0, 100),
      });
    }
  }

  private async validateErcForTrading(
    authority: anchor.web3.Keypair,
    certificateId: string,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      const [governanceStatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("governance_state")],
        this.program.programId
      );

      const [ercCertificatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("erc_certificate"), Buffer.from(certificateId)],
        this.program.programId
      );

      const signature = await this.program.methods
        .validateErcForTrading()
        .accounts({
          governanceState: governanceStatePda,
          ercCertificate: ercCertificatePda,
          authority: authority.publicKey,
        })
        .signers([authority])
        .rpc();

      const duration = Date.now() - startTime;
      this.reporter.recordTransaction({
        program: "Governance",
        operation: "validateErcForTrading",
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
        operation: "validateErcForTrading",
        keypair: "governance-authority",
        success: false,
        duration,
        timestamp: startTime,
        error: error.message?.slice(0, 100),
      });
    }
  }

  private async transferErc(
    currentOwner: anchor.web3.Keypair,
    certificateId: string,
    newOwner: PublicKey,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      const [governanceStatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("governance_state")],
        this.program.programId
      );

      const [ercCertificatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("erc_certificate"), Buffer.from(certificateId)],
        this.program.programId
      );

      const signature = await this.program.methods
        .transferErc()
        .accounts({
          governanceState: governanceStatePda,
          ercCertificate: ercCertificatePda,
          currentOwner: currentOwner.publicKey,
          newOwner: newOwner,
        })
        .signers([currentOwner])
        .rpc();

      const duration = Date.now() - startTime;
      this.reporter.recordTransaction({
        program: "Governance",
        operation: "transferErc",
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
        operation: "transferErc",
        keypair: "governance-authority",
        success: false,
        duration,
        timestamp: startTime,
        error: error.message?.slice(0, 100),
      });
    }
  }

  private async revokeErc(
    authority: anchor.web3.Keypair,
    certificateId: string,
    reason: string,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      const [governanceStatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("governance_state")],
        this.program.programId
      );

      const [ercCertificatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("erc_certificate"), Buffer.from(certificateId)],
        this.program.programId
      );

      const signature = await this.program.methods
        .revokeErc(reason)
        .accounts({
          governanceState: governanceStatePda,
          ercCertificate: ercCertificatePda,
          authority: authority.publicKey,
        })
        .signers([authority])
        .rpc();

      const duration = Date.now() - startTime;
      this.reporter.recordTransaction({
        program: "Governance",
        operation: "revokeErc",
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
        operation: "revokeErc",
        keypair: "governance-authority",
        success: false,
        duration,
        timestamp: startTime,
        error: error.message?.slice(0, 100),
      });
    }
  }
}

export default GovernanceScenarios;
