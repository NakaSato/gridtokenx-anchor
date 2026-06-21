// Litesvm coverage for the sharded settlement accumulator (treasury §2c Part A):
// `initialize_settlement_shard`, `record_settlement_sharded`, and
// `aggregate_settlement_shards`. The sharded path bumps a per-shard PDA instead of
// the global `total_settled_thbg`, so settles on distinct shards don't write-lock
// one account; aggregation reconciles the global total off the hot path.
//
// Asserts: per-shard accumulation, the recorder gate, invalid shard rejection,
// aggregation summing across shards, and duplicate-shard rejection in aggregation.
//
// Raw instructions via anchor `.instruction()` through `svm.sendTransaction` —
// no live Connection / `.rpc()`.

import { LiteSVM, FailedTransactionMetadata } from "litesvm";
import { Program } from "@anchor-lang/core";
import * as anchorPkg from "@anchor-lang/core";
import { Treasury } from "../target/types/treasury";
import { expect } from "chai";
import {
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  MINT_SIZE,
  createInitializeMint2Instruction,
} from "@solana/spl-token";
import BN from "bn.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const idl = require("../target/idl/treasury.json");

const RATE = new BN(4_000_000);
const FEE_BPS = 25;
const TTL = new BN(3600);

describe("treasury sharded settlement accumulator (litesvm)", () => {
  let svm: LiteSVM;
  let program: Program<Treasury>;
  let programId: PublicKey;

  const payer = Keypair.generate(); // funds + treasury authority + attestor
  const recorder = Keypair.generate(); // authorized settlement recorder
  const stranger = Keypair.generate(); // unprivileged signer (neither authority nor recorder)
  const grxMint = Keypair.generate();

  let treasuryPda: PublicKey;
  let thbgMint: PublicKey;
  let swapVault: PublicKey;
  let stakeVault: PublicKey;
  let rewardVault: PublicKey;

  function send(ixs: TransactionInstruction[], signers: Keypair[]) {
    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = payer.publicKey;
    ixs.forEach((ix) => tx.add(ix));
    tx.sign(payer, ...signers);
    const res = svm.sendTransaction(tx);
    if (res instanceof FailedTransactionMetadata) {
      throw new Error("tx failed: " + res.err().toString() + "\n" + res.meta().logs().join("\n"));
    }
    svm.expireBlockhash();
    return res;
  }

  const pda = (seed: string) => PublicKey.findProgramAddressSync([Buffer.from(seed)], programId)[0];

  const shardPda = (id: number) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("settle_shard"), Buffer.from([id])],
      programId
    )[0];

  function decode(name: string, addr: PublicKey) {
    const data = Buffer.from(svm.getAccount(addr)!.data);
    const lower = name.charAt(0).toLowerCase() + name.slice(1);
    try {
      return program.coder.accounts.decode(lower, data);
    } catch {
      return program.coder.accounts.decode(name, data);
    }
  }

  before(async () => {
    svm = new LiteSVM().withDefaultPrograms();
    program = new Program(idl, { connection: {}, publicKey: PublicKey.default } as any);
    programId = program.programId;
    svm.addProgramFromFile(programId, "target/deploy/treasury.so");

    svm.airdrop(payer.publicKey, BigInt(1_000_000_000_000));

    treasuryPda = pda("treasury");
    thbgMint = pda("thbg_mint");
    swapVault = pda("swap_vault");
    stakeVault = pda("stake_vault");
    rewardVault = pda("reward_vault");

    const mintRent = Number(svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE)));
    send(
      [
        SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: grxMint.publicKey,
          lamports: mintRent,
          space: MINT_SIZE,
          programId: TOKEN_2022_PROGRAM_ID,
        }),
        createInitializeMint2Instruction(grxMint.publicKey, 9, payer.publicKey, null, TOKEN_2022_PROGRAM_ID),
      ],
      [grxMint]
    );

    const initIx = await program.methods
      .initialize(payer.publicKey, recorder.publicKey, RATE, FEE_BPS, TTL)
      .accounts({
        treasury: treasuryPda,
        grxMint: grxMint.publicKey,
        thbgMint,
        swapVault,
        stakeVault,
        rewardVault,
        authority: payer.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchorPkg.web3.SYSVAR_RENT_PUBKEY,
      })
      .instruction();
    send([initIx], []);
  });

  const initShardIx = (id: number) =>
    program.methods
      .initializeSettlementShard(id)
      .accounts({
        treasury: treasuryPda,
        shard: shardPda(id),
        authority: payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

  const recordShardedIx = (value: BN, id: number, who: PublicKey = recorder.publicKey) =>
    program.methods
      .recordSettlementSharded(value, id)
      .accounts({
        treasury: treasuryPda,
        shard: shardPda(id),
        recorder: who,
      })
      .instruction();

  // Two shards used across the suite.
  const A = 3;
  const B = 11;

  it("initializes shards and records onto them independently", async () => {
    send([await initShardIx(A), await initShardIx(B)], []);

    send([await recordShardedIx(new BN(5_000_000), A)], [recorder]);
    send([await recordShardedIx(new BN(2_000_000), A)], [recorder]);
    send([await recordShardedIx(new BN(7_000_000), B)], [recorder]);

    const sa = decode("SettlementShard", shardPda(A));
    const sb = decode("SettlementShard", shardPda(B));
    expect(sa.settledThbg.toString()).to.equal("7000000");
    expect(sa.settlementCount.toString()).to.equal("2");
    expect(sb.settledThbg.toString()).to.equal("7000000");
    expect(sb.settlementCount.toString()).to.equal("1");
    expect(sa.shardId).to.equal(A);
    expect(sb.shardId).to.equal(B);

    // Global total is NOT bumped by the sharded path — stale until aggregation.
    expect(decode("Treasury", treasuryPda).totalSettledThbg.toString()).to.equal("0");
  });

  it("rejects a recorder that is not the configured settlement_recorder", async () => {
    let failed = false;
    try {
      send([await recordShardedIx(new BN(1), A, payer.publicKey)], []);
    } catch (e) {
      failed = true;
      expect(String(e)).to.match(/UnauthorizedRecorder/);
    }
    expect(failed).to.equal(true);
  });

  it("rejects an out-of-range shard id", async () => {
    let failed = false;
    try {
      // shard_id 16 == NUM_SETTLE_SHARDS → InvalidShardId (PDA seeds also won't exist).
      send([await initShardIx(16)], []);
    } catch {
      failed = true;
    }
    expect(failed).to.equal(true);
  });

  it("aggregates the per-shard totals into the global total", async () => {
    // Drain-and-fold: shards are passed writable; each settled_thbg is folded into
    // the global and then zeroed.
    const aggIx = await program.methods
      .aggregateSettlementShards()
      .accounts({ treasury: treasuryPda, authority: payer.publicKey })
      .remainingAccounts([
        { pubkey: shardPda(A), isSigner: false, isWritable: true },
        { pubkey: shardPda(B), isSigner: false, isWritable: true },
      ])
      .instruction();
    send([aggIx], []);

    // 7,000,000 (A) + 7,000,000 (B) = 14,000,000 folded into the (previously 0) global.
    expect(decode("Treasury", treasuryPda).totalSettledThbg.toString()).to.equal("14000000");
    // Each shard was drained to 0 after folding (delta-since-last-aggregate semantics).
    expect(decode("SettlementShard", shardPda(A)).settledThbg.toString()).to.equal("0");
    expect(decode("SettlementShard", shardPda(B)).settledThbg.toString()).to.equal("0");

    // Re-running with no new settles is a no-op (no double counting).
    const aggIx2 = await program.methods
      .aggregateSettlementShards()
      .accounts({ treasury: treasuryPda, authority: payer.publicKey })
      .remainingAccounts([
        { pubkey: shardPda(A), isSigner: false, isWritable: true },
        { pubkey: shardPda(B), isSigner: false, isWritable: true },
      ])
      .instruction();
    send([aggIx2], []);
    expect(decode("Treasury", treasuryPda).totalSettledThbg.toString()).to.equal("14000000");
  });

  it("rejects a duplicate shard passed twice in aggregation", async () => {
    const aggIx = await program.methods
      .aggregateSettlementShards()
      .accounts({ treasury: treasuryPda, authority: payer.publicKey })
      .remainingAccounts([
        { pubkey: shardPda(A), isSigner: false, isWritable: true },
        { pubkey: shardPda(A), isSigner: false, isWritable: true }, // dup
      ])
      .instruction();

    let failed = false;
    try {
      send([aggIx], []);
    } catch (e) {
      failed = true;
      expect(String(e)).to.match(/DuplicateShard/);
    }
    expect(failed).to.equal(true);
  });

  it("rejects aggregation signed by a non-authority", async () => {
    // The auth gate fires before the remaining_accounts loop, so valid shards
    // are passed to prove rejection is the authority check, not a bad account.
    const aggIx = await program.methods
      .aggregateSettlementShards()
      .accounts({ treasury: treasuryPda, authority: stranger.publicKey })
      .remainingAccounts([
        { pubkey: shardPda(A), isSigner: false, isWritable: false },
        { pubkey: shardPda(B), isSigner: false, isWritable: false },
      ])
      .instruction();

    let failed = false;
    try {
      send([aggIx], [stranger]);
    } catch (e) {
      failed = true;
      expect(String(e)).to.match(/UnauthorizedAuthority/);
    }
    expect(failed).to.equal(true);
  });

  it("rejects a foreign-owned account spoofed as a settlement shard", async () => {
    // grxMint is owned by the token program, not the treasury program → the
    // `owner == crate::ID` guard rejects it before any shard data is read.
    const aggIx = await program.methods
      .aggregateSettlementShards()
      .accounts({ treasury: treasuryPda, authority: payer.publicKey })
      .remainingAccounts([
        { pubkey: grxMint.publicKey, isSigner: false, isWritable: false },
      ])
      .instruction();

    let failed = false;
    try {
      send([aggIx], []);
    } catch (e) {
      failed = true;
      expect(String(e)).to.match(/UnauthorizedAuthority/);
    }
    expect(failed).to.equal(true);
  });

  it("rejects a program-owned non-shard PDA spoofed as a settlement shard", async () => {
    // Fabricate an account OWNED by the treasury program (passes the `owner ==
    // crate::ID` guard) but living at an arbitrary, non-`settle_shard` address with
    // an out-of-range shard_id in its raw bytes. The shard_id range check (and the
    // stored-bump `create_program_address` rebind) reject it as InvalidShardId — a
    // program-owned account cannot be passed off as a shard it does not bind to.
    const fake = Keypair.generate().publicKey;
    const data = new Uint8Array(8 + 24); // 8 disc + SettlementShard (24)
    data[8 + 16] = 0xff; // shard_id byte = 255 (>= NUM_SETTLE_SHARDS) → InvalidShardId
    svm.setAccount(fake, {
      lamports: 1_000_000_000,
      data,
      owner: programId,
      executable: false,
      rentEpoch: 0n,
    });

    const aggIx = await program.methods
      .aggregateSettlementShards()
      .accounts({ treasury: treasuryPda, authority: payer.publicKey })
      .remainingAccounts([
        { pubkey: fake, isSigner: false, isWritable: false },
      ])
      .instruction();

    let failed = false;
    try {
      send([aggIx], []);
    } catch (e) {
      failed = true;
      expect(String(e)).to.match(/InvalidShardId/);
    }
    expect(failed).to.equal(true);
  });
});
