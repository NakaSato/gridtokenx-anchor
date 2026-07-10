#!/usr/bin/env bash
# =============================================================================
# gen-datasets.sh — generate seeded community datasets for the scale sweep,
# ALL CASES IN PARALLEL (one export_bench_dataset.py process per case).
#
# Physics (pandapower power-flow per tick) dominates gen time, so the two
# speed levers are:
#   1. run every case concurrently  (this script; capped at JOBS)
#   2. coarsen INTERVAL             (fewer ticks → fewer solves → ~linear speedup)
# There is no physics-skip flag in the exporter — coarser INTERVAL is the only
# way to cut per-case cost without editing the simulator.
#
# Config (env, with defaults):
#   CASES     "80:12 160:24 380:57 760:114"  space-separated M:P (meters:prosumers)
#   DAYS      30      days per case
#   SEED      42      dataset RNG seed
#   INTERVAL  900     tick seconds (1800 ≈ 2× faster, 3600 ≈ 4× faster, coarser data)
#   MAX_EXPORT 0       per-prosumer daily grid feed-in cap (kWh); 0 = unlimited.
#                      >0 curtails prosumer generation so each prosumer feeds the
#                      grid ≤ MAX_EXPORT kWh/day; dir gets a -cap<N> suffix.
#   SOLVE_STRIDE 1     pandapower solve cadence: 1=every tick, N=every Nth, 0=never
#                      (nominal 1.0 pu, fastest). readings g/c barely change.
#   SHARDS     1       split each fleet into N contiguous shards, run in parallel,
#                      then merge (scripts/merge_shards.py). Forces SOLVE_STRIDE=0
#                      and sequential cases. Merged output differs from unsharded
#                      by ~2% solar-noise; consumption + export cap are exact.
#   JOBS      0       max concurrent cases (0 = one per case, all at once)
#   SIM_DIR   $REPO/../gridtokenx-smartmeter-simulator/backend
#   OUT       $REPO/test-results/datasets
#   FORCE     0       1 = re-export even if meta.json already exists
#
# Output per case: $OUT/scale-<M>m-<P>p-s<SEED>-<DAYS>d[-cap<N>]/{meta,meters,daily}.json + readings.jsonl
# Progress log:    $OUT/../dataset-gen.log   (tail -f for DONE/FAIL lines)
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO"

CASES="${CASES:-80:12 160:24 380:57 760:114}"
DAYS="${DAYS:-30}"
SEED="${SEED:-42}"
INTERVAL="${INTERVAL:-900}"
MAX_EXPORT="${MAX_EXPORT:-0}"   # per-prosumer daily grid feed-in cap (kWh); 0 = unlimited
SOLVE_STRIDE="${SOLVE_STRIDE:-1}"  # pandapower solve cadence: 1=every tick, N=every Nth, 0=never (fastest)
SHARDS="${SHARDS:-1}"           # split each fleet into N parallel shards + merge (needs SOLVE_STRIDE=0)
JOBS="${JOBS:-0}"
SIM_DIR="${SIM_DIR:-$REPO/../gridtokenx-smartmeter-simulator/backend}"
OUT="${OUT:-$REPO/test-results/datasets}"
FORCE="${FORCE:-0}"
LOG="$REPO/test-results/dataset-gen.log"

log()  { echo -e "\033[0;36m[gen-datasets]\033[0m $*"; }
die()  { echo -e "\033[0;31m[gen-datasets] ✗\033[0m $*" >&2; exit 1; }

[[ -d "$SIM_DIR" ]] || die "simulator dir not found: $SIM_DIR (set SIM_DIR)"
[[ -f "$SIM_DIR/experiments/export_bench_dataset.py" ]] || die "exporter not found under $SIM_DIR/experiments"
mkdir -p "$OUT"
: > "$LOG"

# Sharding requires stride0 (independent meters) and runs cases sequentially so
# each case's shard workers get the whole host (they already fan out across cores).
if [[ "$SHARDS" -gt 1 ]]; then
  [[ -f "$SCRIPT_DIR/merge_shards.py" ]] || die "merge_shards.py not found next to this script"
  if [[ "$SOLVE_STRIDE" != "0" ]]; then
    log "SHARDS>1 forces SOLVE_STRIDE=0 (was $SOLVE_STRIDE) — sharding needs independent meters"
    SOLVE_STRIDE=0
  fi
  JOBS=1  # cases sequential; each fans out $SHARDS workers internally
fi

