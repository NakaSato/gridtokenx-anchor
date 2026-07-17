// bench-lambda-ramp.ts — OPEN-LOOP arrival-rate (λ) ramp to saturation.
//
// The closed-loop TPC-C sweep in BENCHMARKS.md §3 never saturated through c=40
// because a fixed in-flight window self-throttles: it can't offer load faster than
// it drains. This harness instead fixes the ARRIVAL RATE λ (txs/sec) and fires
// open-loop — no per-tx and no per-round confirm barrier — so offered load is
// decoupled from completion. Ramping λ locates the knee (achieved < offered) and
// the SLA-collapse point (p99 latency past a deadline), giving max SUSTAINABLE TPS
// at an SLA rather than a single closed-loop point.
//
// Method: at each λ level, pre-build+sign a pool of `λ·DURATION` txs against a
// fresh blockhash (sign cost excluded from the measurement window), then release
// them on a token-bucket schedule (send at t = i/λ). Confirmation is async: after
// the send window, bulk getSignatureStatuses sweeps to confirmed. Latency is
// send→first-seen-confirmed. Goodput = confirmed / window.
//
// Target instruction: trading.create_buy_order (fresh Order PDA per tx). NB this
// path write-locks the shared zone_market (active_orders++), the §10 defect — so
// the ceiling found here is the ORDER-BOOK lock, not pure block-time. Point the
// same harness at a Sealevel-disjoint path (multi-gateway meter submit) to isolate
// consensus/block-time; the scheduler is instruction-agnostic.
//
// Env: LAMBDAS="20 40 80 160 320"  DURATION=8 (s/level)  SLA_P99_MS=4000
//      ZONE_ID=4242  ANCHOR_PROVIDER_URL/ANCHOR_WALLET
// Run: ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET=~/.config/solana/id.json \
//        npx tsx scripts/bench-lambda-ramp.ts

import * as anchor from "@anchor-lang/core";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  Connection,
  Keypair,
} from "@solana/web3.js";
import BN from "bn.js";
import bs58 from "bs58";
import * as fs from "fs";

const LAMBDAS = (process.env.LAMBDAS || "20 40 80 160 320").split(/\s+/).map(Number);
const DURATION = process.env.DURATION ? parseFloat(process.env.DURATION) : 8;
const SLA_P99_MS = process.env.SLA_P99_MS ? parseInt(process.env.SLA_P99_MS, 10) : 4000;
const ZONE_ID = process.env.ZONE_ID ? parseInt(process.env.ZONE_ID, 10) : 4242;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const u32le = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const pct = (sorted: number[], p: number) => {
  if (!sorted.length) return NaN;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx),
    hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
};

interface LevelResult {
  lambda: number;
  offered: number;
  confirmed: number;
  achievedTps: number;
  lossPct: number;
  p50: number;
  p95: number;
  p99: number;
  slaOk: boolean;
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const trading = anchor.workspace.Trading as anchor.Program;
  const governance = anchor.workspace.Governance as anchor.Program;
  const conn: Connection = provider.connection;
  const wallet = (provider.wallet as any).payer as Keypair; // NodeWallet holds the Keypair
  if (!wallet?.secretKey) throw new Error("expected a local Keypair wallet (ANCHOR_WALLET)");

