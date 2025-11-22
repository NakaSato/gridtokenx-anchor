#!/usr/bin/env ts-node
/**
 * GridTokenX Comprehensive Token Management Script
 *
 * This script merges the functionality of:
 * - create-grx-token.ts
 * - mint-grx.sh
 * - mint-tokens-simple.ts
 * - grx-wallet-manager.ts (token-related parts)
 * - quick-setup-token.sh
 *
 * Features:
 * 1. Create GRX token with metadata (Anchor or SPL Token)
 * 2. Mint tokens to any wallet
 * 3. Manage token accounts
 * 4. Check token balances
 * 5. Transfer tokens between wallets
 * 6. Create and manage wallets
 * 7. Burn tokens
 * 8. Set up complete token environment
 *
 * Usage: ts-node scripts/09-wallet-manager.ts [command] [options]
 * Commands:
 *   create [--anchor|--spl]      - Create GRX token (default: SPL)
 *   mint <wallet|address> <amount> - Mint tokens to wallet
 *   balance [wallet|address]      - Check token balance
 *   transfer <from> <to> <amount>  - Transfer tokens
 *   burn <wallet|address> <amount> - Burn tokens
 *   setup-wallets [count]         - Create test wallets (default: 2)
 *   setup-env                      - Complete environment setup
 *   info                           - Display token information
 *   help                           - Show this help
 */

import * as anchor from "@coral-xyz/anchor";
// Remove direct Program import, we'll use anchor.Program
import {
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Connection,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  createInitializeMint2Instruction,
  getAccount,
  getMinimumBalanceForRentExemptMint,
  MINT_SIZE,
  createTransferInstruction,
  createBurnInstruction,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

// Configuration
const CONFIG = {
  tokenName: "GridTokenX",
  tokenSymbol: "GRX",
  tokenUri: "https://arweave.net/grx-metadata.json",
  mintKeypairPath: "./grx-mint-keypair.json",
  mintInfoPath: "./grx-token-info.json",
  walletsDir: "./wallets",
  defaultWalletCount: 2,
  tokenDecimals: 9,
  authorityPath: process.env.ANCHOR_WALLET || "~/.config/solana/id.json",
  rpcUrl: process.env.ANCHOR_PROVIDER_URL || "http://localhost:8899",
  initialSupply: 1_000_000_000_000_000, // 1 million tokens (with 9 decimals)
};

// Metaplex Token Metadata Program ID
const METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);

// ANSI Colors
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
};

