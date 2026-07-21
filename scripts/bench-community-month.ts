/**
 * bench-community-month.ts — 1-month community pipeline benchmark (for the paper).
 *
 * Replays a simulator-generated month of telemetry for a real 80-meter community
 * (12 solar prosumers + 68 consumers, from gridtokenx-smartmeter-simulator's
 * seeded fleet + solar/load models) into the oracle, then runs 30 daily trading
 * sessions in which the 12 prosumers each sell min(actual daily surplus, 10 kWh)
 * and the 68 consumers bid their actual daily consumption.
 *
 * Telemetry replay strategy: the oracle enforces strictly-increasing per-meter
 * reading timestamps (min_reading_interval = 60 s), so two readings of the same
 * meter can never be safely in flight at once. Readings therefore ship as
 * per-meter BATCHED transactions — up to BATCH submit_meter_reading instructions
 * per tx (sequential execution inside one tx preserves order) — with the 80
 * meter chains running in parallel. Readings that would trip the on-chain
 * anomaly gate (consumed > 0 && produced*100 > ratio*consumed, ratio = 1000)
 * are classified client-side and sent as SINGLETON txs so the on-chain
 * rejection is still measured without aborting a whole batch (a failed ix
 * aborts its entire tx).
 *
 * Timestamps are the dataset's historical ones (whole month in the past): the
 * oracle only rejects future stamps, so a month replays back-to-back with no
 * inter-epoch waits.
 *
 * Inputs (DATA_DIR, produced by export_month_dataset.py):
 *   meters.json readings.jsonl daily.json meta.json
 *
 * Phase 3 (token lifecycle) closes the loop daily per prosumer: registry sync +
 * settle_and_mint (GRID mint of the capped, oracle-accepted surplus, Token-2022)
 * → escrow deposit → Ed25519-signed settle_offchain_match against a rotating
 * consumer (v0 tx + ALT) → buyer withdraw + burn (delivered energy retired).
 * Month-end, the cap-withheld surplus is certified as RECs via governance
 * issue_erc (CPIs registry mark_erc_claimed, so GRID + REC ≤ metered generation).
 *
 * Env: ANCHOR_PROVIDER_URL, ANCHOR_WALLET, DATA_DIR.
 * Overrides: BATCH, ZONE_ID, SELL_CAP_KWH, STATUS_POLL_MS, CONFIRM_TIMEOUT_SEC,
 *            BLOCKHASH_MS, MAX_INFLIGHT (order bursts), CU_SAMPLE, ORDER_ID_BASE.
 * Requires: validator up; oracle, trading, registry, governance, energy_token
 *           deployed; bootstrap.ts + init-shards.ts ran (governance/tariff/
 *           aggregator/energy-token/registry/currency-mint init).
 */
import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Oracle } from "../target/types/oracle";
import { Trading } from "../target/types/trading";
import { Registry } from "../target/types/registry";
import { EnergyToken } from "../target/types/energy_token";
import { Governance } from "../target/types/governance";
import {
  PublicKey, Keypair, SystemProgram, Transaction, ComputeBudgetProgram,
  TransactionMessage, VersionedTransaction, AddressLookupTableProgram, Ed25519Program,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction,
  createMintToInstruction,
} from "@solana/spl-token";
import BN from "bn.js";
import * as fs from "fs";
import * as path from "path";
import bs58 from "bs58";

const DATA_DIR = process.env.DATA_DIR!;
if (!DATA_DIR) throw new Error("DATA_DIR required");
const BATCH = parseInt(process.env.BATCH || "10", 10);
const ZONE_ID = parseInt(process.env.ZONE_ID || "702", 10);
const SELL_CAP_KWH = parseFloat(process.env.SELL_CAP_KWH || "10");
const STATUS_POLL_MS = parseInt(process.env.STATUS_POLL_MS || "1500", 10);
const CONFIRM_TIMEOUT_SEC = parseInt(process.env.CONFIRM_TIMEOUT_SEC || "90", 10);
const BLOCKHASH_MS = parseInt(process.env.BLOCKHASH_MS || "10000", 10);
const MAX_INFLIGHT = parseInt(process.env.MAX_INFLIGHT || "3000", 10);
const CU_SAMPLE = parseInt(process.env.CU_SAMPLE || "300", 10);
const ORDER_ID_BASE = BigInt(process.env.ORDER_ID_BASE || String(Date.now()) + "000000");
const ANOMALY_RATIO = 1000n; // oracle default max_production_consumption_ratio
const SHARDS = 16;
// Debug knobs: skip already-validated phases when re-running against a validator
// that still holds their state (Phase 3 only needs Phase 1's oracle totals).
const SKIP_P1 = process.env.SKIP_P1 === "1";
const SKIP_P2 = process.env.SKIP_P2 === "1";
// Price model for the settlement phase:
//   fixed   — legacy behaviour (4.00 THB execution, 4.50/3.90 limits)
//   uniform — uniform-price epoch clearing: every match executes at the top ask (3.45)
//   cda     — CDA seller-quote rule: each match executes at its seller's own ask
//   buyback — regulated feed-in baseline: no P2P trade; the seller retires (burns)
//             the minted GRID directly and the 2.20 THB/kWh value is accounted
//             off-chain (a feed-in payment never touches the order book)
const PRICE_MODEL = process.env.PRICE_MODEL || "fixed";
if (!["fixed", "uniform", "cda", "buyback"].includes(PRICE_MODEL)) throw new Error(`bad PRICE_MODEL ${PRICE_MODEL}`);
// Ask ladder mirrors the §9.6 mechanism-comparison experiment (THB 6-dec micros).
const ASK_LADDER_MICROS = [3_000_000, 3_150_000, 3_300_000, 3_450_000];
const BUYBACK_RATE_MICROS = 2_200_000;

