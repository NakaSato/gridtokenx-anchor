// In-process compute-unit profile for the registry user/meter lifecycle — the telemetry
// hot path (register_user → register_meter → update_meter_reading) plus the admin/shard
// setup instructions. Same method as §4/§5 (litesvm `computeUnitsConsumed()`, default-feature
// .so, no localnet). No validator, no token CPI on this path.
//
// Account wiring mirrors tests/registry_meter_reading_guards_litesvm.ts. The token-bearing
// registry instructions (stake_grx validator bond, settle_and_mint_tokens, claim_airdrop)
// need energy-mint vault wiring and are out of scope here — the bond plumbing mirrors the
// §5 treasury stake (~22k CU).

import { LiteSVM, FailedTransactionMetadata, TransactionMetadata } from "litesvm";
import { Program } from "@anchor-lang/core";
import { Registry } from "../target/types/registry";
import { expect } from "chai";
import { PublicKey, Keypair, Transaction, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const idl = require("../target/idl/registry.json");

const METER_ID = "METER001";
const BUDGET = 200_000;

describe("registry CU profile (litesvm)", () => {
  let svm: LiteSVM;
  let program: Program<Registry>;
  let programId: PublicKey;

  const payer = Keypair.generate();
  const user = Keypair.generate();
  const oracle = Keypair.generate();

  let registryPda: PublicKey, userPda: PublicKey, shardPda: PublicKey, meterPda: PublicKey;
  let shardId: number;

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
  // Measure CU of a single-instruction tx.
  function cu(label: string, ix: TransactionInstruction, signers: Keypair[] = []): number {
    const r = sendRaw([ix], signers);
    if (r instanceof FailedTransactionMetadata) throw new Error(label + " failed: " + r.err().toString() + "\n" + r.meta().logs().join("\n"));
    const c = Number((r as TransactionMetadata).computeUnitsConsumed());
    profile.push({ ix: label, cu: c });
    return c;
  }

  before(async () => {
    svm = new LiteSVM().withDefaultPrograms();
    program = new Program(idl, { connection: {}, publicKey: PublicKey.default } as any);
    programId = program.programId;
    svm.addProgramFromFile(programId, "target/deploy/registry.so");
    svm.airdrop(payer.publicKey, BigInt(1_000_000_000_000));

    [registryPda] = PublicKey.findProgramAddressSync([Buffer.from("registry")], programId);
    [userPda] = PublicKey.findProgramAddressSync([Buffer.from("user"), user.publicKey.toBuffer()], programId);
    shardId = user.publicKey.toBytes()[0] % 16;
    [shardPda] = PublicKey.findProgramAddressSync([Buffer.from("registry_shard"), Buffer.from([shardId])], programId);
    [meterPda] = PublicKey.findProgramAddressSync([Buffer.from("meter"), user.publicKey.toBuffer(), Buffer.from(METER_ID)], programId);
  });

  after(() => {
    const w = Math.max(...profile.map((p) => p.ix.length));
    console.log("\n  CU profile (default features, no localnet):");
    for (const p of profile) console.log(`    ${p.ix.padEnd(w)}  ${p.cu.toString().padStart(7)} CU`);
  });

  it("registry.initialize", async () => {
    const ix = await program.methods.initialize().accounts({ registry: registryPda, authority: payer.publicKey, systemProgram: SystemProgram.programId }).instruction();
    expect(cu("registry.initialize", ix)).to.be.below(BUDGET);
  });

  it("registry.initialize_shard", async () => {
    const ix = await program.methods.initializeShard(shardId).accounts({ shard: shardPda, authority: payer.publicKey, systemProgram: SystemProgram.programId }).instruction();
    expect(cu("registry.initialize_shard", ix)).to.be.below(BUDGET);
  });

  it("registry.register_user", async () => {
    const ix = await program.methods.registerUser({ prosumer: {} }, 0, 0, new BN(0), shardId).accounts({
      userAccount: userPda, registryShard: shardPda, registry: registryPda, authority: user.publicKey, payer: payer.publicKey, systemProgram: SystemProgram.programId,
    }).instruction();
    expect(cu("registry.register_user", ix, [user])).to.be.below(BUDGET);
  });

  it("registry.register_meter", async () => {
    const ix = await program.methods.registerMeter(METER_ID, { solar: {} }, shardId).accounts({
      meterAccount: meterPda, userAccount: userPda, registryShard: shardPda, registry: registryPda, owner: user.publicKey, payer: payer.publicKey, systemProgram: SystemProgram.programId,
    }).instruction();
    expect(cu("registry.register_meter", ix, [user])).to.be.below(BUDGET);
  });

  it("registry.set_oracle_authority", async () => {
    const ix = await program.methods.setOracleAuthority(oracle.publicKey).accounts({ registry: registryPda, authority: payer.publicKey }).instruction();
    expect(cu("registry.set_oracle_authority", ix)).to.be.below(BUDGET);
  });

  it("registry.update_meter_reading", async () => {
    const ix = await program.methods.updateMeterReading(new BN(100), new BN(50), new BN(1000))
      .accounts({ registry: registryPda, meterAccount: meterPda, oracleAuthority: oracle.publicKey }).instruction();
    expect(cu("registry.update_meter_reading", ix, [oracle])).to.be.below(BUDGET);
  });

  it("registry.deactivate_meter", async () => {
    const ix = await program.methods.deactivateMeter().accounts({
      meterAccount: meterPda, userAccount: userPda, registry: registryPda, registryShard: shardPda, owner: user.publicKey,
    }).instruction();
    expect(cu("registry.deactivate_meter", ix, [user])).to.be.below(BUDGET);
  });
});
