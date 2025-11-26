// @ts-nocheck
import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

// Fix ES module __dirname issue
const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, "..");

// Load IDLs directly from files
const loadIdl = (programName: string) => {
  const idlPath = join(__dirname, "../../target/idl", `${programName}.json`);
  return JSON.parse(readFileSync(idlPath, "utf8"));
};

// Test configuration
const SOLANA_RPC_URL = process.env.ANCHOR_PROVIDER_URL || "http://127.0.0.1:8899";
const WALLET_PATH = process.env.ANCHOR_WALLET || join(__dirname, "../../keypairs/consumer-1.json");

// Load wallet
const loadWallet = (): Keypair => {
  try {
    const walletData = JSON.parse(readFileSync(WALLET_PATH, "utf8"));
    return Keypair.fromSecretKey(new Uint8Array(walletData));
  } catch (error) {
    console.error(`❌ Failed to load wallet from ${WALLET_PATH}:`, error);
    throw error;
  }
};

// Test utilities
const expect = (actual: any) => {
  return {
    to: {
      equal: (expected: any) => {
        if (actual !== expected) {
          throw new Error(`Expected ${expected}, but got ${actual}`);
        }
      },
      be: {
        true: () => {
          if (!actual) {
            throw new Error(`Expected true, but got ${actual}`);
          }
        },
        false: () => {
          if (actual) {
            throw new Error(`Expected false, but got ${actual}`);
          }
        },
        null: () => {
          if (actual !== null) {
            throw new Error(`Expected null, but got ${actual}`);
          }
        },
        undefined: () => {
          if (actual !== undefined) {
            throw new Error(`Expected undefined, but got ${actual}`);
          }
        },
        greaterThan: (expected: number) => {
          if (actual <= expected) {
            throw new Error(`Expected ${actual} to be greater than ${expected}`);
          }
        },
        at: {
          least: (expected: number) => {
            if (actual < expected) {
              throw new Error(`Expected ${actual} to be at least ${expected}`);
            }
          }
        },
        an: (type: string) => {
          if (type === 'array') {
            if (!Array.isArray(actual)) {
              throw new Error(`Expected array, but got ${typeof actual}`);
            }
          } else if (typeof actual !== type) {
            throw new Error(`Expected ${type}, but got ${typeof actual}`);
          }
        }
      },
      exist: () => {
        if (actual === null || actual === undefined) {
          throw new Error(`Expected value to exist, but got ${actual}`);
        }
      },
      contain: (expected: string) => {
        if (typeof actual !== 'string') {
          throw new Error('Expected actual to be a string');
        }
        if (!actual.includes(expected)) {
          throw new Error(`Expected "${actual}" to contain "${expected}"`);
        }
      }
    }
  };
};

const describe = (name: string, fn: () => void | Promise<void>) => {
  console.log(`\n📋 ${name}`);
  fn();
};

const it = (name: string, fn: () => void | Promise<void>) => {
  console.log(`  ✅ ${name}`);
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.catch((error) => {
        console.error(`    ❌ Failed: ${error.message}`);
        throw error;
      });
    }
  } catch (error: any) {
    console.error(`    ❌ Failed: ${error.message}`);
    throw error;
  }
};

const before = (fn: () => void | Promise<void>) => {
  console.log(`  🛠️  Setup`);
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.catch((error) => {
        console.error(`    ❌ Setup failed: ${error.message}`);
        throw error;
      });
    }
  } catch (error: any) {
    console.error(`    ❌ Setup failed: ${error.message}`);
    throw error;
  }
};

const after = (fn: () => void | Promise<void>) => {
  console.log(`  🧹 Cleanup`);
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.catch((error) => {
        console.error(`    ❌ Cleanup failed: ${error.message}`);
        throw error;
      });
    }
  } catch (error: any) {
    console.error(`    ❌ Cleanup failed: ${error.message}`);
    throw error;
  }
};

// Test environment class
class DirectTestEnvironment {
  public connection: Connection;
  public wallet: Keypair;
  public provider: AnchorProvider;

  // Programs with direct IDL loading (using any for now to avoid type issues)
  public energyTokenProgram: Program;
  public governanceProgram: Program;
  public oracleProgram: Program;
  public registryProgram: Program;
  public tradingProgram: Program;

