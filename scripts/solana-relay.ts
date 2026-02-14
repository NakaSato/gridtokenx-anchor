import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import {
    PublicKey,
    SystemProgram,
    Connection,
} from "@solana/web3.js";
import axios from "axios";

// Constants
const SIMULATOR_URL = "http://localhost:8082/api/status";
const INTERVAL_MS = 10000; // 10 seconds

async function main() {
    // ── Setup ────────────────────────────────────────────────────────────
    const connection = new Connection("http://localhost:8899", "confirmed");
    const wallet = anchor.Wallet.local();
    const provider = new anchor.AnchorProvider(connection, wallet, {
        commitment: "confirmed",
    });
    anchor.setProvider(provider);

    const oracleProgram = anchor.workspace.Oracle;
    const authority = wallet;

    console.log("═══════════════════════════════════════════════════════════════");
    console.log("  GridTokenX: Relay Service (Simulator → Blockchain)");
    console.log("═══════════════════════════════════════════════════════════════");

    // Derive Oracle PDA
    const [oracleData] = PublicKey.findProgramAddressSync(
        [Buffer.from("oracle_data")],
        oracleProgram.programId
    );

    // 1. Ensure Oracle is Initialized
    console.log("[1/3] Ensuring Oracle is initialized...");
    try {
        await oracleProgram.methods
            .initialize(authority.publicKey)
            .accounts({
                oracleData: oracleData,
                authority: authority.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .rpc();
        console.log("  ✅ Oracle initialized.");
    } catch (e: any) {
        if (e.message.includes("already in use")) {
            console.log("  ℹ️ Oracle already initialized.");
        } else {
            console.error("  ❌ Oracle init error:", e.message);
        }
    }

    // 2. Ensure API Gateway is set
    console.log("[2/3] Verifying API Gateway authority...");
    try {
        await oracleProgram.methods
            .updateApiGateway(authority.publicKey)
            .accounts({
                oracleData: oracleData,
                authority: authority.publicKey,
            })
            .rpc();
        console.log("  ✅ API Gateway confirmed.");
    } catch (e: any) {
        console.error("  ❌ Warning: Could not update API Gateway (might already be set correctly).");
    }

    // 3. Start Relay Loop
    console.log(`[3/3] Starting relay loop (interval: ${INTERVAL_MS / 1000}s)...`);

    while (true) {
        try {
            const response = await axios.get(SIMULATOR_URL);
            const data = response.data;

            if (data.meters && data.meters.length > 0) {
                console.log(`\n--- Relay Batch at ${new Date().toLocaleTimeString()} ---`);

                for (const meter of data.meters) {
                    const meterId = meter.meter_id;
                    const produced = Math.round(meter.current_generation);
                    const consumed = Math.round(meter.current_consumption);
                    const timestamp = Math.floor(Date.now() / 1000);

                    console.log(`Pushing: ${meterId} | P: ${produced} Wh | C: ${consumed} Wh`);

                    try {
                        const tx = await oracleProgram.methods
                            .submitMeterReading(
                                meterId,
                                new BN(produced),
                                new BN(consumed),
                                new BN(timestamp)
                            )
                            .accounts({
                                oracleData: oracleData,
                                authority: authority.publicKey,
                            })
                            .rpc();

                        console.log(`  ✅ TX: ${tx.slice(0, 8)}...`);
                    } catch (txError: any) {
                        console.error(`  ❌ Failed to push ${meterId}:`, txError.message);
                    }
                }
            }
        } catch (fetchError: any) {
            console.error("Error fetching simulator data:", fetchError.message);
        }

        await new Promise(resolve => setTimeout(resolve, INTERVAL_MS));
    }
}

main().catch(console.error);
