#!/usr/bin/env ts-node
/**
 * Complete Loop Transfer Test Setup (Standalone)
 * 
 * Creates everything needed for loop transfer test without requiring Anchor workspace:
 * - Creates 2 test wallets
 * - Creates a test token mint
 * - Mints tokens to both wallets
 * - Ready to run loop transfer test
 * 
 * Usage: ts-node scripts/setup-loop-test-standalone.ts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createInitializeMint2Instruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getMinimumBalanceForRentExemptMint,
  MINT_SIZE,
  getAccount,
} from "@solana/spl-token";
import * as fs from "fs";

// Configuration
const CONFIG = {
  wallet1Path: "./wallet-1-keypair.json",
  wallet2Path: "./wallet-2-keypair.json",
  mintKeypairPath: "./test-mint-keypair.json",
  mintInfoPath: "./grx-token-info.json",
  authorityPath: process.env.ANCHOR_WALLET || "~/.config/solana/id.json",
  rpcUrl: process.env.ANCHOR_PROVIDER_URL || "http://localhost:8899",
  tokenDecimals: 9,
  initialMintAmount: 2000, // Amount to mint to each wallet
};

function loadOrCreateKeypair(filePath: string): Keypair {
  if (fs.existsSync(filePath)) {
    const keypairData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return Keypair.fromSecretKey(new Uint8Array(keypairData));
  }
  
  const keypair = Keypair.generate();
  fs.writeFileSync(filePath, JSON.stringify(Array.from(keypair.secretKey)));
  console.log(`   Created: ${filePath}`);
  console.log(`   Address: ${keypair.publicKey.toBase58()}`);
  return keypair;
}

function loadKeypair(filePath: string): Keypair {
  const expandedPath = filePath.replace(/^~/, process.env.HOME || "");
  if (!fs.existsSync(expandedPath)) {
    throw new Error(`Keypair file not found: ${expandedPath}`);
  }
  const keypairData = JSON.parse(fs.readFileSync(expandedPath, "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(keypairData));
}

async function main() {
  console.log("🚀 Loop Transfer Test - Complete Setup\n");
  console.log("=".repeat(70));
  console.log(`RPC Endpoint: ${CONFIG.rpcUrl}`);
  console.log("=".repeat(70) + "\n");

  const connection = new Connection(CONFIG.rpcUrl, "confirmed");
  
  // Load authority
  const authority = loadKeypair(CONFIG.authorityPath);
  console.log(`Authority: ${authority.publicKey.toBase58()}\n`);

  // Step 1: Create wallets
  console.log("📦 Step 1: Creating test wallets...");
  const wallet1 = loadOrCreateKeypair(CONFIG.wallet1Path);
  const wallet2 = loadOrCreateKeypair(CONFIG.wallet2Path);
  console.log("");

  // Step 2: Airdrop SOL to wallets
  console.log("💰 Step 2: Requesting SOL airdrops...");
  try {
    const airdrop1 = await connection.requestAirdrop(wallet1.publicKey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(airdrop1);
    console.log(`   ✅ Wallet 1 received 2 SOL`);
    
    const airdrop2 = await connection.requestAirdrop(wallet2.publicKey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(airdrop2);
    console.log(`   ✅ Wallet 2 received 2 SOL`);
  } catch (error) {
    console.log(`   ⚠️  Airdrop may have failed (rate limit)`);
  }
  console.log("");

  // Step 3: Create or verify mint
  console.log("🪙 Step 3: Setting up token mint...");
  const mintKeypair = loadOrCreateKeypair(CONFIG.mintKeypairPath);
  
  let mintExists = false;
  try {
    const mintInfo = await connection.getAccountInfo(mintKeypair.publicKey);
    mintExists = mintInfo !== null;
  } catch (error) {
    mintExists = false;
  }

  if (!mintExists) {
    console.log("   Creating new token mint...");
    const lamports = await getMinimumBalanceForRentExemptMint(connection);
    
    const transaction = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: authority.publicKey,
        newAccountPubkey: mintKeypair.publicKey,
        space: MINT_SIZE,
        lamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(
        mintKeypair.publicKey,
        CONFIG.tokenDecimals,
        authority.publicKey,
        authority.publicKey,
        TOKEN_2022_PROGRAM_ID
      )
    );

    await sendAndConfirmTransaction(connection, transaction, [authority, mintKeypair]);
    console.log(`   ✅ Mint created: ${mintKeypair.publicKey.toBase58()}`);
    
    // Save mint info
    const mintInfo = {
      name: "GridTokenX Test",
      symbol: "GRX",
      mint: mintKeypair.publicKey.toBase58(),
      decimals: CONFIG.tokenDecimals,
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(CONFIG.mintInfoPath, JSON.stringify(mintInfo, null, 2));
    console.log(`   💾 Mint info saved to ${CONFIG.mintInfoPath}`);
  } else {
    console.log(`   ✅ Using existing mint: ${mintKeypair.publicKey.toBase58()}`);
  }
  console.log("");

  // Step 4: Mint tokens to wallet 1
  console.log(`🪙 Step 4: Minting ${CONFIG.initialMintAmount} GRX to Wallet 1...`);
  await mintTokensToWallet(connection, authority, mintKeypair.publicKey, wallet1.publicKey, CONFIG.initialMintAmount);
  console.log("");

  // Step 5: Mint tokens to wallet 2
  console.log(`🪙 Step 5: Minting ${CONFIG.initialMintAmount} GRX to Wallet 2...`);
  await mintTokensToWallet(connection, authority, mintKeypair.publicKey, wallet2.publicKey, CONFIG.initialMintAmount);
  console.log("");

  // Step 6: Display balances
  console.log("📊 Step 6: Final balances:");
  await displayBalance(connection, mintKeypair.publicKey, wallet1.publicKey, "Wallet 1");
  await displayBalance(connection, mintKeypair.publicKey, wallet2.publicKey, "Wallet 2");
  console.log("");

  console.log("=".repeat(70));
  console.log("✅ Setup complete! You can now run the loop transfer test:");
  console.log("");
  console.log("   make test-loop-transfer-quick    # 20 iterations");
  console.log("   make test-loop-transfer          # 100 iterations");
  console.log("   make test-loop-transfer-stress   # 500 iterations");
  console.log("=".repeat(70));
}

async function mintTokensToWallet(
  connection: Connection,
  authority: Keypair,
  mint: PublicKey,
  walletPubkey: PublicKey,
  amount: number
) {
  const tokenAccount = getAssociatedTokenAddressSync(
    mint,
    walletPubkey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const transaction = new Transaction();

  // Check if token account exists
  try {
    await getAccount(connection, tokenAccount, undefined, TOKEN_2022_PROGRAM_ID);
  } catch (error) {
    // Create token account
    transaction.add(
      createAssociatedTokenAccountInstruction(
        authority.publicKey,
        tokenAccount,
        walletPubkey,
        mint,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
  }

  // Add mint instruction
  const mintAmount = BigInt(amount * Math.pow(10, CONFIG.tokenDecimals));
  transaction.add(
    createMintToInstruction(
      mint,
      tokenAccount,
      authority.publicKey,
      mintAmount,
      [],
      TOKEN_2022_PROGRAM_ID
    )
  );

  const signature = await sendAndConfirmTransaction(connection, transaction, [authority]);
  console.log(`   ✅ Minted ${amount} GRX`);
  console.log(`   Transaction: ${signature}`);
}

async function displayBalance(
  connection: Connection,
  mint: PublicKey,
  walletPubkey: PublicKey,
  label: string
) {
  const tokenAccount = getAssociatedTokenAddressSync(
    mint,
    walletPubkey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  try {
    const account = await getAccount(connection, tokenAccount, undefined, TOKEN_2022_PROGRAM_ID);
    const balance = Number(account.amount) / Math.pow(10, CONFIG.tokenDecimals);
    console.log(`   ${label}: ${balance.toFixed(CONFIG.tokenDecimals)} GRX`);
  } catch (error) {
    console.log(`   ${label}: 0.000000000 GRX (account not created)`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Setup failed:", error.message || error);
    console.error("\nMake sure:");
    console.error("  1. Solana validator is running (anchor localnet)");
    console.error("  2. Authority wallet has SOL for transaction fees");
    process.exit(1);
  });
