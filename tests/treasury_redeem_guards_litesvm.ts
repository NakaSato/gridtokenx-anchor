// Litesvm coverage for the treasury swap/redeem peg & collateral guards, previously
// untested: SupplyUnderflow + InsufficientVault on redeem_thbg_for_grx, plus the Paused
// kill switch and the ZeroAmount guard. (The swap-side peg guards — StaleAttestation,
// PegBreach — are already covered by tests/treasury.ts.)
//
// The headline case is InsufficientVault: it proves the invariant from CLAUDE.md that a
// rate change via set_params can NEVER let a redeemer drain more GRX than the swap vault
// physically holds. We build vault collateral via a swap, then drop grx_per_thbg_rate so
// redeeming a tiny THBG amount would compute grx_out > vault — and the guard rejects it.
//
// Redeem math (lib.rs:548): grx_out = thbg_in * 1e9 / grx_per_thbg_rate.
// Swap math (lib.rs:465):  thbg_net = grx_in * rate / 1e9 - fee; vault += grx_in.

import { LiteSVM, Clock, FailedTransactionMetadata } from "litesvm";
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
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import BN from "bn.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const treasuryIdl = require("../target/idl/treasury.json");

const RATE = 4_000_000; // 4.000000 THBG per whole GRX (thbg 6dp)
const FEE_BPS = 25;
const TTL = 3600;
const NOW = 1_000_000;

