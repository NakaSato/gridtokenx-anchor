# GridTokenX Anchor — On-Chain Benchmark Results

Academic-grade benchmark report for the Solana/Anchor programs in this repo.
Three standard OLTP workloads ported to the account model: **BlockBench**
(SIGMOD 2017 micro-benchmarks + YCSB), **SmallBank**, and **TPC-C**.

> Raw machine-readable artifacts (JSON + CSV, one file per run, with full
> reproducibility metadata) live in [`test-results/`](test-results/). The
> tables below are transcribed from the `n=150` scaled runs and the TPC-C
> concurrency sweep.

---

## Environment & Reproducibility

| Field | Value |
|-------|-------|
| Git commit | `58cfc79` (clean) |
| Solana/agave cluster | 3.1.10 |
| Anchor | `anchor-lang` 1.0.x / `anchor-cli` 1.0.0 |
| Node | v24.16.0 |
| OS / arch | Darwin 25.5.0 / arm64 |
| CPU | Apple M2, 8 cores |
| Validator | local `solana-test-validator` (single node, PoA-style permissioned) |
| Run date | 2026-06-07 |

**Statistical method.** Each operation runs `WARMUP` discarded iterations
followed by `ITERS` measured iterations. Latency is wall-clock
(`performance.now()`, client→confirmed). Reported: sample mean, sample
standard deviation (Bessel `n−1`), percentiles (NumPy type-7 linear
interpolation), and 95% confidence interval of the mean
(`ci95 = 1.96·σ/√n`, normal approx). Compute units captured post-hoc from
`getTransaction(sig).meta.computeUnitsConsumed`. Every JSON artifact embeds
git commit/dirty flag, cluster version, and host metadata.

**Reproduce:**

```bash
# validator must be running with both bench programs deployed
BENCH_ITERS=150 BENCH_WARMUP=10 npm run test:blockbench
BENCH_ITERS=150 BENCH_WARMUP=10 npm run test:smallbank
TPC_TX_COUNT=500 TPC_CONCURRENCY=20 npm run test:tpc-stress
```

> **Caveat.** Latency is dominated by single-node block time (~400–600 ms
> confirmation) and the sequential client submit loop, **not** program
> execution. The *compute-unit* columns are the load-independent, machine-free
> measure of on-chain cost and are the figures to cite for program efficiency.

---

## 1. BlockBench OLTP (n = 150, sequential)

| Operation | n | mean ms | stddev | p50 | p95 | p99 | ci95 | TPS | CU/tx | fail |
|-----------|---|---------|--------|-----|-----|-----|------|-----|-------|------|
| do_nothing | 150 | 719.95 | 159.49 | 671.15 | 991.46 | 1455 | ±25.52 | 1.39 | 648 | 0 |
| cpu_heavy_sort | 150 | 590.83 | 119.18 | 544.27 | 811.55 | 1025 | ±19.07 | 1.69 | 9 645 | 0 |
| ycsb_insert | 130 | 654.08 | 118.56 | 639.21 | 863.56 | 1051 | ±20.38 | 1.53 | 12 904 | 20¹ |
| ycsb_read | 150 | 4.29 | 3.92 | 3.46 | 8.67 | 16.85 | ±0.628 | 233.18 | n/a² | 0 |

¹ `ycsb_insert` records to a unique PDA per key; 20 duplicate-key collisions
on the live ledger across the run are counted as `fail`, leaving n=130 valid
samples. Not program errors.
² `ycsb_read` is an RPC account fetch (no consensus round-trip) → ~233 TPS,
two orders of magnitude faster than write paths, and consumes no on-chain CU.

**Reading:** `do_nothing` (648 CU) is the Anchor dispatch + signature-verify
floor. `cpu_heavy_sort` (64-element sort) is ~9.6k CU. A single keyed insert
of a value record is ~12.9k CU — well inside the 200k default CU budget.

---

## 2. SmallBank OLTP (n = 150, sequential)

