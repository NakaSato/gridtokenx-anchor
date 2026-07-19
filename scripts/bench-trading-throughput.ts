/**
 * bench-trading-throughput.ts — CDA order-entry throughput benchmark (for the paper).
 *
 * Fires N `submit_limit_order_sharded` instructions (the trading hot path, §7
 * step 3) against a live validator and measures confirmed goodput, latency, CU,
 * and categorized loss — the trading-side counterpart of
 * bench-meter-throughput.ts.
 *
 * Each order creates its own per-order PDA (`[b"order", authority, order_id]`)
 * and lands on a zone shard chosen round-robin (order i → shard i % SHARDS).
 * NOTE the measured serialization points in current code: (1) the single
 * fee-payer/authority is write-locked per tx; (2) SubmitLimitOrderShardedContext
 * still declares `zone_market` as `mut` (programs/trading/src/lib.rs:1755), so
 * every order write-locks the shared ZoneMarket even though the handler never
 * writes it — both are reported with the result.
 *
 * Self-bootstraps (idempotent): market (16 shards) → zone_market → 16 zone shards.
 * Same raw-send + bulk-status transport as the meter bench.
 *
 * Env: ANCHOR_PROVIDER_URL, ANCHOR_WALLET.
 * Overrides: ORDERS, MAX_INFLIGHT, CU_SAMPLE, STATUS_POLL_MS, CONFIRM_TIMEOUT_SEC,
 *            BLOCKHASH_MS, SEND_WORKERS, ZONE_ID, ORDER_ID_BASE.
 * Requires: validator up, trading program deployed.
 */
