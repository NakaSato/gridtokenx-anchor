// Litesvm coverage for the governance PoA authority/config/oracle guards, previously
// only exercised by the validator-backed tests/governance.ts. These paths touch only the
// single ["poa_config"] PDA — no tokens, no CPI — so they run fully in-process.
//
// Headline cases:
//   - 2-step authority transfer (propose_authority_change -> approve_authority_change):
//     the full happy path AND every rejection — wrong signer (has_one), self-target,
//     double-propose, approve/cancel with nothing pending, wrong pending approver, and
//     the 48h expiry (driven by a litesvm clock warp; AUTHORITY_CHANGE_EXPIRATION,
//     authority.rs:9).
//   - set_oracle_authority confidence bound (min_confidence <= 100, authority.rs:133).
//   - update_erc_limits / update_authority_info input guards (config.rs:56-99).
//
// Guard sources: programs/governance/src/handlers/authority.rs + config.rs;
// access control (has_one authority) in programs/governance/src/contexts.rs.

import { LiteSVM, Clock, FailedTransactionMetadata } from "litesvm";
import { Program } from "@anchor-lang/core";
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
const governanceIdl = require("../target/idl/governance.json");

const NOW = 1_000_000;
const AUTHORITY_CHANGE_EXPIRATION = 48 * 60 * 60; // authority.rs:9

