# Program Reference Documentation

This directory contains a formal technical document for each on-chain program in the
`gridtokenx-anchor` repository. Each document follows a uniform academic structure
(identity, system role, state model, instruction set, invariants, cross-program
interfaces, events, errors, testing) and cites the source it describes with `path:line`
references. Program IDs are taken from `Anchor.toml [programs.localnet]`; crate versions
from each program's `Cargo.toml`.

## Core programs

| Program | Program ID | Role | Document |
| --- | --- | --- | --- |
| Energy Token | `6FZKcVKCLFSNLMxypFJGU4K14xUBnxNW9VAuKGhmqjGX` | GRID/GRX SPL mints; REC-validator-gated mint/settle | [energy-token.md](energy-token.md) |
| Governance | `FokVuBSPXP11aeL7VZWd8n8aVAhWqVpyPZETToSxdvTS` | PoA authority; ERC-1155-style RECs; aggregator allow-list | [governance.md](governance.md) |
| Oracle | `64Vgos61STZ8pW9NnHi2iGtXMTQr7NqBoMorK6Zg8RJU` | AMI-gateway bridge; per-meter PDAs; 15-min clearing epochs | [oracle.md](oracle.md) |
| Registry | `FcSd5x4X1nzJMKLZC4tMZXnQ1ipLrGsEfeoH8N4mvJX7` | User/meter accounts; 16-shard counter; validator staking bond | [registry.md](registry.md) |
| Trading | `CnWDEUhTvSixeLSyViWgAnnu9YouBAYVGcrrFm1s9WcX` | Order book + CDA; sharded submit; off-chain-signed settlement | [trading.md](trading.md) |
| Treasury | `FfxSQYKUmx9NGdCC9TDPmZSYjWYE1h4ruu3JatzHN5Tn` | GRX↔THBG swap; yield staking; baht settlement accounting | [treasury.md](treasury.md) |

## Benchmark programs

| Program | Program ID | Role | Document |
| --- | --- | --- | --- |
| BlockBench | `9AM4JkvUkK8ZfRneTAQVahFgPe9rEisNkB9byRfZ4TwT` | BlockBench OLTP / SmallBank / YCSB harness | [blockbench.md](blockbench.md) |
| TPC-C Benchmark | `ELv3cWARDqNLgv7A7dochy2CC4Ke9wdgAHvkU3wCwQha` | TPC-C OLTP stress harness | [tpc-benchmark.md](tpc-benchmark.md) |

## Cross-program interface graph

CPI edges (path dependencies with `features = ["cpi"]`) among the core programs:

```
registry  → energy-token   (mint on registration / airdrop)
registry  → treasury        (slash routing: token transfer to reward_vault, not a CPI invoke)
trading   → governance      (authority / policy validation)
trading   → treasury        (record_settlement, non-custodial; mandatory for THBG markets)
oracle    → governance      (validates AggregatorEntry PDA; types + ID only, no CPI invoke)
governance → registry       (mark_erc_claimed; closes ERC double-claim window)
```

## Related top-level references

- `../../SKILL.md` — authoritative deep-dive on program invariants (zero-copy layouts,
  sharding, CPI, compute profiling). Its version numbers and program-ID table are stale;
  treat `Anchor.toml` and each `Cargo.toml` as source of truth.
- `../../ARCHITECTURE.md` — component map for this repository.
- `../../RUNTIME-ARCHITECTURE.md` — runtime / SVM measurement context.
- `../../BENCHMARKS.md` — canonical benchmark results (BlockBench, TPC-C).
