# GridTokenX Anchor Programs

On-chain Solana/[Anchor](https://www.anchor-lang.com/) programs for the **GridTokenX**
P2P energy-trading platform. Six core programs plus two benchmark crates run on a
permissioned PoA Solana cluster (localnet), handling energy tokenization, order-book
trading, oracle/AMI ingestion, governance, a THB-pegged treasury, and the on-chain
registry.

> This repo is a git **submodule** of the `gridtokenx-coresystem` superproject.
> See the superproject for the platform-wide services (Chain Bridge, IAM, Trading
> Service, Aggregator Bridge). All Solana RPC access from off-chain services goes
> through **Chain Bridge** — no service calls the cluster directly.

## Programs

| Program        | Role                                                                                 |
| -------------- | ------------------------------------------------------------------------------------ |
| `energy-token` | Single 9-decimal SPL-2022 mint (1 kWh = 1 GRID; also labeled GRX for its collateral role). REC-validator gated mint/settle. |
| `governance`   | PoA authority, ERC-1155-style Renewable Energy Certificates (RECs), DAO, 2-step authority transfer. |
| `oracle`       | AMI-gateway bridge; per-meter PDA state; 15-minute market-clearing epochs.            |
| `registry`     | User + meter accounts; 16-shard counter; validator staking + registration.           |
| `trading`      | Order book + CDA (Continuous Double Auction); sharded order submit; off-chain-signed match settlement. |
| `treasury`     | GRX↔THBG (THB-pegged stablecoin) swap, GRX yield-staking, baht-denominated settlement accounting. |
| `blockbench`   | BlockBench OLTP / SmallBank benchmark harness.                                        |
| `tpc-benchmark`| TPC-C stress benchmark harness.                                                      |

**Shared crates** (`shared/`): `core` (shared on-chain types/version), `compute-debug`
(feature-gated compute-unit profiling macros).

### CPI graph

```
registry → energy-token          (settle_and_mint_tokens, airdrop)
trading  → governance            (GovernanceConfig operational guard, ErcCertificate)
trading  → treasury              (record_settlement — non-custodial, THBG markets)
oracle   → governance            (AggregatorEntry PDA validation; types/ID only, no CPI invoke)
```

## Layout

There is **no root `Cargo.toml` workspace** — each program in `programs/*` is its own
crate; `Anchor.toml` is the only top-level manifest.

```
Anchor.toml                 # [programs.localnet] declares all 8 program IDs
programs/
├── energy-token/
├── governance/
├── oracle/
├── registry/
├── trading/
├── treasury/
├── blockbench/
└── tpc-benchmark/
shared/
├── core/
└── compute-debug/
scripts/                    # init / simulation scripts (npx tsx)
```

## Build

```bash
anchor build                            # build all programs → target/deploy + target/types
anchor build -- --features localnet     # feature-gated compute profiling
anchor keys sync                        # regenerate program IDs (then update declare_id! in each lib.rs)

npm run lint                            # eslint .
npm run lint:fix
```

### Mainnet simulation (Surfpool — no local validator)

```bash
npm run simnet      # surfpool start --network mainnet --watch --legacy-anchor-compatibility
npm run simnet:ci   # headless / CI mode
```

## Init / simulation

`scripts/*.ts` run via `npx tsx` against a live validator. Order matters:

```
bootstrap.ts → init-registry.ts → init-oracle.ts → init-market.ts
             → init-governance.ts → init-rec-mint.ts → init-treasury.ts
             → init-zone-config.ts   (also: anchor run init-zone-config)
```

## Toolchain

- `anchor-lang` / `anchor-spl` = **1.0.0**; `mpl-token-metadata` = `5.1.2-alpha.2`.
- TS client/tests import from **`@anchor-lang/core`** (not `@coral-xyz/anchor`).
- Anchor CLI version is not pinned in-repo (`Anchor.toml [toolchain]` empty) — match the
  CLI to the 1.0.0 on-chain crate.
- Package manager: `pnpm@9.15.4`.

> **macOS Apple Silicon**: `solana-test-validator` panics under load ("Too many open
> files"). Run `ulimit -n 65536` before launching (the superproject `scripts/app.sh`
> handles this automatically).

## Key invariants

Full detail in [`SKILL.md`](SKILL.md); architecture in [`ARCHITECTURE.md`](ARCHITECTURE.md).

1. **Zero-copy state.** Every state struct is `#[account(zero_copy)] #[repr(C)]` + Pod with
   manual `_paddingN` alignment. Use `AccountLoader` + `load()/load_mut()/load_init()`.
2. **No `String` in zero-copy** — use `[u8; N]` + `*_len: u8`; convert via
   `string_to_bytes32` / `bytes32_to_string`.
3. **Sealevel parallelism.** Hot-path writes go to per-entity PDAs (`MeterState`, `Order`,
   `*Shard`), never global config accounts. Global totals are stale on purpose; reconcile
   via periodic admin instructions (`aggregate_readings`, `aggregate_shards`).
4. **`compute-debug` feature** wraps handler bodies in `compute_fn!` (no-op in release).
5. **`overflow-checks = true`** in every program's `[profile.release]` — cargo build-sbf
   defaults off; still prefer `checked_*` / `saturating_*` explicitly.
6. Changing a program ID requires `anchor keys sync` **and** updating `declare_id!`.

## Documentation

- [`SKILL.md`](SKILL.md) — authoritative deep-dive on program invariants (zero-copy layouts,
  sharding, CPI, compute profiling).
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — component map for this repo.
- [`RUNTIME-ARCHITECTURE.md`](RUNTIME-ARCHITECTURE.md) — runtime / SVM measurement context.
- [`BENCHMARKS.md`](BENCHMARKS.md) — canonical benchmark results.
- `docs/diagrams/README.md` — Solana-internals learning path (mermaid explainers).

## License

[MIT](LICENSE) © 2026 WIT @GridTokenX
