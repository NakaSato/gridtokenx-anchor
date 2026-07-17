#!/usr/bin/env bash
# run-price-models-onchain.sh — §4.7 price-model sweep against a live validator.
#
# For each dataset case: run scripts/price-models-onchain.ts (drives clear_auction
# + create/match orders on-chain) then scripts/verify-price-models-onchain.ts
# (re-reads chain state, 7 checks). Tallies cases and per-check results.
#
# Assumes a running validator with the 5 programs deployed and bootstrap.ts run
# (market + governance_config initialized). Reuses whatever ANCHOR_PROVIDER_URL /
# ANCHOR_WALLET point at; defaults to local.
#
# Env:
#   CASES  space-separated dataset dirs  (default: all test-results/datasets/scale-*-cap5)
#   ZONE_BASE  first zone id (default 42000; each case gets ZONE_BASE+i)
#   OUTDIR  results dir (default test-results)
#
# Usage: bash scripts/run-price-models-onchain.sh
#        CASES="test-results/datasets/scale-80m-12p-s42-7d-cap5" bash scripts/run-price-models-onchain.sh

set -euo pipefail
cd "$(dirname "$0")/.."

export ANCHOR_PROVIDER_URL="${ANCHOR_PROVIDER_URL:-http://127.0.0.1:8899}"
export ANCHOR_WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/id.json}"
ZONE_BASE="${ZONE_BASE:-42000}"
OUTDIR="${OUTDIR:-test-results}"

if [[ -z "${CASES:-}" ]]; then
  CASES="$(ls -d test-results/datasets/scale-*-cap5 2>/dev/null | sort)"
fi
[[ -z "${CASES}" ]] && { echo "no dataset cases found (test-results/datasets/scale-*-cap5)"; exit 1; }

echo "═══════════════════════════════════════════════════════════════"
echo "  Price-Model On-Chain Sweep (§4.7)"
echo "  validator: ${ANCHOR_PROVIDER_URL}"
echo "═══════════════════════════════════════════════════════════════"

i=0
cases_ok=0
cases_fail=0
checks_ok=0
declare -a SUMMARY

for dir in ${CASES}; do
  fleet="$(basename "${dir}")"
  zone=$(( ZONE_BASE + i ))
  out="${OUTDIR}/price-models-${fleet}.json"
  echo ""
  echo "── case ${i}: ${fleet}  (zone ${zone}) ─────────────────────────────"

  if OUT="${out}" DATA_DIR="${dir}" ZONE_ID="${zone}" npx tsx scripts/price-models-onchain.ts; then
    if RESULTS="${out}" npx tsx scripts/verify-price-models-onchain.ts; then
      cases_ok=$(( cases_ok + 1 ))
      checks_ok=$(( checks_ok + 7 ))
      SUMMARY+=("✓ ${fleet}")
    else
      cases_fail=$(( cases_fail + 1 ))
      SUMMARY+=("✗ ${fleet} (verify failed)")
    fi
  else
    cases_fail=$(( cases_fail + 1 ))
    SUMMARY+=("✗ ${fleet} (run failed)")
  fi
  i=$(( i + 1 ))
done

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Sweep summary: ${cases_ok}/$(( cases_ok + cases_fail )) cases passed, ${checks_ok} checks green"
for s in "${SUMMARY[@]}"; do echo "    ${s}"; done
echo "═══════════════════════════════════════════════════════════════"

[[ ${cases_fail} -eq 0 ]]