| Transaction | n | mean ms | stddev | p50 | p95 | p99 | ci95 | TPS | CU/tx | fail |
|-------------|---|---------|--------|-----|-----|-----|------|-----|-------|------|
| TransactSavings | 150 | 599.09 | 90.79 | 572.13 | 767.99 | 941.92 | ±14.53 | 1.67 | 3 355 | 0 |
| DepositChecking | 150 | 570.99 | 118.00 | 531.20 | 779.56 | 1122 | ±18.88 | 1.75 | 3 358 | 0 |
| SendPayment | 150 | 604.63 | 99.04 | 578.67 | 781.12 | 1006 | ±15.85 | 1.65 | 5 963 | 0 |
| WriteCheck | 150 | 589.01 | 78.02 | 565.13 | 753.79 | 812.31 | ±12.49 | 1.70 | 3 362 | 0 |
| Amalgamate | 150 | 631.62 | 105.86 | 604.21 | 827.51 | 935.96 | ±16.94 | 1.58 | 5 936 | 0 |

**Reading:** All 750 transactions succeeded. Compute cost is value-independent
and scales with the **number of account writes**: single-account txns
(TransactSavings / DepositChecking / WriteCheck) ~3.4k CU; two-account txns
(SendPayment / Amalgamate) ~5.9k CU. No contention in the sequential schedule.

---

## 3. TPC-C Concurrency Sweep (TX = 500, 50% NewOrder / 50% Payment)

100% success at every concurrency level. Throughput from concurrent in-flight
submission; latency is per-transaction client→confirmed.

| Concurrency | TPS | mean ms | stddev | p50 | p95 | p99 | ci95 | CU/tx mean | CU/tx p95 | CU/tx max |
|-------------|-----|---------|--------|-----|-----|-----|------|------------|-----------|-----------|
| 5 | 8.67 | 575.00 | 88.35 | 554 | 726.10 | 880.08 | ±7.74 | 21 263 | 30 035 | 37 286 |
| 10 | 14.50 | 679.34 | 108.53 | 658.5 | 879.95 | 1052 | ±9.51 | 20 633 | 28 544 | 39 035 |
| 20 | 21.87 | 856.74 | 301.95 | 755 | 1656.15 | 1677 | ±26.47 | 21 269 | 30 035 | 39 044 |
| 40 | 29.90 | 1057.79 | 411.89 | 900 | 1707 | 2071 | ±36.10 | 21 508 | 30 044 | 37 535 |

**Reading:**

- **Sublinear scaling.** 5→40 concurrency (8×) yields 8.67→29.90 TPS (3.45×).
  Diminishing returns — the single validator's block production is the ceiling.
- **Saturation knee between c=10 and c=20.** Latency stddev jumps 108→302 ms
  and p95 nearly doubles (880→1656 ms): in-flight transactions begin queueing.
- **CU/tx flat (~21k) across all loads.** On-chain compute cost is independent
  of concurrency → the bottleneck is *consensus/block-time + write
  serialization on `District.next_o_id`*, not execution. This is the expected
  signature of a write-contended OLTP workload on a single-node ledger.

A prior `TX=200 @ c=10` reference run gave 14.79 TPS / 21 118 CU mean,
consistent with the `TX=500 @ c=10` point above (14.50 TPS), confirming
run-to-run stability.

---

## 4. Governance & Oracle Instruction CU Profile (in-process, litesvm)

Happy-path compute-unit cost of every governance + oracle instruction, measured
in-process via litesvm (`computeUnitsConsumed()` from the tx meta) against the
**default-feature** `.so` (no `localnet`, so `compute_fn!` is a no-op — these are
production-representative). No validator required.

Reproduce: `npm run test:cu-profile` (asserts each instruction < 200k default budget).

| Instruction | CU |
| ----------- | --: |
| `governance.initialize_poa` | 16 417 |
| `governance.propose_authority_change` | 13 328 |
| `governance.approve_authority_change` | 13 278 |
| `governance.set_oracle_authority` | 13 324 |
| `governance.update_erc_limits` | 13 283 |
| `oracle.initialize` | 11 098 |
| `oracle.submit_meter_reading` (first — inits meter PDA) | 16 050 |
| `oracle.submit_meter_reading` (subsequent) | 13 376 |
| `oracle.trigger_market_clearing` | 8 390 |
| `oracle.aggregate_readings` | 8 362 |
| `oracle.update_validation_config` | 7 811 |

**Reading:** all governance/oracle instructions sit at **≤16.4k CU (≤8.2% of the
200k budget)** — cheap config/control paths with ample headroom. The hot oracle
write path (`submit_meter_reading`) costs ~16k on first touch (meter PDA init)
and ~13.4k steady-state. Contrast §1's `settle_offchain_match` at 103k: these are
config/telemetry instructions, not signature-verifying settlement. The CI
assertion turns an accidental extra syscall or a serialized hot-path account into
a test failure.

