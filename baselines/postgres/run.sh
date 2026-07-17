#!/usr/bin/env bash
# run.sh — centralized-Postgres baseline sweep (blockchain-tax reference).
#
# Runs pgbench against the `baseline` schema for the two workloads that mirror the
# on-chain hot paths — order entry (INSERT) and atomic off-chain-match settlement —
# at a concurrency sweep, and prints TPS + latency per level. Compare against the
# on-chain λ-ramp (order entry ~1600 TPS) and settle sweep (~1 TPS).
#
# Requires the gridtokenx-postgres container running (just db-up / orb-up).
#
# Env: PG_CONTAINER (default gridtokenx-postgres)  NACC (accounts, default 1000)
#      CONC (space list, default "1 4 8 16 32")   DUR (sec/level, default 8)
# Usage: bash baselines/postgres/run.sh

set -euo pipefail
cd "$(dirname "$0")"

PG_CONTAINER="${PG_CONTAINER:-gridtokenx-postgres}"
NACC="${NACC:-1000}"
CONC="${CONC:-1 4 8 16 32}"
DUR="${DUR:-8}"
DB=gridtokenx
USER=gridtokenx_user
export_pw='PGPASSWORD=gridtokenx_password'

dexec() { docker exec -e PGPASSWORD=gridtokenx_password "$PG_CONTAINER" "$@"; }

echo "═══════════════════════════════════════════════════════════════"
echo "  Centralized-Postgres Baseline (pgbench)  accounts=${NACC}  ${DUR}s/level"
echo "  container=${PG_CONTAINER}  db=${DB}"
echo "═══════════════════════════════════════════════════════════════"

# Ship scripts + (re)build schema.
docker exec "$PG_CONTAINER" mkdir -p /tmp/pgbase
for f in schema.sql order_entry.sql settle_match.sql; do
  docker cp "$f" "${PG_CONTAINER}:/tmp/pgbase/$f"
done
echo "── building schema (${NACC} accounts) ──"
dexec psql -U "$USER" -d "$DB" -v naccounts="$NACC" -q -f /tmp/pgbase/schema.sql
echo "  schema built"

tps_of() { grep -E '^tps = ' | head -1 | sed -E 's/tps = ([0-9.]+).*/\1/'; }
lat_of() { grep -E '^latency average = ' | head -1 | sed -E 's/latency average = ([0-9.]+).*/\1/'; }

run_workload() {
  local name="$1" script="$2"
  echo ""
  echo "── ${name} ──"
  printf "  %-6s %-14s %-16s\n" "conc" "tps" "lat_avg_ms"
  for c in $CONC; do
    out="$(dexec pgbench -n -c "$c" -j "$c" -T "$DUR" -D naccounts="$NACC" \
             -f "/tmp/pgbase/${script}" -U "$USER" "$DB" 2>&1 || true)"
    tps="$(echo "$out" | tps_of)"
    lat="$(echo "$out" | lat_of)"
    printf "  %-6s %-14s %-16s\n" "$c" "${tps:-ERR}" "${lat:-?}"
  done
}

run_workload "order-entry (INSERT)"          order_entry.sql
run_workload "settle-match (atomic txn)"     settle_match.sql

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Compare: on-chain order-entry ~1600 TPS · on-chain settle ~1 TPS"
echo "═══════════════════════════════════════════════════════════════"
