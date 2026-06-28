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

## Companion fix already landed: `treasury_state` dead write-lock (batch path)

The flat-curve run left two shared-mut accounts: `zone_market` AND `treasury_state`. Investigation
showed `treasury_state` was a **dead write-lock** on the batch path: `SettleOffchainMatchBatchContext`
declared it `#[account(mut)]`, but the batch records via `record_settlement_batch_sharded`, whose
treasury account is **read-only** (the accumulator lives on the per-shard `settlement_shard`; only the
recorder gate reads `treasury`). The trading handler only `.load()`s it. So `mut` write-locked the
treasury singleton on every THBG batch settle with no writer. **Fixed** → `treasury_state` is now
read-only in the batch context (the single `settle_offchain_match` path keeps `mut` — its
`record_settlement` CPI writes the singleton). litesvm 217 passing. This removes one of the two
empirical serializers; `zone_market` (below) is the remaining one — so a re-run should still be flat,
which now **isolates** `zone_market` (no treasury-less run needed). The on-chain re-run is pending a
fresh ledger (the in-place upgrade was blocked by an upgrade-authority mismatch on the persisted ledger).

### Post-fix bench (treasury_state read-only landed) — fix validated, zone_market isolated
Re-ran on a fresh ledger after the treasury_state fix (shard-spread):

```
            pre-fix (treasury_state mut)   post-fix (read-only)
conc=1      0.65/slot  slot_tps 1.62       0.61/slot  1.53
conc=4      0.65/slot  1.62  (FLAT)        0.79/slot  1.96  (+~30%, wall 8.8s->6.8s)
conc=8      (TTL-cut)                       0.61/slot  1.53
```

Pre-fix conc 1→4 was flat (fully serialized). Post-fix conc=4 unflattens → the treasury_state
write-lock WAS a real serializer (now removed). But throughput still doesn't scale to 4× and
conc=8 dips, so `zone_market` remains the binding serializer — Tier A is still required for the
rest. (Single noisy run; conc=8 non-monotonic — directional, repeat for rigor.) Fixture lesson:
the re-run works from a FRESH ledger (`rm -rf test-ledger`) via bootstrap.ts + init-treasury.ts —
no lighter fixture needed; prior failures were stale-ledger idempotency, not validator load.

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

