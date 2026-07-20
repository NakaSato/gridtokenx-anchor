// Validator-free unit test for the §4.7 price-model core. Runs against the real
// surviving physics dataset (test-results/datasets/scale-80m-12p-s42-7d-cap5) and
// asserts the QUALITATIVE finding the paper rests on — the net-revenue ranking
// inverts around the flat wheeling charge — plus exact tariff-math invariants.
// Run: npx mocha -r tsx scripts/lib/price-model-tariff.test.ts --timeout 60000

import { strict as assert } from "assert";
import * as fs from "fs";
import * as path from "path";
import {
  loadDataset,
  comparePriceModels,
  chargeFill,
  toAtomic,
  priceMicros,
  buildTranches,
  evalUniform,
  evalUniformAuction,
  findClearingPoint,
  DEFAULT_TARIFF,
  type Tranche,
} from "./price-model-tariff";

const DS_DIR = path.resolve(
  process.cwd(),
  "test-results/datasets/scale-80m-12p-s42-7d-cap5",
);

describe("price-model-tariff (§4.7 core, validator-free)", () => {
  before(function () {
    if (!fs.existsSync(path.join(DS_DIR, "daily.json"))) this.skip();
  });

  it("chargeFill mirrors on-chain integer floors exactly", () => {
    // 100 kWh @ 4.00, fee 25bps, loss 5bps, wheeling 1.15/kWh
    const c = chargeFill(toAtomic(100), priceMicros(4.0), DEFAULT_TARIFF);
    assert.equal(c.gross, 400_000_000n); // 100 * 4.00 * 1e6
    assert.equal(c.fee, 1_000_000n); // 400 * 0.0025
    assert.equal(c.loss, 200_000n); // 400 * 0.0005
    assert.equal(c.wheeling, 115_000_000n); // 1.15 * 100
    assert.equal(c.net, c.gross - c.fee - c.loss - c.wheeling);
  });

  it("reproduces the ranking inversion on the 80m/7d fleet", () => {
    const ds = loadDataset(DS_DIR);
    const cmp = comparePriceModels(ds, 7);
    const u = cmp.uniform.netPerKwh;
    const c = cmp.cda.netPerKwh;
    const b = cmp.buyback.netPerKwh;

    console.log(`\n  vol = ${cmp.volKwh.toFixed(1)} kWh`);
    console.log(`  uniform  net/kWh = ${u.toFixed(3)}  (gross ${(Number(cmp.uniform.charge.gross) / 1e6).toFixed(1)}, net ${(Number(cmp.uniform.charge.net) / 1e6).toFixed(1)})`);
    console.log(`  cda      net/kWh = ${c.toFixed(3)}  (gross ${(Number(cmp.cda.charge.gross) / 1e6).toFixed(1)}, net ${(Number(cmp.cda.charge.net) / 1e6).toFixed(1)})`);
    console.log(`  buyback  net/kWh = ${b.toFixed(3)}  (gross ${(Number(cmp.buyback.charge.gross) / 1e6).toFixed(1)})`);
    console.log(`  wheeling consumed = ${(Number(cmp.uniform.charge.wheeling) / 1e6).toFixed(1)} units\n`);

    assert.ok(cmp.volKwh > 0, "tradeable supply must be positive");
    assert.ok(Math.abs(b - 2.2) < 1e-3, "buyback baseline ~2.20 (tariff-exempt)");
    // THE FINDING: net of the 1.15 wheeling charge, the ranking inverts —
    // uniform-price clearing beats buy-back, discriminatory CDA falls below it.
    assert.ok(u > b, `uniform (${u.toFixed(3)}) should beat buyback (${b})`);
    assert.ok(c < b, `CDA (${c.toFixed(3)}) should fall BELOW buyback (${b}) — inversion`);
    assert.ok(u > c, "uniform net should dominate CDA net");
    // break-even discovered price separating market schemes from buyback
    const breakeven = (2.2 + 1.15) / (1 - 0.003);
    assert.ok(Math.abs(breakeven - 3.36) < 0.02, "break-even ~3.36/kWh");
  });

  it("findClearingPoint matches the on-chain Rust unit test", () => {
    // Same fixture as programs/trading/src/lib.rs test_find_clearing_point_basic:
    // supply ASC by price, demand DESC, cumulative volumes in atomic kWh.
    const supply = [
      { price: 3_200_000n, cumAtomic: 50_000_000_000n },
      { price: 3_400_000n, cumAtomic: 130_000_000_000n },
      { price: 3_600_000n, cumAtomic: 170_000_000_000n },
    ];
    const demand = [
      { price: 3_800_000n, cumAtomic: 30_000_000_000n },
      { price: 3_600_000n, cumAtomic: 90_000_000_000n },
      { price: 3_400_000n, cumAtomic: 140_000_000_000n },
    ];
    const cp = findClearingPoint(supply, demand);
    assert.ok(cp, "should find a crossing");
    assert.equal(cp!.price, 3_400_000n); // marginal ask at the max-volume crossing
    assert.equal(cp!.volumeAtomic, 130_000_000_000n);
    // no intersection -> null (on-chain: InvalidPrice)
    assert.equal(
      findClearingPoint(
        [{ price: 5_000_000n, cumAtomic: 100_000_000_000n }],
        [{ price: 3_000_000n, cumAtomic: 50_000_000_000n }],
      ),
      null,
    );
  });

  it("evalUniformAuction with flat-top bids == evalUniform fast path", () => {
    // The driver pins every bid at the top ask. The general port must reproduce the
    // flat-top special case: whole book crosses, clears at the marginal == max ask.
    const asks: Tranche[] = buildTranches(400); // 4 rungs 3.00–3.45, 100 kWh each
    const topAsk = asks.reduce((mx, a) => (a.priceMicros > mx ? a.priceMicros : mx), 0n);
    const flatBids: Tranche[] = asks.map((a) => ({ kwh: a.kwh, priceMicros: topAsk }));

    const fast = evalUniform(asks);
    const general = evalUniformAuction(asks, flatBids);
    // Full book settles at 3.45; rates identical up to sub-micro integer-floor rounding.
    assert.ok(Math.abs(general.volKwh - fast.volKwh) < 1e-6, "same cleared volume");
    assert.ok(Math.abs(general.netPerKwh - fast.netPerKwh) < 1e-6, "same net/kWh");
    assert.equal(fast.charge.net, evalUniform(asks, DEFAULT_TARIFF, flatBids).charge.net);
  });

  it("data-driven bids clear BELOW the top ask (find_clearing_point port)", () => {
    // asks 3.00/3.15/3.30/3.45 @100 kWh; all bids at 3.20 -> only the 3.00 and 3.15
    // rungs are eligible. Max-volume crossing: ask 3.15, cum supply 200 kWh <= bid
    // cum 400. Clears at 3.15 for 200 kWh — NOT the 3.45 the flat-top path would give.
    const asks: Tranche[] = buildTranches(400);
    const bids: Tranche[] = asks.map((a) => ({ kwh: a.kwh, priceMicros: priceMicros(3.2) }));

    const r = evalUniformAuction(asks, bids);
    assert.ok(Math.abs(r.volKwh - 200) < 1e-6, `cleared 200 kWh, got ${r.volKwh}`);
    // gross = 200 * 3.15 * 1e6 ; net = gross - fee(25bps) - loss(5bps) - wheeling(1.15*200)
    assert.equal(r.charge.gross, 630_000_000n);
    assert.equal(r.charge.fee, 1_575_000n);
    assert.equal(r.charge.loss, 315_000n);
    assert.equal(r.charge.wheeling, 230_000_000n);
    assert.equal(r.charge.net, 630_000_000n - 1_575_000n - 315_000n - 230_000_000n);
    // clears strictly below the flat-top result
    assert.ok(r.netPerKwh < evalUniform(asks).netPerKwh, "data-driven clears below flat-top");
  });

  it("no cross -> zero-volume result", () => {
    const asks: Tranche[] = [{ kwh: 100, priceMicros: priceMicros(5.0) }];
    const bids: Tranche[] = [{ kwh: 100, priceMicros: priceMicros(3.0) }];
    const r = evalUniformAuction(asks, bids);
    assert.equal(r.volKwh, 0);
    assert.equal(r.charge.net, 0n);
  });

  it("net-per-kWh is scale/horizon invariant (rate, not volume)", () => {
    const ds = loadDataset(DS_DIR);
    const wk = comparePriceModels(ds, 7);
    // Uniform always clears at the marginal ladder ask -> identical net rate
    // regardless of volume; CDA rate depends only on the (fixed) ladder split.
    const half = comparePriceModels(ds, 3);
    // Rate is invariant up to sub-micro integer-floor rounding (volume differs).
    assert.ok(Math.abs(wk.uniform.netPerKwh - half.uniform.netPerKwh) < 1e-3, "uniform rate invariant to horizon");
    assert.ok(Math.abs(wk.cda.netPerKwh - half.cda.netPerKwh) < 1e-3, "CDA rate invariant to horizon");
  });
});

