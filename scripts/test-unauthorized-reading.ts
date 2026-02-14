/**
 * Test: Verify unauthorized users CANNOT submit meter readings
 */
import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { Keypair, PublicKey, Connection } from "@solana/web3.js";

async function main() {
  const connection = new Connection("http://localhost:8899", "confirmed");
  const wallet = anchor.Wallet.local();
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const oracleProgram = (anchor.workspace as any).Oracle;
  const [oracleData] = PublicKey.findProgramAddressSync([Buffer.from("oracle_data")], oracleProgram.programId);

  // Try submitting from a random keypair (NOT the API Gateway)
  const unauthorized = Keypair.generate();
  const sig = await connection.requestAirdrop(unauthorized.publicKey, 1_000_000_000);
  const latest = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature: sig, ...latest });

  console.log("Testing unauthorized meter reading submission...");
  console.log("Unauthorized signer:", unauthorized.publicKey.toBase58());

  try {
    await oracleProgram.methods
      .submitMeterReading("METER-HACK", new BN(9999), new BN(0), new BN(Math.floor(Date.now() / 1000)))
      .accounts({ oracleData, authority: unauthorized.publicKey })
      .signers([unauthorized])
      .rpc();
    console.log("❌ SECURITY ISSUE: Unauthorized reading was accepted!");
  } catch (e: any) {
    console.log("✅ Unauthorized reading correctly REJECTED!");
    console.log("Error:", e.message?.substring(0, 120));
  }
}

main().catch(console.error);
