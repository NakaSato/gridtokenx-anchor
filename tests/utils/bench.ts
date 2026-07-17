import { Connection } from "@solana/web3.js";
import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * Academic-grade microbenchmark harness.
 *
 * Why this exists: the original suites timed a single invocation per operation
 * (or none at all), which gives a point estimate with no notion of variance —
 * unusable for a paper. A defensible measurement reports a *distribution*:
 * central tendency, dispersion, tail percentiles, and a confidence interval,
 * gathered over many iterations after a warmup phase that discards cold-start
 * effects (JIT of the RPC client, account-cache population, validator banking
 * warmup). This module standardizes that across all benchmark suites and emits
 * machine-readable JSON + CSV plus a reproducibility header (git commit, RPC
 * cluster version, host CPU/OS) so a result can be cited and replicated.
 */

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

export interface Stats {
  /** Number of measured samples (warmup excluded). */
  n: number;
  mean: number;
  /** Sample standard deviation (n-1 denominator, Bessel-corrected). */
  stddev: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
  p999: number;
  /** Half-width of the 95% confidence interval of the mean (normal approx). */
  ci95: number;
}

/**
 * Percentile via linear interpolation between closest ranks (the "type 7" /
 * NumPy-default method). `p` is a fraction in [0, 1]. `sorted` must be ascending.
 */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

