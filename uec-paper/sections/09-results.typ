#import "@preview/lilaq:0.6.0" as lq

// Chart palette — Okabe-Ito, CVD-validated (skill validator: all checks pass,
// worst adjacent-pair ΔE 21.9 protan / 31.2 normal vs light surface).
#let c-blue = rgb("#0072B2") // primary measured series
#let c-verm = rgb("#D55E00") // secondary measured series
#let c-gray = rgb("#999999") // non-data reference lines (ideal/limit)

= 9. Key Results and Discussion

This section reports the principal empirical findings and interprets them against
the design goals of §2.1. All figures are drawn from the canonical benchmark
report #link("BENCHMARKS.md")[`BENCHMARKS.md`]. The compute-unit (CU) values are
machine-independent and are reproduced from the in-process LiteSVM profiles,
whereas the throughput figures are qualified by the single-node caveat of §2.3.

Table 1 summarises the headline findings; each is developed and cited in the
subsections that follow. Two throughput limits are reported separately and must
not be conflated: the matching/OLTP path scales super-linearly to the swept
ceiling, whereas any path that funnels through one write-locked account (mint
issuance, single-fee-payer settlement, single-gateway meter ingest) is bounded by
that serialisation, not by execution.

#figure(
  caption: [Headline empirical results. All values are drawn from the canonical
    benchmark report #link("BENCHMARKS.md")[`BENCHMARKS.md`] (`3cb3388`,
    Solana 3.1.10, Apple M2, 2026-07-06). CU figures are machine-independent;
    absolute throughput is qualified by the single-node caveat (§2.3, §8.3).],
  table(
    columns: (auto, auto, auto),
    align: (left, left, left),
    table.header([*Metric*], [*Measured value*], [*Bottleneck source*]),
    [Peak throughput (TPC-C proxy, c=40)], [≈74.25 tx·s#super[−1]], [block-time + write-lock on shared accounts],
    [Scaling (c=5→c=40)], [super-linear (9.4× over 8×), no saturation knee], [— (execution is load-independent)],
    [Per-tx compute (all loads)], [flat ≈22–24 k CU], [load-independent (not execution-bound)],
    [Single-signer mint issuance], [≈5.33 mint·s#super[−1]], [shared `mint` write-lock (device-count independent)],
    [Batch-settle (single fee-payer)], [≈0.6 tx·s#super[−1]], [global collectors + `treasury_state` accumulator write-lock],
    [Meter ingest, 100,000 meters], [0.35% delivery loss, ≈13.5 k CU flat], [single gateway payer write-lock (not per-meter)],
    [Meter ingest, 200,000 meters (extension sweep)], [0% delivery loss, 426–455 TPS flat, ≈13.6 k CU flat], [single gateway payer write-lock (not per-meter)],
    [Transaction failure rate (TPC-C sweep)], [0% at all concurrency levels], [—],
    [Settlement compute cost], [121,813 CU·match#super[−1] (≈61% budget)], [Ed25519 verify + dual-mint escrow],
  ),
)

== 9.1 Compute-unit cost of on-chain operations

Table 2 summarises the measured CU cost of representative instructions and their
share of the 200,000-CU default per-instruction budget. Two facts stand out.
First, every control, telemetry, and settlement-recording path costs no more than ≈16,000 CU — at most ≈8% of the budget —
so the high-frequency operations retain ample headroom. Second, the off-chain-match
settlement instruction, `settle_offchain_match`, is by a wide margin the most
expensive operation at roughly 122,000 CU (about 61% of the budget); its cost is
dominated by the native Ed25519 signature verification and instruction-sysvar
introspection that authorise the trade (§6.3), not by the settlement arithmetic
itself.

#figure(
  caption: [Measured compute-unit cost of representative instructions and their
    share of the 200,000-CU default budget. Source: #link("BENCHMARKS.md")[`BENCHMARKS.md`] §1, §4, §5, §5b.],
  table(
    columns: (auto, auto, auto),
    align: (left, right, right),
    table.header([*Instruction*], [*CU*], [*% of 200k*]),
    [`do_nothing` (dispatch + signature-verify floor)], [769], [0.4%],
    [`treasury.record_settlement`], [3,301], [1.7%],
    [`governance.approve_authority_change`], [5,784], [2.9%],
    [`treasury.record_settlement_sharded`], [5,374], [2.7%],
    [`oracle.trigger_market_clearing`], [8,390], [4.2%],
    [`oracle.submit_meter_reading` (steady-state)], [13,376], [6.7%],
    [`oracle.submit_meter_reading` (first, inits PDA)], [16,050], [8.0%],
    [`trading.settle_offchain_match`], [122,000], [61.0%],
  ),
)

The hot telemetry write, `submit_meter_reading`, costs about 16,050 CU on the
first submission for a meter — which initialises the meter PDA — and about
13,376 CU in steady state, confirming that the dominant recurring on-chain write
sits comfortably inside budget. The governance and oracle control instructions all
fall between roughly 5,800 and 11,100 CU (full profile: #link("BENCHMARKS.md")[`BENCHMARKS.md`] §4).

== 9.2 Parallelism and throughput under load

Under the TPC-C concurrency sweep, aggregate throughput rises from 7.87
transactions per second (TPS) at concurrency 5 to 74.25 TPS at concurrency 40 —
a 9.4-fold increase over an 8-fold rise in concurrency — climbing monotonically
with no saturation knee within the swept range. Crucially, the per-transaction CU
cost remains flat at approximately 22,000–24,000 CU across all concurrency
levels, which shows that on-chain execution cost is independent of load. The
throughput ceiling is therefore imposed by consensus block time and by write-lock
serialisation on the few genuinely shared accounts, not by program execution.

#figure(
  text(size: 8pt)[
    #lq.diagram(
      width: 9cm, height: 5cm,
      xscale: "log",
      xaxis: (ticks: ((5, [5]), (10, [10]), (20, [20]), (40, [40]))),
      xlabel: [concurrency (in-flight tx)],
      ylabel: [TPS (confirmed/s)],
      ylim: (0, 80),
      legend: (position: top + left),
      // super-linear surplus: measured minus linear-ideal extrapolation
      lq.fill-between((5, 10, 20, 40), (7.87, 15.74, 31.48, 62.96),
        y2: (7.87, 18.74, 33.68, 74.25),
        fill: c-blue.transparentize(85%), stroke: none, z-index: 0),
      lq.plot((5, 10, 20, 40), (7.87, 15.74, 31.48, 62.96),
        mark: none, stroke: (paint: c-gray, dash: "dashed"), label: [linear from c = 5]),
      lq.plot((5, 10, 20, 40), (7.87, 18.74, 33.68, 74.25),
        mark: "o", color: c-blue, label: [measured]),
    )
  ],
  caption: [TPC-C throughput vs. in-flight concurrency on the single-node
    validator. Measured TPS (n = 500 per level, 100% success) climbs
    monotonically above the linear extrapolation from the c = 5 base — 9.4×
    over an 8× concurrency rise — with no saturation knee in the swept range.
    The c = 5 base is a soft floor (cold-start noise, latency σ ≈ 393 ms vs.
    ≈ 10 ms at c = 40), so the super-linear surplus (shaded) partly reflects
    warm-up of the first level. Source: #link("BENCHMARKS.md")[`BENCHMARKS.md`] §3.],
) <fig-tpc-scaling>

The single-node development topology bounds absolute write throughput at
approximately 2.0 TPS for any operation that requires a block, because latency is
dominated by the ~400–600 ms block time rather than by compute. By contrast, a
read served directly by the RPC node returns in under a millisecond
(≈1,454 TPS), three orders of magnitude faster, as it involves no consensus
round-trip. These absolute rates are properties of the single-node harness, not of
the protocol, and must not be read as consensus-throughput results (§2.3, §8.3).

A distinct serialisation limit governs token issuance. Settlement mints GRID
against a matched trade, and because every settle write-locks the same treasury
accumulator and the shared fee, wheeling, and loss collector accounts, issuance
does not parallelise across the contributing devices: an open-loop sweep in which
a single fee-payer submits settlements holds at approximately 0.6 mint·s#super[−1]
irrespective of in-flight concurrency and of whether the offered load originates
from one device or many. The bottleneck is the shared accumulator, not the signer
or the device population — the direct-mint path, by contrast, packs many mints
into a single slot from one signer, confirming that raw issuance is limited by the
confirmation round-trip rather than by on-chain contention. Two complementary
remedies restore parallelism: sharding the collector and accumulator accounts so
that concurrent settlements touch disjoint writable state (§9.5), and pooling
multiple fee-payers so that submission is not funnelled through a single account.
In a Tier-A prototype combining both, per-slot settlement packing rises to
approximately 7.5 mint·s#super[−1]. We therefore identify multi-signer fee-payer pooling,
together with per-shard collector accounts, as the primary lever for
settlement-side throughput.

Table 3 consolidates every throughput figure measured in this evaluation. All
values are *client-observed confirmed goodput* — successfully confirmed
transactions per wall-clock second, measured from burst start to last observed
confirmation at `confirmed` commitment, so each figure includes the full pipeline
(client signing, RPC ingest, banking-stage execution, block production, and
confirmation visibility). None is a consensus- or network-throughput result
(§2.3, §8.3); rows measured through different client harnesses (the OLTP proxy's
per-transaction confirmation versus the ingest benchmark's raw submission) are not
directly comparable with one another.

#figure(
  caption: [Consolidated measured throughput. All values are client-observed
    confirmed goodput on the single-node validator; harnesses differ per row and
    rows are not mutually comparable. Source: #link("BENCHMARKS.md")[`BENCHMARKS.md`]
    §3, §9 and the settlement sweeps of §9.2.],
  table(
    columns: (auto, auto, auto),
    align: (left, right, left),
    table.header([*Path*], [*TPS*], [*Bottleneck / regime*]),
    [RPC read (no consensus round-trip)], [≈1,454], [none — RPC node local],
    [Meter ingest, steady (5k–50k meters, sustained)], [393–490], [single gateway fee-payer write-lock],
    [Meter ingest, steady (100k meters)], [322], [single gateway fee-payer write-lock],
    [CDA order entry, sharded (10k orders)], [180], [shared `zone_market` write-lock + fee-payer],
    [TPC-C OLTP proxy (concurrency 5 → 40)], [7.87 → 74.25], [block time + shared-account locks],
    [Sequential single-operation write], [≈2.0], [~400–600 ms block time per round-trip],
    [Settlement mint, Tier-A prototype (sharded + pooled payers)], [≈7.5], [per-slot packing],
    [Settlement mint, single fee-payer], [≈0.6], [global collector/accumulator write-lock],
  ),
) <tab-tps-list>

The spread spans three orders of magnitude and sorts cleanly by how much shared,
write-locked state each path touches: reads lock nothing; meter ingest locks only
the gateway payer; order entry additionally write-locks the shared zone-market
account; the OLTP proxy locks a few market accounts; and naive settlement locks
global accumulators. Order entry makes the ordering principle explicit: it is the
cheapest hot-path write measured (≈9.9 k CU, below the ≈13.5 k CU meter write) yet
delivers roughly 1/2.6 the throughput of meter ingest at the same fleet size, because
its account contexts still declare the shared zone-market account writable although
the handler mutates only the per-shard account. Throughput on this platform is a
function of lock footprint, not of instruction compute cost. The formal workload
definition and the full order-entry measurement are given in §11.11.

== 9.3 Meter-telemetry ingest scaling to 200,000 meters

The concurrency sweep above uses a generic-OLTP proxy. To characterise the *actual*
telemetry hot path at fleet scale, we constructed a fleet-ingest benchmark
(`scripts/bench-meter-throughput.ts`) that emulates an AMI gateway submitting one
reading per meter for fleets of 80 to 100,000 distinct meters against a live
single-node validator, followed by an extension sweep
(`scripts/run-meter-scale-sweep.sh`, driving the same harness) that pushes the
fleet to 200,000 distinct meters.

*Test design.* Each simulated meter has a unique identifier, so each submission
targets its own `MeterState` PDA (`[b"meter", meter_id]`) and the write set of any
two submissions is disjoint (Sealevel-parallelisable, §4.2). All submissions are
signed by one gateway key — the registered `chain_bridge` authority that the oracle
program requires (§7 step 2) — which mirrors the production topology in which a
single Aggregator Bridge fronts the meter fleet, and which deliberately preserves
the shared-fee-payer serialisation the paper identifies as the ingest ceiling. Every
run submits *two epochs* of readings: the on-chain rate-limit guard
(`min_reading_interval` = 60 s) and the strictly-increasing-timestamp guard force
epochs at least 61 s apart, and the split separates the one-off account-creation
cost (epoch 1 initialises every meter PDA and pays its rent) from the recurring
steady-state write (epoch 2), which is the figure that matters for a fleet in
operation. Reading values follow a fixed synthetic pattern; each transaction
carries exactly one `submit_meter_reading` instruction.

*Measurement.* Throughput is client-observed confirmed goodput as in Table 3;
latency is send-to-confirmed per transaction; compute units are read post-hoc from
transaction metadata of a sample of confirmed transactions. Every non-confirmed
transaction is attributed to one of three failure classes: *send-rejected* (the RPC
node refused the submission — never entered the validator, no fee), *on-chain
error* (executed and failed a program guard — fee paid, failure recorded on the
ledger), and *expired* (accepted but never confirmed within 90 s — dropped from
the ingest queue or its blockhash aged out; no fee, no trace). The classes have
different operational meaning: on-chain errors are the oracle's input validation
doing its job, while send-rejected and expired transactions are pure delivery
loss, invisible on-chain and recoverable by client retry — the rate-limit and
monotonic-timestamp guards make resubmission idempotent: no reading can be
double-counted. All fleet sizes use one transport: transactions are pre-signed
locally against a cached blockhash, submitted raw without preflight or retry, and
confirmed by bulk signature-status polling (1.5 s sweep) under a 3,000-transaction
in-flight window, so latency is poll-quantised (±1.5 s). Reading timestamps are
taken from the on-chain clock rather than the client's wall clock, matching the
clock against which the oracle's freshness guard is evaluated. The formal metric
definitions and the full harness parameterisation are given in §11.10. Table 4
reports the result.

#figure(
  caption: [Oracle meter-telemetry ingest scaled from 80 to 100,000 meters on a live
    single-node validator, with every non-confirmed transaction attributed.
    Validation-rejected = the oracle's anomaly gate firing on the synthetic value
    pattern (§11.10); delivery loss = send-rejected + expired, with no client retry.
    Steady-state CU is the recurring per-meter write; the base path (`CU min`) is
    the value to cite. Source: #link("BENCHMARKS.md")[`BENCHMARKS.md`] §9.],
  table(
    columns: 6,
    align: (right, right, right, right, right, right),
    table.header(
      [*Meters*], [*Confirmed / total*], [*Validation- rejected*], [*Delivery loss*], [*Steady CU min*], [*TPS (steady)*],
    ),
    [80], [160 / 160], [0%], [0%], [13,560], [47],
    [1,000], [1,988 / 2,000], [0.40%], [0.20%], [13,634], [267],
    [5,000], [9,906 / 10,000], [0.48%], [0.46%], [13,634], [393],
    [10,000], [19,862 / 20,000], [0.46%], [0.23%], [13,337], [462],
    [50,000], [99,247 / 100,000], [0.47%], [0.28%], [13,337], [490],
    [100,000], [198,347 / 200,000], [0.48%], [0.35%], [13,634], [322],
  ),
) <tab-meter-scaling>

Three results stand out. First, the steady-state base write cost holds at
13,300–13,600 CU across a 1,250-fold increase in meter count, matching the
13,376 CU litesvm figure of §9.1: the per-meter write is $O(1)$ in fleet size,
exactly as the per-entity-PDA partitioning predicts, with the residual ±150 CU
attributable to meter-identifier byte length rather than fleet size. Second, the
loss decomposition separates two very different phenomena. The validation-rejected
column is constant at ≈0.47% because the synthetic value pattern deterministically
drives that fraction of meters past the anomaly gate (@eq-anomaly) — the same
meters are rejected in every epoch, each rejection is fee-paid and recorded, and
the bucket demonstrates the oracle's input validation firing correctly under
100,000-meter load. True delivery loss — submissions that vanished in transit —
stays at or below 0.46% at every fleet size (0.35% at 200,000 transactions) with
no client retry; because resubmission is idempotent, a single retry round would
reduce the effective rate to the order of $10^(-5)$. Third, throughput does not
grow with meter count: small fleets are ramp-limited (an 80-transaction burst
never fills the pipeline), sustained rates reach roughly 390–490 TPS between
5,000 and 50,000 meters, and the fleet doubling from 50,000 to 100,000 does not raise throughput, because every submission is signed by the single gateway fee-payer,
which is write-locked on each transaction — as with settlement in §9.2, the
ceiling is a shared-account serialisation limit, not per-meter contention. The
flat CU confirms the on-chain write itself is already scale-free; converting the
disjoint per-meter PDAs into proportional throughput requires the same remedy
identified for settlement, namely pooling multiple gateway fee-payers so ingress
is not funnelled through one signer.

*Extension sweep to 200,000 meters.* A follow-up sweep
(`scripts/run-meter-scale-sweep.sh`, 2026-07-19) re-runs the same harness at
10,000 / 50,000 / 100,000 / 150,000 / 200,000 meters, two epochs each, with the
scales executed back-to-back on one validator instance and no ledger reset in
between — so the 200,000-meter case starts against an existing set of over
310,000 meter PDAs from the smaller scales, and the validator ends the sweep
holding 510,000 meter PDAs from this experiment alone (1,020,000 transactions
total). Table 5 reports the result; the combined summary is generated by
`scripts/summarize-meter-scale.ts`.

#figure(
  caption: [Extension sweep to 200,000 meters (single run per scale, 2026-07-19,
    same transport and attribution as Table 4). Delivery loss is zero at every
    scale: every non-confirmed transaction is a fee-paid, deterministic
    `AnomalousReading` validation rejection (@eq-workload). Source:
    #link("BENCHMARKS.md")[`BENCHMARKS.md`] §9.],
  table(
    columns: 6,
    align: (right, right, right, right, right, right),
    table.header(
      [*Meters*], [*Confirmed / total*], [*Validation- rejected*], [*Delivery loss*], [*Steady CU min*], [*TPS (steady)*],
    ),
    [10,000], [19,908 / 20,000], [0.46%], [0%], [13,525], [429],
    [50,000], [99,524 / 100,000], [0.48%], [0%], [13,525], [243],
    [100,000], [199,048 / 200,000], [0.48%], [0%], [13,560], [455],
    [150,000], [298,572 / 300,000], [0.48%], [0%], [13,560], [426],
    [200,000], [398,096 / 400,000], [0.48%], [0%], [13,560], [443],
  ),
) <tab-meter-scaling-ext>

#figure(
  text(size: 8pt)[
    #lq.diagram(
      width: 9cm, height: 5cm,
      xaxis: (ticks: ((10, [10 k]), (50, [50 k]), (100, [100 k]), (150, [150 k]), (200, [200 k]))),
      xlabel: [fleet size (meters)],
      ylabel: [TPS (confirmed/s)],
      ylim: (0, 520),
      legend: (position: bottom + right),
      lq.plot((10, 50, 100, 150, 200), (439.16, 319.8, 409.57, 449.35, 438.48),
        mark: "s", color: c-verm, label: [epoch 1 (PDA init)]),
      lq.plot((10, 50, 100, 150, 200), (429.07, 243.05, 455.46, 426.23, 443.15),
        mark: "o", color: c-blue, label: [epoch 2 (steady write)]),
    )
  ],
  caption: [Telemetry write throughput vs. meter count, 10,000 → 200,000
    meters (extension sweep, Table 5). Both the PDA-creating first epoch and
    the steady-state second epoch hold a flat ≈ 410–455 TPS band across a
    20× fleet range and a 510,000-account cumulative state set; the paired
    dip at 50,000 meters is a transient validator stall spanning both epochs
    of that scale, not a scale trend — every larger scale recovers the band.
    The ceiling at every size is the single write-locked gateway fee-payer.],
) <fig-meter-scaling>

The extension sharpens all three §9.3 findings and adds a fourth. Steady-state
throughput is flat in fleet size — 426–455 TPS at 10,000, 100,000, 150,000 and
200,000 meters (the 243 TPS point at 50,000 is a transient validator stall that
does not recur at any larger scale, including the 100,000-meter case run
immediately after it) — and doubling the fleet beyond the earlier 100,000-meter
ceiling leaves throughput, latency (p50 ≈ 1.5–1.9 s, p95 ≤ 3.1 s, poll-quantised), and the steady write cost unchanged (CU min 13,525–13,560, the same 13,300–13,600 CU band as Table 4). The base write is therefore $O(1)$ not only in
fleet size but in *accumulated account count*: the last 200,000 submissions
execute against a state set five times larger than the first scale's and are
indistinguishable in cost. Finally, delivery loss is exactly zero across all
1,020,000 first-attempt submissions — no send rejection, no expiry — improving
on the ≤0.46% of Table 4; the entire 0.46–0.48% non-confirmed residue is the
deterministic anomaly-gate probe ($nu$), firing on the same meter indices in
every epoch. The single-validator, single-fee-payer qualifications of §2.3
apply unchanged.

== 9.4 One-month community simulation: closing the token lifecycle

The preceding sections measure each hot path in isolation. To demonstrate that
the paths compose — and that the token accounting closes — we replayed one full
month of a physically modelled community against a live validator and drove
every stage of the token lifecycle from the resulting data
(`scripts/bench-community-month.ts`). The input is not synthetic in the sense
of §9.3: it is produced by the platform's smart-meter simulator
(`gridtokenx-smartmeter-simulator`, seeded solar-irradiance and load models),
which generates an 80-meter fleet containing 12 solar prosumers and 68
consumers, sampled at the production cadence of 96 fifteen-minute intervals per
day for 30 days — 230,400 readings totalling 15,868.5 kWh generated, 144,879.8
kWh consumed, and 10,386.7 kWh of interval surplus. A market-policy constraint
caps each prosumer at 10 kWh of sales per day; the cap binds on 305 of 360
prosumer-days.

*Phase design.* The oracle rejects only future-dated readings, so a month of
historical timestamps replays back-to-back. Because the per-meter
strictly-increasing-timestamp guard forbids two in-flight submissions for one
meter, readings ship as per-meter *batched* transactions — up to ten
`submit_meter_reading` instructions per transaction, whose in-transaction
sequential execution preserves order — across 80 concurrently progressing meter
chains; readings that would trip the anomaly gate (@eq-anomaly) are isolated
into single-instruction transactions so the on-chain rejection is still
exercised rather than aborting a batch. Each simulated day then runs a trading
session (12 sell offers of min(day surplus, 10 kWh), 68 bids at actual daily
consumption) and the full lifecycle per prosumer: a registry synchronisation
plus `settle_and_mint_tokens` CPI mints the capped, *oracle-accepted* surplus
as GRID (Token-2022); the seller deposits it into escrow; an Ed25519-signed
off-chain match settles against a rotating consumer through
`settle_offchain_match` (§6.3) in a v0 transaction with an address-lookup
table; the buyer withdraws delivery and burns it (energy consumed = tokens
retired). At month end the cap-withheld surplus is certified as renewable-energy
certificates through governance `issue_erc`, whose `mark_erc_claimed` CPI
enforces on-chain that GRID plus REC claims never exceed metered generation
(§11.7). Table 6 reports the lifecycle stages of the canonical run.

#figure(
  caption: [Token-lifecycle stages over the simulated month (canonical run,
    2026-07-07): 353 prosumer-days cleared the 0.1 kWh dust floor and completed
    the full mint→deposit→settle→burn chain; 12 month-end REC issuances. No
    stage recorded a failure. Latency is send→confirmed, poll-quantised
    (±1.5 s). Source: #link("BENCHMARKS.md")[`BENCHMARKS.md`] §11.],
  table(
    columns: 5,
    align: (left, right, right, right, right),
    table.header([*Stage*], [*ok*], [*fail*], [*CU median*], [*latency p50 (ms)*]),
    [registry sync + GRID mint (CPI)], [433], [0], [29,410], [1,468],
    [escrow deposit], [433], [0], [14,905], [1,480],
    [off-chain-signed settlement (Ed25519 ×2, v0+ALT)], [353], [0], [107,141], [1,465],
    [withdraw + burn], [353], [0], [21,963], [1,475],
    [REC issuance (`issue_erc`)], [12], [0], [71,369], [1,471],
  ),
) <tab-lifecycle>

*Results.* The month was replayed in 1,394.7 s of wall time — a 1,858-fold
real-time compression — with zero delivery loss on the telemetry phase: the 919
missing readings are exactly the anomaly-gate rejections, fee-paid and recorded
on the ledger, and this outcome reproduced *bit-identically across seven
replays* (throughput varied 194–232 readings/s with host load; the batched
transport carries ≈213 readings/s at only ≈21 tx/s). The token accounting
closes exactly: 3,290.724 kWh of GRID was minted, all of it trade-settled and
subsequently burned, and 4,962.778 kWh was certified as RECs — the two sums
together equal the oracle-accepted interval surplus of 8,253.502 kWh to the
watt-hour. The sell cap withholds 68% of raw surplus from the market, and total
demand (126,983.8 kWh) exceeds capped supply (3,290.8 kWh) 39-fold,
quantifying the cap's economic stringency in this community.

*On-chain verification.* Every headline figure was re-derived from live chain
state through RPC reads alone (`scripts/audit-community-month.ts`, 15/15
assertions): the per-meter reading counters sum to 229,481; the order,
trade-nullifier, and order-nullifier account counts are 2,396, 353, and 706;
the registry's `settled_net_generation` and `claimed_erc_generation` sums equal
the minted and certified totals; the GRID supply after burns collapses to the
68 escrow-seed watt-hours, proving every traded token was retired; the REC
supply equals the claimed energy at the mint's 1,000-base-units-per-kWh scale;
and the settlement currency conserves exactly (buyer escrow outflow 13,137
minor units = seller proceeds 12,832 + wheeling charges 305).

*A reproducibility caution.* An early lifecycle run silently lost 112 of 353
settlements to transaction *deduplication*: consecutive cap-bound days produced
byte-identical escrow-deposit transactions (same instruction, accounts, fee
payer, and cached blockhash within its 10 s refresh window), so the validator
deduplicated the resend while the client observed the earlier signature as
confirmed and proceeded — leaving the escrow unfunded at settlement. Replay
harnesses that reuse cached blockhashes must salt every transaction (ours now
prepends a day-varying compute-budget instruction); we record this because the
failure mode is invisible to the sender and surfaces only downstream.

== 9.5 Discussion

The measurements support the central design claim of §2.1: partitioning
high-frequency state into per-entity PDAs removes execution-side contention, so
the residual scaling limit is consensus and lock serialisation rather than
compute. The flat CU-versus-concurrency profile is the direct evidence — had hot
paths shared a writable account, compute cost or failure rate would have risen
with load; neither does. The sharded settlement-recording path reinforces this:
`record_settlement_sharded` writes a per-shard PDA at about 5,374 CU instead of
contending on a single global counter, converting a would-be serialisation point
into an embarrassingly parallel one, at the cost of a periodic off-hot-path
aggregation.

Settlement is the natural cost centre, and the 122,000-CU figure quantifies the
price of trustless authorisation: verifying two counterparty signatures on-chain
and proving that verification through sysvar introspection. This remains a single
transaction well within the per-transaction budget, but it explains why batch
settlement processes one match per transaction — the Ed25519 signature data for
each match cannot be compressed through an address-lookup table — so batching
amortises account-setup overhead rather than signature cost. Reducing this figure,
for example through succinct proof aggregation over many matches, is the clearest
avenue for further compute savings.

The principal limitation of this evaluation is topological. Because all on-chain
measurements are taken on a single self-producing validator, they faithfully
characterise SVM semantics — account locking, compute metering, and per-instruction
cost — but say nothing about consensus throughput, fork choice, or leader
rotation, which would require a multi-validator permissioned deployment (§8.3).
Establishing sustained end-to-end throughput on such a deployment, and locating the
true saturation point above concurrency 40, are left to future work.

== 9.6 Settlement under the three price rules

To confirm that the choice of price rule (§11.2) is a purely economic degree of
freedom with no on-chain compute cost, we settled real matches through
`batch_settle_offchain_match` on the live single-node validator under each rule
across two fleet sizes. Each transaction settles one match (the single-match
packet cap of §9.5); the off-chain match sets the clearing price $p^*$ to the
rule's value inside the signed band $p_s = 2.00 <= p^* <= p_b = 2.10$ THBC/kWh,
and $N$ is the number of independent matches submitted at concurrency 4. Table 7
reports confirmed goodput and the per-settle compute cost read from transaction
metadata.

#figure(
  caption: [Live on-chain settlement under each price rule and fleet size
    ($N$ matches, concurrency 4) on the single-node validator (Agave 3.1.10,
    Apple M2). Each settle is one `batch_settle_offchain_match` transaction; CU is
    machine-independent (`computeUnitsConsumed`), TPS is client-observed confirmed
    goodput (§9.2). Seller-net/buyer-cost per rule are the deterministic values of
    @tab-net-proceeds and are not re-measured on-chain.],
  table(
    columns: (auto, auto, auto, auto, auto, auto),
    align: (left, center, center, center, right, right),
    table.header(
      [*Price rule*], [*$p^*$ (THBC/kWh)*], [*$N$*], [*settled*], [*TPS*], [*CU/settle*],
    ),
    [CDA on-chain ($p^* = p_s$)], [2.00], [4], [4/4], [0.21], [116,470],
    [CDA on-chain ($p^* = p_s$)], [2.00], [8], [8/8], [0.45], [114,408],
    [Uniform-price epoch], [2.04], [4], [4/4], [0.23], [116,470],
    [Off-chain midpoint], [2.05], [8], [8/8], [0.46], [115,533],
  ),
) <tab-live-settle>

