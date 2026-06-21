// Shared CU-baseline helper for the in-process CU profiles (tests/cu_profile_*_litesvm.ts).
//
// litesvm compute-unit cost is deterministic for a given .so, so a committed baseline turns
// the profiles into a *regression gate finer than the 200k budget*: any instruction that
// drifts more than `tolerancePct` from its recorded value fails CI. A new instruction with
// no baseline entry also fails (forces an explicit regen).
//
// Each profile calls `assertBaseline(profile)` from its `after()` hook. To (re)generate the
// baseline after an intentional change or a toolchain bump:
//
//   CU_BASELINE_UPDATE=1 npm run test:cu-profile
//
// which merges every profile's measured values into tests/cu-baseline.json.

import * as fs from "fs";
import * as path from "path";
import { Keypair } from "@solana/web3.js";

// Deterministic keypair from a fixed 1-byte fill. CU profiles MUST use these (not
// Keypair.generate()) so PDA addresses — and therefore the PDA bump-search iteration
// count, which is charged in CU — are reproducible run-to-run. With random keys, init
// instructions that create PDAs jitter by thousands of CU and no tight baseline is possible.
export const fixedKeypair = (n: number): Keypair => Keypair.fromSeed(new Uint8Array(32).fill(n & 0xff));

const BASELINE_PATH = path.join(process.cwd(), "tests", "cu-baseline.json");
const DEFAULT_TOLERANCE_PCT = 5;

type Entry = { ix: string; cu: number };

function readBaseline(): Record<string, number> {
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeBaseline(map: Record<string, number>) {
  const sorted: Record<string, number> = {};
  for (const k of Object.keys(map).sort()) sorted[k] = map[k];
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(sorted, null, 2) + "\n");
}

/**
 * Compare a profile's measured CU against the committed baseline, or merge into it when
 * CU_BASELINE_UPDATE=1. Throws (failing the suite) on drift beyond tolerance or a missing
 * baseline entry. Updates accumulate across profiles because mocha runs the files in one
 * process (read-modify-write per call).
 */
export function assertBaseline(profile: Entry[], opts: { tolerancePct?: number } = {}) {
  const tol = opts.tolerancePct ?? DEFAULT_TOLERANCE_PCT;

  if (process.env.CU_BASELINE_UPDATE === "1") {
    const map = readBaseline();
    for (const { ix, cu } of profile) map[ix] = cu;
    writeBaseline(map);
    return;
  }

  const base = readBaseline();
  const errs: string[] = [];
  for (const { ix, cu } of profile) {
    const b = base[ix];
    if (b == null) {
      errs.push(`${ix}: no baseline entry (measured ${cu}); run CU_BASELINE_UPDATE=1 to record`);
      continue;
    }
    const drift = (Math.abs(cu - b) / b) * 100;
    if (drift > tol) {
      errs.push(`${ix}: ${cu} CU vs baseline ${b} (${drift.toFixed(1)}% > ${tol}% tolerance)`);
    }
  }
  if (errs.length) {
    throw new Error(
      "CU baseline drift detected:\n  " + errs.join("\n  ") +
      "\nIf intentional, regenerate with: CU_BASELINE_UPDATE=1 npm run test:cu-profile",
    );
  }
}
