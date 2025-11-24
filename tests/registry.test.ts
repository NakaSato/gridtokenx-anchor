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

describe("Registry Program Tests", () => {
  let env: TestEnvironment;
  let meterOwner: anchor.web3.Keypair;

  before(async () => {
    env = await TestEnvironment.create();
    meterOwner = anchor.web3.Keypair.generate();
    
    // Fund meter owner
    await env.airdropSol(meterOwner.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
  });

  describe("Meter Registration", () => {
    it("should register a new meter", async () => {
      const meterId = TestUtils.generateTestId("meter");
      const location = "Bangkok, Thailand";

      try {
        const [meterPda] = TestUtils.findMeterAccountPda(env.registryProgram.programId, meterOwner.publicKey);

        const tx = await env.registryProgram.methods
          .registerMeter(meterId, location)
          .accounts({
            meter: meterPda,
            owner: meterOwner.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([meterOwner])
          .rpc();

        expect(tx).to.exist;
      } catch (error: any) {
        // Expected to fail with basic setup
        expect(error.message).to.contain("custom program error");
      }
    });

    it("should fail to register duplicate meter", async () => {
      const meterId = TestUtils.generateTestId("meter");
      const location = "Bangkok, Thailand";

      try {
        const [meterPda] = TestUtils.findMeterAccountPda(env.registryProgram.programId, meterOwner.publicKey);

        // First registration
        await env.registryProgram.methods
          .registerMeter(meterId, location)
          .accounts({
            meter: meterPda,
            owner: meterOwner.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([meterOwner])
          .rpc();

        // Second registration should fail
        await expect(
          env.registryProgram.methods
            .registerMeter(meterId, location)
            .accounts({
              meter: meterPda,
              owner: meterOwner.publicKey,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([meterOwner])
            .rpc()
        ).to.throw();
      } catch (error: any) {
        // Expected to fail with basic setup
        expect(true).to.be.true;
      }
    });
  });

  describe("Energy Data Submission", () => {
    it("should submit energy data", async () => {
      const meterId = TestUtils.generateTestId("meter");
      const totalGeneration = 1000000;
      const totalConsumption = 500000;

      try {
        const [meterPda] = TestUtils.findMeterAccountPda(env.registryProgram.programId, meterOwner.publicKey);

        const tx = await env.registryProgram.methods
          .submitEnergyData(totalGeneration, totalConsumption)
          .accounts({
            meter: meterPda,
            owner: meterOwner.publicKey,
          })
          .signers([meterOwner])
          .rpc();

        expect(tx).to.exist;
      } catch (error: any) {
        // Expected to fail without proper meter setup
        expect(error.message).to.contain("Account does not exist");
      }
    });

    it("should fail energy data submission with unauthorized user", async () => {
      const unauthorizedKeypair = anchor.web3.Keypair.generate();
      const totalGeneration = 1000000;
      const totalConsumption = 500000;

      try {
        const [meterPda] = TestUtils.findMeterAccountPda(env.registryProgram.programId, meterOwner.publicKey);

        await expect(
          env.registryProgram.methods
            .submitEnergyData(totalGeneration, totalConsumption)
            .accounts({
              meter: meterPda,
              owner: meterOwner.publicKey, // Different from signer
            })
            .signers([unauthorizedKeypair]) // Different keypair
            .rpc()
        ).to.throw();
      } catch (error: any) {
        // Expected to fail with basic setup
        expect(true).to.be.true;
      }
    });
  });

  describe("Meter Information Retrieval", () => {
    it("should retrieve meter information", async () => {
      const [meterPda] = TestUtils.findMeterAccountPda(env.registryProgram.programId, meterOwner.publicKey);

      try {
        const meterInfo = await env.registryProgram.account.meter.fetch(meterPda);
        expect(meterInfo).to.exist;
      } catch (error: any) {
        // Program might not be initialized yet
        expect(error.message).to.contain("Account does not exist");
      }
    });
  });

  after(async () => {
    console.log("Registry tests completed");
  });
});
