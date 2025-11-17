#!/usr/bin/env ts-node
/**
 * GRX Token Wallet Manager Script
 * 
 * Features:
 * 1. Create and manage 2 wallet accounts
 * 2. Transfer tokens between the 2 accounts
 * 3. Check balances of both accounts
 * 4. Mint and burn tokens from authority
 * 
 * Usage: ts-node scripts/grx-wallet-manager.ts [command]
 * Commands:
 *   setup              - Create 2 new wallets and save keypairs
 *   balances           - Check balances of both accounts
 *   transfer <amount>  - Transfer tokens from wallet 1 to wallet 2
 *   mint <wallet> <amount> - Mint tokens to wallet (1 or 2)
 *   burn <wallet> <amount> - Burn tokens from wallet (1 or 2)
 *   airdrop            - Request SOL airdrop for both wallets
 *   all                - Run complete demo (setup, mint, transfer, burn)
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { 
  PublicKey, 
  Keypair, 
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Connection,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { 
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount,
  transfer,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

// Configuration
const CONFIG = {
  wallet1Path: "./wallet-1-keypair.json",
  wallet2Path: "./wallet-2-keypair.json",
  mintInfoPath: "./grx-token-info.json",
  tokenDecimals: 9,
};

// Metaplex Token Metadata Program ID
const METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

// Helper function to load or create keypair
function loadOrCreateKeypair(filePath: string, create: boolean = false): Keypair {
  if (fs.existsSync(filePath) && !create) {
    const keypairData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return Keypair.fromSecretKey(new Uint8Array(keypairData));
  }
  
  const keypair = Keypair.generate();
  fs.writeFileSync(filePath, JSON.stringify(Array.from(keypair.secretKey)));
  return keypair;
}

// Helper function to load mint info
function loadMintInfo(): { mint: PublicKey, name: string, symbol: string } {
  if (!fs.existsSync(CONFIG.mintInfoPath)) {
    throw new Error(`Mint info not found. Please run create-grx-token.ts first.`);
  }
  
  const mintInfo = JSON.parse(fs.readFileSync(CONFIG.mintInfoPath, "utf-8"));
  return {
    mint: new PublicKey(mintInfo.mint),
    name: mintInfo.name,
    symbol: mintInfo.symbol,
  };
}

// Helper function to format token amount
function formatTokenAmount(amount: number, decimals: number = CONFIG.tokenDecimals): string {
  return (amount / Math.pow(10, decimals)).toFixed(decimals);
}

// Helper function to parse token amount
function parseTokenAmount(amount: string | number, decimals: number = CONFIG.tokenDecimals): number {
  return Math.floor(Number(amount) * Math.pow(10, decimals));
}

// 1. Setup: Create 2 wallets
async function setupWallets(connection: Connection) {
  console.log("🔧 Setting up 2 wallets...\n");
  
  const wallet1 = loadOrCreateKeypair(CONFIG.wallet1Path, true);
  const wallet2 = loadOrCreateKeypair(CONFIG.wallet2Path, true);
  
  console.log("✅ Wallet 1 created:");
  console.log("   Public Key:", wallet1.publicKey.toBase58());
  console.log("   Keypair saved to:", CONFIG.wallet1Path);
  
  console.log("\n✅ Wallet 2 created:");
  console.log("   Public Key:", wallet2.publicKey.toBase58());
  console.log("   Keypair saved to:", CONFIG.wallet2Path);
  
  return { wallet1, wallet2 };
}

// Request SOL airdrop for wallets
async function requestAirdrop(connection: Connection) {
  console.log("💰 Requesting SOL airdrop for wallets...\n");
  
  const wallet1 = loadOrCreateKeypair(CONFIG.wallet1Path);
  const wallet2 = loadOrCreateKeypair(CONFIG.wallet2Path);
  
  try {
    const airdrop1 = await connection.requestAirdrop(wallet1.publicKey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(airdrop1);
    console.log("✅ Wallet 1 received 2 SOL");
    
    const airdrop2 = await connection.requestAirdrop(wallet2.publicKey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(airdrop2);
    console.log("✅ Wallet 2 received 2 SOL");
  } catch (error) {
    console.log("⚠️  Airdrop may have failed (rate limit or devnet issue)");
    console.log("   You may need to fund wallets manually");
  }
}

// 3. Check balances of both accounts
async function checkBalances(connection: Connection) {
  console.log("💰 Checking balances...\n");
  
  const mintInfo = loadMintInfo();
  const wallet1 = loadOrCreateKeypair(CONFIG.wallet1Path);
  const wallet2 = loadOrCreateKeypair(CONFIG.wallet2Path);
  
  // Get token accounts
  const wallet1TokenAccount = getAssociatedTokenAddressSync(
    mintInfo.mint,
    wallet1.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  
  const wallet2TokenAccount = getAssociatedTokenAddressSync(
    mintInfo.mint,
    wallet2.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  
  // Check SOL balances
  const wallet1Sol = await connection.getBalance(wallet1.publicKey);
  const wallet2Sol = await connection.getBalance(wallet2.publicKey);
  
  let wallet1GrxBalance = "0.000000000";
  let wallet2GrxBalance = "0.000000000";
  
  try {
    const wallet1Account = await getAccount(
      connection,
      wallet1TokenAccount,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    wallet1GrxBalance = formatTokenAmount(Number(wallet1Account.amount));
  } catch (error) {
    // Account not created yet
  }
  
  try {
    const wallet2Account = await getAccount(
      connection,
      wallet2TokenAccount,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    wallet2GrxBalance = formatTokenAmount(Number(wallet2Account.amount));
  } catch (error) {
    // Account not created yet
  }
  
  console.log("📊 Wallet 1:", wallet1.publicKey.toBase58());
  console.log("   🪙 GRX Balance:", wallet1GrxBalance, mintInfo.symbol);
  console.log("   💎 SOL Balance:", (wallet1Sol / LAMPORTS_PER_SOL).toFixed(4), "SOL");
  
  console.log("\n📊 Wallet 2:", wallet2.publicKey.toBase58());
  console.log("   🪙 GRX Balance:", wallet2GrxBalance, mintInfo.symbol);
  console.log("   💎 SOL Balance:", (wallet2Sol / LAMPORTS_PER_SOL).toFixed(4), "SOL");
  
  // Summary
  const totalGrx = parseFloat(wallet1GrxBalance) + parseFloat(wallet2GrxBalance);
  console.log("\n" + "=".repeat(60));
  console.log("📈 Total GRX:", totalGrx.toFixed(9), mintInfo.symbol);
  console.log("=".repeat(60));
}

// 4a. Mint tokens to a wallet
async function mintTokens(program: Program<any>, walletNum: number, amount: string) {
  console.log(`🪙 Minting ${amount} GRX to Wallet ${walletNum}...\n`);
  
  const provider = program.provider as anchor.AnchorProvider;
  const authority = provider.wallet as anchor.Wallet;
  const mintInfo = loadMintInfo();
  
  const targetWallet = walletNum === 1 
    ? loadOrCreateKeypair(CONFIG.wallet1Path)
    : loadOrCreateKeypair(CONFIG.wallet2Path);
  
  const mintAmount = parseTokenAmount(amount);
  
  // Get token account
  const tokenAccount = getAssociatedTokenAddressSync(
    mintInfo.mint,
    targetWallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  
  try {
    const tx = await program.methods
      .mintToWallet(new anchor.BN(mintAmount))
      .accounts({
        mint: mintInfo.mint,
        destination: tokenAccount,
        destinationOwner: targetWallet.publicKey,
        authority: authority.publicKey,
        payer: authority.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    
    console.log("✅ Minting successful!");
    console.log("   Amount:", amount, mintInfo.symbol);
    console.log("   To:", targetWallet.publicKey.toBase58());
    console.log("   Transaction:", tx);
  } catch (error) {
    console.error("❌ Minting failed:", error);
    throw error;
  }
}

// 4b. Burn tokens from a wallet
async function burnTokens(program: Program<any>, walletNum: number, amount: string) {
  console.log(`🔥 Burning ${amount} GRX from Wallet ${walletNum}...\n`);
  
  const provider = program.provider as anchor.AnchorProvider;
  const authority = provider.wallet as anchor.Wallet;
  const mintInfo = loadMintInfo();
  
  const sourceWallet = walletNum === 1 
    ? loadOrCreateKeypair(CONFIG.wallet1Path)
    : loadOrCreateKeypair(CONFIG.wallet2Path);
  
  const burnAmount = parseTokenAmount(amount);
  
  // Get token account
  const tokenAccount = getAssociatedTokenAddressSync(
    mintInfo.mint,
    sourceWallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  
  try {
    // Note: You'll need to add a burn instruction to your program
    // For now, this is a placeholder showing the structure
    console.log("⚠️  Burn instruction not yet implemented in the program");
    console.log("   You would need to add a 'burn' instruction to energy-token program");
    console.log("   Token account:", tokenAccount.toBase58());
    console.log("   Amount to burn:", amount, mintInfo.symbol);
    
    // Example of what the burn call would look like:
    // const tx = await program.methods
    //   .burn(new anchor.BN(burnAmount))
    //   .accounts({
    //     mint: mintInfo.mint,
    //     authority: authority.publicKey,
    //     tokenAccount: tokenAccount,
    //     tokenProgram: TOKEN_2022_PROGRAM_ID,
    //   })
    //   .rpc();
    
  } catch (error) {
    console.error("❌ Burning failed:", error);
    throw error;
  }
}

// 2. Transfer tokens between wallets
async function transferTokens(connection: Connection, amount: string) {
  console.log(`💸 Transferring ${amount} GRX from Wallet 1 to Wallet 2...\n`);
  
  const mintInfo = loadMintInfo();
  const wallet1 = loadOrCreateKeypair(CONFIG.wallet1Path);
  const wallet2 = loadOrCreateKeypair(CONFIG.wallet2Path);
  
  const transferAmount = parseTokenAmount(amount);
  
  // Get token accounts
  const wallet1TokenAccount = getAssociatedTokenAddressSync(
    mintInfo.mint,
    wallet1.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  
  const wallet2TokenAccount = getAssociatedTokenAddressSync(
    mintInfo.mint,
    wallet2.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  
  try {
    // Check if destination account exists, if not it needs to be created first
    try {
      await getAccount(connection, wallet2TokenAccount, undefined, TOKEN_2022_PROGRAM_ID);
    } catch (error) {
      console.log("⚠️  Wallet 2 token account doesn't exist. Mint to Wallet 2 first to create it.");
      throw new Error("Destination token account doesn't exist");
    }
    
    const signature = await transfer(
      connection,
      wallet1, // payer
      wallet1TokenAccount, // source
      wallet2TokenAccount, // destination
      wallet1, // owner
      BigInt(transferAmount),
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    
    console.log("✅ Transfer successful!");
    console.log("   Amount:", amount, mintInfo.symbol);
    console.log("   From:", wallet1.publicKey.toBase58());
    console.log("   To:", wallet2.publicKey.toBase58());
    console.log("   Transaction:", signature);
  } catch (error) {
    console.error("❌ Transfer failed:", error);
    throw error;
  }
}

// Complete demo flow
async function runCompleteDemo(program: Program<any>) {
  console.log("🎬 Running Complete Demo\n");
  console.log("=" .repeat(60) + "\n");
  
  const connection = program.provider.connection;
  
  // Step 1: Setup wallets
  console.log("STEP 1: Setup Wallets");
  console.log("-" .repeat(60));
  await setupWallets(connection);
  console.log("\n");
  
  // Step 2: Airdrop SOL
  console.log("STEP 2: Request SOL Airdrop");
  console.log("-" .repeat(60));
  await requestAirdrop(connection);
  console.log("\n");
  
  await sleep(2000);
  
  // Step 3: Check initial balances
  console.log("STEP 3: Check Initial Balances");
  console.log("-" .repeat(60));
  await checkBalances(connection);
  console.log("\n");
  
  await sleep(2000);
  
  // Step 4: Mint tokens to wallet 1
  console.log("STEP 4: Mint 1000 GRX to Wallet 1");
  console.log("-" .repeat(60));
  await mintTokens(program, 1, "1000");
  console.log("\n");
  
  await sleep(2000);
  
  // Step 5: Mint tokens to wallet 2
  console.log("STEP 5: Mint 500 GRX to Wallet 2");
  console.log("-" .repeat(60));
  await mintTokens(program, 2, "500");
  console.log("\n");
  
  await sleep(2000);
  
  // Step 6: Check balances after minting
  console.log("STEP 6: Check Balances After Minting");
  console.log("-" .repeat(60));
  await checkBalances(connection);
  console.log("\n");
  
  await sleep(2000);
  
  // Step 7: Transfer tokens
  console.log("STEP 7: Transfer 250 GRX from Wallet 1 to Wallet 2");
  console.log("-" .repeat(60));
  await transferTokens(connection, "250");
  console.log("\n");
  
  await sleep(2000);
  
  // Step 8: Final balances
  console.log("STEP 8: Check Final Balances");
  console.log("-" .repeat(60));
  await checkBalances(connection);
  console.log("\n");
  
  console.log("=" .repeat(60));
  console.log("✅ Complete demo finished!\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Main function
async function main() {
  const command = process.argv[2] || "help";
  const arg1 = process.argv[3];
  const arg2 = process.argv[4];
  
  // Setup provider
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;
  
  // For commands that don't need the program
  const nonProgramCommands = ["setup", "airdrop", "balances", "transfer", "help"];
  let program: Program<any> | null = null;
  
  if (!nonProgramCommands.includes(command)) {
    try {
      program = anchor.workspace.EnergyToken as Program<any>;
    } catch (error) {
      console.error("❌ Program not available. Please run 'anchor build' first.");
      process.exit(1);
    }
  }
  
  console.log("🚀 GRX Token Wallet Manager\n");
  console.log("=" .repeat(60));
  console.log("Cluster:", connection.rpcEndpoint);
  console.log("Authority:", provider.wallet.publicKey.toBase58());
  if (program) {
    console.log("Program ID:", program.programId.toBase58());
  }
  console.log("=" .repeat(60) + "\n");
  
  try {
    switch (command) {
      case "setup":
        await setupWallets(connection);
        break;
      
      case "airdrop":
        await requestAirdrop(connection);
        break;
      
      case "balances":
        await checkBalances(connection);
        break;
      
      case "transfer":
        if (!arg1) {
          console.error("❌ Please provide amount: transfer <amount>");
          process.exit(1);
        }
        await transferTokens(connection, arg1);
        await sleep(1000);
        await checkBalances(connection);
        break;
      
      case "mint":
        if (!arg1 || !arg2) {
          console.error("❌ Please provide wallet and amount: mint <wallet> <amount>");
          console.error("   Example: mint 1 100");
          process.exit(1);
        }
        if (!program) {
          console.error("❌ Program not available");
          process.exit(1);
        }
        await mintTokens(program, parseInt(arg1), arg2);
        await sleep(1000);
        await checkBalances(connection);
        break;
      
      case "burn":
        if (!arg1 || !arg2) {
          console.error("❌ Please provide wallet and amount: burn <wallet> <amount>");
          console.error("   Example: burn 1 50");
          process.exit(1);
        }
        if (!program) {
          console.error("❌ Program not available");
          process.exit(1);
        }
        await burnTokens(program, parseInt(arg1), arg2);
        await sleep(1000);
        await checkBalances(connection);
        break;
      
      case "all":
        if (!program) {
          console.error("❌ Program not available");
          process.exit(1);
        }
        await runCompleteDemo(program);
        break;
      
      case "help":
      default:
        console.log("Available commands:");
        console.log("  setup              - Create 2 new wallets and save keypairs");
        console.log("  airdrop            - Request SOL airdrop for both wallets");
        console.log("  balances           - Check balances of both accounts");
        console.log("  transfer <amount>  - Transfer tokens from wallet 1 to wallet 2");
        console.log("  mint <wallet> <amount> - Mint tokens to wallet (1 or 2)");
        console.log("  burn <wallet> <amount> - Burn tokens from wallet (1 or 2)");
        console.log("  all                - Run complete demo");
        console.log("\nExamples:");
        console.log("  ts-node scripts/grx-wallet-manager.ts setup");
        console.log("  ts-node scripts/grx-wallet-manager.ts mint 1 1000");
        console.log("  ts-node scripts/grx-wallet-manager.ts transfer 250");
        console.log("  ts-node scripts/grx-wallet-manager.ts balances");
        console.log("  ts-node scripts/grx-wallet-manager.ts all");
        break;
    }
  } catch (error) {
    console.error("\n❌ Error:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