---

## 5. Treasury Instruction CU Profile (in-process, litesvm)

Compute-unit cost of the treasury economic hot paths (swap / redeem / stake /
settlement recording) plus the admin/attestation primitives. Same method as §4
(litesvm `computeUnitsConsumed()`, default-feature `.so`, Token-2022 wiring
mirroring `tests/treasury_redeem_guards_litesvm.ts`). No validator required.

Reproduce: `npm run test:cu-profile` (runs every `tests/cu_profile_*_litesvm.ts`).

| Instruction | CU |
| ----------- | --: |
| `treasury.initialize` | 42 278 |
| `treasury.swap_grx_for_thbg` | 21 488 |
| `treasury.redeem_thbg_for_grx` | 21 323 |
| `treasury.stake_grx` (first — inits position) | 22 535 |
| `treasury.update_attestation` | 3 300 |
| `treasury.record_settlement` | 3 300 |
| `treasury.set_params` | 2 863 |

**Reading:** the swap/redeem/stake hot paths cluster at **~21–22.5k CU**, driven
by the Token-2022 transfer + mint/burn CPIs (one-time `stake` adds a position-PDA
init). `initialize` is the heaviest at 42k — a one-off that creates the THBG mint
plus the three GRX vaults (swap/stake/reward). Pure-state admin instructions
(`update_attestation`, `record_settlement`, `set_params`) are ~3k. All sit well
inside the 200k budget — the baht-settlement primitive (swap) costs ~1/5 of the
§1 `settle_offchain_match` figure.

---

## 6. Registry Lifecycle CU Profile (in-process, litesvm)

Compute-unit cost of the registry user/meter lifecycle — the telemetry hot path
(`register_user` → `register_meter` → `update_meter_reading`) plus the admin/shard
setup. Same method as §4/§5. No validator, no token CPI on this path.

Reproduce: `npm run test:cu-profile` (runs every `tests/cu_profile_*_litesvm.ts`).

| Instruction | CU |
| ----------- | --: |
| `registry.register_meter` | 17 104 |
| `registry.register_user` | 12 910 |
| `registry.initialize` | 6 666 |
| `registry.deactivate_meter` | 6 435 |
| `registry.initialize_shard` | 6 404 |
| `registry.update_meter_reading` | 3 899 |
| `registry.set_oracle_authority` | 1 569 |

**Reading:** the recurring telemetry write `update_meter_reading` is **3.9k CU** —
cheap, as intended for the per-meter PDA hot path (no global-config write lock,
zero-copy meter state). The one-time registrations are heavier (`register_meter`
17k inits the meter PDA + bumps its shard; `register_user` 12.9k), but still a
fraction of the budget. The token-bearing registry instructions (`stake_grx`
validator bond, `settle_and_mint_tokens`, `claim_airdrop`) are out of scope here;
the bond plumbing mirrors the §5 treasury stake (~22k CU).

---

## 7. Trading CDA Order-Path CU Profile (in-process, litesvm)

Compute-unit cost of the trading order book path — market/zone setup, escrow
deposit/withdraw, create sell/buy order, on-chain `match_orders` (CDA), and cancel.
Same method as §4-6. The fabricated governance PoAConfig/ErcCertificate mirror
`tests/order_guards_litesvm.ts`. Token transfers use classic SPL (Token program).

Reproduce: `npm run test:cu-profile` (runs every `tests/cu_profile_*_litesvm.ts`).

| Instruction | CU |
| ----------- | --: |
| `trading.deposit_escrow` | 30 658 |
| `trading.withdraw_escrow` | 21 094 |
| `trading.match_orders` (CDA) | 11 746 |
| `trading.create_sell_order` | 10 008 |
| `trading.create_buy_order` | 8 961 |
| `trading.initialize_market` | 8 392 |
| `trading.initialize_zone_market` | 6 867 |
| `trading.cancel_order` | 4 463 |

