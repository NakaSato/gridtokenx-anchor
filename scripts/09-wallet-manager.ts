#!/usr/bin/env ts-node
/**
 * GridTokenX Wallet Manager
 *
 * This script focuses on wallet management functionality separated from the token manager.
 * Use this for wallet-specific operations like creating, importing, and managing wallets.
 *
 * Features:
 * 1. Create new wallets
 * 2. Import existing wallets from private keys
 * 3. List all managed wallets
 * 4. Export wallet information
 * 5. Request SOL airdrops to wallets
 * 6. Check SOL balances
 * 7. Clean up wallet files
 *
 * Usage: ts-node scripts/09-wallet-manager.ts [command] [options]
 * Commands:
 *   create [name]               - Create a new wallet (optional name)
 *   import <privateKey> [name]  - Import wallet from private key (optional name)
 *   list                        - List all managed wallets
 *   airdrop <walletId|all>      - Request SOL airdrop to wallet(s)
 *   balance <walletId|all>       - Check SOL balance of wallet(s)
 *   export <walletId>           - Export wallet information
 *   clean                       - Clean up wallet files
 *   help                        - Show this help
 */

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

// Configuration
const CONFIG = {
  walletsDir: "./wallets",
  rpcUrl: process.env.ANCHOR_PROVIDER_URL || "http://localhost:8899",
  walletInfoFile: "./wallets/wallets.json",
};

// ANSI Colors
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

// Helper functions
function log(message: string, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function ensureWalletsDirectory() {
  if (!fs.existsSync(CONFIG.walletsDir)) {
    fs.mkdirSync(CONFIG.walletsDir, { recursive: true });
  }
}

function getWalletsInfo(): any[] {
  if (!fs.existsSync(CONFIG.walletInfoFile)) {
    return [];
  }
  return JSON.parse(fs.readFileSync(CONFIG.walletInfoFile, "utf-8"));
}

function saveWalletsInfo(wallets: any[]) {
  fs.writeFileSync(CONFIG.walletInfoFile, JSON.stringify(wallets, null, 2));
}

function getNextWalletId(): number {
  const wallets = getWalletsInfo();
  if (wallets.length === 0) return 1;

  const maxId = Math.max(...wallets.map((w: any) => w.id));
  return maxId + 1;
}

function createWallet(name?: string): {
  id: number;
  keypair: Keypair;
  name: string;
} {
  ensureWalletsDirectory();

  const walletId = getNextWalletId();
  const walletName = name || `wallet-${walletId}`;
  const keypair = Keypair.generate();

  // Save keypair
  const keypairPath = path.join(
    CONFIG.walletsDir,
    `${walletName}-keypair.json`,
  );
  fs.writeFileSync(keypairPath, JSON.stringify(Array.from(keypair.secretKey)));

  // Update wallets info
  const wallets = getWalletsInfo();
  wallets.push({
    id: walletId,
    name: walletName,
    publicKey: keypair.publicKey.toBase58(),
    keypairPath,
    createdAt: new Date().toISOString(),
  });
  saveWalletsInfo(wallets);

  return { id: walletId, keypair, name: walletName };
}

function importWallet(
  privateKey: string,
  name?: string,
): { id: number; keypair: Keypair; name: string } {
  ensureWalletsDirectory();

  // Convert private key to Uint8Array
  let secretKey: Uint8Array;
  try {
    if (privateKey.startsWith("[") && privateKey.endsWith("]")) {
      // Array format
      secretKey = new Uint8Array(JSON.parse(privateKey));
    } else if (privateKey.length === 64 || privateKey.length === 66) {
      // Hex format
      secretKey = new Uint8Array(
        privateKey.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)),
      );
    } else {
      throw new Error("Invalid private key format");
    }

    const keypair = Keypair.fromSecretKey(secretKey);
    const walletId = getNextWalletId();
    const walletName = name || `wallet-${walletId}`;

    // Save keypair
    const keypairPath = path.join(
      CONFIG.walletsDir,
      `${walletName}-keypair.json`,
    );
    fs.writeFileSync(
      keypairPath,
      JSON.stringify(Array.from(keypair.secretKey)),
    );

    // Update wallets info
    const wallets = getWalletsInfo();
    wallets.push({
      id: walletId,
      name: walletName,
      publicKey: keypair.publicKey.toBase58(),
      keypairPath,
      importedAt: new Date().toISOString(),
    });
    saveWalletsInfo(wallets);

    return { id: walletId, keypair, name: walletName };
  } catch (error: any) {
    throw new Error(`Failed to import wallet: ${error.message}`);
  }
}

