import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

/**
 * Keypair role definitions for GridTokenX testing
 */
export enum KeypairRole {
  AUTHORITY = "authority",
  PRODUCER = "producer",
  CONSUMER = "consumer",
  ORACLE = "oracle",
  GOVERNANCE = "governance",
  TREASURY = "treasury",
  TESTING = "testing",
}

/**
 * Keypair configuration with role and SOL balance requirements
 */
export interface KeypairConfig {
  name: string;
  filename: string;
  role: KeypairRole;
  description: string;
  minSolBalance: number;
}

/**
 * Loaded keypair with metadata
 */
export interface LoadedKeypair {
  name: string;
  keypair: Keypair;
  role: KeypairRole;
  publicKey: PublicKey;
  balance: number;
}

/**
 * Centralized keypair manager for transaction testing
 * Manages all 16 keypairs with role-based grouping and validation
 */
export class KeypairManager {
  private connection: Connection;
  private keypairsDir: string;
  private loadedKeypairs: Map<string, LoadedKeypair> = new Map();

  // Keypair configurations matching wallet-setup script
  private readonly KEYPAIR_CONFIGS: KeypairConfig[] = [
    // Authorities
    {
      name: "dev-wallet",
      filename: "dev-wallet.json",
      role: KeypairRole.AUTHORITY,
      description: "Development and testing authority",
      minSolBalance: 10,
    },
    {
      name: "governance-authority",
      filename: "governance-authority.json",
      role: KeypairRole.GOVERNANCE,
      description: "Governance PoA authority for ERC issuance",
      minSolBalance: 5,
    },
    {
      name: "oracle-authority",
      filename: "oracle-authority.json",
      role: KeypairRole.ORACLE,
      description: "Oracle authority for data submission",
      minSolBalance: 5,
    },
    {
      name: "treasury-wallet",
      filename: "treasury-wallet.json",
      role: KeypairRole.TREASURY,
      description: "Project treasury wallet",
      minSolBalance: 5,
    },

    // Producers (Prosumers)
    {
      name: "producer-1",
      filename: "producer-1.json",
      role: KeypairRole.PRODUCER,
      description: "Energy producer 1 (Solar)",
      minSolBalance: 3,
    },
    {
      name: "producer-2",
      filename: "producer-2.json",
      role: KeypairRole.PRODUCER,
      description: "Energy producer 2 (Wind)",
      minSolBalance: 3,
    },
    {
      name: "producer-3",
      filename: "producer-3.json",
      role: KeypairRole.PRODUCER,
      description: "Energy producer 3 (Battery)",
      minSolBalance: 3,
    },

    // Consumers
    {
      name: "consumer-1",
      filename: "consumer-1.json",
      role: KeypairRole.CONSUMER,
      description: "Energy consumer 1 (Residential)",
      minSolBalance: 3,
    },
    {
      name: "consumer-2",
      filename: "consumer-2.json",
      role: KeypairRole.CONSUMER,
      description: "Energy consumer 2 (Commercial)",
      minSolBalance: 3,
    },

    // Testing wallets
    {
      name: "wallet-1",
      filename: "wallet-1-keypair.json",
      role: KeypairRole.TESTING,
      description: "Primary test wallet for performance testing",
      minSolBalance: 3,
    },
    {
      name: "wallet-2",
      filename: "wallet-2-keypair.json",
      role: KeypairRole.TESTING,
      description: "Secondary test wallet for performance testing",
      minSolBalance: 3,
    },
    {
      name: "test-wallet-3",
      filename: "test-wallet-3.json",
      role: KeypairRole.TESTING,
      description: "Additional test wallet 3",
      minSolBalance: 2,
    },
    {
      name: "test-wallet-4",
      filename: "test-wallet-4.json",
      role: KeypairRole.TESTING,
      description: "Additional test wallet 4",
      minSolBalance: 2,
    },
    {
      name: "test-wallet-5",
      filename: "test-wallet-5.json",
      role: KeypairRole.TESTING,
      description: "Additional test wallet 5",
      minSolBalance: 2,
    },
  ];

