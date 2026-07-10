#!/usr/bin/env python3
"""
merge_shards.py — merge fleet-sharded export_bench_dataset.py outputs into one
dataset, byte-value-identical (per (meter, tick)) to an unsharded run.

Sharding is only valid at --grid-solve-stride 0 (meters independent, no grid
coupling), so a shard's readings for its meter range equal the full run's for
those meters. This merges N disjoint shard dirs covering [0, meters) into a
single dataset dir with the same schema (readings.jsonl, daily.json,
meters.json, meta.json).

Usage:
  python scripts/merge_shards.py --out FINAL_DIR SHARD_DIR1 SHARD_DIR2 ...

Merge rules:
  - readings.jsonl : concatenated (line order is irrelevant — the bench indexes
                     by {m,t}); every (m,t) appears exactly once.
  - daily.json     : element-wise summed (each shard fills only its meter rows;
                     the rest are zero, so the sum reconstructs the full grid).
  - energy_kwh     : summed across shards.
  - meters.json    : identical across shards (full-fleet metadata) — copied.
  - meta.json      : global fields carried through; totals recomputed; is_shard
                     cleared; readings_sha256 recomputed over the merged stream.

Fails hard if shards disagree on (seed, days, start_ts, interval, cap, stride)
or do not disjointly cover [0, meters).
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path


def die(msg: str) -> None:
    print(f"merge_shards: ✗ {msg}", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="output (merged) dataset dir")
    ap.add_argument("shards", nargs="+", help="shard dataset dirs to merge")
    args = ap.parse_args()

    shard_dirs = [Path(s) for s in args.shards]
    metas = []
    for d in shard_dirs:
        mp = d / "meta.json"
        if not mp.is_file():
            die(f"missing {mp}")
        metas.append(json.loads(mp.read_text()))

    # ── Consistency: every shard must agree on the invariant fleet parameters ──
    keys = ["meters", "prosumers", "days", "start_ts", "end_ts", "step_sec",
            "interval", "random_seed", "start_date", "export_cap_kwh",
            "grid_solve_stride"]
    base = metas[0]
    for m, d in zip(metas[1:], shard_dirs[1:]):
        for k in keys:
            if m.get(k) != base.get(k):
                die(f"shard {d} disagrees on '{k}': {m.get(k)} != {base.get(k)}")
    if base.get("grid_solve_stride") != 0:
        die("shards must be generated with --grid-solve-stride 0")

    N = base["meters"]
    days = base["days"]

    # ── Coverage: shards must disjointly tile [0, N) ──────────────────────────
    covered = [0] * N
    for m, d in zip(metas, shard_dirs):
        s, c = m["shard_start"], m["shard_count"]
        for gi in range(s, s + c):
            covered[gi] += 1
    gaps = [i for i, v in enumerate(covered) if v == 0]
    dups = [i for i, v in enumerate(covered) if v > 1]
    if gaps:
        die(f"{len(gaps)} meters uncovered by any shard (first: {gaps[:5]})")
    if dups:
        die(f"{len(dups)} meters covered by >1 shard (first: {dups[:5]})")

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    # ── readings.jsonl: concat (order-agnostic; bench indexes by {m,t}) ────────
    readings_path = out / "readings.jsonl"
    total_readings = 0
    with readings_path.open("wb") as w:
        for d in shard_dirs:
            with (d / "readings.jsonl").open("rb") as r:
                for line in r:
                    if line.strip():
                        w.write(line if line.endswith(b"\n") else line + b"\n")
                        total_readings += 1

    # ── daily.json: element-wise sum ({g,c,s} per [day][meter]) ───────────────
    merged_daily = [[{"g": 0.0, "c": 0.0, "s": 0.0} for _ in range(N)] for _ in range(days)]
    for d in shard_dirs:
        dj = json.loads((d / "daily.json").read_text())
        for day in range(days):
            for i in range(N):
                cell = dj[day][i]
                merged_daily[day][i]["g"] += cell["g"]
                merged_daily[day][i]["c"] += cell["c"]
                merged_daily[day][i]["s"] += cell["s"]
    for day in range(days):
        for i in range(N):
            for k in ("g", "c", "s"):
                merged_daily[day][i][k] = round(merged_daily[day][i][k], 6)
    (out / "daily.json").write_text(json.dumps(merged_daily))

    # ── meters.json: identical across shards → copy one ───────────────────────
    (out / "meters.json").write_text((shard_dirs[0] / "meters.json").read_text())

    # ── Recompute totals from merged daily ────────────────────────────────────
    gen = sum(merged_daily[d][i]["g"] for d in range(days) for i in range(N))
    con = sum(merged_daily[d][i]["c"] for d in range(days) for i in range(N))
    sur = sum(merged_daily[d][i]["s"] for d in range(days) for i in range(N))
    prosumer_idx = base.get("prosumer_idx", [])
    gt10 = sum(1 for d in range(days) for i in prosumer_idx if merged_daily[d][i]["s"] > 10.0)
    curtailed = round(sum(m.get("export_curtailed_kwh", 0.0) for m in metas), 6)

    meta = dict(base)  # carry global fields
    meta.update({
        "readings": total_readings,
        "energy_kwh": {"generated": round(gen, 6), "consumed": round(con, 6), "surplus": round(sur, 6)},
        "prosumer_days_surplus_gt_10kwh": gt10,
        "export_curtailed_kwh": curtailed,
        "shard_start": 0,
        "shard_count": N,
        "is_shard": False,
        "merged_from_shards": [f"{m['shard_start']}:{m['shard_count']}" for m in metas],
        "readings_sha256": hashlib.sha256(readings_path.read_bytes()).hexdigest(),
    })
    (out / "meta.json").write_text(json.dumps(meta, indent=2))

    # ── Final self-check: full reading count ──────────────────────────────────
    ticks_per_day = 86400 // base["interval"]
    expected = N * days * ticks_per_day
    if total_readings != expected:
        die(f"merged readings {total_readings} != expected {expected}")

    print(f"merged {len(shard_dirs)} shards → {out}")
    print(f"  meters={N} days={days} readings={total_readings}")
    print(f"  energy kWh: gen={gen:.2f} cons={con:.2f} surplus={sur:.2f}  curtailed={curtailed:.2f}")
    print(f"  prosumer-days surplus>10kWh: {gt10}")


if __name__ == "__main__":
    main()
