// Litesvm coverage for sweep_collectors (instructions/escrow.rs:315), previously untested.
// sweep_collectors consolidates one shard's fee/wheeling/loss collector balances into the
// canonical (unsharded) collectors. It is permissionless but safe: every source and
// destination is a market_authority-owned, seed-bound PDA, so funds can only move between
// market accounts (transfer_checked signed by the market_authority PDA), never out.
//
// Setup is heavy (6 collector PDAs + market_authority) so this also exercises
// initialize_collectors + initialize_sharded_collectors. The InvalidShardId guard is
// unreachable through this account layout — an out-of-range shard_id derives a collector PDA
// that was never initialized, so account ownership validation fails before the require runs.

import { LiteSVM, FailedTransactionMetadata } from "litesvm";
import { Program } from "@anchor-lang/core";
import { Trading } from "../target/types/trading";
import { expect } from "chai";
import {
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  MINT_SIZE,
  createInitializeMint2Instruction,
  createMintToInstruction,
  unpackAccount,
} from "@solana/spl-token";
import BN from "bn.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const tradingIdl = require("../target/idl/trading.json");

const SHARD = 0;

describe("trading sweep_collectors (litesvm)", () => {
  let svm: LiteSVM;
  let trading: Program<Trading>;
  let tradingId: PublicKey;

  const payer = Keypair.generate();
  const mintKp = Keypair.generate();
  let mint: PublicKey;
  let marketAuthorityPda: PublicKey;

  function send(ixs: TransactionInstruction[], signers: Keypair[] = []) {
    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = payer.publicKey;
    ixs.forEach((ix) => tx.add(ix));
    tx.sign(payer, ...signers);
    const res = svm.sendTransaction(tx);
    if (res instanceof FailedTransactionMetadata) throw new Error("tx failed: " + res.err().toString() + "\n" + res.meta().logs().join("\n"));
    svm.expireBlockhash();
  }

  const col = (kind: string, shard: number | null) => {
    const seeds = [Buffer.from(kind), mint.toBuffer()];
    if (shard !== null) seeds.push(Buffer.from([shard]));
    return PublicKey.findProgramAddressSync(seeds, tradingId)[0];
  };
  const bal = (pda: PublicKey): bigint => {
    const a = svm.getAccount(pda)!;
    return unpackAccount(pda, { ...a, data: Buffer.from(a.data) } as any, TOKEN_PROGRAM_ID).amount;
  };

  const sweepIx = (shard: number) =>
    trading.methods.sweepCollectors(shard).accounts({
      currencyMint: mint, marketAuthority: marketAuthorityPda,
      feeShard: col("fee_collector", shard), wheelingShard: col("wheeling_collector", shard), lossShard: col("loss_collector", shard),
      feeMain: col("fee_collector", null), wheelingMain: col("wheeling_collector", null), lossMain: col("loss_collector", null),
      tokenProgram: TOKEN_PROGRAM_ID,
    } as any).instruction();

  before(async () => {
    svm = new LiteSVM().withDefaultPrograms();
    trading = new Program(tradingIdl, { connection: {}, publicKey: PublicKey.default } as any);
    tradingId = trading.programId;
    svm.addProgramFromFile(tradingId, "target/deploy/trading.so");
    svm.airdrop(payer.publicKey, BigInt(1_000_000_000_000));

    mint = mintKp.publicKey;
    [marketAuthorityPda] = PublicKey.findProgramAddressSync([Buffer.from("market_authority")], tradingId);

    // currency mint (classic SPL, 6 decimals), payer = mint authority.
    const mintRent = Number(svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE)));
    send([
      SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mint, lamports: mintRent, space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }),
      createInitializeMint2Instruction(mint, 6, payer.publicKey, null, TOKEN_PROGRAM_ID),
    ], [mintKp]);

    // main + shard collector PDAs.
    send([await trading.methods.initializeCollectors().accounts({
      payer: payer.publicKey, currencyMint: mint,
      feeCollector: col("fee_collector", null), wheelingCollector: col("wheeling_collector", null), lossCollector: col("loss_collector", null),
      marketAuthority: marketAuthorityPda, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    } as any).instruction()]);
    send([await trading.methods.initializeShardedCollectors(SHARD).accounts({
      payer: payer.publicKey, currencyMint: mint,
      feeCollector: col("fee_collector", SHARD), wheelingCollector: col("wheeling_collector", SHARD), lossCollector: col("loss_collector", SHARD),
      marketAuthority: marketAuthorityPda, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    } as any).instruction()]);

    // Fund the shard collectors (payer is mint authority).
    send([
      createMintToInstruction(mint, col("fee_collector", SHARD), payer.publicKey, 300, [], TOKEN_PROGRAM_ID),
      createMintToInstruction(mint, col("wheeling_collector", SHARD), payer.publicKey, 120, [], TOKEN_PROGRAM_ID),
      createMintToInstruction(mint, col("loss_collector", SHARD), payer.publicKey, 50, [], TOKEN_PROGRAM_ID),
    ]);
  });

  it("sweeps shard fee/wheeling/loss balances into the main collectors (control)", async () => {
    expect(bal(col("fee_collector", SHARD))).to.equal(300n);
    expect(bal(col("fee_collector", null))).to.equal(0n);

    send([await sweepIx(SHARD)]);

    expect(bal(col("fee_collector", SHARD))).to.equal(0n);
    expect(bal(col("wheeling_collector", SHARD))).to.equal(0n);
    expect(bal(col("loss_collector", SHARD))).to.equal(0n);
    expect(bal(col("fee_collector", null))).to.equal(300n);
    expect(bal(col("wheeling_collector", null))).to.equal(120n);
    expect(bal(col("loss_collector", null))).to.equal(50n);
  });

  it("a sweep with empty shard collectors is a no-op (control)", async () => {
    send([await sweepIx(SHARD)]); // shard balances already 0
    expect(bal(col("fee_collector", null))).to.equal(300n); // mains unchanged
  });

  // initialize_program is a bare no-op (just msg!), kept here to close the last trading gap.
  it("initialize_program smoke (control)", async () => {
    send([await trading.methods.initializeProgram().accounts({ authority: payer.publicKey } as any).instruction()]);
  });
});
