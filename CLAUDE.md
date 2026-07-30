# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> This repo is a git **submodule** of the `gridtokenx-coresystem` superproject. It holds the **on-chain Solana/Anchor programs**. See the superproject `../CLAUDE.md` for the platform-wide rules (services, gateways, "Sync Core, Async Edges", Chain Bridge as the only Solana RPC client).

---

## Deep references (read before non-trivial edits)

- **`SKILL.md`** — the authoritative deep-dive on program invariants (zero-copy layouts, sharding, CPI, compute profiling). **Caveat: its version numbers and program-ID table are stale.** Always treat `Anchor.toml` (program IDs) and each program's `Cargo.toml` (crate versions) as source of truth.
- **`ARCHITECTURE.md`** — component map for this repo; **`RUNTIME-ARCHITECTURE.md`** — runtime/SVM measurement context; **`BENCHMARKS.md`** — canonical benchmark results. (The former `docs/` VitePress site was removed; `npm run docs:dev` no longer has a target.)
- **`docs/diagrams/README.md`** — Solana-internals learning path (21 explainers, mermaid): PoH → slot/leader → PDA → Sealevel → CPI, then repo-specific (zero-copy, off-chain settlement, sharding, BPF stack) and domain (Token-2022, treasury peg, oracle epochs, registry slash). Concept-level, fact-checked against source.

---

## Build & Test

There is **no root `Cargo.toml` workspace** — each program in `programs/*` is its own crate, plus shared crates in `shared/`. Anchor drives the build via `Anchor.toml`.

```bash
anchor build                      # build all programs (Anchor 1.0 emits programs/<p>/target/deploy/<p>.so;
                                  #   copy to root target/deploy/ for the litesvm suites — see SKILL.md gotcha #1)
anchor test                       # build, spin up validator, deploy, run mocha suite
                                  #   NOTE: Anchor 1.0 spawns `surfpool` as the test validator — if it's not
                                  #   installed, start a local solana-test-validator yourself and run the raw
                                  #   mocha suite (below)
anchor keys sync                  # regenerate program IDs (then update declare_id! in each lib.rs)

# NOTE: there are NO `npm run test:*` scripts (the old per-suite recipes and their
# tests/*.ts files were removed in b2021fb). tests/ now holds exactly:
#   7 in-process litesvm suites + batch_settle_tps.ts (validator-gated TPS sweep).
# The lib-level price-model unit suite lives at scripts/lib/price-model-tariff.test.ts.

# In-process litesvm suites (no validator needed) — run directly with mocha:
npx mocha -r tsx tests/price_models_litesvm.ts tests/rec_gate_litesvm.ts tests/sharded_match_litesvm.ts tests/registry_hardening_litesvm.ts tests/erc_owner_gate_litesvm.ts tests/issue_erc_precheck_litesvm.ts tests/treasury_thbc_litesvm.ts --timeout 1000000

# Validator-gated (start solana-test-validator + deploy + init first):
npx mocha -r tsx tests/batch_settle_tps.ts --timeout 1000000

# Price-model core unit tests (validator-free, uses the committed physics dataset):
npx mocha -r tsx scripts/lib/price-model-tariff.test.ts --timeout 60000
# The litesvm suites load target/deploy/<p>.so; Anchor 1.0 emits per-program binaries under
# programs/<p>/target/deploy, so a stale root copy makes tests run the WRONG binary — after
# editing a program, rebuild (cargo build-sbf) and copy the fresh .so into root target/deploy
# (see SKILL.md gotcha #1).

npm run lint        # eslint .
npm run lint:fix
```

### Mainnet simulation (Surfpool — no local validator)

```bash
npm run simnet      # surfpool start --network mainnet --watch --legacy-anchor-compatibility
npm run simnet:ci   # --ci (headless, fast)
```

### Init / simulation scripts (run against a live validator)

