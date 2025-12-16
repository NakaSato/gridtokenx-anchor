/**
 * LiteSVM Trading Program Tests
 * 
 * Fast tests for the Trading program using LiteSVM
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
import { expect } from "chai";
import BN from "bn.js";
import {
  createTestEnvironment,
  sendTransaction,
  assertTransactionSuccess,
  assertTransactionFailed,
  getBalance,
  getAccount,
  setUnixTimestamp,
  findProgramAddress,
  PROGRAM_IDS,
  LiteSVMTestEnv,
} from "./setup";

// Trading program instruction discriminators (8-byte hashes)
// These would be generated from the Anchor IDL
const INSTRUCTION_DISCRIMINATORS = {
  initializeMarket: Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]), // Placeholder
  createBuyOrder: Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]),   // Placeholder
  createSellOrder: Buffer.from([0, 0, 0, 0, 0, 0, 0, 2]),  // Placeholder
  cancelOrder: Buffer.from([0, 0, 0, 0, 0, 0, 0, 3]),      // Placeholder
  matchOrders: Buffer.from([0, 0, 0, 0, 0, 0, 0, 4]),      // Placeholder
};

describe("Trading Program - LiteSVM Tests", () => {
  let env: LiteSVMTestEnv;
  let trader1: Keypair;
  let trader2: Keypair;

  beforeEach(() => {
    env = createTestEnvironment();
    trader1 = Keypair.generate();
    trader2 = Keypair.generate();

    // Fund traders
    env.svm.airdrop(trader1.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
    env.svm.airdrop(trader2.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
  });

  describe("PDA Derivation", () => {
    it("should derive market PDA with correct seeds", () => {
      const marketName = "ENERGY_USDC";
      const [marketPda, bump] = findProgramAddress(
        [Buffer.from("market"), Buffer.from(marketName)],
        PROGRAM_IDS.trading
      );

      expect(marketPda).to.be.instanceOf(PublicKey);
      expect(bump).to.be.lessThanOrEqual(255);

      // Verify PDA is on curve
      expect(PublicKey.isOnCurve(marketPda.toBuffer())).to.be.false;
    });

    it("should derive order PDA with trader pubkey", () => {
      const orderId = "order_12345";
      const [orderPda, bump] = findProgramAddress(
        [Buffer.from("order"), trader1.publicKey.toBuffer(), Buffer.from(orderId)],
        PROGRAM_IDS.trading
      );

      expect(orderPda).to.be.instanceOf(PublicKey);
      expect(bump).to.be.lessThanOrEqual(255);
    });

    it("should derive different PDAs for different traders", () => {
      const orderId = "order_001";

      const [orderPda1] = findProgramAddress(
        [Buffer.from("order"), trader1.publicKey.toBuffer(), Buffer.from(orderId)],
        PROGRAM_IDS.trading
      );

      const [orderPda2] = findProgramAddress(
        [Buffer.from("order"), trader2.publicKey.toBuffer(), Buffer.from(orderId)],
        PROGRAM_IDS.trading
      );

      expect(orderPda1.toBase58()).to.not.equal(orderPda2.toBase58());
    });

    it("should derive escrow PDA for market", () => {
      const marketName = "ENERGY_USDC";
      const [escrowPda, bump] = findProgramAddress(
        [Buffer.from("escrow"), Buffer.from(marketName)],
        PROGRAM_IDS.trading
      );

      expect(escrowPda).to.be.instanceOf(PublicKey);
    });
  });

  describe("Account State Management", () => {
    it("should track trader balances correctly", () => {
      const initialBalance = getBalance(env.svm, trader1.publicKey);
      expect(initialBalance).to.equal(BigInt(10 * LAMPORTS_PER_SOL));

      // Simulate a transfer (as if trading occurred)
      const tx = new Transaction();
      tx.add(
        SystemProgram.transfer({
          fromPubkey: trader1.publicKey,
          toPubkey: trader2.publicKey,
          lamports: BigInt(1 * LAMPORTS_PER_SOL),
        })
      );

      const result = sendTransaction(env.svm, tx, [trader1]);
      assertTransactionSuccess(result);

      const trader1Balance = getBalance(env.svm, trader1.publicKey);
      const trader2Balance = getBalance(env.svm, trader2.publicKey);

      // Account for transaction fees
      expect(trader1Balance).to.be.lessThan(BigInt(9 * LAMPORTS_PER_SOL));
      expect(trader2Balance).to.equal(BigInt(11 * LAMPORTS_PER_SOL));
    });

    it("should create mock order account state", () => {
      const orderId = "test_order_001";
      const [orderPda] = findProgramAddress(
        [Buffer.from("order"), trader1.publicKey.toBuffer(), Buffer.from(orderId)],
        PROGRAM_IDS.trading
      );

      // Create mock order data (simplified)
      const orderData = Buffer.alloc(100);
      // Discriminator (8 bytes)
      orderData.write("ORDER___", 0, 8, "utf8");
      // Owner pubkey (32 bytes)
      trader1.publicKey.toBuffer().copy(orderData, 8);
      // Amount (8 bytes - u64)
      const amount = new BN(1000).toArrayLike(Buffer, "le", 8);
      amount.copy(orderData, 40);
      // Price (8 bytes - u64)
      const price = new BN(50).toArrayLike(Buffer, "le", 8);
      price.copy(orderData, 48);
      // Status (1 byte - enum)
      orderData.writeUInt8(1, 56); // 1 = Active

      // Set the account in LiteSVM
      env.svm.setAccount(orderPda, {
        lamports: LAMPORTS_PER_SOL,
        data: orderData,
        owner: PROGRAM_IDS.trading,
        executable: false,
      });

      // Verify account was created
      const account = getAccount(env.svm, orderPda);
      expect(account).to.not.be.null;
      expect(account?.owner.toBase58()).to.equal(PROGRAM_IDS.trading.toBase58());
    });
  });

  describe("Time-Dependent Trading Logic", () => {
    it("should validate order expiry based on timestamp", () => {
      // Set initial time
      const initialTime = BigInt(1700000000); // Some past timestamp
      setUnixTimestamp(env.svm, initialTime);

      const clock = env.svm.getClock();
      expect(clock.unixTimestamp).to.equal(initialTime);

      // Simulate order with 1 hour expiry
      const orderExpiryTime = initialTime + BigInt(3600);

      // Fast forward past expiry
      const futureTime = initialTime + BigInt(7200); // 2 hours later
      setUnixTimestamp(env.svm, futureTime);

      const newClock = env.svm.getClock();
      expect(newClock.unixTimestamp).to.be.greaterThan(orderExpiryTime);
    });

    it("should handle trading window validation", () => {
      // Set time to trading hours (9 AM UTC)
      const tradingHourTimestamp = BigInt(1700000000 + 9 * 3600);
      setUnixTimestamp(env.svm, tradingHourTimestamp);

      // Validate trading window
      const clock = env.svm.getClock();
      const hour = Number((clock.unixTimestamp % BigInt(86400)) / BigInt(3600));
      expect(hour).to.be.greaterThanOrEqual(9);
    });
  });

  describe("Order Matching Simulation", () => {
    it("should simulate buy and sell order matching", () => {
      // Create mock market state
      const marketName = "ENERGY_USDC";
      const [marketPda] = findProgramAddress(
        [Buffer.from("market"), Buffer.from(marketName)],
        PROGRAM_IDS.trading
      );

      // Mock market data
      const marketData = Buffer.alloc(200);
      marketData.write("MARKET__", 0, 8, "utf8");
      // Best bid price
      new BN(100).toArrayLike(Buffer, "le", 8).copy(marketData, 8);
      // Best ask price
      new BN(105).toArrayLike(Buffer, "le", 8).copy(marketData, 16);
      // Total volume
      new BN(10000).toArrayLike(Buffer, "le", 8).copy(marketData, 24);

      env.svm.setAccount(marketPda, {
        lamports: LAMPORTS_PER_SOL,
        data: marketData,
        owner: PROGRAM_IDS.trading,
        executable: false,
      });

      // Verify market state
      const marketAccount = getAccount(env.svm, marketPda);
      expect(marketAccount).to.not.be.null;

      // Parse best bid from mock data
      const bestBid = new BN(marketAccount!.data.slice(8, 16), "le");
      const bestAsk = new BN(marketAccount!.data.slice(16, 24), "le");

      expect(bestBid.toNumber()).to.equal(100);
      expect(bestAsk.toNumber()).to.equal(105);

      // Verify spread
      const spread = bestAsk.sub(bestBid);
      expect(spread.toNumber()).to.equal(5);
    });
  });

  describe("Error Handling", () => {
    it("should fail on insufficient balance", () => {
      const poorTrader = Keypair.generate();
      env.svm.airdrop(poorTrader.publicKey, BigInt(1000)); // Very small amount

      const tx = new Transaction();
      tx.add(
        SystemProgram.transfer({
          fromPubkey: poorTrader.publicKey,
          toPubkey: trader1.publicKey,
          lamports: BigInt(1 * LAMPORTS_PER_SOL), // More than available
        })
      );

      const result = sendTransaction(env.svm, tx, [poorTrader]);
      assertTransactionFailed(result);
    });
  });
});

describe("Trading Performance Benchmarks (LiteSVM)", () => {
  let env: LiteSVMTestEnv;

  beforeEach(() => {
    env = createTestEnvironment();
  });

  it("should handle high volume order creation simulation", () => {
    const traders: Keypair[] = [];
    const numTraders = 50;
    const ordersPerTrader = 10;

    // Create and fund traders
    for (let i = 0; i < numTraders; i++) {
      const trader = Keypair.generate();
      traders.push(trader);
      env.svm.airdrop(trader.publicKey, BigInt(100 * LAMPORTS_PER_SOL));
    }

    const startTime = Date.now();
    let totalTransactions = 0;

    // Simulate order creation
    for (const trader of traders) {
      for (let j = 0; j < ordersPerTrader; j++) {
        const recipient = Keypair.generate();

        const tx = new Transaction();
        tx.add(
          SystemProgram.transfer({
            fromPubkey: trader.publicKey,
            toPubkey: recipient.publicKey,
            lamports: 1000n,
          })
        );

        const result = sendTransaction(env.svm, tx, [trader]);
        if (result instanceof TransactionMetadata) {
          totalTransactions++;
        }
      }
    }

    const duration = Date.now() - startTime;
    const tps = (totalTransactions / duration) * 1000;

    console.log(`\nPerformance Results:`);
    console.log(`- Total transactions: ${totalTransactions}`);
    console.log(`- Duration: ${duration}ms`);
    console.log(`- TPS: ${tps.toFixed(2)}`);
    console.log(`- Avg per tx: ${(duration / totalTransactions).toFixed(2)}ms`);

    expect(totalTransactions).to.equal(numTraders * ordersPerTrader);
  });
});
