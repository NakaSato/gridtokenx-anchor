import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { TestEnvironment, expect } from "./setup.ts";
import { TestUtils } from "./utils/index.ts";
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

/**
 * Smart Meter Token Minting Test
 *
 * This test simulates the complete flow of smart meter data submission
 * and token minting on the Solana blockchain.
 *
 * Flow:
 * 1. Smart meter reading is submitted (simulated)
 * 2. Energy amount (kWh) is converted to token amount
 * 3. Tokens are minted to user's wallet using mint_tokens_direct
 * 4. Balance is verified on-chain
 */

// Constants for energy to token conversion
const KWH_TO_TOKEN_RATIO = 1.0; // 1 kWh = 1 token
const TOKEN_DECIMALS = 9; // 9 decimals for token precision

// Helper function to convert kWh to token amount (with decimals)
function kwhToTokens(kwh: number): number {
  return Math.floor(kwh * KWH_TO_TOKEN_RATIO * Math.pow(10, TOKEN_DECIMALS));
}

describe("Smart Meter Token Minting Tests", () => {
  let env: TestEnvironment;
  let tokenInfoPda: anchor.web3.PublicKey;
  let mintPda: anchor.web3.PublicKey;
  let userWallet: anchor.web3.Keypair;
  let userTokenAccount: anchor.web3.PublicKey;

  before(async () => {
    env = await TestEnvironment.create();
    console.log("Program ID:", env.energyTokenProgram.programId.toBase58());
    console.log("Connection URL:", env.provider.connection.rpcEndpoint);

    // Get PDAs
    [tokenInfoPda] = TestUtils.findTokenInfoPda(
      env.energyTokenProgram.programId
    );
    [mintPda] = TestUtils.findMintPda(env.energyTokenProgram.programId);
    console.log("Token Info PDA:", tokenInfoPda.toBase58());
    console.log("Mint PDA:", mintPda.toBase58());

    // Create a user wallet to simulate a smart meter owner
    userWallet = anchor.web3.Keypair.generate();
    await env.airdropSol(
      userWallet.publicKey,
      5 * anchor.web3.LAMPORTS_PER_SOL
    );
    console.log("User Wallet:", userWallet.publicKey.toBase58());

    // Initialize token program if not already initialized
    try {
      await env.energyTokenProgram.methods
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
      console.log("Token program initialized");
    } catch (error: any) {
      // Already initialized
      console.log("Token program already initialized");
    }

    // Create user token account
    try {
      userTokenAccount = await TestUtils.createAssociatedTokenAccount(
        userWallet.publicKey,
        mintPda,
        userWallet.publicKey,
        env.connection,
        TOKEN_2022_PROGRAM_ID
      );
      console.log("User Token Account:", userTokenAccount.toBase58());
    } catch (error) {
      // Account might already exist
      userTokenAccount = await anchor.utils.token.associatedAddress({
        mint: mintPda,
        owner: userWallet.publicKey,
      });
      console.log(
        "User Token Account (existing):",
        userTokenAccount.toBase58()
      );
    }
  });

  describe("Single Meter Reading Minting", () => {
    it("should mint tokens from a 10.5 kWh meter reading", async () => {
      // Simulate smart meter reading
      const kwhReading = 10.5;
      const expectedTokenAmount = kwhToTokens(kwhReading);

      console.log(`Simulating meter reading: ${kwhReading} kWh`);
      console.log(
        `Expected token amount: ${expectedTokenAmount} (${kwhReading} tokens with ${TOKEN_DECIMALS} decimals)`
      );

      // Get initial balance
      const initialBalance = await TestUtils.getTokenBalance(
        env.connection,
        userTokenAccount
      );
      console.log(`Initial balance: ${initialBalance}`);

      // Mint tokens using mint_tokens_direct (simulating API gateway call)
      const tx = await env.energyTokenProgram.methods
        .mintTokensDirect(new BN(expectedTokenAmount))
        .accounts({
          tokenInfo: tokenInfoPda,
          mint: mintPda,
          userTokenAccount: userTokenAccount,
          authority: env.authority.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([env.authority])
        .rpc();

      expect(tx).to.exist;
      console.log(`Mint transaction: ${tx}`);

      // Verify balance increased
      const finalBalance = await TestUtils.getTokenBalance(
        env.connection,
        userTokenAccount
      );
      console.log(`Final balance: ${finalBalance}`);

      const balanceIncrease = finalBalance - initialBalance;
      expect(balanceIncrease).to.equal(expectedTokenAmount);

      console.log(`✅ Successfully minted ${kwhReading} kWh worth of tokens`);
    });

    it("should mint tokens from a 25.0 kWh meter reading", async () => {
      const kwhReading = 25.0;
      const expectedTokenAmount = kwhToTokens(kwhReading);

      const initialBalance = await TestUtils.getTokenBalance(
        env.connection,
        userTokenAccount
      );

      await env.energyTokenProgram.methods
        .mintTokensDirect(new BN(expectedTokenAmount))
        .accounts({
          tokenInfo: tokenInfoPda,
          mint: mintPda,
          userTokenAccount: userTokenAccount,
          authority: env.authority.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([env.authority])
        .rpc();

      const finalBalance = await TestUtils.getTokenBalance(
        env.connection,
        userTokenAccount
      );
      const balanceIncrease = finalBalance - initialBalance;

      expect(balanceIncrease).to.equal(expectedTokenAmount);
      console.log(`✅ Successfully minted ${kwhReading} kWh worth of tokens`);
    });
  });

  describe("Multiple Meter Readings Minting", () => {
    it("should mint tokens from multiple meter readings in sequence", async () => {
      // Simulate multiple meter readings over time
      const readings = [5.0, 7.5, 12.0, 3.5]; // kWh readings
      const initialBalance = await TestUtils.getTokenBalance(
        env.connection,
        userTokenAccount
      );

      let totalExpectedTokens = 0;

      for (const kwhReading of readings) {
        const tokenAmount = kwhToTokens(kwhReading);
        totalExpectedTokens += tokenAmount;

        console.log(
          `Processing reading: ${kwhReading} kWh -> ${tokenAmount} tokens`
        );

        await env.energyTokenProgram.methods
          .mintTokensDirect(new BN(tokenAmount))
          .accounts({
            tokenInfo: tokenInfoPda,
            mint: mintPda,
            userTokenAccount: userTokenAccount,
            authority: env.authority.publicKey,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([env.authority])
          .rpc();
      }

      const finalBalance = await TestUtils.getTokenBalance(
        env.connection,
        userTokenAccount
      );
      const balanceIncrease = finalBalance - initialBalance;

      expect(balanceIncrease).to.equal(totalExpectedTokens);
      console.log(
        `✅ Successfully minted tokens from ${readings.length} meter readings`
      );
      console.log(`Total kWh: ${readings.reduce((a, b) => a + b, 0)}`);
    });
  });

  describe("Authorization and Security", () => {
    it("should fail to mint tokens with unauthorized authority", async () => {
      const unauthorizedKeypair = anchor.web3.Keypair.generate();
      await env.airdropSol(
        unauthorizedKeypair.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );

      const kwhReading = 10.0;
      const tokenAmount = kwhToTokens(kwhReading);

      try {
        await env.energyTokenProgram.methods
          .mintTokensDirect(new BN(tokenAmount))
          .accounts({
            tokenInfo: tokenInfoPda,
            mint: mintPda,
            userTokenAccount: userTokenAccount,
            authority: unauthorizedKeypair.publicKey,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([unauthorizedKeypair])
          .rpc();

        expect.fail("Should have thrown UnauthorizedAuthority error");
      } catch (e: any) {
        // Verify error is UnauthorizedAuthority
        if (e.error && e.error.errorCode) {
          expect(e.error.errorCode.code).to.equal("UnauthorizedAuthority");
        } else {
          expect(JSON.stringify(e)).to.contain("UnauthorizedAuthority");
        }
        console.log("✅ Unauthorized minting correctly rejected");
      }
    });
  });

  describe("Balance Verification", () => {
    it("should correctly calculate token balance after multiple operations", async () => {
      // Create a new user for clean balance testing
      const testUser = anchor.web3.Keypair.generate();
      await env.airdropSol(
        testUser.publicKey,
        5 * anchor.web3.LAMPORTS_PER_SOL
      );

      const testUserTokenAccount = await TestUtils.createAssociatedTokenAccount(
        testUser.publicKey,
        mintPda,
        testUser.publicKey,
        env.connection,
        TOKEN_2022_PROGRAM_ID
      );

      // Mint specific amounts
      const readings = [10.0, 20.0, 15.5];
      let expectedTotal = 0;

      for (const kwh of readings) {
        const tokenAmount = kwhToTokens(kwh);
        expectedTotal += tokenAmount;

        await env.energyTokenProgram.methods
          .mintTokensDirect(new BN(tokenAmount))
          .accounts({
            tokenInfo: tokenInfoPda,
            mint: mintPda,
            userTokenAccount: testUserTokenAccount,
            authority: env.authority.publicKey,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([env.authority])
          .rpc();
      }

      const finalBalance = await TestUtils.getTokenBalance(
        env.connection,
        testUserTokenAccount
      );
      expect(finalBalance).to.equal(expectedTotal);

      const totalKwh = readings.reduce((a, b) => a + b, 0);
      console.log(
        `✅ Balance verification passed: ${totalKwh} kWh = ${finalBalance} tokens`
      );
    });
  });

  describe("Edge Cases", () => {
    it("should handle small meter readings (0.1 kWh)", async () => {
      const kwhReading = 0.1;
      const tokenAmount = kwhToTokens(kwhReading);

      const initialBalance = await TestUtils.getTokenBalance(
        env.connection,
        userTokenAccount
      );

      await env.energyTokenProgram.methods
        .mintTokensDirect(new BN(tokenAmount))
        .accounts({
          tokenInfo: tokenInfoPda,
          mint: mintPda,
          userTokenAccount: userTokenAccount,
          authority: env.authority.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([env.authority])
        .rpc();

      const finalBalance = await TestUtils.getTokenBalance(
        env.connection,
        userTokenAccount
      );
      const balanceIncrease = finalBalance - initialBalance;

      expect(balanceIncrease).to.equal(tokenAmount);
      console.log(
        `✅ Small reading handled: ${kwhReading} kWh = ${tokenAmount} tokens`
      );
    });

    it("should handle large meter readings (100.0 kWh)", async () => {
      const kwhReading = 100.0;
      const tokenAmount = kwhToTokens(kwhReading);

      const initialBalance = await TestUtils.getTokenBalance(
        env.connection,
        userTokenAccount
      );

      await env.energyTokenProgram.methods
        .mintTokensDirect(new BN(tokenAmount))
        .accounts({
          tokenInfo: tokenInfoPda,
          mint: mintPda,
          userTokenAccount: userTokenAccount,
          authority: env.authority.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([env.authority])
        .rpc();

      const finalBalance = await TestUtils.getTokenBalance(
        env.connection,
        userTokenAccount
      );
      const balanceIncrease = finalBalance - initialBalance;

      expect(balanceIncrease).to.equal(tokenAmount);
      console.log(
        `✅ Large reading handled: ${kwhReading} kWh = ${tokenAmount} tokens`
      );
    });
  });

  after(async () => {
    console.log("\n📊 Test Summary:");
    console.log("Smart meter token minting tests completed successfully");
    console.log(`User wallet: ${userWallet.publicKey.toBase58()}`);

    const finalBalance = await TestUtils.getTokenBalance(
      env.connection,
      userTokenAccount
    );
    const tokensInHumanReadable = finalBalance / Math.pow(10, TOKEN_DECIMALS);
    console.log(
      `Final token balance: ${tokensInHumanReadable} tokens (${finalBalance} raw)`
    );
  });
});
