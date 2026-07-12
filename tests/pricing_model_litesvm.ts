// Litesvm verification of the pricing model formalised in UEC-paper.typ §11.2 —
// each test asserts one numbered equation against the deployed trading binary:
//
//   eq-band   p_min <= p <= p_max        order admission band (lib.rs:226-233)
//   eq-cross  p_b >= p_s                 CDA cross condition   (lib.rs:454)
//   eq-exec   p* = p_s                   execution at seller's limit (lib.rs:462)
//   eq-vwap   VWAP = floor(Σ p_i v_i / Σ v_i)   ring-buffer VWAP (lib.rs:820-863)
//
// Market/zone bootstrap, fabricated GovernanceConfig + ErcCertificate mirror
// tests/cu_profile_trading_litesvm.ts. initialize_market hardcodes the band to
// min=1 / max=0 (cap disabled), so the band tests byte-patch Market's
// min_price_per_kwh (data offset 88) and max_price_per_kwh (offset 96) —
// 8-byte discriminator + 80-byte struct prefix per state/market.rs layout.

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
const NOW = 1_000_000;
const FUTURE = 9_000_000;

// Band installed for the tests (6-dec THBG/kWh, same domain as the paper's data)
const P_MIN = 3_000_000; // 3.00 THBG/kWh
const P_MAX = 4_000_000; // 4.00 THBG/kWh

