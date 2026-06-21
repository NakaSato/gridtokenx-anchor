// In-process compute-unit profile for the treasury economic hot paths (swap / redeem /
// stake / settlement recording) plus the admin/attestation primitives. Measured via
// litesvm `computeUnitsConsumed()` against the default-feature .so (no `localnet`, so
// compute_fn! is a no-op — production-representative). No validator required.
//
// Account wiring mirrors tests/treasury_redeem_guards_litesvm.ts (Token-2022, 9-dec GRX
// external mint, treasury-PDA-owned THBG + vaults). Every instruction here SUCCEEDS; the
// assertions pin each under the 200k default budget so a regression trips CI.

import { LiteSVM, Clock, FailedTransactionMetadata, TransactionMetadata } from "litesvm";
import * as anchorPkg from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Treasury } from "../target/types/treasury";
import { expect } from "chai";
import { PublicKey, Keypair, Transaction, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  MINT_SIZE,
  createInitializeMint2Instruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import BN from "bn.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const treasuryIdl = require("../target/idl/treasury.json");

const RATE = 4_000_000;
const FEE_BPS = 25;
const TTL = 3600;
const NOW = 1_000_000;
const BUDGET = 200_000;

describe("treasury CU profile (litesvm)", () => {
  let svm: LiteSVM;
  let treasury: Program<Treasury>;
  let treasuryId: PublicKey;

  const payer = Keypair.generate(); // authority + attestor + recorder + the swapping/staking user
  const grxMintKp = Keypair.generate();

  let grxMint: PublicKey, treasuryPda: PublicKey, thbgMint: PublicKey, swapVault: PublicKey;
  let stakeVault: PublicKey, userGrxAta: PublicKey, userThbgAta: PublicKey;

  const profile: Array<{ ix: string; cu: number }> = [];
  const pda = (s: string) => PublicKey.findProgramAddressSync([Buffer.from(s)], treasuryId)[0];

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
  // Measure CU of a single-instruction tx (label it, push to the table).
  function cu(label: string, ix: TransactionInstruction, extra: Keypair[] = []): number {
    const r = sendRaw([ix], extra);
    if (r instanceof FailedTransactionMetadata) throw new Error(label + " failed: " + r.err().toString() + "\n" + r.meta().logs().join("\n"));
    const c = Number((r as TransactionMetadata).computeUnitsConsumed());
    profile.push({ ix: label, cu: c });
    return c;
  }

  before(async () => {
    svm = new LiteSVM().withDefaultPrograms();
    treasury = new Program(treasuryIdl, { connection: {}, publicKey: PublicKey.default } as any);
    treasuryId = treasury.programId;
    svm.addProgramFromFile(treasuryId, "target/deploy/treasury.so");
    svm.airdrop(payer.publicKey, BigInt(1_000_000_000_000));

    grxMint = grxMintKp.publicKey;
    treasuryPda = pda("treasury");
    thbgMint = pda("thbg_mint");
    swapVault = pda("swap_vault");
    stakeVault = pda("stake_vault");

    const mintRent = Number(svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE)));
    send([
      SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: grxMint, lamports: mintRent, space: MINT_SIZE, programId: TOKEN_2022_PROGRAM_ID }),
      createInitializeMint2Instruction(grxMint, 9, payer.publicKey, null, TOKEN_2022_PROGRAM_ID),
    ], [grxMintKp]);

    userGrxAta = getAssociatedTokenAddressSync(grxMint, payer.publicKey, false, TOKEN_2022_PROGRAM_ID);
    userThbgAta = getAssociatedTokenAddressSync(thbgMint, payer.publicKey, false, TOKEN_2022_PROGRAM_ID);

    svm.setClock(new Clock(svm.getClock().slot, 0n, 0n, 0n, BigInt(NOW)));
  });

  after(() => {
    const w = Math.max(...profile.map((p) => p.ix.length));
    console.log("\n  CU profile (default features, no localnet):");
    for (const p of profile) console.log(`    ${p.ix.padEnd(w)}  ${p.cu.toString().padStart(7)} CU`);
  });

  it("treasury.initialize", async () => {
    const ix = await treasury.methods.initialize(payer.publicKey, payer.publicKey, new BN(RATE), FEE_BPS, new BN(TTL))
      .accounts({
        treasury: treasuryPda, grxMint, thbgMint, swapVault,
        stakeVault, rewardVault: pda("reward_vault"),
        authority: payer.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId, rent: anchorPkg.web3.SYSVAR_RENT_PUBKEY,
      } as any).instruction();
    expect(cu("treasury.initialize", ix)).to.be.below(BUDGET);

    // Fund user GRX + create THBG ATA (setup, not measured).
    send([
      createAssociatedTokenAccountInstruction(payer.publicKey, userGrxAta, payer.publicKey, grxMint, TOKEN_2022_PROGRAM_ID),
      createMintToInstruction(grxMint, userGrxAta, payer.publicKey, 100_000_000_000, [], TOKEN_2022_PROGRAM_ID),
      createAssociatedTokenAccountInstruction(payer.publicKey, userThbgAta, payer.publicKey, thbgMint, TOKEN_2022_PROGRAM_ID),
    ]);
  });

  it("treasury.update_attestation", async () => {
    const ix = await treasury.methods.updateAttestation(new BN("1000000000000"))
      .accounts({ treasury: treasuryPda, attestor: payer.publicKey } as any).instruction();
    expect(cu("treasury.update_attestation", ix)).to.be.below(BUDGET);
  });

  it("treasury.set_params", async () => {
    const ix = await treasury.methods.setParams(new BN(RATE), FEE_BPS, new BN(TTL), false, payer.publicKey)
      .accounts({ treasury: treasuryPda, authority: payer.publicKey } as any).instruction();
    expect(cu("treasury.set_params", ix)).to.be.below(BUDGET);
  });

  it("treasury.swap_grx_for_thbg", async () => {
    const ix = await treasury.methods.swapGrxForThbg(new BN(2_000_000_000))
      .accounts({ treasury: treasuryPda, grxMint, thbgMint, swapVault, userGrxAta, userThbgAta, user: payer.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID } as any).instruction();
    expect(cu("treasury.swap_grx_for_thbg", ix)).to.be.below(BUDGET);
  });

  it("treasury.redeem_thbg_for_grx", async () => {
    const ix = await treasury.methods.redeemThbgForGrx(new BN(4_000_000))
      .accounts({ treasury: treasuryPda, grxMint, thbgMint, swapVault, userGrxAta, userThbgAta, user: payer.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID } as any).instruction();
    expect(cu("treasury.redeem_thbg_for_grx", ix)).to.be.below(BUDGET);
  });

  it("treasury.stake_grx (first — inits position)", async () => {
    const position = PublicKey.findProgramAddressSync([Buffer.from("stake"), payer.publicKey.toBuffer()], treasuryId)[0];
    const ix = await treasury.methods.stakeGrx(new BN(1_000_000_000))
      .accounts({ treasury: treasuryPda, position, grxMint, stakeVault, userGrxAta, user: payer.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID, systemProgram: SystemProgram.programId } as any).instruction();
    expect(cu("treasury.stake_grx[first]", ix)).to.be.below(BUDGET);
  });

  it("treasury.record_settlement", async () => {
    // recorder = payer (set as settlement_recorder at init).
    const ix = await treasury.methods.recordSettlement(new BN(1_000_000))
      .accounts({ treasury: treasuryPda, recorder: payer.publicKey } as any).instruction();
    expect(cu("treasury.record_settlement", ix)).to.be.below(BUDGET);
  });
});