Three observations follow. First, the per-settle compute cost holds at 114–116 k CU
across all three price rules — a spread below 2% that tracks incidental
checked-arithmetic branches on the differing currency magnitudes, not the rule
itself — confirming directly on-chain that price selection does not touch
settlement compute; the figure also agrees with the 121,813 CU litesvm profile of
§9.1 to within the localnet-vs-litesvm margin. Second, every match settled
(100%, zero on-chain reverts) at every rule and fleet size, so the price rule is
economically free: it redistributes the spread (@tab-price-rules) and the
take-home currency (@tab-net-proceeds) without changing whether or how the trade
lands. Third, confirmed goodput rises with the offered match count — ≈0.22 TPS at
$N = 4$ to ≈0.45 TPS at $N = 8$ — while remaining in the sub-1-TPS,
single-fee-payer regime of §9.2, since all matches in a run share one settlement
fee-payer and the global collector/accumulator write-locks that §9.2 identifies as
the settlement ceiling. The measurement thus reproduces, on the real settlement
path, both the price-invariance of compute and the shared-account throughput bound
established for the OLTP proxy.

To trace the throughput of the settlement path directly, we then swept the fleet
from 80 to 720 prosumer meters (each match pairs two meters, so $N = $ 40–360
matches) at the CDA rule, holding concurrency at 4, and settled every match on the
live validator. We report on-chain throughput as *slot density* — settles landed
per slot times the slot rate (≈2.5 slot·s#super[−1] at the ≈400 ms slot time) —
because it is read from the confirmed transactions' slot numbers and is therefore
immune to the client-side confirmation-poll latency that inflates a naive
wall-clock rate. @tab-fleet-scale reports it alongside the per-settle compute.

#figure(
  caption: [Live settlement throughput versus fleet size (CDA rule, concurrency 4,
    single-node validator). Each match pairs two meters and is one settle
    transaction. Slot density = settles landed per slot; on-chain TPS = slot
    density × 2.5 slot·s#super[−1]. Every settle confirmed (0 reverts) at every
    size; CU is machine-independent.],
  table(
    columns: (auto, auto, auto, auto, auto, auto),
    align: (right, right, center, right, right, right),
    table.header(
      [*Meters*], [*Matches $N$*], [*settled*], [*settles/slot*], [*on-chain TPS*], [*CU/settle*],
    ),
    [80],  [40],  [40/40],   [1.21],  [3.03],  [115,008],
    [160], [80],  [80/80],   [2.05],  [5.13],  [117,258],
    [360], [180], [180/180], [5.29],  [13.24], [115,053],
    [720], [360], [360/360], [10.91], [27.27], [116,366],
  ),
) <tab-fleet-scale>

