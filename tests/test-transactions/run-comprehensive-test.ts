#!/usr/bin/env node

import { execSync } from "child_process";
import { existsSync } from "fs";
import { resolve } from "path";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { readFileSync } from "fs";

// Configuration for our test
const TEST_CONFIG = {
  // Use localhost validator
  endpoint: process.env.ANCHOR_PROVIDER_URL || "http://localhost:8899",
  // Paths to wallet keypair files
  walletPaths: [
    "./dev-wallet.json",
    "./wallet-1-keypair.json",
    "./wallet-2-keypair.json",
  ],
};

// Read wallet keypair from file
function loadKeypair(path: string): Keypair {
  try {
    const keypairData = JSON.parse(readFileSync(path, "utf8"));
    return Keypair.fromSecretKey(new Uint8Array(keypairData));
  } catch (error) {
    console.error(`Failed to load keypair from ${path}:`, error);
    throw error;
  }
}

// Check if a local validator is running
function checkValidator(): boolean {
  try {
    execSync("curl -s http://localhost:8899/health", { stdio: "ignore" });
    console.log("✅ Local validator detected");
    return true;
  } catch (e) {
    console.log("❌ Local validator not running. Please start it with:");
    console.log("solana-test-validator");
    process.exit(1);
  }
}

// Get wallet balances
async function getBalances(
  connection: Connection,
): Promise<{ [key: string]: { address: string; balance: number } }> {
  const balances: { [key: string]: { address: string; balance: number } } = {};

  for (const walletPath of TEST_CONFIG.walletPaths) {
    const wallet = loadKeypair(walletPath);
    const balance = await connection.getBalance(wallet.publicKey);
    const address = wallet.publicKey.toBase58();

    balances[walletPath] = {
      address,
      balance: balance / LAMPORTS_PER_SOL,
    };
  }

  return balances;
}

// Test basic Solana transaction between wallets
async function testBasicTransfer(connection: Connection): Promise<boolean> {
  console.log("\n=== Testing Basic Transfer Between Wallets ===");

  try {
    // Load wallets
    const wallet1 = loadKeypair("./wallet-1-keypair.json");
    const wallet2 = loadKeypair("./dev-wallet.json");

    // Get initial balances
    const initialBalance1 = await connection.getBalance(wallet1.publicKey);
    const initialBalance2 = await connection.getBalance(wallet2.publicKey);

    console.log(
      `   wallet-1 initial balance: ${initialBalance1 / LAMPORTS_PER_SOL} SOL`,
    );
    console.log(
      `   dev-wallet initial balance: ${initialBalance2 / LAMPORTS_PER_SOL} SOL`,
    );

    // Create transfer transaction (1 SOL)
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: wallet1.publicKey,
        toPubkey: wallet2.publicKey,
        lamports: LAMPORTS_PER_SOL, // 1 SOL
      }),
    );

    // Get recent blockhash
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = wallet1.publicKey;

    // Sign transaction
    transaction.sign(wallet1);

    // Send transaction
    const signature = await connection.sendRawTransaction(
      transaction.serialize(),
      {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      },
    );

    // Confirm transaction
    const confirmation = await connection.confirmTransaction(
      {
        signature,
        blockhash,
        lastValidBlockHeight,
      },
      "confirmed",
    );

    if (confirmation.value.err) {
      console.error("❌ Transfer failed:", confirmation.value.err);
      return false;
    }

    // Check final balances
    const finalBalance1 = await connection.getBalance(wallet1.publicKey);
    const finalBalance2 = await connection.getBalance(wallet2.publicKey);

    console.log(
      `   wallet-1 final balance: ${finalBalance1 / LAMPORTS_PER_SOL} SOL`,
    );
    console.log(
      `   dev-wallet final balance: ${finalBalance2 / LAMPORTS_PER_SOL} SOL`,
    );
    console.log(`   ✅ Transfer successful with signature: ${signature}`);
    console.log(
      `   📊 Explorer: https://explorer.solana.com/tx/${signature}?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899`,
    );

    return true;
  } catch (error) {
    console.error("❌ Transfer test failed:", error);
    return false;
  }
}