function listWallets() {
  const wallets = getWalletsInfo();

  if (wallets.length === 0) {
    log("No wallets found. Create one with 'create' command.", colors.yellow);
    return;
  }

  console.log(`${colors.blue}Managed Wallets${colors.reset}`);
  console.log("=".repeat(80));
  console.log(
    `${"ID".padEnd(4)} ${"Name".padEnd(20)} ${"Public Key".padEnd(45)} ${"Created".padEnd(20)}`,
  );
  console.log("-".repeat(80));

  wallets.forEach((wallet: any) => {
    const createdAt = wallet.createdAt || wallet.importedAt || "Unknown";
    console.log(
      `${wallet.id.toString().padEnd(4)} ${wallet.name.padEnd(20)} ${wallet.publicKey.padEnd(45)} ${createdAt.substring(0, 10)}`,
    );
  });
}

async function getWalletBalance(
  connection: Connection,
  publicKey: string,
): Promise<string> {
  try {
    const balance = await connection.getBalance(new PublicKey(publicKey));
    return (balance / LAMPORTS_PER_SOL).toFixed(4);
  } catch (error) {
    return "0.0000";
  }
}

async function checkBalance(walletId?: string) {
  const connection = new Connection(CONFIG.rpcUrl, "confirmed");
  const wallets = getWalletsInfo();

  if (wallets.length === 0) {
    log("No wallets found. Create one with 'create' command.", colors.yellow);
    return;
  }

  const walletsToCheck =
    walletId === "all"
      ? wallets
      : wallets.filter((w: any) => w.id.toString() === walletId);

  if (walletsToCheck.length === 0) {
    log(`Wallet not found: ${walletId}`, colors.red);
    return;
  }

  console.log(`${colors.blue}Wallet Balances${colors.reset}`);
  console.log("=".repeat(80));
  console.log(
    `${"ID".padEnd(4)} ${"Name".padEnd(20)} ${"Public Key".padEnd(45)} ${"Balance (SOL)".padEnd(15)}`,
  );
  console.log("-".repeat(80));

  for (const wallet of walletsToCheck) {
    const balance = await getWalletBalance(connection, wallet.publicKey);
    console.log(
      `${wallet.id.toString().padEnd(4)} ${wallet.name.padEnd(20)} ${wallet.publicKey.padEnd(45)} ${balance.padEnd(15)}`,
    );
  }
}

async function requestAirdrop(walletId?: string) {
  const connection = new Connection(CONFIG.rpcUrl, "confirmed");
  const wallets = getWalletsInfo();

  if (wallets.length === 0) {
    log("No wallets found. Create one with 'create' command.", colors.yellow);
    return;
  }

  const walletsToAirdrop =
    walletId === "all"
      ? wallets
      : wallets.filter((w: any) => w.id.toString() === walletId);

  if (walletsToAirdrop.length === 0) {
    log(`Wallet not found: ${walletId}`, colors.red);
    return;
  }

  console.log(`${colors.blue}Requesting Airdrops${colors.reset}`);
  console.log("=".repeat(50));

  for (const wallet of walletsToAirdrop) {
    try {
      log(
        `Requesting airdrop for wallet ${wallet.id} (${wallet.name})...`,
        colors.cyan,
      );

      const signature = await connection.requestAirdrop(
        new PublicKey(wallet.publicKey),
        1 * LAMPORTS_PER_SOL,
      );

      await connection.confirmTransaction(signature);

      const balance = await getWalletBalance(connection, wallet.publicKey);
      log(`✅ Wallet ${wallet.id}: ${balance} SOL`, colors.green);
    } catch (error: any) {
      log(
        `❌ Wallet ${wallet.id}: Airdrop failed - ${error.message}`,
        colors.red,
      );
    }
  }
}

function exportWallet(walletId: string) {
  const wallets = getWalletsInfo();
  const wallet = wallets.find((w: any) => w.id.toString() === walletId);

  if (!wallet) {
    log(`Wallet not found: ${walletId}`, colors.red);
    return;
  }

  // Load keypair
  const keypairPath = path.join(
    CONFIG.walletsDir,
    `${wallet.name}-keypair.json`,
  );
  if (!fs.existsSync(keypairPath)) {
    log(`Keypair file not found for wallet ${walletId}`, colors.red);
    return;
  }

  const keypairData = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));

  console.log(`${colors.blue}Wallet Information${colors.reset}`);
  console.log("=".repeat(50));
  console.log(`ID: ${wallet.id}`);
  console.log(`Name: ${wallet.name}`);
  console.log(`Public Key: ${wallet.publicKey}`);
  console.log(`Private Key (Array): ${JSON.stringify(keypairData)}`);
  console.log(`Private Key (Hex): ${Buffer.from(keypairData).toString("hex")}`);
  console.log(`Keypair Path: ${keypairPath}`);
}

