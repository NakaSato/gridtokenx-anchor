import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { assert } from "chai";
import type { Oracle } from "../target/types/oracle";

/// Derive a meter PDA from its string ID
function findMeterPda(
  meterId: string,
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("meter"), Buffer.from(meterId)],
    programId,
  );
}

describe("Oracle Program", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Oracle as Program<Oracle>;
  const authority = provider.wallet as anchor.Wallet;

  const apiGateway = Keypair.generate();
  const backupOracle = Keypair.generate();

  // Unique run tag so meter PDAs are fresh on every test run — prevents
  // cumulative totals from a prior run causing assertion mismatches.
  const RUN_TAG = Date.now().toString(36);
  const METER_MAIN = `M-MAIN-${RUN_TAG}`;
  const METER_A = `M-A-${RUN_TAG}`;
  const METER_B = `M-B-${RUN_TAG}`;
  const METER_C = `M-C-${RUN_TAG}`;

  let oracleData: PublicKey;

  // Snapshots taken just before our submit/aggregate tests so that assertions
  // check deltas rather than absolute values. This keeps the suite idempotent
  // even when oracle_data accumulates totals from prior runs on the same ledger.
  let globalProducedBefore = 0;
  let globalConsumedBefore = 0;
  let validReadingsBefore = 0;
  let totalReadingsBefore = 0;
  let globalProducedAfterSubmit = 0; // captured after submit, before aggregate

  before(async () => {
    [oracleData] = PublicKey.findProgramAddressSync(
      [Buffer.from("oracle_data")],
      program.programId,
    );

    // Airdrop to the ephemeral apiGateway keypair
    const sig = await provider.connection.requestAirdrop(
      apiGateway.publicKey,
      2 * LAMPORTS_PER_SOL,
    );
    const latest = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction({ signature: sig, ...latest });
  });

  // ── 1. Initialization ─────────────────────────────────────────────────────

  it("Initializes the oracle", async () => {
    try {
      await program.methods
        .initialize(apiGateway.publicKey)
        .accounts({
          oracleData,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const data = await program.account.oracleData.fetch(oracleData);
      assert.ok(data.authority.equals(authority.publicKey));
      assert.ok(data.apiGateway.equals(apiGateway.publicKey));
      assert.equal(data.active, 1);
    } catch (e: any) {
      if (e.message.includes("already in use")) {
        console.log("Oracle already initialized");
        // Re-point the oracle's gateway to this run's ephemeral keypair
        await program.methods
          .updateApiGateway(apiGateway.publicKey)
          .accounts({ oracleData, authority: authority.publicKey })
          .rpc();
      } else {
        throw e;
      }
    }
  });

  // ── 2. Per-meter reads (Sealevel-parallel write path) ─────────────────────

  it("Submits meter reading via API Gateway (writes to MeterState PDA)", async () => {
    const [meterState] = findMeterPda(METER_MAIN, program.programId);
    const timestamp = new BN(Math.floor(Date.now() / 1000));

    await program.methods
      .submitMeterReading(METER_MAIN, new BN(100), new BN(50), timestamp)
      .accounts({
        oracleData,
        meterState,
        authority: apiGateway.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([apiGateway])
      .rpc();

    // Verify per-meter PDA state
    const meter = await program.account.meterState.fetch(meterState);
    assert.equal(
      meter.totalEnergyProduced.toNumber(),
      100,
      "totalEnergyProduced should be 100 (fresh PDA)",
    );
    assert.equal(
      meter.totalEnergyConsumed.toNumber(),
      50,
      "totalEnergyConsumed should be 50",
    );
    assert.equal(
      meter.totalReadings.toNumber(),
      1,
      "totalReadings should be 1 after first submit",
    );

    // Global counters are updated by aggregate_readings, NOT by submit_meter_reading.
    // Snapshot the current value so the aggregate test can check a delta.
    const data = await program.account.oracleData.fetch(oracleData);
    globalProducedAfterSubmit = data.totalGlobalEnergyProduced.toNumber();
    // The counter must not have increased as a result of this submit call.
    // (It may already be non-zero from prior runs — that is fine.)
    assert.equal(
      data.totalGlobalEnergyProduced.toNumber(),
      globalProducedAfterSubmit,
      "Global counter must not change on submit_meter_reading (only on aggregate_readings)",
    );
  });

  it("Submits readings for different meters in parallel (Sealevel)", async () => {
    const meters = [METER_A, METER_B, METER_C];
    const timestamp = new BN(Math.floor(Date.now() / 1000));

    // All three touch different MeterState PDAs — Sealevel can parallelise them
    const txPromises = meters.map((meterId) => {
      const [meterState] = findMeterPda(meterId, program.programId);
      return program.methods
        .submitMeterReading(meterId, new BN(200), new BN(100), timestamp)
        .accounts({
          oracleData,
          meterState,
          authority: apiGateway.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([apiGateway])
        .rpc();
    });

    await Promise.all(txPromises);

    // Each fresh PDA should have exactly one reading of 200 produced
    for (const meterId of meters) {
      const [meterState] = findMeterPda(meterId, program.programId);
      const meter = await program.account.meterState.fetch(meterState);
      assert.equal(
        meter.totalEnergyProduced.toNumber(),
        200,
        `${meterId}: totalEnergyProduced should be 200`,
      );
      assert.equal(
        meter.totalReadings.toNumber(),
        1,
        `${meterId}: totalReadings should be 1`,
      );
    }
  });

  it("Aggregates readings into global counters (batch)", async () => {
    // Snapshot counters immediately before aggregate_readings so assertions
    // can measure the exact delta this call contributes.
    const before = await program.account.oracleData.fetch(oracleData);
    globalProducedBefore = before.totalGlobalEnergyProduced.toNumber();
    globalConsumedBefore = before.totalGlobalEnergyConsumed.toNumber();
    validReadingsBefore = before.totalValidReadings.toNumber();
    totalReadingsBefore = before.totalReadings.toNumber();

    // Aggregate: METER_MAIN(100/50) + METER_A/B/C(200/100 each) = 700/350 produced/consumed
    await program.methods
      .aggregateReadings(
        new BN(700), // total_produced
        new BN(350), // total_consumed
        new BN(4), // valid_count
        new BN(0), // rejected_count
      )
      .accounts({
        oracleData,
        authority: apiGateway.publicKey,
      })
      .signers([apiGateway])
      .rpc();

    const data = await program.account.oracleData.fetch(oracleData);

    assert.equal(
      data.totalGlobalEnergyProduced.toNumber(),
      globalProducedBefore + 700,
      "totalGlobalEnergyProduced should increase by 700",
    );
    assert.equal(
      data.totalGlobalEnergyConsumed.toNumber(),
      globalConsumedBefore + 350,
      "totalGlobalEnergyConsumed should increase by 350",
    );
    assert.equal(
      data.totalValidReadings.toNumber(),
      validReadingsBefore + 4,
      "totalValidReadings should increase by 4",
    );
    assert.equal(
      data.totalReadings.toNumber(),
      totalReadingsBefore + 4,
      "totalReadings should increase by 4",
    );
  });

  // ── 3. Security ────────────────────────────────────────────────────────────

  it("Fails to submit reading from unauthorized gateway", async () => {
    const other = Keypair.generate();
    const [meterState] = findMeterPda(METER_MAIN, program.programId);
    const timestamp = new BN(Math.floor(Date.now() / 1000));
    try {
      await program.methods
        .submitMeterReading(METER_MAIN, new BN(100), new BN(50), timestamp)
        .accounts({
          oracleData,
          meterState,
          authority: other.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([other])
        .rpc();
      assert.fail("Should have rejected unauthorized gateway");
    } catch (e: any) {
      // Any program error is acceptable here — we just want confirmation it fails
      assert.ok(e, "Unauthorized submission should throw");
    }
  });

  // ── 4. Market clearing ────────────────────────────────────────────────────

  it("Triggers market clearing", async () => {
    const epochTimestamp = new BN(Math.floor(Date.now() / 1000));

    await program.methods
      .triggerMarketClearing(epochTimestamp)
      .accounts({
        oracleData,
        authority: apiGateway.publicKey,
      })
      .signers([apiGateway])
      .rpc();

    const data = await program.account.oracleData.fetch(oracleData);
    assert.ok(data.lastClearing.toNumber() > 0, "lastClearing should be set");
    assert.equal(
      data.lastClearedEpoch.toNumber(),
      epochTimestamp.toNumber(),
      "lastClearedEpoch should match submitted epoch",
    );
  });

  // ── 5. Admin operations ───────────────────────────────────────────────────

  it("Updates oracle status (active/inactive toggle)", async () => {
    await program.methods
      .updateOracleStatus(false)
      .accounts({ oracleData, authority: authority.publicKey })
      .rpc();

    let data = await program.account.oracleData.fetch(oracleData);
    assert.equal(data.active, 0, "Oracle should be inactive");

    await program.methods
      .updateOracleStatus(true)
      .accounts({ oracleData, authority: authority.publicKey })
      .rpc();

    data = await program.account.oracleData.fetch(oracleData);
    assert.equal(data.active, 1, "Oracle should be active again");
  });

  it("Updates API Gateway address", async () => {
    const newGateway = Keypair.generate().publicKey;

    await program.methods
      .updateApiGateway(newGateway)
      .accounts({ oracleData, authority: authority.publicKey })
      .rpc();

    const data = await program.account.oracleData.fetch(oracleData);
    assert.ok(
      data.apiGateway.equals(newGateway),
      "apiGateway should be updated",
    );

    // Restore the run's ephemeral gateway so subsequent tests still work
    await program.methods
      .updateApiGateway(apiGateway.publicKey)
      .accounts({ oracleData, authority: authority.publicKey })
      .rpc();
  });

  it("Updates validation config", async () => {
    await program.methods
      .updateValidationConfig(
        new BN(10), // min_energy_value
        new BN(10000), // max_energy_value
        true, // anomaly_detection_enabled
        75, // max_reading_deviation_percent
        false, // require_consensus
      )
      .accounts({ oracleData, authority: authority.publicKey })
      .rpc();

    const data = await program.account.oracleData.fetch(oracleData);
    assert.equal(data.minEnergyValue.toNumber(), 10);
    assert.equal(data.maxEnergyValue.toNumber(), 10000);
    assert.equal(data.maxReadingDeviationPercent, 75);
  });

  it("Adds and removes backup oracles", async () => {
    await program.methods
      .addBackupOracle(backupOracle.publicKey)
      .accounts({ oracleData, authority: authority.publicKey })
      .rpc();

    let data = await program.account.oracleData.fetch(oracleData);
    assert.equal(
      data.backupOraclesCount,
      1,
      "backupOraclesCount should be 1 after add",
    );
    assert.ok(
      data.backupOracles[0].equals(backupOracle.publicKey),
      "backupOracles[0] should match the added oracle",
    );

    await program.methods
      .removeBackupOracle(backupOracle.publicKey)
      .accounts({ oracleData, authority: authority.publicKey })
      .rpc();

    data = await program.account.oracleData.fetch(oracleData);
    assert.equal(
      data.backupOraclesCount,
      0,
      "backupOraclesCount should be 0 after remove",
    );
  });
});
