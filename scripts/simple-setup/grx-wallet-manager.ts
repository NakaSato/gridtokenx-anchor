#!/usr/bin/env ts-node

/**
 * GRX Wallet Manager Script
 *
 * A simplified wallet management script for the GridTokenX project.
 * This script handles wallet setup, token minting, and account management.
 */

import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import {
  createAccount,
  createMint,
  getAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

// Configuration
const CONFIG = {
  rpcUrl: process.env.ANCHOR_PROVIDER_URL || "http://localhost:8999",
  wallet1Path: "./wallet-1-keypair.json",
  wallet2Path: "./wallet-2-keypair.json",
  tokenInfoPath: "./grx-token-info.json",
  decimals: 9,
};

// Utility functions
function loadKeypair(filePath: string): Keypair {
  if (!fs.existsSync(filePath)) {
    console.error(`❌ Keypair file not found: ${filePath}`);
    process.exit(1);
  }

  const secretKey = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

function saveKeypair(keypair: Keypair, filePath: string): void {
  fs.writeFileSync(filePath, JSON.stringify(Array.from(keypair.secretKey)));
}

function loadTokenInfo(): { mint: PublicKey; decimals: number } {
  if (!fs.existsSync(CONFIG.tokenInfoPath)) {
    console.error(`❌ Token info file not found: ${CONFIG.tokenInfoPath}`);
    process.exit(1);
  }

  const tokenInfo = JSON.parse(fs.readFileSync(CONFIG.tokenInfoPath, "utf-8"));
  return {
    mint: new PublicKey(tokenInfo.mint),
    decimals: tokenInfo.decimals,
  };
}

async function createTokenAccount(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey,
): Promise<PublicKey> {
  try {
    return getAssociatedTokenAddressSync(mint, owner, false);
  } catch (error) {
    console.error("Error getting associated token address:", error);
    process.exit(1);
  }
}

async function main() {
  const command = process.argv[2];
  const walletNum = process.argv[3];
  const amount = process.argv[4];

  if (!command) {
    console.log(`
GRX Wallet Manager
Usage: ts-node scripts/grx-wallet-manager.ts <command> [args]

Commands:
  setup               - Set up wallets and token mint
  mint <wallet> <amount> - Mint tokens to wallet
  balances            - Check wallet balances
  help               - Show this help message
    `);
    process.exit(0);
  }

  const connection = new Connection(CONFIG.rpcUrl);

  switch (command) {
    case "setup":
      await handleSetup(connection);
      break;

    case "mint":
      if (!walletNum || !amount) {
        console.error(
          "❌ Missing required arguments. Usage: ts-node grx-wallet-manager.ts mint <wallet> <amount>",
        );
        process.exit(1);
      }
      await handleMint(connection, parseInt(walletNum), amount);
      break;

    case "balances":
      await handleBalances(connection);
      break;

    case "help":
    default:
      console.log(`
GRX Wallet Manager
Usage: ts-node scripts/grx-wallet-manager.ts <command> [args]

Commands:
  setup               - Set up wallets and token mint
  mint <wallet> <amount> - Mint tokens to wallet (1 or 2)
  balances            - Check wallet balances
  help               - Show this help message
    `);
      break;
  }
}

async function handleSetup(connection: Connection) {
  console.log("🚀 GRX Token Setup\n");
  console.log("================================");

  // 1. Create wallets if they don't exist
  console.log("📝 Creating wallets...");
  let wallet1: Keypair;
  let wallet2: Keypair;

  if (fs.existsSync(CONFIG.wallet1Path)) {
    wallet1 = loadKeypair(CONFIG.wallet1Path);
    console.log(`  ✅ Wallet 1 loaded: ${wallet1.publicKey.toBase58()}`);
  } else {
    wallet1 = Keypair.generate();
    saveKeypair(wallet1, CONFIG.wallet1Path);
    console.log(`  ✅ Wallet 1 created: ${wallet1.publicKey.toBase58()}`);
  }

  if (fs.existsSync(CONFIG.wallet2Path)) {
    wallet2 = loadKeypair(CONFIG.wallet2Path);
    console.log(`  ✅ Wallet 2 loaded: ${wallet2.publicKey.toBase58()}`);
  } else {
    wallet2 = Keypair.generate();
    saveKeypair(wallet2, CONFIG.wallet2Path);
    console.log(`  ✅ Wallet 2 created: ${wallet2.publicKey.toBase58()}`);
  }

  // 2. Create token mint if it doesn't exist
  console.log("\n🪙 Creating token mint...");
  let tokenInfo;

  try {
    TokenInfo = loadTokenInfo();
    console.log(`  ✅ Token mint loaded: ${TokenInfo.mint.toBase58()}`);
  } catch (error) {
    console.log("  Creating new token mint...");
    const mintAuthority = Keypair.generate();

    const mint = await createMint(connection, mintAuthority, {
      decimals: CONFIG.decimals,
    });

    TokenInfo = {
      mint,
      decimals: CONFIG.decimals,
    };

    const tokenInfoData = {
      name: "GridTokenX",
      symbol: "GRX",
      mint: mint.toBase58(),
      decimals: CONFIG.decimals,
      createdAt: new Date().toISOString(),
    };

    fs.writeFileSync(
      CONFIG.tokenInfoPath,
      JSON.stringify(tokenInfoData, null, 2),
    );
    console.log(`  ✅ Token mint created: ${mint.toBase58()}`);
  }

  // 3. Create token accounts
  console.log("\n🏦 Creating token accounts...");
  const account1 = await createTokenAccount(
    connection,
    TokenInfo.mint,
    wallet1.publicKey,
  );
  console.log(`  ✅ Account 1: ${account1.toBase58()}`);

  const account2 = await createTokenAccount(
    connection,
    TokenInfo.mint,
    wallet2.publicKey,
  );
  console.log(`  ✅ Account 2: ${account2.toBase58()}`);

  // 4. Mint initial tokens
  console.log("\n💰 Minting initial tokens...");
  await mintTo(
    connection,
    wallet1.publicKey,
    TokenInfo.mint,
    wallet1,
    1000 * Math.pow(10, CONFIG.decimals), // 1000 tokens
    [account1],
  );
  console.log(`  ✅ Minted 1000 GRX to Wallet 1`);

  await mintTo(
    connection,
    wallet2.publicKey,
    TokenInfo.mint,
    wallet2,
    1000 * Math.pow(10, CONFIG.decimals), // 1000 tokens
    [account2],
  );
  console.log(`  ✅ Minted 1000 GRX to Wallet 2`);

  console.log("\n✅ Setup Complete!");
  console.log("================================");
  console.log(`RPC URL: ${CONFIG.rpcUrl}`);
  console.log(`Token Mint: ${TokenInfo.mint.toBase58()}`);
  console.log(`Wallet 1: ${wallet1.publicKey.toBase58()}`);
  console.log(`Wallet 2: ${wallet2.publicKey.toBase58()}`);
  console.log(
    "\nRun 'ts-node scripts/grx-wallet-manager.ts mint <wallet> <amount>' to mint more tokens.",
  );
}

async function handleMint(
  connection: Connection,
  walletNum: number,
  amount: string,
) {
  console.log(`💰 Minting ${amount} GRX to Wallet ${walletNum}...\n`);

  const wallet =
    walletNum === 1
      ? loadKeypair(CONFIG.wallet1Path)
      : loadKeypair(CONFIG.wallet2Path);

  const TokenInfo = loadTokenInfo();
  const owner = wallet.publicKey;
  const mintAmount = Math.floor(
    parseFloat(amount) * Math.pow(10, CONFIG.decimals),
  );

  try {
    const accountAddress = await createTokenAccount(
      connection,
      TokenInfo.mint,
      owner,
    );
    const signature = await mintTo(
      connection,
      owner,
      TokenInfo.mint,
      wallet,
      mintAmount,
      [accountAddress],
    );

    console.log(`✅ Minted ${amount} GRX to Wallet ${walletNum}`);
    console.log(`   Transaction: ${signature}`);
    console.log(`   Account: ${accountAddress.toBase58()}`);
  } catch (error: any) {
    console.error("❌ Error minting tokens:", error.message);
    process.exit(1);
  }
}

async function handleBalances(connection: Connection) {
  console.log("💰 Checking balances...\n");

  const wallet1 = loadKeypair(CONFIG.wallet1Path);
  const wallet2 = loadKeypair(CONFIG.wallet2Path);
  const TokenInfo = loadTokenInfo();

  try {
    const account1 = await getAccount(
      connection,
      await getAssociatedTokenAddressSync(TokenInfo.mint, wallet1.publicKey),
    );

    const account2 = await getAccount(
      connection,
      await getAssociatedTokenAddressSync(TokenInfo.mint, wallet2.publicKey),
    );

    const balance1 = account1.amount / Math.pow(10, CONFIG.decimals);
    const balance2 = account2.amount / Math.pow(10, CONFIG.decimals);

    console.log(`Wallet 1: ${balance1} GRX`);
    console.log(`Wallet 2: ${balance2} GRX`);
    console.log(`Total: ${balance1 + balance2} GRX`);
  } catch (error: any) {
    console.error("❌ Error checking balances:", error.message);
    process.exit(1);
  }
}

// Run the main function
main().catch((error) => {
  console.error("❌ Error:", error);
  process.exit(1);
});
