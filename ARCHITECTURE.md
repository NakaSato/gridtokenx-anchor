# gridtokenx-anchor — Architecture

> The on-chain layer of GridTokenX: the Solana/Anchor programs that hold the authoritative ledger
> for energy assets, identity, market clearing, and settlement.
>
> This repo is a **git submodule** of the `gridtokenx-coresystem` superproject. Platform-wide rules
> (services, gateways, Chain Bridge as the only Solana RPC client) live in the superproject. This
> doc covers **only** the contents of this folder.

---

## 1. What This Is

A P2P energy-trading protocol implemented as Anchor programs on a **permissioned PoA** Solana
cluster (localnet for dev). The programs are the source of truth for token supply, user/meter
identity, the order book, and settlement. Off-chain services read and write these accounts only
through Chain Bridge — never by holding RPC connections themselves.

There is **no root `Cargo.toml` workspace**. Each program in `programs/*` is its own crate; shared
code lives in `shared/`. Anchor drives the build via `Anchor.toml`.

## 2. Programs

Six production programs plus two benchmark programs. Program IDs are authoritative in
`Anchor.toml [programs.localnet]` (the table below is a snapshot — trust `Anchor.toml`).

Each program has a per-program reference document under
[`docs/programs/`](docs/programs/README.md) (identity, state model, instruction set,
invariants, CPI, events, errors, testing — all `path:line`-cited):
[`energy-token`](docs/programs/energy-token.md) ·
[`governance`](docs/programs/governance.md) ·
[`oracle`](docs/programs/oracle.md) ·
[`registry`](docs/programs/registry.md) ·
[`trading`](docs/programs/trading.md) ·
[`treasury`](docs/programs/treasury.md) ·
[`blockbench`](docs/programs/blockbench.md) ·
[`tpc-benchmark`](docs/programs/tpc-benchmark.md).

### Production

| Program | Program ID | Responsibility |
| :--- | :--- | :--- |
| `energy-token` | `6FZKcVKCLFSNLMxypFJGU4K14xUBnxNW9VAuKGhmqjGX` | GRID (1 kWh = 1 GRID) + GRX SPL mints; REC-validator-gated mint/settle; idempotent generation mint keyed by a per-`(meter, window)` `GenerationMintRecord` PDA (`mint_generation`); Token-2022 + Metaplex metadata |
| `governance` | `FokVuBSPXP11aeL7VZWd8n8aVAhWqVpyPZETToSxdvTS` | PoA authority (authority/config/dao/erc/stats handlers); ERC-1155-style RECs; 2-step authority transfer; PoA aggregator allow-list (`AggregatorEntry` PDA, `admit_aggregator`/`revoke_aggregator`) |
| `oracle` | `64Vgos61STZ8pW9NnHi2iGtXMTQr7NqBoMorK6Zg8RJU` | AMI-gateway bridge; per-meter PDA state; 15-min market-clearing epochs; node-facing instructions accept the chain bridge **or** an admitted aggregator (`AggregatorEntry` validated against governance) |
| `registry` | `FcSd5x4X1nzJMKLZC4tMZXnQ1ipLrGsEfeoH8N4mvJX7` | User + meter accounts; 16-shard counter; staking + validator registration + slashing (severity-scaled `slash_bps`, capped victim compensation `min(slash, proven_loss)`, remainder to the configured fund/`slash_destination`, `slash == comp + fund` invariant, partial-slash → `Suspended` / full → `Slashed`, Active validators only); unstake cooldown + validator demote-on-unstake; 10 GRX new-user airdrop |
| `trading` | `CnWDEUhTvSixeLSyViWgAnnu9YouBAYVGcrrFm1s9WcX` | Order book + CDA; sharded order submit; off-chain-signed match settlement (`settle_offchain.rs`); batch settle records a per-`(zone,batch)` audit commitment to treasury via CPI; auction clearing |
| `treasury` | `FfxSQYKUmx9NGdCC9TDPmZSYjWYE1h4ruu3JatzHN5Tn` | GRX↔THBG (THB-pegged stablecoin, 6dp) swap with reserve-attested peg invariant; redeem bounded by `swap_vault` collateral + tracked supply; GRX staking (MasterChef accumulator); non-custodial baht-settlement accounting — `record_settlement` (single) + `record_settlement_batch` writing a per-`(zone,batch)` `SettlementRecord` (Merkle root + VAT + total) |

### Benchmark (not part of the production protocol)

| Program | Program ID | Purpose |
| :--- | :--- | :--- |
| `blockbench` | `9AM4JkvUkK8ZfRneTAQVahFgPe9rEisNkB9byRfZ4TwT` | BLOCKBENCH micro-benchmarks (DoNothing/CPUHeavy/IOHeavy/Analytics) + YCSB KV (SIGMOD 2017) |
| `tpc-benchmark` | `ELv3cWARDqNLgv7A7dochy2CC4Ke9wdgAHvkU3wCwQha` | TPC-C OLTP benchmark mapped to Solana accounts (New-Order/Payment/Order-Status/Delivery) |