  constructor(connection: Connection, keypairsDir: string = "./keypairs") {
    this.connection = connection;
    this.keypairsDir = keypairsDir;
  }

  /**
   * Load all keypairs from the keypairs directory
   */
  async loadAllKeypairs(): Promise<void> {
    console.log(`🔑 Loading all keypairs from ${this.keypairsDir}...`);

    for (const config of this.KEYPAIR_CONFIGS) {
      try {
        const loadedKeypair = await this.loadKeypair(config);
        this.loadedKeypairs.set(config.name, loadedKeypair);
        console.log(
          `  ✓ Loaded ${config.name} (${config.role}): ${loadedKeypair.publicKey.toBase58()}`
        );
      } catch (error: any) {
        console.error(`  ✗ Failed to load ${config.name}: ${error.message}`);
        throw error;
      }
    }

    console.log(`✅ Loaded ${this.loadedKeypairs.size} keypairs successfully\n`);
  }

  /**
   * Load a single keypair from file
   */
  private async loadKeypair(config: KeypairConfig): Promise<LoadedKeypair> {
    const filePath = path.join(this.keypairsDir, config.filename);

    if (!fs.existsSync(filePath)) {
      throw new Error(`Keypair file not found: ${filePath}`);
    }

    const secretKey = Uint8Array.from(JSON.parse(fs.readFileSync(filePath, "utf8")));
    const keypair = Keypair.fromSecretKey(secretKey);
    const publicKey = keypair.publicKey;

    // Get current balance
    const balance = await this.connection.getBalance(publicKey);
    const balanceInSol = balance / LAMPORTS_PER_SOL;

    return {
      name: config.name,
      keypair,
      role: config.role,
      publicKey,
      balance: balanceInSol,
    };
  }

  /**
   * Validate all keypairs have sufficient SOL balance
   */
  async validateBalances(): Promise<boolean> {
    console.log("💰 Validating keypair balances...");

    let allValid = true;
    const insufficientBalances: string[] = [];

    for (const config of this.KEYPAIR_CONFIGS) {
      const loaded = this.loadedKeypairs.get(config.name);
      if (!loaded) {
        console.error(`  ✗ ${config.name}: Not loaded`);
        allValid = false;
        continue;
      }

      if (loaded.balance < config.minSolBalance) {
        console.warn(
          `  ⚠️  ${config.name}: ${loaded.balance.toFixed(4)} SOL (need ${config.minSolBalance} SOL)`
        );
        insufficientBalances.push(config.name);
        allValid = false;
      } else {
        console.log(`  ✓ ${config.name}: ${loaded.balance.toFixed(4)} SOL`);
      }
    }

    if (insufficientBalances.length > 0) {
      console.warn(
        `\n⚠️  ${insufficientBalances.length} keypair(s) have insufficient balance.`
      );
      console.warn("Run 'npm run wallet:setup' to fund all wallets.\n");
    } else {
      console.log("✅ All keypairs have sufficient balance\n");
    }

    return allValid;
  }

  /**
   * Get keypair by name
   */
  getKeypair(name: string): Keypair {
    const loaded = this.loadedKeypairs.get(name);
    if (!loaded) {
      throw new Error(`Keypair not found: ${name}`);
    }
    return loaded.keypair;
  }

  /**
   * Get all keypairs by role
   */
  getKeypairsByRole(role: KeypairRole): LoadedKeypair[] {
    return Array.from(this.loadedKeypairs.values()).filter(
      (kp) => kp.role === role
    );
  }

  /**
   * Get all producer keypairs
   */
  getProducers(): LoadedKeypair[] {
    return this.getKeypairsByRole(KeypairRole.PRODUCER);
  }

