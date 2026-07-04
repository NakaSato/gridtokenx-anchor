// Regression lock for the PoAConfig -> GovernanceConfig type rename (commit ae35805)
// AND the later poa_config -> governance_config PDA seed migration (2026-07-04).
//
// The type rename (ae35805) touched the account struct (PoAConfig -> GovernanceConfig),
// the instruction/event names (initialize_poa -> initialize_governance, the
// *_poa_config mutator -> update_governance_config, the PoA* events -> Governance*),
// and rippled through scripts/tests/docs, while DELIBERATELY keeping the PDA seed at
// b"poa_config" (no migration needed for the then-live localnet state).
//
// The later seed migration (this commit) completes the rename: the seed itself moved
// to b"governance_config", since the platform was still pre-mainnet/localnet-only and
// this was the cheap window to fix the poa_config/GovernanceConfig naming mismatch
// permanently. Existing poa_config-seeded accounts on any already-running validator are
// orphaned by this change and must be re-initialized at the new address — that's an
// accepted one-time cost of doing this before real deployment, not after.
//
// This suite locks:
//   1. Artifact invariants (IDL) -- renamed names present, old names gone (unaffected by
//      the seed migration -- struct/instruction names didn't change again here).
//   2. Runtime invariants (litesvm) -- initialize_governance creates a GovernanceConfig
//      account at the b"governance_config" PDA, NOT the old b"poa_config" PDA, and the
//      renamed mutator / stats view operate on it end-to-end.

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

// The current seed, post-migration -- the address-stability invariant going forward.
const CONFIG_SEED = "governance_config";
// The old seed, pre-migration -- must now be dead (no account lives there).
const OLD_CONFIG_SEED = "poa_config";

describe("governance PoAConfig -> GovernanceConfig rename + seed migration (litesvm)", () => {
  let svm: LiteSVM;
  let governance: Program<Governance>;
  let governanceId: PublicKey;
  let governanceConfig: PublicKey;

  const payer = Keypair.generate(); // governance authority + fee payer

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

  // ===== 1. Artifact invariants: the type rename landed in the IDL (unaffected by the
  //          later seed migration -- struct/instruction names didn't change again). =====

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

  it("no 'poa' string survives anywhere in the IDL (seed migration is complete)", () => {
    // PoA = Proof-of-Authority, the consensus concept -- previously legitimately
    // documented on the AggregatorEntry allow-list entry AND load-bearing in the
    // poa_config seed literal. The seed migration removed the last such use, so this
    // is now a hard zero rather than a single-survivor allowlist.
    const stripDocs = (obj: any): any =>
      JSON.parse(JSON.stringify(obj, (k, v) => (k === "docs" ? undefined : v)));
    const nameSpace = JSON.stringify(stripDocs(governanceIdl));
    expect(/poa/i.test(nameSpace), "no poa/PoA in any name/seed-name").to.be.false;
  });

  // ===== 2. Runtime invariants: the seed migration moved the account, and nothing is
  //          left behind at the old address. =====

  it("initialize_governance created the account at the NEW b\"governance_config\" PDA", () => {
    const { owner } = readConfig();
    expect(owner.toBase58()).to.equal(governanceId.toBase58());
  });

  it("nothing lives at the OLD b\"poa_config\" PDA (clean migration, no stale account)", () => {
    const oldSeedPda = PublicKey.findProgramAddressSync(
      [Buffer.from(OLD_CONFIG_SEED)],
      governanceId,
    )[0];
    expect(governanceConfig.toBase58()).to.not.equal(oldSeedPda.toBase58());
    expect(svm.getAccount(oldSeedPda), "no account at the old poa_config seed").to.be.null;
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
