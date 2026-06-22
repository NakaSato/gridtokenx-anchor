// Litesvm coverage for the proposal/vote ZONE-BINDING guard (audit HIGH fix).
//
// governance::create_proposal and cast_vote now require meter.zone_id == target_zone, so a
// prosumer can only propose for / vote in the zone their meter belongs to. The meter is a
// registry-owned UncheckedAccount validated by raw bytemuck in-handler, so we fabricate it
// directly via svm.setAccount (owner = registry program id) — no registry program needed.
//
// MeterAccount account layout (8-byte disc + 120-byte struct):
//   [0..8] disc | [8..40] meter_id | [40..72] owner | [72] meter_type | [73] status
//   [74..76] _pad_a | [76..80] zone_id (i32) | [80..88] registered_at | [88..96] last_reading_at
//   [96..104] total_generation | ...

import { LiteSVM, FailedTransactionMetadata } from "litesvm";
import { Program } from "@anchor-lang/core";
import { Governance } from "../target/types/governance";
import { PublicKey, Keypair, Transaction, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { expect } from "chai";
import BN from "bn.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const idl = require("../target/idl/governance.json");

// registry::ID (declare_id! in programs/registry/src/lib.rs) — the meter_account owner.
const REGISTRY_ID = new PublicKey("FcSd5x4X1nzJMKLZC4tMZXnQ1ipLrGsEfeoH8N4mvJX7");

function meterBytes(owner: PublicKey, zoneId: number, totalGen: bigint): Buffer {
  const d = Buffer.alloc(128); // 8 disc + 120 struct; disc/unused fields stay 0
  owner.toBuffer().copy(d, 40); // owner [40..72]
  // status = Active (0) at [73] — already zero
  d.writeInt32LE(zoneId, 76); // zone_id [76..80]
  d.writeBigUInt64LE(totalGen, 96); // total_generation [96..104]
  return d;
}

describe("governance proposal/vote zone binding (litesvm)", () => {
  let svm: LiteSVM;
  let gov: Program<Governance>;
  let govId: PublicKey;

  const payer = Keypair.generate();
  const proposer = Keypair.generate();
  const voter = Keypair.generate();
  const proposerMeter = Keypair.generate().publicKey;
  const voterMeterZ0 = Keypair.generate().publicKey;
  const voterMeterZ7 = Keypair.generate().publicKey;

  function run(ixs: TransactionInstruction[], signers: Keypair[]): FailedTransactionMetadata | null {
    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = payer.publicKey;
    ixs.forEach((ix) => tx.add(ix));
    tx.sign(payer, ...signers);
    const r = svm.sendTransaction(tx);
    svm.expireBlockhash();
    return r instanceof FailedTransactionMetadata ? r : null;
  }
  function send(ixs: TransactionInstruction[], signers: Keypair[]) {
    const f = run(ixs, signers);
    if (f) throw new Error("tx failed: " + f.err().toString() + "\n" + f.meta().logs().join("\n"));
  }
  function sendExpectFail(ixs: TransactionInstruction[], signers: Keypair[]): string {
    const f = run(ixs, signers);
    if (!f) throw new Error("expected tx to fail but it succeeded");
    return f.err().toString() + "\n" + f.meta().logs().join("\n");
  }

  const proposalPda = (zone: number, id: number) => {
    const z = Buffer.alloc(4); z.writeInt32LE(zone, 0);
    const i = Buffer.alloc(8); i.writeBigUInt64LE(BigInt(id), 0);
    return PublicKey.findProgramAddressSync([Buffer.from("proposal"), z, i], govId)[0];
  };
  const setMeter = (key: PublicKey, owner: PublicKey, zone: number, gen: bigint) => {
    const data = meterBytes(owner, zone, gen);
    svm.setAccount(key, {
      lamports: Number(svm.minimumBalanceForRentExemption(BigInt(data.length))),
      data, owner: REGISTRY_ID, executable: false, rentEpoch: 0,
    } as any);
  };

  const createProposalIx = (proposer: PublicKey, zone: number, id: number, meter: PublicKey) =>
    gov.methods.createProposal(zone, new BN(id), { wheelingCharge: {} }, new BN(75), new BN(3600))
      .accounts({ proposal: proposalPda(zone, id), proposer, meterAccount: meter, systemProgram: SystemProgram.programId } as any)
      .instruction();

  const castVoteIx = (voter: PublicKey, zone: number, id: number, meter: PublicKey, choice: boolean) =>
    gov.methods.castVote(choice)
      .accounts({
        proposal: proposalPda(zone, id),
        voteRecord: PublicKey.findProgramAddressSync([Buffer.from("vote"), proposalPda(zone, id).toBuffer(), voter.toBuffer()], govId)[0],
        voter, meterAccount: meter, systemProgram: SystemProgram.programId,
      } as any).instruction();

  before(async () => {
    svm = new LiteSVM().withDefaultPrograms();
    gov = new Program(idl, { connection: {}, publicKey: PublicKey.default } as any);
    govId = gov.programId;
    svm.addProgramFromFile(govId, "target/deploy/governance.so");
    svm.airdrop(payer.publicKey, BigInt(1_000_000_000_000));
    svm.airdrop(proposer.publicKey, BigInt(1_000_000_000));
    svm.airdrop(voter.publicKey, BigInt(1_000_000_000));

    setMeter(proposerMeter, proposer.publicKey, 0, 5_000_000n); // proposer in zone 0
    setMeter(voterMeterZ0, voter.publicKey, 0, 5_000_000n);     // voter in zone 0
    setMeter(voterMeterZ7, voter.publicKey, 7, 5_000_000n);     // same voter, a zone-7 meter
  });

  it("creates a proposal for the meter's own zone (control)", async () => {
    send([await createProposalIx(proposer.publicKey, 0, 1, proposerMeter)], [proposer]);
  });

  it("rejects a proposal whose target_zone != the proposer meter's zone (MeterZoneMismatch)", async () => {
    const blob = sendExpectFail([await createProposalIx(proposer.publicKey, 7, 2, proposerMeter)], [proposer]);
    expect(blob, blob).to.match(/MeterZoneMismatch/);
  });

  it("rejects a vote cast with a meter from a different zone (MeterZoneMismatch)", async () => {
    // Proposal #1 is zone 0; voting with the voter's zone-7 meter must be rejected.
    const blob = sendExpectFail([await castVoteIx(voter.publicKey, 0, 1, voterMeterZ7, true)], [voter]);
    expect(blob, blob).to.match(/MeterZoneMismatch/);
  });

  it("accepts a vote cast with a meter in the proposal's zone (control)", async () => {
    send([await castVoteIx(voter.publicKey, 0, 1, voterMeterZ0, true)], [voter]);
  });
});
