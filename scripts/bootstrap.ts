import * as anchor from "@coral-xyz/anchor";
import { BN } from "bn.js";
import { TestEnvironment } from "../tests/setup.ts";

async function main() {
    console.log("🚀 Starting Bootstrap Process...");

    try {
        const env = await TestEnvironment.create();
        console.log(`\n🔑 Authority Wallet: ${env.authority.publicKey.toBase58()}`);

        // 1. Initialize Registry
        console.log("\n📦 Initializing Registry...");
        const [registryPda] = await anchor.web3.PublicKey.findProgramAddress(
            [Buffer.from("registry")],
            env.registryProgram.programId
        );

        try {
            await env.registryProgram.account.registry.fetch(registryPda);
            console.log("   ✅ Registry already initialized");
        } catch (e) {
            await env.registryProgram.methods
                .initialize()
                .accounts({
                    registry: registryPda,
                    authority: env.authority.publicKey,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .signers([env.authority])
                .rpc();
            console.log("   ✅ Registry initialized successfully");
        }

        // 2. Initialize Market (Trading)
        console.log("\nWMN Initializing Market...");
        const [marketPda] = await anchor.web3.PublicKey.findProgramAddress(
            [Buffer.from("market")],
            env.tradingProgram.programId
        );

        try {
            await env.tradingProgram.account.market.fetch(marketPda);
            console.log("   ✅ Market already initialized");
        } catch (e) {
            await env.tradingProgram.methods
                .initializeMarket()
                .accounts({
                    market: marketPda,
                    authority: env.authority.publicKey,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .signers([env.authority])
                .rpc();
            console.log(`   ✅ Market initialized successfully (PDA: ${marketPda.toBase58()})`);
        }

        // 3. Initialize Energy Token (Mint)
        console.log("\n⚡ Initializing Energy Token Mint...");
        const [mintPda] = await anchor.web3.PublicKey.findProgramAddress(
            [Buffer.from("mint")],
            env.energyTokenProgram.programId
        );

        console.log(`   ℹ️  Mint PDA: ${mintPda.toBase58()}`);

        // We check if mint exists by trying to fetch it (standard checks might fail if it's just a raw mint, 
        // but our program likely wraps it or we can check via provider)
        const mintInfo = await env.provider.connection.getAccountInfo(mintPda);

        if (mintInfo) {
            console.log("   ✅ Mint already initialized");
        } else {
            try {
                // We must use 'initializeToken' which actually inits the mint and token_info
                // NOT 'initialize' which does nothing.

                const [tokenInfoPda] = await anchor.web3.PublicKey.findProgramAddress(
                    [Buffer.from("token_info")],
                    env.energyTokenProgram.programId
                );

                await env.energyTokenProgram.methods
                    .initializeToken()
                    .accounts({
                        tokenInfo: tokenInfoPda,
                        mint: mintPda,
                        authority: env.authority.publicKey,
                        systemProgram: anchor.web3.SystemProgram.programId,
                        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
                        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
                    })
                    .signers([env.authority])
                    .rpc();
                console.log("   ✅ Mint initialized successfully");
            } catch (e) {
                console.error("   ❌ Failed to initialize mint:", e);
                process.exit(1);
            }
        }

        console.log("\n🎉 Bootstrap Completed Successfully!");
        process.exit(0);

    } catch (error) {
        console.error("\n❌ Bootstrap Failed:", error);
        process.exit(1);
    }
}

main();