## 3. Shared Crates

```
shared/
├── core/           shared on-chain types + version
└── compute-debug/  compute-unit profiling macros (feature-gated, no-op in release)
```

## 4. CPI Graph

Cross-program invocation via path deps with `features = ["cpi"]`:

```
registry → energy-token        (airdrop / mint on registration)
trading  → governance          (read PoA config, ERC certificates)
trading  → treasury            (record_settlement / record_settlement_batch; non-custodial, fires when treasury accounts are passed — mandatory for THBG markets)
oracle   → governance          (types + ID only, no CPI invoke: validate an admitted aggregator's `AggregatorEntry` PDA)
```

`trading` re-exports `governance::{ErcCertificate, ErcStatus, GovernanceConfig}` directly. `oracle`
deserializes `governance::AggregatorEntry` and derives its PDA against `governance::ID` to
authorize admitted aggregator nodes — no instruction is invoked.

**Two GRX staking systems (intentional, not duplication).** `registry` staking is a
**validator security bond** (no yield, `MIN_VALIDATOR_STAKE`-gated, slashed for
misbehavior; vault `[b"grx_vault"]`, on `UserAccount.staked_grx`). `treasury` staking
is **yield staking** (MasterChef rewards funded by swap fees; vault `[b"stake_vault"]`,
on `StakePosition`). They share lock/unlock/slash plumbing but are different products
with separate vaults/positions and are not reconciled — a user may hold both.

## 5. Load-Bearing Invariants

1. **Zero-copy state.** Every hot-path `state.rs` struct is `#[account(zero_copy)] #[repr(C)]` + Pod,
   with manual `_paddingN: [u8; N]` for alignment. Use `AccountLoader` + `load()/load_mut()/load_init()`.
   Recount padding by hand when adding fields. Space = `8 + size_of::<T>()` (zero-copy) or `T::LEN`
   (regular `#[account]`). **Exception:** `energy-token`'s `GenerationMintRecord` is a regular
   `#[account]` (Borsh, `Account<'info, _>`, space `8 + LEN`), not zero-copy — it is a tiny
   `init_if_needed` idempotency marker, never a hot-path write, so it skips the Pod/padding rules.
2. **No `String` in zero-copy.** Use `[u8; N]` + `*_len: u8`; convert via
   `registry::string_to_bytes32` / `bytes32_to_string`; rehydrate events with
   `String::from_utf8_lossy(&b[..len]).into_owned()`.
3. **Sealevel parallelism.** Hot-path writes (meter readings, trades) target **per-entity PDAs**
   (`MeterState`, `Order`, `OrderNullifier`, `*Shard`), never global config (read-only on hot
   paths). Global totals are **stale on purpose**; reconcile via admin instructions
   (`aggregate_readings`, `aggregate_shards`). Shard select: `authority.to_bytes()[0] % num_shards`
   (16 in registry).
4. **`compute-debug` feature.** Each handler wraps its body in `compute_fn!("label" => { ... })`;
   no-op in release. Preserve when adding instructions (CU profiling vs 200k default / 1.4M max).
5. **Hoist `Clock::get()` before `emit!`** — `let now = Clock::get()?.unix_timestamp;` then emit.
   Avoids a sysvar syscall inside macro expansion.
6. **Program ID changes** require `anchor keys sync` **and** updating `declare_id!` in that
   program's `lib.rs`.

## 6. Versions (source of truth: each `Cargo.toml`)

- `anchor-lang` / `anchor-spl` = **1.0.0** (not the 0.30.x the `SKILL.md` mentions).
- TS tests import from **`@anchor-lang/core`** (not `@coral-xyz/anchor`).

## 7. Build & Test

```bash
anchor build                 # build all programs → target/deploy + target/types
anchor test                  # build, spin local validator, deploy, run mocha suite
anchor keys sync             # regenerate program IDs (then update declare_id! in each lib.rs)

npm run test:oracle          # tests/oracle.ts
npm run test:registry        # tests/registry_sharding.ts
npm run test:governance      # tests/governance.ts
npm run test:blockbench      # tests/blockbench.ts (BLOCKBENCH OLTP)
npm run test:smallbank       # tests/smallbank.ts
npm run test:tpc-stress      # tests/tpc_stress_test.ts (TPC-C, needs tpc_benchmark .so)
npm run test:all             # oracle+registry+governance+blockbench+smallbank+tpc

./scripts/run-tests.sh --suite oracle   # standalone/CI runner: --skip-build --skip-deploy --suite
npm run lint                 # eslint .
```

### Mainnet simulation (Surfpool — no local validator)

```bash
npm run simnet               # surfpool, mainnet, watch, legacy-anchor-compat
npm run simnet:ci            # headless / fast
```

## 8. Init & Simulation Scripts

`scripts/*.ts` run via `npx tsx`. **Order matters** for init:

```
bootstrap.ts → init-registry.ts → init-oracle.ts → init-market.ts
             → init-governance.ts → init-zone-config.ts
```

(`init-zone-config` also available as `anchor run init-zone-config`.)

Lifecycle / load simulations: `simulate-trading.ts`, `simulate-market-clearing.ts`,
`simulate-meter-stream.ts`, `simulate-token-lifecycle.ts`, `execute-settlement.ts`.

## 9. Further Reading (in this repo)

| File | Covers |
| :--- | :--- |
| `docs/programs/` | **Reference** (what + `path:line`): per-program docs — identity, state, instructions, invariants, CPI, events, errors, testing; see [`docs/programs/README.md`](docs/programs/README.md) |
| `docs/design/` | **Design narratives** (why + model) for *implemented* features — see the group below |
| `docs/proposed/` | **Proposed / not-yet-built** design + the implementation plan — see the group below |
| `RUNTIME-ARCHITECTURE.md` | How the programs execute: SVM runtime, CPI, security model, protocol flow, consensus/validator topology |
| `CLAUDE.md` | LLM working rules for this submodule |
| `SKILL.md` | Deep dive on program invariants — **version/ID table is stale**, defer to `Anchor.toml` + `Cargo.toml` |
| `BENCHMARKS.md` | Benchmark methodology and results |
| `Anchor.toml` | Authoritative program IDs, toolchain, scripts |

### `docs/design/` — implemented design narratives

| File | Covers |
| :--- | :--- |
| [`docs/design/node-validator.md`](docs/design/node-validator.md) | Off-chain validator/aggregator node design: PoA admission, the governance aggregator allow-list, and how the oracle authorizes admitted nodes |
| [`docs/design/role-map.md`](docs/design/role-map.md) | **PROPOSED (design correction):** maps the on-chain authority scheme onto Thailand's real institutions (ERC regulator vs EGAT/MEA/PEA operators vs licensed aggregators) — flags where current bindings mis-map and the `path:line` code deltas to fix. Companion to [`node-validator.md`](docs/design/node-validator.md) + [`../proposed/blockchain-node-network.md`](docs/proposed/blockchain-node-network.md) |
| [`docs/design/audit-remediation.md`](docs/design/audit-remediation.md) | **IN PROGRESS:** security/audit remediation tracker — Wave-0 enforcement fixes (validator bond, slash-escape, settlement gate, charge cap, REC mandatory) + follow-ups, each with verification status, plus remaining structural items and their blast radius. Companion to [`role-map.md`](docs/design/role-map.md) |
| [`docs/design/trading-cda.md`](docs/design/trading-cda.md) | Trading order book, CDA + off-chain-signed settlement, nullifier replay guard, sharding, THBG settlement policy. Companion to [`docs/programs/trading.md`](docs/programs/trading.md) |
| [`docs/design/rec-certificates.md`](docs/design/rec-certificates.md) | REC/ERC certificate lifecycle (issue/validate/transfer/revoke) + energy-token REC-validator mint gating. Companion to [`docs/programs/governance.md`](docs/programs/governance.md) + [`energy-token.md`](docs/programs/energy-token.md) |
| [`docs/design/dao-governance.md`](docs/design/dao-governance.md) | Generation-weighted DAO (proposal/vote/execute) + PoA 2-step authority transfer. Companion to [`docs/programs/governance.md`](docs/programs/governance.md) |
| [`docs/design/wallet-authority.md`](docs/design/wallet-authority.md) | **Mostly implemented:** wallet/authority architecture — PDA vaults, mint authority, custodian attestation, scoped aggregator signing |
| [`docs/design/cost-fee-structure.md`](docs/design/cost-fee-structure.md) | **Research framework:** full cost/fee stack — wheeling, VAT, Ft, swap fee, aggregator margin (external regulatory figures; some on-chain hooks PROPOSED) |

### `docs/proposed/` — not-yet-built design + plan

| File | Covers |
| :--- | :--- |
| [`docs/proposed/blockchain-node-network.md`](docs/proposed/blockchain-node-network.md) | **Network + audit commitment real, trustless Tier-2 PROPOSED:** permissioned-Solana node taxonomy + two-tier consensus; per-`(zone,batch)` `SettlementRecord` (Merkle root + VAT) is built (commit-only), but on-chain root *verification* / challenge-response is not — see banner |
| [`docs/proposed/collateral-slashing.md`](docs/proposed/collateral-slashing.md) | **Slash distribution IMPLEMENTED, rest PROPOSED:** severity-scaled slash + capped victim comp + fund + Suspended/Slashed are in code (GRX bond per D1); THBG bond, multi-victim pro-rata, distinct fund PDA, and trustless challenge remain forward design — see banner |
| [`docs/proposed/implementation-plan.md`](docs/proposed/implementation-plan.md) | Phased plan + todo/test lists to close the PROPOSED design→code gap (settlement commitment, challenge-response, slash rework) |
