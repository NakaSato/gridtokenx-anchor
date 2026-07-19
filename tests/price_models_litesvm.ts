// Litesvm comparative economics of THREE trading price models, driven against
// the deployed trading binary on ONE shared order book:
//
//   1) Continuous double auction (CDA)  — match_orders, each fill priced at the
//      seller's ask p* = p_s (lib.rs:429/462). Discriminatory pricing.
//   2) Uniform-price auction            — clear_auction, one clearing price at
//      the max-crossing volume applied to every fill (lib.rs:893, find_clearing_
//      point:1842). Marginal-seller pricing.
//   3) Single-rate buyback @ 2.20 THB/kWh — a guaranteed utility feed-in tariff.
//      No on-chain primitive exists; production models it as settle_offchain_match
//      at a fixed match_price (the off-chain path enforces only the signed bid-ask
//      spread, not the market band — PRICE-MODEL.md §1). Here it is the analytic
//      baseline: the utility buys ALL prosumer surplus at the flat rate.
//
// The comparison answers: which model pays prosumers most on the same book?
// Setup mirrors tests/pricing_model_litesvm.ts (fabricated GovernanceConfig +
// ErcCertificate, market/zone bootstrap, band byte-patch at data offsets 88/96).

import { LiteSVM, Clock, FailedTransactionMetadata } from "litesvm";
import { Program } from "@anchor-lang/core";
import { Trading } from "../target/types/trading";
import { Governance } from "../target/types/governance";
import { expect } from "chai";
import { PublicKey, Keypair, Transaction, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const tradingIdl = require("../target/idl/trading.json");
const governanceIdl = require("../target/idl/governance.json");

const ZONE = 0;
const NOW = 1_000_000;
const FUTURE = 9_000_000;

// Wide band so every model price fits (2.00–5.00 THBC/kWh, 6-dec).
const P_MIN = 2_000_000;
const P_MAX = 5_000_000;

// Shared order book (6-dec THBC/kWh, amount in kWh). Equal 100-kWh lots so the
// three mechanisms pair cleanly and the arithmetic is auditable by hand. 4+4
// orders keeps clear_auction's whole legacy tx under the 1232-byte wire limit
// (each AuctionOrder = 89 B). All four pairs cross, so every model moves the
// SAME 400 kWh — they differ only on PRICE.
const SELLS = [ // prosumer asks, ascending
  { id: 1, amt: 100, price: 3_000_000 },
  { id: 2, amt: 100, price: 3_100_000 },
  { id: 3, amt: 100, price: 3_200_000 },
  { id: 4, amt: 100, price: 3_300_000 },
];
const BUYS = [ // consumer bids, descending
  { id: 11, amt: 100, price: 3_800_000 },
  { id: 12, amt: 100, price: 3_700_000 },
  { id: 13, amt: 100, price: 3_600_000 },
  { id: 14, amt: 100, price: 3_500_000 },
];
// CDA pairing: best bid vs best ask; a pair trades iff bid >= ask. All cross.
const CDA_PAIRS = [
  { buy: 11, sell: 1 }, // 3.80 >= 3.00 ✓ @3.00
  { buy: 12, sell: 2 }, // 3.70 >= 3.10 ✓ @3.10
  { buy: 13, sell: 3 }, // 3.60 >= 3.20 ✓ @3.20
  { buy: 14, sell: 4 }, // 3.50 >= 3.30 ✓ @3.30
];

const BUYBACK_RATE = 2_200_000; // 2.20 THB/kWh guaranteed utility feed-in

// Shared fee schedule (same deductions applied to all three → ranking is
// fee-invariant; the paper's test tariff, PRICE-MODEL.md §1 / report.typ §3.3).
const FEE_BPS = 25;              // market fee, basis points of gross
const LOSS_BPS = 5;             // line-loss, basis points of gross
const WHEEL_PER_KWH = 100_000;  // flat wheeling, 0.10 THB/kWh (6-dec)

function net(grossValue: number, kwh: number) {
  const fee = Math.floor((grossValue * FEE_BPS) / 10_000);
  const loss = Math.floor((grossValue * LOSS_BPS) / 10_000);
  const wheel = WHEEL_PER_KWH * kwh;
  return grossValue - fee - loss - wheel;
}

describe("price models (litesvm) — comparative prosumer economics on one book", () => {
  let svm: LiteSVM;
  let trading: Program<Trading>;
  let governance: Program<Governance>;
  let tradingId: PublicKey;
  let governanceId: PublicKey;

  const payer = Keypair.generate();
  let marketPda: PublicKey, zoneMarketPda: PublicKey;
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
  const matchIx = async (buyId: number, sellId: number, amt: number) => {
    const buy = orderPda(buyId), sell = orderPda(sellId);
    const tradeRecord = PublicKey.findProgramAddressSync(
      [Buffer.from("trade"), buy.toBuffer(), sell.toBuffer()], tradingId)[0];
    const ix = await trading.methods.matchOrders(new BN(amt)).accounts({
      market: marketPda, zoneMarket: zoneMarketPda, buyOrder: buy, sellOrder: sell, tradeRecord,
      authority: payer.publicKey, governanceConfig: cfg, systemProgram: SystemProgram.programId,
    } as any).instruction();
    return { ix, tradeRecord };
  };

  const decodeZoneMarket = () =>
    trading.coder.accounts.decode("zoneMarket", Buffer.from(svm.getAccount(zoneMarketPda)!.data));
  const decodeTrade = (tr: PublicKey) =>
    trading.coder.accounts.decode("tradeRecord", Buffer.from(svm.getAccount(tr)!.data));

  function patchBand(min: number, max: number) {
    const acc = svm.getAccount(marketPda)!;
    const data = Buffer.from(acc.data);
    data.writeBigUInt64LE(BigInt(min), 88);
    data.writeBigUInt64LE(BigInt(max), 96);
    svm.setAccount(marketPda, { ...acc, data } as any);
    // Guard the blind byte-poke: decode through the IDL and require the patch
    // to have landed in min/max_price. A Market layout shift would otherwise
    // corrupt an unrelated field silently while the tests kept passing.
    const m = trading.coder.accounts.decode(
      "market", Buffer.from(svm.getAccount(marketPda)!.data));
    expect(m.minPricePerKwh.toNumber(), "patchBand offset drift (min_price_per_kwh)").to.eq(min);
    expect(m.maxPricePerKwh.toNumber(), "patchBand offset drift (max_price_per_kwh)").to.eq(max);
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

    svm.setClock(new Clock(svm.getClock().slot, 0n, 0n, 0n, BigInt(NOW)));
    cfg = await installConfig();
    erc = await installErc(1_000_000);

    send([await trading.methods.initializeMarket(16).accounts({
      market: marketPda, authority: payer.publicKey, systemProgram: SystemProgram.programId,
    } as any).instruction()]);
    send([await trading.methods.initializeZoneMarket(ZONE, 16, new BN(1_000_000_000), 0).accounts({
      market: marketPda, zoneMarket: zoneMarketPda, authority: payer.publicKey, systemProgram: SystemProgram.programId,
    } as any).instruction()]);
    patchBand(P_MIN, P_MAX);
  });

  const results: Record<string, { gross: number; net: number; volume: number; note: string }> = {};

  // ── Model 1: Continuous double auction (match_orders, price = seller ask) ────
  it("CDA: each fill executes at its own seller ask (discriminatory pricing)", async () => {
    for (const s of SELLS) send([await sellIx(s.id, s.amt, s.price)]);
    for (const b of BUYS) send([await buyIx(b.id, b.amt, b.price)]);

    let gross = 0, volume = 0;
    for (const p of CDA_PAIRS) {
      const sell = SELLS.find((s) => s.id === p.sell)!;
      const buy = BUYS.find((b) => b.id === p.buy)!;
      if (buy.price < sell.price) continue; // non-crossing: no trade
      const { ix, tradeRecord } = await matchIx(p.buy, p.sell, sell.amt);
      send([ix]);
      const tr = decodeTrade(tradeRecord);
      expect(tr.pricePerKwh.toNumber(), `pair buy${p.buy}/sell${p.sell}`).to.eq(sell.price); // p* = p_s
      expect(tr.amount.toNumber()).to.eq(sell.amt);
      gross += tr.amount.toNumber() * tr.pricePerKwh.toNumber();
      volume += tr.amount.toNumber();
    }
    // 4 crossing pairs, each priced at its own seller ask.
    expect(volume).to.eq(400);
    expect(gross).to.eq(100 * (3_000_000 + 3_100_000 + 3_200_000 + 3_300_000)); // 1,260,000,000
    results["CDA"] = { gross, net: net(gross, volume), volume, note: "per-fill seller ask (3.00–3.30)" };
  });

  // ── Model 2: Uniform-price auction (clear_auction, one clearing price) ───────
  it("uniform auction: one clearing price at the max-crossing volume", async () => {
    const auctionOrder = (o: { price: number; amt: number }, isBuy: boolean) => ({
      orderKey: Keypair.generate().publicKey, pricePerKwh: new BN(o.price),
      amount: new BN(o.amt), filledAmount: new BN(0), user: payer.publicKey, isBuy,
    });
    const sells = SELLS.map((s) => auctionOrder(s, false));
    const buys = BUYS.map((b) => auctionOrder(b, true));

    const before = decodeZoneMarket().totalVolume.toNumber();
    const meta = send([await trading.methods.clearAuction(sells as any, buys as any).accounts({
      market: marketPda, zoneMarket: zoneMarketPda, authority: payer.publicKey,
      feeCollector: Keypair.generate().publicKey, tokenProgram: TOKEN_PROGRAM_ID, governanceConfig: cfg,
    } as any).instruction()]);
    const cu = Number(meta!.computeUnitsConsumed());
    console.log(`\n  [CU] clear_auction (4 sells × 4 buys, all cross) = ${cu.toLocaleString()} CU  (budget 200k default / 1.4M max)`);

    const zm = decodeZoneMarket();
    const clearing = zm.lastClearingPrice.toNumber();
    const volume = zm.totalVolume.toNumber() - before;
    expect(clearing).to.eq(3_300_000);  // marginal seller price at max crossing
    expect(volume).to.eq(400);          // 4 sells ≤3.30 vs 4 buys ≥3.30
    const gross = clearing * volume;
    expect(gross).to.eq(1_320_000_000);
    results["Uniform"] = { gross, net: net(gross, volume), volume, note: "single clearing 3.30 for all" };
  });

  // ── Model 3: Single-rate buyback @ 2.20 (guaranteed utility feed-in) ─────────
  it("buyback @2.20: utility takes ALL surplus at the flat guaranteed rate", async () => {
    // No on-chain primitive: production drives settle_offchain_match at a fixed
    // match_price (spread-only enforcement lets 2.20 settle even below the market
    // band). Economic outcome is exact and needs no discovery: every kWh @ 2.20.
    const volume = SELLS.reduce((a, s) => a + s.amt, 0); // all 400 kWh offtaken
    const gross = volume * BUYBACK_RATE;
    expect(gross).to.eq(400 * 2_200_000); // 880,000,000
    results["Buyback"] = { gross, net: net(gross, volume), volume, note: "flat 2.20/kWh, all surplus" };
  });

  // ── Comparison: which model pays prosumers most? ─────────────────────────────
  it("comparison: uniform > CDA > buyback (P2P discovery beats utility feed-in)", () => {
    const fmt = (n: number) => (n / 1e6).toFixed(2);
    console.log("\n  price-model comparison (same 400 kWh cleared, price differs):");
    console.log("  ┌───────────┬──────────┬────────────┬────────────┬──────────────────────────────┐");
    console.log("  │ model     │ vol kWh  │ gross THB  │ net THB    │ pricing                      │");
    console.log("  ├───────────┼──────────┼────────────┼────────────┼──────────────────────────────┤");
    for (const k of ["Uniform", "CDA", "Buyback"]) {
      const r = results[k];
      console.log(
        `  │ ${k.padEnd(9)} │ ${String(r.volume).padStart(8)} │ ${fmt(r.gross).padStart(10)} │ ${fmt(r.net).padStart(10)} │ ${r.note.padEnd(28)} │`
      );
    }
    console.log("  └───────────┴──────────┴────────────┴────────────┴──────────────────────────────┘");
    const avg = (k: string) => results[k].gross / results[k].volume / 1e6;
    console.log(`  avg THB/kWh to prosumers — uniform ${avg("Uniform").toFixed(3)}, CDA ${avg("CDA").toFixed(3)}, buyback ${avg("Buyback").toFixed(3)}`);

    expect(results["Uniform"].gross).to.be.greaterThan(results["CDA"].gross);
    expect(results["CDA"].gross).to.be.greaterThan(results["Buyback"].gross);
    // Buyback pays a flat rate strictly below the cleared market price.
    expect(avg("Buyback")).to.eq(2.2);
    expect(avg("Uniform")).to.eq(3.3);
  });
});
