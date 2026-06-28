// Litesvm coverage for energy-token `mint_tokens_direct` — the production REC-mint
// instruction the REGISTRY CPIs into (registry::settle_and_mint_tokens lib.rs:678 and
// claim_airdrop lib.rs:354). Previously untested at the instruction level.
//
// Guards exercised (lib.rs:452):
//   UnauthorizedAuthority  — caller is neither token_info.authority (admin) nor registry_authority
//   RecValidatorNotFound   — REC validators registered (count > 0) but co-signer not in the set
//   count==0 skip (HARDENED) — when NO validator is registered the REC gate cannot be satisfied.
//                            The skip is now restricted to the REGISTRY caller (is_registry) so the
//                            airdrop/settle bootstrap still works, while a human ADMIN is rejected
//                            (RecValidatorNotFound) — it can no longer mint un-RECed just because
//                            the validator set is empty. (mint_to_wallet/mint_generation reject at
//                            count==0 outright; this keeps only the registry bootstrap path.)
//   control (count>0)       — admin + a registered REC co-signer → mint succeeds, balance grows.
//
// mint_tokens_direct mints to a pre-existing Token-2022 ATA bound to the canonical mint.

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
  unpackAccount,
} from "@solana/spl-token";
import BN from "bn.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const idl = require("../target/idl/energy_token.json");

describe("energy-token mint_tokens_direct guards (litesvm)", () => {
  let svm: LiteSVM;
  let program: Program<EnergyToken>;
  let programId: PublicKey;

  const payer = Keypair.generate();   // token authority (admin) + funder
  const registryAuth = Keypair.generate(); // distinct registry_authority (the registry CPI caller)
  const destOwner = Keypair.generate();
  const v1 = Keypair.generate();      // a registered REC validator
  const v2 = Keypair.generate();      // a non-registered validator
  const attacker = Keypair.generate();

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

  const directIx = (authority: PublicKey, recValidator: PublicKey, amount: number) =>
    program.methods.mintTokensDirect(new BN(amount)).accounts({
      tokenInfo: infoPda,
      mint: mintPda,
      userTokenAccount: destAta,
      authority,
      registryAuthority: registryAuth.publicKey, // must equal token_info.registry_authority
      recValidator,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    } as any).instruction();

  function destBalance(): bigint {
    const acct = svm.getAccount(destAta)!;
    return unpackAccount(destAta, { ...acct, data: Buffer.from(acct.data) } as any, TOKEN_2022_PROGRAM_ID).amount;
  }

  before(async () => {
    svm = new LiteSVM().withDefaultPrograms();
    program = new Program(idl, { connection: {}, publicKey: PublicKey.default } as any);
    programId = program.programId;
    svm.addProgramFromFile(programId, "target/deploy/energy_token.so");
    svm.airdrop(payer.publicKey, BigInt(1_000_000_000_000));

    [mintPda] = PublicKey.findProgramAddressSync([Buffer.from("mint_2022")], programId);
    [infoPda] = PublicKey.findProgramAddressSync([Buffer.from("token_info_2022")], programId);

    // admin authority = payer; registry_authority = a DISTINCT key so the admin vs registry
    // distinction is testable (count==0 REC-skip is registry-only after the hardening).
    send([await program.methods.initializeToken(PublicKey.default, registryAuth.publicKey).accounts({
      tokenInfo: infoPda, mint: mintPda, authority: payer.publicKey,
      systemProgram: SystemProgram.programId, tokenProgram: TOKEN_2022_PROGRAM_ID, rent: anchorPkg.web3.SYSVAR_RENT_PUBKEY,
    } as any).instruction()]);

    destAta = getAssociatedTokenAddressSync(mintPda, destOwner.publicKey, false, TOKEN_2022_PROGRAM_ID);
    send([createAssociatedTokenAccountInstruction(payer.publicKey, destAta, destOwner.publicKey, mintPda, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)]);
  });

  // --- count == 0 phase: REC-skip is restricted to the registry caller (hardened) ---

  it("rejects a caller that is neither admin nor registry_authority (UnauthorizedAuthority)", async () => {
    svm.airdrop(attacker.publicKey, BigInt(1_000_000_000));
    // correct registry_authority account, but authority signer is an unrelated key.
    const blob = sendExpectFail([await directIx(attacker.publicKey, v1.publicKey, 50)], [attacker, v1]);
    expect(blob, blob).to.match(/UnauthorizedAuthority/);
  });

  it("rejects a HUMAN ADMIN minting with no registered validator at count==0 (RecValidatorNotFound)", async () => {
    // Hardening: the count==0 REC-skip is registry-only. The admin (payer) is NOT the
    // registry_authority, so it cannot mint un-RECed just because the validator set is empty.
    const blob = sendExpectFail([await directIx(payer.publicKey, v2.publicKey, 100)], [v2]);
    expect(blob, blob).to.match(/RecValidatorNotFound/);
  });

  it("allows the REGISTRY caller to mint at count==0 (airdrop/settle bootstrap preserved)", async () => {
    svm.airdrop(registryAuth.publicKey, BigInt(1_000_000_000));
    const before = destBalance();
    // authority == registry_authority → is_registry → REC-skip permitted while count==0.
    send([await directIx(registryAuth.publicKey, registryAuth.publicKey, 100)], [registryAuth]);
    expect(destBalance() - before).to.equal(100n);
  });

  // --- arm the REC gate: register v1 → count == 1 ---

  it("once a validator is registered, rejects a non-registered REC co-signer (RecValidatorNotFound)", async () => {
    send([await addValidatorIx(v1.publicKey)]); // count -> 1
    const blob = sendExpectFail([await directIx(payer.publicKey, v2.publicKey, 100)], [v2]);
    expect(blob, blob).to.match(/RecValidatorNotFound/);
  });

  it("mints when admin + a registered REC validator co-sign (control)", async () => {
    const before = destBalance();
    send([await directIx(payer.publicKey, v1.publicKey, 250)], [v1]);
    expect(destBalance() - before).to.equal(250n);
  });
});