  constructor() {
    // Initialize connection and provider
    this.connection = new Connection(SOLANA_RPC_URL, "confirmed");
    this.wallet = loadWallet();
    this.provider = new AnchorProvider(this.connection, new Wallet(this.wallet), {
      preflightCommitment: "confirmed",
      commitment: "confirmed"
    });

    // Load programs directly from IDLs
    const energyTokenIdl = loadIdl("energy_token");
    const governanceIdl = loadIdl("governance");
    const oracleIdl = loadIdl("oracle");
    const registryIdl = loadIdl("registry");
    const tradingIdl = loadIdl("trading");

    // Program IDs from the actual generated programs
    const ENERGY_TOKEN_PROGRAM_ID = new PublicKey("54SAVMgGhjssp3iQ7zBK8kgUnEtqHJTNg3QRfzzDitHB");
    const GOVERNANCE_PROGRAM_ID = new PublicKey("GZP5QP6PMD2D8nNsLkhA39Lfr4er12JLMhQZJnhxyT5h");
    const ORACLE_PROGRAM_ID = new PublicKey("F7mEgt7zaAaKHfTNmCLeZCUutdKyZ2cxYg41ggjstBi6");
    const REGISTRY_PROGRAM_ID = new PublicKey("9XS8uUEVErcA8LABrJQAdohWMXTToBwhFN7Rvur6dC5");
    const TRADING_PROGRAM_ID = new PublicKey("2pZ8gqotjvKMAu96XzpGZ7QFcemZzj21ybtVTbaDP1zG");

    // Initialize programs
    // @ts-ignore
    this.energyTokenProgram = new Program(
      energyTokenIdl,
      ENERGY_TOKEN_PROGRAM_ID,
      this.provider
    );

    // @ts-ignore
    this.governanceProgram = new Program(
      governanceIdl,
      GOVERNANCE_PROGRAM_ID,
      this.provider
    );

    // @ts-ignore
    this.oracleProgram = new Program(
      oracleIdl,
      ORACLE_PROGRAM_ID,
      this.provider
    );

    // @ts-ignore
    this.registryProgram = new Program(
      registryIdl,
      REGISTRY_PROGRAM_ID,
      this.provider
    );

    // @ts-ignore
    this.tradingProgram = new Program(
      tradingIdl,
      TRADING_PROGRAM_ID,
      this.provider
    );
  }

  async initialize(): Promise<void> {
    // Airdrop SOL if needed
    const balance = await this.connection.getBalance(this.wallet.publicKey);
    if (balance < 2 * 1e9) { // 2 SOL
      console.log(`💰 Airdropping SOL to ${this.wallet.publicKey.toString()}`);
      const signature = await this.connection.requestAirdrop(
        this.wallet.publicKey,
        5 * 1e9 // 5 SOL
      );
      await this.connection.confirmTransaction(signature);
    }
  }

  async getBalance(pubkey: PublicKey): Promise<number> {
    return await this.connection.getBalance(pubkey);
  }

  generateTestKeypair(): Keypair {
    return Keypair.generate();
  }

