import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { 
  EnergyTokenProgram, 
  GovernanceProgram, 
  OracleProgram, 
  RegistryProgram, 
  TradingProgram 
} from "../target/types";

export const PROGRAM_IDS = {
  energy_token: "54SAVMgGhjssp3iQ7zBK8kgUnEtqHJTNg3QRfzzDitHB",
  governance: "GZP5QP6PMD2D8nNsLkhA39Lfr4er12JLMhQZJnhxyT5h",
  oracle: "F7mEgt7zaAaKHfTNmCLeZCUutdKyZ2cxYg41ggjstBi6",
  registry: "9XS8uUEVErcA8LABrJQAdohWMXTToBwhFN7Rvur6dC5",
  trading: "2pZ8gqotjvKMAu96XzpGZ7QFcemZzj21ybtVTbaDP1zG",
} as const;

export class TestEnvironment {
  public provider: anchor.AnchorProvider;
  public connection: anchor.web3.Connection;
  public wallet: anchor.Wallet;
  
  // Programs
  public energyTokenProgram: Program<EnergyTokenProgram>;
  public governanceProgram: Program<GovernanceProgram>;
  public oracleProgram: Program<OracleProgram>;
  public registryProgram: Program<RegistryProgram>;
  public tradingProgram: Program<TradingProgram>;

  // Test keypairs
  public authority: anchor.web3.Keypair;
  public testUser: anchor.web3.Keypair;
  public recValidator: anchor.web3.Keypair;

  constructor() {
    this.provider = anchor.AnchorProvider.env();
    anchor.setProvider(this.provider);
    
    this.connection = this.provider.connection;
    this.wallet = this.provider.wallet as anchor.Wallet;
    
    // Initialize programs
    this.energyTokenProgram = anchor.workspace.EnergyTokenProgram as Program<EnergyTokenProgram>;
    this.governanceProgram = anchor.workspace.GovernanceProgram as Program<GovernanceProgram>;
    this.oracleProgram = anchor.workspace.OracleProgram as Program<OracleProgram>;
    this.registryProgram = anchor.workspace.RegistryProgram as Program<RegistryProgram>;
    this.tradingProgram = anchor.workspace.TradingProgram as Program<TradingProgram>;
    
    // Generate test keypairs
    this.authority = anchor.web3.Keypair.generate();
    this.testUser = anchor.web3.Keypair.generate();
    this.recValidator = anchor.web3.Keypair.generate();
  }

  static async create(): Promise<TestEnvironment> {
    const env = new TestEnvironment();
    
    // Airdrop SOL to test accounts
    await env.airdropSol(env.authority.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
    await env.airdropSol(env.testUser.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
    await env.airdropSol(env.recValidator.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
    
    return env;
  }

  public async airdropSol(publicKey: anchor.web3.PublicKey, amount: number): Promise<void> {
    const signature = await this.connection.requestAirdrop(publicKey, amount);
    await this.connection.confirmTransaction(signature);
  }

  findProgramAddress(seeds: Buffer[], programId: anchor.web3.PublicKey): [anchor.web3.PublicKey, number] {
    return anchor.web3.PublicKey.findProgramAddressSync(seeds, programId);
  }

  async getBalance(publicKey: anchor.web3.PublicKey): Promise<number> {
    return await this.connection.getBalance(publicKey);
  }

  async getTokenBalance(tokenAccount: anchor.web3.PublicKey): Promise<number> {
    const accountInfo = await this.connection.getAccountInfo(tokenAccount);
    if (!accountInfo) return 0;
    
    // Parse SPL token account data
    const data = accountInfo.data;
    const amount = data.readBigUInt64LE(64);
    return Number(amount);
  }

  async waitForTransaction(signature: string): Promise<void> {
    await this.connection.confirmTransaction(signature);
  }

  generateTestKeypair(): anchor.web3.Keypair {
    return anchor.web3.Keypair.generate();
  }

  generateTestId(): string {
    return `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

export const expect = (actual: any) => {
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
        lessThan: (expected: number) => {
          if (actual >= expected) {
            throw new Error(`Expected ${actual} to be less than ${expected}`);
          }
        },
        at: {
          least: (expected: number) => {
            if (actual < expected) {
              throw new Error(`Expected ${actual} to be at least ${expected}`);
            }
          },
          most: (expected: number) => {
            if (actual > expected) {
              throw new Error(`Expected ${actual} to be at most ${expected}`);
            }
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
      },
      throw: (expectedError?: string) => {
        if (typeof actual !== 'function') {
          throw new Error('Expected a function that throws');
        }
        try {
          actual();
          throw new Error('Expected function to throw, but it didn\'t');
        } catch (error: any) {
          if (expectedError && !error.message.includes(expectedError)) {
            throw new Error(`Expected error to contain "${expectedError}", but got "${error.message}"`);
          }
        }
      }
    }
  };
};

export const describe = (name: string, fn: () => void | Promise<void>) => {
  console.log(`\n📋 ${name}`);
  fn();
};

export const it = (name: string, fn: () => void | Promise<void>) => {
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

export const before = (fn: () => void | Promise<void>) => {
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

export const beforeEach = (fn: () => void | Promise<void>) => {
  console.log(`  🔄 Reset`);
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.catch((error) => {
        console.error(`    ❌ Reset failed: ${error.message}`);
        throw error;
      });
    }
  } catch (error: any) {
    console.error(`    ❌ Reset failed: ${error.message}`);
    throw error;
  }
};

export const after = (fn: () => void | Promise<void>) => {
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