/** Summarize a sample vector into the {@link Stats} reported in the paper. */
export function summarize(samples: number[]): Stats {
  const n = samples.length;
  if (n === 0) {
    return { n: 0, mean: NaN, stddev: NaN, min: NaN, max: NaN, p50: NaN, p95: NaN, p99: NaN, p999: NaN, ci95: NaN };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((a, b) => a + b, 0) / n;
  // Bessel-corrected variance; with a single sample dispersion is undefined → 0.
  const variance = n > 1 ? samples.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  const stddev = Math.sqrt(variance);
  // 95% CI of the mean via the normal approximation (z = 1.96). For small n a
  // Student-t multiplier would be stricter; n is large here by construction.
  const ci95 = n > 1 ? 1.96 * (stddev / Math.sqrt(n)) : 0;
  return {
    n,
    mean,
    stddev,
    min: sorted[0],
    max: sorted[n - 1],
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    p999: percentile(sorted, 0.999),
    ci95,
  };
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

export interface OpResult {
  label: string;
  /** Iterations whose latency was recorded (warmup excluded). */
  iters: number;
  /** Warmup iterations executed and discarded before measurement. */
  warmup: number;
  /** Failed invocations during the measured phase. */
  failures: number;
  /** Wall-clock seconds spanning the measured phase. */
  wallSeconds: number;
  /** Sequential throughput = iters / wallSeconds (ops/sec). */
  throughput: number;
  /** Per-call wall-clock latency distribution (milliseconds). */
  latency: Stats;
  /** Per-call compute units consumed, when captured; otherwise null. */
  cu: Stats | null;
}

/**
 * Measure one operation over `warmup + iters` sequential invocations. The first
 * `warmup` calls are executed but excluded from the reported distribution.
 *
 * `fn` returns a transaction signature (enabling optional compute-unit capture)
 * or void. CU capture is done *after* the latency timer via a follow-up RPC, so
 * it never inflates the measured latency.
 */
export async function measureOp(opts: {
  label: string;
  iters: number;
  warmup?: number;
  connection?: Connection;
  captureCu?: boolean;
  fn: (i: number) => Promise<string | void>;
}): Promise<OpResult> {
  const warmup = opts.warmup ?? Math.max(1, Math.floor(opts.iters * 0.1));
  const latencies: number[] = [];
  const cus: number[] = [];
  const signatures: string[] = [];
  let failures = 0;

  // Warmup — run and discard.
  for (let i = 0; i < warmup; i++) {
    try {
      await opts.fn(i);
    } catch {
      // cold-start failures are ignored by design
    }
  }

  const wallStart = performance.now();
  for (let i = 0; i < opts.iters; i++) {
    const t0 = performance.now();
    try {
      const sig = await opts.fn(warmup + i);
      latencies.push(performance.now() - t0);
      if (typeof sig === "string") signatures.push(sig);
    } catch {
      failures++;
    }
  }
  const wallSeconds = (performance.now() - wallStart) / 1000;

  // Compute-unit capture (post-hoc, off the latency path).
  if (opts.captureCu && opts.connection && signatures.length > 0) {
    for (const sig of signatures) {
      try {
        const tx = await opts.connection.getTransaction(sig, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });
        const consumed = tx?.meta?.computeUnitsConsumed;
        if (typeof consumed === "number") cus.push(consumed);
      } catch {
        // best-effort; missing CU just shrinks the CU sample
      }
    }
  }

  return {
    label: opts.label,
    iters: latencies.length,
    warmup,
    failures,
    wallSeconds,
    throughput: wallSeconds > 0 ? latencies.length / wallSeconds : 0,
    latency: summarize(latencies),
    cu: cus.length > 0 ? summarize(cus) : null,
  };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export interface RunMetadata {
  timestamp: string;
  gitCommit: string;
  gitDirty: boolean;
  clusterVersion: string;
  node: string;
  os: string;
  arch: string;
  cpu: string;
  cores: number;
}

export async function collectMetadata(connection?: Connection, timestamp?: string): Promise<RunMetadata> {
  let gitCommit = "unknown";
  let gitDirty = false;
  try {
    gitCommit = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    gitDirty = execSync("git status --porcelain", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim().length > 0;
  } catch {
    /* not a git checkout */
  }
  let clusterVersion = "unknown";
  if (connection) {
    try {
      clusterVersion = (await connection.getVersion())["solana-core"] ?? "unknown";
    } catch {
      /* RPC down */
    }
  }
  const cpus = os.cpus();
  return {
    // Date.now()/new Date() are intentionally injected by the caller so the
    // harness stays deterministic where the runtime forbids wall-clock calls.
    timestamp: timestamp ?? "unset",
    gitCommit,
    gitDirty,
    clusterVersion,
    node: process.version,
    os: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    cpu: cpus[0]?.model ?? "unknown",
    cores: cpus.length,
  };
}

function fmt(x: number): string {
  if (!isFinite(x)) return "n/a";
  if (x >= 1000) return x.toFixed(0);
  if (x >= 1) return x.toFixed(2);
  return x.toFixed(3);
}

/**
 * Accumulates {@link OpResult}s for one suite and, on {@link finalize}, prints an
 * aligned console table and writes `test-results/<suite>/<suite>-<ts>.{json,csv}`.
 */
export class BenchReport {
  private results: OpResult[] = [];
  constructor(private suite: string) {}

  add(r: OpResult): void {
    this.results.push(r);
  }

  /**
   * @param connection used to stamp the RPC cluster version into metadata.
   * @param timestamp ISO string for the run (injected; defaults to "unset").
   */
  async finalize(connection?: Connection, timestamp?: string): Promise<RunMetadata> {
    const meta = await collectMetadata(connection, timestamp);

    // Console table — latency in ms, throughput in ops/s, CU mean.
    const header = `\n=== ${this.suite} — benchmark results ===`;
    const cols = ["operation", "n", "mean", "stddev", "p50", "p95", "p99", "ci95", "tps", "cu", "fail"];
    const rows = this.results.map((r) => [
      r.label,
      String(r.iters),
      fmt(r.latency.mean),
      fmt(r.latency.stddev),
      fmt(r.latency.p50),
      fmt(r.latency.p95),
      fmt(r.latency.p99),
      fmt(r.latency.ci95),
      fmt(r.throughput),
      r.cu ? fmt(r.cu.mean) : "n/a",
      String(r.failures),
    ]);
    const widths = cols.map((c, i) => Math.max(c.length, ...rows.map((row) => row[i].length)));
    const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
    console.log(header);
    console.log(`commit ${meta.gitCommit.slice(0, 8)}${meta.gitDirty ? "-dirty" : ""}  cluster ${meta.clusterVersion}  ${meta.cpu} x${meta.cores}`);
    console.log("latency = ms (wall-clock, sequential); tps = ops/s; cu = compute units/tx");
    console.log(line(cols));
    console.log(widths.map((w) => "-".repeat(w)).join("  "));
    rows.forEach((row) => console.log(line(row)));
    console.log("");

    // Persist JSON (full distribution) + CSV (one row per op).
    const dir = path.join(process.cwd(), "test-results", this.suite);
    fs.mkdirSync(dir, { recursive: true });
    const stamp = (timestamp ?? "unset").replace(/[:.]/g, "-");
    const base = path.join(dir, `${this.suite}-${stamp}`);

    fs.writeFileSync(`${base}.json`, JSON.stringify({ suite: this.suite, metadata: meta, results: this.results }, null, 2));

    const csvCols = [
      "operation", "n", "warmup", "failures", "wall_s", "throughput_ops_s",
      "lat_mean_ms", "lat_stddev_ms", "lat_min_ms", "lat_max_ms",
      "lat_p50_ms", "lat_p95_ms", "lat_p99_ms", "lat_p999_ms", "lat_ci95_ms",
      "cu_mean", "cu_p95", "cu_max",
    ];
    const csvRows = this.results.map((r) => [
      r.label, r.iters, r.warmup, r.failures, r.wallSeconds.toFixed(4), r.throughput.toFixed(4),
      r.latency.mean, r.latency.stddev, r.latency.min, r.latency.max,
      r.latency.p50, r.latency.p95, r.latency.p99, r.latency.p999, r.latency.ci95,
      r.cu?.mean ?? "", r.cu?.p95 ?? "", r.cu?.max ?? "",
    ].join(","));
    fs.writeFileSync(`${base}.csv`, [csvCols.join(","), ...csvRows].join("\n") + "\n");

    console.log(`Results written: ${base}.json / ${base}.csv\n`);
    return meta;
  }
}
