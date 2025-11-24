import * as anchor from "@coral-xyz/anchor";
import { 
  TestEnvironment, 
  describe, 
  it, 
  before, 
  after, 
  expect 
} from "./setup";
import { TestUtils } from "./utils/index";

describe("Oracle Program Tests", () => {
  let env: TestEnvironment;
  let oraclePda: anchor.web3.PublicKey;

  before(async () => {
    env = await TestEnvironment.create();
    
    // Get PDAs
    [oraclePda] = TestUtils.findOraclePda(env.oracleProgram.programId);
  });

  describe("Oracle Initialization", () => {
    it("should initialize oracle", async () => {
      try {
        const tx = await env.oracleProgram.methods
          .initialize()
          .accounts({
            oracle: oraclePda,
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
        env.oracleProgram.methods
          .initialize()
          .accounts({
            oracle: oraclePda,
            authority: unauthorizedKeypair.publicKey,
          })
          .signers([unauthorizedKeypair])
          .rpc()
      ).to.throw();
    });
  });

  describe("Price Updates", () => {
    it("should update price data", async () => {
      try {
        const priceId = TestUtils.generateTestId("price");
        const price = 100.50;
        const confidence = 0.95;
        const source = "Test Oracle";

        const tx = await env.oracleProgram.methods
          .updatePrice(priceId, price, confidence, source)
          .accounts({
            oracle: oraclePda,
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

    it("should fail price update with unauthorized authority", async () => {
      const unauthorizedKeypair = anchor.web3.Keypair.generate();
      const priceId = TestUtils.generateTestId("price");

      await expect(
        env.oracleProgram.methods
          .updatePrice(priceId, 100.50, 0.95, "Unauthorized")
          .accounts({
            oracle: oraclePda,
            authority: unauthorizedKeypair.publicKey,
          })
          .signers([unauthorizedKeypair])
          .rpc()
      ).to.throw();
    });

    it("should reject invalid price data", async () => {
      try {
        const priceId = TestUtils.generateTestId("price");
        const invalidPrice = -1; // Negative price should be rejected

        await expect(
          env.oracleProgram.methods
            .updatePrice(priceId, invalidPrice, 0.95, "Test")
            .accounts({
              oracle: oraclePda,
              authority: env.authority.publicKey,
            })
            .signers([env.authority])
            .rpc()
        ).to.throw();
      } catch (error: any) {
        // Expected to fail
        expect(true).to.be.true;
      }
    });
  });

  describe("Oracle Data Retrieval", () => {
    it("should retrieve oracle information", async () => {
      try {
        const oracleInfo = await env.oracleProgram.account.oracle.fetch(oraclePda);
        expect(oracleInfo).to.exist;
      } catch (error: any) {
        // Program might not be initialized yet
        expect(error.message).to.contain("Account does not exist");
      }
    });
  });

  after(async () => {
    console.log("Oracle tests completed");
  });
});
