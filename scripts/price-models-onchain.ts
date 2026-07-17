// price-models-onchain.ts — §4.7 price-model comparison, driven on-chain.
//
// Runs the three settlement schemes against a LIVE validator on the identical
// reduced order book (four ask-ladder tranches from a fleet's tradeable surplus):
//   1. uniform  -> trading.clear_auction  (single marginal clearing price; reads
//                  back zone_market.last_clearing_price + total_volume delta)
//   2. cda      -> trading.create_sell/buy_order + match_orders  (each tranche
//                  settles at its own seller ask; writes one TradeRecord per pair)
//   3. buyback  -> off-chain regulated feed-in baseline (tariff-exempt)
//
// Neither clear_auction nor match_orders moves tokens or applies the wheeling/
// fee/loss tariff (that lives in the settlement path); they establish the GROSS
// prices+volumes. Net is computed here from the experiment tariff via the shared
// core (scripts/lib/price-model-tariff.ts) — exactly the paper's
// "Net = gross - fee - loss - wheeling". The verifier re-reads the same chain
// state and recomputes independently.
//
// Env:
//   DATA_DIR   dataset dir (test-results/datasets/scale-*)          [required]
//   DAYS       horizon in days (default: full dataset horizon)
//   ZONE_ID    zone market to use; created if absent (default 4242)
//   OUT        results JSON path (default: test-results/price-models-<fleet>-<ISO>.json)
//   ANCHOR_PROVIDER_URL / ANCHOR_WALLET   standard Anchor env
//
// Run: ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET=~/.config/solana/id.json \
//        DATA_DIR=test-results/datasets/scale-80m-12p-s42-7d-cap5 DAYS=7 \
//        npx tsx scripts/price-models-onchain.ts

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
  evalUniform,
  evalCda,
  evalBuyback,
  toAtomic,
  DEFAULT_TARIFF,
  ASK_LADDER,
  type Tranche,
} from "./lib/price-model-tariff";

const DATA_DIR = process.env.DATA_DIR;
if (!DATA_DIR) throw new Error("DATA_DIR required (a test-results/datasets/scale-* dir)");
const DAYS = process.env.DAYS ? parseInt(process.env.DAYS, 10) : undefined;
const ZONE_ID = process.env.ZONE_ID ? parseInt(process.env.ZONE_ID, 10) : 4242;

