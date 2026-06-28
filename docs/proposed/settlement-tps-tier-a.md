# Settlement TPS — Tier A: unblock the `zone_market` write-lock

Status: **proposed** (design only — not implemented). Money-path change; implement with
validator integration tests + the off-chain settle-tx builder, not autonomously.

## Problem (verified, 2026-06-28)

`batch_settle_offchain_match` declares `zone_market` as `#[account(mut)]`
(`programs/trading/src/instructions/settle_offchain.rs:366`) and calls `load_mut()`
(`:726`). Solana write-locks a `mut` account for the whole transaction, so **every** batch
settle touching a zone serializes on that one PDA under Sealevel — even though the only
`zone_market` write is `committed_flow` (`:841`), and only on the **cross-zone** branch
(`:836-842`). Intra-zone batch settles (same-zone P2P energy, the common case) pay the
serialization for zero writes.

### Static contention map (per concurrent same-zone settle, different users)

| Account | Seed | Shared scope | Path |
|---|---|---|---|
| `zone_market` | `[zone_market, zone_id]` | all same-zone | **batch + single** |
| `fee/wheeling/loss_collector` | `[..collector, mint]` | all same-currency (GLOBAL) | **single only** (`:293/302/311`) |
| `fee/wheeling/loss_collector` | `[..collector, mint, shard_id]` | per shard | batch (`:394/403/412`) |
| `treasury_state` (opt) | singleton | global when THBG | both |
| nullifiers / escrows / `market_shard` / `zone_shard` | per user/order/payer-shard | distinct | both |

**Conclusion:**
- **Batch path:** collectors already sharded (§2c). The last same-zone serializer is
  `zone_market`. Tier A applies cleanly here.
- **Single `settle_offchain_match`:** collectors are still GLOBAL/unsharded → it serializes
  on the collectors regardless of zone. Tier A alone won't parallelize it; it needs collector
  sharding too, or treat it as the low-throughput path (batch is the throughput path).

The account-lock model proves the serialization deterministically (two txs writing the same
account cannot co-execute). A bench is needed only to size the *magnitude* of the win — see
"Measurement gap".

## Design (batch path, additive + backward-compatible)

Add a new instruction `batch_settle_offchain_match_intra` with a context identical to
`SettleOffchainMatchBatchContext` except:

- `zone_market` is `#[account()]` (read-only) instead of `mut` → no write-lock → same-zone
  intra settles on different `settle_shard_id`s run in parallel (their only other shared
  writables — collectors — are already sharded).
- Handler **rejects any cross-zone match**: `require!(m.seller_payload.zone_id == zone_market.zone_id && m.buyer_payload.zone_id == zone_market.zone_id, TradingError::...)`. Intra-zone trades consume no inter-zone transmission, so `committed_flow`/`capacity` are irrelevant — never written.

Cross-zone batches keep using the existing `mut` `batch_settle_offchain_match` (capacity ceiling
enforced exactly, serialized — acceptable: cross-zone is the minority and the ceiling is a hard
physical transmission limit that must stay globally consistent).

**Why a second instruction, not a new `ZoneCapacity` PDA + `Option` account:** avoids a
migration, keeps the existing path byte-for-byte unchanged, and makes the security property
trivial to audit (the read-only variant simply cannot touch capacity). Cost: the settle core is
shared between the two handlers — factor it into one inner fn taking the loaded accounts to avoid
duplicating money-path logic (do NOT copy-paste the ~180-line body).

### Security invariant
The read-only variant must reject cross-zone matches *before* any transfer, so a settler can
never bypass the capacity ceiling by routing a cross-zone trade through the unthrottled intra
instruction. This is the single most important review point.

## Off-chain dependency (blocker)
The settle-tx builder (Chain Bridge — not in this repo) constructs the account list and chooses
the instruction. It must route intra-zone batches to the new instruction and cross-zone to the
existing one. The on-chain change is inert until the builder is updated. **Not verifiable from the
anchor repo alone.**

## Measurement (bench-first) — DONE, contention confirmed
`tests/batch_settle_tps.ts` is now a true open-loop generator (`fireSettle`/`awaitConfirmed`/
worker-pool/goodput-retry) and emits a slot-level metric `BENCH_BATCH_SLOTTPS`
(`landed_per_slot`, `slot_tps`, `slot_span`). Validator run 2026-06-28, `SHARD_SPREAD=1`
(distinct market_shard/zone_shard per settle):

```
conc=1  landed_per_slot=0.65  slot_tps=1.62  slot_span=17
conc=4  landed_per_slot=0.65  slot_tps=1.62  slot_span=17   (IDENTICAL)
```

Throughput is **flat** as concurrency rises 1→4 — 4× concurrent settles land the same ~0.65/slot,
so they serialize on a shared-mut account. With shards spread, the only writables still shared are
`zone_market` and `treasury_state`. A parallel path would land ~4×/slot at conc=4. This empirically
confirms the static analysis: a per-settle shared-mut account is the throughput ceiling.

**Caveat:** the bench settles in THBG, so `treasury_state` is also in the shared-mut set — the run
cannot by itself separate `zone_market`'s contribution from `treasury_state`'s. Both are addressed
by sharding (`treasury_state` recording is sharded via `SettlementShard`/`record_settlement_sharded`
§2c; `zone_market` is this doc's Tier A). To attribute precisely, run once with treasury wiring
omitted (generic-currency settle) — then `zone_market` is the sole shared writable and the same flat
curve isolates it. (Validator auto-stops at 1800s TTL; the conc=8 datapoint was cut, but conc 1→4
flat is already conclusive that a serializer binds.)

## Test plan (litesvm, on-chain correctness)
- intra variant: a same-zone batch settles with `zone_market` passed **read-only** (assert it is
  not in the tx writable set) — proves the lock is gone.
- intra variant: a cross-zone match is **rejected** (capacity-bypass guard).
- existing `batch_settle_offchain_match`: unchanged (regression).
- validator: extend `escrow_settlement.ts` / `batch_settle_thbg.ts` to exercise the intra path.

## Out of scope (follow-ups)
- Single `settle_offchain_match` collector sharding (or deprecate in favor of batch).
- Tier B: shard the cross-zone capacity budget per shard (`capacity/N`) so cross-zone also
  parallelizes — semantics shift (per-shard budget, possible utilization loss); only if
  cross-zone volume justifies it.