describe("governance authority/config/oracle guards (litesvm)", () => {
  let svm: LiteSVM;
  let governance: Program<Governance>;
  let governanceId: PublicKey;

  const payer = Keypair.generate(); // initial PoA authority + fee payer
  const attacker = Keypair.generate(); // non-authority signer
  const proposed = Keypair.generate(); // pending authority for the transfer happy path

  let governanceConfig: PublicKey;

  // Send signed by `payer` as fee payer; `extra` are additional signers.
  // ixs may be instructions or promises of instructions (anchor `.instruction()` is async).
  type IxLike = TransactionInstruction | Promise<TransactionInstruction>;
  async function trySend(ixs: IxLike[], extra: Keypair[] = []): Promise<FailedTransactionMetadata | null> {
    const resolved = await Promise.all(ixs);
    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = payer.publicKey;
    resolved.forEach((ix) => tx.add(ix));
    tx.sign(payer, ...extra);
    const res = svm.sendTransaction(tx);
    svm.expireBlockhash();
    return res instanceof FailedTransactionMetadata ? res : null;
  }
  async function send(ixs: IxLike[], extra: Keypair[] = []) {
    const f = await trySend(ixs, extra);
    if (f) throw new Error("tx failed: " + f.err().toString() + "\n" + f.meta().logs().join("\n"));
  }
  async function sendExpectFail(ixs: IxLike[], extra: Keypair[] = []): Promise<string> {
    const f = await trySend(ixs, extra);
    if (!f) throw new Error("expected tx to fail but it succeeded");
    return f.err().toString() + "\n" + f.meta().logs().join("\n");
  }

  function warpClock(unixTs: number) {
    const c = svm.getClock();
    svm.setClock(new Clock(c.slot, 0n, 0n, 0n, BigInt(unixTs)));
  }

  function readAuthority(): string {
    const acct = svm.getAccount(governanceConfig);
    if (!acct) throw new Error("poa_config missing");
    const decoded = governance.coder.accounts.decode("governanceConfig", Buffer.from(acct.data));
    return (decoded.authority as PublicKey).toBase58();
  }

  // Instruction builders (authority overridable to test has_one).
  const proposeIx = (newAuthority: PublicKey, authority = payer.publicKey) =>
    governance.methods.proposeAuthorityChange(newAuthority)
      .accounts({ governanceConfig, authority } as any).instruction();

  const approveIx = (newAuthority: PublicKey) =>
    governance.methods.approveAuthorityChange()
      .accounts({ governanceConfig, newAuthority } as any).instruction();

  const cancelIx = (authority = payer.publicKey) =>
    governance.methods.cancelAuthorityChange()
      .accounts({ governanceConfig, authority } as any).instruction();

  const setOracleIx = (minConfidence: number, authority = payer.publicKey) =>
    governance.methods.setOracleAuthority(PublicKey.default, minConfidence, false)
      .accounts({ governanceConfig, authority } as any).instruction();

  const ercLimitsIx = (min: number | BN, max: number | BN, validity: number | BN) =>
    governance.methods.updateErcLimits(new BN(min), new BN(max), new BN(validity))
      .accounts({ governanceConfig, authority: payer.publicKey } as any).instruction();

  const authorityInfoIx = (contact: string) =>
    governance.methods.updateAuthorityInfo(contact)
      .accounts({ governanceConfig, authority: payer.publicKey } as any).instruction();

  before(async () => {
    svm = new LiteSVM().withDefaultPrograms();
    governance = new Program(governanceIdl, { connection: {}, publicKey: PublicKey.default } as any);
    governanceId = governance.programId;
    svm.addProgramFromFile(governanceId, "target/deploy/governance.so");
    svm.airdrop(payer.publicKey, BigInt(1_000_000_000_000));
    svm.airdrop(attacker.publicKey, BigInt(1_000_000_000_000));

    governanceConfig = PublicKey.findProgramAddressSync([Buffer.from("poa_config")], governanceId)[0];

    warpClock(NOW);

    // initialize_governance: authority = payer.
    await send([await governance.methods.initializeGovernance()
      .accounts({
        governanceConfig,
        authority: payer.publicKey,
        systemProgram: SystemProgram.programId,
      } as any).instruction()]);
  });

  // ===== 2-step authority transfer guards =====

  it("rejects propose from a non-authority signer (UnauthorizedAuthority)", async () => {
    const blob = await sendExpectFail([proposeIx(proposed.publicKey, attacker.publicKey)], [attacker]);
    expect(blob, blob).to.match(/UnauthorizedAuthority/);
  });

  it("rejects proposing the current authority as the new one (CannotTransferToSelf)", async () => {
    const blob = await sendExpectFail([proposeIx(payer.publicKey)]);
    expect(blob, blob).to.match(/CannotTransferToSelf/);
  });

  it("rejects approve when no change is pending (NoAuthorityChangePending)", async () => {
    const blob = await sendExpectFail([approveIx(proposed.publicKey)], [proposed]);
    expect(blob, blob).to.match(/NoAuthorityChangePending/);
  });

  it("rejects cancel when no change is pending (NoAuthorityChangePending)", async () => {
    const blob = await sendExpectFail([cancelIx()]);
    expect(blob, blob).to.match(/NoAuthorityChangePending/);
  });

  it("rejects a second propose while one is pending (AuthorityChangePending)", async () => {
    await send([proposeIx(proposed.publicKey)]); // sets pending
    const blob = await sendExpectFail([proposeIx(attacker.publicKey)]);
    expect(blob, blob).to.match(/AuthorityChangePending/);
  });

  it("rejects approve from the wrong pending authority (InvalidPendingAuthority)", async () => {
    // pending = proposed; attacker tries to approve.
    const blob = await sendExpectFail([approveIx(attacker.publicKey)], [attacker]);
    expect(blob, blob).to.match(/InvalidPendingAuthority/);
  });

  it("rejects approve after the 48h expiry window (AuthorityChangeExpired)", async () => {
    warpClock(NOW + AUTHORITY_CHANGE_EXPIRATION + 1);
    const blob = await sendExpectFail([approveIx(proposed.publicKey)], [proposed]);
    expect(blob, blob).to.match(/AuthorityChangeExpired/);
    // Clean up: cancel the stale pending change and restore the clock.
    await send([cancelIx()]);
    warpClock(NOW);
  });

  // ===== oracle + config input guards (authority unchanged) =====

  it("rejects oracle confidence above 100 (InvalidOracleConfidence)", async () => {
    const blob = await sendExpectFail([setOracleIx(101)]);
    expect(blob, blob).to.match(/InvalidOracleConfidence/);
  });

  it("accepts oracle confidence at the 100 boundary (control)", async () => {
    await send([setOracleIx(100)]);
  });

  it("rejects a zero minimum energy in update_erc_limits (InvalidMinimumEnergy)", async () => {
    const blob = await sendExpectFail([ercLimitsIx(0, 1000, 1000)]);
    expect(blob, blob).to.match(/InvalidMinimumEnergy/);
  });

  it("rejects max <= min in update_erc_limits (InvalidMaximumEnergy)", async () => {
    const blob = await sendExpectFail([ercLimitsIx(500, 500, 1000)]);
    expect(blob, blob).to.match(/InvalidMaximumEnergy/);
  });

  it("rejects a non-positive validity period (InvalidValidityPeriod)", async () => {
    const blob = await sendExpectFail([ercLimitsIx(100, 1000, 0)]);
    expect(blob, blob).to.match(/InvalidValidityPeriod/);
  });

  it("accepts valid erc limits (control)", async () => {
    await send([ercLimitsIx(50, 2_000_000, 31_536_000)]);
  });

  it("rejects contact info longer than 128 bytes (ContactInfoTooLong)", async () => {
    const blob = await sendExpectFail([authorityInfoIx("x".repeat(129))]);
    expect(blob, blob).to.match(/ContactInfoTooLong/);
  });

  // ===== full transfer happy path (mutates authority — keep LAST) =====

  it("completes a propose -> approve transfer and moves the authority", async () => {
    expect(readAuthority()).to.equal(payer.publicKey.toBase58());
    await send([proposeIx(proposed.publicKey)]);
    await send([approveIx(proposed.publicKey)], [proposed]);
    expect(readAuthority()).to.equal(proposed.publicKey.toBase58());

    // The old authority can no longer act (has_one now points at `proposed`).
    const blob = await sendExpectFail([cancelIx()]);
    expect(blob, blob).to.match(/(NoAuthorityChangePending|UnauthorizedAuthority)/);
  });
});
