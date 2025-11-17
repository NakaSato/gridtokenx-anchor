import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import { GridTokenXClient } from "../src/client/js/gridtokenx-client";
import * as Oracle from "../src/client/js/oracle";

describe("Oracle Program - GridTokenXClient", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  let client: GridTokenXClient;
  let oracleDataPda: anchor.web3.PublicKey;

  before(async () => {
    // Initialize GridTokenXClient
    client = new GridTokenXClient({
      connection: provider.connection,
      wallet: (provider.wallet as anchor.Wallet).payer
    });

    // Get oracle data PDA for verification
    const programIds = client.getProgramIds();
    [oracleDataPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("oracle_data")],
      new anchor.web3.PublicKey(programIds.oracle)
    );
  });

  describe("Initialize", () => {
    it("should initialize oracle data successfully", async () => {
      const apiGateway = anchor.web3.Keypair.generate().publicKey.toString();

      const tx = await client.initializeOracle(apiGateway);

      // Verify oracle data was initialized
      const oracleData = await client.getOracleData();
      expect(oracleData).to.not.be.null;
      expect(oracleData!.authority.toString()).to.equal(provider.wallet.publicKey.toString());
      expect(oracleData!.apiGateway.toString()).to.equal(apiGateway);
      expect(oracleData!.totalReadings).to.equal(0n);
      expect(oracleData!.active).to.be.true;
      expect(Number(oracleData!.createdAt)).to.be.greaterThan(0);
    });
  });

  describe("Meter Reading Submission", () => {
    it("should submit meter reading successfully", async () => {
      const meterId = "METER_001";
      const energyProduced = BigInt(100);
      const energyConsumed = BigInt(50);
      const readingTimestamp = BigInt(Math.floor(Date.now() / 1000));

      // Submit meter reading
      const tx = await client.submitPrice(
        meterId,
        energyProduced,
        energyConsumed,
        readingTimestamp
      );

      expect(tx).to.exist;

      // Verify meter reading was submitted
      const oracleData = await client.getOracleData();
      expect(oracleData).to.not.be.null;
      expect(Number(oracleData!.totalReadings)).to.be.greaterThan(0);
      expect(oracleData!.lastReadingTimestamp).to.equal(readingTimestamp);
    });

    it("should submit meter reading with auto-timestamp", async () => {
      const meterId = "METER_002";
      const energyProduced = BigInt(150);
      const energyConsumed = BigInt(75);

      // Get oracle data before
      const beforeData = await client.getOracleData();
      const beforeReadings = beforeData!.totalReadings;

      // Submit meter reading without timestamp (uses current time)
      const tx = await client.submitPrice(meterId, energyProduced, energyConsumed);

      expect(tx).to.exist;

      // Verify reading count increased
      const afterData = await client.getOracleData();
      expect(afterData!.totalReadings).to.equal(beforeReadings + 1n);
    });

    it("should handle meter reading with empty meter ID", async () => {
      // The oracle doesn't validate meter existence
      const invalidMeterId = "";
      const energyProduced = BigInt(100);
      const energyConsumed = BigInt(50);

      const tx = await client.submitPrice(invalidMeterId, energyProduced, energyConsumed);
      expect(tx).to.exist;
    });

    it("should accept duplicate meter readings", async () => {
      const meterId = "METER_DUPLICATE";
      const energyProduced = BigInt(100);
      const energyConsumed = BigInt(50);
      const readingTimestamp = BigInt(Math.floor(Date.now() / 1000));

      // Get initial reading count
      const initialData = await client.getOracleData();
      const initialReadings = initialData!.totalReadings;

      // Submit same reading twice
      await client.submitPrice(meterId, energyProduced, energyConsumed, readingTimestamp);
      await client.submitPrice(meterId, energyProduced, energyConsumed, readingTimestamp);

      // Verify both readings were recorded
      const finalData = await client.getOracleData();
      expect(finalData!.totalReadings).to.equal(initialReadings + 2n);
    });
  });

  describe("Market Clearing", () => {
    it("should trigger market clearing successfully", async () => {
      const tx = await client.triggerMarketClearing();

      expect(tx).to.exist;

      // Verify market clearing was triggered
      const oracleData = await client.getOracleData();
      expect(oracleData).to.not.be.null;
      expect(Number(oracleData!.lastClearing)).to.be.greaterThan(0);
    });
  });

  describe("Oracle Status Management", () => {
    it("should update oracle status by authority", async () => {
      // Pause the oracle
      const pauseTx = await client.updatePrice('Paused');
      expect(pauseTx).to.exist;

      let oracleData = await client.getOracleData();
      expect(oracleData!.active).to.be.false;

      // Reactivate the oracle
      const activateTx = await client.updatePrice('Active');
      expect(activateTx).to.exist;

      oracleData = await client.getOracleData();
      expect(oracleData!.active).to.be.true;
    });
  });

  describe("API Gateway Management", () => {
    it("should update API Gateway address by authority", async () => {
      const newApiGateway = anchor.web3.Keypair.generate().publicKey.toString();

      const tx = await client.updateApiGateway(newApiGateway);
      expect(tx).to.exist;

      const oracleData = await client.getOracleData();
      expect(oracleData!.apiGateway.toString()).to.equal(newApiGateway);
    });
  });
});
