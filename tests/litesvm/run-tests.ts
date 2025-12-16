/**
 * LiteSVM Test Runner for GridTokenX
 * 
 * Fast, in-process Solana VM testing - no validator required!
 * Run with: npx tsx tests/litesvm/run-tests.ts
 */

import { LiteSVM, TransactionMetadata, FailedTransactionMetadata } from "litesvm";
import {
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Program IDs
const PROGRAM_IDS = {
  energyToken: new PublicKey("54SAVMgGhjssp3iQ7zBK8kgUnEtqHJTNg3QRfzzDitHB"),
  governance: new PublicKey("GZP5QP6PMD2D8nNsLkhA39Lfr4er12JLMhQZJnhxyT5h"),
  oracle: new PublicKey("F7mEgt7zaAaKHfTNmCLeZCUutdKyZ2cxYg41ggjstBi6"),
  registry: new PublicKey("9XS8uUEVErcA8LABrJQAdohWMXTToBwhFN7Rvur6dC5"),
  trading: new PublicKey("2pZ8gqotjvKMAu96XzpGZ7QFcemZzj21ybtVTbaDP1zG"),
};

const DEPLOY_PATH = path.join(__dirname, "../../target/deploy");

// Test utilities
let passedTests = 0;
let failedTests = 0;
let programsLoaded = false;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  const actualStr = typeof actual === 'bigint' ? actual.toString() : String(actual);
  const expectedStr = typeof expected === 'bigint' ? expected.toString() : String(expected);
  
  if (actualStr !== expectedStr) {
    throw new Error(`${message}. Expected ${expectedStr}, got ${actualStr}`);
  }
}

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${error instanceof Error ? error.message : error}`);
    failedTests++;
  }
}

function suite(name: string): void {
  console.log(`\n${name}`);
}

// Helper functions
function createTestEnvironment() {
  const svm = new LiteSVM();
  const authority = Keypair.generate();
  const user = Keypair.generate();

  svm.airdrop(authority.publicKey, BigInt(100 * LAMPORTS_PER_SOL));
  svm.airdrop(user.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

  // Load programs once (show output only first time)
  if (!programsLoaded) {
    loadPrograms(svm);
    programsLoaded = true;
  } else {
    loadProgramsSilent(svm);
  }

  return { svm, authority, user };
}

function loadPrograms(svm: LiteSVM): void {
  const programs = [
    { id: PROGRAM_IDS.energyToken, file: "energy_token.so" },
    { id: PROGRAM_IDS.governance, file: "governance.so" },
    { id: PROGRAM_IDS.oracle, file: "oracle.so" },
    { id: PROGRAM_IDS.registry, file: "registry.so" },
    { id: PROGRAM_IDS.trading, file: "trading.so" },
  ];

  console.log("\nLoading Programs:");
  for (const program of programs) {
    const programPath = path.join(DEPLOY_PATH, program.file);
    if (fs.existsSync(programPath)) {
      try {
        svm.addProgramFromFile(program.id, programPath);
        console.log(`  ✓ ${program.file}`);
      } catch (e) {
        console.log(`  ⚠ ${program.file} (load failed)`);
      }
    } else {
      console.log(`  ⚠ ${program.file} (not found)`);
    }
  }
}

function loadProgramsSilent(svm: LiteSVM): void {
  const programs = [
    { id: PROGRAM_IDS.energyToken, file: "energy_token.so" },
    { id: PROGRAM_IDS.governance, file: "governance.so" },
    { id: PROGRAM_IDS.oracle, file: "oracle.so" },
    { id: PROGRAM_IDS.registry, file: "registry.so" },
    { id: PROGRAM_IDS.trading, file: "trading.so" },
  ];

  for (const program of programs) {
    const programPath = path.join(DEPLOY_PATH, program.file);
    if (fs.existsSync(programPath)) {
      try {
        svm.addProgramFromFile(program.id, programPath);
      } catch (e) {
        // Ignore
      }
    }
  }
}

function sendTransaction(
  svm: LiteSVM,
  transaction: Transaction,
  signers: Keypair[]
): TransactionMetadata | FailedTransactionMetadata {
  transaction.recentBlockhash = svm.latestBlockhash();
  transaction.sign(...signers);
  return svm.sendTransaction(transaction);
}

// Main test runner
async function main() {
  console.log("═".repeat(60));
  console.log("  🚀 LiteSVM Test Suite for GridTokenX");
  console.log("═".repeat(60));

  // Environment Setup Tests
  suite("Environment Setup");
  
  await test("create test environment with funded accounts", () => {
    const { svm, authority, user } = createTestEnvironment();
    const authorityBalance = svm.getBalance(authority.publicKey);
    const userBalance = svm.getBalance(user.publicKey);
    
    assertEqual(authorityBalance, BigInt(100 * LAMPORTS_PER_SOL), "Authority balance mismatch");
    assertEqual(userBalance, BigInt(10 * LAMPORTS_PER_SOL), "User balance mismatch");
  });

  await test("execute SOL transfers", () => {
    const { svm, authority, user } = createTestEnvironment();
    
    const tx = new Transaction();
    tx.add(
      SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: user.publicKey,
        lamports: BigInt(1 * LAMPORTS_PER_SOL),
      })
    );

    const result = sendTransaction(svm, tx, [authority]);
    assert(result instanceof TransactionMetadata, "Transaction should succeed");

    const userBalance = svm.getBalance(user.publicKey);
    assertEqual(userBalance, BigInt(11 * LAMPORTS_PER_SOL), "User balance after transfer");
  });

  // Time Manipulation Tests
  suite("Time Manipulation");

  await test("manipulate unix timestamp", () => {
    const { svm } = createTestEnvironment();
    const newTimestamp = BigInt(1735689600);

    const clock = svm.getClock();
    clock.unixTimestamp = newTimestamp;
    svm.setClock(clock);

    const updatedClock = svm.getClock();
    assertEqual(updatedClock.unixTimestamp, newTimestamp, "Unix timestamp mismatch");
  });

  await test("warp to future slot", () => {
    const { svm } = createTestEnvironment();
    const targetSlot = 1000n;

    svm.warpToSlot(targetSlot);

    const clock = svm.getClock();
    assertEqual(clock.slot, targetSlot, "Slot mismatch");
  });

  // PDA Derivation Tests
  suite("PDA Derivation");

  await test("derive program addresses for trading", () => {
    const seeds = [Buffer.from("market"), Buffer.from("ENERGY")];
    const [pda, bump] = PublicKey.findProgramAddressSync(seeds, PROGRAM_IDS.trading);

    assert(pda instanceof PublicKey, "PDA should be a PublicKey");
    assert(bump <= 255, "Bump should be <= 255");
  });

  await test("derive consistent PDAs", () => {
    const seeds = [Buffer.from("registry"), Buffer.from("config")];
    const [pda1] = PublicKey.findProgramAddressSync(seeds, PROGRAM_IDS.registry);
    const [pda2] = PublicKey.findProgramAddressSync(seeds, PROGRAM_IDS.registry);

    assertEqual(pda1.toBase58(), pda2.toBase58(), "PDAs should be consistent");
  });

  await test("derive market PDA", () => {
    const marketName = "ENERGY_USDC";
    const [marketPda, bump] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), Buffer.from(marketName)],
      PROGRAM_IDS.trading
    );
    assert(marketPda instanceof PublicKey, "Market PDA should be valid");
  });

  await test("derive energy mint PDA", () => {
    const [mintPda, bump] = PublicKey.findProgramAddressSync(
      [Buffer.from("energy_mint")],
      PROGRAM_IDS.energyToken
    );
    assert(mintPda instanceof PublicKey, "Energy Mint PDA should be valid");
  });

  await test("derive oracle price feed PDA", () => {
    const feedName = "ENERGY_USD";
    const [feedPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("price_feed"), Buffer.from(feedName)],
      PROGRAM_IDS.oracle
    );
    assert(feedPda instanceof PublicKey, "Price Feed PDA should be valid");
  });

  // Account State Tests
  suite("Account State Management");

  await test("set and get account data", () => {
    const { svm } = createTestEnvironment();
    const account = Keypair.generate();
    const data = Buffer.from([1, 2, 3, 4, 5]);

    svm.setAccount(account.publicKey, {
      lamports: LAMPORTS_PER_SOL,
      data: data,
      owner: SystemProgram.programId,
      executable: false,
    });

    const accountInfo = svm.getAccount(account.publicKey);
    assert(accountInfo !== null, "Account should exist");
    assertEqual(accountInfo!.lamports, BigInt(LAMPORTS_PER_SOL), "Account lamports");
  });

  await test("airdrop to new accounts", () => {
    const { svm } = createTestEnvironment();
    const newAccount = Keypair.generate();
    
    svm.airdrop(newAccount.publicKey, BigInt(5 * LAMPORTS_PER_SOL));
    
    const balance = svm.getBalance(newAccount.publicKey);
    assertEqual(balance, BigInt(5 * LAMPORTS_PER_SOL), "Airdrop balance");
  });

  // Performance Benchmarks
  suite("Performance Benchmarks");

  await test("execute 100 transfers quickly", () => {
    const { svm, authority } = createTestEnvironment();
    const startTime = Date.now();

    for (let i = 0; i < 100; i++) {
      const recipient = Keypair.generate();
      const tx = new Transaction();
      tx.add(
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: recipient.publicKey,
          lamports: 1000n,
        })
      );
      const result = sendTransaction(svm, tx, [authority]);
      assert(result instanceof TransactionMetadata, `Transfer ${i} failed`);
    }

    const duration = Date.now() - startTime;
    console.log(`    ⏱️  100 transfers: ${duration}ms (${(duration / 100).toFixed(2)}ms avg)`);
  });

  await test("measure compute units", () => {
    const { svm, authority, user } = createTestEnvironment();

    const tx = new Transaction();
    tx.add(
      SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: user.publicKey,
        lamports: 1000n,
      })
    );

    const result = sendTransaction(svm, tx, [authority]);
    assert(result instanceof TransactionMetadata, "Transaction should succeed");
    
    if (result instanceof TransactionMetadata) {
      // computeUnitsConsumed might be a getter, access it properly
      const cu = result.computeUnitsConsumed;
      console.log(`    ⚡ Compute units: ${cu}`);
      // Just verify transaction succeeded - CU tracking varies by version
    }
  });

  // Summary
  console.log("\n" + "═".repeat(60));
  console.log(`  Results: ${passedTests} passed, ${failedTests} failed`);
  console.log("═".repeat(60));

  if (failedTests > 0) {
    process.exit(1);
  }
}

main().catch(console.error);
