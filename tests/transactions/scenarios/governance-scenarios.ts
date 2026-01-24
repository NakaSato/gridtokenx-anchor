/**
 * Governance Program Transaction Test Scenarios
 * 
 * Tests ERC issuance, validation, and governance controls
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { BN } from "bn.js";
import KeypairManager from "../keypair-manager.js";
import { TransactionReporter, StateValidator } from "../utils/index.js";

export class GovernanceScenarios {
  private governanceProgram: anchor.Program;
  private registryProgram: anchor.Program | null;
  private keypairManager: KeypairManager;
  private reporter: TransactionReporter;
  private validator: StateValidator;

  constructor(
    governanceProgram: anchor.Program,
    keypairManager: KeypairManager,
    reporter: TransactionReporter,
    validator: StateValidator,
    registryProgram: anchor.Program | null = null
  ) {
    this.governanceProgram = governanceProgram;
    this.keypairManager = keypairManager;
    this.reporter = reporter;
    this.validator = validator;
    this.registryProgram = registryProgram;
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
      // Find governance config PDA
      const [poaConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("poa_config")],
        this.governanceProgram.programId
      );

      try {
        await (this.governanceProgram.account as any).poaConfig.fetch(poaConfigPda);
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
        const signature = await this.governanceProgram.methods
          .initializePoa()
          .accounts({
            poaConfig: poaConfigPda,
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
      const [poaConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("poa_config")],
        this.governanceProgram.programId
      );

      const signature = await this.governanceProgram.methods
        .emergencyPause()
        .accounts({
          poaConfig: poaConfigPda,
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
      const [poaConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("poa_config")],
        this.governanceProgram.programId
      );

      const signature = await this.governanceProgram.methods
        .emergencyUnpause()
        .accounts({
          poaConfig: poaConfigPda,
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
    const producer1 = this.keypairManager.getProducers()[0];
    const [meterAccountPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("meter"), producer1.publicKey.toBuffer(), Buffer.from("producer-1-meter-1")],
      new PublicKey("EgpmmYPFDAX8QfawUEFissBXi3yG6AapoxNfB6KdGtBQ")
    );

    // Step 1: Prepare Meter State (if registry available)
    if (this.registryProgram) {
      await this.prepareMeterGeneration(producer1, "producer-1-meter-1", 10000n);
    }

    // Step 2: Issue ERC Certificate
    await this.issueErcCertificate(
      governanceAuthority,
      "test-erc-lifecycle-001",
      1000n, // 1000 units (within [100, 1M] range)
      "Solar",
      meterAccountPda
    );

    // Step 3: Validate ERC for Trading
    await this.validateErcForTrading(governanceAuthority, "test-erc-lifecycle-001");

    // Step 4: Transfer ERC (simulate trade)
    const recipient = this.keypairManager.getOracleAuthority(); // Use another keypair as recipient
    await this.transferErc(governanceAuthority, "test-erc-lifecycle-001", recipient.publicKey);

    // Step 5: Revoke ERC (cleanup or fraud detection)
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
      { id: "batch-erc-001", energy: 1000n, source: "Solar" },
      { id: "batch-erc-002", energy: 1500n, source: "Wind" },
      { id: "batch-erc-003", energy: 2000n, source: "Hydro" },
      { id: "batch-erc-004", energy: 2500n, source: "Solar" },
      { id: "batch-erc-005", energy: 3000n, source: "Biomass" },
    ];

    for (const cert of certificates) {
      const producer1 = this.keypairManager.getProducers()[0];
      const [meterAccountPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("meter"), producer1.publicKey.toBuffer(), Buffer.from("producer-1-meter-1")],
        new PublicKey("EgpmmYPFDAX8QfawUEFissBXi3yG6AapoxNfB6KdGtBQ")
      );

      // Prepare energy for each certificate
      if (this.registryProgram) {
        await this.prepareMeterGeneration(producer1, "producer-1-meter-1", cert.energy);
      }

      await this.issueErcCertificate(
        governanceAuthority,
        cert.id,
        cert.energy,
        cert.source,
        meterAccountPda
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

    // Success Cases
    const successCases = [
      { id: "edge-min", energy: 100n, source: "Solar" }, // Exactly min
      { id: "edge-mid", energy: 500000n, source: "Wind" }, // Mid range
      { id: "edge-max", energy: 1000000n, source: "Hydro" }, // Exactly max
    ];

    for (const cert of successCases) {
      const producer1 = this.keypairManager.getProducers()[0];
      const [meterAccountPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("meter"), producer1.publicKey.toBuffer(), Buffer.from("producer-1-meter-1")],
        new PublicKey("EgpmmYPFDAX8QfawUEFissBXi3yG6AapoxNfB6KdGtBQ")
      );

      if (this.registryProgram) {
        await this.prepareMeterGeneration(producer1, "producer-1-meter-1", cert.energy);
      }

      await this.issueErcCertificate(governanceAuthority, cert.id, cert.energy, cert.source, meterAccountPda);
      await this.validateErcForTrading(governanceAuthority, cert.id);
    }

    // Failure Cases (Negative Testing)
    const failureCases = [
      { id: "fail-below-min", energy: 50n, source: "Solar", expectedError: "BelowMinimumEnergy" },
      { id: "fail-above-max", energy: 2000000n, source: "Wind", expectedError: "ExceedsMaximumEnergy" },
    ];

    for (const cert of failureCases) {
      const producer1 = this.keypairManager.getProducers()[0];
      const [meterAccountPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("meter"), producer1.publicKey.toBuffer(), Buffer.from("producer-1-meter-1")],
        new PublicKey("EgpmmYPFDAX8QfawUEFissBXi3yG6AapoxNfB6KdGtBQ")
      );

      try {
        await this.issueErcCertificate(governanceAuthority, cert.id, cert.energy, cert.source, meterAccountPda);
        console.warn(`  ⚠️  Expected failure for ${cert.id} but it succeeded`);
      } catch (e: any) {
        const errorMsg = e.toString();
        if (errorMsg.includes(cert.expectedError)) {
          console.log(`  ✓ Correctly rejected ${cert.id} with ${cert.expectedError}`);
        } else {
          console.warn(`  ⚠️  Rejected ${cert.id} with unexpected error: ${errorMsg}`);
        }
      }
    }

    this.reporter.endScenario();
  }

  // ========== HELPER METHODS ==========

  /**
   * Helper: Prepare meter generation in Registry
   */
  private async prepareMeterGeneration(
    owner: any,
    meterId: string,
    amount: bigint
  ): Promise<void> {
    if (!this.registryProgram) return;

    try {
      const [meterAccountPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("meter"), owner.publicKey.toBuffer(), Buffer.from(meterId)],
        this.registryProgram.programId
      );

      const [registryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("registry")],
        this.registryProgram.programId
      );

      // Update reading
      const timestamp = Math.floor(Date.now() / 1000);
      await this.registryProgram.methods
        .updateMeterReading(new BN(amount.toString()), new BN(0), new BN(timestamp))
        .accounts({
          registry: registryPda,
          meterAccount: meterAccountPda,
          oracleAuthority: this.keypairManager.getOracleAuthority().publicKey,
        })
        .signers([this.keypairManager.getOracleAuthority()])
        .rpc();

      // Settle balance
      await this.registryProgram.methods
        .settleMeterBalance()
        .accounts({
          meterAccount: meterAccountPda,
          meterOwner: owner.publicKey,
        })
        .signers([owner.keypair])
        .rpc();

    } catch (e: any) {
      console.warn(`  ⚠️  Failed to prepare meter generation: ${e.message}`);
    }
  }

  private async issueErcCertificate(
    authority: anchor.web3.Keypair,
    certificateId: string,
    energyAmount: bigint,
    renewableSource: string,
    meterAccount: PublicKey,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      const [poaConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("poa_config")],
        this.governanceProgram.programId
      );

      const [ercCertificatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("erc_certificate"), Buffer.from(certificateId)],
        this.governanceProgram.programId
      );

      const signature = await this.governanceProgram.methods
        .issueErc(certificateId, new BN(energyAmount.toString()), renewableSource, "validated")
        .accounts({
          poaConfig: poaConfigPda,
          ercCertificate: ercCertificatePda,
          meterAccount: meterAccount,
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
      const [poaConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("poa_config")],
        this.governanceProgram.programId
      );

      const [ercCertificatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("erc_certificate"), Buffer.from(certificateId)],
        this.governanceProgram.programId
      );

      const signature = await this.governanceProgram.methods
        .validateErcForTrading()
        .accounts({
          poaConfig: poaConfigPda,
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
      const [poaConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("poa_config")],
        this.governanceProgram.programId
      );

      const [ercCertificatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("erc_certificate"), Buffer.from(certificateId)],
        this.governanceProgram.programId
      );

      const signature = await this.governanceProgram.methods
        .transferErc()
        .accounts({
          poaConfig: poaConfigPda,
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
      const [poaConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("poa_config")],
        this.governanceProgram.programId
      );

      const [ercCertificatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("erc_certificate"), Buffer.from(certificateId)],
        this.governanceProgram.programId
      );

      const signature = await this.governanceProgram.methods
        .revokeErc(reason)
        .accounts({
          poaConfig: poaConfigPda,
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
