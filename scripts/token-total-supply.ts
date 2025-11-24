#!/usr/bin/env ts-node

/**
 * GridTokenX Total Supply Checker
 *
 * This standalone script displays the total supply of the GRX token.
 * It reads the token information from the saved token configuration
 * and queries the Solana network for the current mint information.
 *
 * Usage: ts-node scripts/token-total-supply.ts
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { getMint, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
// Local configuration - copied from token manager
const CONFIG = {
  rpcUrl: process.env.RPC_URL || "http://localhost:8899",
  mintInfoPath: process.env.MINT_INFO_PATH || "./grx-token-info.json",
};

// Color codes for output
const colors = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  reset: "\x1b[0m",
};

// Helper functions
function log(message: string, color: string = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logError(message: string) {
  log(`[ERROR] ${message}`, colors.red);
}

function logInfo(message: string) {
  log(`[INFO] ${message}`, colors.blue);
}

function logSuccess(message: string) {
  log(`[SUCCESS] ${message}`, colors.green);
}

// Function to load token info
function loadMintInfo() {
  // Default path to token info file
  const defaultPath = join(process.cwd(), CONFIG.mintInfoPath);

  if (!existsSync(defaultPath)) {
    throw new Error(
      `Token info file not found at ${defaultPath}. Please create a token first using 'npm run token:create'.`,
    );
  }

  try {
    const tokenInfo = JSON.parse(readFileSync(defaultPath, "utf8"));
    return tokenInfo;
  } catch (error) {
    throw new Error(`Failed to parse token info file: ${error}`);
  }
}

// Function to format token amount with decimals
function formatTokenAmount(amount: bigint | number, decimals: number): string {
  const divisor = Math.pow(10, decimals);
  const formattedAmount = Number(amount) / divisor;
  return formattedAmount.toLocaleString(undefined, {
    maximumFractionDigits: decimals,
  });
}

// Main function
async function main(): Promise<void> {
  try {
    logInfo("Fetching token total supply...");

    // Load token information
    const tokenInfo = loadMintInfo();

    // Create connection to Solana cluster
    const connection = new Connection(CONFIG.rpcUrl, "confirmed");

    // Get mint information
    const mintAddressStr = tokenInfo.mintAddress || tokenInfo.mint; // Handle both field names
    const mintAddress = new PublicKey(mintAddressStr);
    let mintInfo;

    // Try Token-2022 program first, then fall back to older Token program
    try {
      mintInfo = await getMint(
        connection,
        mintAddress,
        undefined,
        TOKEN_2022_PROGRAM_ID,
      );
    } catch (error) {
      // Fall back to older Token program
      mintInfo = await getMint(
        connection,
        mintAddress,
        undefined,
        TOKEN_PROGRAM_ID,
      );
    }

    // Calculate and format total supply
    const totalSupply = formatTokenAmount(mintInfo.supply, mintInfo.decimals);
    const supplyInRaw = mintInfo.supply.toString();

    // Display the results
    log("\n" + "=".repeat(60), colors.blue);
    log("Token Total Supply", colors.blue);
    log("=".repeat(60), colors.blue);

    log(`Token Name: ${tokenInfo.name}`, colors.reset);
    log(`Token Symbol: ${tokenInfo.symbol}`, colors.reset);
    log(`Mint Address: ${mintAddressStr}`, colors.reset);
    log(`Total Supply: ${totalSupply} ${tokenInfo.symbol}`, colors.green);
    log(`Supply in Raw Units: ${supplyInRaw}`, colors.reset);
    log(`Decimals: ${mintInfo.decimals}`, colors.reset);
    log(
      `Mint Authority: ${mintInfo.mintAuthority?.toBase58() || "Revoked"}`,
      colors.reset,
    );
    log(
      `Freeze Authority: ${mintInfo.freezeAuthority?.toBase58() || "Revoked"}`,
      colors.reset,
    );
    log(`Is Initialized: ${mintInfo.isInitialized}`, colors.reset);

    log("=".repeat(60), colors.blue);
    logSuccess("Total supply retrieved successfully!");
  } catch (error: any) {
    logError(`Failed to fetch total supply: ${error.message || error}`);
    process.exit(1);
  }
}

// Execute main function
main().catch((error) => {
  logError(`Fatal error: ${error.message || error}`);
  process.exit(1);
});