On-chain throughput scales *linearly* with fleet across the full range: the
settles-per-slot figure rises in near-exact proportion to the match count (≈0.03
settles·slot#super[−1] per match at every size), so the burst occupies a
near-constant span of ≈33–39 slots regardless of $N$ and the validator simply
packs proportionally more settles into each slot — from 1.2 at 80 meters to 10.9
at 720. On-chain throughput therefore climbs from 3.0 to 27.3 settles·s#super[−1]
over a nine-fold fleet increase, with every one of the 660 settlements across the
sweep confirming and none reverting. The shared collector and `treasury_state`
accumulator that every settle write-locks (§9.2) serialise *execution within* a
slot but do not stop the banking stage from co-locating many conflicting settles
in the same slot, so no saturation knee appears in the tested range — the 720-meter
fleet lands at 10.9 settles per slot with 100% success. Compute is flat throughout,
115.0–117.3 k CU across all four sizes — the same ≈115 k CU that is invariant to
both price rule and fleet size — reconfirming that settlement cost is fixed and the
throughput story is entirely one of slot packing, not execution. (The client-side
wall-clock rate is lower and noisier — 2.3–22.9 TPS over the same runs — because it
folds in confirmation-poll latency; the slot-density figure is the machine-level
throughput and the one reported here.)

*Market-mechanism comparison on physically modelled fleets.* Finally, we drove
the three price rules as complete market mechanisms — not merely as settlement
price choices — over four physically modelled fleet datasets produced by the
smart-meter simulator's exporter (the §9.4 pipeline: 80, 160, 380, and 760
meters with 12–114 solar prosumers, 30 days at seed 42, full grid physics,
prosumer grid feed-in capped at 5 kWh/day), against the live validator
(`scripts/run-price-models-onchain.sh`, driver
`scripts/price-models-onchain.ts`). For each fleet the capped tradeable surplus
is offered as four ask-ladder tranches at 3.00/3.15/3.30/3.45 THBC/kWh; the
uniform rule executes on-chain through `clear_auction` (clearing price and
volume read back from the zone market), the CDA rule through
`create_sell_order`/`create_buy_order`/`match_orders` (one `TradeRecord` per
tranche, each priced at its ask), and the buyback baseline pays the flat
2.20 THBC/kWh feed-in rate off-chain. Net proceeds apply the experiment tariff
of @eq-value–@eq-net: market fee 25 bps, loss 5 bps, and a flat wheeling charge
of 1.15 THBC/kWh. An independent verifier
(`scripts/verify-price-models-onchain.ts`) re-reads the chain state and
recomputes every figure — seven checks per fleet, 28/28 green across the four
cases — and the traded volume equals each dataset's capped surplus exactly
(1,734.5, 3,293.3, 7,935.6, and 15,745.8 kWh), confirming the replay consumed
the attested telemetry rather than a synthetic book.

