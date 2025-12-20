import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  TestEnvironment,
  expect
} from "./setup.ts";
import { TestUtils } from "./utils/index.ts";
import { TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";

// Test amounts (in smallest units - lamports)
const TEST_AMOUNTS = {
  ONE_TOKEN: 1_000_000_000,
  TEN_TOKENS: 10_000_000_000,
  SMALL_AMOUNT: 100_000_000, // 0.1 tokens
  MEDIUM_AMOUNT: 1_000_000_000, // 1 token
  LARGE_AMOUNT: 10_000_000_000, // 10 tokens
};

describe("Energy Token Program Tests", () => {
  let env: TestEnvironment;
  let tokenInfoPda: anchor.web3.PublicKey;
  let mintPda: anchor.web3.PublicKey;
  let userTokenAccount: anchor.web3.PublicKey;

  before(async () => {
    env = await TestEnvironment.create();
    console.log("Program ID:", env.energyTokenProgram.programId.toBase58());
    console.log("Connection URL:", env.provider.connection.rpcEndpoint);
    const version = await env.provider.connection.getVersion();
    console.log("Cluster Version:", version);

    // Get PDAs
    [tokenInfoPda] = TestUtils.findTokenInfoPda(env.energyTokenProgram.programId);
    [mintPda] = TestUtils.findMintPda(env.energyTokenProgram.programId);
    console.log("Mint PDA:", mintPda.toBase58());
  });

  beforeEach(async () => {
    // Create user token account if needed
    try {
      userTokenAccount = await TestUtils.createAssociatedTokenAccount(
        env.wallet.publicKey,
        mintPda,
        env.wallet.publicKey,
        env.connection,
        TOKEN_2022_PROGRAM_ID
      );
    } catch (error) {
      // Account might already exist
      userTokenAccount = await anchor.utils.token.associatedAddress({
        mint: mintPda,
        owner: env.wallet.publicKey
      });
    }
  });

  describe("Initialization", () => {
    it("should initialize token program", async () => {
      try {
        const tx = await env.energyTokenProgram.methods
          .initialize()
          .accounts({
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

    it("should initialize token info", async () => {
      try {
        const tx = await env.energyTokenProgram.methods
          .initializeToken()
          .accounts({
            // @ts-ignore
            tokenInfo: tokenInfoPda,
            mint: mintPda,
            authority: env.authority.publicKey,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([env.authority])
          .rpc();

        expect(tx).to.exist;
      } catch (error: any) {
        // Account might already exist
        expect(error.message).to.contain("already in use");
      }
    });
  });

  describe("Token Mint Creation", () => {
    it("should create a token mint with metadata", async () => {
      const mintKeypair = anchor.web3.Keypair.generate();
      const metadataPda = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("metadata"),
          new anchor.web3.PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s").toBuffer(),
          mintKeypair.publicKey.toBuffer(),
        ],
        new anchor.web3.PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s")
      )[0];

      const name = "Grid Renewable Energy Token";
      const symbol = "GRID";
      const uri = "https://gridtokenx.com/metadata";

      const tx = await env.energyTokenProgram.methods
        .createTokenMint(name, symbol, uri)
        .accounts({
          mint: mintKeypair.publicKey,
          metadata: metadataPda,
          payer: env.wallet.publicKey,
          authority: env.authority.publicKey,
          // @ts-ignore
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          metadataProgram: new anchor.web3.PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"),
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          sysvarInstructions: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        })
        .signers([mintKeypair, env.authority])
        .rpc();

      expect(tx).to.exist;
    });
  });

  describe("Token Minting", () => {
    it("should mint tokens to wallet", async () => {
      const mintAmount = TEST_AMOUNTS.ONE_TOKEN;

      const tx = await env.energyTokenProgram.methods
        .mintToWallet(new BN(mintAmount))
        .accounts({
          mint: mintPda,
          // @ts-ignore
          destination: userTokenAccount,
          destinationOwner: env.wallet.publicKey,
          authority: env.authority.publicKey,
          payer: env.wallet.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([env.authority])
        .rpc();

      expect(tx).to.exist;

      // Verify balance
      const balance = await TestUtils.getTokenBalance(env.connection, userTokenAccount);
      expect(balance).to.be.at.least(mintAmount);
    });

    it("should mint various token amounts", async () => {
      const amounts = [
        TEST_AMOUNTS.SMALL_AMOUNT,
        TEST_AMOUNTS.MEDIUM_AMOUNT,
        TEST_AMOUNTS.LARGE_AMOUNT,
      ];

      for (const amount of amounts) {
        const tx = await env.energyTokenProgram.methods
          .mintToWallet(new BN(amount))
          .accounts({
            mint: mintPda,
            // @ts-ignore
            destination: userTokenAccount,
            destinationOwner: env.wallet.publicKey,
            authority: env.authority.publicKey,
            payer: env.wallet.publicKey,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([env.authority])
          .rpc();

        expect(tx).to.exist;
      }
    });

    it("should fail to mint tokens with unauthorized authority", async () => {
      const unauthorizedKeypair = anchor.web3.Keypair.generate();
      const tokenInfo = await env.energyTokenProgram.account.tokenInfo.fetch(tokenInfoPda);
      console.log("TokenInfo Authority:", tokenInfo.authority.toBase58());
      console.log("Unauthorized Authority:", unauthorizedKeypair.publicKey.toBase58());

      try {
        await env.energyTokenProgram.methods
          .mintToWallet(new BN(TEST_AMOUNTS.ONE_TOKEN))
          .accounts({
            mint: mintPda,
            // @ts-ignore
            destination: userTokenAccount,
            destinationOwner: env.wallet.publicKey,
            authority: unauthorizedKeypair.publicKey,
            payer: env.wallet.publicKey,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([unauthorizedKeypair])
          .rpc();
        expect.fail("Should have thrown UnauthorizedAuthority");
      } catch (e: any) {
        // console.log("Caught error:", e);
        // Check if error code matches
        if (e.error && e.error.errorCode) {
          expect(e.error.errorCode.code).to.equal("UnauthorizedAuthority");
        } else {
          // Fallback for different error structures
          expect(JSON.stringify(e)).to.include("UnauthorizedAuthority");
        }
      }
    });
  });

  describe("Token Info Management", () => {
    it("should retrieve token info", async () => {
      try {
        const tokenInfo = await env.energyTokenProgram.account.tokenInfo.fetch(tokenInfoPda);
        expect(tokenInfo).to.exist;
        expect(tokenInfo.authority.toBase58()).to.equal(env.authority.publicKey.toBase58());
      } catch (error: any) {
        // Account might not be initialized yet
        expect(error.message).to.contain("Account does not exist");
      }
    });
  });

  after(async () => {
    console.log("Energy token tests completed");
  });
});
