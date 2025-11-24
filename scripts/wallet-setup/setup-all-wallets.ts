#!/usr/bin/env ts-node

/**
 * GridTokenX Wallet Setup Script
 * 
 * This script sets up all necessary wallets for the GridTokenX project including:
 * - Creating wallet keypairs if they don't exist
 * - Airdropping SOL to wallets
 * - Setting up basic wallet configurations
 * - Verifying all wallet configurations
 */

import * as anchor from "@coral-xyz/anchor";
import { 
  PublicKey, 
  Keypair, 
  Connection, 
  LAMPORTS_PER_SOL} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

// Configuration
const SOLANA_URL = process.env.SOLANA_URL || "http://localhost:8899";
const KEYPAIRS_DIR = "./keypairs";

// Wallet configurations
const WALLET_CONFIGS = [
  {
    name: "dev-wallet",
    filename: "dev-wallet.json",
    description: "Development and testing wallet",
    solAmount: 100
  },
  {
    name: "wallet-1",
    filename: "wallet-1-keypair.json",
    description: "Primary test wallet for performance testing",
    solAmount: 5
  },
  {
    name: "wallet-2",
    filename: "wallet-2-keypair.json",
    description: "Secondary test wallet for performance testing",
    solAmount: 5
  },
  {
    name: "producer-1",
    filename: "producer-1.json",
    description: "Energy producer wallet 1",
    solAmount: 10
  },
  {
    name: "producer-2",
    filename: "producer-2.json",
    description: "Energy producer wallet 2",
    solAmount: 10
  },
  {
    name: "producer-3",
    filename: "producer-3.json",
    description: "Energy producer wallet 3",
    solAmount: 10
  },
  {
    name: "consumer-1",
    filename: "consumer-1.json",
    description: "Energy consumer wallet 1",
    solAmount: 10
  },
  {
    name: "consumer-2",
    filename: "consumer-2.json",
    description: "Energy consumer wallet 2",
    solAmount: 10
  },
  {
    name: "governance-authority",
    filename: "governance-authority.json",
    description: "Governance authority wallet",
    solAmount: 50
  },
  {
    name: "oracle-authority",
    filename: "oracle-authority.json",
    description: "Oracle authority wallet",
    solAmount: 20
  },
  {
    name: "treasury-wallet",
    filename: "treasury-wallet.json",
    description: "Project treasury wallet",
    solAmount: 100
  },
  {
    name: "test-wallet-3",
    filename: "test-wallet-3.json",
    description: "Additional test wallet 3",
    solAmount: 5
  },
  {
    name: "test-wallet-4",
    filename: "test-wallet-4.json",
    description: "Additional test wallet 4",
    solAmount: 5
  },
  {
    name: "test-wallet-5",
    filename: "test-wallet-5.json",
    description: "Additional test wallet 5",
    solAmount: 5
  }
];

class WalletSetup {
  private connection: Connection;
  private provider: anchor.AnchorProvider;
  private wallets: Map<string, Keypair> = new Map();

  constructor() {
    this.connection = new Connection(SOLANA_URL, "confirmed");
    
    // Set up provider with a default wallet for setup operations
    const defaultWalletKeypair = this.loadOrCreateKeypair("setup-authority-wallet.json");
    const wallet = new anchor.Wallet(defaultWalletKeypair);
    this.provider = new anchor.AnchorProvider(this.connection, wallet, {
      commitment: "confirmed",
      preflightCommitment: "confirmed"
    });
    anchor.setProvider(this.provider);
  }

  /**
   * Load existing keypair or create new one
   */
  private loadOrCreateKeypair(filename: string): Keypair {
    const filePath = path.join(KEYPAIRS_DIR, filename);
    
    try {
      if (fs.existsSync(filePath)) {
        const secretKey = Uint8Array.from(JSON.parse(fs.readFileSync(filePath, "utf8")));
        return Keypair.fromSecretKey(secretKey);
      }
    } catch (error) {
      console.warn(`Warning: Could not load keypair from ${filePath}, creating new one`);
    }

    // Create new keypair
    const keypair = Keypair.generate();
    this.saveKeypair(keypair, filename);
    return keypair;
  }

  /**
   * Save keypair to file
   */
  private saveKeypair(keypair: Keypair, filename: string): void {
    const filePath = path.join(KEYPAIRS_DIR, filename);
    
    // Ensure keypairs directory exists
    if (!fs.existsSync(KEYPAIRS_DIR)) {
      fs.mkdirSync(KEYPAIRS_DIR, { recursive: true });
    }

    fs.writeFileSync(filePath, JSON.stringify(Array.from(keypair.secretKey)));
    console.log(`Saved keypair: ${filename} -> ${keypair.publicKey.toBase58()}`);
  }

