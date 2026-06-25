// Litesvm coverage for the oracle program's validation, gateway-auth, epoch, and
// aggregator-admission guards — previously only exercised by the validator-backed
// tests/oracle.ts / oracle_integration.ts. Runs fully in-process.
//
// Headline cases:
//   - submit_meter_reading guards: MeterIdTooLong, OracleInactive, UnauthorizedGateway
//     (authority must equal oracle_data.chain_bridge), FutureReading, EnergyValueOutOfRange,
//     AnomalousReading (produced*100 > ratio*consumed), OutdatedReading, RateLimitExceeded
//     (lib.rs:75-175).
//   - trigger_market_clearing epoch guards: must be > last_cleared, <= now, and land on a
//     900s boundary (InvalidEpoch, lib.rs:196-209).
//   - aggregator allow-list (cross-program with governance): an aggregator admitted via
//     governance::admit_aggregator can drive node-facing oracle instructions by passing its
//     AggregatorEntry PDA; once revoked it is rejected (AggregatorNotAdmitted, lib.rs:398).
//   - admin guards: UnauthorizedAuthority + InvalidConfiguration (lib.rs:225-335).
//
// Sources: programs/oracle/src/lib.rs + error.rs.

import { LiteSVM, Clock, FailedTransactionMetadata } from "litesvm";
import { Program } from "@anchor-lang/core";
import { Oracle } from "../target/types/oracle";
import { Governance } from "../target/types/governance";
import { expect } from "chai";
import {
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const oracleIdl = require("../target/idl/oracle.json");
const governanceIdl = require("../target/idl/governance.json");

const NOW = 1_800_000; // 900 * 2000 — lands on a 15-min epoch boundary
const EPOCH = 900;

describe("oracle validation/gateway/epoch/aggregator guards (litesvm)", () => {
  let svm: LiteSVM;
  let oracle: Program<Oracle>;
  let governance: Program<Governance>;
  let oracleId: PublicKey;
  let governanceId: PublicKey;

  const payer = Keypair.generate(); // oracle admin authority + fee payer + governance authority
  const chainBridge = Keypair.generate(); // the configured gateway (oracle_data.chain_bridge)
  const aggregator = Keypair.generate(); // PoA-admitted aggregator
  const outsider = Keypair.generate(); // neither bridge nor admitted aggregator

  let oracleData: PublicKey;
  let governanceConfig: PublicKey;

  type IxLike = TransactionInstruction | Promise<TransactionInstruction>;
  async function trySend(
    ixs: IxLike[],
    signers: Keypair[] = [payer],
    feePayer = payer,
  ): Promise<FailedTransactionMetadata | null> {
    const resolved = await Promise.all(ixs);
    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = feePayer.publicKey;
    resolved.forEach((ix) => tx.add(ix));
    tx.sign(...signers);
    const res = svm.sendTransaction(tx);
    svm.expireBlockhash();
    return res instanceof FailedTransactionMetadata ? res : null;
  }
  async function send(ixs: IxLike[], signers: Keypair[] = [payer], feePayer = payer) {
    const f = await trySend(ixs, signers, feePayer);
    if (f) throw new Error("tx failed: " + f.err().toString() + "\n" + f.meta().logs().join("\n"));
  }
  async function sendExpectFail(ixs: IxLike[], signers: Keypair[] = [payer], feePayer = payer): Promise<string> {
    const f = await trySend(ixs, signers, feePayer);
    if (!f) throw new Error("expected tx to fail but it succeeded");
    return f.err().toString() + "\n" + f.meta().logs().join("\n");
  }

  const meterPda = (id: string) =>
    PublicKey.findProgramAddressSync([Buffer.from("meter"), Buffer.from(id)], oracleId)[0];
  const aggEntryPda = (agg: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("aggregator"), agg.toBuffer()], governanceId)[0];

  // submit signed by `auth` (must equal chain_bridge to pass the gateway guard).
  const submitIx = (
    auth: PublicKey,
    meterId: string,
    produced: number,
    consumed: number,
    ts: number,
    zone = 1,
  ) =>
    oracle.methods.submitMeterReading(meterId, new BN(produced), new BN(consumed), new BN(ts), zone)
      .accounts({
        oracleData,
        meterState: meterPda(meterId),
        authority: auth,
        systemProgram: SystemProgram.programId,
      } as any).instruction();

  const triggerIx = (auth: PublicKey, epoch: number, aggEntry: PublicKey | null) =>
    oracle.methods.triggerMarketClearing(new BN(epoch))
      .accounts({ oracleData, authority: auth, aggregatorEntry: aggEntry } as any).instruction();

  const statusIx = (active: boolean, auth: PublicKey) =>
    oracle.methods.updateOracleStatus(active)
      .accounts({ oracleData, authority: auth } as any).instruction();

  before(async () => {
    svm = new LiteSVM().withDefaultPrograms();
    oracle = new Program(oracleIdl, { connection: {}, publicKey: PublicKey.default } as any);
    governance = new Program(governanceIdl, { connection: {}, publicKey: PublicKey.default } as any);
    oracleId = oracle.programId;
    governanceId = governance.programId;
    svm.addProgramFromFile(oracleId, "target/deploy/oracle.so");
    svm.addProgramFromFile(governanceId, "target/deploy/governance.so");

    for (const kp of [payer, chainBridge, aggregator, outsider]) {
      svm.airdrop(kp.publicKey, BigInt(1_000_000_000_000));
    }

    oracleData = PublicKey.findProgramAddressSync([Buffer.from("oracle_data")], oracleId)[0];
    governanceConfig = PublicKey.findProgramAddressSync([Buffer.from("poa_config")], governanceId)[0];

    svm.setClock(new Clock(svm.getClock().slot, 0n, 0n, 0n, BigInt(NOW)));

    // oracle: authority = payer, chain_bridge = chainBridge.
    await send([await oracle.methods.initialize(chainBridge.publicKey)
      .accounts({ oracleData, authority: payer.publicKey, systemProgram: SystemProgram.programId } as any)
      .instruction()]);

    // governance: PoA authority = payer (for the aggregator allow-list).
    await send([await governance.methods.initializeGovernance()
      .accounts({ governanceConfig, authority: payer.publicKey, systemProgram: SystemProgram.programId } as any)
      .instruction()]);
  });

  // ===== submit_meter_reading guards =====

  // NOTE: the MeterIdTooLong require (meter_id.len() <= 32) is unreachable in practice —
  // meter_id is also a PDA seed (seeds = [b"meter", meter_id]), and Solana caps each seed at
  // 32 bytes, so a 33-byte id fails PDA derivation (client and runtime) before the handler
  // runs. The seed-length limit enforces the bound; the explicit require is dead code.

  it("rejects a submission from a non-bridge signer (UnauthorizedGateway)", async () => {
    // payer is the admin, not the configured chain_bridge.
    const blob = await sendExpectFail([submitIx(payer.publicKey, "m-auth", 1, 1, NOW - 100)], [payer]);
    expect(blob, blob).to.match(/UnauthorizedGateway/);
  });

  it("rejects a reading too far in the future (FutureReading)", async () => {
    const blob = await sendExpectFail([submitIx(chainBridge.publicKey, "m-fut", 1, 1, NOW + 3600)], [payer, chainBridge]);
    expect(blob, blob).to.match(/FutureReading/);
  });

  it("rejects an energy value above max_energy_value (EnergyValueOutOfRange)", async () => {
    const blob = await sendExpectFail([submitIx(chainBridge.publicKey, "m-range", 2_000_000, 1, NOW - 100)], [payer, chainBridge]);
    expect(blob, blob).to.match(/EnergyValueOutOfRange/);
  });

  it("rejects production wildly above consumption (AnomalousReading)", async () => {
    // produced*100 = 200000 > ratio(1000)*consumed(10) = 10000.
    const blob = await sendExpectFail([submitIx(chainBridge.publicKey, "m-anom", 2000, 10, NOW - 100)], [payer, chainBridge]);
    expect(blob, blob).to.match(/AnomalousReading/);
  });

  it("accepts a valid first reading (control)", async () => {
    await send([submitIx(chainBridge.publicKey, "m-ok", 500, 500, NOW - 100)], [payer, chainBridge]);
  });

  it("rejects a reading older than the last one (OutdatedReading)", async () => {
    const blob = await sendExpectFail([submitIx(chainBridge.publicKey, "m-ok", 500, 500, NOW - 200)], [payer, chainBridge]);
    expect(blob, blob).to.match(/OutdatedReading/);
  });

  it("rejects a reading inside the min interval (RateLimitExceeded)", async () => {
    // last = NOW-100, min_reading_interval = 60 → need ts >= NOW-40; NOW-70 is too soon.
    const blob = await sendExpectFail([submitIx(chainBridge.publicKey, "m-ok", 500, 500, NOW - 70)], [payer, chainBridge]);
    expect(blob, blob).to.match(/RateLimitExceeded/);
  });

  it("rejects submissions while the oracle is inactive (OracleInactive)", async () => {
    await send([statusIx(false, payer.publicKey)]); // admin disables
    const blob = await sendExpectFail([submitIx(chainBridge.publicKey, "m-inactive", 1, 1, NOW - 100)], [payer, chainBridge]);
    expect(blob, blob).to.match(/OracleInactive/);
    await send([statusIx(true, payer.publicKey)]); // restore
  });

  // ===== trigger_market_clearing epoch guards (chain_bridge caller) =====

  it("rejects an epoch off the 900s boundary (InvalidEpoch)", async () => {
    const blob = await sendExpectFail([triggerIx(chainBridge.publicKey, NOW - EPOCH + 1, null)], [payer, chainBridge]);
    expect(blob, blob).to.match(/InvalidEpoch/);
  });

  it("rejects a future epoch (InvalidEpoch)", async () => {
    const blob = await sendExpectFail([triggerIx(chainBridge.publicKey, NOW + EPOCH, null)], [payer, chainBridge]);
    expect(blob, blob).to.match(/InvalidEpoch/);
  });

  it("rejects clearing from a non-bridge, non-aggregator signer (UnauthorizedGateway)", async () => {
    const blob = await sendExpectFail([triggerIx(outsider.publicKey, NOW - EPOCH, null)], [payer, outsider]);
    expect(blob, blob).to.match(/UnauthorizedGateway/);
  });

  it("accepts a valid clearing on a 900s boundary (control)", async () => {
    await send([triggerIx(chainBridge.publicKey, NOW - EPOCH, null)], [payer, chainBridge]); // last_cleared = NOW-900
  });

  it("rejects an epoch at or below the last cleared one (InvalidEpoch)", async () => {
    const blob = await sendExpectFail([triggerIx(chainBridge.publicKey, NOW - 2 * EPOCH, null)], [payer, chainBridge]);
    expect(blob, blob).to.match(/InvalidEpoch/);
  });

  // ===== aggregator allow-list (cross-program with governance) =====

  it("lets a governance-admitted aggregator clear the market", async () => {
    // Admit the aggregator on governance's PoA allow-list.
    await send([await governance.methods.admitAggregator(aggregator.publicKey)
      .accounts({
        governanceConfig,
        aggregatorEntry: aggEntryPda(aggregator.publicKey),
        authority: payer.publicKey,
        systemProgram: SystemProgram.programId,
      } as any).instruction()]);

    // Aggregator drives trigger_market_clearing by passing its AggregatorEntry PDA.
    await send([triggerIx(aggregator.publicKey, NOW, aggEntryPda(aggregator.publicKey))], [payer, aggregator]);
  });

  it("rejects a revoked aggregator (AggregatorNotAdmitted)", async () => {
    await send([await governance.methods.revokeAggregator()
      .accounts({
        governanceConfig,
        aggregatorEntry: aggEntryPda(aggregator.publicKey),
        authority: payer.publicKey,
      } as any).instruction()]);

    // authorize_node_caller runs before the epoch check, so any epoch reaches the gate.
    const blob = await sendExpectFail(
      [triggerIx(aggregator.publicKey, NOW + EPOCH, aggEntryPda(aggregator.publicKey))],
      [payer, aggregator],
    );
    expect(blob, blob).to.match(/AggregatorNotAdmitted/);
  });

  // ===== admin guards =====

  it("rejects status change from a non-admin (UnauthorizedAuthority)", async () => {
    const blob = await sendExpectFail([statusIx(false, chainBridge.publicKey)], [payer, chainBridge]);
    expect(blob, blob).to.match(/UnauthorizedAuthority/);
  });

  it("rejects inverted validation bounds (InvalidConfiguration)", async () => {
    const blob = await sendExpectFail([await oracle.methods.updateValidationConfig(new BN(100), new BN(50), true)
      .accounts({ oracleData, authority: payer.publicKey } as any).instruction()]);
    expect(blob, blob).to.match(/InvalidConfiguration/);
  });

  it("rejects a zero production/consumption ratio (InvalidConfiguration)", async () => {
    const blob = await sendExpectFail([await oracle.methods.updateProductionRatioConfig(0)
      .accounts({ oracleData, authority: payer.publicKey } as any).instruction()]);
    expect(blob, blob).to.match(/InvalidConfiguration/);
  });
});
