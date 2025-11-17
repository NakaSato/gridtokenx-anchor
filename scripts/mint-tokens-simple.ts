#!/usr/bin/env ts-node
/**
 * Simple Token Minting Script (No Anchor Workspace Required)
 * 
 * Mints tokens directly using SPL Token program without requiring Anchor workspace.
 * This is useful for testing when programs aren't built yet.
 * 
 * Usage: ts-node scripts/mint-tokens-simple.ts <wallet_number> <amount>
 * Example: ts-node scripts/mint-tokens-simple.ts 1 2000
 */

import {
  Connection,
  Keypair,
  PublicKey,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAccount,
} from "@solana/spl-token";
import * as fs from "fs";

// Configuration
const CONFIG = {
  wallet1Path: "./wallet-1-keypair.json",
  wallet2Path: "./wallet-2-keypair.json",
  mintInfoPath: "./grx-token-info.json",
  authorityPath: process.env.ANCHOR_WALLET || "~/.config/solana/id.json",
  rpcUrl: process.env.ANCHOR_PROVIDER_URL || "http://localhost:8899",
  tokenDecimals: 9,
};

// Helper functions
function loadKeypair(filePath: string): Keypair {
  const expandedPath = filePath.replace(/^~/, process.env.HOME || "");
  if (!fs.existsSync(expandedPath)) {
    throw new Error(`Keypair file not found: ${expandedPath}`);
  }
  const keypairData = JSON.parse(fs.readFileSync(expandedPath, "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(keypairData));
}

function loadMintInfo(): { mint: PublicKey; name: string; symbol: string } {
  if (!fs.existsSync(CONFIG.mintInfoPath)) {
    throw new Error(`Mint info not found: ${CONFIG.mintInfoPath}`);
  }
  const mintInfo = JSON.parse(fs.readFileSync(CONFIG.mintInfoPath, "utf-8"));
  return {
    mint: new PublicKey(mintInfo.mint),
    name: mintInfo.name,
    symbol: mintInfo.symbol,
  };
}

function parseTokenAmount(amount: number | string): bigint {
  return BigInt(Math.floor(Number(amount) * Math.pow(10, CONFIG.tokenDecimals)));
}

async function mintTokens(walletNum: number, amount: string) {
  console.log(`🪙 Minting ${amount} GRX to Wallet ${walletNum}...\n`);

  const connection = new Connection(CONFIG.rpcUrl, "confirmed");
  
  // Load keypairs
  const authority = loadKeypair(CONFIG.authorityPath);
  const targetWallet = walletNum === 1 
    ? loadKeypair(CONFIG.wallet1Path)
    : loadKeypair(CONFIG.wallet2Path);
  const mintInfo = loadMintInfo();
  
  console.log(`Authority: ${authority.publicKey.toBase58()}`);
  console.log(`Target Wallet: ${targetWallet.publicKey.toBase58()}`);
  console.log(`Mint: ${mintInfo.mint.toBase58()}\n`);

  const mintAmount = parseTokenAmount(amount);

  // Get associated token account
  const tokenAccount = getAssociatedTokenAddressSync(
    mintInfo.mint,
    targetWallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  console.log(`Token Account: ${tokenAccount.toBase58()}`);

  // Check if token account exists, if not create it
  let accountExists = true;
  try {
    await getAccount(connection, tokenAccount, undefined, TOKEN_2022_PROGRAM_ID);
    console.log("✅ Token account already exists");
  } catch (error) {
    console.log("📝 Creating token account...");
    accountExists = false;
  }

  // Build transaction
  const { Transaction, SystemProgram, sendAndConfirmTransaction } = await import("@solana/web3.js");
  const transaction = new Transaction();

  // Add create account instruction if needed
  if (!accountExists) {
    transaction.add(
      createAssociatedTokenAccountInstruction(
        authority.publicKey, // payer
        tokenAccount, // ata
        targetWallet.publicKey, // owner
        mintInfo.mint, // mint
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
  }

  // Add mint to instruction
  transaction.add(
    createMintToInstruction(
      mintInfo.mint, // mint
      tokenAccount, // destination
      authority.publicKey, // authority
      mintAmount, // amount
      [], // multi signers
      TOKEN_2022_PROGRAM_ID
    )
  );

  // Send transaction
  try {
    console.log("\n⏳ Sending transaction...");
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [authority],
      { commitment: "confirmed" }
    );

    console.log("\n✅ Minting successful!");
    console.log(`   Amount: ${amount} ${mintInfo.symbol}`);
    console.log(`   To: ${targetWallet.publicKey.toBase58()}`);
    console.log(`   Transaction: ${signature}`);
    
    // Check final balance
    const accountInfo = await getAccount(connection, tokenAccount, undefined, TOKEN_2022_PROGRAM_ID);
    const balance = Number(accountInfo.amount) / Math.pow(10, CONFIG.tokenDecimals);
    console.log(`   New Balance: ${balance.toFixed(CONFIG.tokenDecimals)} ${mintInfo.symbol}`);
  } catch (error: any) {
    console.error("\n❌ Minting failed:", error.message || error);
    throw error;
  }
}

// Main function
async function main() {
  const walletNum = parseInt(process.argv[2]);
  const amount = process.argv[3];

  if (!walletNum || ![1, 2].includes(walletNum)) {
    console.error("❌ Invalid wallet number. Must be 1 or 2.");
    console.error("\nUsage: ts-node scripts/mint-tokens-simple.ts <wallet_number> <amount>");
    console.error("Example: ts-node scripts/mint-tokens-simple.ts 1 2000");
    process.exit(1);
  }

  if (!amount || isNaN(Number(amount))) {
    console.error("❌ Invalid amount. Must be a number.");
    console.error("\nUsage: ts-node scripts/mint-tokens-simple.ts <wallet_number> <amount>");
    console.error("Example: ts-node scripts/mint-tokens-simple.ts 1 2000");
    process.exit(1);
  }

  console.log("🚀 Simple Token Minting\n");
  console.log("=".repeat(60));
  console.log(`RPC Endpoint: ${CONFIG.rpcUrl}`);
  console.log("=".repeat(60) + "\n");

  await mintTokens(walletNum, amount);
}

main()
  .then(() => {
    console.log("\n✅ Done!\n");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Fatal Error:", error.message || error);
    console.error("\nMake sure:");
    console.error("  1. Solana validator is running (anchor localnet)");
    console.error("  2. Wallets exist (ts-node scripts/grx-wallet-manager.ts setup)");
    console.error("  3. Token mint exists (check grx-token-info.json)");
    console.error("  4. Authority wallet has SOL for transaction fees");
    process.exit(1);
  });
