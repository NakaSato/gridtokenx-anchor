// price-model-tariff.ts — pure, validator-free core of the §4.7 price-model
// comparison. Mirrors the on-chain settlement tariff math (programs/trading/src/
// lib.rs:603-632) in exact integer (BigInt) base-unit arithmetic so the harness
// can PREDICT and a verifier can CHECK the on-chain TradeRecord / clear_auction
// outcomes without re-deriving anything by hand.
//
// Units:
//   - price_per_kwh: 6-decimal settlement-currency base units ("micros").
//     3.45 THB/kWh -> 3_450_000n.
//   - energy amount: 9-decimal atomic kWh (kWh * 1e9), per ENERGY_AMOUNT_DECIMALS_DIVISOR.
//   - all monetary results are 6-decimal micros (BigInt); divide by 1e6 for display.
//
// On-chain tariff (lib.rs:603-632), reproduced exactly:
//   total_currency_value = amount * price / 1e9                    (u64 floor)
//   market_fee           = total_currency_value * fee_bps / 10000  (u64 floor)
//   wheeling_charge      = amount * wheeling_rate_per_kwh / 1e9     (u64 floor)  <- flat per-kWh
//   loss_cost            = total_currency_value * loss_bps / 10000  (u64 floor)
//   net_seller           = total - fee - wheeling - loss           (saturating)

import * as fs from "fs";
import * as path from "path";

export const ENERGY_DIVISOR = 1_000_000_000n; // 1e9, ENERGY_AMOUNT_DECIMALS_DIVISOR
export const CURRENCY_UNIT = 1_000_000n; // 1e6, 6-dec currency base units per whole unit

/** micros (6-dec) from a whole per-kWh price like 3.45 -> 3_450_000n */
export function priceMicros(perKwh: number): bigint {
  return BigInt(Math.round(perKwh * 1e6));
}

/** atomic 9-dec kWh from a float kWh */
export function toAtomic(kwh: number): bigint {
  return BigInt(Math.round(kwh * 1e9));
}

// ---- Dataset loading -------------------------------------------------------

export interface Meta {
  meters: number;
  prosumers: number;
  days: number;
  prosumer_idx: number[];
  export_cap_kwh: number;
  readings: number;
}

// daily.json layout: [ day ][ meter ] = { g, c, s }  (kWh floats; s = capped surplus)
export type DailyCell = { g: number; c: number; s: number };
export type Daily = DailyCell[][];

export interface Dataset {
  meta: Meta;
  daily: Daily;
  dir: string;
}

export function loadDataset(dir: string): Dataset {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8")) as Meta;
  const daily = JSON.parse(fs.readFileSync(path.join(dir, "daily.json"), "utf8")) as Daily;
  return { meta, daily, dir };
}

/**
 * Total tradeable prosumer surplus (kWh) over `days` (default: full horizon),
 * summing the already-capped `s` field of each prosumer meter each day.
 * This is the "reduced order book" volume the three schemes all price.
 */
export function tradeableSupplyKwh(ds: Dataset, days?: number): number {
  const D = days ?? ds.daily.length;
  const pros = new Set(ds.meta.prosumer_idx);
  let total = 0;
  for (let d = 0; d < D && d < ds.daily.length; d++) {
    const row = ds.daily[d];
    for (const m of pros) {
      const cell = row[m];
      if (cell) total += cell.s;
    }
  }
  return total;
}

// ---- Tranche construction --------------------------------------------------

// The discovered-price ladder (whole per-kWh). Four tranches so the whole book
// fits a single clear_auction transaction (4 sells + 4 buys, per the tx-size cap).
export const ASK_LADDER = [3.0, 3.15, 3.3, 3.45];

export interface Tranche {
  kwh: number;
  priceMicros: bigint;
}

/**
 * Split total volume into equal-volume tranches, one per ask-ladder rung.
 * Documented, deterministic construction (replaces the lost script's arbitrary
 * split): each rung carries an equal share of volume, last rung absorbs the
 * rounding remainder so tranche kWh sums EXACTLY to `totalKwh`.
 */
export function buildTranches(totalKwh: number, ladder: number[] = ASK_LADDER): Tranche[] {
  const n = ladder.length;
  const share = totalKwh / n;
  const out: Tranche[] = [];
  let assigned = 0;
  for (let i = 0; i < n; i++) {
    const kwh = i === n - 1 ? totalKwh - assigned : share;
    assigned += kwh;
    out.push({ kwh, priceMicros: priceMicros(ladder[i]) });
  }
  return out;
}

// ---- Tariff (exact on-chain integer arithmetic) ----------------------------

export interface Tariff {
  feeBps: bigint; // market_fee_bps
  lossBps: bigint; // tariff_config.loss_bps
  wheelingRateMicros: bigint; // tariff_config.wheeling_rate_per_kwh (6-dec per whole kWh)
}

