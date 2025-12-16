/**
 * LiteSVM Test Setup for GridTokenX
 * 
 * This provides a fast, in-process Solana VM for testing programs
 * without the overhead of running a full validator.
 */

import { LiteSVM, TransactionMetadata, FailedTransactionMetadata } from "litesvm";
import {
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

// Program IDs - must match your Anchor.toml
export const PROGRAM_IDS = {
  energyToken: new PublicKey("54SAVMgGhjssp3iQ7zBK8kgUnEtqHJTNg3QRfzzDitHB"),
  governance: new PublicKey("GZP5QP6PMD2D8nNsLkhA39Lfr4er12JLMhQZJnhxyT5h"),
  oracle: new PublicKey("F7mEgt7zaAaKHfTNmCLeZCUutdKyZ2cxYg41ggjstBi6"),
  registry: new PublicKey("9XS8uUEVErcA8LABrJQAdohWMXTToBwhFN7Rvur6dC5"),
  trading: new PublicKey("2pZ8gqotjvKMAu96XzpGZ7QFcemZzj21ybtVTbaDP1zG"),
};

// Path to compiled programs
const DEPLOY_PATH = path.join(__dirname, "../../target/deploy");

export interface LiteSVMTestEnv {
  svm: LiteSVM;
  authority: Keypair;
  user: Keypair;
}

/**
 * Creates a LiteSVM test environment with all GridTokenX programs loaded
 */
export function createTestEnvironment(): LiteSVMTestEnv {
  const svm = new LiteSVM();

  // Load all programs
  loadPrograms(svm);

  // Create test keypairs
  const authority = Keypair.generate();
  const user = Keypair.generate();

  // Airdrop SOL to test accounts
  svm.airdrop(authority.publicKey, BigInt(100 * LAMPORTS_PER_SOL));
  svm.airdrop(user.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

  return { svm, authority, user };
}

/**
 * Load all GridTokenX programs into LiteSVM
 */
export function loadPrograms(svm: LiteSVM): void {
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
      svm.addProgramFromFile(program.id, programPath);
      console.log(`✓ Loaded program: ${program.file}`);
    } else {
      console.warn(`⚠ Program not found: ${programPath}`);
    }
  }
}

/**
 * Send a transaction and return result
 */
export function sendTransaction(
  svm: LiteSVM,
  transaction: Transaction,
  signers: Keypair[]
): TransactionMetadata | FailedTransactionMetadata {
  transaction.recentBlockhash = svm.latestBlockhash();
  transaction.sign(...signers);
  return svm.sendTransaction(transaction);
}

/**
 * Assert transaction succeeded
 */
export function assertTransactionSuccess(
  result: TransactionMetadata | FailedTransactionMetadata
): asserts result is TransactionMetadata {
  if (result instanceof FailedTransactionMetadata) {
    throw new Error(`Transaction failed: ${result.err}`);
  }
}

/**
 * Assert transaction failed
 */
export function assertTransactionFailed(
  result: TransactionMetadata | FailedTransactionMetadata
): asserts result is FailedTransactionMetadata {
  if (result instanceof TransactionMetadata) {
    throw new Error("Transaction was expected to fail but succeeded");
  }
}

/**
 * Get account data from LiteSVM
 */
export function getAccount(svm: LiteSVM, address: PublicKey) {
  return svm.getAccount(address);
}

/**
 * Get balance from LiteSVM
 */
export function getBalance(svm: LiteSVM, address: PublicKey): bigint {
  return svm.getBalance(address);
}

/**
 * Set time for time-dependent tests
 */
export function setUnixTimestamp(svm: LiteSVM, timestamp: bigint): void {
  const clock = svm.getClock();
  clock.unixTimestamp = timestamp;
  svm.setClock(clock);
}

/**
 * Advance to a specific slot
 */
export function warpToSlot(svm: LiteSVM, slot: bigint): void {
  svm.warpToSlot(slot);
}

/**
 * Find PDA helper
 */
export function findProgramAddress(
  seeds: Buffer[],
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(seeds, programId);
}

/**
 * Create a simple transfer transaction
 */
export function createTransferTransaction(
  from: PublicKey,
  to: PublicKey,
  lamports: bigint
): Transaction {
  const tx = new Transaction();
  tx.add(
    SystemProgram.transfer({
      fromPubkey: from,
      toPubkey: to,
      lamports,
    })
  );
  return tx;
}