  /**
   * Get all consumer keypairs
   */
  getConsumers(): LoadedKeypair[] {
    return this.getKeypairsByRole(KeypairRole.CONSUMER);
  }

  /**
   * Get governance authority keypair
   */
  getGovernanceAuthority(): Keypair {
    return this.getKeypair("governance-authority");
  }

  /**
   * Get oracle authority keypair
   */
  getOracleAuthority(): Keypair {
    return this.getKeypair("oracle-authority");
  }

  /**
   * Get dev wallet (main authority)
   */
  getDevWallet(): Keypair {
    return this.getKeypair("dev-wallet");
  }

  /**
   * Get all testing keypairs
   */
  getTestingKeypairs(): LoadedKeypair[] {
    return this.getKeypairsByRole(KeypairRole.TESTING);
  }

  /**
   * Get all loaded keypairs
   */
  getAllKeypairs(): LoadedKeypair[] {
    return Array.from(this.loadedKeypairs.values());
  }

  /**
   * Get keypair count by role
   */
  getKeypairCount(): Map<KeypairRole, number> {
    const counts = new Map<KeypairRole, number>();

    for (const loaded of this.loadedKeypairs.values()) {
      counts.set(loaded.role, (counts.get(loaded.role) || 0) + 1);
    }

    return counts;
  }

  /**
   * Print summary of loaded keypairs
   */
  printSummary(): void {
    console.log("📊 Keypair Manager Summary");
    console.log("═".repeat(60));

    const counts = this.getKeypairCount();
    console.log(`Total Keypairs: ${this.loadedKeypairs.size}`);

    for (const [role, count] of counts) {
      console.log(`  ${role}: ${count}`);
    }

    console.log("\nKeypairs by Role:");
    for (const role of Object.values(KeypairRole)) {
      const keypairs = this.getKeypairsByRole(role);
      if (keypairs.length > 0) {
        console.log(`\n  ${role.toUpperCase()}:`);
        for (const kp of keypairs) {
          console.log(
            `    - ${kp.name.padEnd(25)} ${kp.publicKey.toBase58().substring(0, 8)}... (${kp.balance.toFixed(4)} SOL)`
          );
        }
      }
    }

    console.log("═".repeat(60) + "\n");
  }

  /**
   * Request airdrop for a specific keypair (localnet only)
   */
  async requestAirdrop(name: string, amount: number): Promise<void> {
    const loaded = this.loadedKeypairs.get(name);
    if (!loaded) {
      throw new Error(`Keypair not found: ${name}`);
    }

    console.log(`💸 Requesting ${amount} SOL airdrop for ${name}...`);

    try {
      const signature = await this.connection.requestAirdrop(
        loaded.publicKey,
        amount * LAMPORTS_PER_SOL
      );

      await this.connection.confirmTransaction(signature, "confirmed");

      // Update balance
      const newBalance = await this.connection.getBalance(loaded.publicKey);
      loaded.balance = newBalance / LAMPORTS_PER_SOL;

      console.log(`  ✓ Airdrop successful. New balance: ${loaded.balance.toFixed(4)} SOL`);
    } catch (error: any) {
      console.error(`  ✗ Airdrop failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Airdrop to all keypairs with insufficient balance (localnet only)
   */
  async airdropToAll(amountPerKeypair: number = 10): Promise<void> {
    console.log(`💸 Airdropping ${amountPerKeypair} SOL to all keypairs...\n`);

    for (const config of this.KEYPAIR_CONFIGS) {
      const loaded = this.loadedKeypairs.get(config.name);
      if (!loaded) continue;

      if (loaded.balance < config.minSolBalance) {
        try {
          await this.requestAirdrop(config.name, amountPerKeypair);
        } catch (error: any) {
          console.warn(`  ⚠️  Failed to airdrop to ${config.name}: ${error.message}`);
        }
      }
    }

    console.log("\n✅ Airdrop completed\n");
  }
}

export default KeypairManager;