export const DEFAULT_TARIFF: Tariff = {
  feeBps: 25n,
  lossBps: 5n,
  wheelingRateMicros: priceMicros(1.15), // 1.15/kWh flat wheeling
};

export interface Charge {
  gross: bigint;
  fee: bigint;
  wheeling: bigint;
  loss: bigint;
  net: bigint;
}

/** One fill: atomic energy at a 6-dec price, taxed by the tariff. Exact floors. */
export function chargeFill(atomicAmt: bigint, price: bigint, t: Tariff): Charge {
  const gross = (atomicAmt * price) / ENERGY_DIVISOR;
  const fee = (gross * t.feeBps) / 10_000n;
  const wheeling = (atomicAmt * t.wheelingRateMicros) / ENERGY_DIVISOR;
  const loss = (gross * t.lossBps) / 10_000n;
  let net = gross - fee - wheeling - loss;
  if (net < 0n) net = 0n; // saturating_sub
  return { gross, fee, wheeling, loss, net };
}

function sumCharges(cs: Charge[]): Charge {
  return cs.reduce(
    (a, c) => ({
      gross: a.gross + c.gross,
      fee: a.fee + c.fee,
      wheeling: a.wheeling + c.wheeling,
      loss: a.loss + c.loss,
      net: a.net + c.net,
    }),
    { gross: 0n, fee: 0n, wheeling: 0n, loss: 0n, net: 0n },
  );
}

// ---- Scheme evaluators -----------------------------------------------------

export interface SchemeResult {
  scheme: "uniform" | "cda" | "buyback";
  volKwh: number;
  charge: Charge;
  netPerKwh: number; // net / volume, whole units
}

const netPerKwh = (net: bigint, volKwh: number) =>
  volKwh === 0 ? 0 : Number(net) / 1e6 / volKwh;

/**
 * Uniform-price auction: whole book clears at the marginal (top) ladder ask.
 *
 * GUARD: this clears at MAX ask UNCONDITIONALLY — it never inspects a demand curve.
 * It matches on-chain trading.clear_auction / find_clearing_point ONLY because the
 * driver (price-models-onchain.ts) pins every bid at the top ask, forcing the whole
 * book to cross so the marginal ask == the max ask. If bids ever go data-driven
 * (some below the top ask), on-chain clearing falls below MAX ask and this function
 * over-predicts. Making the ladder data-driven REQUIRES rewriting this to consume the
 * real demand curve (mirror find_clearing_point), not just changing the driver.
 */
export function evalUniform(tranches: Tranche[], t: Tariff = DEFAULT_TARIFF): SchemeResult {
  const volKwh = tranches.reduce((a, tr) => a + tr.kwh, 0);
  const clearing = tranches.reduce((mx, tr) => (tr.priceMicros > mx ? tr.priceMicros : mx), 0n);
  const charge = chargeFill(toAtomic(volKwh), clearing, t);
  return { scheme: "uniform", volKwh, charge, netPerKwh: netPerKwh(charge.net, volKwh) };
}

/** Discriminatory CDA: each tranche settles at its OWN ask (pay-as-bid). */
export function evalCda(tranches: Tranche[], t: Tariff = DEFAULT_TARIFF): SchemeResult {
  const volKwh = tranches.reduce((a, tr) => a + tr.kwh, 0);
  const charge = sumCharges(tranches.map((tr) => chargeFill(toAtomic(tr.kwh), tr.priceMicros, t)));
  return { scheme: "cda", volKwh, charge, netPerKwh: netPerKwh(charge.net, volKwh) };
}

/** Regulated feed-in buy-back baseline: flat rate, tariff-exempt (no wheeling/fee). */
export function evalBuyback(volKwh: number, ratePerKwh = 2.2): SchemeResult {
  const gross = (toAtomic(volKwh) * priceMicros(ratePerKwh)) / ENERGY_DIVISOR;
  const charge: Charge = { gross, fee: 0n, wheeling: 0n, loss: 0n, net: gross };
  return { scheme: "buyback", volKwh, charge, netPerKwh: netPerKwh(gross, volKwh) };
}

export interface Comparison {
  volKwh: number;
  uniform: SchemeResult;
  cda: SchemeResult;
  buyback: SchemeResult;
}

/** Full three-scheme comparison on a dataset over `days`. */
export function comparePriceModels(ds: Dataset, days?: number, t: Tariff = DEFAULT_TARIFF): Comparison {
  const volKwh = tradeableSupplyKwh(ds, days);
  const tranches = buildTranches(volKwh);
  return {
    volKwh,
    uniform: evalUniform(tranches, t),
    cda: evalCda(tranches, t),
    buyback: evalBuyback(volKwh),
  };
}
