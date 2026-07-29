// Compute-unit measurement for the treasury THBC instructions (litesvm, no validator).
//
// BENCHMARKS.md carried figures for `swap_grx_for_thbc` (21 509) and
// `redeem_thbc_for_grx` (21 328), both of which the F6 fix deleted. Their
// replacements — and `issue_thbc` and the three F7 instructions — were unmeasured,
// and the footnote there says so. This produces the real numbers.
//
// Reuses the fixture approach from tests/treasury_thbc_litesvm.ts: Treasury is
// fabricated at its PDA byte-for-byte so no `initialize` run is needed.
//
// Run:  npx tsx scripts/measure-treasury-cu.ts
//
// Numbers are the SBF program's own consumption as litesvm reports it
// (`meta().computeUnitsConsumed()`), which includes the CPI into the token program
// but not the ComputeBudget instruction itself. Compare against the 200k default
// per-instruction budget and the 1.4M per-transaction max.

import { LiteSVM, Clock, FailedTransactionMetadata } from "litesvm";
import { Program } from "@anchor-lang/core";
import type { Treasury } from "../target/types/treasury";
import {
  PublicKey, Keypair, Transaction, TransactionInstruction, SystemProgram,
} from "@solana/web3.js";
import BN from "bn.js";
import { createRequire } from "module";
import { createHash } from "crypto";

const require = createRequire(import.meta.url);
const treasuryIdl = require("../target/idl/treasury.json");

const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const TREASURY_DISC = Buffer.from([238, 239, 123, 238, 89, 1, 168, 253]);
const NOW = 1_800_000_000;
const TTL = 3_600;
const RATE = 4_000_000;
const FEE_BPS = 25;
const DELTA = 86_400;

const authority = Keypair.generate();
const user = Keypair.generate();
const grxMint = Keypair.generate().publicKey;

const treasury = new Program(treasuryIdl, { connection: {}, publicKey: PublicKey.default } as any) as Program<Treasury>;
const programId = treasury.programId;

const [treasuryPda, treasuryBump] = PublicKey.findProgramAddressSync([Buffer.from("treasury")], programId);
const [thbcMintPda, thbcMintBump] = PublicKey.findProgramAddressSync([Buffer.from("thbc_mint")], programId);
const [inventoryPda, inventoryBump] = PublicKey.findProgramAddressSync([Buffer.from("thbc_inventory")], programId);
const [swapVaultPda, swapVaultBump] = PublicKey.findProgramAddressSync([Buffer.from("swap_vault")], programId);
const [escrowPda, escrowBump] = PublicKey.findProgramAddressSync([Buffer.from("redeem_escrow")], programId);

let svm: LiteSVM;
let userThbcAta: PublicKey;
let userGrxAta: PublicKey;

function installTreasury(o: { attestedReserve: bigint; thbcSupply: bigint }) {
  const data = Buffer.alloc(8 + 272);
  TREASURY_DISC.copy(data, 0);
  const b = 8;
  authority.publicKey.toBuffer().copy(data, b + 16);
  authority.publicKey.toBuffer().copy(data, b + 48);
  grxMint.toBuffer().copy(data, b + 80);
  thbcMintPda.toBuffer().copy(data, b + 112);
  PublicKey.default.toBuffer().copy(data, b + 144);
  data.writeBigUInt64LE(o.attestedReserve, b + 176);
  data.writeBigInt64LE(BigInt(NOW), b + 184);
  data.writeBigInt64LE(BigInt(TTL), b + 192);
  data.writeBigUInt64LE(o.thbcSupply, b + 200);
  data.writeBigUInt64LE(BigInt(RATE), b + 208);
  data.writeUInt16LE(FEE_BPS, b + 248);
  data.writeUInt8(treasuryBump, b + 251);
  data.writeUInt8(thbcMintBump, b + 252);
  data.writeUInt8(swapVaultBump, b + 253);
  data.writeUInt8(inventoryBump, b + 257);
  data.writeUInt8(escrowBump, b + 258);
  svm.setAccount(treasuryPda, {
    lamports: Number(svm.minimumBalanceForRentExemption(BigInt(data.length))),
    data, owner: programId, executable: false, rentEpoch: 0,
  } as any);
}

