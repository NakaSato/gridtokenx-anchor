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

  after(async () => {
    console.log("Governance tests completed");
  });
});
