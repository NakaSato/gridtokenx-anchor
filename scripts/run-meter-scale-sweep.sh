#!/usr/bin/env bash
# run-meter-scale-sweep.sh — meter-count scaling sweep for on-chain telemetry.
#
# For each meter count (default: 10000 50000 100000 150000 200000) runs
# scripts/bench-meter-throughput.ts (oracle submit_meter_reading benchmark:
# TPS, send→confirm latency, CU per tx, loss) with a unique PDA prefix, then
# combines the per-scale JSON results into one summary via
# scripts/summarize-meter-scale.ts.
#
# Requires: local validator running with the oracle program deployed and
# initialized (scripts/init-oracle.ts) — the provider wallet must be the
# oracle gateway (authority == oracle_data.chain_bridge / api_gateway).
# Fresh ledger recommended: PDAs persist, so re-running a scale with the same
# prefix turns epoch-1 "init" into a steady write and skews init-CU numbers
# (the unique RUN_TAG below avoids this across sweep invocations).
#
# Funding: each meter PDA is 102 bytes → ~0.0016 SOL rent. 200k meters ≈ 320
# SOL; the whole default sweep creates 610k PDAs ≈ ~980 SOL + fees. The script
# airdrops from the local faucet before each scale as needed.
#
# Env:
#   SCALES        space-separated meter counts   (default "10000 50000 100000 150000 200000")
#   EPOCHS        epochs per scale               (default 2: epoch1 = PDA init, epoch2 = steady)
#   RUN_TAG       prefix disambiguator           (default HHMMSS of start)
#   MAX_INFLIGHT  in-flight tx window            (default 3000)
#   OUTDIR        results dir                    (default test-results)
#   ANCHOR_PROVIDER_URL / ANCHOR_WALLET          (default local validator / ~/.config/solana/id.json)
#
# Usage:
#   bash scripts/run-meter-scale-sweep.sh
#   SCALES="10000 50000" EPOCHS=2 bash scripts/run-meter-scale-sweep.sh

set -euo pipefail
cd "$(dirname "$0")/.."

export ANCHOR_PROVIDER_URL="${ANCHOR_PROVIDER_URL:-http://127.0.0.1:8899}"
export ANCHOR_WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/id.json}"
SCALES="${SCALES:-10000 50000 100000 150000 200000}"
EPOCHS="${EPOCHS:-2}"
RUN_TAG="${RUN_TAG:-$(date +%H%M%S)}"
MAX_INFLIGHT="${MAX_INFLIGHT:-3000}"
OUTDIR="${OUTDIR:-test-results}"

WALLET_PUBKEY="$(solana-keygen pubkey "${ANCHOR_WALLET}")"

echo "═══════════════════════════════════════════════════════════════"
echo "  Meter-Count Scaling Sweep"
echo "  validator: ${ANCHOR_PROVIDER_URL}"
echo "  wallet:    ${WALLET_PUBKEY}"
echo "  scales:    ${SCALES}   epochs: ${EPOCHS}   tag: ${RUN_TAG}"
echo "═══════════════════════════════════════════════════════════════"

# ── Preflight: validator reachable ──────────────────────────────────────────
if ! solana cluster-version -u "${ANCHOR_PROVIDER_URL}" >/dev/null 2>&1; then
  echo "✗ validator not reachable at ${ANCHOR_PROVIDER_URL} (just solana-up, then deploy + scripts/init-oracle.ts)"
  exit 1
fi

# Ensure the wallet holds enough SOL for the next scale's rent + fees.
# rent(MeterState 102B) ≈ 0.0016 SOL/PDA; pad ×1.2 and add 2 SOL for fees.
fund_for() {
  local meters="$1"
  local need
  need=$(( meters * 2 / 1000 + 2 ))   # ≈ meters × 0.002 SOL
  local have
  have="$(solana balance "${WALLET_PUBKEY}" -u "${ANCHOR_PROVIDER_URL}" | awk '{printf "%d", $1}')"
  while [[ "${have}" -lt "${need}" ]]; do
    echo "   … balance ${have} SOL < ${need} SOL needed — airdropping 500"
    solana airdrop 500 "${WALLET_PUBKEY}" -u "${ANCHOR_PROVIDER_URL}" >/dev/null
    have="$(solana balance "${WALLET_PUBKEY}" -u "${ANCHOR_PROVIDER_URL}" | awk '{printf "%d", $1}')"
  done
  echo "   ✓ funded: ${have} SOL (need ≥ ${need})"
}

declare -a RESULT_JSONS
declare -a SUMMARY
fails=0

for N in ${SCALES}; do
  echo ""
  echo "── scale: ${N} meters ──────────────────────────────────────────"
  fund_for "${N}"

  # Unique per scale AND per sweep run so epoch 1 is a true PDA init.
  # meter_id = "K<N/1000>kT<tag>_<6-digit idx>" — stays ≤ 32 bytes.
  prefix="K$(( N / 1000 ))kT${RUN_TAG}_"

  before="$(ls "${OUTDIR}"/meter-throughput-"${N}"m-*.json 2>/dev/null | sort | tail -1 || true)"
  if METERS="${N}" EPOCHS="${EPOCHS}" PREFIX="${prefix}" MAX_INFLIGHT="${MAX_INFLIGHT}" \
     npx tsx scripts/bench-meter-throughput.ts; then
    latest="$(ls "${OUTDIR}"/meter-throughput-"${N}"m-*.json 2>/dev/null | sort | tail -1)"
    if [[ -n "${latest}" && "${latest}" != "${before}" ]]; then
      RESULT_JSONS+=("${latest}")
      SUMMARY+=("✓ ${N} meters → ${latest}")
    else
      fails=$(( fails + 1 ))
      SUMMARY+=("✗ ${N} meters (no result JSON written)")
    fi
  else
    fails=$(( fails + 1 ))
    SUMMARY+=("✗ ${N} meters (bench failed)")
  fi
done

echo ""
echo "═══════════════════════════════════════════════════════════════"
for s in "${SUMMARY[@]}"; do echo "  ${s}"; done
echo "═══════════════════════════════════════════════════════════════"

if [[ ${#RESULT_JSONS[@]} -gt 0 ]]; then
  OUTDIR="${OUTDIR}" npx tsx scripts/summarize-meter-scale.ts "${RESULT_JSONS[@]}"
fi

[[ ${fails} -eq 0 ]]
