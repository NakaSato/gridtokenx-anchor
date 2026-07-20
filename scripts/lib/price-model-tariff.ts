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

/** One cumulative point on a supply/demand curve, matching on-chain `CurvePoint`
 *  (programs/trading/src/lib.rs): price in 6-dec micros, volume in atomic (9-dec) kWh. */
export interface CurvePoint {
  price: bigint;
  cumAtomic: bigint;
}

/** Cumulative curve from a tranche ladder. Supply sorts ASC by price, demand DESC —
 *  the exact order on-chain clear_auction imposes before building the curves. */
function cumulativeCurve(tranches: Tranche[], desc: boolean): CurvePoint[] {
  const cmp = (a: Tranche, b: Tranche) => {
    if (a.priceMicros === b.priceMicros) return 0;
    const lt = a.priceMicros < b.priceMicros;
    return (desc ? !lt : lt) ? -1 : 1;
  };
  let cum = 0n;
  return [...tranches].sort(cmp).map((tr) => {
    cum += toAtomic(tr.kwh);
    return { price: tr.priceMicros, cumAtomic: cum };
  });
}

/**
 * Faithful TS port of on-chain `find_clearing_point` (programs/trading/src/lib.rs:1048).
 * Scans every (supply, demand) pair where ask <= bid and keeps the crossing with the
 * MAX volume; the clearing price is that crossing's marginal ASK price (supply side),
 * volume = min(cum_supply, cum_demand). Ties keep the earliest (lowest ask), since
 * supply is ASC and the comparison is strict `>` — identical to the Rust loop.
 * Returns null when no ask crosses any bid (on-chain: InvalidPrice / InvalidAmount).
 */
export function findClearingPoint(
  supply: CurvePoint[],
  demand: CurvePoint[],
): { price: bigint; volumeAtomic: bigint } | null {
  let bestPrice = 0n;
  let bestVolume = 0n;
  for (const s of supply) {
    for (const d of demand) {
      if (s.price <= d.price) {
        const vol = s.cumAtomic < d.cumAtomic ? s.cumAtomic : d.cumAtomic;
        if (vol > bestVolume) {
          bestVolume = vol;
          bestPrice = s.price;
        }
      }
    }
  }
  if (bestPrice === 0n || bestVolume === 0n) return null;
  return { price: bestPrice, volumeAtomic: bestVolume };
}

/** Exact predicted (price, volume) of clear_auction on an arbitrary book —
 *  the same crossing evalUniformAuction settles, exposed for on-chain verify. */
export function predictUniformClearing(
  asks: Tranche[],
  bids: Tranche[],
): { price: bigint; volumeAtomic: bigint } | null {
  return findClearingPoint(cumulativeCurve(asks, false), cumulativeCurve(bids, true));
}

/**
 * General uniform-price auction — mirrors on-chain clear_auction against an ARBITRARY
 * bid ladder: clears the max-volume crossing at the single marginal ask price, then
 * applies the tariff to the CLEARED volume only (a partial cross settles less than the
 * full book). Use this whenever bids are data-driven; `evalUniform` is the flat-top
 * special case. No cross -> zero-volume, zero-charge result.
 */
export function evalUniformAuction(
  asks: Tranche[],
  bids: Tranche[],
  t: Tariff = DEFAULT_TARIFF,
): SchemeResult {
  const cp = findClearingPoint(cumulativeCurve(asks, false), cumulativeCurve(bids, true));
  if (!cp) {
    return {
      scheme: "uniform",
      volKwh: 0,
      charge: { gross: 0n, fee: 0n, wheeling: 0n, loss: 0n, net: 0n },
      netPerKwh: 0,
    };
  }
  const volKwh = Number(cp.volumeAtomic) / 1e9;
  const charge = chargeFill(cp.volumeAtomic, cp.price, t);
  return { scheme: "uniform", volKwh, charge, netPerKwh: netPerKwh(charge.net, volKwh) };
}

/**
 * Uniform-price auction. With no `bids`, this is the flat-top special case the §4.7
 * driver uses: every bid pinned at the top ask, so the whole book crosses and clears
 * at the marginal == max ask. Kept as a bit-exact fast path so committed §4.7 numbers
 * are unchanged. Pass a real `bids` ladder to model data-driven demand — it delegates
 * to `evalUniformAuction` (a faithful find_clearing_point port), so the on-chain /
 * off-chain equivalence then holds for ANY bid ladder, not just flat-top.
 */