#figure(
  caption: [Seller net proceeds per kWh under each market mechanism, measured
    on-chain across all four physically modelled fleets (30 days, 5 kWh/day
    export cap; experiment tariff $phi_m = 25$ bps, $ell = 5$ bps,
    $w = 1.15$ THBC/kWh). The per-kWh figures are fleet-size invariant because
    the ask ladder and tariff are fixed; only volume scales (9.1-fold across
    the fleets). Artifacts: `test-results/price-models-scale-*.json`.],
  table(
    columns: (auto, auto, auto, auto),
    align: (left, right, right, left),
    table.header([*Mechanism*], [*Gross THBC/kWh*], [*Net THBC/kWh*], [*Pricing*]),
    [Uniform-price epoch], [3.450], [2.290], [marginal ask at max crossing],
    [Buyback (feed-in baseline)], [2.200], [2.200], [flat rate, no P2P charges],
    [CDA on-chain], [3.225 (avg)], [2.065], [each tranche at its own ask],
  ),
) <tab-mechanism-fleets>

The measurement adds one empirical nuance to the analytic ranking of
@tab-net-proceeds: on *gross* proceeds the market rules dominate as before
(uniform 3.45 > CDA 3.225 > buyback 2.20 THBC/kWh), but under this tariff's
flat 1.15 THBC/kWh wheeling charge — which the feed-in baseline does not pay —
the CDA rule's *net* falls below the buyback rate (2.065 < 2.200) while the
uniform rule stays above it (2.290). The ranking *between* market rules is
unaffected (the flat charge shifts every market rule equally, §11.3's
wheeling-sensitivity analysis), but whether P2P trading beats the regulated
feed-in rate net of charges depends directly on the wheeling tariff: the
buyer-favourable CDA rule loses to the baseline once wheeling exceeds the
rule's gross premium over feed-in. Wheeling policy is therefore not a neutral
cost-recovery knob — it sets the participation threshold for the most
buyer-favourable market designs.

