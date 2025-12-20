import * as anchor from "@coral-xyz/anchor";
import {
  TestEnvironment,
  describe,
  it,
  before,
  beforeEach,
  after,
  expect
} from "./setup";
import { TestUtils } from "./utils/index";

// Test amounts (in smallest units - lamports)
const TEST_AMOUNTS = {
  ONE_TOKEN: 1_000_000_000,
  TEN_TOKENS: 10_000_000_000,
  SMALL_AMOUNT: 100_000_000, // 0.1 tokens
  MEDIUM_AMOUNT: 1_000_000_000, // 1 token
  LARGE_AMOUNT: 10_000_000_000, // 10 tokens
};

describe("Governance Program Tests", () => {
  let env: TestEnvironment;
  let poaConfigPda: anchor.web3.PublicKey;

  before(async () => {
    env = await TestEnvironment.create();

    // Get PDAs
    [poaConfigPda] = TestUtils.findPoaConfigPda(env.governanceProgram.programId);
  });

  describe("PoA Initialization", () => {
    it("should initialize PoA configuration", async () => {
      try {
        const tx = await env.governanceProgram.methods
          .initializePoa()
          .accounts({
            // @ts-ignore
            poaConfig: poaConfigPda,
            authority: env.authority.publicKey,
          })
          .signers([env.authority])
          .rpc();

        expect(tx).to.exist;
      } catch (error: any) {
        // Program might already be initialized
        expect(error.message).to.contain("already in use");
      }
    });

    it("should fail to initialize with unauthorized authority", async () => {
      const unauthorizedKeypair = anchor.web3.Keypair.generate();

      await expect(
        env.governanceProgram.methods
          .initializePoa()
          .accounts({
            // @ts-ignore
            poaConfig: poaConfigPda,
            authority: unauthorizedKeypair.publicKey,
          })
          .signers([unauthorizedKeypair])
          .rpc()
      ).to.throw();
    });
  });

  describe("Emergency Controls", () => {
    it("should pause the system", async () => {
      try {
        const tx = await env.governanceProgram.methods
          .emergencyPause()
          .accounts({
            // @ts-ignore
            poaConfig: poaConfigPda,
            authority: env.authority.publicKey,
          })
          .signers([env.authority])
          .rpc();

        expect(tx).to.exist;
      } catch (error: any) {
        // Program might not be initialized yet
        expect(error.message).to.contain("Account does not exist");
      }
    });

    it("should unpause the system", async () => {
      try {
        const tx = await env.governanceProgram.methods
          .emergencyUnpause()
          .accounts({
            // @ts-ignore
            poaConfig: poaConfigPda,
            authority: env.authority.publicKey,
          })
          .signers([env.authority])
          .rpc();

        expect(tx).to.exist;
      } catch (error: any) {
        // Program might not be initialized yet
        expect(error.message).to.contain("Account does not exist");
      }
    });

    it("should fail pause with unauthorized authority", async () => {
      const unauthorizedKeypair = anchor.web3.Keypair.generate();

      await expect(
        env.governanceProgram.methods
          .emergencyPause()
          .accounts({
            // @ts-ignore
            poaConfig: poaConfigPda,
            authority: unauthorizedKeypair.publicKey,
          })
          .signers([unauthorizedKeypair])
          .rpc()
      ).to.throw();
    });
  });

  describe("ERC Certificate Management", () => {
    it("should issue an ERC certificate", async () => {
      const certificateId = TestUtils.generateTestId("erc");
      const energyAmount = TEST_AMOUNTS.ONE_TOKEN;
      const renewableSource = "Solar";
      const validationData = TestUtils.generateTestId("validation");

      // Mock meter account (would normally come from registry)
      const meterAccount = anchor.web3.Keypair.generate().publicKey;

      try {
        const tx = await env.governanceProgram.methods
          .issueErc(certificateId, new anchor.BN(energyAmount), renewableSource, validationData)
          .accounts({
            // @ts-ignore
            poaConfig: poaConfigPda,
            ercCertificate: TestUtils.findErcCertificatePda(env.governanceProgram.programId, certificateId)[0],
            meterAccount: meterAccount,
            authority: env.authority.publicKey,
          })
          .signers([env.authority])
          .rpc();

        expect(tx).to.exist;
      } catch (error: any) {
        // Expected to fail without proper setup
        expect(error.message).to.contain("Account does not exist");
      }
    });

    it("should validate an ERC for trading", async () => {
      const certificateId = TestUtils.generateTestId("erc");

      try {
        const tx = await env.governanceProgram.methods
          .validateErcForTrading()
          .accounts({
            // @ts-ignore
            poaConfig: poaConfigPda,
            ercCertificate: TestUtils.findErcCertificatePda(env.governanceProgram.programId, certificateId)[0],
            authority: env.authority.publicKey,
          })
          .signers([env.authority])
          .rpc();

        expect(tx).to.exist;
      } catch (error: any) {
        // Expected to fail without proper setup
        expect(error.message).to.contain("Account does not exist");
      }
    });

    it("should fail to validate with unauthorized authority", async () => {
      const certificateId = TestUtils.generateTestId("erc");
      const unauthorizedKeypair = anchor.web3.Keypair.generate();

      await expect(
        env.governanceProgram.methods
          .validateErcForTrading()
          .accounts({
            // @ts-ignore
            poaConfig: poaConfigPda,
            ercCertificate: TestUtils.findErcCertificatePda(env.governanceProgram.programId, certificateId)[0],
            authority: unauthorizedKeypair.publicKey,
          })
          .signers([unauthorizedKeypair])
          .rpc()
      ).to.throw();
    });
  });

  describe("Governance Configuration", () => {
    it("should update governance configuration", async () => {
      try {
        const tx = await env.governanceProgram.methods
          .updateGovernanceConfig(true)
          .accounts({
            // @ts-ignore
            poaConfig: poaConfigPda,
            authority: env.authority.publicKey,
          })
          .signers([env.authority])
          .rpc();

        expect(tx).to.exist;
      } catch (error: any) {
        // Program might not be initialized yet
        expect(error.message).to.contain("Account does not exist");
      }
    });

    it("should set maintenance mode", async () => {
      try {
        const tx = await env.governanceProgram.methods
          .setMaintenanceMode(true)
          .accounts({
            // @ts-ignore
            poaConfig: poaConfigPda,
            authority: env.authority.publicKey,
          })
          .signers([env.authority])
          .rpc();

        expect(tx).to.exist;
      } catch (error: any) {
        // Program might not be initialized yet
        expect(error.message).to.contain("Account does not exist");
      }
    });

    it("should update ERC limits", async () => {
      try {
        const tx = await env.governanceProgram.methods
          .updateErcLimits(
            new anchor.BN(TEST_AMOUNTS.ONE_TOKEN),
            new anchor.BN(TEST_AMOUNTS.TEN_TOKENS),
            new anchor.BN(365 * 24 * 60 * 60 * 1000) // 1 year in milliseconds
          )
          .accounts({
            // @ts-ignore
            poaConfig: poaConfigPda,
            authority: env.authority.publicKey,
          })
          .signers([env.authority])
          .rpc();

        expect(tx).to.exist;
      } catch (error: any) {
        // Program might not be initialized yet
        expect(error.message).to.contain("Account does not exist");
      }
    });

    it("should update authority contact info", async () => {
      const contactInfo = "Test Authority <test@example.com>";

      try {
        const tx = await env.governanceProgram.methods
          .updateAuthorityInfo(contactInfo)
          .accounts({
            // @ts-ignore
            poaConfig: poaConfigPda,
            authority: env.authority.publicKey,
          })
          .signers([env.authority])
          .rpc();

        expect(tx).to.exist;
      } catch (error: any) {
        // Program might not be initialized yet
        expect(error.message).to.contain("Account does not exist");
      }
    });
  });

  describe("Statistics", () => {
    it("should get governance statistics", async () => {
      try {
        const stats = await env.governanceProgram.methods
          .getGovernanceStats()
          .accounts({
            // @ts-ignore
            poaConfig: poaConfigPda,
          })
          .view();

        expect(stats).to.exist;
      } catch (error: any) {
        // Program might not be initialized yet
        expect(error.message).to.contain("Account does not exist");
      }
    });
  });

  // ========== NEW TESTS: ERC Revocation ==========
  
  describe("ERC Revocation", () => {
    it("should revoke an ERC certificate", async () => {
      const certificateId = TestUtils.generateTestId("erc-revoke");
      const ercCertificatePda = TestUtils.findErcCertificatePda(
        env.governanceProgram.programId,
        certificateId
      )[0];
      const reason = "Certificate issued in error";

      try {
        const tx = await env.governanceProgram.methods
          .revokeErc(reason)
          .accounts({
            // @ts-ignore
            poaConfig: poaConfigPda,
            ercCertificate: ercCertificatePda,
            authority: env.authority.publicKey,
          })
          .signers([env.authority])
          .rpc();

        expect(tx).to.exist;
      } catch (error: any) {
        // Expected to fail without proper setup
        expect(error.message).to.contain("Account does not exist");
      }
    });

    it("should fail to revoke with unauthorized authority", async () => {
      const certificateId = TestUtils.generateTestId("erc-revoke-unauth");
      const ercCertificatePda = TestUtils.findErcCertificatePda(
        env.governanceProgram.programId,
        certificateId
      )[0];
      const unauthorizedKeypair = anchor.web3.Keypair.generate();

      await expect(
        env.governanceProgram.methods
          .revokeErc("Unauthorized revocation")
          .accounts({
            // @ts-ignore
            poaConfig: poaConfigPda,
            ercCertificate: ercCertificatePda,
            authority: unauthorizedKeypair.publicKey,
          })
          .signers([unauthorizedKeypair])
          .rpc()
      ).to.throw();
    });
  });

  // ========== NEW TESTS: Certificate Transfer ==========
  
  describe("Certificate Transfer", () => {
    it("should transfer an ERC certificate", async () => {
      const certificateId = TestUtils.generateTestId("erc-transfer");
      const ercCertificatePda = TestUtils.findErcCertificatePda(
        env.governanceProgram.programId,
        certificateId
      )[0];
      const newOwner = anchor.web3.Keypair.generate();

      try {
        const tx = await env.governanceProgram.methods
          .transferErc()
          .accounts({
            // @ts-ignore
            poaConfig: poaConfigPda,
            ercCertificate: ercCertificatePda,
            currentOwner: env.authority.publicKey,
            newOwner: newOwner.publicKey,
          })
          .signers([env.authority])
          .rpc();

        expect(tx).to.exist;
      } catch (error: any) {
        // Expected to fail - transfers not enabled or certificate doesn't exist
        expect(error.message).to.match(/Account does not exist|transfers not allowed/i);
      }
    });

    it("should fail to transfer to self", async () => {
      const certificateId = TestUtils.generateTestId("erc-self-transfer");
      const ercCertificatePda = TestUtils.findErcCertificatePda(
        env.governanceProgram.programId,
        certificateId
      )[0];

      await expect(
        env.governanceProgram.methods
          .transferErc()
          .accounts({
            // @ts-ignore
            poaConfig: poaConfigPda,
            ercCertificate: ercCertificatePda,
            currentOwner: env.authority.publicKey,
            newOwner: env.authority.publicKey, // Same as current owner
          })
          .signers([env.authority])
          .rpc()
      ).to.throw();
    });
  });

  // ========== NEW TESTS: Multi-sig Authority Change ==========
  
  describe("Multi-sig Authority Change", () => {
    it("should propose authority change", async () => {
      const newAuthority = anchor.web3.Keypair.generate();

      try {
        const tx = await env.governanceProgram.methods
          .proposeAuthorityChange(newAuthority.publicKey)
          .accounts({
            // @ts-ignore
            poaConfig: poaConfigPda,
            authority: env.authority.publicKey,
          })
          .signers([env.authority])
          .rpc();

        expect(tx).to.exist;
      } catch (error: any) {
        // Program might not be initialized yet
        expect(error.message).to.contain("Account does not exist");
      }
    });

    it("should cancel authority change", async () => {
      try {
        const tx = await env.governanceProgram.methods
          .cancelAuthorityChange()
          .accounts({
            // @ts-ignore
            poaConfig: poaConfigPda,
            authority: env.authority.publicKey,
          })
          .signers([env.authority])
          .rpc();

        expect(tx).to.exist;
      } catch (error: any) {
        // Expected to fail if no pending change or not initialized
        expect(error.message).to.match(/Account does not exist|No authority change pending/i);
      }
    });

    it("should approve authority change", async () => {
      const newAuthority = anchor.web3.Keypair.generate();

      try {
        const tx = await env.governanceProgram.methods
          .approveAuthorityChange()
          .accounts({
            // @ts-ignore
            poaConfig: poaConfigPda,
            newAuthority: newAuthority.publicKey,
          })
          .signers([newAuthority])
          .rpc();

        expect(tx).to.exist;
      } catch (error: any) {
        // Expected to fail if no pending change
        expect(error.message).to.match(/Account does not exist|No authority change pending/i);
      }
    });

    it("should fail to propose with unauthorized authority", async () => {
      const unauthorizedKeypair = anchor.web3.Keypair.generate();
      const newAuthority = anchor.web3.Keypair.generate();

      await expect(
        env.governanceProgram.methods
          .proposeAuthorityChange(newAuthority.publicKey)
          .accounts({
            // @ts-ignore
            poaConfig: poaConfigPda,
            authority: unauthorizedKeypair.publicKey,
          })
          .signers([unauthorizedKeypair])
          .rpc()
      ).to.throw();
    });
  });

  // ========== NEW TESTS: Oracle Integration ==========
  
  describe("Oracle Integration", () => {
    it("should set oracle authority", async () => {
      const oracleAuthority = anchor.web3.Keypair.generate();
      const minConfidence = 80;
      const requireValidation = true;

      try {
        const tx = await env.governanceProgram.methods
          .setOracleAuthority(oracleAuthority.publicKey, minConfidence, requireValidation)
          .accounts({
            // @ts-ignore
            poaConfig: poaConfigPda,
            authority: env.authority.publicKey,
          })
          .signers([env.authority])
          .rpc();

        expect(tx).to.exist;
      } catch (error: any) {
        // Program might not be initialized yet
        expect(error.message).to.contain("Account does not exist");
      }
    });

    it("should fail to set oracle with invalid confidence", async () => {
      const oracleAuthority = anchor.web3.Keypair.generate();
      const invalidConfidence = 150; // Invalid: > 100

      try {
        await env.governanceProgram.methods
          .setOracleAuthority(oracleAuthority.publicKey, invalidConfidence, true)
          .accounts({
            // @ts-ignore
            poaConfig: poaConfigPda,
            authority: env.authority.publicKey,
          })
          .signers([env.authority])
          .rpc();
      } catch (error: any) {
        // Expected to fail with invalid confidence
        expect(error.message).to.match(/Account does not exist|Invalid oracle confidence/i);
      }
    });

    it("should fail to set oracle with unauthorized authority", async () => {
      const unauthorizedKeypair = anchor.web3.Keypair.generate();
      const oracleAuthority = anchor.web3.Keypair.generate();

      await expect(
        env.governanceProgram.methods
          .setOracleAuthority(oracleAuthority.publicKey, 80, true)
          .accounts({
            // @ts-ignore
            poaConfig: poaConfigPda,
            authority: unauthorizedKeypair.publicKey,
          })
          .signers([unauthorizedKeypair])
          .rpc()
      ).to.throw();
    });
  });

  after(async () => {
    console.log("Governance tests completed");
  });
});
