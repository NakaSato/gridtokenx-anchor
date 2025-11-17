#!/usr/bin/env ts-node
/**
 * Simple GRX Token Creation Script
 * Creates a GRX token mint and saves the info
 */

import * as anchor from "@coral-xyz/anchor";
import { 
  PublicKey, 
  Keypair, 
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { 
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as fs from "fs";

const METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const PROGRAM_ID = new PublicKey("94G1r674LmRDmLN2UPjDFD8Eh7zT8JaSaxv9v68GyEur");

async function main() {
  console.log("🚀 Simple GRX Token Creation\n");
  
  // Setup
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;
  const authority = provider.wallet.publicKey;
  
  // Load IDL and create program
  const idl = JSON.parse(fs.readFileSync("./target/idl/energy_token.json", "utf-8"));
  const program = new anchor.Program(idl, PROGRAM_ID, provider);
  
  // Generate mint keypair
  const mintKeypair = Keypair.generate();
  console.log("✅ Mint address:", mintKeypair.publicKey.toBase58());
  
  // Derive metadata PDA
  const [metadataAddress] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      METADATA_PROGRAM_ID.toBuffer(),
      mintKeypair.publicKey.toBuffer(),
    ],
    METADATA_PROGRAM_ID
  );
  
  console.log("✅ Metadata address:", metadataAddress.toBase58());
  console.log("\n📝 Creating token...\n");
  
  try {
    const tx = await program.methods
      .createTokenMint("GridTokenX", "GRX", "https://arweave.net/grx-metadata.json")
      .accounts({
        mint: mintKeypair.publicKey,
        metadata: metadataAddress,
        payer: authority,
        authority: authority,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        metadataProgram: METADATA_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([mintKeypair])
      .rpc();
    
    console.log("✅ Token created!");
    console.log("   Transaction:", tx);
    
    // Save mint info
    const mintInfo = {
      name: "GridTokenX",
      symbol: "GRX",
      mint: mintKeypair.publicKey.toBase58(),
      decimals: 9,
      metadata: metadataAddress.toBase58(),
      createdAt: new Date().toISOString(),
    };
    
    fs.writeFileSync("./grx-token-info.json", JSON.stringify(mintInfo, null, 2));
    fs.writeFileSync("./grx-mint-keypair.json", JSON.stringify(Array.from(mintKeypair.secretKey)));
    
    console.log("\n✅ Token info saved to grx-token-info.json");
    console.log("✅ Mint keypair saved to grx-mint-keypair.json");
    
    console.log("\n🎉 GRX Token Setup Complete!");
    console.log("\nYou can now:");
    console.log("  • Mint tokens: ts-node scripts/grx-wallet-manager.ts mint 1 1000");
    console.log("  • Check balances: ts-node scripts/grx-wallet-manager.ts balances");
    console.log("  • Run demo: ts-node scripts/grx-wallet-manager.ts all");
    
  } catch (error) {
    console.error("❌ Error:", error);
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