describe("treasury redeem peg/collateral guards (litesvm)", () => {
  let svm: LiteSVM;
  let treasury: Program<Treasury>;
  let treasuryId: PublicKey;

  const payer = Keypair.generate(); // authority + attestor + the swapping/redeeming user
  const grxMintKp = Keypair.generate();

  let grxMint: PublicKey;
  let treasuryPda: PublicKey;
  let thbgMint: PublicKey;
  let swapVault: PublicKey;
  let userGrxAta: PublicKey;
  let userThbgAta: PublicKey;

  function trySend(ixs: TransactionInstruction[], extra: Keypair[] = []): FailedTransactionMetadata | null {
    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = payer.publicKey;
    ixs.forEach((ix) => tx.add(ix));
    tx.sign(payer, ...extra);
    const res = svm.sendTransaction(tx);
    svm.expireBlockhash();
    return res instanceof FailedTransactionMetadata ? res : null;
  }
  function send(ixs: TransactionInstruction[], extra: Keypair[] = []) {
    const f = trySend(ixs, extra);
    if (f) throw new Error("tx failed: " + f.err().toString() + "\n" + f.meta().logs().join("\n"));
  }
  function sendExpectFail(ixs: TransactionInstruction[]): string {
    const f = trySend(ixs);
    if (!f) throw new Error("expected tx to fail but it succeeded");
    return f.err().toString() + "\n" + f.meta().logs().join("\n");
  }

  const pda = (s: string) => PublicKey.findProgramAddressSync([Buffer.from(s)], treasuryId)[0];

  const swapIx = (grxIn: number | BN) =>
    treasury.methods.swapGrxForThbg(new BN(grxIn)).accounts({
      treasury: treasuryPda, grxMint, thbgMint, swapVault,
      userGrxAta, userThbgAta, user: payer.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID,
    } as any).instruction();

  const redeemIx = (thbgIn: number | BN) =>
    treasury.methods.redeemThbgForGrx(new BN(thbgIn)).accounts({
      treasury: treasuryPda, grxMint, thbgMint, swapVault,
      userGrxAta, userThbgAta, user: payer.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID,
    } as any).instruction();

  const setParamsIx = (rate: number | BN, paused: boolean) =>
    treasury.methods.setParams(new BN(rate), FEE_BPS, new BN(TTL), paused, payer.publicKey)
      .accounts({ treasury: treasuryPda, authority: payer.publicKey } as any).instruction();

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

    // External GRX mint (Token-2022, 9 dp).
    const mintRent = Number(svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE)));
    send([
      SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: grxMint, lamports: mintRent, space: MINT_SIZE, programId: TOKEN_2022_PROGRAM_ID }),
      createInitializeMint2Instruction(grxMint, 9, payer.publicKey, null, TOKEN_2022_PROGRAM_ID),
    ], [grxMintKp]);

    // Initialize treasury (attestor = recorder = payer).
    send([await treasury.methods
      .initialize(payer.publicKey, payer.publicKey, new BN(RATE), FEE_BPS, new BN(TTL))
      .accounts({
        treasury: treasuryPda, grxMint, thbgMint, swapVault,
        stakeVault: pda("stake_vault"), rewardVault: pda("reward_vault"),
        authority: payer.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId, rent: anchorPkg.web3.SYSVAR_RENT_PUBKEY,
      } as any).instruction()]);

    // User ATAs: grx funded (collateral to swap), thbg empty (swap mints into it).
    userGrxAta = getAssociatedTokenAddressSync(grxMint, payer.publicKey, false, TOKEN_2022_PROGRAM_ID);
    userThbgAta = getAssociatedTokenAddressSync(thbgMint, payer.publicKey, false, TOKEN_2022_PROGRAM_ID);
    send([
      createAssociatedTokenAccountInstruction(payer.publicKey, userGrxAta, payer.publicKey, grxMint, TOKEN_2022_PROGRAM_ID),
      createMintToInstruction(grxMint, userGrxAta, payer.publicKey, 10_000_000_000, [], TOKEN_2022_PROGRAM_ID),
      createAssociatedTokenAccountInstruction(payer.publicKey, userThbgAta, payer.publicKey, thbgMint, TOKEN_2022_PROGRAM_ID),
    ]);

    // Fix the clock and attest a large reserve (fresh) so swaps pass freshness + PegBreach.
    svm.setClock(new Clock(svm.getClock().slot, 0n, 0n, 0n, BigInt(NOW)));
    send([await treasury.methods.updateAttestation(new BN("1000000000000"))
      .accounts({ treasury: treasuryPda, attestor: payer.publicKey } as any).instruction()]);
  });

  it("rejects redeeming more THBG than the tracked supply (SupplyUnderflow)", async () => {
    // Fresh treasury: thbg_supply = 0, so any positive redeem underflows.
    const blob = sendExpectFail([await redeemIx(1)]);
    expect(blob, blob).to.match(/SupplyUnderflow/);
  });

  it("rejects a zero-amount redeem (ZeroAmount)", async () => {
    const blob = sendExpectFail([await redeemIx(0)]);
    expect(blob, blob).to.match(/ZeroAmount/);
  });

  it("swaps GRX→THBG then redeems within vault collateral (control)", async () => {
    // swap 2 GRX → vault += 2e9 GRX, supply += 2e9*4e6/1e9 - fee = 8e6 - 20000 = 7_980_000 THBG.
    send([await swapIx(2_000_000_000)]);
    // redeem 4e6 THBG at rate 4e6 → grx_out = 4e6*1e9/4e6 = 1e9 ≤ vault 2e9 → succeeds.
    send([await redeemIx(4_000_000)]);
    // vault now 1e9, supply ~3_980_000 — used by the InsufficientVault case next.
  });

  it("rejects a redeem that would drain more GRX than the vault holds (InsufficientVault)", async () => {
    // Drop the rate to 1: redeeming thbg_in=2 computes grx_out = 2*1e9/1 = 2e9 > vault (1e9).
    // The collateral guard rejects it even though thbg_in ≤ supply — a rate change cannot
    // let a redeemer drain other swappers' GRX.
    send([await setParamsIx(1, false)]);
    const blob = sendExpectFail([await redeemIx(2)]);
    expect(blob, blob).to.match(/InsufficientVault/);
    send([await setParamsIx(RATE, false)]); // restore
  });

  it("rejects swaps while paused (Paused)", async () => {
    send([await setParamsIx(RATE, true)]);
    const blob = sendExpectFail([await swapIx(1_000_000)]);
    expect(blob, blob).to.match(/Paused/);
    send([await setParamsIx(RATE, false)]); // restore
  });
});
