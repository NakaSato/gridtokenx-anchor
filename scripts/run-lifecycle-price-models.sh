#!/usr/bin/env bash
# run-lifecycle-price-models.sh — full token-lifecycle benchmark under each price
# model (uniform / cda / buyback), one fresh validator + deploy + init per model.
#
# Each run replays the dataset's telemetry into the oracle, then drives the full
# lifecycle per prosumer-day: registry sync + settle_and_mint (GRID, Token-2022)
# -> escrow deposit -> Ed25519-signed settle_offchain_match at the model's price
# -> buyer withdraw + burn (buyback model: seller retires directly, no P2P leg).
# A fresh ledger per model is mandatory: the oracle's strictly-increasing
# per-meter timestamp guard and the registry's mint-conservation bound make a
# same-dataset replay non-repeatable on a persistent ledger.
#
# Env overrides:
#   DATASET  dataset dir   (default test-results/datasets/scale-80m-12p-s42-7d-cap5)
#   MODELS   space list    (default "uniform cda buyback")
#
# Usage: bash scripts/run-lifecycle-price-models.sh

set -u
cd "$(dirname "$0")/.."

DATASET=${DATASET:-test-results/datasets/scale-80m-12p-s42-7d-cap5}
MODELS=${MODELS:-uniform cda buyback}
LEDGER=/tmp/gtx-price-lifecycle-ledger
RPC=http://127.0.0.1:8899
export ANCHOR_PROVIDER_URL=$RPC
export ANCHOR_WALLET=$HOME/.config/solana/id.json

PROGRAMS="trading oracle governance energy_token registry treasury"
INITS="bootstrap init-registry init-shards init-oracle"

wait_rpc() {
  for _ in $(seq 1 60); do
    if solana cluster-version -u $RPC >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

for model in $MODELS; do
  echo "════════════════════════════════════════════════════════════"
  echo "MODEL: $model  ($(date +%H:%M:%S))"
  echo "════════════════════════════════════════════════════════════"

  pkill -f solana-test-validator 2>/dev/null; sleep 3
  ulimit -n 65536
  rm -rf "$LEDGER"
  solana-test-validator --reset --quiet --ledger "$LEDGER" >/dev/null 2>&1 &
  VAL_PID=$!
  if ! wait_rpc; then echo "validator failed to come up"; exit 1; fi
  sleep 2
  # validator can die on first boot (macOS) — verify twice
  if ! wait_rpc; then echo "validator died after boot"; exit 1; fi

  solana airdrop 1000 -u $RPC "$(solana address -k "$ANCHOR_WALLET")" >/dev/null

  for p in $PROGRAMS; do
    echo "  deploying $p..."
    solana program deploy -u $RPC --program-id "target/deploy/${p}-keypair.json" \
      "target/deploy/${p}.so" >/dev/null || { echo "deploy $p FAILED"; exit 1; }
  done

  for s in $INITS; do
    echo "  init: $s"
    npx tsx "scripts/$s.ts" 2>&1 | rg -i "initialized|completed|already|error|fail" | head -8
  done

  echo "  running lifecycle ($model, $DATASET)..."
  PRICE_MODEL=$model DATA_DIR=$DATASET npx tsx scripts/bench-community-month.ts \
    2>&1 | tee "/tmp/lifecycle-$model.log" | rg "PHASE|SUMMARY|Saved|prosumer 12|Error|error" | head -30
  echo "  model $model done ($(date +%H:%M:%S))"
done

pkill -f solana-test-validator 2>/dev/null
echo "ALL MODELS DONE. Artifacts: test-results/community-month-*-{uniform,cda,buyback}-*.json"
