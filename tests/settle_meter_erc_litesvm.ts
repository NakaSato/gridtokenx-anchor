// Litesvm coverage for two previously-untested registry settlement-accounting
// instructions: settle_meter_balance (do_settle_meter, lib.rs:642/1245) and
// mark_erc_claimed (lib.rs:684). Both move a meter's NET generation
// (total_generation - total_consumption) into claimed buckets, and the key
// invariant is that GRID settlement + ERC claims can never jointly exceed net
// generation: unclaimed = net_gen - settled_net_generation - claimed_erc_generation.
//
// This test arms one meter (net = 800) and walks the shared budget across BOTH
// instructions to prove the cross-claim cap holds:
//   mark_erc_claimed: UnauthorizedAuthority, control (claim 300), NoUnsettledBalance (over-claim)
//   settle_meter_balance: UnauthorizedUser, control (settles the remaining 500),
//                         NoUnsettledBalance (budget exhausted), InvalidMeterStatus (deactivated)
//
// settle_and_mint_tokens (the CPI variant) is out of scope here — it needs the
// energy-token program + Token-2022 mint; this isolates the pure registry accounting.

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
const NET_GEN = 800; // gen 1000 - con 200

describe("registry settle_meter_balance + mark_erc_claimed (litesvm)", () => {
  let svm: LiteSVM;
  let program: Program<Registry>;
  let programId: PublicKey;

  const payer = Keypair.generate();   // registry authority + funder
  const user = Keypair.generate();    // meter owner
  const oracle = Keypair.generate();  // configured oracle authority
  const attacker = Keypair.generate();

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

  function meter() {
    const acct = svm.getAccount(meterPda)!;
    return program.coder.accounts.decode("meterAccount", Buffer.from(acct.data));
  }

  // Capture an instruction's Anchor return value (read-only getters).
  function sendRaw(ixs: TransactionInstruction[], signers: Keypair[] = []) {
    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = payer.publicKey;
    ixs.forEach((ix) => tx.add(ix));
    tx.sign(payer, ...signers);
    const res = svm.sendTransaction(tx);
    svm.expireBlockhash();
    if (res instanceof FailedTransactionMetadata) throw new Error("tx failed: " + res.err().toString());
    return res;
  }
  const retBool = (res: any) => { const d = res.returnData().data(); return d.length > 0 && d[0] === 1; };
  const retU64 = (res: any) => { const d = res.returnData().data(); let v = 0n; for (let i = 0; i < d.length; i++) v |= BigInt(d[i]) << BigInt(8 * i); return v; };

  const isValidUserIx = () => program.methods.isValidUser().accounts({ userAccount: userPda } as any).instruction();
  const isValidMeterIx = () => program.methods.isValidMeter().accounts({ meterAccount: meterPda } as any).instruction();
  const getUnsettledIx = () => program.methods.getUnsettledBalance().accounts({ meterAccount: meterPda } as any).instruction();

  const settleIx = (owner: PublicKey) =>
    program.methods.settleMeterBalance().accounts({ meterAccount: meterPda, meterOwner: owner } as any).instruction();
  const ercIx = (authority: PublicKey, amount: number) =>
    program.methods.markErcClaimed(new BN(amount)).accounts({ meterAccount: meterPda, registry: registryPda, authority } as any).instruction();

  before(async () => {
    svm = new LiteSVM().withDefaultPrograms();
    program = new Program(idl, { connection: {}, publicKey: PublicKey.default } as any);
    programId = program.programId;
    svm.addProgramFromFile(programId, "target/deploy/registry.so");
    svm.airdrop(payer.publicKey, BigInt(1_000_000_000_000));
    svm.airdrop(attacker.publicKey, BigInt(1_000_000_000));

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
    // Configure oracle + push one reading → net generation = 800.
    send([await program.methods.setOracleAuthority(oracle.publicKey).accounts({ registry: registryPda, authority: payer.publicKey }).instruction()]);
    send([await program.methods.updateMeterReading(new BN(1000), new BN(200), new BN(1000)).accounts({
      registry: registryPda, meterAccount: meterPda, oracleAuthority: oracle.publicKey,
    } as any).instruction()], [oracle]);
  });

  it("arms a meter with net generation = 800 (precondition)", async () => {
    const m = meter();
    expect(m.totalGeneration.toNumber()).to.equal(1000);
    expect(m.totalConsumption.toNumber()).to.equal(200);
    expect(m.settledNetGeneration.toNumber()).to.equal(0);
    expect(m.claimedErcGeneration.toNumber()).to.equal(0);
  });

  // --- read-only getters (return-value capture; before any settlement mutation) ---

  it("is_valid_user returns true for an Active user", async () => {
    expect(retBool(sendRaw([await isValidUserIx()]))).to.equal(true);
  });

  it("is_valid_meter returns true for an Active meter", async () => {
    expect(retBool(sendRaw([await isValidMeterIx()]))).to.equal(true);
  });

  it("get_unsettled_balance returns net generation before settlement (800)", async () => {
    expect(retU64(sendRaw([await getUnsettledIx()]))).to.equal(800n);
  });

  // --- mark_erc_claimed ---

  it("rejects an ERC claim from a non-authority (UnauthorizedAuthority)", async () => {
    const blob = sendExpectFail([await ercIx(attacker.publicKey, 100)], [attacker]);
    expect(blob, blob).to.match(/UnauthorizedAuthority/);
  });

  it("marks 300 of net generation as ERC-claimed (control)", async () => {
    send([await ercIx(payer.publicKey, 300)]); // payer == registry.authority
    expect(meter().claimedErcGeneration.toNumber()).to.equal(300);
  });

  it("rejects an ERC claim exceeding the unclaimed remainder (NoUnsettledBalance)", async () => {
    // unclaimed = 800 - 0 settled - 300 claimed = 500; 600 > 500.
    const blob = sendExpectFail([await ercIx(payer.publicKey, 600)]);
    expect(blob, blob).to.match(/NoUnsettledBalance/);
  });

  // --- settle_meter_balance (shares the same net-generation budget) ---

  it("rejects settlement by a non-owner signer (UnauthorizedUser)", async () => {
    const blob = sendExpectFail([await settleIx(attacker.publicKey)], [attacker]);
    expect(blob, blob).to.match(/UnauthorizedUser/);
  });

  it("settles the GRID remainder left after the ERC claim (control)", async () => {
    // remaining = net 800 - settled 0 - claimed 300 = 500.
    send([await settleIx(user.publicKey)], [user]);
    expect(meter().settledNetGeneration.toNumber()).to.equal(500);
  });

  it("rejects a re-settle once the budget is exhausted (NoUnsettledBalance)", async () => {
    // 800 - 500 settled - 300 claimed = 0.
    const blob = sendExpectFail([await settleIx(user.publicKey)], [user]);
    expect(blob, blob).to.match(/NoUnsettledBalance/);
  });

  it("rejects settlement once the meter is deactivated (InvalidMeterStatus)", async () => {
    send([await program.methods.deactivateMeter().accounts({
      meterAccount: meterPda, userAccount: userPda, registry: registryPda, registryShard: shardPda, owner: user.publicKey,
    } as any).instruction()], [user]);
    const blob = sendExpectFail([await settleIx(user.publicKey)], [user]);
    expect(blob, blob).to.match(/InvalidMeterStatus/);
  });
});