// Test concurrent transactions
async function testConcurrentTransfers(
  connection: Connection,
): Promise<boolean> {
  console.log("\n=== Testing Concurrent Transactions ===");

  try {
    // Load wallets
    const wallet1 = loadKeypair("./wallet-1-keypair.json");
    const wallet2 = loadKeypair("./dev-wallet.json");
    const wallet3 = loadKeypair("./wallet-2-keypair.json");

    console.log("   Initiating 3 concurrent transfers...");

    // Create transfers concurrently
    const transferPromises = [];

    // Transfer 1: wallet-1 -> wallet-2 (0.5 SOL)
    const tx1 = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: wallet1.publicKey,
        toPubkey: wallet2.publicKey,
        lamports: 0.5 * LAMPORTS_PER_SOL,
      }),
    );
    const { blockhash: bh1, lastValidBlockHeight: lvbh1 } =
      await connection.getLatestBlockhash();
    tx1.recentBlockhash = bh1;
    tx1.feePayer = wallet1.publicKey;
    tx1.sign(wallet1);
    transferPromises.push(connection.sendRawTransaction(tx1.serialize()));

    // Transfer 2: wallet-2 -> wallet-1 (0.3 SOL)
    const tx2 = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: wallet2.publicKey,
        toPubkey: wallet1.publicKey,
        lamports: 0.3 * LAMPORTS_PER_SOL,
      }),
    );
    const { blockhash: bh2, lastValidBlockHeight: lvbh2 } =
      await connection.getLatestBlockhash();
    tx2.recentBlockhash = bh2;
    tx2.feePayer = wallet2.publicKey;
    tx2.sign(wallet2);
    transferPromises.push(connection.sendRawTransaction(tx2.serialize()));

    // Transfer 3: wallet-3 -> wallet-1 (0.2 SOL)
    const tx3 = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: wallet3.publicKey,
        toPubkey: wallet1.publicKey,
        lamports: 0.2 * LAMPORTS_PER_SOL,
      }),
    );
    const { blockhash: bh3, lastValidBlockHeight: lvbh3 } =
      await connection.getLatestBlockhash();
    tx3.recentBlockhash = bh3;
    tx3.feePayer = wallet3.publicKey;
    tx3.sign(wallet3);
    transferPromises.push(connection.sendRawTransaction(tx3.serialize()));

    // Wait for all transactions to complete
    const signatures = await Promise.all(transferPromises);
    console.log(`   ✅ All concurrent transactions sent with signatures:`);
    signatures.forEach((sig, i) => {
      console.log(`   ${i + 1}. ${sig}`);
    });

    return true;
  } catch (error) {
    console.error("❌ Concurrent transfers test failed:", error);
    return false;
  }
}

// Test transaction dependencies
async function testDependentTransfers(
  connection: Connection,
): Promise<boolean> {
  console.log("\n=== Testing Dependent Transaction Chain ===");

  try {
    // Load wallets
    const wallet1 = loadKeypair("./wallet-1-keypair.json");
    const wallet2 = loadKeypair("./dev-wallet.json");
    const wallet3 = loadKeypair("./wallet-2-keypair.json");

    console.log(
      "   Creating transaction chain: wallet-3 → wallet-1 → wallet-2",
    );

    // Step 1: Transfer 2 SOL from wallet-3 to wallet-1
    const tx1 = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: wallet3.publicKey,
        toPubkey: wallet1.publicKey,
        lamports: 2 * LAMPORTS_PER_SOL,
      }),
    );
    const { blockhash: bh1, lastValidBlockHeight: lvbh1 } =
      await connection.getLatestBlockhash();
    tx1.recentBlockhash = bh1;
    tx1.feePayer = wallet3.publicKey;
    tx1.sign(wallet3);
    const sig1 = await connection.sendRawTransaction(tx1.serialize());
    await connection.confirmTransaction({
      signature: sig1,
      blockhash: bh1,
      lastValidBlockHeight: lvbh1,
    });

    // Step 2: Wait for confirmation then transfer 1 SOL from wallet-1 to wallet-2
    const tx2 = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: wallet1.publicKey,
        toPubkey: wallet2.publicKey,
        lamports: 1 * LAMPORTS_PER_SOL,
      }),
    );
    const { blockhash: bh2, lastValidBlockHeight: lvbh2 } =
      await connection.getLatestBlockhash();
    tx2.recentBlockhash = bh2;
    tx2.feePayer = wallet1.publicKey;
    tx2.sign(wallet1);
    const sig2 = await connection.sendRawTransaction(tx2.serialize());
    await connection.confirmTransaction({
      signature: sig2,
      blockhash: bh2,
      lastValidBlockHeight: lvbh2,
    });

    console.log(`   ✅ Transaction chain completed successfully`);
    console.log(`   Step 1 (wallet-3 → wallet-1): ${sig1}`);
    console.log(`   Step 2 (wallet-1 → wallet-2): ${sig2}`);

    return true;
  } catch (error) {
    console.error("❌ Dependent transfers test failed:", error);
    return false;
  }
}

