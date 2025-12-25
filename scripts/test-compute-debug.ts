/**
 * Quick test script to demonstrate compute_fn! macro output
 * Run with: npx ts-node scripts/test-compute-debug.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import * as fs from "fs";

const ENERGY_TOKEN_PROGRAM_ID = new PublicKey("5FVExLSAC94gSWH6TJa1TmBDWXuqFe5obZaC5DkqJihU");

async function main() {
    console.log("=== Compute Debug Macro Test ===\n");

    // Connect to localnet
    const connection = new Connection("http://localhost:8899", "confirmed");

    // Load wallet
    const walletPath = "../keypairs/dev-wallet.json";
    const walletKeypair = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
    );
    console.log("Wallet:", walletKeypair.publicKey.toBase58());

    // Setup provider
    const wallet = new anchor.Wallet(walletKeypair);
    const provider = new anchor.AnchorProvider(connection, wallet, {
        commitment: "confirmed",
    });

    // Load IDL
    const idl = JSON.parse(
        fs.readFileSync("target/idl/energy_token.json", "utf-8")
    );
    const program = new Program(idl, provider);

    // Derive PDAs
    const [tokenInfoPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_info")],
        ENERGY_TOKEN_PROGRAM_ID
    );
    const [mintPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("mint")],
        ENERGY_TOKEN_PROGRAM_ID
    );

    console.log("Token Info PDA:", tokenInfoPda.toBase58());
    console.log("Mint PDA:", mintPda.toBase58());

    try {
        // Call initialize instruction
        console.log("\n📤 Calling 'initialize' instruction...");
        const tx = await program.methods
            .initialize()
            .accounts({
                authority: walletKeypair.publicKey,
            })
            .rpc({ commitment: "confirmed" });

        console.log("Transaction:", tx);

        // Fetch and display transaction logs
        console.log("\n📋 Transaction Logs (showing compute unit debug):");
        console.log("─".repeat(60));

        const txDetails = await connection.getTransaction(tx, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
        });

        if (txDetails?.meta?.logMessages) {
            for (const log of txDetails.meta.logMessages) {
                // Highlight compute unit logs
                if (log.includes(">>>") || log.includes("<<<") || log.includes("CHECKPOINT")) {
                    console.log(`\x1b[33m${log}\x1b[0m`); // Yellow
                } else if (log.includes("consumption")) {
                    console.log(`\x1b[36m${log}\x1b[0m`); // Cyan
                } else {
                    console.log(log);
                }
            }
        }

        // Show compute units used
        if (txDetails?.meta?.computeUnitsConsumed) {
            console.log("─".repeat(60));
            console.log(`\x1b[32m✅ Total Compute Units Used: ${txDetails.meta.computeUnitsConsumed}\x1b[0m`);
        }

    } catch (error: any) {
        if (error.logs) {
            console.log("\n📋 Transaction Logs (from error):");
            console.log("─".repeat(60));
            for (const log of error.logs) {
                if (log.includes(">>>") || log.includes("<<<") || log.includes("CHECKPOINT")) {
                    console.log(`\x1b[33m${log}\x1b[0m`);
                } else if (log.includes("consumption")) {
                    console.log(`\x1b[36m${log}\x1b[0m`);
                } else {
                    console.log(log);
                }
            }
        }
        console.log("\n⚠️ Note: Error might be due to already initialized state");
    }
}

main().catch(console.error);