const u32le = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const orderIdSeed = (idVal: BN) => idVal.toArrayLike(Buffer, "le", 8);
const j = (v: bigint) => v.toString(); // BigInt -> JSON-safe string

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const trading = anchor.workspace.Trading as anchor.Program;
  const governance = anchor.workspace.Governance as anchor.Program;
  const tradingAcct = trading.account as any; // IDL account namespace is dynamic (camelCase)
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

  // Ensure the working zone market exists (idempotent). 1 shard, capacity 0, Retail.
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

  // ---- Build the shared reduced book from the dataset ---------------------
  const ds = loadDataset(DATA_DIR);
  const volKwh = tradeableSupplyKwh(ds, DAYS);
  const tranches: Tranche[] = buildTranches(volKwh);
  const fleet = path.basename(DATA_DIR);
  console.log(`\n${fleet}  days=${DAYS ?? ds.daily.length}  vol=${volKwh.toFixed(1)} kWh`);
  console.log(`  ladder ${ASK_LADDER.join("/")}  tranches ${tranches.map((t) => t.kwh.toFixed(1)).join(", ")} kWh`);

  // Predictions (what the on-chain run should reproduce) ---------------------
  const predUniform = evalUniform(tranches);
  const predCda = evalCda(tranches);
  const predBuyback = evalBuyback(volKwh);

  // ---- Scheme 1: UNIFORM via clear_auction --------------------------------
  const dummyUser = () => Keypair.generate().publicKey;
  const mkAuctionOrder = (t: Tranche, isBuy: boolean, priceMicros: bigint) => ({
    orderKey: PublicKey.unique(),
    pricePerKwh: new BN(priceMicros.toString()),
    amount: new BN(toAtomic(t.kwh).toString()),
    filledAmount: new BN(0),
    user: dummyUser(),
    isBuy,
  });
  // 4 sell tranches at ladder asks; 4 buy tranches all bidding the top ask so the
  // whole book crosses and clears at the marginal (3.45) price.
  //
  // GUARD — the flat top-ask bid ladder is LOad-bearing, not cosmetic. It is the
  // ONLY reason on-chain clear_auction reproduces off-chain evalUniform:
  //   - evalUniform (price-model-tariff.ts) DEFINES the uniform clearing price as
  //     the MAX ask on the ladder (3.45), unconditionally.
  //   - on-chain find_clearing_point picks the marginal ask at the max-volume
  //     crossing. Those two rules coincide ONLY when every bid >= every ask, which
  //     pinning all buys at topAsk guarantees (full book crosses, marginal ask = top).
  // If the buy ladder ever becomes data-driven (real bids below 3.45), on-chain
  // clearing drifts BELOW topAsk while evalUniform stays at topAsk -> the predicted
  // and on-chain uniform numbers silently diverge. Any such change MUST also switch
  // evalUniform to consume the real demand curve (mirror find_clearing_point), or
  // the equivalence this harness asserts no longer holds.
  const topAsk = tranches.reduce((mx, t) => (t.priceMicros > mx ? t.priceMicros : mx), 0n);
  const sellOrders = tranches.map((t) => mkAuctionOrder(t, false, t.priceMicros));
  const buyOrders = tranches.map((t) => mkAuctionOrder(t, true, topAsk));

  const zmBefore: any = await tradingAcct.zoneMarket.fetch(zoneMarketPda);
  const volBefore = BigInt(zmBefore.totalVolume.toString());

  const uniformSig = await trading.methods
    .clearAuction(sellOrders, buyOrders)
    .accounts({
      market: marketPda,
      zoneMarket: zoneMarketPda,
      authority: authority.publicKey,
      feeCollector: authority.publicKey, // unused: clear_auction moves no tokens
      tokenProgram: TOKEN_PROGRAM_ID,
      governanceConfig: governanceConfigPda,
    })
    .rpc();

  const zmAfter: any = await tradingAcct.zoneMarket.fetch(zoneMarketPda);
  const onchainClearingPrice = BigInt(zmAfter.lastClearingPrice.toString());
  const onchainVolDelta = BigInt(zmAfter.totalVolume.toString()) - volBefore;
  console.log(`  [uniform] clear_auction  clearing=${Number(onchainClearingPrice) / 1e6}  volΔ(atomic)=${onchainVolDelta}  tx=${uniformSig.slice(0, 8)}`);

  // ---- Scheme 2: CDA via create orders + match_orders ---------------------
  const runSalt = new BN(Date.now()); // unique order-id base so PDAs don't collide across reruns
  const tradeRecords: string[] = [];
  const cdaSigs: string[] = [];
  for (let i = 0; i < tranches.length; i++) {
    const t = tranches[i];
    const atomic = new BN(toAtomic(t.kwh).toString());
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
      .createSellOrder(sellId, atomic, new BN(t.priceMicros.toString()))
      .accounts({
        market: marketPda,
        zoneMarket: zoneMarketPda,
        order: sellOrderPda,
        ercCertificate: null,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
        governanceConfig: governanceConfigPda,
      })
      .rpc();
    await trading.methods
      .createBuyOrder(buyId, atomic, new BN(topAsk.toString())) // bid the top ask -> crosses
      .accounts({
        market: marketPda,
        zoneMarket: zoneMarketPda,
        order: buyOrderPda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
        governanceConfig: governanceConfigPda,
      })
      .rpc();
    const sig = await trading.methods
      .matchOrders(atomic)
      .accounts({
        market: marketPda,
        zoneMarket: zoneMarketPda,
        buyOrder: buyOrderPda,
        sellOrder: sellOrderPda,
        tradeRecord: tradePda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
        governanceConfig: governanceConfigPda,
      })
      .rpc();
    tradeRecords.push(tradePda.toBase58());
    cdaSigs.push(sig);

    const tr: any = await tradingAcct.tradeRecord.fetch(tradePda);
    console.log(`  [cda] tranche ${i}  ask=${Number(t.priceMicros) / 1e6}  TradeRecord.price=${Number(tr.pricePerKwh.toString()) / 1e6}  amt=${tr.amount.toString()}`);
  }

  // ---- Results ------------------------------------------------------------
  const schemeJson = (s: ReturnType<typeof evalUniform>) => ({
    scheme: s.scheme,
    volKwh: s.volKwh,
    netPerKwh: s.netPerKwh,
    gross: j(s.charge.gross),
    fee: j(s.charge.fee),
    wheeling: j(s.charge.wheeling),
    loss: j(s.charge.loss),
    net: j(s.charge.net),
  });
  const nowIso = new Date().toISOString().replace(/[:.]/g, "-");
  const out =
    process.env.OUT || path.join("test-results", `price-models-${fleet}-${nowIso}.json`);
  const result = {
    fleet,
    dataDir: DATA_DIR,
    days: DAYS ?? ds.daily.length,
    zoneId: ZONE_ID,
    volKwh,
    ladder: ASK_LADDER,
    tariff: {
      feeBps: Number(DEFAULT_TARIFF.feeBps),
      lossBps: Number(DEFAULT_TARIFF.lossBps),
      wheelingRateMicros: j(DEFAULT_TARIFF.wheelingRateMicros),
    },
    predicted: {
      uniform: schemeJson(predUniform),
      cda: schemeJson(predCda),
      buyback: schemeJson(predBuyback),
    },
    onchain: {
      market: marketPda.toBase58(),
      zoneMarket: zoneMarketPda.toBase58(),
      uniform: {
        tx: uniformSig,
        clearingPriceMicros: j(onchainClearingPrice),
        volumeDeltaAtomic: j(onchainVolDelta),
      },
      cda: { txs: cdaSigs, tradeRecords },
    },
    generatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(result, null, 2));

  console.log(`\n  RESULT (net/kWh):  uniform ${predUniform.netPerKwh.toFixed(3)}  cda ${predCda.netPerKwh.toFixed(3)}  buyback ${predBuyback.netPerKwh.toFixed(3)}`);
  console.log(`  vs buyback:  uniform ${(((predUniform.netPerKwh - predBuyback.netPerKwh) / predBuyback.netPerKwh) * 100).toFixed(0)}%  cda ${(((predCda.netPerKwh - predBuyback.netPerKwh) / predBuyback.netPerKwh) * 100).toFixed(0)}%`);
  console.log(`  wrote ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
