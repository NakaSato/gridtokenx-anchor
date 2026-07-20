// price-models-endog.ts — ENDOGENOUS-DEMAND price-model comparison, on-chain.
//
// The §4.7 driver (price-models-onchain.ts) pins every bid at the top ask so the
// whole book crosses — that isolates the mechanism effect but makes the per-kWh
// outcome fleet-size invariant. This variant derives the DEMAND side from each
// fleet's own consumer-consumption data (buildDemandTranches): bid quantities
// AND prices are functions of the dataset, so clearing price, cleared volume,
// and net/kWh become genuinely fleet-dependent.
//
//   uniform -> trading.clear_auction on (ask ladder × endogenous bid ladder);
//              on-chain clearing price/volume must equal the evalUniformAuction
//              prediction (faithful find_clearing_point port).
//   cda     -> one create_sell/create_buy/match_orders round per predicted fill
//              (evalCdaCross greedy sweep); each TradeRecord must land at the
//              fill's ASK price. Partial clearing is expected.
//   buyback -> flat 2.20 feed-in on the FULL surplus (the utility takes all).
//
// Env:
//   DATA_DIR   dataset dir (test-results/datasets/scale-*)          [required]
//   DAYS       horizon in days (default: full dataset horizon)
//   ZONE_ID    zone market to use; created if absent (default 4343)
//   ALPHA      demand participation share (default 0.02)
//   BAND_LO / BAND_HI   WTP band, whole THB/kWh (default 2.60 / 4.10)
//   OUT        results JSON path (default: test-results/price-models-endog-<fleet>.json)
//   ANCHOR_PROVIDER_URL / ANCHOR_WALLET   standard Anchor env
//
// Run: ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET=~/.config/solana/id.json \
//        DATA_DIR=test-results/datasets/scale-80m-12p-s42-30d-cap5 \
//        npx tsx scripts/price-models-endog.ts

import * as anchor from "@anchor-lang/core";
import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import * as fs from "fs";
import * as path from "path";
import {
  loadDataset,
  tradeableSupplyKwh,
  buildTranches,
  buildDemandTranches,
  evalUniform,
  evalCdaCross,
  predictUniformClearing,
  evalBuyback,
  toAtomic,
  DEFAULT_TARIFF,
  DEFAULT_DEMAND,
  ASK_LADDER,
  type Tranche,
} from "./lib/price-model-tariff";

const DATA_DIR = process.env.DATA_DIR;
if (!DATA_DIR) throw new Error("DATA_DIR required (a test-results/datasets/scale-* dir)");
const DAYS = process.env.DAYS ? parseInt(process.env.DAYS, 10) : undefined;
const ZONE_ID = process.env.ZONE_ID ? parseInt(process.env.ZONE_ID, 10) : 4343;
const DEMAND = {
  ...DEFAULT_DEMAND,
  alpha: process.env.ALPHA ? parseFloat(process.env.ALPHA) : DEFAULT_DEMAND.alpha,
  bandLo: process.env.BAND_LO ? parseFloat(process.env.BAND_LO) : DEFAULT_DEMAND.bandLo,
  bandHi: process.env.BAND_HI ? parseFloat(process.env.BAND_HI) : DEFAULT_DEMAND.bandHi,
};

const u32le = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const orderIdSeed = (idVal: BN) => idVal.toArrayLike(Buffer, "le", 8);
const j = (v: bigint) => v.toString();

