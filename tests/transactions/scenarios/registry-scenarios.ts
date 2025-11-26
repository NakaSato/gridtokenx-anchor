/**
 * Registry Program Transaction Test Scenarios
 * 
 * Tests all core business logic for the Registry program across all keypairs
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import KeypairManager from "../keypair-manager.js";
import { TransactionReporter, StateValidator, TransactionResult } from "../utils/index.js";

export class RegistryScenarios {
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

  /**
   * Run all registry test scenarios
   */
  async runAllScenarios(): Promise<void> {
    await this.testMultiUserRegistration();
    await this.testMultiMeterRegistration();
    await this.testConcurrentMeterUpdates();
    await this.testBalanceSettlementFlow();
    await this.testAuthorizationChecks();
  }

  /**
   * Scenario 1: Multi-User Registration
   * Register all producer and consumer wallets as users
   */
  async testMultiUserRegistration(): Promise<void> {
    this.reporter.startScenario("Multi-User Registration", "Registry");

    const producers = this.keypairManager.getProducers();
    const consumers = this.keypairManager.getConsumers();
    const allUsers = [...producers, ...consumers];

    for (const user of allUsers) {
      const startTime = Date.now();

      try {
        // Determine user type
        const userType = producers.includes(user) ? { prosumer: {} } : { consumer: {} };
        const location = `Location-${user.name}`;

        // Find user account PDA
        const [userAccountPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("user"), user.publicKey.toBuffer()],
          this.program.programId
        );

        // Find registry PDA
        const [registryPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("registry")],
          this.program.programId
        );

        // Register user
        try {
          const signature = await this.program.methods
            .registerUser(userType, location)
            .accounts({
              registry: registryPda,
              userAccount: userAccountPda,
              userAuthority: user.publicKey,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([user.keypair])
            .rpc();

          const duration = Date.now() - startTime;
          this.reporter.recordTransaction({
            program: "Registry",
            operation: "registerUser",
            keypair: user.name,
            signature,
            success: true,
            duration,
            timestamp: startTime,
          });

        } catch (error: any) {
          // User might already be registered - check if account exists
          if (error.message.includes("already in use")) {
            const duration = Date.now() - startTime;
            this.reporter.recordTransaction({
              program: "Registry",
              operation: "registerUser",
              keypair: user.name,
              success: true,
              duration,
              timestamp: startTime,
              error: "Already registered (expected)",
            });
          } else {
            throw error;
          }
        }

      } catch (error: any) {
        const duration = Date.now() - startTime;
        this.reporter.recordTransaction({
          program: "Registry",
          operation: "registerUser",
          keypair: user.name,
          success: false,
          duration,
          timestamp: startTime,
          error: error.message,
        });
      }
    }

    this.reporter.endScenario();
  }

  /**
   * Scenario 2: Multi-Meter Registration
   * Register multiple meters for all producers
   */
  async testMultiMeterRegistration(): Promise<void> {
    this.reporter.startScenario("Multi-Meter Registration", "Registry");

    const producers = this.keypairManager.getProducers();

    for (const producer of producers) {
      // Register 1-2 meters per producer
      const meterCount = producer.name === "producer-1" ? 2 : 1;

      for (let i = 0; i < meterCount; i++) {
        const startTime = Date.now();

        try {
          const meterId = `${producer.name}-meter-${i + 1}`;
          const meterType = this.getMeterType(producer.name, i);

          // Find PDAs
          const [meterAccountPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("meter"), Buffer.from(meterId)],
            this.program.programId
          );

          const [userAccountPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("user"), producer.publicKey.toBuffer()],
            this.program.programId
          );

          const [registryPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("registry")],
            this.program.programId
          );

          // Register meter
          try {
            const signature = await this.program.methods
              .registerMeter(meterId, meterType)
              .accounts({
                registry: registryPda,
                userAccount: userAccountPda,
                meterAccount: meterAccountPda,
                userAuthority: producer.publicKey,
                systemProgram: anchor.web3.SystemProgram.programId,
              })
              .signers([producer.keypair])
              .rpc();

            const duration = Date.now() - startTime;
            this.reporter.recordTransaction({
              program: "Registry",
              operation: "registerMeter",
              keypair: producer.name,
              signature,
              success: true,
              duration,
              timestamp: startTime,
            });

          } catch (error: any) {
            if (error.message.includes("already in use")) {
              const duration = Date.now() - startTime;
              this.reporter.recordTransaction({
                program: "Registry",
                operation: "registerMeter",
                keypair: producer.name,
                success: true,
                duration,
                timestamp: startTime,
                error: "Already registered (expected)",
              });
            } else {
              throw error;
            }
          }

        } catch (error: any) {
          const duration = Date.now() - startTime;
          this.reporter.recordTransaction({
            program: "Registry",
            operation: "registerMeter",
            keypair: producer.name,
            success: false,
            duration,
            timestamp: startTime,
            error: error.message,
          });
        }
      }
    }

    this.reporter.endScenario();
  }

  /**
   * Scenario 3: Concurrent Meter Updates
   * Submit meter readings from all meters simultaneously
   */
  async testConcurrentMeterUpdates(): Promise<void> {
    this.reporter.startScenario("Concurrent Meter Updates", "Registry");

    const producers = this.keypairManager.getProducers();
    const oracleAuthority = this.keypairManager.getOracleAuthority();

    for (const producer of producers) {
      const meterId = `${producer.name}-meter-1`;
      const startTime = Date.now();

      try {
        // Generate random meter reading
        const energyGenerated = Math.floor(Math.random() * 10000) + 1000; // 1000-11000 Wh
        const energyConsumed = Math.floor(Math.random() * 5000); // 0-5000 Wh
        const readingTimestamp = Math.floor(Date.now() / 1000);

        // Find meter account PDA
        const [meterAccountPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("meter"), Buffer.from(meterId)],
          this.program.programId
        );

        // Update meter reading
        const signature = await this.program.methods
          .updateMeterReading(
            new anchor.BN(energyGenerated),
            new anchor.BN(energyConsumed),
            new anchor.BN(readingTimestamp)
          )
          .accounts({
            meterAccount: meterAccountPda,
            oracleAuthority: oracleAuthority.publicKey,
          })
          .signers([oracleAuthority])
          .rpc();

        const duration = Date.now() - startTime;
        this.reporter.recordTransaction({
          program: "Registry",
          operation: "updateMeterReading",
          keypair: `oracle->${producer.name}`,
          signature,
          success: true,
          duration,
          timestamp: startTime,
        });

      } catch (error: any) {
        const duration = Date.now() - startTime;
        this.reporter.recordTransaction({
          program: "Registry",
          operation: "updateMeterReading",
          keypair: `oracle->${producer.name}`,
          success: false,
          duration,
          timestamp: startTime,
          error: error.message,
        });
      }
    }

    this.reporter.endScenario();
  }

  /**
   * Scenario 4: Balance Settlement Flow
   * Settle meter balances for all producers
   */
  async testBalanceSettlementFlow(): Promise<void> {
    this.reporter.startScenario("Balance Settlement Flow", "Registry");

    const producers = this.keypairManager.getProducers();

    for (const producer of producers) {
      const meterId = `${producer.name}-meter-1`;
      const startTime = Date.now();

      try {
        // Find meter account PDA
        const [meterAccountPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("meter"), Buffer.from(meterId)],
          this.program.programId
        );

        try {
          // Settle meter balance
          const signature = await this.program.methods
            .settleMeterBalance()
            .accounts({
              meterAccount: meterAccountPda,
              meterOwner: producer.publicKey,
            })
            .signers([producer.keypair])
            .rpc();

          const duration = Date.now() - startTime;
          this.reporter.recordTransaction({
            program: "Registry",
            operation: "settleMeterBalance",
            keypair: producer.name,
            signature,
            success: true,
            duration,
            timestamp: startTime,
          });

          // Validate settlement doesn't exceed generation
          const validationResult = await this.validator.validateMeterSettlement(
            meterAccountPda,
            0 // We don't know the expected value, just check it's valid
          );

          if (!validationResult.valid) {
            console.warn(`  ⚠️  Settlement validation warnings for ${producer.name}`);
            this.validator.printValidationResult(validationResult, `Settlement for ${producer.name}`);
          }

        } catch (error: any) {
          if (error.message.includes("NoUnsettledBalance")) {
            const duration = Date.now() - startTime;
            this.reporter.recordTransaction({
              program: "Registry",
              operation: "settleMeterBalance",
              keypair: producer.name,
              success: true,
              duration,
              timestamp: startTime,
              error: "No unsettled balance (expected)",
            });
          } else {
            throw error;
          }
        }

      } catch (error: any) {
        const duration = Date.now() - startTime;
        this.reporter.recordTransaction({
          program: "Registry",
          operation: "settleMeterBalance",
          keypair: producer.name,
          success: false,
          duration,
          timestamp: startTime,
          error: error.message,
        });
      }
    }

    this.reporter.endScenario();
  }

  /**
   * Scenario 5: Authorization Checks
   * Verify only authorized users can update their own meters
   */
  async testAuthorizationChecks(): Promise<void> {
    this.reporter.startScenario("Authorization Checks", "Registry");

    const producers = this.keypairManager.getProducers();

    if (producers.length >= 2) {
      // Try to have producer-2 update producer-1's meter (should fail)
      const producer1 = producers[0];
      const producer2 = producers[1];
      const meterId = `${producer1.name}-meter-1`;
      const startTime = Date.now();

      try {
        const [meterAccountPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("meter"), Buffer.from(meterId)],
          this.program.programId
        );

        // This should fail - producer2 trying to settle producer1's meter
        await this.program.methods
          .settleMeterBalance()
          .accounts({
            meterAccount: meterAccountPda,
            meterOwner: producer2.publicKey, // Wrong owner!
          })
          .signers([producer2.keypair])
          .rpc();

        // If we get here, authorization failed (this is bad!)
        const duration = Date.now() - startTime;
        this.reporter.recordTransaction({
          program: "Registry",
          operation: "unauthorizedSettlement",
          keypair: `${producer2.name}->${producer1.name}`,
          success: false,
          duration,
          timestamp: startTime,
          error: "SECURITY ISSUE: Unauthorized access was allowed!",
        });

      } catch (error: any) {
        // Expected to fail
        const duration = Date.now() - startTime;
        const isAuthError = error.message.includes("Unauthorized") ||
          error.message.includes("constraint") ||
          error.message.includes("ConstraintSeeds");

        this.reporter.recordTransaction({
          program: "Registry",
          operation: "unauthorizedSettlement",
          keypair: `${producer2.name}->${producer1.name}`,
          success: isAuthError, // Success means it was properly rejected
          duration,
          timestamp: startTime,
          error: isAuthError ? "Properly rejected (expected)" : error.message,
        });
      }
    }

    this.reporter.endScenario();
  }

  /**
   * Helper: Get meter type based on producer and index
   */
  private getMeterType(producerName: string, index: number): any {
    const types = [
      { solar: {} },
      { wind: {} },
      { battery: {} },
    ];

    if (producerName === "producer-1") {
      return types[0]; // Solar
    } else if (producerName === "producer-2") {
      return types[1]; // Wind
    } else {
      return types[2]; // Battery
    }
  }
}

export default RegistryScenarios;
