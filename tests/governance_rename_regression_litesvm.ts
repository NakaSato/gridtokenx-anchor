// Regression lock for the PoAConfig -> GovernanceConfig rename (commit ae35805).
//
// The rename touched the account struct (PoAConfig -> GovernanceConfig), the
// instruction/event names (initialize_poa -> initialize_governance, the *_poa_config
// mutator -> update_governance_config, the PoA* events -> Governance*), and rippled
// through scripts/tests/docs. The ONE thing that must NOT change is the on-chain PDA
// address: the seed stays b"poa_config" (programs/governance/src/contexts.rs, 15x) so
// existing accounts need no migration. This suite locks both halves:
//
//   1. Artifact invariants (IDL) -- renamed names present, old names gone, and the only
//      surviving "PoA" string is the AggregatorEntry doc comment (the consensus concept).
//   2. Runtime invariants (litesvm) -- initialize_governance creates a GovernanceConfig
//      account at the b"poa_config" PDA (NOT a hypothetical b"governance_config" PDA),
//      and the renamed mutator / stats view operate on it end-to-end.
//
// These paths touch only the single ["poa_config"] PDA -- no tokens, no CPI -- so they
// run fully in-process. Mirrors the harness in governance_authority_guards_litesvm.ts.

import { LiteSVM, FailedTransactionMetadata } from "litesvm";
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
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const governanceIdl = require("../target/idl/governance.json");

// The preserved seed -- the address-stability invariant of the whole rename.
const CONFIG_SEED = "poa_config";

describe("governance PoAConfig -> GovernanceConfig rename (litesvm)", () => {
  let svm: LiteSVM;
  let governance: Program<Governance>;
  let governanceId: PublicKey;
  let governanceConfig: PublicKey;

  const payer = Keypair.generate(); // PoA authority + fee payer

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

  function readConfig() {
    const acct = svm.getAccount(governanceConfig);
    if (!acct) throw new Error(CONFIG_SEED + " account missing");
    return {
      owner: new PublicKey(acct.owner),
      decoded: governance.coder.accounts.decode("governanceConfig", Buffer.from(acct.data)),
    };
  }

  before(async () => {
    svm = new LiteSVM().withDefaultPrograms();
    governance = new Program(governanceIdl, { connection: {}, publicKey: PublicKey.default } as any);
    governanceId = governance.programId;
    svm.addProgramFromFile(governanceId, "target/deploy/governance.so");
    svm.airdrop(payer.publicKey, BigInt(1_000_000_000_000));

    governanceConfig = PublicKey.findProgramAddressSync([Buffer.from(CONFIG_SEED)], governanceId)[0];

    await send([await governance.methods.initializeGovernance()
      .accounts({
        governanceConfig,
        authority: payer.publicKey,
        systemProgram: SystemProgram.programId,
      } as any).instruction()]);
  });

  // ===== 1. Artifact invariants: the rename landed in the IDL =====

  it("IDL exposes the renamed instructions, not the old PoA names", () => {
    const ins = governanceIdl.instructions.map((i: any) => i.name);
    expect(ins).to.include.members([
      "initialize_governance",
      "update_governance_config",
      "get_governance_stats",
    ]);
    expect(ins).to.not.include.members(["initialize_poa", "update_poa_config", "get_poa_stats"]);
  });

  it("IDL exposes the GovernanceConfig account, not PoAConfig", () => {
    const accts = governanceIdl.accounts.map((a: any) => a.name);
    expect(accts).to.include("GovernanceConfig");
    expect(accts).to.not.include("PoAConfig");
  });

  it("IDL renamed the config/init/stats event types", () => {
    const types = governanceIdl.types.map((t: any) => t.name);
    expect(types).to.include.members([
      "GovernanceConfig",
      "GovernanceConfigUpdated",
      "GovernanceInitialized",
      "GovernanceStats",
    ]);
    expect(types.some((t: string) => /^PoA/.test(t)), "no PoA* type names").to.be.false;
  });

  it("the only surviving 'PoA' string is the AggregatorEntry doc comment", () => {
    // PoA = Proof-of-Authority, the consensus concept -- legitimately documented on the
    // aggregator allow-list entry. Any OTHER poa/PoA occurrence would be a missed rename.
    const stripDocs = (obj: any): any =>
      JSON.parse(JSON.stringify(obj, (k, v) => (k === "docs" ? undefined : v)));
    const nameSpace = JSON.stringify(stripDocs(governanceIdl));
    expect(/poa/i.test(nameSpace), "no poa/PoA in any name/seed-name").to.be.false;
  });

  // ===== 2. Runtime invariants: rename works end-to-end on the preserved PDA =====

  it("initialize_governance created the account at the b\"poa_config\" PDA", () => {
    const { owner } = readConfig();
    expect(owner.toBase58()).to.equal(governanceId.toBase58());
  });

  it("the account is NOT at a b\"governance_config\" PDA (no address drift / no migration)", () => {
    const wouldBeNewSeed = PublicKey.findProgramAddressSync(
      [Buffer.from("governance_config")],
      governanceId,
    )[0];
    expect(governanceConfig.toBase58()).to.not.equal(wouldBeNewSeed.toBase58());
    // Nothing lives at the hypothetical renamed-seed address.
    expect(svm.getAccount(wouldBeNewSeed), "no account at governance_config seed").to.be.null;
  });

  it("the account decodes as governanceConfig with the initializing authority", () => {
    const { decoded } = readConfig();
    expect((decoded.authority as PublicKey).toBase58()).to.equal(payer.publicKey.toBase58());
  });

  it("update_governance_config (renamed mutator) persists to the GovernanceConfig account", async () => {
    // Flip both flags off, then on -- prove the renamed instruction writes the renamed struct.
    await send([await governance.methods.updateGovernanceConfig(false, false)
      .accounts({ governanceConfig, authority: payer.publicKey } as any).instruction()]);
    let { decoded } = readConfig();
    expect(decoded.ercValidationEnabled).to.equal(false);
    expect(decoded.allowCertificateTransfers).to.equal(false);

    await send([await governance.methods.updateGovernanceConfig(true, true)
      .accounts({ governanceConfig, authority: payer.publicKey } as any).instruction()]);
    ({ decoded } = readConfig());
    expect(decoded.ercValidationEnabled).to.equal(true);
    expect(decoded.allowCertificateTransfers).to.equal(true);
  });

  it("get_governance_stats (renamed view) executes against the account", async () => {
    await send([await governance.methods.getGovernanceStats()
      .accounts({ governanceConfig } as any).instruction()]);
  });
});
