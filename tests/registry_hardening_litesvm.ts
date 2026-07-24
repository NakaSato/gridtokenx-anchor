// Registry hardening guards (litesvm, no validator). Pins three 2026-07 fixes:
//
//   1. mark_erc_claimed is registry.authority ONLY. The oracle_authority key was
//      previously accepted here; dropping it closes a grief vector where the
//      oracle could inflate claimed_erc_generation (denying future REC/GRID) with
//      no ERC minted. (mark_erc_claimed.rs:26-30)
//   2. mark_erc_claimed bounds the claim against NET generation
//      (total_generation - total_consumption - claimed - settled) — the
//      authoritative bound the governance issue_erc precheck mirrors, so combined
//      GRID + REC claims can never exceed net generation. (mark_erc_claimed.rs:34-42)
//   3. claim_airdrop / settle_and_mint_tokens pin energy_token_program to
//      energy_token::ID via an account constraint, failing fast with
//      InvalidEnergyTokenProgram rather than relying on the CPI. (claim_airdrop.rs:38)
//
// Accounts are fabricated byte-for-byte at their zero-copy repr(C) layouts
// (state.rs) so each case runs with no on-chain setup.

import { LiteSVM, FailedTransactionMetadata } from "litesvm";
import { Program } from "@anchor-lang/core";
import { Registry } from "../target/types/registry";
import { expect } from "chai";
import { PublicKey, Keypair, Transaction, TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const registryIdl = require("../target/idl/registry.json");

const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const ENERGY_TOKEN_ID = new PublicKey("6FZKcVKCLFSNLMxypFJGU4K14xUBnxNW9VAuKGhmqjGX");

// account discriminators (sha256("account:<Name>")[..8]) — target/idl/registry.json
const REGISTRY_DISC = Buffer.from([47, 174, 110, 246, 184, 182, 252, 218]);
const METER_DISC = Buffer.from([87, 111, 139, 87, 181, 20, 104, 255]);
const USER_DISC = Buffer.from([211, 33, 136, 16, 186, 110, 242, 127]);

const UNAUTHORIZED_AUTHORITY = 6001;
const NO_UNSETTLED_BALANCE = 6003;
const INVALID_ENERGY_TOKEN_PROGRAM = 6033;

describe("registry hardening — mark_erc_claimed auth/net-basis + energy-token pinning", () => {
  let svm: LiteSVM;
  let registry: Program<Registry>;
  let registryId: PublicKey;
  let registryPda: PublicKey;

  const authority = Keypair.generate(); // registry.authority
  const oracle = Keypair.generate();    // registry.oracle_authority (must NOT pass)
  const stranger = Keypair.generate();  // neither
  const payer = Keypair.generate();     // fee payer

  function send(ix: TransactionInstruction, signers: Keypair[]) {
    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = payer.publicKey;
    tx.add(ix);
    tx.sign(payer, ...signers.filter((s) => !s.publicKey.equals(payer.publicKey)));
    const res = svm.sendTransaction(tx);
    svm.expireBlockhash();
    return res;
  }

  function expectCustomError(res: any, code: number) {
    expect(res instanceof FailedTransactionMetadata, "expected tx failure").to.eq(true);
    const logs = res.meta().logs().join("\n");
    expect(logs, logs).to.contain(`custom program error: 0x${code.toString(16)}`);
  }

  function expectNotError(res: any, code: number) {
    if (!(res instanceof FailedTransactionMetadata)) return; // success is fine
    const logs = res.meta().logs().join("\n");
    expect(logs, logs).to.not.contain(`custom program error: 0x${code.toString(16)}`);
  }

  // Registry at [b"registry"]: disc | authority | oracle_authority | has_oracle |
  // has_slash | pad[6] | user_count | meter_count | active_meter_count | slash_dest.
  function installRegistry() {
    const data = Buffer.alloc(136);
    let o = 0;
    REGISTRY_DISC.copy(data, o); o += 8;
    authority.publicKey.toBuffer().copy(data, o); o += 32;
    oracle.publicKey.toBuffer().copy(data, o); o += 32;
    data.writeUInt8(1, o); o += 1;   // has_oracle_authority = 1 (valid but no longer honored here)
    // has_slash(1) pad(6) user_count(8) meter_count(8) active(8) slash_dest(32) — all zero
    svm.setAccount(registryPda, {
      lamports: Number(svm.minimumBalanceForRentExemption(136n)),
      data, owner: registryId, executable: false, rentEpoch: 0,
    } as any);
  }

  // MeterAccount at an arbitrary address (no seed constraint on this ctx), owned by
  // registry: disc | meter_id[32] | owner[32] | meter_type | status | pad[2] |
  // zone_id[4] | registered | last_reading | total_gen | total_cons | settled | claimed.
  function installMeter(totalGen: bigint, totalCons: bigint, claimed: bigint, settled: bigint): PublicKey {
    const key = Keypair.generate().publicKey;
    const data = Buffer.alloc(128);
    METER_DISC.copy(data, 0);
    authority.publicKey.toBuffer().copy(data, 40); // owner (not checked here)
    data.writeBigUInt64LE(totalGen, 96);
    data.writeBigUInt64LE(totalCons, 104);
    data.writeBigUInt64LE(settled, 112);
    data.writeBigUInt64LE(claimed, 120);
    svm.setAccount(key, {
      lamports: Number(svm.minimumBalanceForRentExemption(128n)),
      data, owner: registryId, executable: false, rentEpoch: 0,
    } as any);
    return key;
  }

  // UserAccount at [b"user", authority] owned by registry — just enough to
  // deserialize so try_accounts reaches the energy_token_program constraint.
  function installUser(auth: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync([Buffer.from("user"), auth.toBuffer()], registryId);
    const data = Buffer.alloc(112);
    USER_DISC.copy(data, 0);
    auth.toBuffer().copy(data, 8); // authority
    svm.setAccount(pda, {
      lamports: Number(svm.minimumBalanceForRentExemption(112n)),
      data, owner: registryId, executable: false, rentEpoch: 0,
    } as any);
    return pda;
  }

  const markIx = (meter: PublicKey, signer: Keypair, amount: number) =>
    registry.methods
      .markErcClaimed(new BN(amount))
      .accounts({ meterAccount: meter, registry: registryPda, authority: signer.publicKey } as any)
      .instruction();

  const claimIx = (energyProgram: PublicKey) => {
    const userPda = installUser(authority.publicKey);
    return registry.methods
      .claimAirdrop()
      .accounts({
        userAccount: userPda,
        registry: registryPda,
        authority: authority.publicKey,
        payer: payer.publicKey,
        energyTokenProgram: energyProgram,
        mint: Keypair.generate().publicKey,
        userTokenAccount: Keypair.generate().publicKey,
        tokenInfo: Keypair.generate().publicKey,
        tokenProgram: TOKEN_2022,
      } as any)
      .instruction();
  };

  before(() => {
    svm = new LiteSVM().withDefaultPrograms();
    registry = new Program(registryIdl, { connection: {}, publicKey: PublicKey.default } as any);
    registryId = registry.programId;
    svm.addProgramFromFile(registryId, "target/deploy/registry.so");
    svm.airdrop(payer.publicKey, BigInt(1_000_000_000_000));
    [registryPda] = PublicKey.findProgramAddressSync([Buffer.from("registry")], registryId);
    installRegistry();
  });

  it("1. registry.authority marks a claim within net generation (success)", async () => {
    const meter = installMeter(10_000n, 0n, 0n, 0n); // net = 10_000
    const res = send(await markIx(meter, authority, 5_000), [authority]);
    expect(res instanceof FailedTransactionMetadata, "expected success").to.eq(false);
  });

  it("2. oracle_authority is REJECTED → UnauthorizedAuthority (regression: oracle dropped)", async () => {
    const meter = installMeter(10_000n, 0n, 0n, 0n);
    expectCustomError(send(await markIx(meter, oracle, 5_000), [oracle]), UNAUTHORIZED_AUTHORITY);
  });

  it("3. an unrelated signer is REJECTED → UnauthorizedAuthority", async () => {
    const meter = installMeter(10_000n, 0n, 0n, 0n);
    expectCustomError(send(await markIx(meter, stranger, 5_000), [stranger]), UNAUTHORIZED_AUTHORITY);
  });

  it("4. claim exceeding NET generation is REJECTED → NoUnsettledBalance", async () => {
    // net = total_gen - total_cons = 10_000 - 4_000 = 6_000; already claimed 1_000; settled 2_000
    // → unclaimed = 3_000, so 4_000 must fail.
    const meter = installMeter(10_000n, 4_000n, 1_000n, 2_000n);
    expectCustomError(send(await markIx(meter, authority, 4_000), [authority]), NO_UNSETTLED_BALANCE);
  });

  it("5. claim within the net bound after consumption/prior-claims (success)", async () => {
    const meter = installMeter(10_000n, 4_000n, 1_000n, 2_000n); // unclaimed = 3_000
    const res = send(await markIx(meter, authority, 3_000), [authority]);
    expect(res instanceof FailedTransactionMetadata, "expected success").to.eq(false);
  });

  it("6. claim_airdrop with WRONG energy_token_program → InvalidEnergyTokenProgram", async () => {
    expectCustomError(send(await claimIx(Keypair.generate().publicKey), [payer]), INVALID_ENERGY_TOKEN_PROGRAM);
  });

  it("7. claim_airdrop with the real energy_token::ID clears the pin (not InvalidEnergyTokenProgram)", async () => {
    // The constraint is satisfied, so the tx proceeds past account validation; it may
    // still fail later (no real energy-token program loaded), but NOT on the pin.
    expectNotError(send(await claimIx(ENERGY_TOKEN_ID), [payer]), INVALID_ENERGY_TOKEN_PROGRAM);
  });
});
