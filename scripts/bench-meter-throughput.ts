/**
 * bench-meter-throughput.ts — N-meter oracle telemetry benchmark (for the paper).
 *
 * Fires `submit_meter_reading` from N distinct meters, over M epochs. On-chain
 * `min_reading_interval` = 60s, so consecutive epochs' reading timestamps are
 * ≥61s apart. Epoch 1 = per-meter PDA init (heavier CU); epoch ≥2 = steady write.
 *
 * High-volume send path (scales to 100k meters): transactions are built + signed
 * locally against a cached recent blockhash (refreshed every BLOCKHASH_MS), sent
 * with `sendRawTransaction(skipPreflight)`, and confirmed via bulk
 * `getSignatureStatuses` polling (256 sigs/call, STATUS_POLL_MS cadence) — the
 * per-tx websocket confirm of anchor's `.rpc()` collapses beyond ~10k pending.
 * A windowed open loop caps unconfirmed in-flight txs at MAX_INFLIGHT so the
 * validator ingest queue is never firehosed. Latency is send→first-seen-confirmed,
 * quantised by the status-poll interval.
 *
 * Measures, per epoch + aggregate:
 *   - throughput (confirmed tx / wall-second, burst start → last confirm)
 *   - latency    (send→confirm, p50/p95/max ms; ±STATUS_POLL_MS quantisation)
 *   - CU per tx  (meta.computeUnitsConsumed, sampled; init vs steady)
 *   - success/loss (confirmed vs failed/expired out of N)
 *
 * Auth: submit requires authority == oracle_data.chain_bridge (single gateway =
 * provider wallet). That shared fee-payer is write-locked every tx, so it — not
 * the disjoint per-meter PDAs — is the throughput serialization point. Reported.
 *
 * Env: ANCHOR_PROVIDER_URL, ANCHOR_WALLET.
 * Overrides: METERS, EPOCHS, INTERVAL_SEC, PREFIX, MAX_INFLIGHT, CU_SAMPLE,
 *            STATUS_POLL_MS, CONFIRM_TIMEOUT_SEC, BLOCKHASH_MS, DATASET.
 * DATASET=<dir>: replay a gen-datasets.sh output (e.g. *-cap5) — real meter
 *            identities (meters.json chain_id) + real energy (readings.jsonl
 *            {g,c} Wh) for the first EPOCHS sim-ticks. METERS clamps to a subset.
 * Requires: validator up, oracle deployed + initialized (scripts/init-oracle.ts).
 */
