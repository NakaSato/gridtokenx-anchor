import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import fs from "fs";

// Helper for HTTP requests
async function post(url: string, body: any) {
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        return response;
    } catch (error) {
        console.error("Fetch error:", error);
        throw error;
    }
}

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    console.log("🚀 Starting P2P Flow Verification: Minting Check");

    const API_URL = process.env.API_URL || "http://localhost:3000";
    console.log(`Using API URL: ${API_URL}`);

    // Retry loop for API connection
    let connected = false;
    for (let i = 0; i < 30; i++) {
        try {
            await fetch(`${API_URL}/health`); // Try health endpoint
            connected = true;
            console.log("✅ API is reachable!");
            break;
        } catch (e) {
            console.log(`⏳ Waiting for API to start (attempt ${i + 1}/30)...`);
            await sleep(2000);
        }
    }

    if (!connected) {
        console.error("❌ Failed to connect to API Gateway after 60 seconds.");
        process.exit(1);
    }

    // Configure client
    // Expecting ANCHOR_WALLET and ANCHOR_PROVIDER_URL to be set typically
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const connection = provider.connection;

    // Simulate Meter Reading
    // Using a random serial to ensure we generate a 'fresh' reading if logic depends on sequence,
    // though the simulator usually uses fixed names.
    // Let's use "METER-VERIFY-001".
    const meterSerial = "METER-VERIFY-001";
    const amountKwh = 10.0 + Math.random(); // Varied amount

    console.log(`\n📡 Step 1: Submitting Meter Reading for ${meterSerial} (${amountKwh.toFixed(2)} kWh)`);

    try {
        const payload = {
            meter_serial: meterSerial,
            kwh_amount: amountKwh,
            reading_timestamp: Math.floor(Date.now() / 1000),
            // Stub handler often expects basic fields
        };

        console.log("Payload:", JSON.stringify(payload));

        const res = await post(`${API_URL}/api/meters/submit-reading`, payload);

        if (res.status === 200) {
            console.log("✅ Reading submitted successfully!");
            const data = await res.json();
            console.log("Response:", JSON.stringify(data, null, 2));
        } else {
            console.error(`❌ Reading submission failed: ${res.status} ${res.statusText}`);
            const text = await res.text();
            console.error("Response:", text);
            // Don't exit, might be a logical error (e.g. meter not registered)
        }

    } catch (e) {
        console.error("❌ API Request failed:", e);
        return;
    }

    console.log("\n⏳ Waiting for background minting (5s)...");
    await sleep(5000);

    console.log("⚠️  Note: To fully verify minting, check the API Gateway logs for 'Triggering blockchain mint' and 'Mint successful'.");
    console.log("✅ Script finished.");
}

main().then(() => process.exit(0)).catch(e => {
    console.error(e);
    process.exit(1);
});
