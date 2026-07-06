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
 *            STATUS_POLL_MS, CONFIRM_TIMEOUT_SEC, BLOCKHASH_MS.
 * Requires: validator up, oracle deployed + initialized (scripts/init-oracle.ts).
 */
import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Oracle } from "../target/types/oracle";
import { PublicKey, Keypair, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";
import * as fs from "fs";
import bs58 from "bs58";

const METERS = parseInt(process.env.METERS || "80", 10);
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

interface EpochResult {
  epoch: number; ts: number; meters: number; ok: number; fail: number;
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
  const meterIds = Array.from({ length: METERS }, (_, i) => `${PREFIX}${i.toString().padStart(6, "0")}`);
  if (meterIds[0].length > 32) throw new Error(`meter_id > 32 bytes: ${meterIds[0]}`);
  console.log(`Deriving ${METERS} meter PDAs...`);
  const meterPdas = meterIds.map((m) => findMeterPda(m, program.programId));

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

  for (let e = 1; e <= EPOCHS; e++) {
    // Respect on-chain min_reading_interval relative to the previous epoch's
    // reading_timestamp — only sleep the remainder if the burst was faster.
    if (prevTsMs > 0) {
      const wait = prevTsMs + INTERVAL_SEC * 1000 - Date.now();
      if (wait > 0) {
        console.log(`   … waiting ${(wait / 1000).toFixed(0)}s (min_reading_interval=60) before next epoch`);
        await sleep(wait);
      }
    }
    const ts = Math.floor(Date.now() / 1000);
    prevTsMs = ts * 1000;

    console.log(`\n🕒 Epoch ${e}/${EPOCHS}  (ts=${ts})  draining ${METERS} submits (window ${MAX_INFLIGHT})...`);
    const burstStart = Date.now();

    // sig → sendTime for unresolved txs; resolved latencies collected separately
    const unresolved = new Map<string, number>();
    const latencies: number[] = [];
    const okSigs: string[] = [];
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
        const produced = 80 + ((i * 7) % 420);
        const consumed = 40 + ((i * 3) % 210);
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
        } catch {
          fail++;
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

    // CU: sample up to CU_SAMPLE confirmed tx (evenly strided)
    const stride = Math.max(1, Math.floor(okSigs.length / CU_SAMPLE));
    const cuSigs = okSigs.filter((_, k) => k % stride === 0).slice(0, CU_SAMPLE);
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
      epoch: e, ts, meters: METERS, ok, fail, wallMs,
      tps: +(ok / (wallMs / 1000)).toFixed(2),
      latP50: pct(lat, 50), latP95: pct(lat, 95), latMax: lat.length ? lat[lat.length - 1] : 0,
      cuMin: cuSorted[0] || 0, cuMed: median(cus), cuMax: cuSorted[cuSorted.length - 1] || 0, cuSamples: cus.length,
    };
    epochResults.push(res);

    console.log(`   ✅ ok=${res.ok}/${METERS}  fail=${res.fail}  wall=${res.wallMs}ms  TPS=${res.tps}`);
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
    },
    rpc: (conn as any)._rpcEndpoint,
    programId: program.programId.toBase58(),
    totals: { tx: totalTx, ok: totalOk, fail: totalFail, lossRatePct: +((totalFail / totalTx) * 100).toFixed(3) },
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
    `| Epoch | ok/N | fail | wall (ms) | TPS | lat p50 | lat p95 | lat max | CU med | CU max |`,
    `|------:|-----:|-----:|----------:|----:|--------:|--------:|--------:|-------:|-------:|`,
    ...epochResults.map((r) => `| ${r.epoch}${r.epoch === 1 ? " (init)" : ""} | ${r.ok}/${r.meters} | ${r.fail} | ${r.wallMs} | ${r.tps} | ${r.latP50} | ${r.latP95} | ${r.latMax} | ${r.cuMed} | ${r.cuMax} |`),
    ``, `## Aggregate`, ``,
    `- Total tx: ${totalTx}  ok: ${totalOk}  fail: ${totalFail}  loss: ${summary.totals.lossRatePct}%`,
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
