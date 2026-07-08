// Litesvm coverage for the energy-token mint_generation hardening guards
// (lib.rs mint_generation). These three guards were added on top of the existing
// idempotency + REC-cosign path and are NOT exercised by the validator-only
// generation_mint_idempotency.ts suite:
//
//   ZeroAmount              — amount == 0 would be a silent mint_to no-op that still
//                             stamps minted=true, poisoning the (meter,window) forever.
//   MisalignedWindow        — window_start_ms in the future (> now + one 900s window)
//                             is rejected; a settlement window cannot start ahead of now.
//   RecValidatorIsAuthority — the REC co-signer must differ from the platform authority,
//                             else one key satisfies both gates (2-of-2 collapses to 1-of-1).
//
// A valid control (amount>0, past-or-now aligned window, distinct registered REC
// validator) must still mint and stamp the record.

import { LiteSVM, Clock, FailedTransactionMetadata } from "litesvm";
import * as anchorPkg from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { EnergyToken } from "../target/types/energy_token";
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
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import BN from "bn.js";
import { createRequire } from "module";
import { fabricateGovernanceConfig } from "./litesvm-admit";

const require = createRequire(import.meta.url);
const idl = require("../target/idl/energy_token.json");

// A 900-s-aligned unix time to warp the litesvm clock to. mint_generation's upper
// bound compares window_start_ms/1000 against now + 900, so "now" must be set or a
// real-world window would look like the far future and fail the alignment guard.
const NOW = 1_700_002_800; // % 900 == 0
const VALID_WINDOW_MS = new BN(NOW).mul(new BN(1000)); // now, aligned, <= now+900
const FUTURE_WINDOW_MS = new BN(NOW + 1800).mul(new BN(1000)); // now + two windows → rejected