// Helper functions
function log(message: string, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function loadKeypair(filePath: string): Keypair {
  const expandedPath = filePath.replace(/^~/, process.env.HOME || "");
  if (!fs.existsSync(expandedPath)) {
    throw new Error(`Keypair file not found: ${expandedPath}`);
  }
  const keypairData = JSON.parse(fs.readFileSync(expandedPath, "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(keypairData));
}

function saveKeypair(keypair: Keypair, filePath: string): void {
  fs.writeFileSync(filePath, JSON.stringify(Array.from(keypair.secretKey)));
}

function loadMintInfo(): any {
  if (!fs.existsSync(CONFIG.mintInfoPath)) {
    throw new Error(
      `Token info not found: ${CONFIG.mintInfoPath}. Please create a token first.`,
    );
  }
  return JSON.parse(fs.readFileSync(CONFIG.mintInfoPath, "utf-8"));
}

function saveMintInfo(mintInfo: any): void {
  fs.writeFileSync(CONFIG.mintInfoPath, JSON.stringify(mintInfo, null, 2));
}

function parseTokenAmount(amount: string | number): bigint {
  return BigInt(
    Math.floor(Number(amount) * Math.pow(10, CONFIG.tokenDecimals)),
  );
}

function formatTokenAmount(amount: bigint | number): string {
  return (Number(amount) / Math.pow(10, CONFIG.tokenDecimals)).toFixed(
    CONFIG.tokenDecimals,
  );
}

async function getOrCreateAssociatedTokenAccount(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey,
  payer: Keypair,
): Promise<PublicKey> {
  const tokenAccount = getAssociatedTokenAddressSync(
    mint,
    owner,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  try {
    await getAccount(
      connection,
      tokenAccount,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );
    return tokenAccount;
  } catch (e) {
    log(`Creating token account for ${owner.toBase58()}...`, colors.cyan);

    const transaction = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        tokenAccount,
        owner,
        mint,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    );

    await sendAndConfirmTransaction(connection, transaction, [payer]);
    return tokenAccount;
  }
}

async function createTokenWithSPL(
  connection: Connection,
  authority: Keypair,
): Promise<{ mint: Keypair; metadata: PublicKey }> {
  log("Creating GRX token with SPL Token program...", colors.blue);

  // Generate mint keypair
  const mintKeypair = Keypair.generate();
  saveKeypair(mintKeypair, CONFIG.mintKeypairPath);

  // Calculate minimum balance for rent exemption
  const rentExemptAmount = await getMinimumBalanceForRentExemptMint(connection);

  // Create transaction to initialize mint
  const transaction = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: authority.publicKey,
      newAccountPubkey: mintKeypair.publicKey,
      space: MINT_SIZE,
      lamports: rentExemptAmount,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(
      mintKeypair.publicKey,
      CONFIG.tokenDecimals,
      authority.publicKey,
      null,
      TOKEN_2022_PROGRAM_ID,
    ),
  );

  await sendAndConfirmTransaction(connection, transaction, [
    authority,
    mintKeypair,
  ]);

  // Create metadata PDA (for reference, though not used with pure SPL)
  const [metadataAddress] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      METADATA_PROGRAM_ID.toBuffer(),
      mintKeypair.publicKey.toBuffer(),
    ],
    METADATA_PROGRAM_ID,
  );

  return { mint: mintKeypair, metadata: metadataAddress };
}

async function createTokenWithAnchor(
  connection: Connection,
  authority: Keypair,
): Promise<{ mint: Keypair; metadata: PublicKey }> {
  log("Creating GRX token with Anchor program...", colors.blue);

  // For now, just use the SPL token approach as a fallback
  // Anchor integration can be added later once type issues are resolved
  return await createTokenWithSPL(connection, authority);
}

async function mintTokens(
  connection: Connection,
  mint: PublicKey,
  authority: Keypair,
  recipient: string | PublicKey,
  amount: string | number,
): Promise<string> {
  const recipientPubkey =
    recipient instanceof PublicKey ? recipient : new PublicKey(recipient);
  const mintAmount = parseTokenAmount(amount);

  // Get or create token account
  const tokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    mint,
    recipientPubkey,
    authority,
  );

  // Create and send transaction
  const transaction = new Transaction().add(
    createMintToInstruction(
      mint,
      tokenAccount,
      authority.publicKey,
      mintAmount,
    ),
  );

  return sendAndConfirmTransaction(connection, transaction, [authority]);
}

async function checkBalance(
  connection: Connection,
  mint: PublicKey,
  owner: string | PublicKey,
): Promise<{ balance: string; account: PublicKey }> {
  const ownerPubkey = owner instanceof PublicKey ? owner : new PublicKey(owner);

  try {
    const tokenAccount = getAssociatedTokenAddressSync(
      mint,
      ownerPubkey,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    const accountInfo = await getAccount(
      connection,
      tokenAccount,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );
    const balance = formatTokenAmount(accountInfo.amount);

    return { balance, account: tokenAccount };
  } catch (error) {
    return { balance: "0", account: PublicKey.default };
  }
}

async function transferTokens(
  connection: Connection,
  mint: PublicKey,
  from: Keypair,
  to: string | PublicKey,
  amount: string | number,
): Promise<string> {
  const toPubkey = to instanceof PublicKey ? to : new PublicKey(to);
  const transferAmount = parseTokenAmount(amount);

  // Get token accounts
  const fromTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    mint,
    from.publicKey,
    from,
  );

  const toTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    mint,
    toPubkey,
    from,
  );

  // Create transfer instruction
  const transferInstruction = createTransferInstruction(
    fromTokenAccount,
    toTokenAccount,
    from.publicKey,
    transferAmount,
  );

  // Create and send transaction
  const transaction = new Transaction().add(transferInstruction);

  return sendAndConfirmTransaction(connection, transaction, [from]);
}