// Test transaction slot behavior
async function testSlotBehavior(connection: Connection): Promise<boolean> {
  console.log("\n=== Testing Transaction Slot Ordering ===");

  try {
    // Get current slot
    const initialSlot = await connection.getSlot();
    console.log(`   Initial slot: ${initialSlot}`);

    // Send a transaction
    const wallet = loadKeypair("./wallet-1-keypair.json");
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: wallet.publicKey,
        lamports: 1,
      }),
    );

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = wallet.publicKey;
    transaction.sign(wallet);

    const signature = await connection.sendRawTransaction(
      transaction.serialize(),
    );
    await connection.confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight,
    });

    // Get slot after transaction
    const finalSlot = await connection.getSlot();
    console.log(`   Final slot: ${finalSlot}`);
    console.log(
      `   ✅ Transaction processed in slots ${initialSlot} → ${finalSlot}`,
    );

    return true;
  } catch (error) {
    console.error("❌ Slot behavior test failed:", error);
    return false;
  }
}

// Main test function
async function runComprehensiveTests(): Promise<void> {
  console.log("🚀 Starting Comprehensive Solana Transaction Tests");
  console.log(`Using endpoint: ${TEST_CONFIG.endpoint}`);

  // Check if validator is running
  checkValidator();

  // Create connection
  const connection = new Connection(TEST_CONFIG.endpoint, "confirmed");

  // Display initial wallet states
  console.log("\n=== Initial Wallet States ===");
  const initialBalances = await getBalances(connection);
  Object.entries(initialBalances).forEach(([path, { address, balance }]) => {
    const walletName =
      path.split("-")[0] === "dev" ? "dev-wallet" : path.split(".")[0];
    console.log(`${walletName}: ${address} - ${balance.toFixed(9)} SOL`);
  });

  // Run tests
  const basicTestPassed = await testBasicTransfer(connection);
  const concurrentTestPassed = await testConcurrentTransfers(connection);
  const dependentTestPassed = await testDependentTransfers(connection);
  const slotTestPassed = await testSlotBehavior(connection);

  // Display final wallet states
  console.log("\n=== Final Wallet States ===");
  const finalBalances = await getBalances(connection);
  Object.entries(finalBalances).forEach(([path, { address, balance }]) => {
    const walletName =
      path.split("-")[0] === "dev" ? "dev-wallet" : path.split(".")[0];
    console.log(`${walletName}: ${address} - ${balance.toFixed(9)} SOL`);
  });

  // Report results
  console.log("\n=== Test Results ===");
  console.log(`Basic Transfer: ${basicTestPassed ? "✅ PASSED" : "❌ FAILED"}`);
  console.log(
    `Concurrent Transfers: ${concurrentTestPassed ? "✅ PASSED" : "❌ FAILED"}`,
  );
  console.log(
    `Dependent Transfers: ${dependentTestPassed ? "✅ PASSED" : "❌ FAILED"}`,
  );
  console.log(`Slot Behavior: ${slotTestPassed ? "✅ PASSED" : "❌ FAILED"}`);

  const allPassed =
    basicTestPassed &&
    concurrentTestPassed &&
    dependentTestPassed &&
    slotTestPassed;
  console.log(
    `\nOverall Result: ${allPassed ? "✅ ALL TESTS PASSED" : "❌ SOME TESTS FAILED"}`,
  );

  console.log("\n=== Explorer Links ===");
  console.log("You can view transactions at:");
  console.log(
    "https://explorer.solana.com/?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899",
  );

  process.exit(allPassed ? 0 : 1);
}

// Run the tests
runComprehensiveTests();