**Reading:** the **on-chain CDA match** (`match_orders`) is **11.7k CU** — cheap,
because it only touches the two `Order` PDAs + the `zone_market` and writes a trade
record; no token movement. Contrast §1's `settle_offchain_match` at **103k**: the
~9× gap is the Ed25519 signature-verify precompile + dual-mint escrow transfers on
the *settlement* path, which `match_orders` does not perform. The escrow
deposit/withdraw (SPL transfer + PDA init/close accounting) dominate this path at
21-31k. Order create/cancel are ~4-10k.

---

## Artifacts

```
test-results/
├── blockbench/   blockbench-<ISO8601>.{json,csv}
├── smallbank/    smallbank-<ISO8601>.{json,csv}
└── tpc/          tpc-c-<ISO8601>.{json,csv}   (one file per concurrency level)
```

Each JSON carries full per-sample distributions and host metadata; each CSV is
a single summary row for spreadsheet/plotting ingestion.

---

## Best Practices & Roadmap

The results above are a **single-node, generic-OLTP** baseline. To make them
defensible as a *P2P energy-trading* benchmark, the gaps below remain. Tags:
**[CRIT]** = fix or claims get rejected · **[IMP]** = strong-paper material ·
**[POLISH]** = rigor polish.

**Systems performance**
- **[CRIT — first datapoint measured]** Benchmark the **real CDA settlement path**
  (`trading::settle_offchain_match` / `batch_settle_offchain_match`: escrow +
  order nullifier + signature verify + trade record), not just BlockBench /
  SmallBank / TPC-C proxies — so TPS/CU describe this system, not a generic
  workload. **Single-match CU is now measured on-chain:** `settle_offchain_match`
  = **103 363 CU** (match_amount 100, price 50), captured via the `BENCH_SETTLE_CU`
  probe in `tests/escrow_settlement.ts` against a live validator (Solana 3.1.10,
  current `trading` build). That is **~5× the ~21k CU/tx TPC-C proxy above** — the
  Ed25519 signature verify + dual-mint (classic currency / Token-2022 energy)
  transfers + escrow/nullifier writes dominate, so the generic-OLTP figure
  materially *understates* per-trade compute. The §2b **batch** path
  (`batch_settle_offchain_match` → treasury `record_settlement_batch`) is also
  on-chain verified now (`tests/batch_settle_thbg.ts`). **Batch CU, 1 match ≈
  80–92k CU** (`BENCH_BATCH_SETTLE_CU` probe, both mints Token-2022, +
  `record_settlement_batch` CPI + 2 in-loop nullifier creates), captured against
  the same validator. Lower than the 103 363 single-match figure above because
  that run paid a classic-SPL→Token-2022 cross-program currency leg; here both
  legs are Token-2022. The ~12k run-to-run spread is **bump-seek noise, not
  ledger drift**: the in-loop binding derives ~10 PDAs via `find_program_address`
  (settle_offchain.rs:606–634), and each run's fresh keypairs land on different
  bump-search iteration counts.
  **A >1-match single-transaction batch is not achievable** with the current
  design: `batch_settle_offchain_match` introspects the instructions sysvar for 2
  inline Ed25519 verify ixs *per match* (`settle_offchain.rs:598`), and that
  ~189 B/ix sig+pubkey+message payload lives in instruction data, not accounts —
  an ALT can't compress it. Two matches (4 Ed25519 ixs ~760 B + 2 serialized
  `BatchMatchPair`s ~370 B + the settle ix account-index list + headers) overrun
  the 1232-byte packet (`RangeError: encoding overruns Uint8Array` at
  `MessageV0.serialize`). A real per-match marginal-CU curve therefore needs a
  packaging change (pre-verified signature accounts, or an off-chain aggregated
  multisig), not just more matches per call.
  **Batch-settle TPS (single authority, `tests/batch_settle_tps.ts`):** an
  open-loop submission sweep (pre-seed + pre-build all settle txs, then fire with
  `conc` in flight and poll to confirmed; goodput-style — dropped txs re-fired) on
  the same validator gives **~0.5 TPS, flat across concurrency** (conc 5 → 0.51,
  conc 10 → 0.58 TPS; N=10/level, 100% goodput, 0 on-chain reverts, CU ≈ 86–89k).
  Throughput does **not** scale with concurrency and every level needs a second
  re-fire round. **The bottleneck is NOT the shard.** Spreading the settles across
  all 16 shards (`BENCH_TPS_SHARD_SPREAD=1`; `market_shard`/`zone_shard` carry no
  seeds constraint — `settle_offchain.rs:260` — so the client picks the shard)
  gave the *same* numbers (0.59 / 0.57 TPS, still 2 rounds). The serialization is
  the set of **global writable accounts every settle touches regardless of shard**:
  `treasury_state` (the `total_settled_thbg` accumulator bumped by
  `record_settlement_batch`) and the three fixed `fee`/`wheeling`/`loss` collector
  token accounts (one PDA each per currency). Settlement is therefore
  global-write-bound by design — sharding parallelizes *order submission* (per-
  entity PDAs on the hot path), but settlement reconciles into global totals. The
  load-free per-trade cost (CU) is the figure to cite. To actually parallelize
  settlement you'd need to shard the treasury accumulator + collectors too, or
  amortize more matches per CPI (blocked by the 1-match single-tx cap above).
  Still TODO: a true open-loop (no per-round confirm barrier) for peak TPS, and
  the batch-CU curve once the signature packaging is reworked.
