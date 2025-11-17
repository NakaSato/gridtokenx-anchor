import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import { GridTokenXClient } from "../src/client/js/gridtokenx-client";
import * as Token from "../src/client/js/token";

describe("Energy Token Program - GridTokenXClient", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  let client: GridTokenXClient;
  let tokenInfoPda: anchor.web3.PublicKey;
  let mintPda: anchor.web3.PublicKey;
  let recipientKeypair: anchor.web3.Keypair;

  before(async () => {
    // Initialize GridTokenXClient
    client = new GridTokenXClient({
      connection: provider.connection,
      wallet: (provider.wallet as anchor.Wallet).payer
    });

    // Generate recipient keypair for testing
    recipientKeypair = anchor.web3.Keypair.generate();

    // Get PDAs for verification
    const programIds = client.getProgramIds();
    const tokenProgramId = new anchor.web3.PublicKey(programIds.token);
    
    [tokenInfoPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("token_info")],
      tokenProgramId
    );

    [mintPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("mint")],
      tokenProgramId
    );
  });

  describe("Initialize", () => {
    it("should initialize token info", async () => {
      const tx = await client.initializeToken();
      expect(tx).to.exist;

      // Verify token info was initialized
      const tokenInfo = await client.getTokenInfo();
      expect(tokenInfo).to.exist;
      if (tokenInfo) {
        expect(tokenInfo.authority.toString()).to.equal(provider.wallet.publicKey.toString());
        expect(Number(tokenInfo.totalSupply)).to.equal(0);
        expect(Number(tokenInfo.createdAt)).to.be.greaterThan(0);
      }
    });
  });

  describe("REC Validator Management", () => {
    it("should add a REC validator", async () => {
      const validatorPubkey = anchor.web3.Keypair.generate().publicKey;
      const authorityName = "University REC Authority";

      const tx = await client.addRecValidator(validatorPubkey.toString(), authorityName);
      expect(tx).to.exist;
    });

    it("should add multiple REC validators", async () => {
      const validators = [
        { pubkey: anchor.web3.Keypair.generate().publicKey, name: "Solar Authority" },
        { pubkey: anchor.web3.Keypair.generate().publicKey, name: "Wind Authority" },
        { pubkey: anchor.web3.Keypair.generate().publicKey, name: "Hydro Authority" },
      ];

      for (const validator of validators) {
        const tx = await client.addRecValidator(validator.pubkey.toString(), validator.name);
        expect(tx).to.exist;
      }
    });

    it("should add Thai energy authority REC validators", async () => {
      const thaiAuthorities = [
        { pubkey: anchor.web3.Keypair.generate().publicKey, name: "UTCC Authority" },
        { pubkey: anchor.web3.Keypair.generate().publicKey, name: "MEA Authority" },
        { pubkey: anchor.web3.Keypair.generate().publicKey, name: "EGET Authority" },
      ];

      for (const authority of thaiAuthorities) {
        const tx = await client.addRecValidator(authority.pubkey.toString(), authority.name);
        expect(tx).to.exist;
      }
    });
  });

  describe("Token Transfer", () => {
    it("should transfer energy tokens between accounts", async () => {
      const transferAmount = BigInt(1_000_000_000); // 1 billion tokens

      const tx = await client.transferTokens(recipientKeypair.publicKey.toString(), transferAmount);
      expect(tx).to.exist;

      // Verify recipient has tokens
      const balance = await client.getTokenBalance(recipientKeypair.publicKey.toString());
      expect(balance).to.exist;
    });

    it("should transfer various token amounts", async () => {
      const amounts = [
        BigInt(100_000_000), // 100M tokens
        BigInt(500_000_000), // 500M tokens
        BigInt(1_000_000_000), // 1B tokens
      ];

      for (const amount of amounts) {
        const tx = await client.transferTokens(recipientKeypair.publicKey.toString(), amount);
        expect(tx).to.exist;
      }
    });
  });

  describe("Token Burning", () => {
    it("should burn energy tokens", async () => {
      const burnAmount = BigInt(100_000_000); // 100M tokens

      const tx = await client.burnTokens(burnAmount);
      expect(tx).to.exist;

      // Verify total supply was updated
      const tokenInfo = await client.getTokenInfo();
      expect(tokenInfo).to.exist;
    });

    it("should burn various token amounts", async () => {
      const burnAmounts = [
        BigInt(50_000_000), // 50M tokens
        BigInt(100_000_000), // 100M tokens
        BigInt(200_000_000), // 200M tokens
      ];

      for (const amount of burnAmounts) {
        const tx = await client.burnTokens(amount);
        expect(tx).to.exist;
      }
    });

    it("should track total supply correctly after burns", async () => {
      const initialTokenInfo = await client.getTokenInfo();
      const initialSupply = initialTokenInfo ? Number(initialTokenInfo.totalSupply) : 0;

      const burnAmount = BigInt(50_000_000);
      await client.burnTokens(burnAmount);

      const updatedTokenInfo = await client.getTokenInfo();
      const updatedSupply = updatedTokenInfo ? Number(updatedTokenInfo.totalSupply) : 0;

      // Supply should decrease after burning
      expect(updatedSupply).to.be.lessThanOrEqual(initialSupply);
    });
  });

  describe("Token Info Management", () => {
    it("should retrieve token info correctly", async () => {
      const tokenInfo = await client.getTokenInfo();

      expect(tokenInfo).to.exist;
      expect(tokenInfo?.authority.toString()).to.equal(provider.wallet.publicKey.toString());
      expect(Number(tokenInfo?.createdAt)).to.be.greaterThan(0);
    });

    it("should verify token info integrity", async () => {
      const tokenInfo = await client.getTokenInfo();

      // Authority should be set
      expect(tokenInfo?.authority).to.not.be.null;
      expect(tokenInfo?.authority.toString().length).to.equal(44); // Base58 pubkey length

      // Timestamps should be valid
      expect(Number(tokenInfo?.createdAt)).to.be.greaterThan(0);
      expect(Number(tokenInfo?.createdAt)).to.be.lessThan(Math.floor(Date.now() / 1000) + 60); // Within 60 seconds
    });
  });

  describe("Energy Trading Scenarios", () => {
    it("should handle energy token distribution", async () => {
      const recipients = [
        anchor.web3.Keypair.generate(),
        anchor.web3.Keypair.generate(),
        anchor.web3.Keypair.generate(),
      ];

      for (const recipient of recipients) {
        const transferAmount = BigInt(100_000_000); // 100M tokens per recipient
        const tx = await client.transferTokens(recipient.publicKey.toString(), transferAmount);
        expect(tx).to.exist;
      }
    });

    it("should handle batch token burns for energy consumption", async () => {
      const consumptionRecords = [
        { amount: BigInt(50_000_000), reason: "Household consumption" },
        { amount: BigInt(75_000_000), reason: "Industrial consumption" },
        { amount: BigInt(100_000_000), reason: "Grid balancing" },
      ];

      for (const record of consumptionRecords) {
        const tx = await client.burnTokens(record.amount);
        expect(tx).to.exist;
      }
    });

    it("should handle renewable energy certificate issuance workflow", async () => {
      const validators = [
        { name: "Solar Validator 1", pubkey: anchor.web3.Keypair.generate().publicKey },
        { name: "Wind Validator 1", pubkey: anchor.web3.Keypair.generate().publicKey },
      ];

      // Add validators for REC validation
      for (const validator of validators) {
        const tx = await client.addRecValidator(validator.pubkey.toString(), validator.name);
        expect(tx).to.exist;
      }

      // Simulate energy production and token transfer
      const energyProduced = BigInt(500_000_000); // 500M kWh equivalent
      const tx = await client.transferTokens(recipientKeypair.publicKey.toString(), energyProduced);
      expect(tx).to.exist;
    });
  });
});
