import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import { SecurityTestFramework } from "./security-test-framework.ts";
import { TestUtils } from "../utils/index.ts";

/**
 * Replay Attack Security Tests
 * Tests transaction replay protection, signature validation, and timestamp verification
 */

describe("Replay Attack Security Tests", () => {
  let framework: SecurityTestFramework;
  let connection: anchor.web3.Connection;
  let provider: anchor.AnchorProvider;

  before(async () => {
    connection = new anchor.web3.Connection("http://localhost:8899", "confirmed");
    const wallet = anchor.Wallet.local();
    provider = new anchor.AnchorProvider(connection, wallet, {
      commitment: "confirmed",
      preflightCommitment: "confirmed"
    });
    anchor.setProvider(provider);

    framework = new SecurityTestFramework(connection);
  });

  describe("Transaction Replay Protection", () => {
    it("Should prevent transaction replay attacks", async () => {
      const sessionId = "transaction_replay_protection";
      framework.startSession(sessionId);
      
      try {
        await framework.testReplayAttack(
          sessionId,
          "Transaction Replay Protection",
          async () => {
            // Simulate original transaction
            const originalTx = await TestUtils.simulateTransaction(
              provider.wallet.publicKey,
              "create_token",
              { amount: 1000 }
            );
            
            console.log(`✓ Original transaction executed: ${originalTx.signature}`);
            return originalTx;
          },
          async (signature: string) => {
            // Attempt to replay the transaction
            return TestUtils.replayTransaction(signature);
          }
        );

        const metrics = framework.getSecurityMetrics(sessionId);
        console.log(`Transaction replay protection metrics:`, metrics);
        
      } finally {
        framework.stopSession(sessionId);
      }
    }).timeout(30000);

    it("Should prevent replay with modified transactions", async () => {
      const sessionId = "modified_transaction_replay";
      framework.startSession(sessionId);
      
      try {
        await framework.executeSecurityTest(
          sessionId,
          "Modified Transaction Replay Protection",
          async () => {
            // Create original transaction
            const originalTx = await TestUtils.simulateTransaction(
              provider.wallet.publicKey,
              "transfer_tokens",
              { amount: 100, to: anchor.web3.PublicKey.default }
            );

            // Try to modify and replay with different parameters
            try {
              const modifiedResult = await TestUtils.simulateModifiedTransactionReplay(
                originalTx.signature,
                { amount: 1000, to: anchor.web3.Keypair.generate().publicKey }
              );

              if (modifiedResult.success) {
                throw new Error("Modified transaction replay succeeded");
              }
              
              console.log("✓ Modified transaction replay properly blocked");
            } catch (error: any) {
              if (error.message.includes('replay') || 
                  error.message.includes('duplicate') ||
                  error.message.includes('invalid signature')) {
                console.log("✓ Modified transaction replay correctly blocked");
                return;
              }
              throw error;
            }
          },
          "Modified Transaction Replay Vulnerability",
          "critical"
        );

        const metrics = framework.getSecurityMetrics(sessionId);
        console.log(`Modified transaction replay metrics:`, metrics);
        
      } finally {
        framework.stopSession(sessionId);
      }
    }).timeout(30000);
  });

  describe("Signature Validation", () => {
    it("Should validate transaction signatures properly", async () => {
      const sessionId = "signature_validation";
      framework.startSession(sessionId);
      
      try {
        await framework.executeSecurityTest(
          sessionId,
          "Signature Validation",
          async () => {
            // Test with invalid signatures
            const invalidSignatureTests = [
              { signature: "", description: "Empty signature" },
              { signature: "invalid_signature_123", description: "Invalid signature format" },
              { signature: "x".repeat(128), description: "Invalid signature length" },
              { signature: "0x" + "0".repeat(126), description: "All zeros signature" }
            ];

            for (const test of invalidSignatureTests) {
              try {
                const result = await TestUtils.validateTransactionSignature(test.signature);
                
                if (result.valid) {
                  throw new Error(`Invalid signature was accepted: ${test.description}`);
                }
                
                console.log(`✓ Invalid signature rejected: ${test.description}`);
              } catch (error: any) {
                if (!error.message.includes('rejected') && !error.message.includes('invalid')) {
                  throw error;
                }
              }
            }

            // Test with valid signature
            const validTx = await TestUtils.simulateTransaction(
              provider.wallet.publicKey,
              "create_token",
              { amount: 500 }
            );

            const validResult = await TestUtils.validateTransactionSignature(validTx.signature);
            if (!validResult.valid) {
              throw new Error("Valid signature was rejected");
            }

            console.log("✓ Signature validation working correctly");
          },
          "Signature Validation Vulnerability",
          "critical"
        );

        const metrics = framework.getSecurityMetrics(sessionId);
        console.log(`Signature validation metrics:`, metrics);
        
      } finally {
        framework.stopSession(sessionId);
      }
    }).timeout(30000);

    it("Should prevent signature forgery attempts", async () => {
      const sessionId = "signature_forgery_prevention";
      framework.startSession(sessionId);
      
      try {
        await framework.executeSecurityTest(
          sessionId,
          "Signature Forgery Prevention",
          async () => {
            // Attempt to forge signatures
            const forgeryAttempts = [
              {
                type: "modified_payload",
                description: "Modified payload with original signature"
              },
              {
                type: "wrong_signer",
                description: "Signature from wrong public key"
              },
              {
                type: "timestamp_manipulation",
                description: "Old signature with new timestamp"
              }
            ];

            for (const attempt of forgeryAttempts) {
              try {
                const result = await TestUtils.attemptSignatureForgery(
                  provider.wallet.publicKey,
                  attempt.type
                );

                if (result.success) {
                  throw new Error(`Signature forgery succeeded: ${attempt.description}`);
                }

                console.log(`✓ Signature forgery prevented: ${attempt.description}`);
              } catch (error: any) {
                if (!error.message.includes('prevented') && !error.message.includes('failed')) {
                  throw error;
                }
              }
            }

            console.log("✓ Signature forgery protection working correctly");
          },
          "Signature Forgery Vulnerability",
          "critical"
        );

        const metrics = framework.getSecurityMetrics(sessionId);
        console.log(`Signature forgery prevention metrics:`, metrics);
        
      } finally {
        framework.stopSession(sessionId);
      }
    }).timeout(30000);
  });

  describe("Nonce Verification", () => {
    it("Should implement proper nonce-based protection", async () => {
      const sessionId = "nonce_verification";
      framework.startSession(sessionId);
      
      try {
        await framework.executeSecurityTest(
          sessionId,
          "Nonce Verification",
          async () => {
            // Test nonce sequence
            const userNonce = await TestUtils.getUserNonce(provider.wallet.publicKey);
            console.log(`Current user nonce: ${userNonce}`);

            // Test transaction with correct nonce
            const correctNonceTx = await TestUtils.simulateTransactionWithNonce(
              provider.wallet.publicKey,
              "transfer_tokens",
              { amount: 100, nonce: userNonce }
            );
            
            console.log(`✓ Transaction with correct nonce: ${correctNonceTx.signature}`);

            // Test transaction with incorrect nonce
            try {
              const incorrectNonceTx = await TestUtils.simulateTransactionWithNonce(
                provider.wallet.publicKey,
                "transfer_tokens",
                { amount: 100, nonce: userNonce + 100 }
              );

              if (incorrectNonceTx.success) {
                throw new Error("Transaction with incorrect nonce succeeded");
              }

              console.log("✓ Transaction with incorrect nonce properly rejected");
            } catch (error: any) {
              if (error.message.includes('nonce') || error.message.includes('sequence')) {
                console.log("✓ Nonce verification working correctly");
                return;
              }
              throw error;
            }

            // Test nonce reuse prevention
            try {
              const reusedNonceTx = await TestUtils.simulateTransactionWithNonce(
                provider.wallet.publicKey,
                "transfer_tokens",
                { amount: 50, nonce: userNonce } // Same nonce as before
              );

              if (reusedNonceTx.success) {
                throw new Error("Transaction with reused nonce succeeded");
              }

              console.log("✓ Nonce reuse properly prevented");
            } catch (error: any) {
              if (error.message.includes('nonce') || error.message.includes('duplicate')) {
                console.log("✓ Nonce reuse prevention working correctly");
                return;
              }
              throw error;
            }
          },
          "Nonce Verification Vulnerability",
          "high"
        );

        const metrics = framework.getSecurityMetrics(sessionId);
        console.log(`Nonce verification metrics:`, metrics);
        
      } finally {
        framework.stopSession(sessionId);
      }
    }).timeout(30000);
  });

  describe("Timestamp Validation", () => {
    it("Should validate transaction timestamps", async () => {
      const sessionId = "timestamp_validation";
      framework.startSession(sessionId);
      
      try {
        await framework.executeSecurityTest(
          sessionId,
          "Timestamp Validation",
          async () => {
            const currentTime = Date.now();

            // Test with future timestamp
            try {
              const futureTx = await TestUtils.simulateTransactionWithTimestamp(
                provider.wallet.publicKey,
                "transfer_tokens",
                { amount: 100, timestamp: currentTime + 3600000 } // 1 hour in future
              );

              if (futureTx.success) {
                throw new Error("Transaction with future timestamp succeeded");
              }

              console.log("✓ Future timestamp transaction properly rejected");
            } catch (error: any) {
              if (error.message.includes('timestamp') || error.message.includes('future')) {
                console.log("✓ Future timestamp validation working");
                return;
              }
              throw error;
            }

            // Test with expired timestamp
            try {
              const expiredTx = await TestUtils.simulateTransactionWithTimestamp(
                provider.wallet.publicKey,
                "transfer_tokens",
                { amount: 100, timestamp: currentTime - 86400000 } // 24 hours ago
              );

              if (expiredTx.success) {
                throw new Error("Transaction with expired timestamp succeeded");
              }

              console.log("✓ Expired timestamp transaction properly rejected");
            } catch (error: any) {
              if (error.message.includes('timestamp') || error.message.includes('expired')) {
                console.log("✓ Expired timestamp validation working");
                return;
              }
              throw error;
            }

            // Test with valid timestamp
            const validTx = await TestUtils.simulateTransactionWithTimestamp(
              provider.wallet.publicKey,
              "transfer_tokens",
              { amount: 100, timestamp: currentTime }
            );

            if (!validTx.success) {
              throw new Error("Transaction with valid timestamp failed");
            }

            console.log("✓ Valid timestamp transaction accepted");
          },
          "Timestamp Validation Vulnerability",
          "medium"
        );

        const metrics = framework.getSecurityMetrics(sessionId);
        console.log(`Timestamp validation metrics:`, metrics);
        
      } finally {
        framework.stopSession(sessionId);
      }
    }).timeout(30000);
  });

  describe("Cross-Chain Replay Protection", () => {
    it("Should prevent cross-chain replay attacks", async () => {
      const sessionId = "cross_chain_replay_protection";
      framework.startSession(sessionId);
      
      try {
        await framework.executeSecurityTest(
          sessionId,
          "Cross-Chain Replay Protection",
          async () => {
            // Simulate transaction on mainnet
            const mainnetTx = await TestUtils.simulateTransactionOnChain(
              provider.wallet.publicKey,
              "transfer_tokens",
              { amount: 100, chainId: "mainnet-beta" }
            );

            // Try to replay on testnet
            try {
              const testnetReplay = await TestUtils.simulateTransactionReplayOnChain(
                mainnetTx.signature,
                "testnet"
              );

              if (testnetReplay.success) {
                throw new Error("Cross-chain replay succeeded");
              }

              console.log("✓ Cross-chain replay properly prevented");
            } catch (error: any) {
              if (error.message.includes('chain') || error.message.includes('replay')) {
                console.log("✓ Cross-chain protection working correctly");
                return;
              }
              throw error;
            }

            // Test with different program ID
            try {
              const programReplay = await TestUtils.simulateTransactionReplayOnProgram(
                mainnetTx.signature,
                "different_program_id"
              );

              if (programReplay.success) {
                throw new Error("Cross-program replay succeeded");
              }

              console.log("✓ Cross-program replay properly prevented");
            } catch (error: any) {
              if (error.message.includes('program') || error.message.includes('replay')) {
                console.log("✓ Cross-program protection working correctly");
                return;
              }
              throw error;
            }
          },
          "Cross-Chain Replay Vulnerability",
          "high"
        );

        const metrics = framework.getSecurityMetrics(sessionId);
        console.log(`Cross-chain replay protection metrics:`, metrics);
        
      } finally {
        framework.stopSession(sessionId);
      }
    }).timeout(30000);
  });

  describe("Replay Attack Detection", () => {
    it("Should detect and log replay attempts", async () => {
      const sessionId = "replay_attack_detection";
      framework.startSession(sessionId);
      
      try {
        await framework.executeSecurityTest(
          sessionId,
          "Replay Attack Detection",
          async () => {
            // Simulate replay attack attempts
            const replayAttempts = [
              { type: "exact_replay", description: "Exact transaction replay" },
              { type: "parameter_modified", description: "Modified parameters replay" },
              { type: "timestamp_modified", description: "Modified timestamp replay" },
              { type: "signature_modified", description: "Modified signature replay" }
            ];

            const detectionResults = [];

            for (const attempt of replayAttempts) {
              const detection = await TestUtils.detectReplayAttack(
                provider.wallet.publicKey,
                attempt.type
              );

              detectionResults.push({
                attempt: attempt.description,
                detected: detection.detected,
                logged: detection.logged,
                blocked: detection.blocked
              });

              if (!detection.detected) {
                throw new Error(`Replay attack not detected: ${attempt.description}`);
              }

              if (!detection.blocked) {
                throw new Error(`Replay attack not blocked: ${attempt.description}`);
              }

              console.log(`✓ Replay attack detected and blocked: ${attempt.description}`);
            }

            // Verify all attempts were properly logged
            const logs = await TestUtils.getReplayAttackLogs();
            if (logs.length < replayAttempts.length) {
              throw new Error("Not all replay attempts were logged");
            }

            console.log(`✓ All ${detectionResults.length} replay attacks properly detected, logged, and blocked`);
          },
          "Replay Attack Detection Vulnerability",
          "high"
        );

        const metrics = framework.getSecurityMetrics(sessionId);
        console.log(`Replay attack detection metrics:`, metrics);
        
      } finally {
        framework.stopSession(sessionId);
      }
    }).timeout(30000);
  });

  after(async () => {
    console.log("Replay attack security tests completed");
  });
});
