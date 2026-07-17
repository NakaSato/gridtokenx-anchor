# Centralized-Postgres Baseline (blockchain-tax reference)

A trusted single-RDBMS mirror of the on-chain trading hot paths, used as the
centralized upper bound in the paper's baseline comparison (gap #2). It performs
the same **logical** work as the Solana/Anchor settlement layer — order entry and
atomic off-chain-match settlement bookkeeping — with **no consensus, no signature
verification, no PDA rent**. The TPS gap to the on-chain figures is the cost of
decentralization for the same operation.

## What it mirrors

| On-chain path | Baseline analog (`schema.sql`) |
|---|---|
| `create_buy_order` (new Order PDA) | `order_entry.sql` — one INSERT into `baseline.orders` |
| `settle_offchain_match` (escrow debit/credit + fee/wheeling/loss collectors + TradeRecord + nullifier) | `settle_match.sql` — one atomic txn: nullifier PK-guard insert, buyer debit, seller net credit, three collector-row credits, trade insert |

The three collector UPDATEs hit the **same rows every transaction**, so the
baseline reproduces the on-chain global-write contention (the fee/wheeling/loss
collectors that serialize settlement) — here via cheap MVCC row locks rather than
account-write serialization. This is deliberate: it isolates the ratio to the
consensus + cryptography cost, not an unfair "the DB has no contention" advantage.

Tariff constants match the paper (1 kWh @ 4.00, 25 bps fee, 5 bps loss, 1.15/kWh
wheeling), so per-transaction work is identical to the on-chain settle.

## Run

Requires the `gridtokenx-postgres` container up (`just db-up` / `just orb-up`).

```bash
bash baselines/postgres/run.sh                 # defaults: 1000 accounts, conc 1..32, 8s/level
NACC=1000 CONC="1 4 8 16 32" DUR=8 bash baselines/postgres/run.sh
```

Uses `pgbench` inside the container via `docker exec`. Objects live in schema
`baseline` (dropped + rebuilt each run) inside the dev `gridtokenx` DB.

## Representative result (Apple M2, PG 17.10)

| workload | peak TPS | shape |
|---|---|---|
| order-entry (INSERT) | ~33k (5.9k–54k) | scales with concurrency |
| settle-match (atomic) | ~1.4k @ conc 4 | **declines** past conc 4 (collector-row contention; latency 8→30 ms) |

**Blockchain tax** vs the on-chain λ-ramp / settle sweep (same host):
order entry ≈ 20–30× (33k vs 1600 TPS); settlement ≈ 1400–2000× (1.4k vs ~1 TPS).
Both systems show the collector contention; consensus + Ed25519 verify + token CPI
account for the settlement multiplier. Numbers vary run-to-run with host load.