*Endogenous demand.* The comparison above prices a fixed ask ladder against
saturating demand, which is what makes its per-kWh outcomes fleet-size
invariant. To let the *fleet itself* move the price, a second driver derives
the demand side from each fleet's own consumption data
(`scripts/price-models-endog.ts`): a fleet's consumers are ranked by horizon
consumption and split into four groups; each group bids quantity
$alpha times$ its total consumption at a willingness-to-pay mapped from its
mean consumption into a stylised 2.60–4.10 THBC/kWh band — a proxy for a
progressive retail tariff, under which heavier consumers face a higher marginal
retail rate and thus a higher avoided cost. Both bid quantities and bid prices
are deterministic functions of the dataset. The uniform rule then runs
on-chain through `clear_auction` over the real (ask $times$ bid) book, and the
CDA rule as one `match_orders` round per fill of a greedy pay-as-ask sweep;
the driver fails unless the on-chain clearing price, cleared volume, and every
`TradeRecord` equal the prediction of the `find_clearing_point` port — all
four fleets verified exactly, including the partial clears
(`test-results/price-models-endog-scale-*.json`).

Two regimes emerge. At a participation share $alpha = 0.02$ demand still
saturates the ladder (the fleets' surplus is only ≈1% of their consumption),
so clearing pins at the top ask and the fixed-ladder figures of
@tab-mechanism-fleets are reproduced. At $alpha = 0.008$ the book only
partially clears and the outcome becomes genuinely fleet-dependent: clearing
falls to 3.30 THBC/kWh on both tested fleets, but the cleared fraction differs
(51.5% of the 80-meter fleet's surplus versus 56.2% of the 760-meter fleet's)
and the CDA net diverges — 1.922 versus 1.941 THBC/kWh — because each fleet's
consumption distribution produces a different fill mix. Under this thin-demand
regime the feed-in baseline (2.200 THBC/kWh on *all* surplus) beats both
market rules on the cleared volume alone: whether P2P trading dominates the
regulated rate depends not only on the wheeling tariff but on demand-side
participation, and the $alpha$ threshold between the regimes is itself a fleet
property. A full $alpha$ sweep with heterogeneous per-prosumer asks is left to
future work.

*Full-lifecycle closure under each price rule.* The mechanism comparison above
exercises the discovery path, which levies no charges (§11.3). To confirm that
each rule also closes the *complete* token lifecycle through the charging
settlement path, we replayed the 7-day fleet dataset
(`scale-80m-12p-s42-7d-cap5`: 53,760 readings, 403.3 kWh capped surplus) three
times on a fresh single-node validator each — once per rule — driving every
stage per prosumer-day: telemetry ingest, registry-CPI GRID mint, escrow
deposit, Ed25519-signed `settle_offchain_match` at the rule's execution price,
and buyer withdraw-and-burn (`scripts/bench-community-month.ts` with
`PRICE_MODEL`). The uniform rule settles every match at the top ask (3.45
THBC/kWh); the CDA rule settles each seller at its own ladder ask (the four
rungs carry 96.1–103.9 kWh each, volume-weighted execution price 3.221); the
buyback baseline has no P2P leg — the seller retires (burns) the minted GRID
directly and the 2.20 THBC/kWh feed-in value is accounted off-chain. Unlike
the off-chain-modelled tariff of @tab-mechanism-fleets, the settlement path
here executes the deployed tariff configuration — market fee 25 bps, flat
wheeling 0.10 THBC/kWh, loss 5 bps (`scripts/bootstrap.ts:311`) — a wheeling
point at which the induced price floor of @eq-price-floor is 0.50 THBC/kWh,
far below the ask band, so every settlement is legal under the 20% cap. One
quantisation effect must be stated to keep the accounting honest: this
harness carries energy in watt-hour-scale units (the §9.4 convention), a
factor $10^6$ below the nominal atomic scale, so the per-match gross value
is only $approx 17$ six-decimal currency units and every charge floor of
@eq-fee–@eq-loss truncates to *zero* — the rounding-topology truncation of
§11.3, taken to its micro-scale extreme. The chain-state audit below
confirms it: all three collector balances are exactly 0 and the sellers
receive the full gross. The net column of @tab-lifecycle-rules therefore
applies the same deployed tariff at the nominal atomic scale (as §11.3
does); at production amounts the floors shave at most one atom per charge
rather than the whole charge.

#figure(
  caption: [Full token lifecycle under each price rule (7-day fleet dataset,
    fresh validator per rule). Conservation is exact in every run: minted =
    settled = retired = 403.319 kWh, zero failures at every stage, and
    53,760/53,760 readings accepted. Net/kWh applies the deployed tariff
    (25 bps + 0.10 THBC/kWh + 5 bps) to the rule's execution price at nominal
    atomic scale (see text: at the harness's watt-hour transport scale the
    charge floors truncate to zero on-chain); buyback pays the feed-in rate
    free of P2P charges. Artifacts:
    `test-results/community-month-80m-12p-*.json`.],
  table(
    columns: (auto, auto, auto, auto, auto),
    align: (left, center, center, right, right),
    table.header(
      [*Price rule*], [*$p^*$ (THBC/kWh)*], [*settles*], [*CU/settle med*],
      [*seller net (THBC/kWh)*],
    ),
    [Uniform-price (top ask)], [3.450], [83/83], [100,545], [3.340],
    [CDA (per-seller ask)], [3.221 (VW)], [83/83], [97,577], [3.111],
    [Buyback (direct retirement)], [2.200], [— (no P2P leg)], [—], [2.200],
  ),
) <tab-lifecycle-rules>