- **[IMP — §3 spike, on-chain]** **Trustless fraud-proof verify CU.** Feasibility
  gate for an indexed-Merkle exclusion proof (prove a settled match was *dropped*):
  measured via the throwaway `blockbench::merkle_verify_inclusion`/`_exclusion`
  instructions (sha256 ladder, `tests/spike_merkle_cu.ts`, Solana 3.1.10).
  Inclusion = **3 250 CU @ depth 10 / 4 114 @ depth 14**; exclusion = **3 629 /
  4 493** — ~**216 CU per tree level**, exclusion ~380 CU over inclusion (one extra
  low-leaf hash + the range check). Both forge classes revert on-chain (tampered
  sibling → root mismatch; claim-present-absent → range check). A challenge's
  Ed25519 meter-sig verify is the existing SigVerify precompile (already inside the
  103k single / ~85k batch settle CU). **Per-challenge verify is ≪ the 200k default
  budget (~2%), ~0.3% of the 1.4M max** — CU does NOT block a trustless Tier-2; the
  open gate is the immediate-settlement → challenge-window redesign (see
  `docs/proposed/implementation-plan.md` §3 T3.3). NOTE: these `blockbench`
  additions are spike-only (throwaway); the blockbench IDL was not regenerated (the
  test builds the ix by hand).
- **[IMP — §1 slash, on-chain]** **`registry::slash_validator` CU = 27 811** on the
  heavier two-transfer path (victim compensation + fund remainder; `BENCH_SLASH_CU`
  in `tests/staking.ts`, Solana 3.1.10) — well inside the 200k default budget. The
  full §1 slash-distribution rework (severity σ, capped compensation, transparent
  fund, Suspended/Slashed transitions, value invariant) is on-chain verified there
  (11/11).
- **[CRIT]** **Multi-validator** (3–4 PoA nodes). A single validator measures
  no consensus cost, yet "block-time is the bottleneck" is the headline claim.
- **[CRIT]** **Open-loop load** (fix arrival rate λ, ramp to saturation) and
  **push past the c=40 knee** to find peak/collapse. Report max sustainable
  TPS at an SLA (p99 < X ms).
- **[IMP]** **Repeat the sweep ≥3–5×** → CI on TPS (currently CI95 on latency
  only; TPS is a single point per concurrency level).
- **[IMP]** Run sequential workloads concurrently **or** label their ~1.6 TPS
  as latency-bound, not throughput.

**P2P-energy domain**
- **[CRIT]** **Settlement-window throughput** — trades cleared per 15-min /
  900 s market-clearing epoch vs deadline (≈26.9k headroom at 29.9 TPS), not
  bare TPS.
- **[CRIT]** **Cost per trade** — convert ~21k CU/tx to fee/$ at a stated
  lamport price; report the fee-to-trade-value ratio (adoption gate).
- **[CRIT]** **CDA allocative efficiency / welfare** vs a uniform-price or
  feed-in-tariff baseline — the actual P2P contribution.
- **[IMP]** **Baseline comparison** vs Hyperledger Fabric (dominant in
  P2P-energy literature) and/or a centralized DB market-clearing baseline.
- **[IMP]** **Liveness under validator failure** (1-of-N down) — PoA
  consortium availability claim.

Full rationale, priority table, and the minimum-viable subset live in the
superproject doc `docs/benchmark-best-practices.md`.
