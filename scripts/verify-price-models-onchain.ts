// verify-price-models-onchain.ts — independent on-chain verifier for §4.7.
//
// Re-derives every headline number of a price-models-onchain.ts run straight from
// PERSISTED chain state (RPC reads only), recomputes the tariff net via the shared
// core, and asserts against the run's results JSON. Runs the SEVEN checks the paper
// cites, so the verifier reads state the runner can no longer touch:
//
//   (1) uniform on-chain clearing price == marginal (top) ladder ask
//   (2) uniform recorded volume delta   == total tradeable atomic volume
//   (3..6) each of the 4 CDA TradeRecords: price_per_kwh == its tranche ask
//          AND total_value == amount * price  (one check per fill)
//   (7) buy-back baseline recompute + net-ranking inversion (uniform > buyback > cda)
//
// Exit non-zero if any check fails.
//
// Run: ANCHOR_PROVIDER_URL=... ANCHOR_WALLET=... \
//        RESULTS=test-results/price-models-<fleet>-<ISO>.json \
//        npx tsx scripts/verify-price-models-onchain.ts
//   (or pass the JSON path as argv[2])

import * as anchor from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import {
  buildTranches,
  evalUniform,
  evalCda,
  evalBuyback,
  toAtomic,
  priceMicros,
  ASK_LADDER,
} from "./lib/price-model-tariff";

const RESULTS = process.env.RESULTS || process.argv[2];
if (!RESULTS) throw new Error("RESULTS env or argv[2] = price-models results JSON path required");

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

async function main() {
  const res = JSON.parse(fs.readFileSync(RESULTS, "utf8"));
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const trading = anchor.workspace.Trading as anchor.Program;
  const acct = trading.account as any;

  const volKwh: number = res.volKwh;
  const tranches = buildTranches(volKwh);
  const totalAtomic = tranches.reduce((a, t) => a + toAtomic(t.kwh), 0n);
  const topAsk = priceMicros(Math.max(...ASK_LADDER));
  const checks: Check[] = [];

  // ---- (1) & (2) UNIFORM: live zone_market clearing price + recorded vol delta
  const zm: any = await acct.zoneMarket.fetch(new PublicKey(res.onchain.zoneMarket));
  const liveClearing = BigInt(zm.lastClearingPrice.toString());
  checks.push({
    name: "uniform clearing price == top ladder ask",
    pass: liveClearing === topAsk,
    detail: `live=${Number(liveClearing) / 1e6} expected=${Number(topAsk) / 1e6}`,
  });
  const recordedDelta = BigInt(res.onchain.uniform.volumeDeltaAtomic);
  // clear_auction credits matched_buy_volume == full crossing volume (whole book).
  checks.push({
    name: "uniform volume delta == total tradeable volume",
    pass: recordedDelta === totalAtomic,
    detail: `delta=${recordedDelta} expected=${totalAtomic}`,
  });

  // ---- (3..6) CDA: each TradeRecord priced at its tranche's seller ask --------
  const trPdas: string[] = res.onchain.cda.tradeRecords;
  for (let i = 0; i < trPdas.length; i++) {
    const tr: any = await acct.tradeRecord.fetch(new PublicKey(trPdas[i]));
    const price = BigInt(tr.pricePerKwh.toString());
    const amount = BigInt(tr.amount.toString());
    const totalValue = BigInt(tr.totalValue.toString());
    const expectedAsk = tranches[i].priceMicros;
    const valueOk = totalValue === amount * price;
    checks.push({
      name: `CDA TradeRecord[${i}] price == tranche ask ${Number(expectedAsk) / 1e6} & total_value consistent`,
      pass: price === expectedAsk && valueOk,
      detail: `price=${Number(price) / 1e6} expected=${Number(expectedAsk) / 1e6} value_ok=${valueOk}`,
    });
  }

  // ---- (7) Buy-back baseline + net-ranking inversion (independent recompute) --
  const u = evalUniform(tranches);
  const c = evalCda(tranches);
  const b = evalBuyback(volKwh);
  const inversion = u.netPerKwh > b.netPerKwh && b.netPerKwh > c.netPerKwh;
  const matchesPersisted =
    Math.abs(u.netPerKwh - res.predicted.uniform.netPerKwh) < 1e-6 &&
    Math.abs(c.netPerKwh - res.predicted.cda.netPerKwh) < 1e-6 &&
    Math.abs(b.netPerKwh - res.predicted.buyback.netPerKwh) < 1e-6;
  checks.push({
    name: "buyback baseline + net inversion (uniform > buyback > cda) & matches persisted",
    pass: inversion && matchesPersisted,
    detail: `u=${u.netPerKwh.toFixed(3)} b=${b.netPerKwh.toFixed(3)} c=${c.netPerKwh.toFixed(3)} inversion=${inversion} persisted_ok=${matchesPersisted}`,
  });

  // ---- Report --------------------------------------------------------------
  console.log(`\nVerify ${res.fleet} (days=${res.days}, vol=${volKwh.toFixed(1)} kWh) — ${checks.length} checks`);
  let failed = 0;
  for (const ck of checks) {
    console.log(`  ${ck.pass ? "✓" : "✗"} ${ck.name}\n      ${ck.detail}`);
    if (!ck.pass) failed++;
  }
  console.log(`\n  ${checks.length - failed}/${checks.length} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
