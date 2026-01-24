/**
 * Cross-Program Integration Flows
 * 
 * Tests end-to-end transaction flows spanning multiple programs
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { BN } from "bn.js";
import KeypairManager from "../keypair-manager.js";
import { TransactionReporter, StateValidator } from "../utils/index.js";

export class CrossProgramFlows {
  private programs: any;
  private keypairManager: KeypairManager;
  private reporter: TransactionReporter;
  private validator: StateValidator;

  constructor(
    programs: any,
    keypairManager: KeypairManager,
    reporter: TransactionReporter,
    validator: StateValidator
  ) {
    this.programs = programs;
    this.keypairManager = keypairManager;
    this.reporter = reporter;
    this.validator = validator;
  }

  async runAllFlows(): Promise<void> {
    console.log("  🔄 Running end-to-end integration flows...");
    await this.testCompleteEnergyTradingJourney();
  }

  /**
   * Scenario: Complete Energy Trading Journey
   * 1. Register Producer (Registry)
   * 2. Register Meter (Registry)
   * 3. Update Meter Reading (Registry)
   * 4. Settle Balance (Registry)
   * 5. Issue ERC (Governance)
   * 6. Validate for Trading (Governance)
   * 7. List on Market (Trading) - Simulated by state check for now
   */
  async testCompleteEnergyTradingJourney(): Promise<void> {
    this.reporter.startScenario("Complete Energy Trading Journey", "Integration");

    const producer = this.keypairManager.getProducers()[0];
    const governanceAuthority = this.keypairManager.getGovernanceAuthority();
    const oracleAuthority = this.keypairManager.getOracleAuthority();
    const meterId = "e2e-test-meter-001";
    const certId = "e2e-test-cert-001";

    try {
      // 1. Register User
      await this.runRegistryStep("registerUser", producer);

      // 2. Register Meter
      await this.runRegistryStep("registerMeter", producer, meterId);

      // 3. Update Meter Reading (5,000 units)
      await this.runRegistryStep("updateReading", producer, meterId, 5000n);

      // 4. Settle Balance
      await this.runRegistryStep("settleBalance", producer, meterId);

      // 5. Issue ERC (1,000 units)
      const [meterAccountPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("meter"), producer.publicKey.toBuffer(), Buffer.from(meterId)],
        this.programs.registry.programId
      );
      await this.runGovernanceStep("issueErc", governanceAuthority, certId, 1000n, meterAccountPda);

      // 6. Validate for Trading
      await this.runGovernanceStep("validateErc", governanceAuthority, certId);

      console.log("  ✅ Full Energy Trading Journey completed successfully");
    } catch (error: any) {
      console.error(`  ❌ Journey failed: ${error.message}`);
    }

    this.reporter.endScenario();
  }

  private async runRegistryStep(step: string, producer: any, meterId?: string, amount?: bigint): Promise<void> {
    if (!this.programs.registry) throw new Error("Registry program missing");

    const startTime = Date.now();
    try {
      let signature = "";
      switch (step) {
        case "registerUser":
          const [userPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("user"), producer.publicKey.toBuffer()],
            this.programs.registry.programId
          );
          signature = await this.programs.registry.methods
            .registerUser("E2E Producer", "producer", "Contact Info")
            .accounts({
              userAccount: userPda,
              authority: producer.publicKey,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([producer.keypair])
            .rpc();
          break;

        case "registerMeter":
          const [meterPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("meter"), producer.publicKey.toBuffer(), Buffer.from(meterId!)],
            this.programs.registry.programId
          );
          const [regPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("registry")],
            this.programs.registry.programId
          );
          signature = await this.programs.registry.methods
            .registerMeter(meterId!, "Solar", "Location")
            .accounts({
              registry: regPda,
              meterAccount: meterPda,
              owner: producer.publicKey,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([producer.keypair])
            .rpc();
          break;

        case "updateReading":
          const [mPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("meter"), producer.publicKey.toBuffer(), Buffer.from(meterId!)],
            this.programs.registry.programId
          );
          const [rPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("registry")],
            this.programs.registry.programId
          );
          signature = await this.programs.registry.methods
            .updateMeterReading(new BN(amount!.toString()), new BN(0), new BN(Math.floor(Date.now() / 1000)))
            .accounts({
              registry: rPda,
              meterAccount: mPda,
              oracleAuthority: this.keypairManager.getOracleAuthority().publicKey,
            })
            .signers([this.keypairManager.getOracleAuthority()])
            .rpc();
          break;

        case "settleBalance":
          const [msPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("meter"), producer.publicKey.toBuffer(), Buffer.from(meterId!)],
            this.programs.registry.programId
          );
          signature = await this.programs.registry.methods
            .settleMeterBalance()
            .accounts({
              meterAccount: msPda,
              meterOwner: producer.publicKey,
            })
            .signers([producer.keypair])
            .rpc();
          break;
      }

      this.reporter.recordTransaction({
        program: "Registry",
        operation: step,
        keypair: producer.name,
        signature,
        success: true,
        duration: Date.now() - startTime,
        timestamp: startTime,
      });
    } catch (e: any) {
      this.reporter.recordTransaction({
        program: "Registry",
        operation: step,
        keypair: producer.name,
        success: false,
        duration: Date.now() - startTime,
        timestamp: startTime,
        error: e.message?.slice(0, 100),
      });
      throw e;
    }
  }

  private async runGovernanceStep(step: string, authority: any, certId: string, amount?: bigint, meterPda?: PublicKey): Promise<void> {
    if (!this.programs.governance) throw new Error("Governance program missing");

    const startTime = Date.now();
    try {
      let signature = "";
      const [poaPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("poa_config")],
        this.programs.governance.programId
      );
      const [certPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("erc_certificate"), Buffer.from(certId)],
        this.programs.governance.programId
      );

      switch (step) {
        case "issueErc":
          signature = await this.programs.governance.methods
            .issueErc(certId, new BN(amount!.toString()), "Solar", "Validated E2E")
            .accounts({
              poaConfig: poaPda,
              ercCertificate: certPda,
              meterAccount: meterPda!,
              authority: authority.publicKey,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([authority])
            .rpc();
          break;

        case "validateErc":
          signature = await this.programs.governance.methods
            .validateErcForTrading()
            .accounts({
              poaConfig: poaPda,
              ercCertificate: certPda,
              authority: authority.publicKey,
            })
            .signers([authority])
            .rpc();
          break;
      }

      this.reporter.recordTransaction({
        program: "Governance",
        operation: step,
        keypair: "governance-authority",
        signature,
        success: true,
        duration: Date.now() - startTime,
        timestamp: startTime,
      });
    } catch (e: any) {
      this.reporter.recordTransaction({
        program: "Governance",
        operation: step,
        keypair: "governance-authority",
        success: false,
        duration: Date.now() - startTime,
        timestamp: startTime,
        error: e.message?.slice(0, 100),
      });
      throw e;
    }
  }
}

export default CrossProgramFlows;
