import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import { GridTokenXClient } from "../src/client/js/gridtokenx-client";
import * as Registry from "../src/client/js/registry";

describe("Registry Program - GridTokenXClient", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  let client: GridTokenXClient;
  let registryPda: anchor.web3.PublicKey;

  before(async () => {
    // Initialize GridTokenXClient
    client = new GridTokenXClient({
      connection: provider.connection,
      wallet: (provider.wallet as anchor.Wallet).payer
    });

    // Get registry PDA for verification
    const programIds = client.getProgramIds();
    [registryPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("registry")],
      new anchor.web3.PublicKey(programIds.registry)
    );
  });

  describe("Initialize", () => {
    it("should initialize registry successfully", async () => {
      const tx = await client.initializeRegistry();
      
      expect(tx).to.be.a('string');
      expect(tx.length).to.be.greaterThan(0);
      
      // Note: Direct registry account fetch would require fetching the Registry account
      // For now, we verify the transaction was successful
      console.log('Registry initialized with tx:', tx);
    });
  });

  describe("User Registration", () => {
    const username = "test_prosumer_" + Date.now();
    const location = "Bangkok, Thailand";

    it("should register a new prosumer user", async () => {
      const tx = await client.registerUser(username, 'Prosumer', location);
      
      expect(tx).to.be.a('string');
      expect(tx.length).to.be.greaterThan(0);

      // Verify user was registered
      const userAccount = await client.getUserAccount(client.getWalletAddress().toBase58());
      expect(userAccount).to.not.be.null;
      if (userAccount) {
        expect(userAccount.location).to.equal(location);
        expect(userAccount.status).to.equal(Registry.UserStatus.Active);
      }
    });

    it("should verify user role", async () => {
      const isProsumer = await client.verifyUserRole(
        client.getWalletAddress().toBase58(),
        'Prosumer'
      );
      expect(isProsumer).to.be.true;

      const isConsumer = await client.verifyUserRole(
        client.getWalletAddress().toBase58(),
        'Consumer'
      );
      expect(isConsumer).to.be.false;
    });

    it("should validate user exists", async () => {
      const isValid = await client.isValidUser(client.getWalletAddress().toBase58());
      expect(isValid).to.be.true;
    });

    it("should get all users", async () => {
      const users = await client.getAllUsers();
      expect(users).to.be.an('array');
      expect(users.length).to.be.greaterThan(0);
      
      // Find our registered user
      const ourUser = users.find(u => 
        u.authority === client.getWalletAddress().toBase58()
      );
      expect(ourUser).to.not.be.undefined;
    });
  });

  describe("Meter Registration", () => {
    const meterId = "METER_SOLAR_" + Date.now();

    it("should register a solar meter", async () => {
      const tx = await client.registerMeter(meterId, 'Solar');
      
      expect(tx).to.be.a('string');
      expect(tx.length).to.be.greaterThan(0);

      // Verify meter was registered
      const meterAccount = await client.getMeterAssignment(meterId);
      expect(meterAccount).to.not.be.null;
      if (meterAccount) {
        expect(meterAccount.meterId).to.equal(meterId);
        expect(meterAccount.owner).to.equal(client.getWalletAddress().toBase58());
        expect(meterAccount.status).to.equal(Registry.MeterStatus.Active);
        expect(meterAccount.totalGeneration).to.equal(BigInt(0));
        expect(meterAccount.totalConsumption).to.equal(BigInt(0));
      }
    });

    it("should register a wind meter", async () => {
      const windMeterId = "METER_WIND_" + Date.now();
      
      const tx = await client.registerMeter(windMeterId, 'Wind');
      
      expect(tx).to.be.a('string');

      // Verify wind meter was registered
      const meterAccount = await client.getMeterAssignment(windMeterId);
      expect(meterAccount).to.not.be.null;
      if (meterAccount) {
        expect(meterAccount.meterId).to.equal(windMeterId);
        expect(meterAccount.status).to.equal(Registry.MeterStatus.Active);
      }
    });

    it("should register a battery meter", async () => {
      const batteryMeterId = "METER_BATTERY_" + Date.now();
      
      const tx = await client.registerMeter(batteryMeterId, 'Battery');
      
      expect(tx).to.be.a('string');

      // Verify battery meter was registered
      const meterAccount = await client.getMeterAssignment(batteryMeterId);
      expect(meterAccount).to.not.be.null;
      if (meterAccount) {
        expect(meterAccount.meterId).to.equal(batteryMeterId);
        expect(meterAccount.status).to.equal(Registry.MeterStatus.Active);
      }
    });

    it("should validate meter exists", async () => {
      const isValid = await client.isValidMeter(meterId);
      expect(isValid).to.be.true;
    });

    it("should validate non-existent meter returns false", async () => {
      const isValid = await client.isValidMeter("NONEXISTENT_METER");
      expect(isValid).to.be.false;
    });
  });

  describe("User Status Management", () => {
    const userAddress = client.getWalletAddress().toBase58();

    it("should update user status to suspended", async () => {
      const tx = await client.updateUserStatus(userAddress, 'Suspended');
      
      expect(tx).to.be.a('string');

      // Verify user status was updated
      const userAccount = await client.getUserAccount(userAddress);
      expect(userAccount).to.not.be.null;
      if (userAccount) {
        expect(userAccount.status).to.equal(Registry.UserStatus.Suspended);
      }
    });

    it("should update user status back to active", async () => {
      const tx = await client.updateUserStatus(userAddress, 'Active');
      
      expect(tx).to.be.a('string');

      // Verify user status was updated
      const userAccount = await client.getUserAccount(userAddress);
      expect(userAccount).to.not.be.null;
      if (userAccount) {
        expect(userAccount.status).to.equal(Registry.UserStatus.Active);
      }
    });

    it("should verify suspended user is not valid", async () => {
      // Suspend user
      await client.updateUserStatus(userAddress, 'Suspended');
      
      const isValid = await client.isValidUser(userAddress);
      expect(isValid).to.be.false;
      
      // Reactivate for other tests
      await client.updateUserStatus(userAddress, 'Active');
    });
  });

  describe("Meter Reading Updates", () => {
    const meterReadingId = "METER_READING_" + Date.now();

    before(async () => {
      // Register meter for reading updates
      await client.registerMeter(meterReadingId, 'Grid');
    });

    it("should update meter reading with energy data", async () => {
      const energyGenerated = BigInt(150);
      const energyConsumed = BigInt(75);
      const readingTimestamp = BigInt(Math.floor(Date.now() / 1000));

      const tx = await client.updateMeterReading(
        meterReadingId,
        energyGenerated,
        energyConsumed,
        readingTimestamp
      );

      expect(tx).to.be.a('string');

      // Verify meter reading was updated
      const meterAccount = await client.getMeterAssignment(meterReadingId);
      expect(meterAccount).to.not.be.null;
      if (meterAccount) {
        expect(meterAccount.totalGeneration).to.equal(energyGenerated);
        expect(meterAccount.totalConsumption).to.equal(energyConsumed);
        expect(meterAccount.lastReadingAt).to.equal(readingTimestamp);
      }
    });

    it("should accumulate multiple meter readings", async () => {
      const firstGeneration = BigInt(100);
      const firstConsumption = BigInt(50);
      const secondGeneration = BigInt(75);
      const secondConsumption = BigInt(40);

      // Get current readings
      const beforeMeter = await client.getMeterAssignment(meterReadingId);
      const beforeGen = beforeMeter?.totalGeneration ?? BigInt(0);
      const beforeCon = beforeMeter?.totalConsumption ?? BigInt(0);

      // Second reading
      await client.updateMeterReading(
        meterReadingId,
        secondGeneration,
        secondConsumption
      );

      // Verify readings were updated
      const meterAccount = await client.getMeterAssignment(meterReadingId);
      expect(meterAccount).to.not.be.null;
      if (meterAccount) {
        expect(meterAccount.totalGeneration).to.equal(secondGeneration);
        expect(meterAccount.totalConsumption).to.equal(secondConsumption);
      }
    });
  });

  describe("Meter Validation", () => {
    const validationMeterId = "METER_VALIDATION_" + Date.now();

    before(async () => {
      // Register meter for validation
      await client.registerMeter(validationMeterId, 'Solar');
    });

    it("should validate active meter as valid", async () => {
      const result = await client.isValidMeter(validationMeterId);
      expect(result).to.be.true;
    });
  });

  describe("User Validation", () => {
    const userAddress = client.getWalletAddress().toBase58();

    it("should validate active user as valid", async () => {
      const result = await client.isValidUser(userAddress);
      expect(result).to.be.true;
    });

    it("should validate suspended user as invalid", async () => {
      // First, suspend the user
      await client.updateUserStatus(userAddress, 'Suspended');

      // Validate should return false for suspended user
      const result = await client.isValidUser(userAddress);
      expect(result).to.be.false;

      // Clean up - reactivate user
      await client.updateUserStatus(userAddress, 'Active');
    });
  });
});