interface Reading { m: number; t: number; g: number; c: number }
interface MeterInfo { idx: number; chain_id: string; meter_type: string; solar: boolean }

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}
function median(a: number[]): number { return pct([...a].sort((x, y) => x - y), 50); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Shared confirm registry: sig → pending promise, resolved by one bulk poller ──
type TxOutcome = { status: "ok" | "err" | "expired"; err?: string; latMs: number };
class Confirmer {
  pending = new Map<string, { t0: number; resolve: (o: TxOutcome) => void }>();
  private on = true;
  constructor(private conn: anchor.web3.Connection) { this.loop(); }
  watch(sig: string, t0: number): Promise<TxOutcome> {
    return new Promise((resolve) => {
      this.pending.set(sig, { t0, resolve });
      setTimeout(() => {
        const e = this.pending.get(sig);
        if (e) { this.pending.delete(sig); e.resolve({ status: "expired", latMs: Date.now() - t0 }); }
      }, CONFIRM_TIMEOUT_SEC * 1000);
    });
  }
  stop() { this.on = false; }
  private async loop() {
    while (this.on) {
      await sleep(STATUS_POLL_MS);
      const sigs = [...this.pending.keys()];
      for (let i = 0; i < sigs.length; i += 256) {
        const chunk = sigs.slice(i, i + 256);
        try {
          const res = await this.conn.getSignatureStatuses(chunk);
          const now = Date.now();
          res.value.forEach((st, j) => {
            const sig = chunk[j];
            const e = this.pending.get(sig);
            if (!e || !st) return;
            if (st.err) {
              this.pending.delete(sig);
              e.resolve({ status: "err", err: JSON.stringify(st.err), latMs: now - e.t0 });
            } else if (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized") {
              this.pending.delete(sig);
              e.resolve({ status: "ok", latMs: now - e.t0 });
            }
          });
        } catch { /* transient */ }
      }
    }
  }
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const oracle = anchor.workspace.Oracle as Program<Oracle>;
  const trading = anchor.workspace.Trading as Program<Trading>;
  const gateway = (provider.wallet as any).payer as Keypair;
  const conn = provider.connection;

  const meta = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "meta.json"), "utf8"));
  const meters: MeterInfo[] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "meters.json"), "utf8"));
  const daily: { g: number; c: number; s: number }[][] =
    JSON.parse(fs.readFileSync(path.join(DATA_DIR, "daily.json"), "utf8"));
  console.log(`dataset: ${meta.meters} meters (${meta.prosumers} prosumers), ${meta.days} days, ${meta.readings} readings`);

  const oracleDataPda = PublicKey.findProgramAddressSync([Buffer.from("oracle_data")], oracle.programId)[0];
  const meterPdas = meters.map((m) =>
    PublicKey.findProgramAddressSync([Buffer.from("meter"), Buffer.from(m.chain_id)], oracle.programId)[0]);

  // ── Trading bootstrap (idempotent): market → zone_market → shards ─────────
  const [marketPda] = PublicKey.findProgramAddressSync([Buffer.from("market")], trading.programId);
  const zoneBuf = Buffer.alloc(4); zoneBuf.writeUInt32LE(ZONE_ID);
  const [zoneMarketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("zone_market"), marketPda.toBuffer(), zoneBuf], trading.programId);
  const shardPdas = Array.from({ length: SHARDS }, (_, s) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("zone_shard"), zoneMarketPda.toBuffer(), Buffer.from([s])], trading.programId)[0]);
  try {
    await trading.methods.initializeMarket(SHARDS).accounts({
      market: marketPda, authority: gateway.publicKey, systemProgram: SystemProgram.programId,
    } as any).rpc();
  } catch (e: any) { if (!/already in use/.test(e.message)) throw e; }
  try {
    await trading.methods.initializeZoneMarket(ZONE_ID, SHARDS, new BN("1000000000000000"), 0).accounts({
      market: marketPda, zoneMarket: zoneMarketPda, authority: gateway.publicKey,
      systemProgram: SystemProgram.programId,
    } as any).rpc();
  } catch (e: any) { if (!/already in use/.test(e.message)) throw e; }
  for (let s = 0; s < SHARDS; s++) {
    try {
      await trading.methods.initializeZoneMarketShard(s).accounts({
        zoneMarket: zoneMarketPda, zoneShard: shardPdas[s], payer: gateway.publicKey,
        systemProgram: SystemProgram.programId,
      } as any).rpc();
    } catch (e: any) { if (!/already in use/.test(e.message)) throw e; }
  }
  console.log("bootstrap: market + zone + 16 shards ready");

  // ── 80 node keypairs (order authorities), funded once ──────────────────────
  const nodes = meters.map(() => Keypair.generate());
  console.log("funding 80 node accounts...");
  for (let i = 0; i < nodes.length; i += 16) {
    await Promise.all(nodes.slice(i, i + 16).map(async (kp) => {
      const sig = await conn.requestAirdrop(kp.publicKey, 5_000_000_000);
      const bh = await conn.getLatestBlockhash("confirmed");
      await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
    }));
  }

  // ── Cached blockhash refresher ─────────────────────────────────────────────
  let cachedBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
  let refresherOn = true;
  const refresher = (async () => {
    while (refresherOn) {
      await sleep(BLOCKHASH_MS);
      try { cachedBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash; } catch { /* keep old */ }
    }
  })();

  const confirmer = new Confirmer(conn);

  // ═══════════════════════ PHASE 1 — telemetry replay ════════════════════════
  console.log(`\nPHASE 1: replaying ${meta.readings} readings (batch=${BATCH}, 80 parallel meter chains)...`);
  const perMeter: Reading[][] = meters.map(() => []);
  {
    const lines = fs.readFileSync(path.join(DATA_DIR, "readings.jsonl"), "utf8").split("\n");
    for (const ln of lines) {
      if (!ln) continue;
      const r: Reading = JSON.parse(ln);
      perMeter[r.m].push(r);
    }
  }

  // Chunk plan per meter: contiguous gate-passing runs → BATCH-sized txs;
  // gate-failing readings → singleton txs (expected on-chain AnomalousReading).
  // Also accumulate per-day surplus from gate-PASSING ticks only — the lifecycle
  // phase may only tokenize energy the oracle actually accepted (the registry's
  // update_meter_reading bounds registry totals by oracle totals).
  type Chunk = { readings: Reading[]; gateFail: boolean };
  const acceptedSurplusWh: number[][] = Array.from({ length: meta.days }, () => meters.map(() => 0));
  const chunkPlan: Chunk[][] = perMeter.map((rs, mi) => {
    const chunks: Chunk[] = [];
    let run: Reading[] = [];
    for (const r of rs) {
      const gateFail = r.c > 0 && BigInt(r.g) * 100n > ANOMALY_RATIO * BigInt(r.c);
      if (gateFail) {
        if (run.length) { chunks.push({ readings: run, gateFail: false }); run = []; }
        chunks.push({ readings: [r], gateFail: true });
      } else {
        run.push(r);
        if (run.length === BATCH) { chunks.push({ readings: run, gateFail: false }); run = []; }
        const day = Math.min(meta.days - 1, Math.floor((r.t - meta.start_ts) / 86400));
        if (r.g > r.c) acceptedSurplusWh[day][mi] += r.g - r.c;
      }
    }
    if (run.length) chunks.push({ readings: run, gateFail: false });
    return chunks;
  });
  const plannedGateFails = chunkPlan.flat().filter((c) => c.gateFail).length;
  const plannedTx = chunkPlan.reduce((a, c) => a + c.length, 0);
  console.log(`plan: ${plannedTx} txs (${plannedGateFails} anomaly singletons expected to reject on-chain)`);

  const p1 = {
    txSent: 0, txOk: 0, txErr: 0, txExpired: 0, sendErr: 0, retries: 0,
    readingsOk: 0, readingsValidationRejected: 0, readingsDeliveryFail: 0,
    latencies: [] as number[], errSamples: [] as string[],
    cuLog: [] as { sig: string; n: number }[],
  };
  const sampleErr = (arr: string[], cat: string, msg: string) => {
    if (arr.length < 12 && !arr.some((s) => s.includes(msg.slice(0, 40)))) arr.push(`${cat}: ${msg.slice(0, 160)}`);
  };

  const p1Start = Date.now();
  let metersDone = 0;
  async function meterWorker(mi: number) {
    for (const chunk of chunkPlan[mi]) {
      let attempt = 0;
      while (true) {
        const tx = new Transaction();
        tx.add(ComputeBudgetProgram.setComputeUnitLimit({
          units: Math.min(1_400_000, 60_000 + 30_000 * chunk.readings.length),
        }));
        for (const r of chunk.readings) {
          tx.add(await oracle.methods
            .submitMeterReading(meters[mi].chain_id, new BN(r.g), new BN(r.c), new BN(r.t), ZONE_ID)
            .accounts({
              oracleData: oracleDataPda, meterState: meterPdas[mi],
              authority: gateway.publicKey, systemProgram: SystemProgram.programId,
            } as any)
            .instruction());
        }
        tx.feePayer = gateway.publicKey;
        tx.recentBlockhash = cachedBlockhash;
        tx.sign(gateway);
        const sig = bs58.encode(tx.signature!);
        const t0 = Date.now();
        let outcome: TxOutcome;
        try {
          const raw = tx.serialize();
          if (raw.length > 1232) throw new Error(`tx too large: ${raw.length}B for ${chunk.readings.length} readings`);
          await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });
          p1.txSent++;
          outcome = await confirmer.watch(sig, t0);
        } catch (e: any) {
          p1.sendErr++;
          sampleErr(p1.errSamples, "sendError", (e?.message || String(e)).split("\n")[0]);
          p1.readingsDeliveryFail += chunk.readings.length;
          break;
        }
        if (outcome.status === "ok") {
          p1.txOk++; p1.latencies.push(outcome.latMs);
          p1.readingsOk += chunk.readings.length;
          p1.cuLog.push({ sig, n: chunk.readings.length });
          if (p1.cuLog.length > CU_SAMPLE * 2) p1.cuLog.splice(0, p1.cuLog.length - CU_SAMPLE * 2);
          break;
        }
        if (outcome.status === "err") {
          p1.txErr++;
          if (chunk.gateFail) {
            p1.readingsValidationRejected += 1; // expected AnomalousReading
          } else {
            p1.readingsDeliveryFail += chunk.readings.length;
            sampleErr(p1.errSamples, "statusErr", outcome.err || "unknown");
          }
          break;
        }
        // expired — retry once with a fresh blockhash (idempotent: a late landing
        // makes the retry fail strictly-increasing-ts, which we then swallow)
        if (attempt === 0) { attempt++; p1.retries++; continue; }
        p1.txExpired++;
        p1.readingsDeliveryFail += chunk.readings.length;
        sampleErr(p1.errSamples, "expired", `chunk of ${chunk.readings.length} unconfirmed after retry`);
        break;
      }
    }
    metersDone++;
    if (metersDone % 20 === 0) {
      const el = (Date.now() - p1Start) / 1000;
      console.log(`   … ${metersDone}/80 meter chains done, readingsOk=${p1.readingsOk}, ${el.toFixed(0)}s`);
    }
  }
  if (SKIP_P1) console.log("   PHASE 1 SKIPPED (SKIP_P1=1) — assumes oracle totals already on chain");
  else await Promise.all(meters.map((_, mi) => meterWorker(mi)));
  const p1WallMs = Math.max(1, Date.now() - p1Start);

  // CU sample from tail (survives ledger rotation): amortized per reading
  const cuPerReading: number[] = [];
  const cuPerTx: number[] = [];
  const cuTail = p1.cuLog.slice(-CU_SAMPLE);
  for (let i = 0; i < cuTail.length; i += 16) {
    await Promise.all(cuTail.slice(i, i + 16).map(async ({ sig, n }) => {
      try {
        const tx = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
        const cu = tx?.meta?.computeUnitsConsumed;
        if (typeof cu === "number") { cuPerTx.push(cu); cuPerReading.push(Math.round(cu / n)); }
      } catch { /* skip */ }
    }));
  }

  const p1Lat = [...p1.latencies].sort((a, b) => a - b);
  const readingsPerSec = +(p1.readingsOk / (p1WallMs / 1000)).toFixed(2);
  console.log(`\nPHASE 1 done: ${p1.readingsOk}/${meta.readings} readings ok in ${(p1WallMs / 1000).toFixed(1)}s  (${readingsPerSec} readings/s, ${(p1.txOk / (p1WallMs / 1000)).toFixed(1)} tx/s)`);
  console.log(`   validation-rejected(on-chain)=${p1.readingsValidationRejected}  delivery-fail=${p1.readingsDeliveryFail}  retries=${p1.retries}`);
  console.log(`   CU/tx med=${median(cuPerTx)}  CU/reading med=${median(cuPerReading)}`);

  // ═══════════════════════ PHASE 2 — 30 daily trading sessions ═══════════════
  console.log(`\nPHASE 2: 30 daily order sessions (12 sellers capped at ${SELL_CAP_KWH} kWh/day, 68 buyers)...`);
  const prosumerIdx: number[] = meta.prosumer_idx;
  const consumerIdx = meters.map((m) => m.idx).filter((i) => !prosumerIdx.includes(i));

  interface DayStats {
    day: number; orders: number; ok: number; fail: number; wallMs: number; tps: number;
    latP50: number; latP95: number; offeredKwh: number; uncappedSurplusKwh: number; demandKwh: number;
  }
  const dayStats: DayStats[] = [];
  const p2 = { sendErr: 0, statusErr: 0, expired: 0, errSamples: [] as string[], cuSigs: [] as string[] };
  let orderSeq = 0;
  const p2Start = Date.now();

  for (let day = 0; day < (SKIP_P2 ? 0 : meta.days); day++) {
    type Slot = { node: Keypair; side: number; amountKwh: number; price: number };
    const slots: Slot[] = [];
    let offeredKwh = 0, uncapped = 0, demandKwh = 0;
    for (const i of prosumerIdx) {
      const s = daily[day][i].s;
      uncapped += s;
      const amt = Math.min(s, SELL_CAP_KWH);
      if (amt < 0.01) continue;
      offeredKwh += amt;
      slots.push({ node: nodes[i], side: 1, amountKwh: amt, price: 3_000_000 + (day % 10) * 20_000 });
    }
    for (const i of consumerIdx) {
      const c = daily[day][i].c;
      if (c < 0.01) continue;
      demandKwh += c;
      slots.push({ node: nodes[i], side: 0, amountKwh: c, price: 3_500_000 + (i % 5) * 100_000 });
    }

    const burstStart = Date.now();
    const results: Promise<TxOutcome | null>[] = [];
    for (const slot of slots) {
      while (confirmer.pending.size >= MAX_INFLIGHT) await sleep(10);
      const idx = orderSeq++;
      const orderId = new BN((ORDER_ID_BASE + BigInt(idx)).toString());
      const shard = idx % SHARDS;
      const [orderPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("order"), slot.node.publicKey.toBuffer(), orderId.toArrayLike(Buffer, "le", 8)],
        trading.programId);
      const amount = new BN(Math.round(slot.amountKwh * 1e9).toString());
      try {
        const ix = await trading.methods
          .submitLimitOrderSharded(orderId, slot.side, amount, new BN(slot.price), shard)
          .accounts({
            order: orderPda, zoneMarket: zoneMarketPda, zoneShard: shardPdas[shard],
            authority: slot.node.publicKey, systemProgram: SystemProgram.programId,
            governanceConfig: marketPda, // dead account in context — any account satisfies it
          } as any)
          .instruction();
        const tx = new Transaction();
        tx.feePayer = slot.node.publicKey;
        tx.recentBlockhash = cachedBlockhash;
        tx.add(ix);
        tx.sign(slot.node);
        const sig = bs58.encode(tx.signature!);
        const t0 = Date.now();
        await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 0 });
        const p = confirmer.watch(sig, t0).then((o) => {
          if (o.status === "err") { p2.statusErr++; sampleErr(p2.errSamples, "statusErr", o.err || ""); }
          else if (o.status === "expired") p2.expired++;
          else p2.cuSigs.length < 5000 && p2.cuSigs.push(sig);
          return o;
        });
        results.push(p);
      } catch (e: any) {
        p2.sendErr++;
        sampleErr(p2.errSamples, "sendError", (e?.message || String(e)).split("\n")[0]);
        results.push(Promise.resolve(null));
      }
    }
    const outcomes = await Promise.all(results);
    const okLat = outcomes.filter((o): o is TxOutcome => !!o && o.status === "ok").map((o) => o.latMs).sort((a, b) => a - b);
    const wallMs = Date.now() - burstStart;
    dayStats.push({
      day: day + 1, orders: slots.length, ok: okLat.length, fail: slots.length - okLat.length,
      wallMs, tps: +(okLat.length / (wallMs / 1000)).toFixed(2),
      latP50: pct(okLat, 50), latP95: pct(okLat, 95),
      offeredKwh: +offeredKwh.toFixed(3), uncappedSurplusKwh: +uncapped.toFixed(3), demandKwh: +demandKwh.toFixed(3),
    });
    if ((day + 1) % 10 === 0) console.log(`   … day ${day + 1}/30 done (${okLat.length}/${slots.length} ok, ${wallMs}ms)`);
  }
  if (SKIP_P2) console.log("   PHASE 2 SKIPPED (SKIP_P2=1)");
  const p2WallMs = Math.max(1, Date.now() - p2Start);

  const orderCu: number[] = [];
  for (const sig of p2.cuSigs.slice(-CU_SAMPLE)) {
    try {
      const tx = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      const cu = tx?.meta?.computeUnitsConsumed;
      if (typeof cu === "number") orderCu.push(cu);
    } catch { /* skip */ }
  }

  // ═══════════════════════ PHASE 3 — token lifecycle ═════════════════════════
  // Daily per prosumer: registry sync + settle_and_mint (GRID mint of the capped,
  // oracle-accepted surplus) → deposit to energy escrow → Ed25519-signed
  // settle_offchain_match against a rotating consumer → buyer withdraws + burns
  // (energy consumed = tokens retired). Month-end: the cap-withheld surplus is
  // certified as RECs via governance issue_erc (CPIs mark_erc_claimed, so
  // GRID + REC claims can never exceed metered generation).
  // Requires bootstrap.ts + init-shards.ts ran first (governance/tariff/aggregator/
  // energy-token/registry/currency-mint init).
  const registry = anchor.workspace.Registry as Program<Registry>;
  const energyToken = anchor.workspace.EnergyToken as Program<EnergyToken>;
  const governance = anchor.workspace.Governance as Program<Governance>;
  const RUN_SALT = ORDER_ID_BASE & 0xffffffffn;

  console.log(`\nPHASE 3: token lifecycle (mint → settle → burn → REC) for ${meta.prosumers} prosumers × ${meta.days} days...`);
  const [registryPda] = PublicKey.findProgramAddressSync([Buffer.from("registry")], registry.programId);
  const [tokenInfoPda] = PublicKey.findProgramAddressSync([Buffer.from("token_info_2022")], energyToken.programId);
  const [energyMintPda] = PublicKey.findProgramAddressSync([Buffer.from("mint_2022")], energyToken.programId);
  const [governanceConfigPda] = PublicKey.findProgramAddressSync([Buffer.from("governance_config")], governance.programId);
  const [tariffConfigPda] = PublicKey.findProgramAddressSync([Buffer.from("tariff_config")], trading.programId);
  const [aggregatorEntryPda] = PublicKey.findProgramAddressSync([Buffer.from("aggregator"), gateway.publicKey.toBuffer()], governance.programId);
  const [marketAuthorityPda] = PublicKey.findProgramAddressSync([Buffer.from("market_authority")], trading.programId);
  const [recMintPda] = PublicKey.findProgramAddressSync([Buffer.from("rec_mint")], governance.programId);
  const currencyMintKp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("currency-mint.json", "utf8"))));
  const currencyMint = currencyMintKp.publicKey;

  const escrowPda = (user: PublicKey, mint: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("escrow"), user.toBuffer(), mint.toBuffer()], trading.programId)[0];
  const collectorPda = (label: string, mint: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from(label), mint.toBuffer()], trading.programId)[0];
  const nullifierPda = (user: PublicKey, orderId: Buffer) =>
    PublicKey.findProgramAddressSync([Buffer.from("nullifier"), user.toBuffer(), orderId], trading.programId)[0];

  // Mirrors OffchainOrderPayload::get_message() in settle_offchain.rs.
  function orderMessage(p: { orderId: Buffer; user: PublicKey; energyAmount: number; pricePerKwh: number; side: number; zoneId: number; expiresAt: number }): Buffer {
    const b = Buffer.alloc(16 + 32 + 8 + 8 + 1 + 4 + 8);
    let o = 0;
    p.orderId.copy(b, o); o += 16;
    p.user.toBuffer().copy(b, o); o += 32;
    b.writeBigUInt64LE(BigInt(p.energyAmount), o); o += 8;
    b.writeBigUInt64LE(BigInt(p.pricePerKwh), o); o += 8;
    b.writeUInt8(p.side, o); o += 1;
    b.writeUInt32LE(p.zoneId, o); o += 4;
    b.writeBigInt64LE(BigInt(p.expiresAt), o); o += 8;
    return b;
  }

  type Stage = "mint" | "deposit" | "settle" | "burn" | "rec";
  const p3 = Object.fromEntries((["mint", "deposit", "settle", "burn", "rec"] as Stage[]).map((s) =>
    [s, { ok: 0, fail: 0, lat: [] as number[], sigs: [] as string[], errs: [] as string[] }])) as
    Record<Stage, { ok: number; fail: number; lat: number[]; sigs: string[]; errs: string[] }>;

  // Sequential send helper: legacy or v0 tx, confirm via the shared poller,
  // one retry on expiry with a fresh blockhash.
  async function sendStep(stage: Stage, build: (bh: string) => Transaction | VersionedTransaction): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const tx = build(cachedBlockhash);
      const raw = tx.serialize();
      const sig = bs58.encode(tx instanceof VersionedTransaction ? tx.signatures[0] : (tx as Transaction).signature!);
      const t0 = Date.now();
      try {
        await conn.sendRawTransaction(raw as Buffer, { skipPreflight: true, maxRetries: 0 });
      } catch (e: any) {
        p3[stage].fail++;
        sampleErr(p3[stage].errs, "sendError", (e?.message || String(e)).split("\n")[0]);
        return false;
      }
      const o = await confirmer.watch(sig, t0);
      if (o.status === "ok") {
        p3[stage].ok++; p3[stage].lat.push(o.latMs);
        p3[stage].sigs.length < 2000 && p3[stage].sigs.push(sig);
        return true;
      }
      if (o.status === "err") {
        p3[stage].fail++;
        sampleErr(p3[stage].errs, "statusErr", o.err || "unknown");
        return false;
      }
      // expired → retry once with the (refreshed) cached blockhash
    }
    p3[stage].fail++;
    sampleErr(p3[stage].errs, "expired", "unconfirmed after retry");
    return false;
  }
  const legacy = (ixs: anchor.web3.TransactionInstruction[], feePayer: Keypair, extra: Keypair[] = [], sigPatch: PublicKey[] = []) => (bh: string) => {
    for (const ix of ixs) for (const k of ix.keys) if (sigPatch.some((p) => k.pubkey.equals(p))) k.isSigner = true;
    const tx = new Transaction();
    tx.feePayer = feePayer.publicKey;
    tx.recentBlockhash = bh;
    tx.add(...ixs);
    tx.sign(feePayer, ...extra);
    return tx;
  };

  // ── One-time lifecycle bootstrap (idempotent) ──────────────────────────────
  try {
    await governance.methods.initRecMint().accounts({
      governanceConfig: governanceConfigPda, recMint: recMintPda, authority: gateway.publicKey,
      tokenProgram: TOKEN_2022_PROGRAM_ID, systemProgram: SystemProgram.programId,
    } as any).rpc();
  } catch { /* already initialized */ }
  try {
    await trading.methods.initializeCollectors().accounts({
      payer: gateway.publicKey, currencyMint,
      feeCollector: collectorPda("fee_collector", currencyMint),
      wheelingCollector: collectorPda("wheeling_collector", currencyMint),
      lossCollector: collectorPda("loss_collector", currencyMint),
      marketAuthority: marketAuthorityPda,
      tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    } as any).rpc();
  } catch { /* already initialized */ }
  // Settlement writes payer-derived market/zone shards.
  const marketAcct: any = await trading.account.market.fetch(marketPda);
  const zoneAcct: any = await trading.account.zoneMarket.fetch(zoneMarketPda);
  const marketShardByte = gateway.publicKey.toBuffer()[0] % (Number(marketAcct.numShards) || 16);
  const zoneShardByte = gateway.publicKey.toBuffer()[0] % (Number(zoneAcct.numShards) || 16);
  const marketShardPda = PublicKey.findProgramAddressSync([Buffer.from("market_shard"), marketPda.toBuffer(), Buffer.from([marketShardByte])], trading.programId)[0];
  const zoneShardPdaSettle = PublicKey.findProgramAddressSync([Buffer.from("zone_shard"), zoneMarketPda.toBuffer(), Buffer.from([zoneShardByte])], trading.programId)[0];
  try {
    await trading.methods.initializeMarketShard(marketShardByte).accounts({
      market: marketPda, marketShard: marketShardPda, payer: gateway.publicKey, systemProgram: SystemProgram.programId,
    } as any).rpc();
  } catch { /* already initialized */ }

  // ── Participant setup ──────────────────────────────────────────────────────
  const prosumers = prosumerIdx.map((i) => ({ idx: i, kp: nodes[i], meterId: meters[i].chain_id }));
  const buyers = consumerIdx.map((i) => ({ idx: i, kp: nodes[i] }));
  const engAta = (owner: PublicKey) => getAssociatedTokenAddressSync(energyMintPda, owner, false, TOKEN_2022_PROGRAM_ID);
  const curAta = (owner: PublicKey) => getAssociatedTokenAddressSync(currencyMint, owner, false, TOKEN_PROGRAM_ID);

  console.log("   setting up 12 prosumers (register_user/meter, ATAs, escrow seeds)...");
  await Promise.all(prosumers.map(async (p) => {
    const shardId = p.kp.publicKey.toBytes()[0] % 16;
    const [userPda] = PublicKey.findProgramAddressSync([Buffer.from("user"), p.kp.publicKey.toBuffer()], registry.programId);
    const [regShardPda] = PublicKey.findProgramAddressSync([Buffer.from("registry_shard"), Buffer.from([shardId])], registry.programId);
    const [regMeterPda] = PublicKey.findProgramAddressSync([Buffer.from("meter"), p.kp.publicKey.toBuffer(), Buffer.from(p.meterId)], registry.programId);
    const regUserIx = await registry.methods
      .registerUser({ prosumer: {} } as any, 13756300, 100501800, new BN(0), shardId)
      .accounts({
        userAccount: userPda, registryShard: regShardPda, registry: registryPda,
        authority: p.kp.publicKey, payer: gateway.publicKey, systemProgram: SystemProgram.programId,
      } as any).instruction();
    const regMeterIx = await registry.methods
      .registerMeter(p.meterId, { solar: {} } as any, shardId, ZONE_ID)
      .accounts({
        meterAccount: regMeterPda, userAccount: userPda, registryShard: regShardPda, registry: registryPda,
        owner: p.kp.publicKey, payer: gateway.publicKey, systemProgram: SystemProgram.programId,
      } as any).instruction();
    const ataIxs = [
      createAssociatedTokenAccountInstruction(gateway.publicKey, engAta(p.kp.publicKey), p.kp.publicKey, energyMintPda, TOKEN_2022_PROGRAM_ID),
      createAssociatedTokenAccountInstruction(gateway.publicKey, curAta(p.kp.publicKey), p.kp.publicKey, currencyMint, TOKEN_PROGRAM_ID),
      createMintToInstruction(currencyMint, curAta(p.kp.publicKey), gateway.publicKey, 10),
    ];
    await sendStep("mint", legacy([regUserIx, regMeterIx, ...ataIxs], gateway, [p.kp], [p.kp.publicKey]));
    // Seed the seller's RECEIVING currency escrow (settle does not init escrows).
    const seedDep = await trading.methods.depositEscrow(new BN(10)).accounts({
      user: p.kp.publicKey, mint: currencyMint, userWallet: curAta(p.kp.publicKey),
      userEscrow: escrowPda(p.kp.publicKey, currencyMint), marketAuthority: marketAuthorityPda,
      tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    } as any).instruction();
    await sendStep("deposit", legacy([seedDep], p.kp));
  }));

  console.log("   setting up 68 buyers (ATAs, currency budget, escrow seeds)...");
  if (PRICE_MODEL === "buyback") console.log("   (buyback model: buyers and ALT are not needed — skipping)");
  for (let i = 0; PRICE_MODEL !== "buyback" && i < buyers.length; i += 8) {
    await Promise.all(buyers.slice(i, i + 8).map(async (b) => {
      const setup = [
        createAssociatedTokenAccountInstruction(gateway.publicKey, curAta(b.kp.publicKey), b.kp.publicKey, currencyMint, TOKEN_PROGRAM_ID),
        createAssociatedTokenAccountInstruction(gateway.publicKey, engAta(b.kp.publicKey), b.kp.publicKey, energyMintPda, TOKEN_2022_PROGRAM_ID),
        createMintToInstruction(currencyMint, curAta(b.kp.publicKey), gateway.publicKey, 1_000_000_000),
      ];
      const mintSeed = await energyToken.methods.mintToWallet(new BN(1)).accounts({
        mint: energyMintPda, tokenInfo: tokenInfoPda, destination: engAta(b.kp.publicKey),
        destinationOwner: b.kp.publicKey, authority: gateway.publicKey, recValidator: gateway.publicKey,
        payer: gateway.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      } as any).instruction();
      await sendStep("mint", legacy([...setup, mintSeed], gateway, [], [gateway.publicKey]));
      const depCur = await trading.methods.depositEscrow(new BN(1_000_000_000)).accounts({
        user: b.kp.publicKey, mint: currencyMint, userWallet: curAta(b.kp.publicKey),
        userEscrow: escrowPda(b.kp.publicKey, currencyMint), marketAuthority: marketAuthorityPda,
        tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      } as any).instruction();
      const depEng = await trading.methods.depositEscrow(new BN(1)).accounts({
        user: b.kp.publicKey, mint: energyMintPda, userWallet: engAta(b.kp.publicKey),
        userEscrow: escrowPda(b.kp.publicKey, energyMintPda), marketAuthority: marketAuthorityPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID, systemProgram: SystemProgram.programId,
      } as any).instruction();
      await sendStep("deposit", legacy([depCur, depEng], b.kp));
    }));
  }

  // ── Address Lookup Table for the settle path's static accounts ─────────────
  const staticKeys = [
    marketPda, zoneMarketPda, currencyMint, energyMintPda, marketAuthorityPda,
    collectorPda("fee_collector", currencyMint), collectorPda("wheeling_collector", currencyMint),
    collectorPda("loss_collector", currencyMint), marketShardPda, zoneShardPdaSettle,
    governanceConfigPda, tariffConfigPda, aggregatorEntryPda,
    TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, SYSVAR_INSTRUCTIONS_PUBKEY, SystemProgram.programId,
  ];
  // ALT creation is slot-sensitive ("X is not a recent slot" races preflight);
  // send raw with skipPreflight and retry with a fresh recentSlot on failure.
  let alt: anchor.web3.AddressLookupTableAccount | null = null;
  for (let attempt = 0; PRICE_MODEL !== "buyback" && attempt < 5 && !alt; attempt++) {
    try {
      const recentSlot = await conn.getSlot("finalized");
      const [createAltIx, altAddress] = AddressLookupTableProgram.createLookupTable({
        authority: gateway.publicKey, payer: gateway.publicKey, recentSlot,
      });
      const extendAltIx = AddressLookupTableProgram.extendLookupTable({
        payer: gateway.publicKey, authority: gateway.publicKey, lookupTable: altAddress, addresses: staticKeys,
      });
      const bh = await conn.getLatestBlockhash("confirmed");
      const tx = new Transaction({ feePayer: gateway.publicKey, ...bh }).add(createAltIx, extendAltIx);
      tx.sign(gateway);
      const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
      const conf = await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
      if (conf.value.err) throw new Error(JSON.stringify(conf.value.err));
      await sleep(1200); // ALT usable one slot after extension
      alt = (await conn.getAddressLookupTable(altAddress)).value;
    } catch (e: any) {
      console.log(`   ALT attempt ${attempt + 1} failed: ${(e?.message || e).toString().slice(0, 80)}`);
      await sleep(600);
    }
  }
  if (!alt && PRICE_MODEL !== "buyback") throw new Error("ALT creation failed after retries");

  // ── Daily lifecycle: 12 parallel prosumer lanes, sequential steps in a lane ─
  // Per-lane pricing under the selected model. The seller's signed limit is its
  // ladder ask; settle_offchain_match enforces sell_limit <= price <= buy_limit.
  // Optional overrides for tariff experiments (e.g. execution above the
  // charge-cap-induced price floor): all three must be set together.
  const PRICE_OVERRIDE = process.env.PRICE_MICROS ? parseInt(process.env.PRICE_MICROS, 10) : null;
  const BUY_LIMIT_OVERRIDE = process.env.BUY_LIMIT_MICROS ? parseInt(process.env.BUY_LIMIT_MICROS, 10) : null;
  const SELL_LIMIT_OVERRIDE = process.env.SELL_LIMIT_MICROS ? parseInt(process.env.SELL_LIMIT_MICROS, 10) : null;
  const priceFor = (li: number): { price: number; buyLimit: number; sellLimit: number } => {
    if (PRICE_OVERRIDE !== null && BUY_LIMIT_OVERRIDE !== null && SELL_LIMIT_OVERRIDE !== null)
      return { price: PRICE_OVERRIDE, buyLimit: BUY_LIMIT_OVERRIDE, sellLimit: SELL_LIMIT_OVERRIDE };
    const ask = ASK_LADDER_MICROS[li % ASK_LADDER_MICROS.length];
    switch (PRICE_MODEL) {
      case "uniform": return { price: 3_450_000, buyLimit: 4_100_000, sellLimit: ask };
      case "cda":     return { price: ask,       buyLimit: 4_100_000, sellLimit: ask };
      case "buyback": return { price: BUYBACK_RATE_MICROS, buyLimit: 0, sellLimit: 0 }; // accounting only
      default:        return { price: 4_000_000, buyLimit: 4_500_000, sellLimit: 3_900_000 };
    }
  };
  const lifecycleEnergy = { mintedWh: 0, settledWh: 0, burnedWh: 0, recWh: 0, currencyVolume: 0 };
  const settledPerProsumer = new Array(meters.length).fill(0);
  const mintedPerProsumer = new Array(meters.length).fill(0);
  // Consecutive cap-bound days produce byte-identical deposit/burn txs (same ix,
  // accounts, fee payer, and cached blockhash within its 10 s window) → same
  // signature → the validator dedupes the second one and no tokens move. A
  // day-varying CU-limit ix makes every daily tx unique.
  const uniq = (n: number) => ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 + (n % 10_000) });
  const p3Start = Date.now();

  await Promise.all(prosumers.map(async (p, li) => {
    const [regMeterPda] = PublicKey.findProgramAddressSync([Buffer.from("meter"), p.kp.publicKey.toBuffer(), Buffer.from(p.meterId)], registry.programId);
    for (let d = 0; d < meta.days; d++) {
      const capWh = Math.min(Math.round(acceptedSurplusWh[d][p.idx]), Math.round(SELL_CAP_KWH * 1000));
      if (capWh < 100) continue; // sub-0.1 kWh days: nothing to tokenize
      const tsDay = meta.start_ts + (d + 1) * 86400 - 1;
      const buyer = buyers[(d * prosumers.length + li) % buyers.length];

      // A. registry sync + settle_and_mint (GRID mint, Token-2022 CPI)
      const updIx = await registry.methods.updateMeterReading(new BN(capWh), new BN(0), new BN(tsDay)).accounts({
        registry: registryPda, meterAccount: regMeterPda,
        oracleMeterState: meterPdas[p.idx], oracleAuthority: gateway.publicKey,
      } as any).instruction();
      const settleMintIx = await registry.methods.settleAndMintTokens().accounts({
        meterAccount: regMeterPda, meterOwner: p.kp.publicKey, tokenInfo: tokenInfoPda,
        mint: energyMintPda, userTokenAccount: engAta(p.kp.publicKey), registry: registryPda,
        energyTokenProgram: energyToken.programId, tokenProgram: TOKEN_2022_PROGRAM_ID,
        recValidator: gateway.publicKey,
      } as any).instruction();
      if (!(await sendStep("mint", legacy([updIx, settleMintIx], gateway, [p.kp], [gateway.publicKey, p.kp.publicKey])))) continue;
      lifecycleEnergy.mintedWh += capWh;
      mintedPerProsumer[p.idx] += capWh;

      // Buyback baseline: no P2P trade — the utility pays the feed-in rate
      // off-chain and the seller retires the delivered energy directly.
      if (PRICE_MODEL === "buyback") {
        const retireIx = await energyToken.methods.retireEnergyTokens(new BN(capWh)).accounts({
          mint: energyMintPda, tokenAccount: engAta(p.kp.publicKey),
          authority: p.kp.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID,
        } as any).instruction();
        if (await sendStep("burn", legacy([uniq(d), retireIx], p.kp))) {
          lifecycleEnergy.burnedWh += capWh;
          settledPerProsumer[p.idx] += capWh;
          lifecycleEnergy.currencyVolume += Math.floor(capWh * BUYBACK_RATE_MICROS / 1e9);
        }
        continue;
      }
      const { price: lanePrice, buyLimit: laneBuyLimit, sellLimit: laneSellLimit } = priceFor(li);

      // B. seller deposits the minted GRID into the energy escrow
      const depIx = await trading.methods.depositEscrow(new BN(capWh)).accounts({
        user: p.kp.publicKey, mint: energyMintPda, userWallet: engAta(p.kp.publicKey),
        userEscrow: escrowPda(p.kp.publicKey, energyMintPda), marketAuthority: marketAuthorityPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID, systemProgram: SystemProgram.programId,
      } as any).instruction();
      if (!(await sendStep("deposit", legacy([uniq(d), depIx], p.kp)))) continue;

      // C. Ed25519-signed off-chain match, settled on-chain (v0 + ALT)
      const buyerOrderId = Buffer.alloc(16);
      buyerOrderId.writeBigUInt64LE(RUN_SALT, 0); buyerOrderId.writeUInt16LE(d, 8); buyerOrderId.writeUInt16LE(li, 10); buyerOrderId.writeUInt8(0, 12);
      const sellerOrderId = Buffer.alloc(16);
      sellerOrderId.writeBigUInt64LE(RUN_SALT, 0); sellerOrderId.writeUInt16LE(d, 8); sellerOrderId.writeUInt16LE(li, 10); sellerOrderId.writeUInt8(1, 12);
      const tradeId = Buffer.alloc(16);
      tradeId.writeBigUInt64LE(RUN_SALT, 0); tradeId.writeUInt16LE(d, 8); tradeId.writeUInt16LE(li, 10); tradeId.writeUInt8(2, 12);
      const mkPayload = (user: PublicKey, side: number, price: number) =>
        ({ orderId: [...(side === 0 ? buyerOrderId : sellerOrderId)], user, energyAmount: new BN(capWh), pricePerKwh: new BN(price), side, zoneId: ZONE_ID, expiresAt: new BN(0) });
      const buyerMsg = orderMessage({ orderId: buyerOrderId, user: buyer.kp.publicKey, energyAmount: capWh, pricePerKwh: laneBuyLimit, side: 0, zoneId: ZONE_ID, expiresAt: 0 });
      const sellerMsg = orderMessage({ orderId: sellerOrderId, user: p.kp.publicKey, energyAmount: capWh, pricePerKwh: laneSellLimit, side: 1, zoneId: ZONE_ID, expiresAt: 0 });
      const settleIx = await trading.methods
        .settleOffchainMatch(mkPayload(buyer.kp.publicKey, 0, laneBuyLimit) as any, mkPayload(p.kp.publicKey, 1, laneSellLimit) as any, new BN(capWh), new BN(lanePrice), [...tradeId])
        .accounts({
          market: marketPda, zoneMarket: zoneMarketPda,
          buyerNullifier: nullifierPda(buyer.kp.publicKey, buyerOrderId),
          sellerNullifier: nullifierPda(p.kp.publicKey, sellerOrderId),
          currencyMint, energyMint: energyMintPda, marketAuthority: marketAuthorityPda,
          tokenProgram: TOKEN_PROGRAM_ID, secondaryTokenProgram: TOKEN_2022_PROGRAM_ID,
          buyerCurrencyEscrow: escrowPda(buyer.kp.publicKey, currencyMint),
          sellerCurrencyEscrow: escrowPda(p.kp.publicKey, currencyMint),
          sellerEnergyEscrow: escrowPda(p.kp.publicKey, energyMintPda),
          buyerEnergyEscrow: escrowPda(buyer.kp.publicKey, energyMintPda),
          feeCollector: collectorPda("fee_collector", currencyMint),
          wheelingCollector: collectorPda("wheeling_collector", currencyMint),
          lossCollector: collectorPda("loss_collector", currencyMint),
          marketShard: marketShardPda, zoneShard: zoneShardPdaSettle,
          payer: gateway.publicKey, sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
          systemProgram: SystemProgram.programId,
          treasuryProgram: null, treasuryState: null,
        } as any)
        .remainingAccounts([
          { pubkey: governanceConfigPda, isSigner: false, isWritable: false },
          { pubkey: PublicKey.findProgramAddressSync([Buffer.from("trade"), tradeId], trading.programId)[0], isSigner: false, isWritable: true },
          { pubkey: tariffConfigPda, isSigner: false, isWritable: false },
          { pubkey: aggregatorEntryPda, isSigner: false, isWritable: false },
        ])
        .instruction();
      const buyerEd = Ed25519Program.createInstructionWithPrivateKey({ privateKey: buyer.kp.secretKey, message: buyerMsg });
      const sellerEd = Ed25519Program.createInstructionWithPrivateKey({ privateKey: p.kp.secretKey, message: sellerMsg });
      const okSettle = await sendStep("settle", (bh) => {
        const msg = new TransactionMessage({
          payerKey: gateway.publicKey, recentBlockhash: bh, instructions: [buyerEd, sellerEd, settleIx],
        }).compileToV0Message([alt]);
        const vtx = new VersionedTransaction(msg);
        vtx.sign([gateway]);
        return vtx;
      });
      if (!okSettle) continue;
      lifecycleEnergy.settledWh += capWh;
      settledPerProsumer[p.idx] += capWh;
      lifecycleEnergy.currencyVolume += Math.floor(capWh * lanePrice / 1e9);

      // D. buyer takes delivery and retires it: withdraw energy escrow + burn
      const wdIx = await trading.methods.withdrawEscrow(new BN(capWh)).accounts({
        user: buyer.kp.publicKey, mint: energyMintPda,
        userEscrow: escrowPda(buyer.kp.publicKey, energyMintPda), userWallet: engAta(buyer.kp.publicKey),
        marketAuthority: marketAuthorityPda, tokenProgram: TOKEN_2022_PROGRAM_ID,
      } as any).instruction();
      const burnIx = await energyToken.methods.retireEnergyTokens(new BN(capWh)).accounts({
        mint: energyMintPda, tokenAccount: engAta(buyer.kp.publicKey),
        authority: buyer.kp.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID,
      } as any).instruction();
      if (await sendStep("burn", legacy([uniq(d), wdIx, burnIx], buyer.kp))) lifecycleEnergy.burnedWh += capWh;
    }

    // Month-end REC: certify only what was neither minted as GRID nor already
    // claimed — bounded by the registry's own conservation (issue_erc CPIs
    // mark_erc_claimed against total_generation − settled − claimed).
    const totalAcceptedWh = acceptedSurplusWh.reduce((a, day) => a + Math.round(day[p.idx]), 0);
    const allowanceWh = totalAcceptedWh - mintedPerProsumer[p.idx];
    if (allowanceWh >= 100) {
      const tsEnd = meta.end_ts + 3600;
      const updIx = await registry.methods.updateMeterReading(new BN(allowanceWh), new BN(0), new BN(tsEnd)).accounts({
        registry: registryPda, meterAccount: regMeterPda,
        oracleMeterState: meterPdas[p.idx], oracleAuthority: gateway.publicKey,
      } as any).instruction();
      const certId = `REC-${RUN_SALT.toString(16)}-${p.idx}`;
      const [ercPda] = PublicKey.findProgramAddressSync([Buffer.from("erc_certificate"), Buffer.from(certId)], governance.programId);
      const recAta = getAssociatedTokenAddressSync(recMintPda, p.kp.publicKey, false, TOKEN_2022_PROGRAM_ID);
      const issueIx = await governance.methods
        .issueErc(certId, new BN(allowanceWh), "Solar", "month-sim oracle-accepted surplus")
        .accounts({
          governanceConfig: governanceConfigPda, ercCertificate: ercPda, meterAccount: regMeterPda,
          owner: p.kp.publicKey, registry: registryPda, registryProgram: registry.programId,
          recMint: recMintPda, recTokenAccount: recAta, tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          authority: gateway.publicKey, systemProgram: SystemProgram.programId,
        } as any).instruction();
      if (await sendStep("rec", legacy([updIx, issueIx], gateway, [p.kp], [gateway.publicKey, p.kp.publicKey])))
        lifecycleEnergy.recWh += allowanceWh;
    }
    console.log(`   … prosumer ${li + 1}/12 lane done (settled ${(settledPerProsumer[p.idx] / 1000).toFixed(1)} kWh)`);
  }));
  const p3WallMs = Date.now() - p3Start;

  // Stage CU sampling (tail)
  const stageCu: Record<Stage, number[]> = { mint: [], deposit: [], settle: [], burn: [], rec: [] };
  for (const s of Object.keys(stageCu) as Stage[]) {
    const tail = p3[s].sigs.slice(-100);
    for (let i = 0; i < tail.length; i += 16) {
      await Promise.all(tail.slice(i, i + 16).map(async (sig) => {
        try {
          const tx = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
          const cu = tx?.meta?.computeUnitsConsumed;
          if (typeof cu === "number") stageCu[s].push(cu);
        } catch { /* skip */ }
      }));
    }
  }
  const stageStats = (s: Stage) => {
    const lat = [...p3[s].lat].sort((a, b) => a - b);
    const cu = [...stageCu[s]].sort((a, b) => a - b);
    return {
      ok: p3[s].ok, fail: p3[s].fail, latP50: pct(lat, 50), latP95: pct(lat, 95),
      cuMin: cu[0] || 0, cuMed: median(stageCu[s]), cuMax: cu[cu.length - 1] || 0,
      errSamples: p3[s].errs,
    };
  };
  console.log(`\nPHASE 3 done in ${(p3WallMs / 1000).toFixed(1)}s: minted ${(lifecycleEnergy.mintedWh / 1000).toFixed(1)} kWh, settled ${(lifecycleEnergy.settledWh / 1000).toFixed(1)} kWh, burned ${(lifecycleEnergy.burnedWh / 1000).toFixed(1)} kWh, REC ${(lifecycleEnergy.recWh / 1000).toFixed(1)} kWh`);
  for (const s of ["mint", "deposit", "settle", "burn", "rec"] as Stage[]) {
    const st = stageStats(s);
    console.log(`   ${s}: ok=${st.ok} fail=${st.fail} CU med=${st.cuMed} lat p50=${st.latP50}ms`);
    for (const e of st.errSamples) console.log(`      · ${e}`);
  }

  confirmer.stop();
  refresherOn = false;
  await refresher.catch(() => {});

  // ═══════════════════════ Summary + artifacts ═══════════════════════════════
  const totalOrders = dayStats.reduce((a, d) => a + d.orders, 0);
  const totalOrdersOk = dayStats.reduce((a, d) => a + d.ok, 0);
  const totalOffered = dayStats.reduce((a, d) => a + d.offeredKwh, 0);
  const totalUncapped = dayStats.reduce((a, d) => a + d.uncappedSurplusKwh, 0);
  const totalDemand = dayStats.reduce((a, d) => a + d.demandKwh, 0);
  const monthWallSec = (p1WallMs + p2WallMs + p3WallMs) / 1000;
  const compression = +(meta.days * 86400 / monthWallSec).toFixed(0);

  const summary = {
    generatedAt: new Date().toISOString(),
    dataset: {
      dir: DATA_DIR, days: meta.days, meters: meta.meters, prosumers: meta.prosumers,
      readings: meta.readings, stepSec: meta.step_sec, energyKwh: meta.energy_kwh,
      dayWeather: meta.day_weather, randomSeed: meta.random_seed,
    },
    config: { batch: BATCH, zoneId: ZONE_ID, sellCapKwh: SELL_CAP_KWH, statusPollMs: STATUS_POLL_MS, maxInflight: MAX_INFLIGHT,
      priceModel: PRICE_MODEL, askLadderMicros: ASK_LADDER_MICROS, buybackRateMicros: BUYBACK_RATE_MICROS,
      priceOverrideMicros: PRICE_OVERRIDE, buyLimitOverrideMicros: BUY_LIMIT_OVERRIDE, sellLimitOverrideMicros: SELL_LIMIT_OVERRIDE },
    rpc: (conn as any)._rpcEndpoint,
    telemetry: {
      readings: meta.readings, readingsOk: p1.readingsOk,
      validationRejectedOnChain: p1.readingsValidationRejected,
      deliveryFail: p1.readingsDeliveryFail,
      plannedAnomalySingletons: plannedGateFails,
      tx: { planned: plannedTx, sent: p1.txSent, ok: p1.txOk, err: p1.txErr, expired: p1.txExpired, sendErr: p1.sendErr, retries: p1.retries },
      wallMs: p1WallMs, readingsPerSec, txPerSec: +(p1.txOk / (p1WallMs / 1000)).toFixed(2),
      latencyMs: { p50: pct(p1Lat, 50), p95: pct(p1Lat, 95), max: p1Lat[p1Lat.length - 1] || 0 },
      cuPerTx: { min: cuPerTx.length ? Math.min(...cuPerTx) : 0, med: median(cuPerTx), max: cuPerTx.length ? Math.max(...cuPerTx) : 0, samples: cuPerTx.length },
      cuPerReadingMed: median(cuPerReading),
      errSamples: p1.errSamples,
    },
    trading: {
      orders: totalOrders, ok: totalOrdersOk, fail: totalOrders - totalOrdersOk,
      failBreakdown: { sendError: p2.sendErr, statusErr: p2.statusErr, expired: p2.expired },
      wallMs: p2WallMs, tpsMean: +(totalOrdersOk / (p2WallMs / 1000)).toFixed(2),
      cu: orderCu.length ? { min: Math.min(...orderCu), med: median(orderCu), max: Math.max(...orderCu), samples: orderCu.length } : null,
      energyKwh: {
        offered: +totalOffered.toFixed(3), uncappedSurplus: +totalUncapped.toFixed(3),
        capWithheld: +(totalUncapped - totalOffered).toFixed(3), demand: +totalDemand.toFixed(3),
      },
      perDay: dayStats,
      errSamples: p2.errSamples,
    },
    lifecycle: {
      wallMs: p3WallMs,
      energyKwh: {
        gridMinted: +(lifecycleEnergy.mintedWh / 1000).toFixed(3),
        tradeSettled: +(lifecycleEnergy.settledWh / 1000).toFixed(3),
        burned: +(lifecycleEnergy.burnedWh / 1000).toFixed(3),
        recCertified: +(lifecycleEnergy.recWh / 1000).toFixed(3),
      },
      currencyVolume: lifecycleEnergy.currencyVolume,
      stages: {
        mint: stageStats("mint"), deposit: stageStats("deposit"), settle: stageStats("settle"),
        burn: stageStats("burn"), rec: stageStats("rec"),
      },
    },
    month: { wallSec: +monthWallSec.toFixed(1), compressionX: compression },
  };

  fs.mkdirSync("test-results", { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = `test-results/community-month-${meta.meters}m-${meta.prosumers}p-${PRICE_MODEL}-${stamp}.json`;
  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2));

  const md = [
    `# 1-Month Community Benchmark — ${meta.meters} meters, ${meta.prosumers} prosumers (10 kWh/day sell cap)`, ``,
    `- Generated: ${summary.generatedAt}`,
    `- Dataset: simulator fleet (seed ${meta.random_seed}), ${meta.days} days × ${86400 / meta.step_sec} ticks/day × ${meta.meters} meters = ${meta.readings} readings; month energy: ${meta.energy_kwh.generated} kWh generated / ${meta.energy_kwh.consumed} kWh consumed / ${meta.energy_kwh.surplus} kWh surplus`,
    `- Transport: per-meter batched replay (≤${BATCH} readings/tx, 80 parallel meter chains, historical timestamps), anomaly-gate readings as singletons`, ``,
    `## Telemetry replay (oracle)`, ``,
    `| readings ok/total | validation-rejected | delivery fail | wall (s) | readings/s | tx/s | CU/tx med | CU/reading med | lat p50 (ms) | lat p95 (ms) |`,
    `|------------------:|--------------------:|--------------:|---------:|-----------:|-----:|----------:|---------------:|-------------:|-------------:|`,
    `| ${p1.readingsOk}/${meta.readings} | ${p1.readingsValidationRejected} | ${p1.readingsDeliveryFail} | ${(p1WallMs / 1000).toFixed(1)} | ${readingsPerSec} | ${summary.telemetry.txPerSec} | ${summary.telemetry.cuPerTx.med} | ${summary.telemetry.cuPerReadingMed} | ${summary.telemetry.latencyMs.p50} | ${summary.telemetry.latencyMs.p95} |`, ``,
    `## Trading (30 daily sessions)`, ``,
    `| orders ok/total | fail (send/onchain/expired) | wall (s) | TPS | CU med | offered (kWh) | cap-withheld (kWh) | demand (kWh) |`,
    `|----------------:|:----------------------------|---------:|----:|-------:|--------------:|-------------------:|-------------:|`,
    `| ${totalOrdersOk}/${totalOrders} | ${totalOrders - totalOrdersOk} (${p2.sendErr}/${p2.statusErr}/${p2.expired}) | ${(p2WallMs / 1000).toFixed(1)} | ${summary.trading.tpsMean} | ${orderCu.length ? median(orderCu) : "n/a"} | ${totalOffered.toFixed(1)} | ${(totalUncapped - totalOffered).toFixed(1)} | ${totalDemand.toFixed(1)} |`, ``,
    `## Token lifecycle (mint → settle → burn → REC)`, ``,
    `| stage | ok | fail | CU med | lat p50 (ms) |`,
    `|:------|---:|-----:|-------:|-------------:|`,
    ...(["mint", "deposit", "settle", "burn", "rec"] as Stage[]).map((s) => {
      const st = stageStats(s);
      return `| ${s} | ${st.ok} | ${st.fail} | ${st.cuMed} | ${st.latP50} |`;
    }),
    ``,
    `- Energy conservation (oracle-accepted surplus only): GRID minted ${(lifecycleEnergy.mintedWh / 1000).toFixed(1)} kWh → trade-settled ${(lifecycleEnergy.settledWh / 1000).toFixed(1)} kWh → burned ${(lifecycleEnergy.burnedWh / 1000).toFixed(1)} kWh; cap-withheld surplus certified as RECs: ${(lifecycleEnergy.recWh / 1000).toFixed(1)} kWh.`,
    `- Settlement currency volume: ${lifecycleEnergy.currencyVolume} units (6-dec THB scale) across ${stageStats("settle").ok} Ed25519-verified matches.`,
    `- Lifecycle wall: ${(p3WallMs / 1000).toFixed(1)} s.`,
    ``,
    `## Month`, ``,
    `- Whole month absorbed in **${monthWallSec.toFixed(1)} s** wall time → **${compression}× real-time compression**.`,
    `- Sell cap: 10 kWh/day binds on ${meta.prosumer_days_surplus_gt_10kwh ?? "?"} prosumer-days (see dataset meta).`,
    ``,
    ...(p1.errSamples.length || p2.errSamples.length
      ? [`### Failure samples`, ``, ...p1.errSamples.map((s) => `- P1 ${s}`), ...p2.errSamples.map((s) => `- P2 ${s}`), ``] : []),
    `> Latency is send→first-seen-confirmed via bulk polling (±${STATUS_POLL_MS}ms quantisation).`,
    ``,
  ].join("\n");
  const mdPath = `test-results/community-month-${meta.meters}m-${meta.prosumers}p-${PRICE_MODEL}-${stamp}.md`;
  fs.writeFileSync(mdPath, md);

  console.log("\n" + "═".repeat(70));
  console.log(`MONTH SUMMARY: ${meta.readings} readings + ${totalOrders} orders in ${monthWallSec.toFixed(1)}s (${compression}× compression)`);
  console.log(`telemetry: ${readingsPerSec} readings/s  trading: ${summary.trading.tpsMean} TPS`);
  console.log(`Saved:\n  ${jsonPath}\n  ${mdPath}`);
  console.log("═".repeat(70));
}

main().catch((e) => { console.error(e); process.exit(1); });