# Pin each proc to ONE thread on EVERY parallel runtime. numpy/pandapower AND
# pandapower's numba-jitted power-flow (pp.runpp(numba=True)) each default to
# threads=cores, so parallel procs oversubscribe hard (measured load avg ~49 on
# 8 cores with only 4 procs → thrash). NUMBA_NUM_THREADS=1 was the missing pin —
# the runpp solve is the per-tick hot path. One thread per proc → true proc-level
# parallelism, no contention. Runs one export worker (whole fleet OR one shard).
export_worker() {  # meters count, prosumers, shard-start, shard-count(-1=full), out, plog
  local M="$1" P="$2" SS="$3" SC="$4" OUTD="$5" PLOG="$6"
  ( cd "$SIM_DIR" && \
      PYTHONUNBUFFERED=1 \
      OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 \
      VECLIB_MAXIMUM_THREADS=1 NUMEXPR_NUM_THREADS=1 NUMBA_NUM_THREADS=1 \
      uv run python experiments/export_bench_dataset.py \
      --meters "$M" --prosumers "$P" --days "$DAYS" --seed "$SEED" \
      --interval "$INTERVAL" --max-daily-export "$MAX_EXPORT" \
      --grid-solve-stride "$SOLVE_STRIDE" \
      --shard-start "$SS" --shard-count "$SC" \
      --out "$OUTD" >"$PLOG" 2>&1 )
}

# ── One case → whole-fleet export, OR SHARDS-way fleet split + merge ───────────
# Sharding (SHARDS>1) splits the fleet into contiguous global index ranges, runs
# each range as its own worker (parallel across cores), then merges. Only valid
# at SOLVE_STRIDE=0 (independent meters). Merged output differs from an unsharded
# run by ~2% solar-noise (a shared-module-rng leak in the sim's solar model);
# consumption + the export cap are exact. See scripts/merge_shards.py.
gen_one() {
  local M="$1" P="$2"
  local CAPTAG=""
  if [[ "$MAX_EXPORT" != "0" && "$MAX_EXPORT" != "0.0" ]]; then
    CAPTAG="-cap${MAX_EXPORT}"
  fi
  local D="$OUT/scale-${M}m-${P}p-s${SEED}-${DAYS}d${CAPTAG}"
  if [[ "$FORCE" != "1" && -f "$D/meta.json" ]]; then
    echo "$(date +%H:%M:%S) SKIP ${M}m/${P}p (exists)" >> "$LOG"
    return 0
  fi
  rm -rf "$D"
  local PLOG="$OUT/../dataset-gen-${M}m.log"

  if [[ "$SHARDS" -le 1 ]]; then
    if export_worker "$M" "$P" 0 -1 "$D" "$PLOG"; then
      echo "$(date +%H:%M:%S) DONE ${M}m/${P}p ($(wc -l < "$D/readings.jsonl") readings)" >> "$LOG"
    else
      echo "$(date +%H:%M:%S) FAIL ${M}m/${P}p" >> "$LOG"
    fi
    return 0
  fi

  # ── Sharded: split M meters into SHARDS contiguous ranges, run in parallel ──
  local base=$(( M / SHARDS )) rem=$(( M % SHARDS )) start=0 ok=1
  local -a shard_dirs=() pids=()
  local s cnt SD
  for (( s = 0; s < SHARDS; s++ )); do
    cnt=$base; (( s < rem )) && cnt=$(( base + 1 ))
    (( cnt == 0 )) && continue
    SD="$D.shard${s}"; rm -rf "$SD"
    shard_dirs+=("$SD")
    export_worker "$M" "$P" "$start" "$cnt" "$SD" "${PLOG}.shard${s}" &
    pids+=($!)
    start=$(( start + cnt ))
  done
  for pid in "${pids[@]}"; do wait "$pid" || ok=0; done
  if (( ok )) && python3 "$SCRIPT_DIR/merge_shards.py" --out "$D" "${shard_dirs[@]}" >"$PLOG" 2>&1; then
    rm -rf "${shard_dirs[@]}"
    echo "$(date +%H:%M:%S) DONE ${M}m/${P}p sharded×${SHARDS} ($(wc -l < "$D/readings.jsonl") readings)" >> "$LOG"
  else
    echo "$(date +%H:%M:%S) FAIL ${M}m/${P}p (shard ok=$ok / merge)" >> "$LOG"
  fi
}

# ── Fan out (respect JOBS cap if set) ─────────────────────────────────────────
log "cases=[$CASES] days=$DAYS interval=$INTERVAL seed=$SEED max_export=$MAX_EXPORT stride=$SOLVE_STRIDE shards=$SHARDS jobs=${JOBS:-all}"
log "progress: tail -f $LOG"
running=0
for CASE in $CASES; do
  M="${CASE%%:*}"; P="${CASE##*:}"
  gen_one "$M" "$P" &
  running=$((running + 1))
  if [[ "$JOBS" -gt 0 && "$running" -ge "$JOBS" ]]; then
    wait -n 2>/dev/null || wait   # free a slot (bash 4.3+ wait -n; fallback: wait all)
    running=$((running - 1))
  fi
done
wait
echo "$(date +%H:%M:%S) ALL DATASETS DONE" >> "$LOG"
log "complete — see $LOG"
cat "$LOG"
