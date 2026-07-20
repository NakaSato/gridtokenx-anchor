/**
 * summarize-meter-scale.ts — combine per-scale bench-meter-throughput.ts JSON
 * results into one scaling summary (JSON + Markdown table).
 *
 * Usage: npx tsx scripts/summarize-meter-scale.ts <result1.json> <result2.json> ...
 *        (run automatically by scripts/run-meter-scale-sweep.sh)
 *
 * Env: OUTDIR (default test-results)
 */
import * as fs from "fs";
import * as path from "path";

interface BenchSummary {
  generatedAt: string;
  config: { meters: number; epochs: number; maxInflight: number };
  rpc: string;
  programId: string;
  totals: {
    tx: number;
    ok: number;
    fail: number;
    lossRatePct: number;
    failBreakdown: { sendError: number; statusErr: number; expired: number };
  };
  firstEpochInit: { cuMed: number; cuMax: number; tps: number; latP50: number; latP95: number };
  steadyState: {
    cuMed: number;
    cuMax: number;
    tpsMean: number;
    tpsMax: number;
    latP50Med: number;
    latP95Max: number;
    latMax: number;
  } | null;
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: npx tsx scripts/summarize-meter-scale.ts <result.json> ...");
  process.exit(1);
}

const rows = files
  .map((f) => ({ file: f, data: JSON.parse(fs.readFileSync(f, "utf8")) as BenchSummary }))
  .sort((a, b) => a.data.config.meters - b.data.config.meters);

const outDir = process.env.OUTDIR || "test-results";
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

const combined = {
  generatedAt: new Date().toISOString(),
  rpc: rows[0].data.rpc,
  programId: rows[0].data.programId,
  scales: rows.map(({ file, data }) => ({
    meters: data.config.meters,
    source: path.basename(file),
    totalTx: data.totals.tx,
    ok: data.totals.ok,
    lossRatePct: data.totals.lossRatePct,
    failBreakdown: data.totals.failBreakdown,
    init: data.firstEpochInit,
    steady: data.steadyState,
  })),
};

const jsonPath = path.join(outDir, `meter-scale-summary-${stamp}.json`);
fs.writeFileSync(jsonPath, JSON.stringify(combined, null, 2));

const fmt = (n: number | undefined) => (typeof n === "number" ? n.toLocaleString("en-US") : "—");
const md = [
  `# Meter-Count Scaling Summary`,
  ``,
  `- Generated: ${combined.generatedAt}`,
  `- RPC: \`${combined.rpc}\`  Oracle: \`${combined.programId}\``,
  `- Source: \`scripts/bench-meter-throughput.ts\` per scale (epoch 1 = per-meter PDA init, epoch ≥2 = steady write), combined by \`scripts/summarize-meter-scale.ts\``,
  `- Serialization point: single gateway fee-payer (per-meter PDAs are disjoint under Sealevel)`,
  ``,
  `| Meters | tx ok/total | loss % | init TPS | steady TPS (mean) | lat p50 (ms) | lat p95 max (ms) | CU init med | CU steady med |`,
  `|-------:|------------:|-------:|---------:|------------------:|-------------:|-----------------:|------------:|--------------:|`,
  ...combined.scales.map((s) =>
    `| ${fmt(s.meters)} | ${fmt(s.ok)}/${fmt(s.totalTx)} | ${s.lossRatePct} | ${s.init.tps} | ${s.steady ? s.steady.tpsMean : "—"} | ${s.steady ? s.steady.latP50Med : s.init.latP50} | ${s.steady ? s.steady.latP95Max : s.init.latP95} | ${fmt(s.init.cuMed)} | ${s.steady ? fmt(s.steady.cuMed) : "—"} |`
  ),
  ``,
  `## Fail breakdown per scale`,
  ``,
  `| Meters | send-rejected | on-chain error | expired/unconfirmed |`,
  `|-------:|--------------:|---------------:|--------------------:|`,
  ...combined.scales.map(
    (s) => `| ${fmt(s.meters)} | ${s.failBreakdown.sendError} | ${s.failBreakdown.statusErr} | ${s.failBreakdown.expired} |`
  ),
  ``,
  `> Latency values are quantised by the bench's status-poll interval; see each`,
  `> per-scale report for epoch-level detail.`,
  ``,
].join("\n");

const mdPath = path.join(outDir, `meter-scale-summary-${stamp}.md`);
fs.writeFileSync(mdPath, md);

console.log(`\nCombined scaling summary:`);
console.log(md);
console.log(`Saved:\n  ${jsonPath}\n  ${mdPath}`);