// ---- Endogenous demand (buildDemandTranches / evalCdaCross / clearing) -----

import {
  buildDemandTranches,
  evalCdaCross,
  predictUniformClearing,
  evalUniformAuction,
  DEFAULT_DEMAND,
  tradeableSupplyKwh,
  buildTranches,
} from "./price-model-tariff";

describe("endogenous demand", () => {
  const DIR = "test-results/datasets/scale-80m-12p-s42-7d-cap5";
  const ds = loadDataset(DIR);

  it("buildDemandTranches: deterministic, data-derived, conserves alpha share", () => {
    const b1 = buildDemandTranches(ds);
    const b2 = buildDemandTranches(ds);
    assert.deepEqual(
      b1.map((t) => [t.kwh, t.priceMicros.toString()]),
      b2.map((t) => [t.kwh, t.priceMicros.toString()]),
      "deterministic",
    );
    assert.equal(b1.length, DEFAULT_DEMAND.buckets);
    // total bid quantity == alpha × total consumer consumption
    const pros = new Set(ds.meta.prosumer_idx);
    let cons = 0;
    for (let d = 0; d < ds.daily.length; d++)
      for (let m = 0; m < ds.meta.meters; m++)
        if (!pros.has(m)) cons += ds.daily[d][m].c;
    const totalBid = b1.reduce((s, t) => s + t.kwh, 0);
    assert.ok(Math.abs(totalBid - cons * DEFAULT_DEMAND.alpha) < 1e-6, "alpha share conserved");
    // heaviest bucket bids exactly bandHi; prices within band and ascending
    const prices = b1.map((t) => Number(t.priceMicros) / 1e6);
    assert.equal(Math.max(...prices), DEFAULT_DEMAND.bandHi, "top bucket at bandHi");
    for (const p of prices) assert.ok(p >= DEFAULT_DEMAND.bandLo - 1e-9 && p <= DEFAULT_DEMAND.bandHi + 1e-9);
    for (let i = 1; i < prices.length; i++) assert.ok(prices[i] >= prices[i - 1], "ascending with consumption");
  });

  it("evalCdaCross: partial clearing, pay-as-ask, never over-fills either side", () => {
    const asks: Tranche[] = [
      { kwh: 10, priceMicros: priceMicros(3.0) },
      { kwh: 10, priceMicros: priceMicros(3.5) },
    ];
    const bids: Tranche[] = [
      { kwh: 5, priceMicros: priceMicros(4.0) },
      { kwh: 8, priceMicros: priceMicros(3.2) },
    ];
    const r = evalCdaCross(asks, bids);
    // best bid 4.0 takes 5 @3.0; next bid 3.2 takes remaining 5 @3.0 then fails vs 3.5
    assert.equal(r.fills.length, 2);
    assert.equal(r.fills[0].kwh, 5);
    assert.equal(r.fills[0].askMicros, priceMicros(3.0));
    assert.equal(r.fills[1].kwh, 5);
    assert.equal(r.fills[1].askMicros, priceMicros(3.0));
    assert.equal(r.volKwh, 10, "3.5 ask never clears against 3.2 bid");
  });

  it("uniform on endogenous book: clearing matches evalUniformAuction charge exactly", () => {
    const asks = buildTranches(tradeableSupplyKwh(ds));
    const bids = buildDemandTranches(ds);
    const cp = predictUniformClearing(asks, bids);
    assert.ok(cp, "book must cross under defaults");
    const r = evalUniformAuction(asks, bids);
    assert.equal(r.volKwh, Number(cp!.volumeAtomic) / 1e9);
    assert.equal(r.charge.gross.toString(), chargeFill(cp!.volumeAtomic, cp!.price, { feeBps: 25n, lossBps: 5n, wheelingRateMicros: priceMicros(1.15) }).gross.toString());
  });
});
