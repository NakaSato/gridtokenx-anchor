// Litesvm coverage for `sharded_match_orders` (the throughput CDA path, which
// writes only the per-shard `ZoneMarketShard` PDA and keeps market/zone_market
// read-only — Sealevel parallelism, SKILL.md invariant #3).
//
// Locks in the two parity fixes vs `match_orders`:
//   1) `match_amount == 0` is rejected (`InvalidAmount`) — a no-op call must not
//      init a zero-trade TradeRecord, bump shard trade_count, or flip an Active
//      order to PartiallyFilled.
//   2) TradeRecord is fully populated: seller, buyer, total_value (raw
//      amount·price discovery scale — events.rs::OrderMatched dual-scale
//      contract), fee_amount — previously left zeroed from load_init.
//
// Setup mirrors tests/price_models_litesvm.ts (fabricated GovernanceConfig +
// ErcCertificate, market/zone bootstrap, band byte-patch at data offsets 88/96).

import { LiteSVM, Clock, FailedTransactionMetadata } from "litesvm";
import { Program } from "@anchor-lang/core";
import { Trading } from "../target/types/trading";
import { Governance } from "../target/types/governance";
import { expect } from "chai";
import { PublicKey, Keypair, Transaction, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const tradingIdl = require("../target/idl/trading.json");
const governanceIdl = require("../target/idl/governance.json");

const ZONE = 0;
const SHARD_ID = 0;
const NOW = 1_000_000;
const FUTURE = 9_000_000;

// Wide band so the test prices fit (2.00–5.00 THBG/kWh, 6-dec).
const P_MIN = 2_000_000;
const P_MAX = 5_000_000;

const SELL = { id: 1, amt: 100, price: 3_000_000 };
const BUY = { id: 11, amt: 100, price: 3_500_000 };

describe("sharded_match_orders (litesvm) — shard-lock CDA parity with match_orders", () => {
  let svm: LiteSVM;
  let trading: Program<Trading>;
  let governance: Program<Governance>;
  let tradingId: PublicKey;
  let governanceId: PublicKey;

  const payer = Keypair.generate();
  let marketPda: PublicKey, zoneMarketPda: PublicKey, zoneShardPda: PublicKey;
  let cfg: PublicKey, erc: PublicKey;

  function sendRaw(ixs: TransactionInstruction[], signers: Keypair[] = []) {
    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = payer.publicKey;
    ixs.forEach((ix) => tx.add(ix));
    tx.sign(payer, ...signers);
    const res = svm.sendTransaction(tx);
    svm.expireBlockhash();
    return res;
  }
  function send(ixs: TransactionInstruction[], signers: Keypair[] = []) {
    const r = sendRaw(ixs, signers);
    if (r instanceof FailedTransactionMetadata)
      throw new Error("tx failed: " + r.err().toString() + "\n" + r.meta().logs().join("\n"));
    return r; // TransactionMetadata on success — carries computeUnitsConsumed()
  }

  const orderPda = (id: number) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("order"), payer.publicKey.toBuffer(), new BN(id).toArrayLike(Buffer, "le", 8)],
      tradingId
    )[0];

  const sellIx = (id: number, amt: number, price: number) =>
    trading.methods.createSellOrder(new BN(id), new BN(amt), new BN(price)).accounts({
      market: marketPda, zoneMarket: zoneMarketPda, order: orderPda(id), ercCertificate: erc,
      authority: payer.publicKey, systemProgram: SystemProgram.programId, governanceConfig: cfg,
    } as any).instruction();
  const buyIx = (id: number, amt: number, maxPrice: number) =>
    trading.methods.createBuyOrder(new BN(id), new BN(amt), new BN(maxPrice)).accounts({
      market: marketPda, zoneMarket: zoneMarketPda, order: orderPda(id),
      authority: payer.publicKey, systemProgram: SystemProgram.programId, governanceConfig: cfg,
    } as any).instruction();

  const shardedMatchIx = async (buyId: number, sellId: number, amt: number) => {
    const buy = orderPda(buyId), sell = orderPda(sellId);
    const tradeRecord = PublicKey.findProgramAddressSync(
      [Buffer.from("trade"), buy.toBuffer(), sell.toBuffer()], tradingId)[0];
    const ix = await trading.methods.shardedMatchOrders(new BN(amt), SHARD_ID).accounts({
      market: marketPda, zoneMarket: zoneMarketPda, zoneShard: zoneShardPda,
      buyOrder: buy, sellOrder: sell, tradeRecord,
      authority: payer.publicKey, systemProgram: SystemProgram.programId, governanceConfig: cfg,
    } as any).instruction();
    return { ix, tradeRecord };
  };

  const decodeShard = () =>
    trading.coder.accounts.decode("zoneMarketShard", Buffer.from(svm.getAccount(zoneShardPda)!.data));
  const decodeOrder = (id: number) =>
    trading.coder.accounts.decode("order", Buffer.from(svm.getAccount(orderPda(id))!.data));
  const decodeTrade = (tr: PublicKey) =>
    trading.coder.accounts.decode("tradeRecord", Buffer.from(svm.getAccount(tr)!.data));

  function patchBand(min: number, max: number) {
    const acc = svm.getAccount(marketPda)!;
    const data = Buffer.from(acc.data);
    data.writeBigUInt64LE(BigInt(min), 88);
    data.writeBigUInt64LE(BigInt(max), 96);
    svm.setAccount(marketPda, { ...acc, data } as any);
  }

  async function installConfig(): Promise<PublicKey> {
    const key = Keypair.generate().publicKey;
    const c = {
      authority: PublicKey.default, authorityName: Array(64).fill(0), nameLen: 0,
      contactInfo: Array(128).fill(0), contactLen: 0, version: 1, maintenanceMode: false,
      ercValidationEnabled: true, minEnergyAmount: new BN(0), maxErcAmount: new BN(0),
      ercValidityPeriod: new BN(0), requireOracleValidation: false, oracleAuthority: PublicKey.default,
      minOracleConfidence: 0, allowCertificateTransfers: true, minQuorumVotes: new BN(0),
      totalErcsIssued: new BN(0), totalErcsValidated: new BN(0), totalErcsRevoked: new BN(0),
      totalEnergyCertified: new BN(0), createdAt: new BN(0), lastUpdated: new BN(0),
      lastErcIssuedAt: new BN(0), pendingAuthority: PublicKey.default,
      pendingAuthorityProposedAt: new BN(0), pendingAuthorityExpiresAt: new BN(0), reserved: Array(5).fill(0),
    };
    const data = await governance.coder.accounts.encode("governanceConfig", c as any);
    svm.setAccount(key, {
      lamports: Number(svm.minimumBalanceForRentExemption(BigInt(data.length))),
      data, owner: governanceId, executable: false, rentEpoch: 0,
    } as any);
    return key;
  }

  async function installErc(energyAmount: number): Promise<PublicKey> {
    const key = Keypair.generate().publicKey;
    const e = {
      certificateId: Array(64).fill(0), idLen: 0, authority: payer.publicKey, owner: payer.publicKey,
      energyAmount: new BN(energyAmount), renewableSource: Array(64).fill(0), sourceLen: 0,
      validationData: Array(256).fill(0), dataLen: 0, issuedAt: new BN(0), expiresAt: new BN(FUTURE),
      status: { valid: {} }, validatedForTrading: true, tradingValidatedAt: null,
      revocationReason: Array(128).fill(0), reasonLen: 0, revokedAt: null, transferCount: 0, lastTransferredAt: null,
    };
    const data = await governance.coder.accounts.encode("ercCertificate", e as any);
    svm.setAccount(key, {
      lamports: Number(svm.minimumBalanceForRentExemption(BigInt(data.length))),
      data, owner: governanceId, executable: false, rentEpoch: 0,
    } as any);
    return key;
  }

  before(async () => {
    svm = new LiteSVM().withDefaultPrograms();
    trading = new Program(tradingIdl, { connection: {}, publicKey: PublicKey.default } as any);
    governance = new Program(governanceIdl, { connection: {}, publicKey: PublicKey.default } as any);
    tradingId = trading.programId;
    governanceId = governance.programId;
    svm.addProgramFromFile(tradingId, "target/deploy/trading.so");
    svm.addProgramFromFile(governanceId, "target/deploy/governance.so");
    svm.airdrop(payer.publicKey, BigInt(1_000_000_000_000));

    [marketPda] = PublicKey.findProgramAddressSync([Buffer.from("market")], tradingId);
    [zoneMarketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("zone_market"), marketPda.toBuffer(), new BN(ZONE).toArrayLike(Buffer, "le", 4)], tradingId);
    [zoneShardPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("zone_shard"), zoneMarketPda.toBuffer(), Buffer.from([SHARD_ID])], tradingId);

    svm.setClock(new Clock(svm.getClock().slot, 0n, 0n, 0n, BigInt(NOW)));
    cfg = await installConfig();
    erc = await installErc(1_000_000);

    send([await trading.methods.initializeMarket(16).accounts({
      market: marketPda, authority: payer.publicKey, systemProgram: SystemProgram.programId,
    } as any).instruction()]);
    send([await trading.methods.initializeZoneMarket(ZONE, 16, new BN(1_000_000_000), 0).accounts({
      market: marketPda, zoneMarket: zoneMarketPda, authority: payer.publicKey, systemProgram: SystemProgram.programId,
    } as any).instruction()]);
    send([await trading.methods.initializeZoneMarketShard(SHARD_ID).accounts({
      zoneMarket: zoneMarketPda, zoneShard: zoneShardPda,
      payer: payer.publicKey, systemProgram: SystemProgram.programId,
    } as any).instruction()]);
    patchBand(P_MIN, P_MAX);

    for (const o of [SELL]) send([await sellIx(o.id, o.amt, o.price)]);
    for (const o of [BUY]) send([await buyIx(o.id, o.amt, o.price)]);
  });

  it("rejects match_amount == 0 (InvalidAmount) with NO state mutation", async () => {
    const { ix, tradeRecord } = await shardedMatchIx(BUY.id, SELL.id, 0);
    const res = sendRaw([ix]);
    expect(res instanceof FailedTransactionMetadata, "zero-amount tx must fail").to.be.true;
    const logs = (res as FailedTransactionMetadata).meta().logs().join("\n");
    expect(logs).to.include("InvalidAmount");

    // No side effects: orders still Active (status 0), no TradeRecord, shard untouched.
    expect(decodeOrder(BUY.id).status).to.eq(0);
    expect(decodeOrder(SELL.id).status).to.eq(0);
    expect(svm.getAccount(tradeRecord)).to.be.null;
    const shard = decodeShard();
    expect(shard.tradeCount).to.eq(0);
    expect(shard.volumeAccumulated.toNumber()).to.eq(0);
  });

  it("full match: shard bookkeeping + fully-populated TradeRecord (seller ask pricing)", async () => {
    const { ix, tradeRecord } = await shardedMatchIx(BUY.id, SELL.id, SELL.amt);
    const meta = send([ix]);
    const cu = Number(meta!.computeUnitsConsumed());
    console.log(`\n  [CU] sharded_match_orders (1 fill) = ${cu.toLocaleString()} CU`);

    const tr = decodeTrade(tradeRecord);
    // CDA price rule: p* = seller ask.
    expect(tr.pricePerKwh.toNumber()).to.eq(SELL.price);
    expect(tr.amount.toNumber()).to.eq(SELL.amt);
    // Parity fix #2: fields previously left zeroed from load_init.
    expect(tr.seller.toBase58()).to.eq(payer.publicKey.toBase58());
    expect(tr.buyer.toBase58()).to.eq(payer.publicKey.toBase58());
    expect(tr.totalValue.toNumber()).to.eq(SELL.amt * SELL.price); // raw discovery scale, NO /1e9
    expect(tr.feeAmount.toNumber()).to.eq(0);
    expect(tr.executedAt.toNumber()).to.eq(NOW);

    // Shard (not zone_market) carries the bookkeeping.
    const shard = decodeShard();
    expect(shard.volumeAccumulated.toNumber()).to.eq(SELL.amt);
    expect(shard.tradeCount).to.eq(1);
    expect(shard.lastClearingPrice.toNumber()).to.eq(SELL.price);

    // Both orders fully filled → Completed (status 2).
    expect(decodeOrder(BUY.id).status).to.eq(2);
    expect(decodeOrder(SELL.id).status).to.eq(2);
  });
});