## Off-chain dependency — LOCATED
The settle-tx builder is NOT in Chain Bridge. It is `InstructionBuilder` in
`gridtokenx-blockchain-core/src/rpc/instructions.rs` (the settle instruction is aliased `ln`).
The batch builder (~line 531; the per-pair `2*i` Ed25519 layout, "one batch settles into one
zone_market" at ~line 511) adds `AccountMeta::new(zone_market_pda, false)` — i.e. WRITABLE.
Tier A: when the batch is intra-zone (all matches' zone_id == the zone_market's zone — the
builder already requires single-zone), emit `AccountMeta::new_readonly(zone_market_pda, false)`
and target the new intra instruction's discriminator. Cross-zone keeps the writable meta + the
existing instruction. Anchor TS clients pick mutability from the IDL automatically, but this
Rust builder hard-codes it, so it MUST be edited for the win to materialize.

## On-chain implementation difficulty (why this is a dedicated, validator-backed task)
The `committed_flow` write is PER-MATCH, interleaved inside the settle loop (settle_offchain.rs
~836-842, cross-zone branch) — not a single post-loop step. So a shared core between the
existing mut-`zone_market` handler and a read-only intra handler is NOT a clean extract: either
(a) the core takes `Option<&mut ZoneMarket>` and the intra path passes `None` (rejecting
cross-zone up front), or (b) restructure the loop to accumulate the cross-zone flow delta and
apply one write after — (a) is less invasive. Anchor contexts can't be generic, so the two
instructions need two `#[derive(Accounts)]` structs (mut vs read-only zone_market) both calling
the shared core fn. Because this rewrites the fund-moving settle loop, it needs VALIDATOR
integration tests (escrow_settlement.ts / batch_settle_thbg.ts), not just litesvm — and the
local validator is unstable under the bootstrap fixture (see settlement-tps memory). Do it as a
focused task with a stable validator / CI, not as a tail-of-session change.

### RECOMMENDED strategy: ZoneCapacity PDA (avoids the loop extract)
After reading the full ~250-line batch handler, the two-instruction shared-core approach is the
WORSE option — extracting the fund loop (per-match committed_flow + treasury recording + CPIs) into
a free fn with ~15 params is error-prone and hard to verify byte-identical. Prefer instead:

- Move `committed_flow` OFF `zone_market` onto a dedicated `ZoneCapacity` PDA
  (`[b"zone_capacity", zone_market]`, fields: `zone_market: Pubkey`, `committed_flow: u64`).
  `capacity` STAYS on `zone_market` (read-only config).
- ONE batch instruction (no duplication, no core-extract): `zone_market` becomes read-only
  (capacity/zone_id reads); add `zone_capacity: Option<AccountLoader<ZoneCapacity>>` (`mut`).
- Per-match cross-zone branch writes `zone_capacity` instead of `zone_market`. SECURITY GUARD:
  a cross-zone match with `zone_capacity == None` must REJECT (else capacity bypass) — this is
  the one critical review point.
- Intra-zone batches omit `zone_capacity` → `zone_market` read-only → parallel. Cross-zone pass
  it (mut) → serialized on `ZoneCapacity` only (correct; hard physical ceiling, minority path).
- Migration: add an `init_zone_capacity` instruction; existing zones start `committed_flow` at 0
  (localnet has no real committed flow to carry). The `committed_flow` field on `zone_market`
  becomes reserved/dead (keep for layout, like the batch-builder fields).

This is one instruction, no fund-loop duplication, and the read-only `zone_market` change is the
whole win. Still needs validator regression (escrow_settlement.ts / batch_settle_thbg.ts) +
the blockchain-core builder edit (intra → read-only zone_market, pass/omit zone_capacity).

### IMPLEMENTATION CONSTRAINT (proven 2026-06-28, step-2 attempt — reverted)
Adding `zone_capacity` as a typed `Option<AccountLoader<ZoneCapacity>>` FIELD to
`SettleOffchainMatchContext` OVERFLOWS the BPF stack — runtime "Access violation in stack
frame" (the single settle context is already at the ceiling; see [[settle-context-stack-limit]]).
So `zone_capacity` MUST be passed via `remaining_accounts` with MANUAL validation (PDA derive +
owner + `zone_market` binding + manual `load_mut`/write of `committed_flow`), exactly like the
governance `poa_config` workaround already in the batch path. The batch context MAY have room for
a typed field (fewer named accounts) but for uniformity use remaining_accounts on both. This makes
step 2 meaningfully more involved than a typed Option field. Step 1 (ZoneCapacity PDA + init) is
landed on branch `feat/tier-a-zone-capacity` (PR #3) and is unaffected.

Also confirmed: the whole settle litesvm/validator suite (settle_offchain_guards, batch_settle_*,
escrow_settlement) must be rewired — intra-zone calls omit zone_capacity, cross-zone init + pass it.

### Concrete step list (two-instruction variant — fallback if ZoneCapacity rejected)
1. anchor: `fn settle_batch_core(..., zone_flow: Option<&mut ZoneMarket>)` extracting the loop;
   existing `batch_settle_offchain_match` passes `Some`, new `batch_settle_offchain_match_intra`
   passes `None` + `require!` all matches intra-zone (capacity-bypass guard — the key review point).
2. anchor: `SettleOffchainMatchBatchIntraContext` = batch context with `zone_market` read-only.
3. blockchain-core: `instructions.rs` batch builder — intra-zone → `new_readonly` zone_market +
   intra discriminator.
4. test: litesvm (zone_market not writable on intra; cross-zone rejected) + validator regression.

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
