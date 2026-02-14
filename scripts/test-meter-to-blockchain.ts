/**
 * Test: Meter Reading → API Gateway → Blockchain
 *
 * This script simulates the full flow:
 *   1. Initialize the Oracle program (if needed)
 *   2. Set the dev wallet as the authorized API Gateway
 *   3. Submit a real meter reading on-chain via the Oracle program
 *   4. Verify the transaction on the blockchain
 *
 * Only the API Gateway (authority) can submit meter readings.
 *
 * Usage: npx tsx scripts/test-meter-to-blockchain.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Connection,
} from "@solana/web3.js";
import type { Oracle } from "../target/types/oracle";

const RPC_URL = "http://localhost:8899";

async function main() {
  // ── Setup ────────────────────────────────────────────────────────────
  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = anchor.Wallet.local();
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const oracleProgram = anchor.workspace.Oracle as Program<Oracle>;
  const authority = wallet;

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  GridTokenX: Meter Reading → Blockchain Flow Test");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  RPC:       ${RPC_URL}`);
  console.log(`  Authority: ${authority.publicKey.toBase58()}`);
  console.log(`  Oracle:    ${oracleProgram.programId.toBase58()}`);
  console.log("");

  // ── Derive Oracle PDA ────────────────────────────────────────────────
  const [oracleData] = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle_data")],
    oracleProgram.programId
  );
  console.log(`  Oracle PDA: ${oracleData.toBase58()}`);

  // ── Step 1: Initialize Oracle (if needed) ────────────────────────────
  console.log("\n[1/4] Initializing Oracle program...");
  try {
    const tx = await oracleProgram.methods
      .initialize(authority.publicKey)
      .accounts({
        oracleData: oracleData,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`  ✅ Oracle initialized. TX: ${tx}`);
  } catch (e: any) {
    if (e.message?.includes("already in use")) {
      console.log("  ℹ️  Oracle already initialized, skipping.");
    } else {
      console.error(`  ⚠️  Oracle init error: ${e.message}`);
    }
  }

  // ── Step 2: Set API Gateway as authority ──────────────────────────────
  console.log("\n[2/4] Setting dev wallet as authorized API Gateway...");
  try {
    const tx = await oracleProgram.methods
      .updateApiGateway(authority.publicKey)
      .accounts({
        oracleData: oracleData,
        authority: authority.publicKey,
      })
      .rpc();
    console.log(`  ✅ API Gateway set to ${authority.publicKey.toBase58()}`);
    console.log(`  TX: ${tx}`);
  } catch (e: any) {
    console.error(`  ⚠️  Set API Gateway error: ${e.message}`);
  }

  // ── Step 3: Submit real meter reading ────────────────────────────────
  console.log("\n[3/4] Submitting real meter reading on-chain...");

  const meterReading = {
    meterId: "SM-SOLAR-001",
    energyProduced: 4250, // 4.25 kWh (in Wh)
    energyConsumed: 1800, // 1.80 kWh (in Wh)
    timestamp: Math.floor(Date.now() / 1000),
  };

  console.log(`  Meter ID:        ${meterReading.meterId}`);
  console.log(`  Energy Produced: ${meterReading.energyProduced} Wh (${(meterReading.energyProduced / 1000).toFixed(2)} kWh)`);
  console.log(`  Energy Consumed: ${meterReading.energyConsumed} Wh (${(meterReading.energyConsumed / 1000).toFixed(2)} kWh)`);
  console.log(`  Net Energy:      ${meterReading.energyProduced - meterReading.energyConsumed} Wh`);
  console.log(`  Timestamp:       ${new Date(meterReading.timestamp * 1000).toISOString()}`);

  try {
    const tx = await oracleProgram.methods
      .submitMeterReading(
        meterReading.meterId,
        new BN(meterReading.energyProduced),
        new BN(meterReading.energyConsumed),
        new BN(meterReading.timestamp)
      )
      .accounts({
        oracleData: oracleData,
        authority: authority.publicKey,
      })
      .rpc();

    console.log(`\n  ✅ Meter reading submitted on-chain!`);
    console.log(`  TX Signature: ${tx}`);
    console.log(`  Explorer:     https://explorer.solana.com/tx/${tx}?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899`);

    // ── Step 4: Verify on-chain ──────────────────────────────────────
    console.log("\n[4/4] Verifying transaction on blockchain...");
    const txDetails = await connection.getTransaction(tx, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    if (txDetails) {
      console.log(`  ✅ Transaction confirmed!`);
      console.log(`  Slot:          ${txDetails.slot}`);
      console.log(`  Block Time:    ${txDetails.blockTime ? new Date(txDetails.blockTime * 1000).toISOString() : "N/A"}`);
      console.log(`  Fee:           ${txDetails.meta?.fee} lamports`);
      console.log(`  Status:        ${txDetails.meta?.err ? "FAILED" : "SUCCESS"}`);

      // Check logs for events
      const logs = txDetails.meta?.logMessages || [];
      const readingLogs = logs.filter(
        (l) => l.includes("MeterReading") || l.includes("meter") || l.includes("energy")
      );
      if (readingLogs.length > 0) {
        console.log(`\n  Program Logs (meter-related):`);
        readingLogs.forEach((l) => console.log(`    ${l}`));
      }
    } else {
      console.log("  ⏳ Transaction not yet confirmed, check explorer.");
    }
  } catch (e: any) {
    console.error(`\n  ❌ Meter reading submission failed!`);
    console.error(`  Error: ${e.message}`);
    if (e.logs) {
      console.error(`\n  Program Logs:`);
      e.logs.forEach((l: string) => console.error(`    ${l}`));
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  Flow:  Smart Meter → API Gateway → Oracle Program (Solana)");
  console.log("  Auth:  Only API Gateway can submit (signer == api_gateway)");
  console.log("═══════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