describe("energy-token mint_generation hardening guards (litesvm)", () => {
  let svm: LiteSVM;
  let program: Program<EnergyToken>;
  let programId: PublicKey;

  const payer = Keypair.generate(); // token authority (admin) + funder
  const destOwner = Keypair.generate();
  const v1 = Keypair.generate(); // a registered REC validator, distinct from the authority

  let mintPda: PublicKey;
  let infoPda: PublicKey;
  let destAta: PublicKey;
  let governanceConfigPda: PublicKey;

  function trySend(ixs: TransactionInstruction[], signers: Keypair[]): FailedTransactionMetadata | null {
    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = payer.publicKey;
    ixs.forEach((ix) => tx.add(ix));
    tx.sign(payer, ...signers);
    const res = svm.sendTransaction(tx);
    svm.expireBlockhash();
    return res instanceof FailedTransactionMetadata ? res : null;
  }
  function send(ixs: TransactionInstruction[], signers: Keypair[] = []) {
    const f = trySend(ixs, signers);
    if (f) throw new Error("tx failed: " + f.err().toString() + "\n" + f.meta().logs().join("\n"));
  }
  function sendExpectFail(ixs: TransactionInstruction[], signers: Keypair[] = []): string {
    const f = trySend(ixs, signers);
    if (!f) throw new Error("expected tx to fail but it succeeded");
    return f.err().toString() + "\n" + f.meta().logs().join("\n");
  }

  // 16-byte meter id — distinct first byte per test so each hits a fresh
  // (meter, window) GenerationMintRecord PDA and cannot collide with another.
  const meterId = (seed: number): Buffer => {
    const b = Buffer.alloc(16);
    b.writeUInt8(seed, 0);
    return b;
  };
  const genMintPda = (meter: Buffer, windowMs: BN) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("gen_mint"), meter, windowMs.toArrayLike(Buffer, "le", 8)],
      programId
    )[0];

  const addValidatorIx = (v: PublicKey) =>
    program.methods.addRecValidator(v, "rec").accounts({ tokenInfo: infoPda, governanceConfig: governanceConfigPda, authority: payer.publicKey } as any).instruction();

  const mintGenIx = (meter: Buffer, windowMs: BN, amount: BN, recValidator: PublicKey) =>
    program.methods.mintGeneration(Array.from(meter), windowMs, amount).accounts({
      mint: mintPda, tokenInfo: infoPda, destination: destAta, destinationOwner: destOwner.publicKey,
      mintRecord: genMintPda(meter, windowMs),
      authority: payer.publicKey, recValidator, payer: payer.publicKey,
      tokenProgram: TOKEN_2022_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    } as any).instruction();

  before(async () => {
    svm = new LiteSVM().withDefaultPrograms();
    svm.setClock(new Clock(svm.getClock().slot, 0n, 0n, 0n, BigInt(NOW)));
    program = new Program(idl, { connection: {}, publicKey: PublicKey.default } as any);
    programId = program.programId;
    svm.addProgramFromFile(programId, "target/deploy/energy_token.so");
    svm.airdrop(payer.publicKey, BigInt(1_000_000_000_000));

    [mintPda] = PublicKey.findProgramAddressSync([Buffer.from("mint_2022")], programId);
    [infoPda] = PublicKey.findProgramAddressSync([Buffer.from("token_info_2022")], programId);
    governanceConfigPda = fabricateGovernanceConfig(svm, payer.publicKey);

    send([await program.methods.initializeToken(PublicKey.default, payer.publicKey).accounts({
      tokenInfo: infoPda, mint: mintPda, authority: payer.publicKey,
      systemProgram: SystemProgram.programId, tokenProgram: TOKEN_2022_PROGRAM_ID, rent: anchorPkg.web3.SYSVAR_RENT_PUBKEY,
    } as any).instruction()]);

    // Destination ATA (mint_generation does not create it).
    destAta = getAssociatedTokenAddressSync(mintPda, destOwner.publicKey, false, TOKEN_2022_PROGRAM_ID);
    send([createAssociatedTokenAccountInstruction(payer.publicKey, destAta, destOwner.publicKey, mintPda, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)]);

    // Register BOTH the authority (payer) and a distinct validator (v1) as REC validators.
    // The authority is registered so the RecValidatorIsAuthority guard is reached AFTER
    // the rec_validator_registered check (proving it's the same-key guard firing, not the
    // registration guard). v1 is the valid, distinct co-signer for the control + guard tests.
    send([await addValidatorIx(payer.publicKey)]);
    send([await addValidatorIx(v1.publicKey)]);
  });

  it("rejects a zero-amount mint (ZeroAmount) — window must not be poisoned", async () => {
    const blob = sendExpectFail([await mintGenIx(meterId(1), VALID_WINDOW_MS, new BN(0), v1.publicKey)], [v1]);
    expect(blob, blob).to.match(/ZeroAmount/);
  });

  it("rejects a future window past now + one window (MisalignedWindow)", async () => {
    const blob = sendExpectFail([await mintGenIx(meterId(2), FUTURE_WINDOW_MS, new BN(5_000), v1.publicKey)], [v1]);
    expect(blob, blob).to.match(/MisalignedWindow/);
  });

  it("rejects a REC co-signer equal to the platform authority (RecValidatorIsAuthority)", async () => {
    // recValidator = payer (the authority) — it IS a registered validator, so the
    // registration check passes and the distinct-key guard is what rejects it.
    const blob = sendExpectFail([await mintGenIx(meterId(3), VALID_WINDOW_MS, new BN(5_000), payer.publicKey)]);
    expect(blob, blob).to.match(/RecValidatorIsAuthority/);
  });

  it("accepts a valid mint: amount>0, now-aligned window, distinct REC validator (control)", async () => {
    const meter = meterId(4);
    send([await mintGenIx(meter, VALID_WINDOW_MS, new BN(5_000), v1.publicKey)], [v1]);
    // Decode straight from litesvm — its stub connection has no getAccountInfo RPC.
    const record = program.coder.accounts.decode(
      "generationMintRecord",
      Buffer.from(svm.getAccount(genMintPda(meter, VALID_WINDOW_MS))!.data)
    );
    expect(record.minted).to.equal(true);
    expect(record.amount.toString()).to.equal("5000");
    // SPL Token-2022 account: amount is a u64 at offset 64.
    const bal = Buffer.from(svm.getAccount(destAta)!.data).readBigUInt64LE(64);
    expect(bal).to.equal(5_000n);
  });
});
