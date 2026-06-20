// Litesvm coverage for treasury `record_settlement_batch`: the per-batch
// settlement audit commitment (Merkle root + VAT + zone/batch) that bumps the
// cumulative settled total and writes a per-(zone,batch) SettlementRecord PDA.
// Asserts the recorder gate, the persisted commitment fields, and the total bump.
//
// Raw instructions via anchor `.instruction()` + spl-token ix builders, through
// `svm.sendTransaction` — no live Connection / `.rpc()`.

import { LiteSVM, FailedTransactionMetadata } from "litesvm";
import * as anchorPkg from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
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

const RATE = new BN(4_000_000); // 4.000000 THBG per whole GRX
const FEE_BPS = 25;
const TTL = new BN(3600);

describe("treasury record_settlement_batch (litesvm)", () => {
  let svm: LiteSVM;
  let program: Program<Treasury>;
  let programId: PublicKey;

  const payer = Keypair.generate(); // funds + treasury authority + attestor
  const recorder = Keypair.generate(); // authorized settlement recorder
  const grxMint = Keypair.generate();

  let treasuryPda: PublicKey;
  let thbgMint: PublicKey;
  let swapVault: PublicKey;
  let stakeVault: PublicKey;
  let rewardVault: PublicKey;

  const ZONE = 301; // u32
  const BATCH = new BN(42); // u64

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

  function settlementRecordPda(zone: number, batch: BN): PublicKey {
    const zoneBuf = Buffer.alloc(4);
    zoneBuf.writeUInt32LE(zone, 0);
    const batchBuf = batch.toArrayLike(Buffer, "le", 8);
    return PublicKey.findProgramAddressSync(
      [Buffer.from("settlement"), zoneBuf, batchBuf],
      programId
    )[0];
  }

  function fetchTreasury() {
    const acc = svm.getAccount(treasuryPda)!;
    const data = Buffer.from(acc.data);
    try {
      return program.coder.accounts.decode("treasury", data);
    } catch {
      return program.coder.accounts.decode("Treasury", data);
    }
  }

  function fetchRecord(addr: PublicKey) {
    const acc = svm.getAccount(addr)!;
    const data = Buffer.from(acc.data);
    try {
      return program.coder.accounts.decode("settlementRecord", data);
    } catch {
      return program.coder.accounts.decode("SettlementRecord", data);
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

    // External GRX mint (Token-2022, 9 decimals).
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

    // Initialize treasury; settlement_recorder = recorder keypair.
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

  function recordBatchIx(
    value: BN,
    root: number[],
    vatAmount: BN,
    vatRateBps: number,
    zone: number,
    batch: BN
  ) {
    return program.methods
      .recordSettlementBatch(value, root, vatAmount, vatRateBps, zone, batch)
      .accounts({
        treasury: treasuryPda,
        settlementRecord: settlementRecordPda(zone, batch),
        recorder: recorder.publicKey,
        payer: payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  it("records a batch commitment and bumps the settled total", async () => {
    const root = Array.from({ length: 32 }, (_, i) => (i + 1) & 0xff);
    const value = new BN(12_000_000); // 12 THBG (6dp)
    const vat = new BN(840_000); // 7% of 12,000,000
    send([await recordBatchIx(value, root, vat, 700, ZONE, BATCH)], [recorder]);

    const rec = fetchRecord(settlementRecordPda(ZONE, BATCH));
    expect(rec.totalValue.toString()).to.equal(value.toString());
    expect(rec.vatAmount.toString()).to.equal(vat.toString());
    expect(rec.vatRateBps).to.equal(700);
    expect(rec.zoneId).to.equal(ZONE);
    expect(rec.batchId.toString()).to.equal(BATCH.toString());
    expect(rec.recorder.toString()).to.equal(recorder.publicKey.toString());
    expect(Buffer.from(rec.merkleRoot).equals(Buffer.from(root))).to.equal(true);

    expect(fetchTreasury().totalSettledThbg.toString()).to.equal(value.toString());
  });

  it("rejects a recorder that is not the configured settlement_recorder", async () => {
    const root = Array.from({ length: 32 }, () => 0);
    const ix = await program.methods
      .recordSettlementBatch(new BN(1), root, new BN(0), 700, ZONE, new BN(99))
      .accounts({
        treasury: treasuryPda,
        settlementRecord: settlementRecordPda(ZONE, new BN(99)),
        recorder: payer.publicKey, // wrong recorder
        payer: payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    let failed = false;
    try {
      send([ix], []);
    } catch (e) {
      failed = true;
      expect(String(e)).to.match(/UnauthorizedRecorder/);
    }
    expect(failed).to.equal(true);
  });

  it("rejects a duplicate commitment for the same (zone, batch)", async () => {
    const root = Array.from({ length: 32 }, () => 7);
    let failed = false;
    try {
      // BATCH already recorded in the first test → init must fail (account exists).
      send([await recordBatchIx(new BN(5), root, new BN(0), 700, ZONE, BATCH)], [recorder]);
    } catch (e) {
      failed = true;
    }
    expect(failed).to.equal(true);
  });
});
