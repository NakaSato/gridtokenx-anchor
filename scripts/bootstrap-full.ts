import * as anchor from "@coral-xyz/anchor";
import { BN } from "bn.js";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
    createMint,
    getOrCreateAssociatedTokenAccount,
    mintTo,
    TOKEN_PROGRAM_ID,
    MINT_SIZE,
    createInitializeMintInstruction
} from "@solana/spl-token";
import * as fs from "fs";
import { TestEnvironment } from "../tests/setup.ts";

async function main() {
    console.log("🚀 Starting Full Bootstrap Process...");

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
        console.log("\n🛒 Initializing Market...");
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

        // 3. Initialize Energy Token (Mint 2022)
        console.log("\n⚡ Initializing Energy Token Mint (Token-2022)...");
        const [energyMintPda] = await anchor.web3.PublicKey.findProgramAddress(
            [Buffer.from("mint_2022")],
            env.energyTokenProgram.programId
        );

        const energyMintInfo = await env.provider.connection.getAccountInfo(energyMintPda);
        if (energyMintInfo) {
            console.log(`   ✅ Energy Mint already exists: ${energyMintPda.toBase58()}`);
        } else {
            const [tokenInfoPda] = await anchor.web3.PublicKey.findProgramAddress(
                [Buffer.from("token_info_2022")],
                env.energyTokenProgram.programId
            );

            await env.energyTokenProgram.methods
                .initializeToken(env.registryProgram.programId)
                .accounts({
                    tokenInfo: tokenInfoPda,
                    mint: energyMintPda,
                    authority: env.authority.publicKey,
                    systemProgram: anchor.web3.SystemProgram.programId,
                    tokenProgram: new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"), // Token-2022
                    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
                })
                .signers([env.authority])
                .rpc();
            console.log(`   ✅ Energy Mint initialized: ${energyMintPda.toBase58()}`);
        }

        // 4. Initialize Currency Token (Standard SPL)
        // We'll create a new mint for local currency (e.g. THB/USDC mock)
        console.log("\n💵 Initializing Currency Token Mint (Standard SPL)...");

        let currencyMint: PublicKey;
        const currencyKeypairPath = "./keypairs/currency-mint.json";

        if (fs.existsSync(currencyKeypairPath)) {
            const currencyKeypair = Keypair.fromSecretKey(
                Uint8Array.from(JSON.parse(fs.readFileSync(currencyKeypairPath, "utf-8")))
            );
            currencyMint = currencyKeypair.publicKey;
            const info = await env.provider.connection.getAccountInfo(currencyMint);
            if (info) {
                console.log(`   ✅ Currency Mint already exists: ${currencyMint.toBase58()}`);
            } else {
                currencyMint = await createMint(
                    env.connection,
                    env.authority,
                    env.authority.publicKey,
                    null,
                    6,
                    currencyKeypair
                );
                console.log(`   ✅ Currency Mint created: ${currencyMint.toBase58()}`);
            }
        } else {
            const currencyKeypair = Keypair.generate();
            if (!fs.existsSync("./keypairs")) fs.mkdirSync("./keypairs");
            fs.writeFileSync(currencyKeypairPath, JSON.stringify(Array.from(currencyKeypair.secretKey)));

            currencyMint = await createMint(
                env.connection,
                env.authority,
                env.authority.publicKey,
                null,
                6,
                currencyKeypair
            );
            console.log(`   ✅ New Currency Mint created: ${currencyMint.toBase58()}`);
        }

        console.log("\n📊 Summary for .env:");
        console.log(`ENERGY_TOKEN_MINT=${energyMintPda.toBase58()}`);
        console.log(`CURRENCY_TOKEN_MINT=${currencyMint.toBase58()}`);
        console.log(`AUTHORITY_WALLET_PUBKEY=${env.authority.publicKey.toBase58()}`);

        console.log("\n🎉 Full Bootstrap Completed Successfully!");
        process.exit(0);

    } catch (error) {
        console.error("\n❌ Bootstrap Failed:", error);
        process.exit(1);
    }
}

main();
