// REC co-sign gate on energy-token mint_tokens_direct (litesvm, no validator).
//
// The gate has two callers with different contracts (mint_tokens_direct.rs):
//   * ADMIN (authority == token_info.authority): must present a REGISTERED
//     rec_validator co-signer, and cannot mint at all while the validator set
//     is empty — a human authority can never mint un-RECed tokens.
//   * REGISTRY (authority == token_info.registry_authority, i.e. the registry
//     program's PDA CPI-ing in for claim_airdrop / settle_and_mint_tokens):
//     exempt from the co-sign entirely — those are protocol mints with their
//     own guards, and the registry passes its own PDA as a rec_validator
//     placeholder that can never be in the list.
//
// Regression anchor: before 2026-07-18 the registry exemption only applied
// while rec_validators_count == 0, so the first registered REC validator broke
// every welcome airdrop with RecValidatorNotFound (6008). Cases 4/5 pin the
// fixed contract; cases 1-3 pin the admin gate that must NOT loosen.
//
// token_info is fabricated at its PDA byte-for-byte (zero-copy repr(C) layout,
// state.rs:8) so each case picks its own validator set without on-chain setup.

import { LiteSVM, FailedTransactionMetadata } from "litesvm";
import { Program } from "@anchor-lang/core";
import { EnergyToken } from "../target/types/energy_token";
import { expect } from "chai";
import { PublicKey, Keypair, Transaction, TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const energyIdl = require("../target/idl/energy_token.json");

const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
// sha256("account:TokenInfo")[..8] — from target/idl/energy_token.json
const TOKEN_INFO_DISC = Buffer.from([109, 162, 52, 125, 77, 166, 37, 202]);
const REC_VALIDATOR_NOT_FOUND = 6008;

describe("energy-token mint_tokens_direct — REC co-sign gate", () => {
  let svm: LiteSVM;
  let energy: Program<EnergyToken>;
  let energyId: PublicKey;
  let tokenInfoPda: PublicKey;
  let mintPda: PublicKey;

  const admin = Keypair.generate();          // token_info.authority
  const registryAuth = Keypair.generate();   // stands in for the registry PDA
  const recValidator = Keypair.generate();   // the one registered REC validator
  const stranger = Keypair.generate();       // never registered
  const user = Keypair.generate();           // token recipient
  let userAta: PublicKey;

  function send(ix: TransactionInstruction, signers: Keypair[]) {
    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = admin.publicKey;
    tx.add(ix);
    tx.sign(admin, ...signers.filter((s) => !s.publicKey.equals(admin.publicKey)));
    const res = svm.sendTransaction(tx);
    svm.expireBlockhash();
    return res;
  }

  function expectCustomError(res: any, code: number) {
    expect(res instanceof FailedTransactionMetadata, "expected tx failure").to.eq(true);
    // litesvm's err().toString() elides the inner code — assert on the program
    // log line instead ("custom program error: 0x<hex>"), which litesvm keeps.
    const logs = res.meta().logs().join("\n");
    expect(logs, logs).to.contain(`custom program error: 0x${code.toString(16)}`);
  }

  /// Write TokenInfo at its PDA: 8-byte discriminator + repr(C) struct
  /// (authority, registry_authority, registry_program, mint, total_supply,
  /// created_at, rec_validators[5], count, padding[7]) — state.rs:8.
  function installTokenInfo(validators: PublicKey[]) {
    const data = Buffer.alloc(8 + 32 * 4 + 8 + 8 + 160 + 1 + 7);
    let o = 0;
    TOKEN_INFO_DISC.copy(data, o); o += 8;
    admin.publicKey.toBuffer().copy(data, o); o += 32;
    registryAuth.publicKey.toBuffer().copy(data, o); o += 32;
    PublicKey.default.toBuffer().copy(data, o); o += 32;
    mintPda.toBuffer().copy(data, o); o += 32;
    o += 8 + 8; // total_supply, created_at = 0
    validators.forEach((v, i) => v.toBuffer().copy(data, o + 32 * i));
    o += 160;
    data.writeUInt8(validators.length, o);
    svm.setAccount(tokenInfoPda, {
      lamports: Number(svm.minimumBalanceForRentExemption(BigInt(data.length))),
      data, owner: energyId, executable: false, rentEpoch: 0,
    } as any);
  }

  /// Base 82-byte SPL mint owned by Token-2022, mint_authority = token_info PDA
  /// (mint_tokens_direct signs the mint_to CPI with the token_info seeds).
  function installMint() {
    const data = Buffer.alloc(82);
    data.writeUInt32LE(1, 0);                        // COption::Some(mint_authority)
    tokenInfoPda.toBuffer().copy(data, 4);
    data.writeUInt8(9, 44);                          // decimals
    data.writeUInt8(1, 45);                          // is_initialized
    svm.setAccount(mintPda, {
      lamports: Number(svm.minimumBalanceForRentExemption(82n)),
      data, owner: TOKEN_2022, executable: false, rentEpoch: 0,
    } as any);
  }

  /// Base 165-byte token account owned by Token-2022 for `user`.
  function installUserAta(): PublicKey {
    const key = Keypair.generate().publicKey;
    const data = Buffer.alloc(165);
    mintPda.toBuffer().copy(data, 0);
    user.publicKey.toBuffer().copy(data, 32);
    data.writeUInt8(1, 108);                         // state = Initialized
    svm.setAccount(key, {
      lamports: Number(svm.minimumBalanceForRentExemption(165n)),
      data, owner: TOKEN_2022, executable: false, rentEpoch: 0,
    } as any);
    return key;
  }

  const ataAmount = () =>
    Number(Buffer.from(svm.getAccount(userAta)!.data).readBigUInt64LE(64));

  async function mintIx(authority: Keypair, rec: Keypair) {
    return energy.methods
      .mintTokensDirect(new BN(1_000_000_000)) // 1 token, 9 dec
      .accounts({
        tokenInfo: tokenInfoPda, mint: mintPda, userTokenAccount: userAta,
        authority: authority.publicKey, registryAuthority: registryAuth.publicKey,
        recValidator: rec.publicKey, tokenProgram: TOKEN_2022,
      } as any)
      .instruction();
  }

  before(() => {
    svm = new LiteSVM().withDefaultPrograms();
    energy = new Program(energyIdl, { connection: {}, publicKey: PublicKey.default } as any);
    energyId = energy.programId;
    svm.addProgramFromFile(energyId, "target/deploy/energy_token.so");
    svm.airdrop(admin.publicKey, BigInt(1_000_000_000_000));

    [tokenInfoPda] = PublicKey.findProgramAddressSync([Buffer.from("token_info_2022")], energyId);
    [mintPda] = PublicKey.findProgramAddressSync([Buffer.from("mint_2022")], energyId);
    installMint();
    userAta = installUserAta();
  });

  it("1. admin + registered rec_validator mints (count > 0)", async () => {
    installTokenInfo([recValidator.publicKey]);
    const before = ataAmount();
    const res = send(await mintIx(admin, recValidator), [admin, recValidator]);
    expect(res instanceof FailedTransactionMetadata, "expected success").to.eq(false);
    expect(ataAmount() - before).to.eq(1_000_000_000);
  });

  it("2. admin + UNregistered rec_validator → RecValidatorNotFound", async () => {
    installTokenInfo([recValidator.publicKey]);
    expectCustomError(send(await mintIx(admin, stranger), [admin, stranger]), REC_VALIDATOR_NOT_FOUND);
  });

  it("3. admin with EMPTY validator set → RecValidatorNotFound (no count==0 bypass)", async () => {
    installTokenInfo([]);
    expectCustomError(send(await mintIx(admin, recValidator), [admin, recValidator]), REC_VALIDATOR_NOT_FOUND);
  });

  it("4. registry authority bypasses the gate with count > 0 (welcome-airdrop regression)", async () => {
    installTokenInfo([recValidator.publicKey]);
    const before = ataAmount();
    // registry passes an arbitrary placeholder as rec_validator — never in the list
    const res = send(await mintIx(registryAuth, stranger), [registryAuth, stranger]);
    expect(res instanceof FailedTransactionMetadata, "expected success").to.eq(false);
    expect(ataAmount() - before).to.eq(1_000_000_000);
  });

  it("5. registry authority bypasses the gate with count == 0 (bootstrap mints)", async () => {
    installTokenInfo([]);
    const before = ataAmount();
    const res = send(await mintIx(registryAuth, stranger), [registryAuth, stranger]);
    expect(res instanceof FailedTransactionMetadata, "expected success").to.eq(false);
    expect(ataAmount() - before).to.eq(1_000_000_000);
  });
});
