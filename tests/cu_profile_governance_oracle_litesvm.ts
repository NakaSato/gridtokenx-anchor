// In-process compute-unit profile for the governance + oracle happy-path instructions.
// Runs against the deployed .so under target/deploy (built with default features — no
// `localnet`, so compute_fn! is a no-op and these numbers are production-representative).
//
// Not a guard test: every instruction here is expected to SUCCEED; the assertions only
// pin each one well under the 200k default per-instruction budget so a future regression
// (e.g. an accidental extra syscall or a serialized hot-path account) trips CI. The
// per-instruction CU is printed as a table for BENCHMARKS.md upkeep.

import { LiteSVM, Clock, FailedTransactionMetadata, TransactionMetadata } from "litesvm";
import { Program } from "@anchor-lang/core";
import { Oracle } from "../target/types/oracle";
import { Governance } from "../target/types/governance";
import {
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";
import { createRequire } from "module";
import { assertBaseline, fixedKeypair } from "./cu-baseline";

const require = createRequire(import.meta.url);
const oracleIdl = require("../target/idl/oracle.json");
const governanceIdl = require("../target/idl/governance.json");

const NOW = 1_800_000;
const BUDGET = 200_000; // default per-instruction CU budget

describe("governance + oracle CU profile (litesvm)", () => {
  let svm: LiteSVM;
  let oracle: Program<Oracle>;
  let governance: Program<Governance>;
  let oracleId: PublicKey;
  let governanceId: PublicKey;

  const payer = fixedKeypair(1);
  const chainBridge = fixedKeypair(2);
  const proposed = fixedKeypair(3);

  let oracleData: PublicKey;
  let governanceConfig: PublicKey;

  const profile: Array<{ ix: string; cu: number }> = [];

  // Send a single-instruction tx and return CU consumed (throws on failure).
  async function sendCU(label: string, ix: Promise<TransactionInstruction> | TransactionInstruction, signers: Keypair[]): Promise<number> {
    const resolved = await ix;
    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = payer.publicKey;
    tx.add(resolved);
    tx.sign(...signers);
    const res = svm.sendTransaction(tx);
    svm.expireBlockhash();
    if (res instanceof FailedTransactionMetadata) {
      throw new Error(label + " failed: " + res.err().toString() + "\n" + res.meta().logs().join("\n"));
    }
    const cu = Number((res as TransactionMetadata).computeUnitsConsumed());
    profile.push({ ix: label, cu });
    return cu;
  }

  const meterPda = (id: string) =>
    PublicKey.findProgramAddressSync([Buffer.from("meter"), Buffer.from(id)], oracleId)[0];

  before(async () => {
    svm = new LiteSVM().withDefaultPrograms();
    oracle = new Program(oracleIdl, { connection: {}, publicKey: PublicKey.default } as any);
    governance = new Program(governanceIdl, { connection: {}, publicKey: PublicKey.default } as any);
    oracleId = oracle.programId;
    governanceId = governance.programId;
    svm.addProgramFromFile(oracleId, "target/deploy/oracle.so");
    svm.addProgramFromFile(governanceId, "target/deploy/governance.so");
    for (const kp of [payer, chainBridge, proposed]) svm.airdrop(kp.publicKey, BigInt(1_000_000_000_000));
    oracleData = PublicKey.findProgramAddressSync([Buffer.from("oracle_data")], oracleId)[0];
    governanceConfig = PublicKey.findProgramAddressSync([Buffer.from("poa_config")], governanceId)[0];
    svm.setClock(new Clock(svm.getClock().slot, 0n, 0n, 0n, BigInt(NOW)));
  });

  after(() => {
    const w = Math.max(...profile.map((p) => p.ix.length));
    console.log("\n  CU profile (default features, no localnet):");
    for (const p of profile) console.log(`    ${p.ix.padEnd(w)}  ${p.cu.toString().padStart(7)} CU`);
    assertBaseline(profile);
  });

  it("governance: initialize_governance", async () => {
    const cu = await sendCU("governance.initialize_governance", governance.methods.initializeGovernance()
      .accounts({ governanceConfig, authority: payer.publicKey, systemProgram: SystemProgram.programId } as any).instruction(), [payer]);
    expect(cu).to.be.below(BUDGET);
  });

  it("oracle: initialize", async () => {
    const cu = await sendCU("oracle.initialize", oracle.methods.initialize(chainBridge.publicKey)
      .accounts({ oracleData, authority: payer.publicKey, systemProgram: SystemProgram.programId } as any).instruction(), [payer]);
    expect(cu).to.be.below(BUDGET);
  });

  it("oracle: submit_meter_reading (first — inits meter PDA)", async () => {
    const cu = await sendCU("oracle.submit_meter_reading[first]", oracle.methods
      .submitMeterReading("m-cu", new BN(500), new BN(500), new BN(NOW - 200), 1)
      .accounts({ oracleData, meterState: meterPda("m-cu"), authority: chainBridge.publicKey, systemProgram: SystemProgram.programId } as any).instruction(),
      [payer, chainBridge]);
    expect(cu).to.be.below(BUDGET);
  });

  it("oracle: submit_meter_reading (subsequent)", async () => {
    const cu = await sendCU("oracle.submit_meter_reading[next]", oracle.methods
      .submitMeterReading("m-cu", new BN(600), new BN(600), new BN(NOW - 100), 1)
      .accounts({ oracleData, meterState: meterPda("m-cu"), authority: chainBridge.publicKey, systemProgram: SystemProgram.programId } as any).instruction(),
      [payer, chainBridge]);
    expect(cu).to.be.below(BUDGET);
  });

  it("oracle: trigger_market_clearing", async () => {
    const cu = await sendCU("oracle.trigger_market_clearing", oracle.methods.triggerMarketClearing(new BN(NOW - 900))
      .accounts({ oracleData, authority: chainBridge.publicKey, aggregatorEntry: null } as any).instruction(),
      [payer, chainBridge]);
    expect(cu).to.be.below(BUDGET);
  });

  it("oracle: aggregate_readings", async () => {
    const cu = await sendCU("oracle.aggregate_readings", oracle.methods
      .aggregateReadings(new BN(1000), new BN(900), new BN(10), new BN(1))
      .accounts({ oracleData, authority: chainBridge.publicKey, aggregatorEntry: null } as any).instruction(),
      [payer, chainBridge]);
    expect(cu).to.be.below(BUDGET);
  });

  it("oracle: update_validation_config", async () => {
    const cu = await sendCU("oracle.update_validation_config", oracle.methods
      .updateValidationConfig(new BN(0), new BN(1_000_000), true)
      .accounts({ oracleData, authority: payer.publicKey } as any).instruction(), [payer]);
    expect(cu).to.be.below(BUDGET);
  });

  it("governance: propose_authority_change", async () => {
    const cu = await sendCU("governance.propose_authority_change", governance.methods.proposeAuthorityChange(proposed.publicKey)
      .accounts({ governanceConfig, authority: payer.publicKey } as any).instruction(), [payer]);
    expect(cu).to.be.below(BUDGET);
  });

  it("governance: approve_authority_change", async () => {
    const cu = await sendCU("governance.approve_authority_change", governance.methods.approveAuthorityChange()
      .accounts({ governanceConfig, newAuthority: proposed.publicKey } as any).instruction(), [payer, proposed]);
    expect(cu).to.be.below(BUDGET);
  });

  it("governance: set_oracle_authority", async () => {
    // authority is now `proposed` after the transfer above.
    const cu = await sendCU("governance.set_oracle_authority", governance.methods.setOracleAuthority(PublicKey.default, 80, false)
      .accounts({ governanceConfig, authority: proposed.publicKey } as any).instruction(), [payer, proposed]);
    expect(cu).to.be.below(BUDGET);
  });

  it("governance: update_erc_limits", async () => {
    const cu = await sendCU("governance.update_erc_limits", governance.methods.updateErcLimits(new BN(50), new BN(2_000_000), new BN(31_536_000))
      .accounts({ governanceConfig, authority: proposed.publicKey } as any).instruction(), [payer, proposed]);
    expect(cu).to.be.below(BUDGET);
  });
});
