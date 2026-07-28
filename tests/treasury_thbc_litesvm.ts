// Treasury THBC invariants F1/F3/F5/F6 against the real compiled program (litesvm,
// no validator).
//
// Why this suite exists: treasury has had NO litesvm coverage since tests/treasury.ts
// was removed in b2021fb — the only invariant coverage was the Crucible fuzz harness.
// Meanwhile the spec's §13 test plan asks for exactly these four, and until now they
// were argued from the source rather than demonstrated:
//
//   F1  thbc_supply + amount <= attested_reserve            issue_thbc, PegBreach
//   F3  one bank_ref => at most one issuance                 [b"deposit", H(ref)] nullifier
//   F5  now - attestation_ts <= ttl, else issuance halts     issue_thbc, StaleAttestation
//   F6  the exchange path never changes thbc_supply          exchange_*, transfers only
//
// F3 is the one that most needed a real runtime. Its guarantee is Anchor `init` on a
// PDA in the SAME instruction as the mint, so a replay is rejected by the SOLANA
// RUNTIME before any program code runs. That is not something a unit test over
// extracted math can show — it is a property of account creation, and it needs an SVM.
//
// Treasury is fabricated at its PDA byte-for-byte (zero-copy repr(C), state.rs:27) so
// each case picks its own reserve/clock/supply without running `initialize`.