  /**
   * Request airdrop for a wallet
   */
  private async requestAirdrop(address: PublicKey, amount: number): Promise<void> {
    try {
      const balance = await this.connection.getBalance(address);
      const balanceInSol = balance / LAMPORTS_PER_SOL;
      
      console.log(`Current balance for ${address.toBase58()}: ${balanceInSol.toFixed(4)} SOL`);

      if (balanceInSol < amount) {
        console.log(`Requesting airdrop of ${amount} SOL to ${address.toBase58()}...`);
        const signature = await this.connection.requestAirdrop(address, amount * LAMPORTS_PER_SOL);
        
        await this.connection.confirmTransaction(signature, "confirmed");
        console.log(`✅ Airdrop successful: ${signature}`);
        
        const newBalance = await this.connection.getBalance(address);
        const newBalanceInSol = newBalance / LAMPORTS_PER_SOL;
        console.log(`💰 New balance: ${newBalanceInSol.toFixed(4)} SOL`);
      } else {
        console.log(`✅ Sufficient balance already available`);
      }
    } catch (error) {
      console.error(`❌ Error requesting airdrop: ${error}`);
      throw error;
    }
  }

  /**
   * Setup a single wallet
   */
  private async setupWallet(config: any): Promise<void> {
    console.log(`\n🔧 Setting up ${config.name} (${config.description})`);

    // Load or create wallet keypair
    const wallet = this.loadOrCreateKeypair(config.filename);
    this.wallets.set(config.name, wallet);

    console.log(`📍 Address: ${wallet.publicKey.toBase58()}`);

    // Request airdrop
    await this.requestAirdrop(wallet.publicKey, config.solAmount);

    console.log(`✅ ${config.name} setup complete`);
  }

  /**
   * Verify all wallet configurations
   */
  private async verifySetup(): Promise<void> {
    console.log(`\n🔍 Verifying wallet setup...`);

    let totalSOL = 0;

    for (const [name, wallet] of this.wallets) {
      try {
        // Check SOL balance
        const solBalance = await this.connection.getBalance(wallet.publicKey);
        const solBalanceInSol = solBalance / LAMPORTS_PER_SOL;
        totalSOL += solBalanceInSol;

        console.log(`  ${name}: ${solBalanceInSol.toFixed(4)} SOL`);
      } catch (error) {
        console.error(`  ❌ Error verifying ${name}: ${error}`);
      }
    }

    console.log(`\n📊 Summary:`);
    console.log(`  Total wallets: ${this.wallets.size}`);
    console.log(`  Total SOL: ${totalSOL.toFixed(4)} SOL`);
  }

  /**
   * Save wallet configuration summary
   */
  private saveWalletSummary(): void {
    const summaryPath = path.join(KEYPAIRS_DIR, "wallet-summary.json");
    const summary = {
      created: new Date().toISOString(),
      wallets: Array.from(this.wallets.entries()).map(([name, wallet]) => ({
        name,
        address: wallet.publicKey.toBase58(),
        filename: path.join(KEYPAIRS_DIR, `${name}.json`)
      }))
    };

    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    console.log(`💾 Wallet summary saved to ${summaryPath}`);
  }

  /**
   * Main setup function
   */
  async setup(): Promise<void> {
    console.log(`🚀 Starting GridTokenX Wallet Setup...`);
    console.log(`📍 Solana URL: ${SOLANA_URL}`);
    console.log(`📁 Keypairs directory: ${KEYPAIRS_DIR}`);

    try {
      // Check connection
      const version = await this.connection.getVersion();
      console.log(`✅ Connected to Solana cluster (version: ${version["solana-core"]})`);

      // Setup all wallets
      for (const config of WALLET_CONFIGS) {
        await this.setupWallet(config);
      }

      // Verify setup
      await this.verifySetup();

      // Save summary
      this.saveWalletSummary();

      console.log(`\n🎉 GridTokenX wallet setup completed successfully!`);
      console.log(`\n📝 Next steps:`);
      console.log(`  1. Set your ANCHOR_WALLET environment variable:`);
      console.log(`     export ANCHOR_WALLET=${path.join(KEYPAIRS_DIR, 'dev-wallet.json')}`);
      console.log(`  2. Run tests: npm test`);
      console.log(`  3. Check wallet documentation: docs/wallets/`);
      console.log(`  4. To set up tokens later, you can run: npm run wallet:setup:tokens`);

    } catch (error) {
      console.error(`❌ Setup failed: ${error}`);
      process.exit(1);
    }
  }
}

// Main execution
async function main() {
  const walletSetup = new WalletSetup();
  await walletSetup.setup();
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { WalletSetup };