  const [marketPda] = PublicKey.findProgramAddressSync([Buffer.from("market")], trading.programId);
  const [zoneMarketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("zone_market"), marketPda.toBuffer(), u32le(ZONE_ID)],
    trading.programId,
  );
  const [governanceConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("governance_config")],
    governance.programId,
  );
  // Ensure zone exists (idempotent).
  try {
    await trading.methods
      .initializeZoneMarket(ZONE_ID, 1, new BN(0), 0)
      .accounts({ market: marketPda, zoneMarket: zoneMarketPda, authority: wallet.publicKey, systemProgram: SystemProgram.programId })
      .rpc();
  } catch (e: any) {
    if (!/already in use/.test(e.message)) throw e;
  }

  let orderCounter = new BN(Date.now()).muln(1000); // unique order-id base across the whole run
  const buildSignedBuy = async (blockhash: string): Promise<{ sig: string; raw: Uint8Array }> => {
    const orderId = orderCounter.addn(1);
    orderCounter = orderId;
    const [orderPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("order"), wallet.publicKey.toBuffer(), orderId.toArrayLike(Buffer, "le", 8)],
      trading.programId,
    );
    const ix = await trading.methods
      .createBuyOrder(orderId, new BN(1_000_000_000), new BN(4_000_000)) // 1 kWh @ 4.00
      .accounts({
        market: marketPda,
        zoneMarket: zoneMarketPda,
        order: orderPda,
        authority: wallet.publicKey,
        systemProgram: SystemProgram.programId,
        governanceConfig: governanceConfigPda,
      })
      .instruction();
    const tx = new Transaction().add(ix);
    tx.recentBlockhash = blockhash;
    tx.feePayer = wallet.publicKey;
    tx.sign(wallet);
    return { sig: bs58Sig(tx), raw: tx.serialize() };
  };

  const results: LevelResult[] = [];
  console.log(`open-loop λ-ramp  levels=[${LAMBDAS}]  ${DURATION}s/level  SLA p99<${SLA_P99_MS}ms  zone=${ZONE_ID}\n`);

  for (const lambda of LAMBDAS) {
    const target = Math.max(1, Math.round(lambda * DURATION));
    // Pre-build + sign the whole pool for this level against a fresh blockhash
    // (excluded from the measured window). Blockhash lifetime ~60s > level window.
    const { blockhash } = await conn.getLatestBlockhash("finalized");
    const pool: { sig: string; raw: Uint8Array }[] = [];
    for (let i = 0; i < target; i++) pool.push(await buildSignedBuy(blockhash));

    // Open-loop send: release tx i at t = i/λ, do NOT await confirmation.
    // Confirmation runs CONCURRENTLY with sending so latency is true
    // send→first-seen-confirmed, not inflated by the send window. A 150ms sweep
    // polls whatever is pending while the send loop is still releasing txs.
    const latencies: number[] = [];
    const pending = new Map<string, number>(); // sig -> sendTime
    const rejected = new Set<string>();
    let sending = true;
    const deadline = perfNow() + DURATION * 1000 + 90_000;
    const poller = (async () => {
      while ((sending || pending.size > 0) && perfNow() < deadline) {
        if (pending.size > 0) {
          const batch = [...pending.keys()].slice(0, 256);
          const statuses = await conn.getSignatureStatuses(batch, { searchTransactionHistory: false });
          statuses.value.forEach((st, k) => {
            if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) {
              const sig = batch[k];
              latencies.push(perfNow() - (pending.get(sig) ?? perfNow()));
              pending.delete(sig);
            }
          });
        }
        await sleep(150);
      }
    })();

    const t0 = perfNow();
    for (let i = 0; i < pool.length; i++) {
      const due = (i / lambda) * 1000;
      const now = perfNow() - t0;
      if (due > now) await sleep(due - now);
      const { sig, raw } = pool[i];
      pending.set(sig, perfNow());
      conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {
        rejected.add(sig); // send-reject: never entered validator
        pending.delete(sig);
      });
    }
    sending = false;
    await poller;

    latencies.sort((a, b) => a - b);
    const confirmed = latencies.length;
    const achievedTps = confirmed / DURATION;
    const p99 = pct(latencies, 99);
    const r: LevelResult = {
      lambda,
      offered: target,
      confirmed,
      achievedTps,
      lossPct: ((target - confirmed) / target) * 100,
      p50: pct(latencies, 50),
      p95: pct(latencies, 95),
      p99,
      slaOk: p99 <= SLA_P99_MS,
    };
    results.push(r);
    console.log(
      `  λ=${String(lambda).padStart(4)}  offered=${String(target).padStart(4)}  conf=${String(confirmed).padStart(4)}  ` +
        `TPS=${achievedTps.toFixed(1).padStart(6)}  loss=${r.lossPct.toFixed(1).padStart(5)}%  ` +
        `p50=${r.p50.toFixed(0)}  p95=${r.p95.toFixed(0)}  p99=${r.p99.toFixed(0)}ms  ${r.slaOk ? "SLA✓" : "SLA✗"}`,
    );
  }

  // Knee = first λ where achieved TPS stops tracking offered λ (< 85% of λ) OR SLA breaks.
  const knee = results.find((r, i) => r.achievedTps < 0.85 * r.lambda || !r.slaOk);
  const peakSustained = results.filter((r) => r.slaOk).reduce((mx, r) => Math.max(mx, r.achievedTps), 0);
  console.log(`\n  peak sustainable TPS @ p99<${SLA_P99_MS}ms = ${peakSustained.toFixed(1)}`);
  console.log(`  saturation knee: ${knee ? `λ=${knee.lambda} (achieved ${knee.achievedTps.toFixed(1)} TPS, p99 ${knee.p99.toFixed(0)}ms${knee.slaOk ? "" : ", SLA breached"})` : "not reached in ramp — extend LAMBDAS"}`);

  const out = process.env.OUT || `test-results/lambda-ramp-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  fs.mkdirSync("test-results", { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ target: "trading.create_buy_order", zoneId: ZONE_ID, durationSec: DURATION, slaP99Ms: SLA_P99_MS, peakSustained, knee: knee ?? null, levels: results, generatedAt: new Date().toISOString() }, null, 2));
  console.log(`  wrote ${out}`);
}

// perf clock (ms) — Date.now is fine here (a normal script, not a workflow).
function perfNow(): number {
  return Number(process.hrtime.bigint() / 1_000_000n);
}
// base58 of the tx signature (first sig) without extra deps.
function bs58Sig(tx: Transaction): string {
  const sig = tx.signature;
  if (!sig) throw new Error("unsigned tx");
  return bs58.encode(sig);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
