// Litesvm coverage for the on-chain batch-builder: add_order_to_batch, execute_batch,
// cancel_batch (all previously untested).
//
// IMPORTANT FINDING: market.batch_config.enabled is set to 0 in initialize_market and NO
// instruction ever sets it to 1 (no configure/enable-batch instruction exists). So in
// production add_order_to_batch ALWAYS fails BatchProcessingDisabled → has_current_batch
// never flips to 1 → execute_batch / cancel_batch always hit EmptyBatch. The batch-builder
// path is effectively dead. This suite:
//   (1) locks the reachable production guards (BatchProcessingDisabled / EmptyBatch / Maintenance)
//   (2) FABRICATES an enabled Market (decode → set enabled=1 → re-encode → setAccount) to also
//       cover the otherwise-unreachable control logic, so a future enable-batch instruction has
//       a regression net.

import { LiteSVM, FailedTransactionMetadata } from "litesvm";
import { Program } from "@anchor-lang/core";
import { Trading } from "../target/types/trading";
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
const tradingIdl = require("../target/idl/trading.json");
const governanceIdl = require("../target/idl/governance.json");

const ZONE = 0;
const BUY = 0;

describe("trading batch-builder (litesvm)", () => {
  let svm: LiteSVM;
  let trading: Program<Trading>;
  let governance: Program<Governance>;
  let tradingId: PublicKey;
  let governanceId: PublicKey;

  const payer = Keypair.generate();
  let marketPda: PublicKey;
  let zoneMarketPda: PublicKey;

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

  const orderPda = (orderId: number) =>
    PublicKey.findProgramAddressSync([Buffer.from("order"), payer.publicKey.toBuffer(), new BN(orderId).toArrayLike(Buffer, "le", 8)], tradingId)[0];

  function market() {
    const a = svm.getAccount(marketPda)!;
    return trading.coder.accounts.decode("market", Buffer.from(a.data));
  }

  // Patch the single batch_config.enabled byte directly — the Anchor borsh coder's
  // 1000-byte scratch buffer overruns on Market (>1000B), so we can't re-encode the
  // whole account. Offset = 8 (disc) + 96 (authority 32 + 4×u64 32 + 2×u32 8 + u16 2 +
  // 2×u8 2 + pad 4 + 2×u64 16) = 104; batch_config.enabled is batch_config's first byte.
  function setEnabled(enabled: number) {
    const a = svm.getAccount(marketPda)!;
    const data = Buffer.from(a.data);
    data[104] = enabled;
    svm.setAccount(marketPda, { lamports: a.lamports, data, owner: tradingId, executable: false, rentEpoch: 0 } as any);
  }

  async function installConfig(maintenance: boolean): Promise<PublicKey> {
    const key = Keypair.generate().publicKey;
    const cfg = {
      authority: PublicKey.default, authorityName: Array(64).fill(0), nameLen: 0,
      contactInfo: Array(128).fill(0), contactLen: 0, version: 1, maintenanceMode: maintenance,
      ercValidationEnabled: true, minEnergyAmount: new BN(0), maxErcAmount: new BN(0),
      ercValidityPeriod: new BN(0), requireOracleValidation: false, oracleAuthority: PublicKey.default,
      minOracleConfidence: 0, allowCertificateTransfers: true, minQuorumVotes: new BN(0),
      totalErcsIssued: new BN(0), totalErcsValidated: new BN(0), totalErcsRevoked: new BN(0),
      totalEnergyCertified: new BN(0), createdAt: new BN(0), lastUpdated: new BN(0), lastErcIssuedAt: new BN(0),
      pendingAuthority: PublicKey.default, pendingAuthorityProposedAt: new BN(0), pendingAuthorityExpiresAt: new BN(0),
      reserved: Array(5).fill(0),
    };
    const data = await governance.coder.accounts.encode("governanceConfig", cfg as any);
    svm.setAccount(key, { lamports: Number(svm.minimumBalanceForRentExemption(BigInt(data.length))), data, owner: governanceId, executable: false, rentEpoch: 0 } as any);
    return key;
  }

  const limitIx = (orderId: number, amount: number, price: number, cfg: PublicKey) =>
    trading.methods.submitLimitOrder(new BN(orderId), BUY, new BN(amount), new BN(price)).accounts({
      market: marketPda, order: orderPda(orderId), authority: payer.publicKey, systemProgram: SystemProgram.programId, governanceConfig: cfg,
    } as any).instruction();

  const addIx = (orderId: number, cfg: PublicKey) =>
    trading.methods.addOrderToBatch().accounts({ market: marketPda, order: orderPda(orderId), authority: payer.publicKey, governanceConfig: cfg } as any).instruction();
  const execIx = (pairs: any[], cfg: PublicKey) =>
    trading.methods.executeBatch(pairs).accounts({ market: marketPda, authority: payer.publicKey, governanceConfig: cfg } as any).instruction();
  const cancelBatchIx = (cfg: PublicKey) =>
    trading.methods.cancelBatch().accounts({ market: marketPda, authority: payer.publicKey, governanceConfig: cfg } as any).instruction();
  const cancelOrderIx = (orderId: number, cfg: PublicKey) =>
    trading.methods.cancelOrder().accounts({ market: marketPda, zoneMarket: zoneMarketPda, order: orderPda(orderId), authority: payer.publicKey, governanceConfig: cfg } as any).instruction();

  const pair = (amount: number, price: number) => ({ buyOrder: PublicKey.default, sellOrder: PublicKey.default, amount: new BN(amount), price: new BN(price) });

  before(async () => {
    svm = new LiteSVM().withDefaultPrograms();
    trading = new Program(tradingIdl, { connection: {}, publicKey: PublicKey.default } as any);
    governance = new Program(governanceIdl, { connection: {}, publicKey: PublicKey.default } as any);
    tradingId = trading.programId; governanceId = governance.programId;
    svm.addProgramFromFile(tradingId, "target/deploy/trading.so");
    svm.addProgramFromFile(governanceId, "target/deploy/governance.so");
    svm.airdrop(payer.publicKey, BigInt(1_000_000_000_000));

    [marketPda] = PublicKey.findProgramAddressSync([Buffer.from("market")], tradingId);
    [zoneMarketPda] = PublicKey.findProgramAddressSync([Buffer.from("zone_market"), marketPda.toBuffer(), new BN(ZONE).toArrayLike(Buffer, "le", 4)], tradingId);

    send([await trading.methods.initializeMarket(16).accounts({ market: marketPda, authority: payer.publicKey, systemProgram: SystemProgram.programId } as any).instruction()]);
    send([await trading.methods.initializeZoneMarket(ZONE, 16, new BN(1_000_000)).accounts({ market: marketPda, zoneMarket: zoneMarketPda, authority: payer.publicKey, systemProgram: SystemProgram.programId } as any).instruction()]);

    const cfg = await installConfig(false);
    send([await limitIx(1, 100, 50, cfg)]); // order #1 (Active)
    send([await limitIx(2, 100, 50, cfg)]); // order #2 (to be cancelled → InactiveBuyOrder case)
  });

  // --- reachable production guards (batch disabled by default) ---

  it("add_order_to_batch is blocked while batching is disabled by default (BatchProcessingDisabled)", async () => {
    const cfg = await installConfig(false);
    const blob = sendExpectFail([await addIx(1, cfg)]);
    expect(blob, blob).to.match(/BatchProcessingDisabled/);
  });

  it("execute_batch with no open batch (EmptyBatch)", async () => {
    const cfg = await installConfig(false);
    const blob = sendExpectFail([await execIx([pair(100, 50)], cfg)]);
    expect(blob, blob).to.match(/EmptyBatch/);
  });

  it("cancel_batch with no open batch (EmptyBatch)", async () => {
    const cfg = await installConfig(false);
    const blob = sendExpectFail([await cancelBatchIx(cfg)]);
    expect(blob, blob).to.match(/EmptyBatch/);
  });

  it("add_order_to_batch honors the maintenance kill-switch (MaintenanceMode)", async () => {
    const cfg = await installConfig(true);
    const blob = sendExpectFail([await addIx(1, cfg)]);
    expect(blob, blob).to.match(/MaintenanceMode/);
  });

  // --- control path via fabricated enabled Market ---

  it("add_order_to_batch opens a batch and enqueues an active order (control, fabricated-enabled)", async () => {
    setEnabled(1);
    const cfg = await installConfig(false);
    send([await addIx(1, cfg)]);
    const m = market();
    expect(m.hasCurrentBatch).to.equal(1);
    expect(m.currentBatch.orderCount).to.equal(1);
  });

  it("add_order_to_batch rejects a non-active order (InactiveBuyOrder)", async () => {
    const cfg = await installConfig(false);
    send([await cancelOrderIx(2, cfg)]); // order #2 → Cancelled
    const blob = sendExpectFail([await addIx(2, cfg)]);
    expect(blob, blob).to.match(/InactiveBuyOrder/);
  });

  it("execute_batch rejects a match_pairs length != batched order_count (BatchSizeExceeded)", async () => {
    const cfg = await installConfig(false);
    // batch currently holds 1 order; pass 0 pairs.
    const blob = sendExpectFail([await execIx([], cfg)]);
    expect(blob, blob).to.match(/BatchSizeExceeded/);
  });

  it("execute_batch settles the batch and bumps market stats (control)", async () => {
    const cfg = await installConfig(false);
    const before = market();
    send([await execIx([pair(100, 50)], cfg)]); // len 1 == order_count 1
    const m = market();
    expect(m.hasCurrentBatch).to.equal(0);
    expect(m.totalTrades).to.equal(before.totalTrades + 1);
    expect(m.totalVolume.toNumber()).to.equal(before.totalVolume.toNumber() + 100);
    expect(m.lastClearingPrice.toNumber()).to.equal(50);
  });

  it("cancel_batch clears an open batch (control)", async () => {
    const cfg = await installConfig(false);
    send([await addIx(1, cfg)]);              // re-open a batch
    expect(market().hasCurrentBatch).to.equal(1);
    send([await cancelBatchIx(cfg)]);
    expect(market().hasCurrentBatch).to.equal(0);
  });
});