function cleanWallets() {
  log("Cleaning up wallet files...", colors.yellow);

  if (!fs.existsSync(CONFIG.walletsDir)) {
    log("No wallets directory found.", colors.yellow);
    return;
  }

  // Remove wallets info file
  if (fs.existsSync(CONFIG.walletInfoFile)) {
    fs.unlinkSync(CONFIG.walletInfoFile);
  }

  // Remove all keypair files
  const files = fs.readdirSync(CONFIG.walletsDir);
  for (const file of files) {
    if (file.endsWith("-keypair.json")) {
      fs.unlinkSync(path.join(CONFIG.walletsDir, file));
      log(`Removed: ${file}`, colors.green);
    }
  }

  log("Wallet cleanup complete.", colors.green);
}

function showHelp() {
  console.log(`
${colors.blue}GridTokenX Wallet Manager${colors.reset}

${colors.yellow}Usage:${colors.reset}
  ts-node scripts/09-wallet-manager.ts <command> [options]

${colors.yellow}Commands:${colors.reset}
  create [name]               Create a new wallet (optional name)
  import <privateKey> [name]  Import wallet from private key (optional name)
  list                        List all managed wallets
  airdrop <walletId|all>      Request SOL airdrop to wallet(s)
  balance <walletId|all>       Check SOL balance of wallet(s)
  export <walletId>           Export wallet information
  clean                       Clean up wallet files
  help                        Show this help

${colors.yellow}Examples:${colors.reset}
  # Create a new wallet
  ts-node scripts/09-wallet-manager.ts create my-wallet

  # Import a wallet from private key
  ts-node scripts/09-wallet-manager.ts import "[1,2,3,4,...]" imported-wallet

  # List all wallets
  ts-node scripts/09-wallet-manager.ts list

  # Request airdrop for wallet 1
  ts-node scripts/09-wallet-manager.ts airdrop 1

  # Request airdrop for all wallets
  ts-node scripts/09-wallet-manager.ts airdrop all

  # Check balance of wallet 1
  ts-node scripts/09-wallet-manager.ts balance 1
`);
}

// Main execution
async function main() {
  const command = process.argv[2];

  if (!command || command === "help") {
    return showHelp();
  }

  try {
    switch (command) {
      case "create": {
        const name = process.argv[3];
        const { id, keypair, name: walletName } = createWallet(name);

        log("✅ Wallet created successfully!", colors.green);
        log(`ID: ${id}`, colors.blue);
        log(`Name: ${walletName}`, colors.blue);
        log(`Public Key: ${keypair.publicKey.toBase58()}`, colors.blue);
        log(
          `Keypair saved to: ./wallets/${walletName}-keypair.json`,
          colors.blue,
        );
        break;
      }

      case "import": {
        const privateKey = process.argv[3];
        const name = process.argv[4];

        if (!privateKey) {
          throw new Error(
            "Private key is required. Usage: import <privateKey> [name]",
          );
        }

        const {
          id,
          keypair,
          name: walletName,
        } = importWallet(privateKey, name);

        log("✅ Wallet imported successfully!", colors.green);
        log(`ID: ${id}`, colors.blue);
        log(`Name: ${walletName}`, colors.blue);
        log(`Public Key: ${keypair.publicKey.toBase58()}`, colors.blue);
        log(
          `Keypair saved to: ./wallets/${walletName}-keypair.json`,
          colors.blue,
        );
        break;
      }

      case "list": {
        listWallets();
        break;
      }

      case "balance": {
        const walletId = process.argv[3];
        await checkBalance(walletId);
        break;
      }

      case "airdrop": {
        const walletId = process.argv[3];
        if (!walletId) {
          throw new Error(
            "Wallet ID or 'all' is required. Usage: airdrop <walletId|all>",
          );
        }
        await requestAirdrop(walletId);
        break;
      }

      case "export": {
        const walletId = process.argv[3];
        if (!walletId) {
          throw new Error("Wallet ID is required. Usage: export <walletId>");
        }
        exportWallet(walletId);
        break;
      }

      case "clean": {
        cleanWallets();
        break;
      }

      default: {
        log(`Unknown command: ${command}`, colors.red);
        showHelp();
        process.exit(1);
      }
    }
  } catch (error: any) {
    log(`Error: ${error.message || error}`, colors.red);
    process.exit(1);
  }
}

main().catch((error) => {
  log(`Fatal error: ${error.message || error}`, colors.red);
  process.exit(1);
});