function installMint(key: PublicKey, decimals: number, supply: bigint) {
  const data = Buffer.alloc(82);
  data.writeUInt32LE(1, 0);
  treasuryPda.toBuffer().copy(data, 4);
  data.writeBigUInt64LE(supply, 36);
  data.writeUInt8(decimals, 44);
  data.writeUInt8(1, 45);
  svm.setAccount(key, {
    lamports: Number(svm.minimumBalanceForRentExemption(82n)),
    data, owner: TOKEN_2022, executable: false, rentEpoch: 0,
  } as any);
}

function installTokenAccount(key: PublicKey, mint: PublicKey, owner: PublicKey, amount: bigint) {
  const data = Buffer.alloc(165);
  mint.toBuffer().copy(data, 0);
  owner.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  data.writeUInt8(1, 108);
  svm.setAccount(key, {
    lamports: Number(svm.minimumBalanceForRentExemption(165n)),
    data, owner: TOKEN_2022, executable: false, rentEpoch: 0,
  } as any);
}

function reset(opts: { supply?: bigint; inventory?: bigint; escrow?: bigint; userThbc?: bigint } = {}) {
  svm = new LiteSVM().withDefaultPrograms();
  svm.addProgramFromFile(programId, "target/deploy/treasury.so");
  svm.airdrop(authority.publicKey, BigInt(1_000_000_000_000));
  svm.airdrop(user.publicKey, BigInt(1_000_000_000_000));
  const c = svm.getClock();
  svm.setClock(new Clock(c.slot, 0n, 0n, 0n, BigInt(NOW)));

  installTreasury({ attestedReserve: 1_000_000_000n, thbcSupply: opts.supply ?? 0n });
  installMint(thbcMintPda, 6, opts.supply ?? 0n);
  installMint(grxMint, 9, 0n);
  userThbcAta = Keypair.generate().publicKey;
  userGrxAta = Keypair.generate().publicKey;
  installTokenAccount(userThbcAta, thbcMintPda, user.publicKey, opts.userThbc ?? 0n);
  installTokenAccount(userGrxAta, grxMint, user.publicKey, 10_000_000_000n);
  installTokenAccount(inventoryPda, thbcMintPda, treasuryPda, opts.inventory ?? 0n);
  installTokenAccount(swapVaultPda, grxMint, treasuryPda, 0n);
  installTokenAccount(escrowPda, thbcMintPda, treasuryPda, opts.escrow ?? 0n);
}

function run(label: string, ix: TransactionInstruction, signers: Keypair[]): number | null {
  const tx = new Transaction();
  tx.recentBlockhash = svm.latestBlockhash();
  tx.feePayer = signers[0].publicKey;
  tx.add(ix);
  tx.sign(...signers);
  const res = svm.sendTransaction(tx);
  svm.expireBlockhash();
  if (res instanceof FailedTransactionMetadata) {
    console.error(`  ${label}: FAILED\n${res.meta().logs().join("\n")}`);
    return null;
  }
  return Number(res.computeUnitsConsumed());
}

const seqLe = (n: number) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const recordPda = (o: PublicKey, s: number) =>
  PublicKey.findProgramAddressSync([Buffer.from("redeem"), o.toBuffer(), seqLe(s)], programId)[0];

const results: Array<[string, number | null]> = [];

// --- issue_thbc: mint + `init` of the nullifier ---
{
  reset();
  const hash = createHash("sha256").update("CU-BENCH-1").digest();
  const [nullifier] = PublicKey.findProgramAddressSync([Buffer.from("deposit"), hash], programId);
  const ix = await treasury.methods.issueThbc(new BN(1_000_000), Array.from(hash) as any)
    .accounts({
      treasury: treasuryPda, thbcMint: thbcMintPda, beneficiaryThbcAta: userThbcAta,
      depositNullifier: nullifier, issuer: authority.publicKey,
      tokenProgram: TOKEN_2022, systemProgram: SystemProgram.programId,
    } as any).instruction();
  results.push(["issue_thbc", run("issue_thbc", ix, [authority])]);
}