`scripts/*.ts` run via `npx tsx`. Order matters: `bootstrap.ts` then `init-registry.ts` → `init-oracle.ts` → `init-market.ts` → `init-governance.ts` → `init-rec-mint.ts` (fungible REC mint, after governance) → `init-zone-config.ts` (also `npm exec` via `anchor run init-zone-config`).

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
├── treasury/      GRX↔THBC (THB-referenced) inventory exchange, GRX staking, baht-denominated settlement accounting
├── blockbench/     benchmark harness (BlockBench OLTP/smallbank — driver suites removed in b2021fb; results in BENCHMARKS.md)
└── tpc-benchmark/  benchmark harness (TPC-C stress — driver suite removed in b2021fb; results in BENCHMARKS.md)
shared/
├── core/           shared on-chain types/version
└── compute-debug/  compute-unit profiling macros (feature-gated)
```

**CPI graph** (path deps, `features = ["cpi"]`): `registry → energy-token`, `trading → governance`, `trading → treasury` (optional `record_settlement` — non-custodial; fires only when treasury accounts are passed to `settle_offchain_match`), `oracle → governance` (types + ID only, no CPI invoke — validates an admitted aggregator's `AggregatorEntry` PDA to authorize node-facing oracle instructions).

### Treasury program

- **Token:** THBC = THB-pegged stablecoin, 6 decimals, mint authority = treasury PDA (`[b"treasury"]`).
- **Exchange** (`exchange_grx_for_thbc` / `exchange_thbc_for_grx`) — **inventory transfers, NOT mint/burn.** Replaced `swap_grx_for_thbc` / `redeem_thbc_for_grx` to satisfy F6 (`docs/product-specs/THBC_ISSUER_SERVICE.md` §7 in the superproject). Pricing is unchanged: `thbc_out = grx_in × grx_per_thbc_rate / 1e9 − fee`. What changed is where the tokens come from — a `[b"thbc_inventory"]` vault (created by `initialize_thbc_inventory`, bump stored in the byte carved out of `Treasury._padding`, so the account is still 272 bytes and needed **no** migration). Bounded by `inventory_vault.amount` (`InsufficientInventory`), not by reserve headroom. `thbc_supply` and `attested_reserve` are untouched, so a volatile asset never enters the backing set of a fiat-referenced token. The attestation-freshness check is deliberately absent from this path: F5 guards *issuance*, and exchange issues nothing. The reverse direction returns THBC to inventory instead of burning it, drops the old `SupplyUnderflow` guard (nothing to underflow), and now charges the same `swap_fee_bps` spread the forward direction does. The `swap_vault` drain guard (`InsufficientVault`) is kept.
- **Issuance** (`issue_thbc(amount, bank_ref_hash)`) — the on-ramp, spec §5, and the **only** instruction that increases `thbc_supply`. It is therefore the only place F1 and F5 are enforced: attestation freshness is checked FIRST (a stale `attested_reserve` makes the F1 comparison meaningless, not merely conservative), then `thbc_supply + amount <= attested_reserve`. Future-dated attestations are rejected so clock skew cannot buy freshness. **F3** comes with it: `[b"deposit", H(bank_ref)]` is created with Anchor `init` in the SAME instruction as the mint, so a replayed bank webhook is rejected by the runtime at the account level, and the mint and the nullifier either both happen or neither does. Gated on `Treasury.authority` — a dedicated `issuer` Pubkey does not fit the remaining padding, so the parameter admin and the issuer are conflated; disclosed, and the first thing the next layout change should fix.
- **Redemption** (`redeem_thbc_for_fiat` / `confirm_redemption` / `reclaim_redemption`) — **F7**, the Δ-timelocked escrow. `redeem_thbc_for_fiat` is USER-signed and moves THBC into `[b"redeem_escrow"]` **without burning**, so it stays inside `thbc_supply` and remains recoverable. `confirm_redemption` (issuer) burns — the only place supply falls. `reclaim_redemption` (user) returns the tokens after Δ. Both terminal instructions **`close`** the record, so double-confirm and confirm-after-reclaim fail at the account level; the live `[b"redeem", user, seq]` accounts ARE the pending queue, which makes `redemption_queue_len` derivable rather than stored. Δ is a constant (`REDEMPTION_DELTA_SECS`, 24h) frozen per-record, so changing it cannot extend an in-flight holder's wait. Reclaim is deliberately **not** gated on `paused`: pausing must never trap a holder's tokens.
- **Staking** (`stake_grx`/`unstake_grx`/`claim_rewards`/`fund_rewards`): MasterChef accumulator (`acc_reward_per_share`, ×1e12); rewards paid in GRX from `reward_pool`. **Staked GRX lives in its own vault and never backs the peg.**
- **Two GRX staking systems, on purpose — don't merge them.** Treasury staking here is **yield staking**: opt-in, reward-bearing, funded **manually** via `fund_rewards` (a funder deposits GRX directly into `reward_vault` — this is independent of the exchange fee, which since the F6 fix is simply THBC that stays behind in `thbc_inventory` rather than THBC that was never minted, and is not auto-routed into `reward_vault`), vault `[b"stake_vault"]`, tracked on `StakePosition`. Registry staking (`registry::stake_grx`) is a **validator security bond**: no yield, gated by `MIN_VALIDATOR_STAKE`, slashed for validator misbehavior, vault `[b"grx_vault"]`, tracked on `UserAccount.staked_grx`. Same lock/unlock/slash *plumbing*, different *products* — a user may hold both. They share no vault or position account and are not reconciled.
- **Four GRX vaults** (separate PDAs): `swap_vault` (exchange collateral), `stake_vault` (staker custody), `reward_vault` (staker reward pool), `rebate_vault` (regulator / consumer-rebate pool — role-map.md fix #10, created via `initialize_rebate_vault`). Plus one **THBC** vault: `thbc_inventory` (platform-held THBC the exchange path pays out of, created via `initialize_thbc_inventory`). Its *balance* is the inventory — there is deliberately no mirrored `thbc_inventory: u64` counter to drift from it.
- **`record_settlement`**: non-custodial CPI from trading; bumps `total_settled_thbc` by the GROSS settled value (reconciles to THBC leaving buyer escrow), authorized by the `settlement_recorder` signer (= trading `market_authority` PDA). Wired into **both** `settle_offchain_match` and `batch_settle_offchain_match` (batch records the whole batch with one CPI). **Recording is mandatory for THBC markets:** once `trading::set_settlement_thbc_mint` is set on a Market, any match in that currency that omits the treasury accounts is rejected (`TreasurySettlementRequired`) — no silent skip. `init-treasury.ts` sets this policy. Init via `scripts/init-treasury.ts`. Invariant coverage: **`tests/treasury_thbc_litesvm.ts`** (23 cases, in-process, no validator) pins F1/F3/F5/F6/F7 against the compiled program — including F3's replay revert, which is a property of Anchor `init` on the nullifier PDA and can only be shown on an SVM, and F5's TTL halt via `svm.setClock`. Mutation-checked twice: deleting the F5 guard kills exactly the three F5 cases, and deleting the F7 timelock kills exactly the Δ-boundary case. Plus the Crucible fuzz harness at `fuzz/treasury/` (`cargo run --locked` there; its own standalone workspace, and its `idls/treasury.json` currently matches the program's 23 instructions exactly), and `tests/batch_settle_tps.ts` for the `record_settlement` CPI.
- **Slash redistribution (registry → treasury):** registry's `slash_validator` sends slashed bonds to a configured `slash_destination` — pointed at the treasury `rebate_vault`, not `reward_vault` (wired by `init-treasury.ts` via `registry::set_slash_destination`) — a slashed bond is a penalty for the harmed side / regulator, not yield for stakers, so it stays out of `fund_rewards`. The registry refuses to slash until the destination is set, only slashes accounts whose `validator_status == Active`, and only sends to the configured destination — no misroute. It's a token transfer, not a CPI into treasury.

Crate versions: `anchor-lang` / `anchor-spl` = **1.0.0** (not the 0.30.x the SKILL file mentions). TS tests import from **`@anchor-lang/core`** (not `@coral-xyz/anchor`).

### Load-bearing invariants (summary — full detail in `SKILL.md`)

1. **Zero-copy state.** Every `state.rs` struct is `#[account(zero_copy)] #[repr(C)]` + Pod, with manual `_paddingN: [u8; N]` for alignment. Use `AccountLoader` + `load()/load_mut()/load_init()`. Recount padding by hand when adding fields. Space = `8 + size_of::<T>()` (zero-copy) or manual `T::LEN` (regular `#[account]`).
2. **No `String` in zero-copy.** Use `[u8; N]` + `*_len: u8`; convert via `registry::string_to_bytes32` / `bytes32_to_string`; rehydrate events with `String::from_utf8_lossy(&b[..len]).into_owned()`.
3. **Sealevel parallelism.** Hot-path writes (meter readings, trades) go to **per-entity PDAs** (`MeterState`, `Order`, `OrderNullifier`, `*Shard`), never to global config accounts (read-only on hot paths). Global totals are **stale on purpose**; reconcile via periodic admin instructions (`aggregate_readings`, `aggregate_shards`). Shard select: `authority.to_bytes()[0] % num_shards` (16 in registry).
4. **`compute-debug` feature.** Each handler wraps its body in `compute_fn!("label" => { ... })`; no-op in release. Preserve when adding instructions (CU profiling vs 200k default / 1.4M max budget).
5. **Hoist `Clock::get()` before `emit!`** — `let now = Clock::get()?.unix_timestamp;` then emit. Avoids a sysvar syscall inside macro expansion.
6. Changing a program ID requires `anchor keys sync` **and** updating `declare_id!` in that program's `lib.rs`.
7. **Every program's `Cargo.toml` sets `[profile.release] overflow-checks = true`** (cargo build-sbf defaults to off → silent wrapping). New programs must include the same block; still prefer `checked_*`/`saturating_*` explicitly.
8. **Any instruction that mints or burns MUST pin its mint to the program's own config account.** `retire_energy_tokens` shipped without one: its context had no `token_info` and no constraint on `mint`, and `authority` only had to own `token_account` — so the energy-token program would burn **any** Token-2022 mint it was handed (the treasury's real THBC included) and it would read on-chain as a GridTokenX energy retirement. Fixed 2026-07-30 by adding the read-only `token_info` PDA and `constraint = mint.key() == token_info.load()?.mint @ EnergyTokenError::InvalidMint` (6014), mirroring the pin `sync_total_supply` already used. New error variants go at the **END** of the enum — Anchor numbers them sequentially from 6000, so inserting renumbers every later variant and breaks clients matching on the code. Verified against the deployed program by `scripts/test-retire-mint-binding.ts` (burning THBC is rejected 6014 with THBC supply unchanged; burning GRID succeeds with supply exactly −1e9), because a green `cargo build` proves nothing about an account constraint.
9. **Renaming an account TYPE never renames its PDA seed bytes as a side effect.** The seed literal (e.g. `b"governance_config"`) IS the on-chain address — changing it orphans every already-initialized account and breaks every cached/hardcoded derivation (clients, CPI binds, scripts, tests), requiring a full migration for zero functional gain if done casually. Precedent: `PoAConfig` → `GovernanceConfig` (`ae35805`) renamed the Rust type/IDL everywhere but *deliberately* kept `seeds = [b"poa_config"]` at the time — this platform was (and still is) pre-mainnet/localnet-only, but the seed itself wasn't worth migrating in that commit. The seed was later migrated in its own explicit, planned commit (`b"poa_config"` → `b"governance_config"`, 2026-07-04) specifically *because* it was still the cheap pre-mainnet window — full re-init of the running validator's governance state, not a live-data migration. Only change seed bytes when the account is genuinely new (e.g. energy-token's `mint` → `mint_2022` was a real SPL→Token-2022 mint swap) or, as here, a full migration is explicitly planned and executed as its own change — never as an incidental side effect of an unrelated rename.

## Search Tooling

> **Use `rg` (ripgrep), never `grep`.** When shelling out to search files, run `rg` —
> it respects `.gitignore`, skips binaries, and is far faster than `grep`/`find -exec grep`.
> Reserve plain `grep` only for piping non-file streams.
