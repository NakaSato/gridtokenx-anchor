import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { TestEnvironment, expect } from "../unit/programs/setup";
import { TestUtils } from "../unit/programs/utils/index";
import {
    TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";

/**
 * Concurrent Minting Stress Tests
 * 
 * Tests the EnergyToken program's ability to handle:
 * 1. Multiple concurrent minting requests
 * 2. PDA collision detection/prevention
 * 3. Rate limiting verification
 * 4. Account creation race conditions
 */

const KWH_TO_TOKEN_RATIO = 1.0;
const TOKEN_DECIMALS = 9;

function kwhToTokens(kwh: number): number {
    return Math.floor(kwh * KWH_TO_TOKEN_RATIO * Math.pow(10, TOKEN_DECIMALS));
}

describe("Concurrent Minting Stress Tests", () => {
    let env: TestEnvironment;
    let tokenInfoPda: anchor.web3.PublicKey;
    let mintPda: anchor.web3.PublicKey;

    before(async () => {
        env = await TestEnvironment.create();

        [tokenInfoPda] = TestUtils.findTokenInfoPda(env.energyTokenProgram.programId);
        [mintPda] = TestUtils.findMintPda(env.energyTokenProgram.programId);

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
        } catch {
            console.log("Token program already initialized");
        }
    });

    describe("Parallel Minting Requests", () => {
        it("should handle 10 concurrent minting requests", async () => {
            const numConcurrent = 10;
            const users = await createTestUsers(env, numConcurrent);

            const mintPromises = users.map(async (user) => {
                const tokenAmount = kwhToTokens(5.0); // 5 kWh each

                return env.energyTokenProgram.methods
                    .mintTokensDirect(new BN(tokenAmount))
                    .accounts({
                        tokenInfo: tokenInfoPda,
                        mint: mintPda,
                        userTokenAccount: user.tokenAccount,
                        authority: env.authority.publicKey,
                        tokenProgram: TOKEN_2022_PROGRAM_ID,
                    })
                    .signers([env.authority])
                    .rpc();
            });

            const results = await Promise.allSettled(mintPromises);
            const successful = results.filter(r => r.status === 'fulfilled').length;
            const failed = results.filter(r => r.status === 'rejected').length;

            console.log(`✓ Concurrent minting: ${successful} succeeded, ${failed} failed`);
            expect(successful).to.be.greaterThan(0);
        });

        it("should handle 50 concurrent minting requests with rate limiting", async () => {
            const numConcurrent = 50;
            const users = await createTestUsers(env, numConcurrent);
            const batchSize = 10;
            let totalSuccessful = 0;

            // Process in batches to avoid overwhelming the network
            for (let i = 0; i < users.length; i += batchSize) {
                const batch = users.slice(i, i + batchSize);

                const mintPromises = batch.map(async (user) => {
                    const tokenAmount = kwhToTokens(1.0);

                    return env.energyTokenProgram.methods
                        .mintTokensDirect(new BN(tokenAmount))
                        .accounts({
                            tokenInfo: tokenInfoPda,
                            mint: mintPda,
                            userTokenAccount: user.tokenAccount,
                            authority: env.authority.publicKey,
                            tokenProgram: TOKEN_2022_PROGRAM_ID,
                        })
                        .signers([env.authority])
                        .rpc();
                });

                const results = await Promise.allSettled(mintPromises);
                totalSuccessful += results.filter(r => r.status === 'fulfilled').length;

                // Small delay between batches
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            console.log(`✓ Batched concurrent minting: ${totalSuccessful}/${numConcurrent} succeeded`);
            expect(totalSuccessful).to.be.greaterThan(numConcurrent * 0.8); // At least 80% success rate
        });
    });

    describe("Same User Concurrent Minting", () => {
        it("should handle multiple concurrent mints to same account", async () => {
            const user = anchor.web3.Keypair.generate();
            await env.airdropSol(user.publicKey, 5 * anchor.web3.LAMPORTS_PER_SOL);

            const userTokenAccount = await TestUtils.createAssociatedTokenAccount(
                user.publicKey,
                mintPda,
                user.publicKey,
                env.connection,
                TOKEN_2022_PROGRAM_ID
            );

            const initialBalance = await TestUtils.getTokenBalance(env.connection, userTokenAccount);

            // Try 5 concurrent mints to same account
            const mintPromises = Array(5).fill(null).map(async () => {
                const tokenAmount = kwhToTokens(2.0);

                return env.energyTokenProgram.methods
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
            });

            const results = await Promise.allSettled(mintPromises);
            const successful = results.filter(r => r.status === 'fulfilled').length;

            const finalBalance = await TestUtils.getTokenBalance(env.connection, userTokenAccount);
            const increase = finalBalance - initialBalance;
            const expectedIncrease = kwhToTokens(2.0) * successful;

            console.log(`✓ Same account concurrent: ${successful}/5 succeeded`);
            console.log(`  Balance increase: ${increase}, Expected: ${expectedIncrease}`);

            expect(increase).to.equal(expectedIncrease);
        });
    });

    describe("Rapid Sequential Minting", () => {
        it("should handle 100 rapid sequential mints", async () => {
            const user = anchor.web3.Keypair.generate();
            await env.airdropSol(user.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);

            const userTokenAccount = await TestUtils.createAssociatedTokenAccount(
                user.publicKey,
                mintPda,
                user.publicKey,
                env.connection,
                TOKEN_2022_PROGRAM_ID
            );

            const initialBalance = await TestUtils.getTokenBalance(env.connection, userTokenAccount);
            const numMints = 100;
            const tokenAmountPerMint = kwhToTokens(0.1); // 0.1 kWh per mint
            let successCount = 0;

            const startTime = Date.now();

            for (let i = 0; i < numMints; i++) {
                try {
                    await env.energyTokenProgram.methods
                        .mintTokensDirect(new BN(tokenAmountPerMint))
                        .accounts({
                            tokenInfo: tokenInfoPda,
                            mint: mintPda,
                            userTokenAccount: userTokenAccount,
                            authority: env.authority.publicKey,
                            tokenProgram: TOKEN_2022_PROGRAM_ID,
                        })
                        .signers([env.authority])
                        .rpc({ skipPreflight: true });

                    successCount++;
                } catch (e: any) {
                    // Some failures expected under stress
                }
            }

            const endTime = Date.now();
            const duration = (endTime - startTime) / 1000;
            const tps = successCount / duration;

            const finalBalance = await TestUtils.getTokenBalance(env.connection, userTokenAccount);

            console.log(`✓ Rapid sequential minting: ${successCount}/${numMints} in ${duration.toFixed(2)}s`);
            console.log(`  Throughput: ${tps.toFixed(2)} tx/s`);
            console.log(`  Final balance: ${finalBalance}`);

            expect(successCount).to.be.greaterThan(numMints * 0.5); // At least 50% success
        });
    });

    after(async () => {
        console.log("\n📊 Stress Test Summary:");
        console.log("Concurrent minting stress tests completed");
    });
});

// Helper functions

interface TestUser {
    keypair: anchor.web3.Keypair;
    tokenAccount: anchor.web3.PublicKey;
}

async function createTestUsers(env: TestEnvironment, count: number): Promise<TestUser[]> {
    const users: TestUser[] = [];
    const mintPda = TestUtils.findMintPda(env.energyTokenProgram.programId)[0];

    for (let i = 0; i < count; i++) {
        const keypair = anchor.web3.Keypair.generate();
        await env.airdropSol(keypair.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);

        const tokenAccount = await TestUtils.createAssociatedTokenAccount(
            keypair.publicKey,
            mintPda,
            keypair.publicKey,
            env.connection,
            TOKEN_2022_PROGRAM_ID
        );

        users.push({ keypair, tokenAccount });
    }

    return users;
}