Three facts close the loop. First, the lifecycle is *rule-complete*: all
three mechanisms carry the same 403.319 kWh from attested telemetry to
retirement with exact conservation and zero failed transactions — the price
rule changes only who pays whom how much, never whether the pipeline closes.
The uniform run was additionally re-derived from live chain state through RPC
reads alone (`scripts/audit-lifecycle.ts`, 11/11 assertions): per-meter
reading counters sum to 53,760; order, trade-nullifier, and order-nullifier
counts are 559, 83, and 166; the registry's `settled_net_generation` equals
the minted energy; the GRID supply after burns collapses to the 68
escrow-seed units; and the settlement currency conserves exactly — buyer
escrow outflow 1,369 units equals seller proceeds plus the (zero) collector
balances. The entire sweep was then replicated three times per rule — nine
fresh-validator runs — with bit-identical economics in every run
(conservation, volumes, settle counts, zero failures); the only
run-to-run variance observed anywhere is per-instruction compute jitter
quantised at exactly 1,500 CU, one `create_program_address` bump-search
iteration, arising because each run's randomly generated keypairs require a
different number of bump candidates. Measured compute is therefore
reproducible up to a small integer multiple of the derivation-syscall cost,
and program state is reproducible exactly.
Second, settlement compute remains price-invariant on the real lifecycle
path (97.6–100.5 k CU median), reproducing the @tab-live-settle result
under full mint-escrow-settle-burn load. Third, the two tariff points now
measured bracket the policy question of @eq-price-floor: at $w = 0.10$ both
market rules beat the buyback rate on-chain (3.34 and 3.11 against 2.20)
exactly as they lose to it at the modelled $w = 1.15$
(@tab-mechanism-fleets) — the sign of the P2P premium flips with the
wheeling tariff, and both regimes are now demonstrated end to end rather
than only in accounting.
