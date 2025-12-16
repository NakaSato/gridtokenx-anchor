/**
 * LiteSVM Basic Tests for GridTokenX
 * 
 * Fast unit tests using LiteSVM - runs without a validator
 */

import { LiteSVM, TransactionMetadata, FailedTransactionMetadata } from "litesvm";
import {
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { expect } from "chai";
import {
  createTestEnvironment,
  sendTransaction,
  assertTransactionSuccess,
  getBalance,
  setUnixTimestamp,
  warpToSlot,
  findProgramAddress,
  PROGRAM_IDS,
} from "./setup";

describe("LiteSVM Basic Tests", () => {
  describe("Environment Setup", () => {
    it("should create test environment with funded accounts", () => {
      const { svm, authority, user } = createTestEnvironment();

      const authorityBalance = getBalance(svm, authority.publicKey);
      const userBalance = getBalance(svm, user.publicKey);

      expect(authorityBalance).to.equal(BigInt(100 * LAMPORTS_PER_SOL));
      expect(userBalance).to.equal(BigInt(10 * LAMPORTS_PER_SOL));
    });

    it("should execute SOL transfers", () => {
      const { svm, authority, user } = createTestEnvironment();

      const transferAmount = BigInt(1 * LAMPORTS_PER_SOL);
      const tx = new Transaction();
      tx.add(
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: user.publicKey,
          lamports: transferAmount,
        })
      );

      const result = sendTransaction(svm, tx, [authority]);
      assertTransactionSuccess(result);

      const userBalanceAfter = getBalance(svm, user.publicKey);
      expect(userBalanceAfter).to.equal(BigInt(11 * LAMPORTS_PER_SOL));
    });
  });

  describe("Time Manipulation", () => {
    it("should manipulate unix timestamp", () => {
      const { svm } = createTestEnvironment();

      const initialClock = svm.getClock();
      const newTimestamp = BigInt(1735689600); // Jan 1, 2025

      setUnixTimestamp(svm, newTimestamp);

      const updatedClock = svm.getClock();
      expect(updatedClock.unixTimestamp).to.equal(newTimestamp);
    });

    it("should warp to future slot", () => {
      const { svm } = createTestEnvironment();

      const targetSlot = 1000n;
      warpToSlot(svm, targetSlot);

      const clock = svm.getClock();
      expect(clock.slot).to.equal(targetSlot);
    });
  });

  describe("PDA Derivation", () => {
    it("should derive program addresses", () => {
      const seeds = [Buffer.from("market"), Buffer.from("ENERGY")];
      const [pda, bump] = findProgramAddress(seeds, PROGRAM_IDS.trading);

      expect(pda).to.be.instanceOf(PublicKey);
      expect(bump).to.be.a("number");
      expect(bump).to.be.lessThanOrEqual(255);
    });

    it("should derive consistent PDAs", () => {
      const seeds = [Buffer.from("registry"), Buffer.from("config")];
      const [pda1] = findProgramAddress(seeds, PROGRAM_IDS.registry);
      const [pda2] = findProgramAddress(seeds, PROGRAM_IDS.registry);

      expect(pda1.toBase58()).to.equal(pda2.toBase58());
    });
  });

  describe("Account State", () => {
    it("should set and get account data", () => {
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
      expect(accountInfo).to.not.be.null;
      expect(accountInfo?.lamports).to.equal(BigInt(LAMPORTS_PER_SOL));
      expect(Buffer.from(accountInfo!.data)).to.deep.equal(data);
    });
  });
});

