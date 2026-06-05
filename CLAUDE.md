# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> This repo is a git **submodule** of the `gridtokenx-coresystem` superproject. It holds the **on-chain Solana/Anchor programs**. See the superproject `../CLAUDE.md` for the platform-wide rules (services, gateways, "Sync Core, Async Edges", Chain Bridge as the only Solana RPC client).

---

## Deep references (read before non-trivial edits)

- **`anchor-SKILL.md`** — the authoritative deep-dive on program invariants (zero-copy layouts, sharding, CPI, compute profiling). **Caveat: its version numbers and program-ID table are stale.** Always treat `Anchor.toml` (program IDs) and each program's `Cargo.toml` (crate versions) as source of truth.
- **`docs/`** — VitePress site. Per-program docs in `docs/programs/` (`oracle.md`, `registry.md`, `trading.md`, `governance.md`, `energy-token.md`), protocol math in `docs/equations.md`, clearing/settlement in `docs/programs/auction-clearing.md` + `transaction-settlement.md`. Serve with `npm run docs:dev`.

---

## Build & Test

There is **no root `Cargo.toml` workspace** — each program in `programs/*` is its own crate, plus shared crates in `shared/`. Anchor drives the build via `Anchor.toml`.

```bash
anchor build                      # build all 5 programs to target/deploy + target/types
anchor test                       # build, spin up local validator, deploy, run mocha suite
anchor keys sync                  # regenerate program IDs (then update declare_id! in each lib.rs)

# Per-suite (each spins its own validator via anchor test):
npm run test:oracle               # tests/oracle.ts
npm run test:registry             # tests/registry_sharding.ts
npm run test:governance           # tests/governance.ts
npm run test:blockbench           # tests/blockbench.ts  (BlockBench OLTP benchmark)
npm run test:smallbank            # tests/smallbank.ts
npm run test:tpc-stress           # tests/tpc_stress_test.ts  (TPC-C, needs tpc_benchmark .so)
npm run test:all                  # oracle+registry+governance+blockbench+smallbank+tpc

# Raw mocha (validator must already be running — Anchor.toml [scripts] test):
npx mocha -r tsx 'tests/**/*.ts' --timeout 1000000
npx mocha -r tsx tests/oracle.ts --timeout 1000000   # single file

./scripts/run-tests.sh --suite oracle                # standalone/CI runner, flags: --skip-build --skip-deploy --suite

npm run lint        # eslint .
npm run lint:fix
```

### Mainnet simulation (Surfpool — no local validator)

```bash
npm run simnet      # surfpool start --network mainnet --watch --legacy-anchor-compatibility
npm run simnet:ci   # --ci (headless, fast)
```

### Init / simulation scripts (run against a live validator)

`scripts/*.ts` run via `npx tsx`. Order matters: `bootstrap.ts` then `init-registry.ts` → `init-oracle.ts` → `init-market.ts` → `init-governance.ts` → `init-zone-config.ts` (also `npm exec` via `anchor run init-zone-config`). Lifecycle/load sims: `simulate-trading.ts`, `simulate-market-clearing.ts`, `simulate-meter-stream.ts`, `simulate-token-lifecycle.ts`, `execute-settlement.ts`.

---

## Architecture

Five Anchor programs forming a P2P energy-trading platform on a **permissioned PoA** Solana cluster (localnet). Program IDs live in `Anchor.toml [programs.localnet]`.

```
programs/
├── energy-token/   GRID (1 kWh = 1 GRID) + GRX SPL mints; REC-validator gated mint/settle
├── governance/     PoA authority (handlers/: authority, config, dao, erc, stats); ERC-1155-style RECs; 2-step authority transfer
├── oracle/         AMI-gateway bridge; per-meter PDA state; 15-min market-clearing epochs
├── registry/       user + meter accounts; 16-shard counter; staking + validator registration
└── trading/        order book + CDA; sharded order submit; off-chain-signed match settlement (settle_offchain.rs)
shared/
├── core/           shared on-chain types/version
└── compute-debug/  compute-unit profiling macros (feature-gated)
```

**CPI graph** (path deps, `features = ["cpi"]`): `registry → energy-token`, `trading → governance`.

Crate versions: `anchor-lang` / `anchor-spl` = **1.0.0** (not the 0.30.x the SKILL file mentions). TS tests import from **`@anchor-lang/core`** (not `@coral-xyz/anchor`).

### Load-bearing invariants (summary — full detail in `anchor-SKILL.md`)

1. **Zero-copy state.** Every `state.rs` struct is `#[account(zero_copy)] #[repr(C)]` + Pod, with manual `_paddingN: [u8; N]` for alignment. Use `AccountLoader` + `load()/load_mut()/load_init()`. Recount padding by hand when adding fields. Space = `8 + size_of::<T>()` (zero-copy) or manual `T::LEN` (regular `#[account]`).
2. **No `String` in zero-copy.** Use `[u8; N]` + `*_len: u8`; convert via `registry::string_to_bytes32` / `bytes32_to_string`; rehydrate events with `String::from_utf8_lossy(&b[..len]).into_owned()`.
3. **Sealevel parallelism.** Hot-path writes (meter readings, trades) go to **per-entity PDAs** (`MeterState`, `Order`, `OrderNullifier`, `*Shard`), never to global config accounts (read-only on hot paths). Global totals are **stale on purpose**; reconcile via periodic admin instructions (`aggregate_readings`, `aggregate_shards`). Shard select: `authority.to_bytes()[0] % num_shards` (16 in registry).
4. **`compute-debug` feature.** Each handler wraps its body in `compute_fn!("label" => { ... })`; no-op in release. Preserve when adding instructions (CU profiling vs 200k default / 1.4M max budget).
5. **Hoist `Clock::get()` before `emit!`** — `let now = Clock::get()?.unix_timestamp;` then emit. Avoids a sysvar syscall inside macro expansion.
6. Changing a program ID requires `anchor keys sync` **and** updating `declare_id!` in that program's `lib.rs`.