import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Trading } from "../target/types/trading";
import { PublicKey, Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import BN from "bn.js";
import * as fs from "fs";
import bs58 from "bs58";

const ORDERS = parseInt(process.env.ORDERS || "10000", 10);
const MAX_INFLIGHT = parseInt(process.env.MAX_INFLIGHT || "3000", 10);
const CU_SAMPLE = parseInt(process.env.CU_SAMPLE || "200", 10);
const STATUS_POLL_MS = parseInt(process.env.STATUS_POLL_MS || "1500", 10);
const CONFIRM_TIMEOUT_SEC = parseInt(process.env.CONFIRM_TIMEOUT_SEC || "90", 10);
const BLOCKHASH_MS = parseInt(process.env.BLOCKHASH_MS || "10000", 10);
const SEND_WORKERS = parseInt(process.env.SEND_WORKERS || "64", 10);
const ZONE_ID = parseInt(process.env.ZONE_ID || "701", 10);
const ORDER_ID_BASE = BigInt(process.env.ORDER_ID_BASE || String(Date.now()) + "000000");
const SHARDS = 16;

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}
function median(a: number[]): number { return pct([...a].sort((x, y) => x - y), 50); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Trading as Program<Trading>;
  const payer = (provider.wallet as any).payer as Keypair;
  const conn = provider.connection;

  const [marketPda] = PublicKey.findProgramAddressSync([Buffer.from("market")], program.programId);
  const zoneBuf = Buffer.alloc(4); zoneBuf.writeUInt32LE(ZONE_ID);
  const [zoneMarketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("zone_market"), marketPda.toBuffer(), zoneBuf], program.programId);
  const shardPdas = Array.from({ length: SHARDS }, (_, s) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("zone_shard"), zoneMarketPda.toBuffer(), Buffer.from([s])], program.programId)[0]);

  console.log("═".repeat(70));
  console.log(`  ${ORDERS}-ORDER TRADING (CDA order-entry) THROUGHPUT BENCHMARK`);
  console.log("═".repeat(70));
  console.log(`RPC:    ${(conn as any)._rpcEndpoint}`);
  console.log(`Payer:  ${payer.publicKey.toBase58()}`);
  console.log(`Market: ${marketPda.toBase58()}  Zone: ${ZONE_ID} (${zoneMarketPda.toBase58().slice(0, 8)}…)`);
  console.log(`Orders=${ORDERS} MaxInflight=${MAX_INFLIGHT} Poll=${STATUS_POLL_MS}ms Shards=${SHARDS}\n`);

  // ── Idempotent bootstrap: market → zone_market → 16 shards ────────────────
  try {
    await program.methods.initializeMarket(SHARDS).accounts({
      market: marketPda, authority: payer.publicKey, systemProgram: SystemProgram.programId,
    } as any).rpc();
    console.log("bootstrap: market initialized");
  } catch (e: any) { if (!/already in use/.test(e.message)) throw e; }
  try {
    await program.methods.initializeZoneMarket(ZONE_ID, SHARDS, new BN("1000000000000000"), 0).accounts({
      market: marketPda, zoneMarket: zoneMarketPda, authority: payer.publicKey,
      systemProgram: SystemProgram.programId,
    } as any).rpc();
    console.log("bootstrap: zone_market initialized");
  } catch (e: any) { if (!/already in use/.test(e.message)) throw e; }
  for (let s = 0; s < SHARDS; s++) {
    try {
      await program.methods.initializeZoneMarketShard(s).accounts({
        zoneMarket: zoneMarketPda, zoneShard: shardPdas[s], payer: payer.publicKey,
        systemProgram: SystemProgram.programId,
      } as any).rpc();
    } catch (e: any) { if (!/already in use/.test(e.message)) throw e; }
  }
  console.log("bootstrap: 16 zone shards ready\n");

  // ── Cached blockhash refresher ─────────────────────────────────────────────
  let cachedBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
  let refresherOn = true;
  const refresher = (async () => {
    while (refresherOn) {
      await sleep(BLOCKHASH_MS);
      try { cachedBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash; } catch { /* keep old */ }
    }
  })();

  console.log(`🕒 draining ${ORDERS} order submissions (window ${MAX_INFLIGHT})...`);
  const burstStart = Date.now();

  const unresolved = new Map<string, number>();
  const latencies: number[] = [];
  const okSigs: string[] = [];
  const failBreakdown = { sendError: 0, statusErr: 0, expired: 0 };
  const errSamples: string[] = [];
  const sampleErr = (cat: string, msg: string) => {
    if (errSamples.length < 9 && !errSamples.some((s) => s.startsWith(cat) && s.includes(msg.slice(0, 40))))
      errSamples.push(`${cat}: ${msg.slice(0, 160)}`);
  };
  let fail = 0, sent = 0, sendingDone = false;
  let lastSendTime = Date.now();
  let lastConfirmTime = burstStart;

  const poller = (async () => {
    while (true) {
      if (unresolved.size === 0) {
        if (sendingDone) break;
        await sleep(200); continue;
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
            if (!st) return;
            if (st.err) {
              unresolved.delete(sig); fail++; failBreakdown.statusErr++;
              sampleErr("statusErr", JSON.stringify(st.err));
            } else if (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized") {
              const t0 = unresolved.get(sig)!;
              unresolved.delete(sig);
              latencies.push(now - t0); okSigs.push(sig); lastConfirmTime = now;
            }
          });
        } catch { /* transient */ }
      }
      if (sendingDone && Date.now() - lastSendTime > CONFIRM_TIMEOUT_SEC * 1000) {
        fail += unresolved.size; failBreakdown.expired += unresolved.size;
        if (unresolved.size > 0) sampleErr("expired", `${unresolved.size} sigs unconfirmed after ${CONFIRM_TIMEOUT_SEC}s`);
        unresolved.clear(); break;
      }
    }
  })();

  let nextIdx = 0;
  async function sendWorker() {
    while (true) {
      const i = nextIdx++;
      if (i >= ORDERS) return;
      while (unresolved.size >= MAX_INFLIGHT) await sleep(25);
      const orderId = new BN((ORDER_ID_BASE + BigInt(i)).toString());
      const side = i % 2; // alternate buy/sell
      const amount = new BN((1 + (i % 50)) * 1_000_000_000); // 1..50 kWh, 9-dec
      const price = new BN(3_000_000 + (i % 100) * 10_000);  // 3.0..4.0 THBC/kWh, 6-dec
      const shard = i % SHARDS;
      const [orderPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("order"), payer.publicKey.toBuffer(), orderId.toArrayLike(Buffer, "le", 8)],
        program.programId);
      try {
        const ix = await program.methods
          .submitLimitOrderSharded(orderId, side, amount, price, shard)
          .accounts({
            order: orderPda, zoneMarket: zoneMarketPda, zoneShard: shardPdas[shard],
            authority: payer.publicKey, systemProgram: SystemProgram.programId,
            // context declares governance_config but the sharded handler never
            // reads it (dead account in SubmitLimitOrderShardedContext) — any
            // account satisfies the unchecked slot.
            governanceConfig: marketPda,
          } as any)
          .instruction();
        const tx = new Transaction();
        tx.feePayer = payer.publicKey;
        tx.recentBlockhash = cachedBlockhash;
        tx.add(ix);
        tx.sign(payer);
        const sig = bs58.encode(tx.signature!);
        const t0 = Date.now();
        await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 0 });
        unresolved.set(sig, t0); sent++; lastSendTime = t0;
      } catch (err: any) {
        fail++; failBreakdown.sendError++;
        sampleErr("sendError", (err?.message || String(err)).split("\n")[0]);
      }
      if (sent % 10000 === 0 && sent > 0)
        console.log(`   … sent ${sent}/${ORDERS}  confirmed=${latencies.length}  inflight=${unresolved.size}`);
    }
  }
  await Promise.all(Array.from({ length: SEND_WORKERS }, sendWorker));
  sendingDone = true;
  await poller;
  refresherOn = false;
  await refresher.catch(() => {});

  const wallMs = lastConfirmTime - burstStart;
  const lat = [...latencies].sort((a, b) => a - b);
  const ok = latencies.length;

  // CU from the tail of the burst (survives ledger rotation)
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

  const summary = {
    generatedAt: new Date().toISOString(),
    config: {
      orders: ORDERS, zoneId: ZONE_ID, shards: SHARDS, maxInflight: MAX_INFLIGHT,
      cuSample: CU_SAMPLE, statusPollMs: STATUS_POLL_MS, sendWorkers: SEND_WORKERS,
    },
    rpc: (conn as any)._rpcEndpoint,
    programId: program.programId.toBase58(),
    totals: { tx: ORDERS, ok, fail, lossRatePct: +((fail / ORDERS) * 100).toFixed(3), failBreakdown },
    wallMs, tps: +(ok / (wallMs / 1000)).toFixed(2),
    latency: { p50: pct(lat, 50), p95: pct(lat, 95), max: lat.length ? lat[lat.length - 1] : 0 },
    cu: { min: cuSorted[0] || 0, med: median(cus), max: cuSorted[cuSorted.length - 1] || 0, samples: cus.length },
    errSamples,
    serializationNote:
      "single fee-payer write-locked per tx; SubmitLimitOrderShardedContext still marks zone_market mut " +
      "(programs/trading/src/lib.rs:1755) although the handler writes only zone_shard — both serialize order entry.",
  };

  fs.mkdirSync("test-results", { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = `test-results/trading-order-entry-${ORDERS}o-${stamp}.json`;
  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2));

  const md = [
    `# ${ORDERS}-Order CDA Order-Entry Throughput Benchmark`, ``,
    `- Generated: ${summary.generatedAt}`,
    `- RPC: \`${summary.rpc}\`  Trading: \`${summary.programId}\``,
    `- Config: ${ORDERS} orders (alt buy/sell), zone ${ZONE_ID}, ${SHARDS} shards round-robin, ${MAX_INFLIGHT} in-flight window, raw-send + ${STATUS_POLL_MS}ms bulk status polling`,
    `- Serialization: ${summary.serializationNote}`, ``,
    `| ok/N | fail (send/onchain/expired) | wall (ms) | TPS | lat p50 | lat p95 | lat max | CU min | CU med | CU max |`,
    `|-----:|:----------------------------|----------:|----:|--------:|--------:|--------:|-------:|-------:|-------:|`,
    `| ${ok}/${ORDERS} | ${fail} (${failBreakdown.sendError}/${failBreakdown.statusErr}/${failBreakdown.expired}) | ${wallMs} | ${summary.tps} | ${summary.latency.p50} | ${summary.latency.p95} | ${summary.latency.max} | ${summary.cu.min} | ${summary.cu.med} | ${summary.cu.max} |`,
    ``,
    ...(errSamples.length ? [`### Failure samples`, ``, ...errSamples.map((s) => `- ${s}`), ``] : []),
    `> Latency is send→first-seen-confirmed via bulk \`getSignatureStatuses\` polling (±${STATUS_POLL_MS}ms).`,
    ``,
  ].join("\n");
  const mdPath = `test-results/trading-order-entry-${ORDERS}o-${stamp}.md`;
  fs.writeFileSync(mdPath, md);

  console.log("\n" + "═".repeat(70));
  console.log(`SUMMARY ORDERS=${ORDERS}: ${ok}/${ORDERS} ok (${summary.totals.lossRatePct}% loss)  TPS=${summary.tps}`);
  console.log(`fail: send=${failBreakdown.sendError} onchain=${failBreakdown.statusErr} expired=${failBreakdown.expired}`);
  console.log(`CU min=${summary.cu.min} med=${summary.cu.med} max=${summary.cu.max}  lat p50=${summary.latency.p50} p95=${summary.latency.p95}`);
  console.log(`Saved:\n  ${jsonPath}\n  ${mdPath}`);
  console.log("═".repeat(70));
}

main().catch((e) => { console.error(e); process.exit(1); });