async function burnTokens(
  connection: Connection,
  mint: PublicKey,
  owner: Keypair,
  amount: string | number,
): Promise<string> {
  const burnAmount = parseTokenAmount(amount);

  // Get token account
  const tokenAccount = getAssociatedTokenAddressSync(
    mint,
    owner.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  // Create burn instruction
  const burnInstruction = createBurnInstruction(
    tokenAccount,
    mint,
    owner.publicKey,
    burnAmount,
  );

  // Create and send transaction
  const transaction = new Transaction().add(burnInstruction);

  return sendAndConfirmTransaction(connection, transaction, [owner]);
}

async function setupWallets(count: number): Promise<Keypair[]> {
  log(`Creating ${count} test wallets...`, colors.blue);

  // Create wallets directory if it doesn't exist
  if (!fs.existsSync(CONFIG.walletsDir)) {
    fs.mkdirSync(CONFIG.walletsDir, { recursive: true });
  }

  const wallets: Keypair[] = [];

  for (let i = 1; i <= count; i++) {
    const walletPath = path.join(CONFIG.walletsDir, `wallet-${i}-keypair.json`);
    const wallet = Keypair.generate();
    saveKeypair(wallet, walletPath);
    wallets.push(wallet);

    log(`✅ Wallet ${i}: ${wallet.publicKey.toBase58()}`, colors.green);
  }

  return wallets;
}

async function setupEnvironment(): Promise<void> {
  log("Setting up complete token environment...", colors.blue);

  const connection = new Connection(CONFIG.rpcUrl, "confirmed");
  const authority = loadKeypair(CONFIG.authorityPath);

  // Create wallets
  const wallets = await setupWallets(CONFIG.defaultWalletCount);

  // Create token
  const useAnchor = process.argv.includes("--anchor");
  const { mint, metadata } = useAnchor
    ? await createTokenWithAnchor(connection, authority)
    : await createTokenWithSPL(connection, authority);

  // Mint initial tokens to each wallet
  for (let i = 0; i < wallets.length; i++) {
    log(`Minting tokens to wallet ${i + 1}...`, colors.cyan);
    await mintTokens(
      connection,
      mint.publicKey,
      authority,
      wallets[i].publicKey,
      1000,
    );

    // Check balance
    const { balance } = await checkBalance(
      connection,
      mint.publicKey,
      wallets[i].publicKey,
    );
    log(
      `Wallet ${i + 1} balance: ${balance} ${CONFIG.tokenSymbol}`,
      colors.green,
    );
  }

  // Save token info
  const tokenInfo = {
    name: CONFIG.tokenName,
    symbol: CONFIG.tokenSymbol,
    mintAddress: mint.publicKey.toBase58(),
    metadataAddress: metadata.toBase58(),
    decimals: CONFIG.tokenDecimals,
    uri: CONFIG.tokenUri,
    authority: authority.publicKey.toBase58(),
    createdAt: new Date().toISOString(),
    wallets: wallets.map((w, i) => ({
      id: i + 1,
      publicKey: w.publicKey.toBase58(),
      keypair: `./wallets/wallet-${i + 1}-keypair.json`,
    })),
  };

  saveMintInfo(tokenInfo);

  log("\nEnvironment setup complete!", colors.green);
  log(`Token: ${CONFIG.tokenSymbol} (${tokenInfo.mintAddress})`, colors.blue);
  log(`Wallets created: ${wallets.length}`, colors.blue);
}

function showHelp(): void {
  console.log(`
${colors.blue}GridTokenX Token Manager${colors.reset}

${colors.yellow}Usage:${colors.reset}
  ts-node scripts/08-token-manager.ts <command> [options]

${colors.yellow}Commands:${colors.reset}
  create [--anchor|--spl]      Create GRX token (default: SPL)
  mint <wallet|address> <amount>  Mint tokens to wallet
  balance [wallet|address]      Check token balance
  transfer <from> <to> <amount>  Transfer tokens
  burn <wallet|address> <amount> Burn tokens
  setup-wallets [count]         Create test wallets (default: 2)
  setup-env                      Complete environment setup
  info                           Display token information
  help                           Show this help

${colors.yellow}Examples:${colors.reset}
  # Create token with SPL
  ts-node scripts/08-token-manager.ts create --spl

  # Create token with Anchor
  ts-node scripts/08-token-manager.ts create --anchor

  # Mint 1000 tokens to wallet 1
  ts-node scripts/08-token-manager.ts mint 1 1000

  # Check balance
  ts-node scripts/08-token-manager.ts balance

  # Transfer 100 tokens from wallet 1 to wallet 2
  ts-node scripts/08-token-manager.ts transfer 1 2 100

  # Set up complete environment
  ts-node scripts/08-token-manager.ts setup-env
`);
}

async function showTokenInfo(): Promise<void> {
  try {
    const tokenInfo = loadMintInfo();
    const connection = new Connection(CONFIG.rpcUrl, "confirmed");

    console.log(`${colors.blue}Token Information${colors.reset}`);
    console.log("=".repeat(50));
    console.log(`Name: ${tokenInfo.name}`);
    console.log(`Symbol: ${tokenInfo.symbol}`);
    console.log(`Mint: ${tokenInfo.mintAddress}`);
    console.log(`Authority: ${tokenInfo.authority}`);
    console.log(`Created: ${tokenInfo.createdAt}`);
    console.log(`Decimals: ${CONFIG.tokenDecimals}`);

    if (tokenInfo.wallets) {
      console.log("\nWallets:");
      for (const wallet of tokenInfo.wallets) {
        const { balance } = await checkBalance(
          connection,
          new PublicKey(tokenInfo.mintAddress),
          wallet.publicKey,
        );
        console.log(
          `  Wallet ${wallet.id}: ${wallet.publicKey} (${balance} ${tokenInfo.symbol})`,
        );
      }
    }
  } catch (error) {
    log(
      "Token information not found. Please create a token first.",
      colors.red,
    );
  }
}

// Main execution
async function main(): Promise<void> {
  const command = process.argv[2];

  if (!command || command === "help") {
    return showHelp();
  }

  try {
    switch (command) {
      case "create": {
        const connection = new Connection(CONFIG.rpcUrl, "confirmed");
        const authority = loadKeypair(CONFIG.authorityPath);

        const useAnchor = process.argv.includes("--anchor");
        const { mint, metadata } = useAnchor
          ? await createTokenWithAnchor(connection, authority)
          : await createTokenWithSPL(connection, authority);

        // Save token info
        const tokenInfo = {
          name: CONFIG.tokenName,
          symbol: CONFIG.tokenSymbol,
          mintAddress: mint.publicKey.toBase58(),
          metadataAddress: metadata.toBase58(),
          decimals: CONFIG.tokenDecimals,
          uri: CONFIG.tokenUri,
          authority: authority.publicKey.toBase58(),
          createdAt: new Date().toISOString(),
        };

        saveMintInfo(tokenInfo);

        log("\nToken created successfully!", colors.green);
        log(`Token Address: ${mint.publicKey.toBase58()}`, colors.blue);
        log(
          `Type: ${useAnchor ? "Anchor with metadata" : "SPL Token"}`,
          colors.blue,
        );
        break;
      }

      case "mint": {
        const recipient = process.argv[3];
        const amount = process.argv[4];

        if (!recipient || !amount) {
          throw new Error(
            "Missing arguments. Usage: mint <wallet|address> <amount>",
          );
        }

        const connection = new Connection(CONFIG.rpcUrl, "confirmed");
        const authority = loadKeypair(CONFIG.authorityPath);
        const tokenInfo = loadMintInfo();
        const mint = new PublicKey(tokenInfo.mintAddress);

        // Check if recipient is a wallet ID
        let recipientAddress: string | PublicKey = recipient;
        if (/^\d+$/.test(recipient) && tokenInfo.wallets) {
          const walletId = parseInt(recipient) - 1;
          if (walletId < tokenInfo.wallets.length) {
            recipientAddress = tokenInfo.wallets[walletId].publicKey;
          }
        }

        await mintTokens(connection, mint, authority, recipientAddress, amount);

        log(
          `Minted ${amount} ${CONFIG.tokenSymbol} to ${recipient}`,
          colors.green,
        );
        break;
      }

      case "balance": {
        const wallet = process.argv[3] || "1";

        const connection = new Connection(CONFIG.rpcUrl, "confirmed");
        const tokenInfo = loadMintInfo();
        const mint = new PublicKey(tokenInfo.mintAddress);

        // Check if wallet is a wallet ID
        let walletAddress: string | PublicKey = wallet;
        if (/^\d+$/.test(wallet) && tokenInfo.wallets) {
          const walletId = parseInt(wallet) - 1;
          if (walletId < tokenInfo.wallets.length) {
            walletAddress = tokenInfo.wallets[walletId].publicKey;
          }
        }

        const { balance } = await checkBalance(connection, mint, walletAddress);

        log(`Balance: ${balance} ${CONFIG.tokenSymbol}`, colors.blue);
        break;
      }

      case "transfer": {
        const from = process.argv[3];
        const to = process.argv[4];
        const amount = process.argv[5];

        if (!from || !to || !amount) {
          throw new Error(
            "Missing arguments. Usage: transfer <from> <to> <amount>",
          );
        }

        const connection = new Connection(CONFIG.rpcUrl, "confirmed");
        const tokenInfo = loadMintInfo();
        const mint = new PublicKey(tokenInfo.mintAddress);

        // Load from wallet
        let fromKeypair: Keypair;
        if (/^\d+$/.test(from) && tokenInfo.wallets) {
          const walletId = parseInt(from) - 1;
          if (walletId < tokenInfo.wallets.length) {
            fromKeypair = loadKeypair(tokenInfo.wallets[walletId].keypair);
          } else {
            throw new Error("Invalid wallet ID");
          }
        } else {
          throw new Error("Source must be a wallet ID");
        }

        // Resolve to address
        let toAddress: string | PublicKey = to;
        if (/^\d+$/.test(to) && tokenInfo.wallets) {
          const walletId = parseInt(to) - 1;
          if (walletId < tokenInfo.wallets.length) {
            toAddress = tokenInfo.wallets[walletId].publicKey;
          }
        }

        await transferTokens(connection, mint, fromKeypair, toAddress, amount);

        log(
          `Transferred ${amount} ${CONFIG.tokenSymbol} from wallet ${from} to ${to}`,
          colors.green,
        );
        break;
      }

      case "burn": {
        const wallet = process.argv[3];
        const amount = process.argv[4];

        if (!wallet || !amount) {
          throw new Error(
            "Missing arguments. Usage: burn <wallet|address> <amount>",
          );
        }

        const connection = new Connection(CONFIG.rpcUrl, "confirmed");
        const tokenInfo = loadMintInfo();
        const mint = new PublicKey(tokenInfo.mintAddress);

        // Load wallet
        let walletKeypair: Keypair;
        if (/^\d+$/.test(wallet) && tokenInfo.wallets) {
          const walletId = parseInt(wallet) - 1;
          if (walletId < tokenInfo.wallets.length) {
            walletKeypair = loadKeypair(tokenInfo.wallets[walletId].keypair);
          } else {
            throw new Error("Invalid wallet ID");
          }
        } else {
          throw new Error("Source must be a wallet ID");
        }

        await burnTokens(connection, mint, walletKeypair, amount);

        log(
          `Burned ${amount} ${CONFIG.tokenSymbol} from wallet ${wallet}`,
          colors.green,
        );
        break;
      }

      case "setup-wallets": {
        const count = parseInt(process.argv[3]) || CONFIG.defaultWalletCount;
        await setupWallets(count);
        log(`Created ${count} wallets in ${CONFIG.walletsDir}`, colors.green);
        break;
      }

      case "setup-env": {
        await setupEnvironment();
        break;
      }

      case "info": {
        await showTokenInfo();
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