import { LiteSVM, Clock, FailedTransactionMetadata } from "litesvm";
import { Program } from "@anchor-lang/core";
import { Treasury } from "../target/types/treasury";
import { expect } from "chai";
import { PublicKey, Keypair, Transaction, TransactionInstruction, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";
import { createRequire } from "module";
import { createHash } from "crypto";

const require = createRequire(import.meta.url);
const treasuryIdl = require("../target/idl/treasury.json");

const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

// From target/idl/treasury.json — sha256("account:Treasury")[..8].
const TREASURY_DISC = Buffer.from([238, 239, 123, 238, 89, 1, 168, 253]);

// error.rs order: 6000 UnauthorizedAuthority, 6001 UnauthorizedAttestor,
// 6002 UnauthorizedRecorder, 6003 Paused, 6004 ZeroAmount, 6005 MathOverflow,
// 6006 StaleAttestation, 6007 PegBreach, 6008 RateNotSet, ...
const STALE_ATTESTATION = 6006;
const PEG_BREACH = 6007;
const INSUFFICIENT_INVENTORY = 6019;

const NOW = 1_800_000_000;
const TTL = 3_600;
const RATE = 4_000_000; // THBC minor units per whole GRX
const FEE_BPS = 25;

/** H(bank_ref) — must match `BankRef::hash` in gridtokenx-thbc-service. */
function bankRefHash(reference: string): Buffer {
  return createHash("sha256").update(reference.trim().toUpperCase(), "utf8").digest();
}

describe("treasury THBC — F1/F3/F5/F6 invariants", () => {
  let svm: LiteSVM;
  let treasury: Program<Treasury>;
  let programId: PublicKey;

  let treasuryPda: PublicKey, treasuryBump: number;
  let thbcMintPda: PublicKey, thbcMintBump: number;
  let inventoryPda: PublicKey, inventoryBump: number;
  let swapVaultPda: PublicKey, swapVaultBump: number;

  const authority = Keypair.generate(); // also the issuer (disclosed conflation)
  const attestor = Keypair.generate();
  const user = Keypair.generate();
  const grxMint = Keypair.generate().publicKey;

  let userThbcAta: PublicKey;
  let userGrxAta: PublicKey;

  function send(ix: TransactionInstruction, signers: Keypair[]) {
    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = authority.publicKey;
    tx.add(ix);
    tx.sign(authority, ...signers.filter((s) => !s.publicKey.equals(authority.publicKey)));
    const res = svm.sendTransaction(tx);
    svm.expireBlockhash();
    return res;
  }

  const ok = (res: any) => {
    if (res instanceof FailedTransactionMetadata) {
      throw new Error("expected success, got:\n" + res.meta().logs().join("\n"));
    }
    return res;
  };

  function expectCustomError(res: any, code: number) {
    expect(res instanceof FailedTransactionMetadata, "expected tx failure").to.eq(true);
    const logs = res.meta().logs().join("\n");
    expect(logs, logs).to.contain(`custom program error: 0x${code.toString(16)}`);
  }

  /** Any failure — F3's replay is rejected by the RUNTIME (account already in use), not
   *  by a program error code, so it has no `custom program error` line to match on. */
  function expectFailure(res: any) {
    expect(res instanceof FailedTransactionMetadata, "expected tx failure").to.eq(true);
    return res.meta().logs().join("\n");
  }

  /**
   * Write Treasury at its PDA. repr(C), 272 bytes after the 8-byte discriminator:
   *   u128 acc_reward_per_share @0
   *   5x Pubkey                 @16   authority, attestor, grx_mint, thbc_mint, settlement_recorder
   *   9x u64/i64                @176  attested_reserve, attestation_ts, attestation_ttl,
   *                                   thbc_supply, grx_per_thbc_rate, total_staked,
   *                                   reward_pool, created_at, total_settled_thbc
   *   u16 swap_fee_bps          @248
   *   8x u8                     @250  paused, bump, thbc_mint_bump, swap_vault_bump,
   *                                   stake_vault_bump, reward_vault_bump,
   *                                   rebate_vault_bump, thbc_inventory_bump
   *   [u8; 14] padding          @258
   */
  function installTreasury(opts: {
    attestedReserve: bigint;
    attestationTs: bigint;
    thbcSupply: bigint;
    paused?: boolean;
  }) {
    const data = Buffer.alloc(8 + 272);
    TREASURY_DISC.copy(data, 0);
    const b = 8; // payload base
    // acc_reward_per_share @0 stays 0
    authority.publicKey.toBuffer().copy(data, b + 16);
    attestor.publicKey.toBuffer().copy(data, b + 48);
    grxMint.toBuffer().copy(data, b + 80);
    thbcMintPda.toBuffer().copy(data, b + 112);
    PublicKey.default.toBuffer().copy(data, b + 144); // settlement_recorder
    data.writeBigUInt64LE(opts.attestedReserve, b + 176);
    data.writeBigInt64LE(opts.attestationTs, b + 184);
    data.writeBigInt64LE(BigInt(TTL), b + 192);
    data.writeBigUInt64LE(opts.thbcSupply, b + 200);
    data.writeBigUInt64LE(BigInt(RATE), b + 208);
    // total_staked, reward_pool, created_at, total_settled_thbc stay 0
    data.writeUInt16LE(FEE_BPS, b + 248);
    data.writeUInt8(opts.paused ? 1 : 0, b + 250);
    data.writeUInt8(treasuryBump, b + 251);
    data.writeUInt8(thbcMintBump, b + 252);
    data.writeUInt8(swapVaultBump, b + 253);
    // stake_vault_bump, reward_vault_bump, rebate_vault_bump unused here
    data.writeUInt8(inventoryBump, b + 257);

    svm.setAccount(treasuryPda, {
      lamports: Number(svm.minimumBalanceForRentExemption(BigInt(data.length))),
      data, owner: programId, executable: false, rentEpoch: 0,
    } as any);
  }

  /** 82-byte SPL mint owned by Token-2022, mint_authority = treasury PDA. */
  function installMint(key: PublicKey, decimals: number, supply: bigint) {
    const data = Buffer.alloc(82);
    data.writeUInt32LE(1, 0); // COption::Some(mint_authority)
    treasuryPda.toBuffer().copy(data, 4);
    data.writeBigUInt64LE(supply, 36);
    data.writeUInt8(decimals, 44);
    data.writeUInt8(1, 45); // is_initialized
    svm.setAccount(key, {
      lamports: Number(svm.minimumBalanceForRentExemption(82n)),
      data, owner: TOKEN_2022, executable: false, rentEpoch: 0,
    } as any);
  }

  /** 165-byte token account owned by Token-2022. */
  function installTokenAccount(key: PublicKey, mint: PublicKey, owner: PublicKey, amount: bigint) {
    const data = Buffer.alloc(165);
    mint.toBuffer().copy(data, 0);
    owner.toBuffer().copy(data, 32);
    data.writeBigUInt64LE(amount, 64);
    data.writeUInt8(1, 108); // state = Initialized
    svm.setAccount(key, {
      lamports: Number(svm.minimumBalanceForRentExemption(165n)),
      data, owner: TOKEN_2022, executable: false, rentEpoch: 0,
    } as any);
  }

  const balanceOf = (key: PublicKey) =>
    Buffer.from(svm.getAccount(key)!.data).readBigUInt64LE(64);
  const mintSupply = (key: PublicKey) =>
    Buffer.from(svm.getAccount(key)!.data).readBigUInt64LE(36);
  /** thbc_supply as the program tracks it, read straight out of the fabricated PDA. */
  const trackedSupply = () =>
    Buffer.from(svm.getAccount(treasuryPda)!.data).readBigUInt64LE(8 + 200);

  function setNow(ts: number) {
    const c = svm.getClock();
    svm.setClock(new Clock(c.slot, 0n, 0n, 0n, BigInt(ts)));
  }

  async function issueIx(amount: bigint, reference: string) {
    const hash = bankRefHash(reference);
    const [nullifier] = PublicKey.findProgramAddressSync(
      [Buffer.from("deposit"), hash], programId,
    );
    return treasury.methods
      .issueThbc(new BN(amount.toString()), Array.from(hash) as any)
      .accounts({
        treasury: treasuryPda,
        thbcMint: thbcMintPda,
        beneficiaryThbcAta: userThbcAta,
        depositNullifier: nullifier,
        issuer: authority.publicKey,
        tokenProgram: TOKEN_2022,
        systemProgram: SystemProgram.programId,
      } as any)
      .instruction();
  }

  async function exchangeIx(grxIn: bigint) {
    return treasury.methods
      .exchangeGrxForThbc(new BN(grxIn.toString()))
      .accounts({
        treasury: treasuryPda,
        grxMint,
        thbcMint: thbcMintPda,
        swapVault: swapVaultPda,
        inventoryVault: inventoryPda,
        userGrxAta,
        userThbcAta,
        user: user.publicKey,
        tokenProgram: TOKEN_2022,
      } as any)
      .instruction();
  }

  beforeEach(() => {
    svm = new LiteSVM().withDefaultPrograms();
    treasury = new Program(treasuryIdl, { connection: {}, publicKey: PublicKey.default } as any);
    programId = treasury.programId;
    svm.addProgramFromFile(programId, "target/deploy/treasury.so");
    svm.airdrop(authority.publicKey, BigInt(1_000_000_000_000));
    svm.airdrop(user.publicKey, BigInt(1_000_000_000_000));
    setNow(NOW);

    [treasuryPda, treasuryBump] = PublicKey.findProgramAddressSync([Buffer.from("treasury")], programId);
    [thbcMintPda, thbcMintBump] = PublicKey.findProgramAddressSync([Buffer.from("thbc_mint")], programId);
    [inventoryPda, inventoryBump] = PublicKey.findProgramAddressSync([Buffer.from("thbc_inventory")], programId);
    [swapVaultPda, swapVaultBump] = PublicKey.findProgramAddressSync([Buffer.from("swap_vault")], programId);

    installMint(thbcMintPda, 6, 0n);
    installMint(grxMint, 9, 0n);
    userThbcAta = Keypair.generate().publicKey;
    userGrxAta = Keypair.generate().publicKey;
    installTokenAccount(userThbcAta, thbcMintPda, user.publicKey, 0n);
    installTokenAccount(userGrxAta, grxMint, user.publicKey, 10_000_000_000n); // 10 GRX
    installTokenAccount(inventoryPda, thbcMintPda, treasuryPda, 0n);
    installTokenAccount(swapVaultPda, grxMint, treasuryPda, 0n);
  });

  // ---------------------------------------------------------------------------
  // F3 — deposit idempotency, enforced by the RUNTIME
  // ---------------------------------------------------------------------------

  it("F3: a replayed bank_ref is rejected, and does not issue twice", async () => {
    installTreasury({ attestedReserve: 10_000_000n, attestationTs: BigInt(NOW), thbcSupply: 0n });

    ok(send(await issueIx(1_000_000n, "SCB-20260729-0001"), [authority]));
    expect(balanceOf(userThbcAta)).to.eq(1_000_000n);
    expect(trackedSupply()).to.eq(1_000_000n);

    // The bank retries — at-least-once delivery is correct behaviour, not an attack.
    // Anchor `init` on the existing nullifier PDA makes the RUNTIME reject this.
    const logs = expectFailure(send(await issueIx(1_000_000n, "SCB-20260729-0001"), [authority]));
    expect(logs.toLowerCase()).to.match(/already in use|already initialized/);

    expect(balanceOf(userThbcAta), "a replay must not mint again").to.eq(1_000_000n);
    expect(trackedSupply(), "a replay must not move supply").to.eq(1_000_000n);
  });

  it("F3: normalisation — a casing/whitespace variant hits the same nullifier", async () => {
    // A bank that echoes " scb-...-0001 " on retry must not defeat F3. This pins the
    // off-chain BankRef normalisation (trim + upper-case) against the on-chain seed.
    installTreasury({ attestedReserve: 10_000_000n, attestationTs: BigInt(NOW), thbcSupply: 0n });

    ok(send(await issueIx(1_000_000n, "SCB-20260729-0001"), [authority]));
    expectFailure(send(await issueIx(1_000_000n, "  scb-20260729-0001  "), [authority]));
    expect(balanceOf(userThbcAta)).to.eq(1_000_000n);
  });

  it("F3: distinct bank_refs both issue", async () => {
    installTreasury({ attestedReserve: 10_000_000n, attestationTs: BigInt(NOW), thbcSupply: 0n });
    ok(send(await issueIx(1_000_000n, "SCB-1"), [authority]));
    ok(send(await issueIx(1_000_000n, "SCB-2"), [authority]));
    expect(balanceOf(userThbcAta)).to.eq(2_000_000n);
    expect(trackedSupply()).to.eq(2_000_000n);
  });

  it("F3: a REVERTED issuance leaves no nullifier behind, so the ref can be retried", async () => {
    // The instruction is atomic: if F1 or F5 rejects, the nullifier account is not
    // created either. Otherwise a deposit refused for a stale attestation could never
    // be retried after the refresh (spec §5.4) — the bank_ref would be burned.
    installTreasury({ attestedReserve: 100n, attestationTs: BigInt(NOW), thbcSupply: 0n });
    expectCustomError(send(await issueIx(1_000_000n, "SCB-1"), [authority]), PEG_BREACH);

    installTreasury({ attestedReserve: 10_000_000n, attestationTs: BigInt(NOW), thbcSupply: 0n });
    ok(send(await issueIx(1_000_000n, "SCB-1"), [authority]));
    expect(balanceOf(userThbcAta)).to.eq(1_000_000n);
  });

  // ---------------------------------------------------------------------------
  // F5 — attestation freshness
  // ---------------------------------------------------------------------------

  it("F5: issuance at exactly the TTL is still fresh", async () => {
    installTreasury({ attestedReserve: 10_000_000n, attestationTs: BigInt(NOW - TTL), thbcSupply: 0n });
    ok(send(await issueIx(1_000n, "SCB-1"), [authority]));
  });

  it("F5: one second past the TTL halts issuance, and a refresh resumes it", async () => {
    installTreasury({ attestedReserve: 10_000_000n, attestationTs: BigInt(NOW - TTL - 1), thbcSupply: 0n });
    expectCustomError(send(await issueIx(1_000n, "SCB-1"), [authority]), STALE_ATTESTATION);
    expect(trackedSupply()).to.eq(0n);

    // The attestor refreshes; the same bank_ref now succeeds — proving the halted
    // attempt did not consume the reference.
    installTreasury({ attestedReserve: 10_000_000n, attestationTs: BigInt(NOW), thbcSupply: 0n });
    ok(send(await issueIx(1_000n, "SCB-1"), [authority]));
    expect(trackedSupply()).to.eq(1_000n);
  });

  it("F5: a future-dated attestation is rejected, not treated as maximally fresh", async () => {
    // Otherwise a clock-skewed or malicious attestor buys unlimited freshness by
    // stamping ahead.
    installTreasury({ attestedReserve: 10_000_000n, attestationTs: BigInt(NOW + 5_000), thbcSupply: 0n });
    expectCustomError(send(await issueIx(1_000n, "SCB-1"), [authority]), STALE_ATTESTATION);
  });

  it("F5 is checked BEFORE F1: both violated reports staleness", async () => {
    // A PegBreach computed from a reserve nobody currently vouches for is not
    // actionable; "refresh the attestation" is.
    installTreasury({ attestedReserve: 0n, attestationTs: BigInt(NOW - TTL - 1), thbcSupply: 0n });
    expectCustomError(send(await issueIx(1_000_000n, "SCB-1"), [authority]), STALE_ATTESTATION);
  });

  // ---------------------------------------------------------------------------
  // F1 — reserve ceiling
  // ---------------------------------------------------------------------------

  it("F1: issuing exactly to the ceiling is allowed", async () => {
    installTreasury({ attestedReserve: 1_000_000n, attestationTs: BigInt(NOW), thbcSupply: 400_000n });
    ok(send(await issueIx(600_000n, "SCB-1"), [authority]));
    expect(trackedSupply()).to.eq(1_000_000n);
  });

  it("F1: one minor unit over the ceiling breaches the peg", async () => {
    installTreasury({ attestedReserve: 1_000_000n, attestationTs: BigInt(NOW), thbcSupply: 400_000n });
    expectCustomError(send(await issueIx(600_001n, "SCB-1"), [authority]), PEG_BREACH);
    expect(trackedSupply(), "a refused issuance must not move supply").to.eq(400_000n);
    expect(balanceOf(userThbcAta)).to.eq(0n);
  });

  // ---------------------------------------------------------------------------
  // F6 — the exchange path never changes supply
  // ---------------------------------------------------------------------------

  it("F6: exchange pays from inventory and leaves thbc_supply untouched", async () => {
    // Inventory holds THBC that already exists — funded here by a plain transfer, as
    // it would be in production. Nothing in the program mints into it.
    installTreasury({ attestedReserve: 10_000_000n, attestationTs: BigInt(NOW), thbcSupply: 12_000_000n });
    installTokenAccount(inventoryPda, thbcMintPda, treasuryPda, 12_000_000n);
    installMint(thbcMintPda, 6, 12_000_000n);

    const supplyBefore = trackedSupply();
    const mintSupplyBefore = mintSupply(thbcMintPda);

    // 3 GRX at rate 4_000_000, 25 bps → 11_970_000 THBC out.
    ok(send(await exchangeIx(3_000_000_000n), [user]));

    expect(balanceOf(userThbcAta)).to.eq(11_970_000n);
    expect(balanceOf(inventoryPda), "paid out of inventory").to.eq(12_000_000n - 11_970_000n);
    expect(balanceOf(swapVaultPda), "GRX collected").to.eq(3_000_000_000n);

    expect(trackedSupply(), "F6: thbc_supply must be untouched").to.eq(supplyBefore);
    expect(mintSupply(thbcMintPda), "F6: the SPL mint supply must be untouched").to.eq(mintSupplyBefore);
  });

  it("F6: an inventory shortfall is REFUSED, never covered by a mint", async () => {
    installTreasury({ attestedReserve: 100_000_000n, attestationTs: BigInt(NOW), thbcSupply: 0n });
    installTokenAccount(inventoryPda, thbcMintPda, treasuryPda, 1_000n); // far too little

    const before = mintSupply(thbcMintPda);
    expectCustomError(send(await exchangeIx(3_000_000_000n), [user]), INSUFFICIENT_INVENTORY);

    expect(balanceOf(userThbcAta), "no THBC delivered").to.eq(0n);
    expect(mintSupply(thbcMintPda), "and none minted to cover the gap").to.eq(before);
  });

  it("F6: ample reserve headroom does not let the exchange exceed inventory", async () => {
    // Under the old minting swap, headroom was exactly what bounded the payout. Now it
    // is irrelevant: a huge attested_reserve buys nothing when inventory is empty.
    installTreasury({ attestedReserve: 1_000_000_000_000n, attestationTs: BigInt(NOW), thbcSupply: 0n });
    installTokenAccount(inventoryPda, thbcMintPda, treasuryPda, 0n);
    expectCustomError(send(await exchangeIx(3_000_000_000n), [user]), INSUFFICIENT_INVENTORY);
    expect(balanceOf(userThbcAta)).to.eq(0n);
  });

  it("F6: a stale attestation does NOT block the exchange path", async () => {
    // Deliberate asymmetry with issuance: F5 guards issuance, and exchange issues
    // nothing, so blocking it on a stale reserve would cost liveness for no safety.
    installTreasury({
      attestedReserve: 10_000_000n,
      attestationTs: BigInt(NOW - TTL - 10_000), // long stale
      thbcSupply: 12_000_000n,
    });
    installTokenAccount(inventoryPda, thbcMintPda, treasuryPda, 12_000_000n);
    ok(send(await exchangeIx(3_000_000_000n), [user]));
    expect(balanceOf(userThbcAta)).to.eq(11_970_000n);
  });
});
