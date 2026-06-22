// Litesvm coverage for the registry AMI meter-reading validation guards on
// update_meter_reading — the data-integrity boundary for oracle-pushed telemetry,
// all previously untested:
//   OracleNotConfigured → UnauthorizedOracle → InvalidMeterStatus → StaleReading
//   → ReadingTooFrequent → ReadingTooHigh  (guard order, lib.rs:451-485)
//
// reading_timestamp is an explicit arg (not the bank clock), so the stale/rate-limit
// cases need no setClock — they compare the arg against the meter's stored last_reading_at.

import { LiteSVM, FailedTransactionMetadata } from "litesvm";
import { Program } from "@anchor-lang/core";
import { Registry } from "../target/types/registry";
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
const idl = require("../target/idl/registry.json");

const METER_ID = "METER001";
const MAX_DELTA = new BN("1000000000000"); // 1e12, the ReadingTooHigh ceiling

describe("registry meter-reading validation guards (litesvm)", () => {
  let svm: LiteSVM;
  let program: Program<Registry>;
  let programId: PublicKey;

  const payer = Keypair.generate(); // registry authority + funder
  const user = Keypair.generate(); // meter owner (custodial: non-signing on register)
  const oracle = Keypair.generate(); // the configured oracle authority
  const wrongOracle = Keypair.generate();

  let registryPda: PublicKey;
  let userPda: PublicKey;
  let shardPda: PublicKey;
  let meterPda: PublicKey;
  let shardId: number;

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

  function readingIx(gen: number | BN, con: number, ts: number, oracleAuth: PublicKey) {
    return program.methods
      .updateMeterReading(new BN(gen), new BN(con), new BN(ts))
      .accounts({ registry: registryPda, meterAccount: meterPda, oracleAuthority: oracleAuth })
      .instruction();
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

    send([
      await program.methods.initialize().accounts({ registry: registryPda, authority: payer.publicKey, systemProgram: SystemProgram.programId }).instruction(),
      await program.methods.initializeShard(shardId).accounts({ shard: shardPda, authority: payer.publicKey, systemProgram: SystemProgram.programId }).instruction(),
    ]);
    send([await program.methods.registerUser({ prosumer: {} }, 0, 0, new BN(0), shardId).accounts({
      userAccount: userPda, registryShard: shardPda, registry: registryPda, authority: user.publicKey, payer: payer.publicKey, systemProgram: SystemProgram.programId,
    }).instruction()]);
    send([await program.methods.registerMeter(METER_ID, { solar: {} }, shardId, 0).accounts({
      meterAccount: meterPda, userAccount: userPda, registryShard: shardPda, registry: registryPda,
      owner: user.publicKey, payer: payer.publicKey, systemProgram: SystemProgram.programId,
    }).instruction()]);
    // NOTE: oracle authority intentionally NOT set yet — exercised by the first test.
  });

  it("rejects a reading before an oracle authority is configured (OracleNotConfigured)", async () => {
    const blob = sendExpectFail([await readingIx(100, 0, 1000, oracle.publicKey)], [oracle]);
    expect(blob, blob).to.match(/OracleNotConfigured/);
  });

  it("rejects a reading signed by the wrong oracle (UnauthorizedOracle)", async () => {
    send([await program.methods.setOracleAuthority(oracle.publicKey).accounts({ registry: registryPda, authority: payer.publicKey }).instruction()]);
    const blob = sendExpectFail([await readingIx(100, 0, 1000, wrongOracle.publicKey)], [wrongOracle]);
    expect(blob, blob).to.match(/UnauthorizedOracle/);
  });

  it("rejects an implausibly large reading (ReadingTooHigh)", async () => {
    const blob = sendExpectFail([await readingIx(MAX_DELTA.add(new BN(1)), 0, 1000, oracle.publicKey)], [oracle]);
    expect(blob, blob).to.match(/ReadingTooHigh/);
  });

  it("accepts a valid reading (control)", async () => {
    send([await readingIx(100, 50, 1000, oracle.publicKey)], [oracle]); // sets last_reading_at = 1000
  });

  it("rejects a non-increasing reading timestamp (StaleReading)", async () => {
    const blob = sendExpectFail([await readingIx(100, 0, 1000, oracle.publicKey)], [oracle]); // 1000 <= 1000
    expect(blob, blob).to.match(/StaleReading/);
  });

  it("rejects a reading inside the rate-limit interval (ReadingTooFrequent)", async () => {
    const blob = sendExpectFail([await readingIx(100, 0, 1030, oracle.publicKey)], [oracle]); // 1030 < 1000+60
    expect(blob, blob).to.match(/ReadingTooFrequent/);
  });

  it("set_meter_status cannot set Inactive — that is deactivate_meter's job (InvalidMeterStatusTransition)", async () => {
    // Setting Inactive here would drop active_meter_count but leave meter_count/user.meter_count
    // overcounted. Inactive is reachable only via deactivate_meter. Meter stays Active (reverts).
    const blob = sendExpectFail([await program.methods.setMeterStatus({ inactive: {} }).accounts({
      meterAccount: meterPda, registry: registryPda, registryShard: shardPda, authority: user.publicKey,
    }).instruction()], [user]);
    expect(blob, blob).to.match(/InvalidMeterStatusTransition/);
  });

  it("rejects deactivate with a victim's user_account (ConstraintSeeds)", async () => {
    // Regression: deactivate_meter previously took an UNBOUND user_account, so a
    // signer owning meterPda could pass a VICTIM's real UserAccount and grief its
    // meter_count down. Register a victim, then have the meter owner try to charge
    // the decrement to the victim's (registry-owned, so it clears the owner check)
    // account — the [b"user", owner] seed binding now rejects it (derive(owner) !=
    // victim pda). Meter is still Active here (the real deactivation is next).
    const victim = Keypair.generate();
    const victimShardId = victim.publicKey.toBytes()[0] % 16;
    const [victimUserPda] = PublicKey.findProgramAddressSync([Buffer.from("user"), victim.publicKey.toBuffer()], programId);
    const [victimShardPda] = PublicKey.findProgramAddressSync([Buffer.from("registry_shard"), Buffer.from([victimShardId])], programId);
    // Victim's shard may differ from `user`'s — init it if so (idempotent otherwise).
    if (victimShardId !== shardId) {
      send([await program.methods.initializeShard(victimShardId).accounts({ shard: victimShardPda, authority: payer.publicKey, systemProgram: SystemProgram.programId }).instruction()]);
    }
    send([await program.methods.registerUser({ consumer: {} }, 0, 0, new BN(0), victimShardId).accounts({
      userAccount: victimUserPda, registryShard: victimShardPda, registry: registryPda, authority: victim.publicKey, payer: payer.publicKey, systemProgram: SystemProgram.programId,
    }).instruction()]);

    const blob = sendExpectFail([await program.methods.deactivateMeter().accounts({
      meterAccount: meterPda, userAccount: victimUserPda, registry: registryPda, registryShard: shardPda, owner: user.publicKey,
    }).instruction()], [user]);
    expect(blob, blob).to.match(/ConstraintSeeds|seeds constraint|2006/);
  });

  it("rejects a reading once the meter is deactivated (InvalidMeterStatus)", async () => {
    send([await program.methods.deactivateMeter().accounts({
      meterAccount: meterPda, userAccount: userPda, registry: registryPda, registryShard: shardPda, owner: user.publicKey,
    }).instruction()], [user]);
    const blob = sendExpectFail([await readingIx(100, 0, 2000, oracle.publicKey)], [oracle]); // status != Active
    expect(blob, blob).to.match(/InvalidMeterStatus/);
  });

  it("rejects reviving a deactivated meter via set_meter_status (InvalidMeterStatusTransition)", async () => {
    // Meter is now Inactive (terminal, from the test above). Reviving it via set_meter_status
    // would re-add active_meter_count without restoring the meter_count deactivate_meter dropped,
    // leaving active_meter_count > meter_count. Must be rejected.
    const blob = sendExpectFail([await program.methods.setMeterStatus({ active: {} }).accounts({
      meterAccount: meterPda, registry: registryPda, registryShard: shardPda, authority: user.publicKey,
    }).instruction()], [user]);
    expect(blob, blob).to.match(/InvalidMeterStatusTransition/);
  });
});
