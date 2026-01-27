import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import type { Trading } from "../target/types/trading.ts";
import type { EnergyToken } from "../target/types/energy_token.ts";
import type { Governance } from "../target/types/governance.ts";
import type { Oracle } from "../target/types/oracle.ts";
import type { Registry } from "../target/types/registry.ts";
import * as fs from "fs";

/**
 * GridTokenX Test Environment Setup
 * 
 * Provides a standardized environment for integration tests with:
 * - Program instances (Trading, Governance, EnergyToken, etc.)
 * - Test wallets (Authority and Test User)
 * - Connection and Provider management
 */
export class TestEnvironment {
  public provider: anchor.AnchorProvider;
  public connection: anchor.web3.Connection;
  public wallet: anchor.Wallet;

  // Program instances
  public energyTokenProgram: Program<EnergyToken>;
  public governanceProgram: Program<Governance>;
  public oracleProgram: Program<Oracle>;
  public registryProgram: Program<Registry>;
  public tradingProgram: Program<Trading>;

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
    this.energyTokenProgram = anchor.workspace.EnergyToken as Program<EnergyToken>;
    this.governanceProgram = anchor.workspace.Governance as Program<Governance>;
    this.oracleProgram = anchor.workspace.Oracle as Program<Oracle>;
    this.registryProgram = anchor.workspace.Registry as Program<Registry>;
    this.tradingProgram = anchor.workspace.Trading as Program<Trading>;

    // Generate test keypairs
    // Load authority from ANCHOR_WALLET if available, else dev-wallet.json
    const walletPath = process.env.ANCHOR_WALLET || "./keypairs/dev-wallet.json";
    const walletData = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
    this.authority = anchor.web3.Keypair.fromSecretKey(new Uint8Array(walletData));
    this.testUser = anchor.web3.Keypair.generate();
    this.recValidator = anchor.web3.Keypair.generate();
  }

  public static async create(): Promise<TestEnvironment> {
    const env = new TestEnvironment();

    // Airdrop to authority and test user
    try {
      const airdropAuth = await env.connection.requestAirdrop(env.authority.publicKey, 100 * anchor.web3.LAMPORTS_PER_SOL);
      await env.connection.confirmTransaction(airdropAuth);

      const airdropUser = await env.connection.requestAirdrop(env.testUser.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
      await env.connection.confirmTransaction(airdropUser);
    } catch (e: any) {
      console.warn(`  ⚠️  Airdrop failed, continuing assuming accounts have funds: ${e.message}`);
    }

    return env;
  }
}

/**
 * Basic Assertion Library (Simple expect equivalent)
 */
export const expect = (actual: any) => {
  return {
    to: {
      equal: (expected: any) => {
        if (actual !== expected) {
          throw new Error(`Expected ${actual} to equal ${expected}`);
        }
      },
      not: {
        equal: (expected: any) => {
          if (actual === expected) {
            throw new Error(`Expected ${actual} NOT to equal ${expected}`);
          }
        }
      },
      be: {
        true: () => {
          if (actual !== true) {
            throw new Error(`Expected ${actual} to be true`);
          }
        },
        false: () => {
          if (actual !== false) {
            throw new Error(`Expected ${actual} to be false`);
          }
        },
        null: () => {
          if (actual !== null) {
            throw new Error(`Expected ${actual} to be null`);
          }
        },
        undefined: () => {
          if (actual !== undefined) {
            throw new Error(`Expected ${actual} to be undefined`);
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

// Test Runner State
interface TestContext {
  befores: Array<() => Promise<void> | void>;
  beforeEaches: Array<() => Promise<void> | void>;
  afters: Array<() => Promise<void> | void>;
  tests: Array<{ name: string; fn: () => Promise<void> | void }>;
}

let currentContext: TestContext = {
  befores: [],
  beforeEaches: [],
  afters: [],
  tests: []
};

export const before = (fn: () => void | Promise<void>) => {
  currentContext.befores.push(fn);
};

export const beforeEach = (fn: () => void | Promise<void>) => {
  currentContext.beforeEaches.push(fn);
};

export const after = (fn: () => void | Promise<void>) => {
  currentContext.afters.push(fn);
};

export const it = (name: string, fn: () => void | Promise<void>) => {
  currentContext.tests.push({ name, fn });
};

export const describe = async (name: string, fn: () => void) => {
  console.log(`\n📋 ${name}`);

  // Reset context (simplistic support for single describe per file)
  currentContext = {
    befores: [],
    beforeEaches: [],
    afters: [],
    tests: []
  };

  // 1. Register hooks and tests
  fn();

  // 2. Execute 'before' hooks
  if (currentContext.befores.length > 0) {
    console.log(`  🛠️  Setup`);
    for (const setup of currentContext.befores) {
      try {
        await setup();
      } catch (error: any) {
        console.error(`    ❌ Setup failed: ${error.message}`);
        process.exit(1);
      }
    }
  }

  // 3. Execute Tests
  for (const test of currentContext.tests) {
    // Run beforeEach
    for (const be of currentContext.beforeEaches) {
      try {
        await be();
      } catch (error: any) {
        console.error(`    ❌ BeforeEach failed: ${error.message}`);
        process.exit(1);
      }
    }

    console.log(`  ✅ ${test.name}`);
    try {
      await test.fn();
    } catch (error: any) {
      console.error(`    ❌ Failed: ${error.message}`);
      if (error.stack) {
        console.error(error.stack.split('\n').slice(0, 3).join('\n'));
      }
      process.exit(1);
    }
  }

  // 4. Execute 'after' hooks
  if (currentContext.afters.length > 0) {
    console.log(`  🧹 Cleanup`);
    for (const cleanup of currentContext.afters) {
      try {
        await cleanup();
      } catch (error: any) {
        console.error(`    ❌ Cleanup failed: ${error.message}`);
      }
    }
  }
};
