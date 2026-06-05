import { ComputeBudgetProgram, TransactionInstruction } from "@solana/web3.js";

/**
 * Client-side compute-budget helpers.
 *
 * Solana bills the *requested* compute-unit limit for priority fees and applies
 * a 200,000 CU/instruction default. Settlement transactions here (e.g.
 * `executeAtomicSettlement`, `batchSettleOffchainMatch`) issue several CPIs and
 * benefit from an explicit, simulation-sized limit so they (a) never silently
 * hit the default ceiling and (b) only pay priority fees on the CUs they need.
 */

/** Default safety margin applied on top of simulated consumption. */
export const DEFAULT_HEADROOM = 1.1;

/**
 * Build compute-budget pre-instructions: an explicit CU limit, plus an optional
 * priority-fee price. Prepend these to a transaction (Anchor: `.preInstructions`).
 */
export function computeBudgetPreIxs(
  unitLimit: number,
  microLamports?: number
): TransactionInstruction[] {
  const ixs: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: Math.ceil(unitLimit) }),
  ];
  if (microLamports && microLamports > 0) {
    ixs.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports }));
  }
  return ixs;
}

/** Parse "consumed N of M compute units" out of program simulation logs. */
export function parseConsumedUnits(
  logs: string[] | null | undefined
): number | null {
  if (!logs) return null;
  for (const line of logs) {
    const m = line.match(/consumed (\d+) of \d+ compute units/);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

/**
 * Simulate an Anchor methods builder and return the CUs it consumes (null if the
 * log line is absent). Use the result to size a CU limit (`consumed * headroom`)
 * and to assert the real run stays under budget.
 *
 * `builder` is an Anchor `MethodsBuilder` (kept untyped to avoid importing the
 * generated program type here).
 */
export async function simulateConsumedUnits(builder: any): Promise<number | null> {
  // Best-effort: some RPC backends (e.g. Surfpool) don't expose simulateTransaction
  // the way Anchor expects and throw. Treat that as "unknown" rather than failing the
  // caller — the explicit setComputeUnitLimit still enforces the budget on the real tx.
  let sim;
  try {
    sim = await builder.simulate();
  } catch {
    return null;
  }
  // Anchor returns { raw: string[], events }; `raw` holds the program logs.
  return parseConsumedUnits(sim?.raw);
}

/**
 * Simulate a builder and return compute-budget pre-instructions sized to the
 * observed consumption (× `headroom`). Falls back to `fallbackUnits` when the
 * simulation log can't be parsed.
 */
export async function sizedComputeBudgetPreIxs(
  builder: any,
  opts: {
    headroom?: number;
    microLamports?: number;
    fallbackUnits?: number;
  } = {}
): Promise<TransactionInstruction[]> {
  const headroom = opts.headroom ?? DEFAULT_HEADROOM;
  const fallback = opts.fallbackUnits ?? 200_000;
  const consumed = (await simulateConsumedUnits(builder)) ?? fallback;
  return computeBudgetPreIxs(consumed * headroom, opts.microLamports);
}