import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Oracle } from "../target/types/oracle";
import { PublicKey, Keypair, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";
import * as fs from "fs";
import * as readline from "readline";
import bs58 from "bs58";

// ── Dataset replay (optional) ────────────────────────────────────────────────
// DATASET=<dir> points at a gen-datasets.sh output (e.g. a *-cap5 dir). When set,
// the bench replays REAL meter identities (meters.json chain_id → oracle PDA seed)
// and REAL energy values (readings.jsonl {g,c} Wh) instead of synthetic ones.
// meta.json + meters.json are small → loaded synchronously here; the (potentially
// 100MB+) readings.jsonl is streamed later in main(), keeping only the ticks used.
// The tx `timestamp` stays the ON-CHAIN clock (not the dataset's 2025 ts) — the
// oracle rejects non-current stamps (FutureReading / min_reading_interval), so the
// dataset supplies values + identities, the chain supplies the reading clock.
const DATASET = process.env.DATASET || "";
// Optional namespace prepended to dataset chain_ids → fresh meter PDAs. Needed to
// replay dataset timestamps when the real ids were already written with newer
// (on-chain-clock) stamps in a prior run (past dataset ts must exceed each meter's
// stored last_reading_timestamp). Keep it short — chain_id must stay ≤ 32 bytes.
const ID_PREFIX = process.env.ID_PREFIX || "";
interface DsMeta { meters: number; prosumers: number; days: number; start_ts: number; interval: number; step_sec: number; }
let dsMeta: DsMeta | null = null;
let dsMeterIds: string[] | null = null;
if (DATASET) {
  dsMeta = JSON.parse(fs.readFileSync(`${DATASET}/meta.json`, "utf8")) as DsMeta;
  const metersJson = JSON.parse(fs.readFileSync(`${DATASET}/meters.json`, "utf8")) as Array<{ idx: number; chain_id: string }>;
  dsMeterIds = metersJson.sort((a, b) => a.idx - b.idx).map((m) => m.chain_id);
  const bad = dsMeterIds.find((id) => Buffer.byteLength(id, "utf8") > 32);
  if (bad) throw new Error(`dataset chain_id > 32 bytes (oracle seed limit): ${bad}`);
}

// METERS: from the dataset when replaying (clamped by env METERS if smaller —
// lets you bench a subset of a large dataset), else the synthetic default.
const METERS = DATASET
  ? Math.min(parseInt(process.env.METERS || String(dsMeta!.meters), 10), dsMeta!.meters)
  : parseInt(process.env.METERS || "80", 10);
const EPOCHS = parseInt(process.env.EPOCHS || "2", 10);
const INTERVAL_SEC = parseInt(process.env.INTERVAL_SEC || "61", 10);
const PREFIX = process.env.PREFIX || `S${METERS}_M`;
const MAX_INFLIGHT = parseInt(process.env.MAX_INFLIGHT || "3000", 10);
const CU_SAMPLE = parseInt(process.env.CU_SAMPLE || "200", 10);
const STATUS_POLL_MS = parseInt(process.env.STATUS_POLL_MS || "1500", 10);
const CONFIRM_TIMEOUT_SEC = parseInt(process.env.CONFIRM_TIMEOUT_SEC || "90", 10);
const BLOCKHASH_MS = parseInt(process.env.BLOCKHASH_MS || "10000", 10);
const SEND_WORKERS = parseInt(process.env.SEND_WORKERS || "64", 10);

function findOracleDataPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("oracle_data")], programId)[0];
}
function findMeterPda(meterId: string, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("meter"), Buffer.from(meterId)], programId)[0];
}
function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}
function median(a: number[]): number {
  return pct([...a].sort((x, y) => x - y), 50);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface FailBreakdown {
  sendError: number;  // sendRawTransaction rejected (RPC/ingest-queue refusal)
  statusErr: number;  // landed on-chain but execution failed (program/tx error)
  expired: number;    // never seen confirmed within CONFIRM_TIMEOUT_SEC (queue drop / blockhash expiry)
}
interface EpochResult {
  epoch: number; ts: number; meters: number; ok: number; fail: number;
  failBreakdown: FailBreakdown; errSamples: string[];
  wallMs: number; tps: number; latP50: number; latP95: number; latMax: number;
  cuMin: number; cuMed: number; cuMax: number; cuSamples: number;
}

function i32Zone(idx: number): number {
  return 7000 + (idx % 16);
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Oracle as Program<Oracle>;
  const gateway = (provider.wallet as any).payer as Keypair;
  const conn = provider.connection;

  const oracleDataPda = findOracleDataPda(program.programId);
  const meterIds = DATASET
    ? dsMeterIds!.slice(0, METERS).map((id) => `${ID_PREFIX}${id}`)
    : Array.from({ length: METERS }, (_, i) => `${PREFIX}${i.toString().padStart(6, "0")}`);
  if (Buffer.byteLength(meterIds[0], "utf8") > 32) throw new Error(`meter_id > 32 bytes: ${meterIds[0]}`);
  console.log(`Deriving ${METERS} meter PDAs...`);
  const meterPdas = meterIds.map((m) => findMeterPda(m, program.programId));

  // ── Dataset replay values: one {g,c} map per epoch, streamed from readings ──
  // Epoch e (1-based) replays sim-tick (e-1): timestamp = start_ts + (e-1)*interval.
  // We collect only those EPOCHS ticks so a 2M-line readings.jsonl costs one pass,
  // not full materialisation. Meters beyond the dataset (subset bench) fall back
  // to the synthetic formula in the send loop.
  const dsEpochVals: Array<Map<number, { g: number; c: number }>> = [];
  if (DATASET) {
    const step = dsMeta!.interval || dsMeta!.step_sec;
    const targetTs = Array.from({ length: EPOCHS }, (_, k) => dsMeta!.start_ts + k * step);
    const tsToEpoch = new Map<number, number>(targetTs.map((t, k) => [t, k]));
    for (let k = 0; k < EPOCHS; k++) dsEpochVals.push(new Map());
    console.log(`Streaming ${DATASET}/readings.jsonl for ${EPOCHS} ticks (ts ${targetTs[0]}..${targetTs[EPOCHS - 1]})...`);
    const rl = readline.createInterface({
      input: fs.createReadStream(`${DATASET}/readings.jsonl`),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (!line) continue;
      const r = JSON.parse(line) as { m: number; t: number; g: number; c: number };
      const ep = tsToEpoch.get(r.t);
      if (ep === undefined || r.m >= METERS) continue;
      dsEpochVals[ep].set(r.m, { g: r.g, c: r.c });
    }
    const covered = dsEpochVals.map((mp, k) => `e${k + 1}=${mp.size}/${METERS}`).join(" ");
    console.log(`  dataset values loaded: ${covered}`);
  }

  console.log("═".repeat(70));
  console.log(`  ${METERS}-METER ORACLE THROUGHPUT BENCHMARK (raw-send + bulk status)`);
  console.log("═".repeat(70));
  console.log(`RPC:        ${(conn as any)._rpcEndpoint}`);
  console.log(`Gateway:    ${gateway.publicKey.toBase58()}`);
  console.log(`Oracle PDA: ${oracleDataPda.toBase58()}`);
  console.log(`Meters=${METERS} Epochs=${EPOCHS} Interval=${INTERVAL_SEC}s MaxInflight=${MAX_INFLIGHT} Poll=${STATUS_POLL_MS}ms\n`);

  // ── Cached blockhash refresher ──────────────────────────────────────────────
  let cachedBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
  let refresherOn = true;
  const refresher = (async () => {
    while (refresherOn) {
      await sleep(BLOCKHASH_MS);
      try { cachedBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash; } catch { /* keep old */ }
    }
  })();

  const epochResults: EpochResult[] = [];
  let prevTsMs = 0;

  const dsStep = DATASET ? (dsMeta!.interval || dsMeta!.step_sec) : 0;
  for (let e = 1; e <= EPOCHS; e++) {
    let ts: number;
    if (DATASET) {
      // DATASET replay: stamp each epoch with the DATASET tick's OWN timestamp
      // (start_ts + (e-1)*step). Dataset ticks are `step`s apart (≥ oracle
      // min_reading_interval) and historical (< on-chain now), so the per-meter
      // interval + FutureReading guards pass no matter how fast we submit — so
      // inter-epoch pacing is a plain wall sleep (INTERVAL_SEC), NOT an on-chain
      // clock wait. This lets a 15-min series be replayed at e.g. 5s/step.
      // (Requires FRESH meter PDAs — see ID_PREFIX — since past dataset ts must
      // exceed each meter's stored last_reading_timestamp.)
      if (e > 1 && INTERVAL_SEC > 0) await sleep(INTERVAL_SEC * 1000);
      ts = dsMeta!.start_ts + (e - 1) * dsStep;
    } else {
      // Synthetic mode: stamp with the ON-CHAIN clock and wait min_reading_interval
      // (a laptop sleep/wake leaves the validator Bank clock behind wall time; the
      // oracle rejects wall-clock stamps as FutureReading at clock+60s).
      if (prevTsMs > 0) {
        while (true) {
          let chain = Math.floor(Date.now() / 1000);
          try {
            const bt = await conn.getBlockTime(await conn.getSlot("confirmed"));
            if (typeof bt === "number") chain = bt;
          } catch { /* fall back */ }
          const wait = prevTsMs / 1000 + INTERVAL_SEC - chain;
          if (wait <= 0) break;
          console.log(`   … waiting ${wait.toFixed(0)}s (min_reading_interval=60, on-chain clock) before next epoch`);
          await sleep(Math.min(wait, 15) * 1000);
        }
      }
      ts = Math.floor(Date.now() / 1000);
      try {
        const bt = await conn.getBlockTime(await conn.getSlot("confirmed"));
        if (typeof bt === "number") ts = bt;
      } catch { /* fall back to wall clock */ }
      prevTsMs = ts * 1000;
    }

    console.log(`\n🕒 Epoch ${e}/${EPOCHS}  (ts=${ts})  draining ${METERS} submits (window ${MAX_INFLIGHT})...`);
    const burstStart = Date.now();

    // sig → sendTime for unresolved txs; resolved latencies collected separately
    const unresolved = new Map<string, number>();
    const latencies: number[] = [];
    const okSigs: string[] = [];
    const failBreakdown: FailBreakdown = { sendError: 0, statusErr: 0, expired: 0 };
    const errSamples: string[] = [];
    const sampleErr = (cat: string, msg: string) => {
      if (errSamples.length < 9 && !errSamples.some((s) => s.startsWith(cat) && s.includes(msg.slice(0, 40))))
        errSamples.push(`${cat}: ${msg.slice(0, 160)}`);
    };
    let fail = 0;
    let sent = 0;
    let sendingDone = false;
    let lastSendTime = Date.now();
    let lastConfirmTime = burstStart;

    // ── Status poller (runs concurrently with sends) ─────────────────────────
    const poller = (async () => {
      while (true) {
        if (unresolved.size === 0) {
          if (sendingDone) break;
          await sleep(200);
          continue;
        }
        await sleep(STATUS_POLL_MS);
        const sigs = [...unresolved.keys()];
        for (let i = 0; i < sigs.length; i += 256) {
          const chunk = sigs.slice(i, i + 256);
          try {
            const res = await conn.getSignatureStatuses(chunk);
            const now = Date.now();
            res.value.forEach((st, j) => {
              const sig = chunk[j];
              if (!st) return; // not seen yet
              if (st.err) {
                unresolved.delete(sig);
                fail++;
                failBreakdown.statusErr++;
                sampleErr("statusErr", JSON.stringify(st.err));
              } else if (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized") {
                const t0 = unresolved.get(sig)!;
                unresolved.delete(sig);
                latencies.push(now - t0);
                okSigs.push(sig);
                lastConfirmTime = now;
              }
            });
          } catch { /* transient RPC error — retry next sweep */ }
        }
        // Expire anything still unresolved long after the last send
        if (sendingDone && Date.now() - lastSendTime > CONFIRM_TIMEOUT_SEC * 1000) {
          fail += unresolved.size;
          failBreakdown.expired += unresolved.size;
          if (unresolved.size > 0) sampleErr("expired", `${unresolved.size} sigs unconfirmed after ${CONFIRM_TIMEOUT_SEC}s`);
          unresolved.clear();
          break;
        }
      }
    })();

    // ── Send workers (windowed open loop) ────────────────────────────────────
    let nextIdx = 0;
    async function sendWorker() {
      while (true) {
        const i = nextIdx++;
        if (i >= METERS) return;
        while (unresolved.size >= MAX_INFLIGHT) await sleep(25);
        // Dataset replay overrides synthetic values for meters the dataset covers;
        // meters beyond the dataset (subset bench) keep the synthetic formula.
        let produced = 80 + ((i * 7) % 420);
        let consumed = 40 + ((i * 3) % 210);
        if (DATASET) {
          const v = dsEpochVals[e - 1].get(i);
          if (v) { produced = v.g; consumed = v.c; }
        }
        try {
          const ix: TransactionInstruction = await program.methods
            .submitMeterReading(meterIds[i], new BN(produced), new BN(consumed), new BN(ts), i32Zone(i))
            .accounts({
              oracleData: oracleDataPda,
              meterState: meterPdas[i],
              authority: gateway.publicKey,
              systemProgram: SystemProgram.programId,
            } as any)
            .instruction();
          const tx = new Transaction();
          tx.feePayer = gateway.publicKey;
          tx.recentBlockhash = cachedBlockhash;
          tx.add(ix);
          tx.sign(gateway);
          const sig = bs58.encode(tx.signature!);
          const t0 = Date.now();
          await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 0 });
          unresolved.set(sig, t0);
          sent++;
          lastSendTime = t0;
        } catch (err: any) {
          fail++;
          failBreakdown.sendError++;
          sampleErr("sendError", (err?.message || String(err)).split("\n")[0]);
        }
        if (sent % 10000 === 0 && sent > 0) {
          console.log(`   … sent ${sent}/${METERS}  confirmed=${latencies.length}  inflight=${unresolved.size}`);
        }
      }
    }
    await Promise.all(Array.from({ length: SEND_WORKERS }, sendWorker));
    sendingDone = true;
    await poller;

    const wallMs = lastConfirmTime - burstStart;
    const lat = [...latencies].sort((a, b) => a - b);
    const ok = latencies.length;

    // CU: sample the most-recent CU_SAMPLE confirmed tx (tail of the burst) —
    // the rotating ledger prunes old history under 100k+ tx loads, so strided
    // sampling starves; the tail is always retained and CU is deterministic.
    const cuSigs = okSigs.slice(-CU_SAMPLE);
    const cus: number[] = [];
    for (let i = 0; i < cuSigs.length; i += 16) {
      await Promise.all(cuSigs.slice(i, i + 16).map(async (sig) => {
        try {
          const tx = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
          const cu = tx?.meta?.computeUnitsConsumed;
          if (typeof cu === "number") cus.push(cu);
        } catch { /* skip */ }
      }));
    }
    const cuSorted = [...cus].sort((a, b) => a - b);

    const res: EpochResult = {
      epoch: e, ts, meters: METERS, ok, fail, failBreakdown, errSamples, wallMs,
      tps: +(ok / (wallMs / 1000)).toFixed(2),
      latP50: pct(lat, 50), latP95: pct(lat, 95), latMax: lat.length ? lat[lat.length - 1] : 0,
      cuMin: cuSorted[0] || 0, cuMed: median(cus), cuMax: cuSorted[cuSorted.length - 1] || 0, cuSamples: cus.length,
    };
    epochResults.push(res);

    console.log(`   ✅ ok=${res.ok}/${METERS}  fail=${res.fail}  wall=${res.wallMs}ms  TPS=${res.tps}`);
    console.log(`   💥 fail: send=${failBreakdown.sendError}  onchain=${failBreakdown.statusErr}  expired=${failBreakdown.expired}`);
    for (const s of errSamples) console.log(`      · ${s}`);
    console.log(`   ⏱  latency ms  p50=${res.latP50}  p95=${res.latP95}  max=${res.latMax}  (±${STATUS_POLL_MS}ms poll quantisation)`);
    console.log(`   ⚙  CU (n=${res.cuSamples})  min=${res.cuMin}  med=${res.cuMed}  max=${res.cuMax}`);
  }

  refresherOn = false;
  await refresher.catch(() => {});

  const totalOk = epochResults.reduce((a, r) => a + r.ok, 0);
  const totalFail = epochResults.reduce((a, r) => a + r.fail, 0);
  const totalTx = totalOk + totalFail;
  const steady = epochResults.filter((r) => r.epoch >= 2);
  const epoch1 = epochResults[0];

  const summary = {
    generatedAt: new Date().toISOString(),
    config: {
      meters: METERS, epochs: EPOCHS, intervalSec: INTERVAL_SEC, maxInflight: MAX_INFLIGHT,
      cuSample: CU_SAMPLE, statusPollMs: STATUS_POLL_MS, sendWorkers: SEND_WORKERS,
      dataset: DATASET || null,
    },
    rpc: (conn as any)._rpcEndpoint,
    programId: program.programId.toBase58(),
    totals: {
      tx: totalTx, ok: totalOk, fail: totalFail, lossRatePct: +((totalFail / totalTx) * 100).toFixed(3),
      failBreakdown: {
        sendError: epochResults.reduce((a, r) => a + r.failBreakdown.sendError, 0),
        statusErr: epochResults.reduce((a, r) => a + r.failBreakdown.statusErr, 0),
        expired: epochResults.reduce((a, r) => a + r.failBreakdown.expired, 0),
      },
    },
    firstEpochInit: { cuMed: epoch1.cuMed, cuMax: epoch1.cuMax, tps: epoch1.tps, latP50: epoch1.latP50, latP95: epoch1.latP95 },
    steadyState: steady.length ? {
      epochs: steady.map((r) => r.epoch),
      cuMed: median(steady.map((r) => r.cuMed)),
      cuMax: Math.max(...steady.map((r) => r.cuMax)),
      tpsMean: +(steady.reduce((a, r) => a + r.tps, 0) / steady.length).toFixed(2),
      tpsMax: Math.max(...steady.map((r) => r.tps)),
      latP50Med: median(steady.map((r) => r.latP50)),
      latP95Max: Math.max(...steady.map((r) => r.latP95)),
      latMax: Math.max(...steady.map((r) => r.latMax)),
    } : null,
    perEpoch: epochResults,
  };

  fs.mkdirSync("test-results", { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = `test-results/meter-throughput-${METERS}m-${stamp}.json`;
  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2));

  const md = [
    `# ${METERS}-Meter Oracle Throughput Benchmark`, ``,
    `- Generated: ${summary.generatedAt}`,
    `- RPC: \`${summary.rpc}\`  Oracle: \`${summary.programId}\``,
    `- Config: ${METERS} meters × ${EPOCHS} epochs, ≥${INTERVAL_SEC}s apart, ${MAX_INFLIGHT} in-flight window, raw-send + ${STATUS_POLL_MS}ms bulk status polling`,
    `- Serialization: single gateway fee-payer write-locked per tx (per-meter PDAs disjoint)`, ``,
    `## Per-epoch`, ``,
    `| Epoch | ok/N | fail (send/onchain/expired) | wall (ms) | TPS | lat p50 | lat p95 | lat max | CU med | CU max |`,
    `|------:|-----:|:----------------------------|----------:|----:|--------:|--------:|--------:|-------:|-------:|`,
    ...epochResults.map((r) => `| ${r.epoch}${r.epoch === 1 ? " (init)" : ""} | ${r.ok}/${r.meters} | ${r.fail} (${r.failBreakdown.sendError}/${r.failBreakdown.statusErr}/${r.failBreakdown.expired}) | ${r.wallMs} | ${r.tps} | ${r.latP50} | ${r.latP95} | ${r.latMax} | ${r.cuMed} | ${r.cuMax} |`),
    ``,
    ...(epochResults.some((r) => r.errSamples.length)
      ? [`### Failure samples`, ``, ...epochResults.flatMap((r) => r.errSamples.map((s) => `- epoch ${r.epoch} — ${s}`)), ``]
      : []),
    `## Aggregate`, ``,
    `- Total tx: ${totalTx}  ok: ${totalOk}  fail: ${totalFail}  loss: ${summary.totals.lossRatePct}%`,
    `- Fail breakdown: send-rejected ${summary.totals.failBreakdown.sendError}, on-chain error ${summary.totals.failBreakdown.statusErr}, expired/unconfirmed ${summary.totals.failBreakdown.expired}`,
    `- First-epoch (PDA init): CU med ${summary.firstEpochInit.cuMed}, max ${summary.firstEpochInit.cuMax}`,
    summary.steadyState ? `- Steady-state (epoch ≥2): CU med ${summary.steadyState.cuMed}, TPS mean ${summary.steadyState.tpsMean} / max ${summary.steadyState.tpsMax}, lat p95 ≤ ${summary.steadyState.latP95Max}ms` : `- Steady-state: n/a`,
    ``,
    `> Latency is send→first-seen-confirmed via bulk \`getSignatureStatuses\` polling, so values`,
    `> are quantised by the ${STATUS_POLL_MS}ms poll interval.`,
    ``,
  ].join("\n");
  const mdPath = `test-results/meter-throughput-${METERS}m-${stamp}.md`;
  fs.writeFileSync(mdPath, md);

  console.log("\n" + "═".repeat(70));
  console.log(`SUMMARY N=${METERS}: ${totalOk}/${totalTx} ok (${summary.totals.lossRatePct}% loss)`);
  if (summary.steadyState) console.log(`Steady: CU med ${summary.steadyState.cuMed}, TPS mean ${summary.steadyState.tpsMean}, lat p95≤${summary.steadyState.latP95Max}ms`);
  console.log(`Saved:\n  ${jsonPath}\n  ${mdPath}`);
  console.log("═".repeat(70));
}

main().catch((e) => { console.error(e); process.exit(1); });
