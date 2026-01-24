import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { ReadingSigner } from "./signer";
import * as dotenv from "dotenv";

dotenv.config();

// Standard GridTokenX Oracle Service
async function main() {
    const connection = new Connection(process.env.RPC_URL || "http://localhost:8899", "confirmed");
    const oracleKeypair = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(process.env.ORACLE_PRIVATE_KEY || "[]"))
    );

    console.log("🚀 GridTokenX Metering Oracle started");
    console.log("🔑 Oracle Identity:", oracleKeypair.publicKey.toBase58());

    const signer = new ReadingSigner(oracleKeypair.secretKey);

    // Mock loop: In production, this would listen to a Kafka stream or Smart Meter MQTT broker
    setInterval(async () => {
        const mockReading = {
            meter: "A1VaDmt5ighWuSybDkJAWjcj8V5mHagErKZug37y6aq4", // Example meter from tests
            value: Math.floor(Math.random() * 5000) + 1000, // 1-6 kWh
            timestamp: Math.floor(Date.now() / 1000)
        };

        console.log(`📡 New Reading from ${mockReading.meter}: ${mockReading.value} Wh`);

        const signature = await signer.signReading(
            mockReading.meter,
            mockReading.value,
            mockReading.timestamp
        );

        console.log(`✍️ Signed reading. Signature: ${Buffer.from(signature).toString('hex').slice(0, 16)}...`);

        // In a real scenario, this would send a tx to:
        // program.methods.verifyMeterReading(new BN(mockReading.value), new BN(mockReading.timestamp), Array.from(signature))
    }, 10000); // Every 10 seconds
}

main().catch(console.error);