function fail(msg: string): never {
  console.error(`✗ VERIFY FAILED: ${msg}`);
  process.exit(1);
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const trading = anchor.workspace.Trading as anchor.Program;
  const governance = anchor.workspace.Governance as anchor.Program;
  const tradingAcct = trading.account as any;
  const authority = provider.wallet;

  const [marketPda] = PublicKey.findProgramAddressSync([Buffer.from("market")], trading.programId);
  const [zoneMarketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("zone_market"), marketPda.toBuffer(), u32le(ZONE_ID)],
    trading.programId,
  );
  const [governanceConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("governance_config")],
    governance.programId,
  );

  try {
    await trading.methods
      .initializeZoneMarket(ZONE_ID, 1, new BN(0), 0)
      .accounts({
        market: marketPda,
        zoneMarket: zoneMarketPda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`  zone_market ${ZONE_ID} created`);
  } catch (e: any) {
    if (!/already in use/.test(e.message)) throw e;
    console.log(`  zone_market ${ZONE_ID} exists`);
  }

  // ---- Book: fixed ask ladder × ENDOGENOUS bid ladder ----------------------
  const ds = loadDataset(DATA_DIR);
  const volKwh = tradeableSupplyKwh(ds, DAYS);
  const asks: Tranche[] = buildTranches(volKwh);
  const bids: Tranche[] = buildDemandTranches(ds, DAYS, DEMAND);
  const fleet = path.basename(DATA_DIR);
  const demandKwh = bids.reduce((s, b) => s + b.kwh, 0);
  console.log(`\n${fleet}  days=${DAYS ?? ds.daily.length}  supply=${volKwh.toFixed(1)} kWh  demand=${demandKwh.toFixed(1)} kWh (α=${DEMAND.alpha})`);
  console.log(`  asks ${asks.map((t) => `${t.kwh.toFixed(1)}@${Number(t.priceMicros) / 1e6}`).join("  ")}`);
  console.log(`  bids ${bids.map((t) => `${t.kwh.toFixed(1)}@${Number(t.priceMicros) / 1e6}`).join("  ")}`);

  // Predictions ---------------------------------------------------------------
  const predUniform = evalUniform(asks, DEFAULT_TARIFF, bids); // delegates to evalUniformAuction
  const predCda = evalCdaCross(asks, bids);
  const predBuyback = evalBuyback(volKwh);

  // ---- Scheme 1: UNIFORM via clear_auction (real bid ladder) ---------------
  const mkAuctionOrder = (t: Tranche, isBuy: boolean) => ({
    orderKey: PublicKey.unique(),
    pricePerKwh: new BN(t.priceMicros.toString()),
    amount: new BN(toAtomic(t.kwh).toString()),
    filledAmount: new BN(0),
    user: Keypair.generate().publicKey,
    isBuy,
  });
  const sellOrders = asks.map((t) => mkAuctionOrder(t, false));
  const buyOrders = bids.map((t) => mkAuctionOrder(t, true));

  const zmBefore: any = await tradingAcct.zoneMarket.fetch(zoneMarketPda);
  const volBefore = BigInt(zmBefore.totalVolume.toString());

  const uniformSig = await trading.methods
    .clearAuction(sellOrders, buyOrders)
    .accounts({
      market: marketPda,
      zoneMarket: zoneMarketPda,
      authority: authority.publicKey,
      feeCollector: authority.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      governanceConfig: governanceConfigPda,
    })
    .rpc();

  const zmAfter: any = await tradingAcct.zoneMarket.fetch(zoneMarketPda);
  const onClearing = BigInt(zmAfter.lastClearingPrice.toString());
  const onVolDelta = BigInt(zmAfter.totalVolume.toString()) - volBefore;
  console.log(`  [uniform] clearing=${Number(onClearing) / 1e6}  volΔ=${Number(onVolDelta) / 1e9} kWh  tx=${uniformSig.slice(0, 8)}`);

  // On-chain must equal the arbitrary-book prediction exactly.
  const cp = predictUniformClearing(asks, bids);
  if (!cp) fail("prediction cleared zero volume — demand band never crosses the ladder");
  if (onClearing !== cp.price) fail(`uniform clearing ${onClearing} != predicted ${cp.price}`);
  if (onVolDelta !== cp.volumeAtomic) fail(`uniform volume ${onVolDelta} != predicted ${cp.volumeAtomic}`);
  console.log(`  ✓ uniform matches prediction (partial clear: ${predUniform.volKwh.toFixed(1)}/${volKwh.toFixed(1)} kWh)`);

  // ---- Scheme 2: CDA — one order pair + match per predicted fill -----------
  const runSalt = new BN(Date.now());
  const tradeRecords: string[] = [];
  for (let i = 0; i < predCda.fills.length; i++) {
    const f = predCda.fills[i];
    const atomic = new BN(toAtomic(f.kwh).toString());
    const sellId = runSalt.addn(2 * i);
    const buyId = runSalt.addn(2 * i + 1);
    const [sellOrderPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("order"), authority.publicKey.toBuffer(), orderIdSeed(sellId)],
      trading.programId,
    );
    const [buyOrderPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("order"), authority.publicKey.toBuffer(), orderIdSeed(buyId)],
      trading.programId,
    );
    const [tradePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("trade"), buyOrderPda.toBuffer(), sellOrderPda.toBuffer()],
      trading.programId,
    );

    await trading.methods
      .createSellOrder(sellId, atomic, new BN(f.askMicros.toString()))
      .accounts({
        market: marketPda, zoneMarket: zoneMarketPda, order: sellOrderPda,
        ercCertificate: null, authority: authority.publicKey,
        systemProgram: SystemProgram.programId, governanceConfig: governanceConfigPda,
      })
      .rpc();
    await trading.methods
      .createBuyOrder(buyId, atomic, new BN(f.bidMicros.toString()))
      .accounts({
        market: marketPda, zoneMarket: zoneMarketPda, order: buyOrderPda,
        authority: authority.publicKey, systemProgram: SystemProgram.programId,
        governanceConfig: governanceConfigPda,
      })
      .rpc();
    await trading.methods
      .matchOrders(atomic)
      .accounts({
        market: marketPda, zoneMarket: zoneMarketPda, buyOrder: buyOrderPda,
        sellOrder: sellOrderPda, tradeRecord: tradePda, authority: authority.publicKey,
        systemProgram: SystemProgram.programId, governanceConfig: governanceConfigPda,
      })
      .rpc();
    tradeRecords.push(tradePda.toBase58());

    const tr: any = await tradingAcct.tradeRecord.fetch(tradePda);
    const gotPrice = BigInt(tr.pricePerKwh.toString());
    const gotAmt = BigInt(tr.amount.toString());
    if (gotPrice !== f.askMicros) fail(`cda fill ${i}: TradeRecord price ${gotPrice} != ask ${f.askMicros}`);
    if (gotAmt !== toAtomic(f.kwh)) fail(`cda fill ${i}: TradeRecord amount ${gotAmt} != ${toAtomic(f.kwh)}`);
    console.log(`  [cda] fill ${i}  ${f.kwh.toFixed(1)} kWh @ ask ${Number(f.askMicros) / 1e6} (bid ${Number(f.bidMicros) / 1e6}) ✓`);
  }
  console.log(`  ✓ cda: ${predCda.fills.length} fills, cleared ${predCda.volKwh.toFixed(1)}/${volKwh.toFixed(1)} kWh`);

  // ---- Results -------------------------------------------------------------
  const schemeJson = (s: { scheme: string; volKwh: number; netPerKwh: number; charge: any }) => ({
    scheme: s.scheme, volKwh: s.volKwh, netPerKwh: s.netPerKwh,
    gross: j(s.charge.gross), fee: j(s.charge.fee), wheeling: j(s.charge.wheeling),
    loss: j(s.charge.loss), net: j(s.charge.net),
  });
  const out = process.env.OUT || path.join("test-results", `price-models-endog-${fleet}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({
    fleet, dataDir: DATA_DIR, days: DAYS ?? ds.daily.length, zoneId: ZONE_ID,
    supplyKwh: volKwh, demandKwh, demand: DEMAND, ladder: ASK_LADDER,
    bids: bids.map((b) => ({ kwh: b.kwh, priceMicros: j(b.priceMicros) })),
    tariff: {
      feeBps: Number(DEFAULT_TARIFF.feeBps), lossBps: Number(DEFAULT_TARIFF.lossBps),
      wheelingRateMicros: j(DEFAULT_TARIFF.wheelingRateMicros),
    },
    predicted: {
      uniform: schemeJson(predUniform),
      cda: { ...schemeJson(predCda), fills: predCda.fills.map((f) => ({ kwh: f.kwh, ask: j(f.askMicros), bid: j(f.bidMicros) })) },
      buyback: schemeJson(predBuyback),
    },
    onchain: {
      market: marketPda.toBase58(), zoneMarket: zoneMarketPda.toBase58(),
      uniform: { tx: uniformSig, clearingPriceMicros: j(onClearing), volumeDeltaAtomic: j(onVolDelta) },
      cda: { tradeRecords },
    },
    generatedAt: new Date().toISOString(),
  }, null, 2));

  console.log(`\n  RESULT net/kWh (cleared vol):  uniform ${predUniform.netPerKwh.toFixed(3)} (${predUniform.volKwh.toFixed(0)} kWh)  cda ${predCda.netPerKwh.toFixed(3)} (${predCda.volKwh.toFixed(0)} kWh)  buyback ${predBuyback.netPerKwh.toFixed(3)} (${predBuyback.volKwh.toFixed(0)} kWh)`);
  console.log(`  wrote ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