describe("GridTokenX Program Tests (LiteSVM)", () => {
  describe("Registry Program", () => {
    it("should derive registry PDA correctly", () => {
      const authority = Keypair.generate();
      const seeds = [
        Buffer.from("registry"),
        authority.publicKey.toBuffer(),
      ];
      const [pda, bump] = findProgramAddress(seeds, PROGRAM_IDS.registry);

      expect(pda).to.be.instanceOf(PublicKey);
      console.log(`Registry PDA: ${pda.toBase58()}, bump: ${bump}`);
    });
  });

  describe("Trading Program", () => {
    it("should derive market PDA correctly", () => {
      const marketName = "ENERGY_MARKET";
      const seeds = [Buffer.from("market"), Buffer.from(marketName)];
      const [marketPda, bump] = findProgramAddress(seeds, PROGRAM_IDS.trading);

      expect(marketPda).to.be.instanceOf(PublicKey);
      console.log(`Market PDA: ${marketPda.toBase58()}, bump: ${bump}`);
    });

    it("should derive order PDA correctly", () => {
      const trader = Keypair.generate();
      const orderId = "order_001";
      const seeds = [
        Buffer.from("order"),
        trader.publicKey.toBuffer(),
        Buffer.from(orderId),
      ];
      const [orderPda, bump] = findProgramAddress(seeds, PROGRAM_IDS.trading);

      expect(orderPda).to.be.instanceOf(PublicKey);
      console.log(`Order PDA: ${orderPda.toBase58()}, bump: ${bump}`);
    });
  });

  describe("Energy Token Program", () => {
    it("should derive energy mint PDA correctly", () => {
      const seeds = [Buffer.from("energy_mint")];
      const [mintPda, bump] = findProgramAddress(seeds, PROGRAM_IDS.energyToken);

      expect(mintPda).to.be.instanceOf(PublicKey);
      console.log(`Energy Mint PDA: ${mintPda.toBase58()}, bump: ${bump}`);
    });
  });

  describe("Oracle Program", () => {
    it("should derive price feed PDA correctly", () => {
      const feedName = "ENERGY_USD";
      const seeds = [Buffer.from("price_feed"), Buffer.from(feedName)];
      const [feedPda, bump] = findProgramAddress(seeds, PROGRAM_IDS.oracle);

      expect(feedPda).to.be.instanceOf(PublicKey);
      console.log(`Price Feed PDA: ${feedPda.toBase58()}, bump: ${bump}`);
    });
  });

  describe("Governance Program", () => {
    it("should derive proposal PDA correctly", () => {
      const proposalId = 1;
      const seeds = [
        Buffer.from("proposal"),
        Buffer.from(new Uint8Array(new BigUint64Array([BigInt(proposalId)]).buffer)),
      ];
      const [proposalPda, bump] = findProgramAddress(seeds, PROGRAM_IDS.governance);

      expect(proposalPda).to.be.instanceOf(PublicKey);
      console.log(`Proposal PDA: ${proposalPda.toBase58()}, bump: ${bump}`);
    });
  });
});

describe("Performance Benchmarks (LiteSVM)", () => {
  it("should execute 100 transfers quickly", () => {
    const { svm, authority } = createTestEnvironment();
    const recipients: Keypair[] = [];

    const startTime = Date.now();

    for (let i = 0; i < 100; i++) {
      const recipient = Keypair.generate();
      recipients.push(recipient);

      const tx = new Transaction();
      tx.add(
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: recipient.publicKey,
          lamports: 1000n,
        })
      );

      const result = sendTransaction(svm, tx, [authority]);
      assertTransactionSuccess(result);
    }

    const duration = Date.now() - startTime;
    console.log(`100 transfers completed in ${duration}ms`);
    console.log(`Average: ${(duration / 100).toFixed(2)}ms per transfer`);

    // Verify all recipients received funds
    for (const recipient of recipients) {
      const balance = getBalance(svm, recipient.publicKey);
      expect(balance).to.equal(1000n);
    }
  });

  it("should measure compute units", () => {
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
    assertTransactionSuccess(result);

    if (result instanceof TransactionMetadata) {
      console.log(`Compute units consumed: ${result.computeUnitsConsumed}`);
      expect(result.computeUnitsConsumed).to.be.greaterThan(0n);
    }
  });
});
