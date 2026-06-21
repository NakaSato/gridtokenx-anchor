// In-process compute-unit profile for the energy-token program — the GRID mint lifecycle:
// token init, REC-validator set management, REC-gated mint_to_wallet, transfer, and burn.
// Same method as §4-7 (litesvm `computeUnitsConsumed()`, default-feature .so, no localnet).
//
// Account wiring mirrors tests/energy_token_rec_guards_litesvm.ts (Token-2022 mint owned by
// the program's mint PDA; mint_to_wallet co-signed by a registered REC validator). Every
// instruction here SUCCEEDS; each is asserted under the 200k budget so a regression trips CI.

import { LiteSVM, FailedTransactionMetadata, TransactionMetadata } from "litesvm";
import * as anchorPkg from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { EnergyToken } from "../target/types/energy_token";
import { expect } from "chai";
import { PublicKey, Keypair, Transaction, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import BN from "bn.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const idl = require("../target/idl/energy_token.json");

const BUDGET = 200_000;

describe("energy-token CU profile (litesvm)", () => {
  let svm: LiteSVM;
  let program: Program<EnergyToken>;
  let programId: PublicKey;

  const payer = Keypair.generate();
  const destOwner = Keypair.generate();
  const v1 = Keypair.generate(); // registered REC validator

  let mintPda: PublicKey, infoPda: PublicKey, destAta: PublicKey, payerAta: PublicKey;

  const profile: Array<{ ix: string; cu: number }> = [];

  function sendRaw(ixs: TransactionInstruction[], signers: Keypair[] = []): FailedTransactionMetadata | TransactionMetadata {
    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = payer.publicKey;
    ixs.forEach((ix) => tx.add(ix));
    tx.sign(payer, ...signers);
    const res = svm.sendTransaction(tx);
    svm.expireBlockhash();
    return res;
  }
  function send(ixs: TransactionInstruction[], signers: Keypair[] = []) {
    const r = sendRaw(ixs, signers);
    if (r instanceof FailedTransactionMetadata) throw new Error("tx failed: " + r.err().toString() + "\n" + r.meta().logs().join("\n"));
  }
  function cu(label: string, ix: TransactionInstruction, signers: Keypair[] = []): number {
    const r = sendRaw([ix], signers);
    if (r instanceof FailedTransactionMetadata) throw new Error(label + " failed: " + r.err().toString() + "\n" + r.meta().logs().join("\n"));
    const c = Number((r as TransactionMetadata).computeUnitsConsumed());
    profile.push({ ix: label, cu: c });
    return c;
  }

  const addValidatorIx = (v: PublicKey) =>
    program.methods.addRecValidator(v, "rec").accounts({ tokenInfo: infoPda, authority: payer.publicKey } as any).instruction();
  const mintIx = (recValidator: PublicKey) =>
    program.methods.mintToWallet(new BN(100)).accounts({
      mint: mintPda, tokenInfo: infoPda, destination: destAta, destinationOwner: destOwner.publicKey,
      authority: payer.publicKey, recValidator, payer: payer.publicKey,
      tokenProgram: TOKEN_2022_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    } as any).instruction();

  before(async () => {
    svm = new LiteSVM().withDefaultPrograms();
    program = new Program(idl, { connection: {}, publicKey: PublicKey.default } as any);
    programId = program.programId;
    svm.addProgramFromFile(programId, "target/deploy/energy_token.so");
    svm.airdrop(payer.publicKey, BigInt(1_000_000_000_000));
    svm.airdrop(destOwner.publicKey, BigInt(1_000_000_000_000));

    [mintPda] = PublicKey.findProgramAddressSync([Buffer.from("mint_2022")], programId);
    [infoPda] = PublicKey.findProgramAddressSync([Buffer.from("token_info_2022")], programId);
    destAta = getAssociatedTokenAddressSync(mintPda, destOwner.publicKey, false, TOKEN_2022_PROGRAM_ID);
    payerAta = getAssociatedTokenAddressSync(mintPda, payer.publicKey, false, TOKEN_2022_PROGRAM_ID);
  });

  after(() => {
    const w = Math.max(...profile.map((p) => p.ix.length));
    console.log("\n  CU profile (default features, no localnet):");
    for (const p of profile) console.log(`    ${p.ix.padEnd(w)}  ${p.cu.toString().padStart(7)} CU`);
  });

  it("energy_token.initialize_token", async () => {
    const ix = await program.methods.initializeToken(PublicKey.default, payer.publicKey).accounts({
      tokenInfo: infoPda, mint: mintPda, authority: payer.publicKey,
      systemProgram: SystemProgram.programId, tokenProgram: TOKEN_2022_PROGRAM_ID, rent: anchorPkg.web3.SYSVAR_RENT_PUBKEY,
    } as any).instruction();
    expect(cu("energy_token.initialize_token", ix)).to.be.below(BUDGET);
    // ATAs for the mint/transfer/burn flow (setup, not measured).
    send([
      createAssociatedTokenAccountInstruction(payer.publicKey, destAta, destOwner.publicKey, mintPda, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
      createAssociatedTokenAccountInstruction(payer.publicKey, payerAta, payer.publicKey, mintPda, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
    ]);
  });

  it("energy_token.add_rec_validator", async () => {
    expect(cu("energy_token.add_rec_validator", await addValidatorIx(v1.publicKey))).to.be.below(BUDGET);
  });

  it("energy_token.mint_to_wallet (REC-gated)", async () => {
    expect(cu("energy_token.mint_to_wallet", await mintIx(v1.publicKey), [v1])).to.be.below(BUDGET);
  });

  it("energy_token.transfer_tokens", async () => {
    const ix = await program.methods.transferTokens(new BN(50)).accounts({
      fromTokenAccount: destAta, toTokenAccount: payerAta, mint: mintPda, fromAuthority: destOwner.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID,
    } as any).instruction();
    expect(cu("energy_token.transfer_tokens", ix, [destOwner])).to.be.below(BUDGET);
  });

  it("energy_token.burn_tokens", async () => {
    const ix = await program.methods.burnTokens(new BN(10)).accounts({
      mint: mintPda, tokenAccount: destAta, authority: destOwner.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID,
    } as any).instruction();
    expect(cu("energy_token.burn_tokens", ix, [destOwner])).to.be.below(BUDGET);
  });

  it("energy_token.remove_rec_validator", async () => {
    const ix = await program.methods.removeRecValidator(v1.publicKey).accounts({ tokenInfo: infoPda, authority: payer.publicKey } as any).instruction();
    expect(cu("energy_token.remove_rec_validator", ix)).to.be.below(BUDGET);
  });
});