// --- exchange_grx_for_thbc: two transfer_checked, no mint ---
{
  reset({ supply: 12_000_000n, inventory: 12_000_000n });
  const ix = await treasury.methods.exchangeGrxForThbc(new BN(3_000_000_000))
    .accounts({
      treasury: treasuryPda, grxMint, thbcMint: thbcMintPda, swapVault: swapVaultPda,
      inventoryVault: inventoryPda, userGrxAta, userThbcAta, user: user.publicKey,
      tokenProgram: TOKEN_2022,
    } as any).instruction();
  results.push(["exchange_grx_for_thbc", run("exchange_grx_for_thbc", ix, [user])]);
}

// --- exchange_thbc_for_grx ---
{
  reset({ supply: 12_000_000n, userThbc: 12_000_000n });
  installTokenAccount(swapVaultPda, grxMint, treasuryPda, 10_000_000_000n);
  const ix = await treasury.methods.exchangeThbcForGrx(new BN(12_000_000))
    .accounts({
      treasury: treasuryPda, grxMint, thbcMint: thbcMintPda, swapVault: swapVaultPda,
      inventoryVault: inventoryPda, userGrxAta, userThbcAta, user: user.publicKey,
      tokenProgram: TOKEN_2022,
    } as any).instruction();
  results.push(["exchange_thbc_for_grx", run("exchange_thbc_for_grx", ix, [user])]);
}

// --- redeem_thbc_for_fiat: transfer + `init` of the record ---
{
  reset({ supply: 1_000_000n, userThbc: 1_000_000n });
  const ix = await treasury.methods.redeemThbcForFiat(new BN(400_000), new BN(1))
    .accounts({
      treasury: treasuryPda, thbcMint: thbcMintPda, redeemEscrow: escrowPda,
      userThbcAta, redemption: recordPda(user.publicKey, 1), user: user.publicKey,
      tokenProgram: TOKEN_2022, systemProgram: SystemProgram.programId,
    } as any).instruction();
  results.push(["redeem_thbc_for_fiat", run("redeem_thbc_for_fiat", ix, [user])]);
}

// --- confirm_redemption / reclaim_redemption: need a live escrow record first ---
for (const which of ["confirm_redemption", "reclaim_redemption"] as const) {
  reset({ supply: 1_000_000n, userThbc: 1_000_000n });
  const setup = await treasury.methods.redeemThbcForFiat(new BN(400_000), new BN(1))
    .accounts({
      treasury: treasuryPda, thbcMint: thbcMintPda, redeemEscrow: escrowPda,
      userThbcAta, redemption: recordPda(user.publicKey, 1), user: user.publicKey,
      tokenProgram: TOKEN_2022, systemProgram: SystemProgram.programId,
    } as any).instruction();
  if (run("setup", setup, [user]) === null) { results.push([which, null]); continue; }

  if (which === "confirm_redemption") {
    const ix = await treasury.methods.confirmRedemption()
      .accounts({
        treasury: treasuryPda, thbcMint: thbcMintPda, redeemEscrow: escrowPda,
        redemption: recordPda(user.publicKey, 1), user: user.publicKey,
        issuer: authority.publicKey, tokenProgram: TOKEN_2022,
      } as any).instruction();
    results.push([which, run(which, ix, [authority])]);
  } else {
    const c = svm.getClock();
    svm.setClock(new Clock(c.slot, 0n, 0n, 0n, BigInt(NOW + DELTA)));
    const ix = await treasury.methods.reclaimRedemption()
      .accounts({
        treasury: treasuryPda, thbcMint: thbcMintPda, redeemEscrow: escrowPda,
        userThbcAta, redemption: recordPda(user.publicKey, 1), user: user.publicKey,
        tokenProgram: TOKEN_2022,
      } as any).instruction();
    results.push([which, run(which, ix, [user])]);
  }
}

console.log("\n| Instruction | CU |");
console.log("| :--- | ---: |");
for (const [name, cu] of results) {
  console.log(`| \`treasury.${name}\` | ${cu === null ? "measurement failed" : cu.toLocaleString("en-US").replace(/,/g, " ")} |`);
}
console.log("\n(litesvm, target/deploy/treasury.so, program consumption incl. token-program CPI)");