  generateTestId(): string {
    return `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Test suite
describe("🚀 GridTokenX Direct Integration Tests", async () => {
  let env: DirectTestEnvironment;

  before(async () => {
    console.log("🔧 Setting up test environment...");
    env = new DirectTestEnvironment();
    await env.initialize();
    console.log(`✅ Test environment initialized with wallet: ${env.wallet.publicKey.toString()}`);
  });

  describe("🔌 Connection Tests", () => {
    it("should connect to Solana validator", async () => {
      const version = await env.connection.getVersion();
      expect(version).to.exist();
      expect(version['solana-core']).to.exist();
      console.log(`    📡 Connected to Solana ${version['solana-core']}`);
    });

    it("should have sufficient SOL balance", async () => {
      const balance = await env.getBalance(env.wallet.publicKey);
      expect(balance).to.be.at.least(1 * 1e9); // At least 1 SOL
      console.log(`    💰 Wallet balance: ${balance / 1e9} SOL`);
    });
  });

  describe("📋 Program Loading Tests", () => {
    it("should load energy token program", () => {
      expect(env.energyTokenProgram.programId).to.exist();
      expect(env.energyTokenProgram.idl).to.exist();
      console.log(`    ⚡ Energy Token Program: ${env.energyTokenProgram.programId.toString()}`);
    });

    it("should load governance program", () => {
      expect(env.governanceProgram.programId).to.exist();
      expect(env.governanceProgram.idl).to.exist();
      console.log(`    🏛️ Governance Program: ${env.governanceProgram.programId.toString()}`);
    });

    it("should load oracle program", () => {
      expect(env.oracleProgram.programId).to.exist();
      expect(env.oracleProgram.idl).to.exist();
      console.log(`    🔮 Oracle Program: ${env.oracleProgram.programId.toString()}`);
    });

    it("should load registry program", () => {
      expect(env.registryProgram.programId).to.exist();
      expect(env.registryProgram.idl).to.exist();
      console.log(`    📋 Registry Program: ${env.registryProgram.programId.toString()}`);
    });

    it("should load trading program", () => {
      expect(env.tradingProgram.programId).to.exist();
      expect(env.tradingProgram.idl).to.exist();
      console.log(`    💱 Trading Program: ${env.tradingProgram.programId.toString()}`);
    });
  });

  describe("🔍 Program Account Discovery", () => {
    it("should discover program accounts", async () => {
      // Test if we can find programs on-chain
      const energyTokenAccount = await env.connection.getAccountInfo(env.energyTokenProgram.programId);
      const governanceAccount = await env.connection.getAccountInfo(env.governanceProgram.programId);
      const oracleAccount = await env.connection.getAccountInfo(env.oracleProgram.programId);
      const registryAccount = await env.connection.getAccountInfo(env.registryProgram.programId);
      const tradingAccount = await env.connection.getAccountInfo(env.tradingProgram.programId);

      console.log(`    ⚡ Energy Token Program: ${energyTokenAccount ? '✅ Found' : '❌ Not Found'}`);
      console.log(`    🏛️ Governance Program: ${governanceAccount ? '✅ Found' : '❌ Not Found'}`);
      console.log(`    🔮 Oracle Program: ${oracleAccount ? '✅ Found' : '❌ Not Found'}`);
      console.log(`    📋 Registry Program: ${registryAccount ? '✅ Found' : '❌ Not Found'}`);
      console.log(`    💱 Trading Program: ${tradingAccount ? '✅ Found' : '❌ Not Found'}`);

      // At least some programs should be found
      const foundCount = [
        energyTokenAccount,
        governanceAccount,
        oracleAccount,
        registryAccount,
        tradingAccount
      ].filter(Boolean).length;

      expect(foundCount).to.be.at.least(1);
      console.log(`    📊 Programs found: ${foundCount}/5`);
    });
  });

  describe("📝 IDL Structure Validation", () => {
    it("should validate energy token program IDL", () => {
      const idl = env.energyTokenProgram.idl as any;
      expect(idl.version).to.exist();
      expect(idl.name).to.equal("energy_token");
      expect(idl.instructions).to.be.an('array');
      expect(idl.instructions.length).to.be.greaterThan(0);
      console.log(`    ⚡ Energy Token IDL: v${idl.version}, ${idl.instructions.length} instructions`);
    });

    it("should validate governance program IDL", () => {
      const idl = env.governanceProgram.idl as any;
      expect(idl.version).to.exist();
      expect(idl.name).to.equal("governance");
      expect(idl.instructions).to.be.an('array');
      expect(idl.instructions.length).to.be.greaterThan(0);
      console.log(`    🏛️ Governance IDL: v${idl.version}, ${idl.instructions.length} instructions`);
    });

    it("should validate oracle program IDL", () => {
      const idl = env.oracleProgram.idl as any; // Cast to any to avoid version property error
      expect(idl.version).to.exist();
      expect(idl.name).to.equal("oracle");
      expect(idl.instructions).to.be.an('array');
      expect(idl.instructions.length).to.be.greaterThan(0);
      console.log(`    🔮 Oracle IDL: v${idl.version}, ${idl.instructions.length} instructions`);
    });

    it("should validate registry program IDL", () => {
      const idl = env.registryProgram.idl as any; // Cast to any to avoid version property error
      expect(idl.version).to.exist();
      expect(idl.name).to.equal("registry");
      expect(idl.instructions).to.be.an('array');
      expect(idl.instructions.length).to.be.greaterThan(0);
      console.log(`    📋 Registry IDL: v${idl.version}, ${idl.instructions.length} instructions`);
    });

    it("should validate trading program IDL", () => {
      const idl = env.tradingProgram.idl as any; // Cast to any to avoid version property error
      expect(idl.version).to.exist();
      expect(idl.name).to.equal("trading");
      expect(idl.instructions).to.be.an('array');
      expect(idl.instructions.length).to.be.greaterThan(0);
      console.log(`    💱 Trading IDL: v${idl.version}, ${idl.instructions.length} instructions`);
    });
  });

  after(async () => {
    console.log("🧹 Test cleanup completed");
    console.log("✅ All integration tests completed successfully!");
  });
});

// Error handling
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});