describe("pricing model (litesvm) — UEC-paper §11.2 equations", () => {
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
  }
  function sendExpectFail(ixs: TransactionInstruction[], signers: Keypair[] = []): string {
    const r = sendRaw(ixs, signers);
    if (!(r instanceof FailedTransactionMetadata)) throw new Error("expected tx to fail but it succeeded");
    return r.err().toString() + "\n" + r.meta().logs().join("\n");
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
  const matchIx = (buyId: number, sellId: number, amt: number) => {
    const buy = orderPda(buyId), sell = orderPda(sellId);
    const tradeRecord = PublicKey.findProgramAddressSync(
      [Buffer.from("trade"), buy.toBuffer(), sell.toBuffer()], tradingId)[0];
    return trading.methods.matchOrders(new BN(amt)).accounts({
      market: marketPda, zoneMarket: zoneMarketPda, buyOrder: buy, sellOrder: sell, tradeRecord,
      authority: payer.publicKey, governanceConfig: cfg, systemProgram: SystemProgram.programId,
    } as any).instruction().then((ix) => ({ ix, tradeRecord }));
  };

  function decodeMarket() {
    return trading.coder.accounts.decode("market", Buffer.from(svm.getAccount(marketPda)!.data));
  }
  function decodeZoneMarket() {
    return trading.coder.accounts.decode("zoneMarket", Buffer.from(svm.getAccount(zoneMarketPda)!.data));
  }

  // Patch Market's price band in place (zero-copy layout, offsets incl. 8-byte discriminator)
  function patchBand(min: number, max: number) {
    const acc = svm.getAccount(marketPda)!;
    const data = Buffer.from(acc.data);
    data.writeBigUInt64LE(BigInt(min), 88); // min_price_per_kwh (8 disc + 80 struct prefix)
    data.writeBigUInt64LE(BigInt(max), 96); // max_price_per_kwh
    svm.setAccount(marketPda, { ...acc, data } as any);
    const m = decodeMarket();
    expect(m.minPricePerKwh.toNumber()).to.eq(min);
    expect(m.maxPricePerKwh.toNumber()).to.eq(max);
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
    erc = await installErc(100_000);

    send([await trading.methods.initializeMarket(16).accounts({
      market: marketPda, authority: payer.publicKey, systemProgram: SystemProgram.programId,
    } as any).instruction()]);
    send([await trading.methods.initializeZoneMarket(ZONE, 16, new BN(1_000_000_000), 0).accounts({
      market: marketPda, zoneMarket: zoneMarketPda, authority: payer.publicKey, systemProgram: SystemProgram.programId,
    } as any).instruction()]);
    patchBand(P_MIN, P_MAX);
  });

  // ── eq-band: p_min <= p <= p_max ─────────────────────────────────────────────

  it("eq-band: zero price rejected (strictly positive domain)", async () => {
    expect(sendExpectFail([await sellIx(10, 100, 0)])).to.include("InvalidPrice");
  });

  it("eq-band: sell below p_min rejected", async () => {
    expect(sendExpectFail([await sellIx(11, 100, P_MIN - 1)])).to.include("PriceBelowMinimum");
  });

  it("eq-band: sell above p_max rejected", async () => {
    expect(sendExpectFail([await sellIx(12, 100, P_MAX + 1)])).to.include("PriceAboveMaximum");
  });

  it("eq-band: buy above p_max rejected", async () => {
    expect(sendExpectFail([await buyIx(13, 100, P_MAX + 1)])).to.include("PriceAboveMaximum");
  });

  it("eq-band: boundary prices p_min and p_max admitted", async () => {
    send([await sellIx(14, 100, P_MIN)]);
    send([await buyIx(15, 100, P_MAX)]);
  });

  // ── eq-cross: match requires p_b >= p_s ──────────────────────────────────────

  it("eq-cross: non-crossing pair (p_b < p_s) rejected", async () => {
    send([await sellIx(20, 100, 3_500_000)]);
    send([await buyIx(21, 100, 3_400_000)]);
    const { ix } = await matchIx(21, 20, 100);
    expect(sendExpectFail([ix])).to.include("PriceMismatch");
  });

  // ── eq-exec: p* = p_s (seller's limit, full spread to buyer) ─────────────────

  it("eq-exec: crossing pair executes at seller's limit price", async () => {
    const P_S = 3_200_000, P_B = 3_800_000, AMT = 100;
    send([await sellIx(30, AMT, P_S)]);
    send([await buyIx(31, AMT, P_B)]);
    const { ix, tradeRecord } = await matchIx(31, 30, AMT);
    send([ix]);

    const tr = trading.coder.accounts.decode(
      "tradeRecord", Buffer.from(svm.getAccount(tradeRecord)!.data));
    expect(tr.pricePerKwh.toNumber()).to.eq(P_S);                 // p* = p_s, NOT p_b
    expect(tr.amount.toNumber()).to.eq(AMT);
    expect(tr.totalValue.toNumber()).to.eq(AMT * P_S);            // V precursor = q · p*

    const zm = decodeZoneMarket();
    expect(zm.lastClearingPrice.toNumber()).to.eq(P_S);           // lib.rs:494
  });

  it("eq-exec: partial fill also prices at p_s", async () => {
    const P_S = 3_100_000, P_B = 4_000_000, AMT = 100, FILL = 40;
    send([await sellIx(32, AMT, P_S)]);
    send([await buyIx(33, AMT, P_B)]);
    const { ix, tradeRecord } = await matchIx(33, 32, FILL);
    send([ix]);
    const tr = trading.coder.accounts.decode(
      "tradeRecord", Buffer.from(svm.getAccount(tradeRecord)!.data));
    expect(tr.pricePerKwh.toNumber()).to.eq(P_S);
    expect(tr.amount.toNumber()).to.eq(FILL);
    expect(tr.totalValue.toNumber()).to.eq(FILL * P_S);
  });

  // ── eq-vwap: VWAP = floor(Σ p_i v_i / Σ v_i) ─────────────────────────────────

  it("eq-vwap: ring-buffer VWAP matches the floored volume-weighted mean", async () => {
    const trades: Array<[number, number]> = [
      [3_200_000, 100],
      [3_600_000, 50],
      [3_000_000, 150],
    ];
    for (const [p, v] of trades) {
      send([await trading.methods.updatePriceHistory(new BN(p), new BN(v)).accounts({
        market: marketPda, authority: payer.publicKey, governanceConfig: cfg,
      } as any).instruction()]);
    }
    const sumPV = trades.reduce((a, [p, v]) => a + p * v, 0);
    const sumV = trades.reduce((a, [, v]) => a + v, 0);
    const expected = Math.floor(sumPV / sumV); // 950,000,000 / 300 = 3,166,666

    const m = decodeMarket();
    expect(m.volumeWeightedPrice.toNumber()).to.eq(expected);
    expect(m.lastClearingPrice.toNumber()).to.eq(trades[trades.length - 1][0]);
    expect(m.priceHistoryCount).to.eq(trades.length);
  });
});