export function evalUniform(
  tranches: Tranche[],
  t: Tariff = DEFAULT_TARIFF,
  bids?: Tranche[],
): SchemeResult {
  if (bids) return evalUniformAuction(tranches, bids, t);
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

// ---- Endogenous demand (consumer-consumption-derived bid ladder) -----------

export interface DemandParams {
  /** participation share: fraction of each consumer's consumption offered as a
   *  P2P bid. Keeps demand on the same scale as the ~1% surplus/consumption
   *  ratio of the physical fleets so the crossing is non-degenerate. */
  alpha: number;
  /** willingness-to-pay band (whole THB/kWh) the consumption ranking is mapped
   *  into. Proxy for a progressive retail tariff: heavier consumers face a
   *  higher marginal retail rate, so their avoided cost — and thus WTP — is
   *  higher. Stylised band, not a measured tariff. */
  bandLo: number;
  bandHi: number;
  /** number of bid tranches (4 keeps clear_auction in one tx, like the asks). */
  buckets: number;
}

export const DEFAULT_DEMAND: DemandParams = { alpha: 0.02, bandLo: 2.6, bandHi: 4.1, buckets: 4 };

/**
 * Build a data-driven bid ladder from the fleet's CONSUMER (non-prosumer) daily
 * consumption. Deterministic — no RNG:
 *   1. total each consumer's consumption over the horizon (daily.json `c`);
 *   2. sort ascending and split into `buckets` equal-count groups
 *      (last group absorbs the remainder);
 *   3. bid quantity of a group = alpha × its total consumption;
 *   4. bid price of a group = bandLo + (bandHi − bandLo) × mean/maxMean —
 *      groups with heavier mean consumption bid closer to bandHi (progressive-
 *      retail-tariff proxy), the heaviest group bids exactly bandHi.
 * Both quantities AND prices are functions of the dataset, so different fleets
 * (and different horizons) produce genuinely different demand curves.
 */
export function buildDemandTranches(
  ds: Dataset,
  days?: number,
  p: DemandParams = DEFAULT_DEMAND,
): Tranche[] {
  const D = days ?? ds.daily.length;
  const pros = new Set(ds.meta.prosumer_idx);
  const perConsumer: number[] = [];
  for (let m = 0; m < ds.meta.meters; m++) {
    if (pros.has(m)) continue;
    let c = 0;
    for (let d = 0; d < D && d < ds.daily.length; d++) c += ds.daily[d][m]?.c ?? 0;
    perConsumer.push(c);
  }
  perConsumer.sort((a, b) => a - b);
  const n = perConsumer.length;
  const per = Math.floor(n / p.buckets);
  const groups: number[][] = [];
  for (let b = 0; b < p.buckets; b++) {
    const start = b * per;
    const end = b === p.buckets - 1 ? n : start + per;
    groups.push(perConsumer.slice(start, end));
  }
  const means = groups.map((g) => g.reduce((a, x) => a + x, 0) / Math.max(1, g.length));
  const maxMean = Math.max(...means);
  return groups.map((g, i) => ({
    kwh: g.reduce((a, x) => a + x, 0) * p.alpha,
    priceMicros: priceMicros(p.bandLo + (p.bandHi - p.bandLo) * (maxMean > 0 ? means[i] / maxMean : 1)),
  }));
}

/** One CDA fill: quantity at the SELLER's ask (pay-as-ask, on-chain p* = p_s). */
export interface CdaFill {
  kwh: number;
  askMicros: bigint;
  bidMicros: bigint;
}

/**
 * Greedy CDA sweep over two tranche ladders: asks ascending, bids descending;
 * while the best bid crosses the best ask, fill min(remaining) at the ASK price
 * (matching on-chain match_orders, lib.rs:462). Returns the fill list (for
 * driving the chain) plus the tariffed SchemeResult over the CLEARED volume —
 * with real bids the book may only partially clear.
 */
export function evalCdaCross(
  asks: Tranche[],
  bids: Tranche[],
  t: Tariff = DEFAULT_TARIFF,
): SchemeResult & { fills: CdaFill[] } {
  const a = [...asks].sort((x, y) => (x.priceMicros < y.priceMicros ? -1 : 1)).map((x) => ({ ...x }));
  const b = [...bids].sort((x, y) => (x.priceMicros > y.priceMicros ? -1 : 1)).map((x) => ({ ...x }));
  const fills: CdaFill[] = [];
  let ai = 0, bi = 0;
  while (ai < a.length && bi < b.length) {
    if (b[bi].priceMicros < a[ai].priceMicros) break; // best bid below best ask: done
    const kwh = Math.min(a[ai].kwh, b[bi].kwh);
    if (kwh > 0) fills.push({ kwh, askMicros: a[ai].priceMicros, bidMicros: b[bi].priceMicros });
    a[ai].kwh -= kwh;
    b[bi].kwh -= kwh;
    if (a[ai].kwh <= 1e-12) ai++;
    if (b[bi].kwh <= 1e-12) bi++;
  }
  const volKwh = fills.reduce((s, f) => s + f.kwh, 0);
  const charge = sumCharges(fills.map((f) => chargeFill(toAtomic(f.kwh), f.askMicros, t)));
  return { scheme: "cda", volKwh, charge, netPerKwh: netPerKwh(charge.net, volKwh), fills };
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
