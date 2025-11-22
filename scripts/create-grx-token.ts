#!/usr/bin/env ts-node
/**
 * Script to create the GRX token and mint initial supply
 * Usage: ts-node scripts/create-grx-token.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
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

// Configuration
const CONFIG = {
  tokenName: "GridTokenX",
  tokenSymbol: "GRX",
  tokenUri: "https://arweave.net/grx-metadata.json", // Update with your metadata URI
  initialSupply: 1_000_000_000_000_000, // 1 million tokens (with 9 decimals)
  mintKeypairPath: "./grx-mint-keypair.json", // Where to save the mint keypair
};

// Metaplex Token Metadata Program ID
const METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);

async function main() {
  console.log("🚀 GRX Token Creation Script\n");
  console.log("=".repeat(50));

  // Setup provider and program
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // Load program manually using IDL
  const programId = new PublicKey(
    "94G1r674LmRDmLN2UPjDFD8Eh7zT8JaSaxv9v68GyEur",
  );
  const idl = JSON.parse(
    fs.readFileSync("./target/idl/energy_token.json", "utf-8"),
  );
  const program = new Program(idl as any, programId, provider);
  const authority = provider.wallet as anchor.Wallet;

  console.log("📋 Configuration:");
  console.log("  Program ID:", program.programId.toBase58());
  console.log("  Authority:", authority.publicKey.toBase58());
  console.log("  Token Name:", CONFIG.tokenName);
  console.log("  Token Symbol:", CONFIG.tokenSymbol);
  console.log("  Token URI:", CONFIG.tokenUri);
  console.log(
    "  Initial Supply:",
    CONFIG.initialSupply / 1e9,
    CONFIG.tokenSymbol,
  );
  console.log("=".repeat(50) + "\n");

  // Step 1: Generate or load mint keypair
  let mintKeypair: Keypair;
  if (fs.existsSync(CONFIG.mintKeypairPath)) {
    console.log(
      "📂 Loading existing mint keypair from",
      CONFIG.mintKeypairPath,
    );
    const secretKey = JSON.parse(
      fs.readFileSync(CONFIG.mintKeypairPath, "utf-8"),
    );
    mintKeypair = Keypair.fromSecretKey(Uint8Array.from(secretKey));
    console.log("✅ Mint keypair loaded:", mintKeypair.publicKey.toBase58());
  } else {
    console.log("🔑 Generating new mint keypair...");
    mintKeypair = Keypair.generate();

    // Save keypair
    fs.writeFileSync(
      CONFIG.mintKeypairPath,
      JSON.stringify(Array.from(mintKeypair.secretKey)),
    );
    console.log("✅ Mint keypair saved to:", CONFIG.mintKeypairPath);
    console.log("✅ Mint address:", mintKeypair.publicKey.toBase58());
  }

  // Step 2: Derive metadata PDA
  const [metadataAddress] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      METADATA_PROGRAM_ID.toBuffer(),
      mintKeypair.publicKey.toBuffer(),
    ],
    METADATA_PROGRAM_ID,
  );
  console.log("✅ Metadata address:", metadataAddress.toBase58() + "\n");

  // Step 3: Check if mint already exists
  const mintExists = await provider.connection.getAccountInfo(
    mintKeypair.publicKey,
  );

  if (mintExists) {
    console.log("⚠️  Token mint already exists!");
    console.log("    Skipping token creation...\n");
  } else {
    // Step 4: Create token mint with metadata
    console.log("📝 Creating GRX token mint with metadata...");
    try {
      const createTx = await program.methods
        .createTokenMint(CONFIG.tokenName, CONFIG.tokenSymbol, CONFIG.tokenUri)
        .accounts({
          mint: mintKeypair.publicKey,
          metadata: metadataAddress,
          payer: authority.publicKey,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          metadataProgram: METADATA_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([mintKeypair])
        .rpc({ commitment: "confirmed" });

      console.log("✅ Token mint created!");
      console.log("   Transaction:", createTx);
      console.log();

      // Wait for confirmation
      await provider.connection.confirmTransaction(createTx, "confirmed");
    } catch (error: any) {
      console.error("❌ Error creating token mint:", error.message);
      process.exit(1);
    }
  }

  // Step 5: Mint initial supply to authority
  console.log("💰 Minting initial supply to authority wallet...");
  const authorityTokenAccount = getAssociatedTokenAddressSync(
    mintKeypair.publicKey,
    authority.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
  );

  try {
    const mintTx = await program.methods
      .mintToWallet(new anchor.BN(CONFIG.initialSupply))
      .accounts({
        mint: mintKeypair.publicKey,
        destination: authorityTokenAccount,
        destinationOwner: authority.publicKey,
        authority: authority.publicKey,
        payer: authority.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });

    console.log("✅ Initial supply minted!");
    console.log("   Transaction:", mintTx);
    console.log("   Token Account:", authorityTokenAccount.toBase58());

    // Wait for confirmation
    await provider.connection.confirmTransaction(mintTx, "confirmed");

    // Get and display balance
    const balance = await provider.connection.getTokenAccountBalance(
      authorityTokenAccount,
    );
    console.log(
      "   Balance:",
      parseFloat(balance.value.uiAmountString || "0"),
      CONFIG.tokenSymbol,
    );
    console.log();
  } catch (error: any) {
    console.error("❌ Error minting tokens:", error.message);
    process.exit(1);
  }

  // Step 6: Display summary
  console.log("=".repeat(50));
  console.log("🎉 GRX Token Created Successfully!\n");
  console.log("📊 Token Information:");
  console.log("  Name:", CONFIG.tokenName);
  console.log("  Symbol:", CONFIG.tokenSymbol);
  console.log("  Mint Address:", mintKeypair.publicKey.toBase58());
  console.log("  Metadata Address:", metadataAddress.toBase58());
  console.log("  Authority Token Account:", authorityTokenAccount.toBase58());
  console.log(
    "  Initial Supply:",
    CONFIG.initialSupply / 1e9,
    CONFIG.tokenSymbol,
  );
  console.log("  Decimals: 9");
  console.log("\n💡 Next Steps:");
  console.log("  1. Update your token metadata at:", CONFIG.tokenUri);
  console.log("  2. Add token logo and upload to Arweave/IPFS");
  console.log("  3. Use 'mint_to_wallet' instruction to distribute tokens");
  console.log("  4. Consider setting up token security features\n");
  console.log("=".repeat(50));

  // Save token info to JSON
  const tokenInfo = {
    name: CONFIG.tokenName,
    symbol: CONFIG.tokenSymbol,
    mintAddress: mintKeypair.publicKey.toBase58(),
    metadataAddress: metadataAddress.toBase58(),
    programId: program.programId.toBase58(),
    decimals: 9,
    uri: CONFIG.tokenUri,
    authorityTokenAccount: authorityTokenAccount.toBase58(),
    createdAt: new Date().toISOString(),
  };

  const infoPath = "./grx-token-info.json";
  fs.writeFileSync(infoPath, JSON.stringify(tokenInfo, null, 2));
  console.log("\n📁 Token information saved to:", infoPath);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Script failed:", error);
    process.exit(1);
  });
