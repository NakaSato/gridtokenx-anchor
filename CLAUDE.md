# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> This repo is a git **submodule** of the `gridtokenx-coresystem` superproject. It holds the **on-chain Solana/Anchor programs**. See the superproject `../CLAUDE.md` for the platform-wide rules (services, gateways, "Sync Core, Async Edges", Chain Bridge as the only Solana RPC client).

---

## Deep references (read before non-trivial edits)

- **`SKILL.md`** — the authoritative deep-dive on program invariants (zero-copy layouts, sharding, CPI, compute profiling). **Caveat: its version numbers and program-ID table are stale.** Always treat `Anchor.toml` (program IDs) and each program's `Cargo.toml` (crate versions) as source of truth.
- **`ARCHITECTURE.md`** — component map for this repo; **`RUNTIME-ARCHITECTURE.md`** — runtime/SVM measurement context; **`BENCHMARKS.md`** — canonical benchmark results. (The former `docs/` VitePress site was removed; `npm run docs:dev` no longer has a target.)

---

## Build & Test

There is **no root `Cargo.toml` workspace** — each program in `programs/*` is its own crate, plus shared crates in `shared/`. Anchor drives the build via `Anchor.toml`.

```bash
anchor build                      # build all programs (Anchor 1.0 emits programs/<p>/target/deploy/<p>.so;
                                  #   copy to root target/deploy/ for scripts/run-tests.sh — see SKILL.md gotcha #1)
anchor test                       # build, spin up validator, deploy, run mocha suite
                                  #   NOTE: Anchor 1.0 spawns `surfpool` as the test validator — if it's not
                                  #   installed, use ./scripts/run-tests.sh (solana-test-validator) instead
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

# In-process litesvm suites (no validator): guard tests + CU profiles.
npm run test:litesvm        # every tests/*_litesvm.ts  (auto-stages fresh .so via pretest hook)
npm run test:cu-profile     # tests/cu_profile_*_litesvm.ts (each asserts < 200k CU)
npm run build:programs      # cargo build-sbf every program, then stage into target/deploy
npm run stage:programs      # copy programs/*/target/deploy/*.so -> target/deploy (newest wins)
# The litesvm suites load target/deploy/<p>.so; Anchor 1.0 emits per-program binaries under
# programs/<p>/target/deploy, so a stale root copy makes tests run the WRONG binary. The
# stage script (scripts/stage-programs.sh, also a CI step) keeps root current; `--check`
# fails if drift exists. Rebuild + restage after editing a program: `npm run build:programs`.

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

**Five core** Anchor programs forming a P2P energy-trading platform on a **permissioned PoA** Solana cluster (localnet), plus **two benchmark crates** (`blockbench`, `tpc-benchmark`). All 7 program IDs live in `Anchor.toml [programs.localnet]`.

```
programs/
├── energy-token/   single 9-dec SPL mint (1 kWh = 1 GRID; source also labels it GRX for its utility/collateral role — one mint, not two; treasury consumes it as grx_mint); REC-validator gated mint/settle
├── governance/     PoA authority (handlers/: authority, config, dao, erc, stats); ERC-1155-style RECs; 2-step authority transfer
├── oracle/         AMI-gateway bridge; per-meter PDA state; 15-min market-clearing epochs
├── registry/       user + meter accounts; 16-shard counter; staking + validator registration
├── trading/        order book + CDA; sharded order submit; off-chain-signed match settlement (settle_offchain.rs)
├── treasury/      GRX↔THBG (THB-pegged stablecoin) swap, GRX staking, baht-denominated settlement accounting
├── blockbench/     benchmark harness (BlockBench OLTP/smallbank — npm run test:blockbench / test:smallbank)
└── tpc-benchmark/  benchmark harness (TPC-C stress — npm run test:tpc-stress)
shared/
├── core/           shared on-chain types/version
└── compute-debug/  compute-unit profiling macros (feature-gated)
```

**CPI graph** (path deps, `features = ["cpi"]`): `registry → energy-token`, `trading → governance`, `trading → treasury` (optional `record_settlement` — non-custodial; fires only when treasury accounts are passed to `settle_offchain_match`), `oracle → governance` (types + ID only, no CPI invoke — validates an admitted aggregator's `AggregatorEntry` PDA to authorize node-facing oracle instructions).

### Treasury program

- **Token:** THBG = THB-pegged stablecoin, 6 decimals, mint authority = treasury PDA (`[b"treasury"]`).
- **Swap** (`swap_grx_for_thbg`): the baht-settlement primitive. `thbg_out = grx_in × grx_per_thbg_rate / 1e9 − fee`. Peg invariants: (1) reserve attestation fresh (`now − attestation_ts ≤ attestation_ttl`); (2) `thbg_supply + minted ≤ attested_reserve`. Custodian refreshes the reserve via `update_attestation`.
- **Redeem** (`redeem_thbg_for_grx`): burns THBG, returns GRX from `swap_vault` at the current rate. Collateral guards: `thbg_in ≤ thbg_supply` (`SupplyUnderflow`) and `grx_out ≤ swap_vault.amount` (`InsufficientVault`) — a rate change via `set_params` can never let a redeemer drain more GRX than the vault holds.
- **Staking** (`stake_grx`/`unstake_grx`/`claim_rewards`/`fund_rewards`): MasterChef accumulator (`acc_reward_per_share`, ×1e12); rewards paid in GRX from `reward_pool`. **Staked GRX lives in its own vault and never backs the peg.**
- **Two GRX staking systems, on purpose — don't merge them.** Treasury staking here is **yield staking**: opt-in, reward-bearing (funded by swap fees via `fund_rewards`), vault `[b"stake_vault"]`, tracked on `StakePosition`. Registry staking (`registry::stake_grx`) is a **validator security bond**: no yield, gated by `MIN_VALIDATOR_STAKE`, slashed for validator misbehavior, vault `[b"grx_vault"]`, tracked on `UserAccount.staked_grx`. Same lock/unlock/slash *plumbing*, different *products* — a user may hold both. They share no vault or position account and are not reconciled.
- **Three GRX vaults** (separate PDAs): `swap_vault` (redemption collateral), `stake_vault` (staker custody), `reward_vault` (reward pool).
- **`record_settlement`**: non-custodial CPI from trading; bumps `total_settled_thbg` by the GROSS settled value (reconciles to THBG leaving buyer escrow), authorized by the `settlement_recorder` signer (= trading `market_authority` PDA). Wired into **both** `settle_offchain_match` and `batch_settle_offchain_match` (batch records the whole batch with one CPI). **Recording is mandatory for THBG markets:** once `trading::set_settlement_thbg_mint` is set on a Market, any match in that currency that omits the treasury accounts is rejected (`TreasurySettlementRequired`) — no silent skip. `init-treasury.ts` sets this policy. Init via `scripts/init-treasury.ts`; test `tests/treasury.ts` (`npm run test:treasury`).
- **Slash redistribution (registry → treasury):** registry's `slash_validator` sends slashed bonds to a configured `slash_destination` — point it at the treasury `reward_vault` (wired by `init-treasury.ts` via `registry::set_slash_destination`). The registry refuses to slash until the destination is set, only slashes accounts whose `validator_status == Active`, and only sends to the configured destination — no misroute. It's a token transfer, not a CPI into treasury; redistribute to stakers afterward via `fund_rewards`.

Crate versions: `anchor-lang` / `anchor-spl` = **1.0.0** (not the 0.30.x the SKILL file mentions). TS tests import from **`@anchor-lang/core`** (not `@coral-xyz/anchor`).

### Load-bearing invariants (summary — full detail in `SKILL.md`)

1. **Zero-copy state.** Every `state.rs` struct is `#[account(zero_copy)] #[repr(C)]` + Pod, with manual `_paddingN: [u8; N]` for alignment. Use `AccountLoader` + `load()/load_mut()/load_init()`. Recount padding by hand when adding fields. Space = `8 + size_of::<T>()` (zero-copy) or manual `T::LEN` (regular `#[account]`).
2. **No `String` in zero-copy.** Use `[u8; N]` + `*_len: u8`; convert via `registry::string_to_bytes32` / `bytes32_to_string`; rehydrate events with `String::from_utf8_lossy(&b[..len]).into_owned()`.
3. **Sealevel parallelism.** Hot-path writes (meter readings, trades) go to **per-entity PDAs** (`MeterState`, `Order`, `OrderNullifier`, `*Shard`), never to global config accounts (read-only on hot paths). Global totals are **stale on purpose**; reconcile via periodic admin instructions (`aggregate_readings`, `aggregate_shards`). Shard select: `authority.to_bytes()[0] % num_shards` (16 in registry).
4. **`compute-debug` feature.** Each handler wraps its body in `compute_fn!("label" => { ... })`; no-op in release. Preserve when adding instructions (CU profiling vs 200k default / 1.4M max budget).
5. **Hoist `Clock::get()` before `emit!`** — `let now = Clock::get()?.unix_timestamp;` then emit. Avoids a sysvar syscall inside macro expansion.
6. Changing a program ID requires `anchor keys sync` **and** updating `declare_id!` in that program's `lib.rs`.
7. **Every program's `Cargo.toml` sets `[profile.release] overflow-checks = true`** (cargo build-sbf defaults to off → silent wrapping). New programs must include the same block; still prefer `checked_*`/`saturating_*` explicitly.

## Search Tooling

> **Use `rg` (ripgrep), never `grep`.** When shelling out to search files, run `rg` —
> it respects `.gitignore`, skips binaries, and is far faster than `grep`/`find -exec grep`.
> Reserve plain `grep` only for piping non-file streams.
