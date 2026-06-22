// Litesvm coverage for the energy-token REC-validator gating + validator-set
// management guards, all previously untested. The REC (Renewable Energy Certificate)
// co-sign requirement is the provenance boundary on mint_to_wallet: once any REC
// validator is registered, every mint must be co-signed by a validator in the set —
// so the admin mint path can't bypass the certificate proof (lib.rs:117-135).
//
//   RecValidatorNotFound   — mint with no / a non-registered REC co-signer
//   ValidatorAlreadyExists — add the same validator twice
//   MaxValidatorsReached   — add a 6th validator (cap is 5)
//   RemoveValidatorNotFound — remove a validator not in the set

import { LiteSVM, FailedTransactionMetadata } from "litesvm";
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

const require = createRequire(import.meta.url);
const idl = require("../target/idl/energy_token.json");

describe("energy-token REC-validator gating guards (litesvm)", () => {
  let svm: LiteSVM;
  let program: Program<EnergyToken>;
  let programId: PublicKey;

  const payer = Keypair.generate(); // token authority (admin) + funder
  const destOwner = Keypair.generate();
  const v1 = Keypair.generate(); // a registered REC validator
  const v2 = Keypair.generate(); // a non-registered validator

  let mintPda: PublicKey;
  let infoPda: PublicKey;
  let destAta: PublicKey;

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

  const addValidatorIx = (v: PublicKey) =>
    program.methods.addRecValidator(v, "rec").accounts({ tokenInfo: infoPda, authority: payer.publicKey } as any).instruction();
  const removeValidatorIx = (v: PublicKey) =>
    program.methods.removeRecValidator(v).accounts({ tokenInfo: infoPda, authority: payer.publicKey } as any).instruction();
  const mintIx = (recValidator: PublicKey | null) =>
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

    [mintPda] = PublicKey.findProgramAddressSync([Buffer.from("mint_2022")], programId);
    [infoPda] = PublicKey.findProgramAddressSync([Buffer.from("token_info_2022")], programId);

    send([await program.methods.initializeToken(PublicKey.default, payer.publicKey).accounts({
      tokenInfo: infoPda, mint: mintPda, authority: payer.publicKey,
      systemProgram: SystemProgram.programId, tokenProgram: TOKEN_2022_PROGRAM_ID, rent: anchorPkg.web3.SYSVAR_RENT_PUBKEY,
    } as any).instruction()]);

    // Destination ATA for the mint control (mint_to_wallet does not create it).
    destAta = getAssociatedTokenAddressSync(mintPda, destOwner.publicKey, false, TOKEN_2022_PROGRAM_ID);
    send([createAssociatedTokenAccountInstruction(payer.publicKey, destAta, destOwner.publicKey, mintPda, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)]);

    // Register one REC validator (v1) → count = 1, so the REC co-sign gate is now armed.
    send([await addValidatorIx(v1.publicKey)]);
  });

  it("rejects adding the same REC validator twice (ValidatorAlreadyExists)", async () => {
    const blob = sendExpectFail([await addValidatorIx(v1.publicKey)]);
    expect(blob, blob).to.match(/ValidatorAlreadyExists/);
  });

  it("rejects removing a validator that is not in the set (RemoveValidatorNotFound)", async () => {
    const blob = sendExpectFail([await removeValidatorIx(v2.publicKey)]);
    expect(blob, blob).to.match(/RemoveValidatorNotFound/);
  });

  it("rejects a mint with no REC co-signer once validators exist (RecValidatorNotFound)", async () => {
    const blob = sendExpectFail([await mintIx(null)]);
    expect(blob, blob).to.match(/RecValidatorNotFound/);
  });

  it("rejects a mint co-signed by a non-registered validator (RecValidatorNotFound)", async () => {
    const blob = sendExpectFail([await mintIx(v2.publicKey)], [v2]);
    expect(blob, blob).to.match(/RecValidatorNotFound/);
  });

  it("accepts a mint co-signed by a registered REC validator (control)", async () => {
    send([await mintIx(v1.publicKey)], [v1]);
  });

  it("rejects all mints once the validator set is empty — no opt-out (0.5)", async () => {
    // Remove the only validator → count == 0. Previously this OPENED an opt-out (mints with
    // no REC proof succeeded). Now REC provenance is mandatory: even the previously-registered
    // v1 is rejected. Re-add v1 afterwards so the cap test below still sees a populated set.
    send([await removeValidatorIx(v1.publicKey)]); // count -> 0
    const blob = sendExpectFail([await mintIx(v1.publicKey)], [v1]);
    expect(blob, blob).to.match(/RecValidatorNotFound/);
    send([await addValidatorIx(v1.publicKey)]); // restore count -> 1
  });

  it("rejects adding a 6th REC validator past the cap of 5 (MaxValidatorsReached)", async () => {
    // v1 already registered; add four more to fill the set (5), then the 6th must fail.
    for (let i = 0; i < 4; i++) send([await addValidatorIx(Keypair.generate().publicKey)]);
    const blob = sendExpectFail([await addValidatorIx(Keypair.generate().publicKey)]);
    expect(blob, blob).to.match(/MaxValidatorsReached/);
  });
});
