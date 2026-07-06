# Oracle Meter-Telemetry Scaling Benchmark (80 → 100,000 meters)

Real `solana-test-validator` (localnet, single node), oracle `submit_meter_reading`.
Each meter = its own `MeterState` PDA (Sealevel-disjoint writes). Epoch 1 = PDA init,
epoch ≥2 = steady-state write. Single gateway fee-payer is write-locked every tx →
the throughput ceiling is that shared payer + single-node banking, not per-meter contention.

**Two client harnesses** (same on-chain path; transport changes throughput, never CU):
- ≤10k: per-tx `.rpc()` websocket confirm, 300-in-flight pool.
- ≥50k: locally pre-signed raw sends + bulk `getSignatureStatuses` polling (1.5s sweep,
  3,000-tx in-flight window) — the per-tx confirm transport collapses beyond ~10k pending,
  so large-N latency is poll-quantised (±1.5s) and TPS reflects the better transport.

## Success / loss
| N meters | total tx | confirmed | loss % | harness |
|---------:|---------:|----------:|-------:|:--------|
| 80 | 400 | 400 | 0 | rpc-pool |
| 1,000 | 2,000 | 1,992 | 0.4 | rpc-pool |
| 5,000 | 10,000 | 9,952 | 0.48 | rpc-pool |
| 10,000 | 20,000 | 19,908 | 0.46 | rpc-pool |
| 50,000 | 100,000 | 99,261 | 0.739 | raw-send |
| 100,000 | 200,000 | 198,383 | 0.808 | raw-send |

## Compute units per `submit_meter_reading` (scale-invariant)
| N meters | init CU min | init CU med | steady CU min | steady CU med | steady CU max |
|---------:|------------:|------------:|--------------:|--------------:|--------------:|
| 80 | 16,088 | 16,088 | 13,468 | 13,468 | 20,968 |
| 1,000 | 16,145 | 17,645 | 13,525 | 15,025 | 28,525 |
| 5,000 | 16,145 | 17,645 | 13,525 | 15,025 | 22,525 |
| 10,000 | 16,180 | 17,680 | 13,560 | 15,060 | 22,560 |
| 50,000 | 16,254 | 17,754 | 13,634 | 13,634 | 22,634 |
| 100,000 | 16,254 | 17,754 | 13,634 | 15,134 | 24,134 |

> Steady-state base write path (`CU min`) holds 13.5–13.6k CU across a **1,250×** meter-count
> range (13,468 at N=80 → 13,634 at N=50k/100k) — per-meter cost is O(1) in fleet size. The
> small drift tracks meter-id byte length (longer id = more seed/copy bytes), not N itself.
> `CU med/max` vary only with the reading values (anomaly production/consumption-ratio branch).
> 100k CU values re-probed post-run (rotating ledger pruned in-run history; see that run's md).

## Throughput & latency (steady-state, single-node localnet)
| N meters | TPS mean | lat p50 (ms) | lat p95 (ms) | lat max (ms) |
|---------:|---------:|-------------:|-------------:|-------------:|
| 80 | 135.14 | 659 | 859 | 861 |
| 1,000 | 119.52 | 1334 | 1440 | 4809 |
| 5,000 | 188.41 | 1356 | 1781 | 5058 |
| 10,000 | 216.93 | 1214 | 1548 | 14971 |
| 50,000 | 358.65 | 1749 | 2565 | 2886 |
| 100,000 | 328.94 | 1944 | 2869 | 4196 |

> TPS is transport+node bound, not N bound: ~120–220 on the per-tx-confirm harness, ~330–360
> on the raw-send harness — flat within each harness while N grows 2× (50k→100k). Loss stays
> < 0.9% at 100,000 concurrent meters (0.74% @50k, 0.81% @100k); p95 latency ~2.6–2.9s under
> the 3,000-tx window. Converting disjoint per-meter PDAs into proportional throughput needs
> multi-gateway fee-payer pooling + multi-node — the flat CU shows the on-chain write is
> already scale-free.
