// In-process CU profile for the treasury §2c sharded settlement accumulator + batch
// commitment paths — the parallel-settlement reconciliation layer not covered by the §5
// treasury profile. Same method as §4-8 (litesvm `computeUnitsConsumed()`, default-feature
// .so, no localnet). Wiring mirrors tests/settle_shard_litesvm.ts.
//
// These are the off-hot-path admin instructions: record_settlement_sharded bumps a per-shard
// PDA (no global write-lock), aggregate_settlement_shards reconciles the global total, and
// record_settlement_batch writes a per-(zone,batch) audit commitment.

import { LiteSVM, FailedTransactionMetadata, TransactionMetadata } from "litesvm";
import * as anchorPkg from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Treasury } from "../target/types/treasury";
import { expect } from "chai";
import { PublicKey, Keypair, Transaction, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, MINT_SIZE, createInitializeMint2Instruction } from "@solana/spl-token";
import BN from "bn.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const idl = require("../target/idl/treasury.json");

const RATE = new BN(4_000_000);
const FEE_BPS = 25;
const TTL = new BN(3600);
const BUDGET = 200_000;
const A = 3, B = 11;

describe("treasury settlement (sharded + batch) CU profile (litesvm)", () => {
  let svm: LiteSVM;
  let program: Program<Treasury>;
  let programId: PublicKey;

  const payer = Keypair.generate(); // authority + attestor + settlement recorder
  const grxMint = Keypair.generate();

  let treasuryPda: PublicKey;

  const profile: Array<{ ix: string; cu: number }> = [];
  const pda = (s: string) => PublicKey.findProgramAddressSync([Buffer.from(s)], programId)[0];
  const shardPda = (id: number) => PublicKey.findProgramAddressSync([Buffer.from("settle_shard"), Buffer.from([id])], programId)[0];

  function sendRaw(ixs: TransactionInstruction[], extra: Keypair[] = []): FailedTransactionMetadata | TransactionMetadata {
    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = payer.publicKey;
    ixs.forEach((ix) => tx.add(ix));
    tx.sign(payer, ...extra);
    const res = svm.sendTransaction(tx);
    svm.expireBlockhash();
    return res;
  }
  function send(ixs: TransactionInstruction[], extra: Keypair[] = []) {
    const r = sendRaw(ixs, extra);
    if (r instanceof FailedTransactionMetadata) throw new Error("tx failed: " + r.err().toString() + "\n" + r.meta().logs().join("\n"));
  }
  function cu(label: string, ix: TransactionInstruction): number {
    const r = sendRaw([ix]);
    if (r instanceof FailedTransactionMetadata) throw new Error(label + " failed: " + r.err().toString() + "\n" + r.meta().logs().join("\n"));
    const c = Number((r as TransactionMetadata).computeUnitsConsumed());
    profile.push({ ix: label, cu: c });
    return c;
  }

  before(async () => {
    svm = new LiteSVM().withDefaultPrograms();
    program = new Program(idl, { connection: {}, publicKey: PublicKey.default } as any);
    programId = program.programId;
    svm.addProgramFromFile(programId, "target/deploy/treasury.so");
    svm.airdrop(payer.publicKey, BigInt(1_000_000_000_000));

    treasuryPda = pda("treasury");
    const mintRent = Number(svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE)));
    send([
      SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: grxMint.publicKey, lamports: mintRent, space: MINT_SIZE, programId: TOKEN_2022_PROGRAM_ID }),
      createInitializeMint2Instruction(grxMint.publicKey, 9, payer.publicKey, null, TOKEN_2022_PROGRAM_ID),
    ], [grxMint]);
    // recorder = payer so every record/batch tx needs only the one signer.
    send([await program.methods.initialize(payer.publicKey, payer.publicKey, RATE, FEE_BPS, TTL).accounts({
      treasury: treasuryPda, grxMint: grxMint.publicKey, thbgMint: pda("thbg_mint"),
      swapVault: pda("swap_vault"), stakeVault: pda("stake_vault"), rewardVault: pda("reward_vault"),
      authority: payer.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: anchorPkg.web3.SYSVAR_RENT_PUBKEY,
    } as any).instruction()]);
  });

  after(() => {
    const w = Math.max(...profile.map((p) => p.ix.length));
    console.log("\n  CU profile (default features, no localnet):");
    for (const p of profile) console.log(`    ${p.ix.padEnd(w)}  ${p.cu.toString().padStart(7)} CU`);
  });

  const initShardIx = (id: number) =>
    program.methods.initializeSettlementShard(id).accounts({ treasury: treasuryPda, shard: shardPda(id), authority: payer.publicKey, systemProgram: SystemProgram.programId } as any).instruction();
  const recordShardedIx = (value: BN, id: number) =>
    program.methods.recordSettlementSharded(value, id).accounts({ treasury: treasuryPda, shard: shardPda(id), recorder: payer.publicKey } as any).instruction();

  it("treasury.initialize_settlement_shard", async () => {
    expect(cu("treasury.initialize_settlement_shard", await initShardIx(A))).to.be.below(BUDGET);
    send([await initShardIx(B)]); // second shard for aggregation (setup, not measured)
  });

  it("treasury.record_settlement_sharded", async () => {
    expect(cu("treasury.record_settlement_sharded", await recordShardedIx(new BN(5_000_000), A))).to.be.below(BUDGET);
    send([await recordShardedIx(new BN(7_000_000), B)]); // populate B for aggregation
  });

  it("treasury.aggregate_settlement_shards (2 shards)", async () => {
    const ix = await program.methods.aggregateSettlementShards()
      .accounts({ treasury: treasuryPda, authority: payer.publicKey } as any)
      .remainingAccounts([
        { pubkey: shardPda(A), isSigner: false, isWritable: false },
        { pubkey: shardPda(B), isSigner: false, isWritable: false },
      ]).instruction();
    expect(cu("treasury.aggregate_settlement_shards", ix)).to.be.below(BUDGET);
  });

  it("treasury.record_settlement_batch", async () => {
    const zoneId = 0, batchId = 1;
    const settlementRecord = PublicKey.findProgramAddressSync(
      [Buffer.from("settlement"), Buffer.from(new Uint32Array([zoneId]).buffer), new BN(batchId).toArrayLike(Buffer, "le", 8)], programId)[0];
    const ix = await program.methods
      .recordSettlementBatch(new BN(1_000_000), Array(32).fill(0), new BN(70_000), 700, zoneId, new BN(batchId))
      .accounts({ treasury: treasuryPda, settlementRecord, recorder: payer.publicKey, payer: payer.publicKey, systemProgram: SystemProgram.programId } as any).instruction();
    expect(cu("treasury.record_settlement_batch", ix)).to.be.below(BUDGET);
  });
});
