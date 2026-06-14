---
name: gridtokenx-anchor
description: Use this skill whenever the user is working on the on-chain Anchor programs in the GridTokenX Solana repo — the `energy-token`, `governance`, `oracle`, `registry`, or `trading` programs, or anything involving `Anchor.toml` or the per-program `Cargo.toml`. Trigger for tasks like adding instructions, changing account structs, modifying PDAs or seeds, wiring CPIs between programs, adjusting the zero-copy state layouts, tuning compute usage, fixing Anchor lifetime errors, regenerating instruction discriminators, or reasoning about Sealevel write-lock contention and sharding. Also trigger for work on the `compute-debug` feature, `zero_copy` Pod layouts, or the dual-token (GRID + GRX) logic. Do not trigger for the `gridtokenx-blockchain-core` Rust client library — that has its own skill.
---

# GridTokenX Anchor Programs

Five on-chain Anchor programs forming the GridTokenX P2P energy-trading platform on Solana (localnet / permissioned PoA). They share hard conventions that must be preserved on every edit.

## Repo layout

There is **no root `Cargo.toml` workspace**. Each program in `programs/*` is an **independent crate**; `Anchor.toml` is the only top-level manifest. Shared logic lives in `shared/`.

```
Anchor.toml                 # [toolchain] empty (CLI version unpinned); [programs.localnet] declares 7 IDs
programs/
├── energy-token/           # GRID (1 kWh = 1 GRID) + GRX SPL-2022 mint; REC-validator gated
├── governance/             # PoA authority; ERC-1155-style RECs; DAO; 2-step authority transfer (handlers/, state/)
├── oracle/                 # AMI-gateway bridge; per-meter PDA state; market-clearing epochs
├── registry/               # user + meter accounts; 16-shard counter; staking + validator registration
└── trading/                # order book, CDA; sharded order submit; off-chain-signed match settlement (instructions/, state/)
shared/
├── core/                   # shared on-chain types + version
└── compute-debug/          # compute-unit profiling macros (feature-gated)
```

`blockbench` and `tpc_benchmark` are **precompiled benchmark programs** (no source in `programs/`) declared in `Anchor.toml [programs.localnet]` so the test validator deploys them on localnet startup.

Program IDs (from `Anchor.toml` — verified to match `declare_id!` in each `lib.rs`; do not change without `anchor keys sync` + updating `declare_id!`):

| Program        | ID                                              |
| -------------- | ----------------------------------------------- |
| `energy_token` | `6FZKcVKCLFSNLMxypFJGU4K14xUBnxNW9VAuKGhmqjGX`   |
| `governance`   | `FokVuBSPXP11aeL7VZWd8n8aVAhWqVpyPZETToSxdvTS`   |
| `oracle`       | `64Vgos61STZ8pW9NnHi2iGtXMTQr7NqBoMorK6Zg8RJU`   |
| `registry`     | `FcSd5x4X1nzJMKLZC4tMZXnQ1ipLrGsEfeoH8N4mvJX7`   |
| `trading`      | `CnWDEUhTvSixeLSyViWgAnnu9YouBAYVGcrrFm1s9WcX`   |
| `blockbench`   | `9AM4JkvUkK8ZfRneTAQVahFgPe9rEisNkB9byRfZ4TwT`   |
| `tpc_benchmark`| `ELv3cWARDqNLgv7A7dochy2CC4Ke9wdgAHvkU3wCwQha`   |

## Invariants — read before touching any program

Non-obvious rules that make the workspace work. Break them → runtime panics, `AccountDidNotSerialize` errors, or silent Sealevel contention that tanks TPS.

### 1. Versions: anchor-lang / anchor-spl = `1.0.0`

Every program crate pins `anchor-lang = "1.0.0"` (features `init-if-needed`) and `anchor-spl = "1.0.0"` (features `metadata`); `mpl-token-metadata = "5.1.2-alpha.2"`. The Anchor CLI version is **not** pinned in-repo (`Anchor.toml [toolchain]` is empty) — match the CLI to the 1.0.0 on-chain crate. The TS test/client side imports from **`@anchor-lang/core`** (not `@coral-xyz/anchor`). Don't bump `anchor-lang` independently of `anchor-spl` / `mpl-token-metadata`.

### 2. All state structs are `#[account(zero_copy)] #[repr(C)]` with explicit padding

Every on-chain struct in `state.rs` / `state/*.rs` is zero-copy and Pod-compatible:

- Keep `#[repr(C)]` on the struct
- Manually insert `_paddingN: [u8; N]` to align every field (8-byte for `u64`/`i64`, 4-byte for `u32`, etc.)
- Enums in zero-copy structs: the existing registry enums (`UserType`, `UserStatus`, `MeterType`, `MeterStatus`, `ValidatorStatus` in `registry/src/state.rs`) use hand-written `unsafe impl bytemuck::Pod` on `#[repr(u8)]` enums. **This is technically unsound** — `Pod` requires every bit pattern to be valid, but a 2-variant enum only has 2 valid bytes; a corrupted or forged account byte is UB on read. It survives today because Anchor's owner+discriminator checks gate the load. **For new code prefer a raw `u8` field + `TryFrom<u8>` accessor** (the pattern `trading::Order.order_type` uses) instead of copying the unsafe impls.
- Use `AccountLoader<'info, T>` + `load()` / `load_mut()` / `load_init()` — never `Account<'info, T>` on a zero-copy struct
- Space: `8 + std::mem::size_of::<T>()` (zero-copy) or manual `T::LEN` (regular `#[account]`: `ErcCertificate::LEN`, `PoAConfig::LEN`, `OrderNullifier::LEN`)

Add a field → recount padding by hand. The `OracleData` / `UserAccount` offset-arithmetic comments show the style — keep it.

### 3. No `String` fields in zero-copy structs — use `[u8; N]` + `*_len: u8`

Every user-visible string (meter IDs, certificate IDs, authority names, contact info, revocation reasons, validation data) is a fixed byte array + companion length field. Reuse `registry/src/lib.rs` helpers `string_to_bytes32` / `bytes32_to_string`. Rehydrate events via `String::from_utf8_lossy(&bytes[..len as usize]).into_owned()`.

Size caps in use: meter_id 32, certificate_id 64, renewable_source 64, authority_name 64, contact_info 128, revocation_reason 128, validation_data 256.

### 4. `compute-debug` feature flag pattern

Each program has a `localnet` feature pulling in `shared/compute-debug`, providing `compute_fn!("label" => { ... })` and `compute_checkpoint!("label")`. In release builds these are no-op macros (defined inline at the top of each `lib.rs`). **Wrap every instruction handler body in `compute_fn!`** (the trading program is the exception — verify the local style before adding). Profiles CU vs 200k default / 1.4M max budget.

### 5. Hoist `Clock::get()` before `emit!`

`let now = Clock::get()?.unix_timestamp;` before the `emit!` macro, never inside the event struct — avoids a sysvar syscall inside macro expansion. Look for `// Hoist Clock::get() before emit!` and match it.

### 6. Sealevel parallelism: read-only global config + per-entity PDA for writes

Most important architectural rule. High-frequency writes (meter readings, trades) **never** write to global config accounts:

- Config accounts (`OracleData`, `Registry`, `Market`, `TokenInfo`, `PoAConfig`) load read-only on hot paths
- Writes go to per-entity PDAs: `MeterState` (`[b"meter", meter_id]`), `Order` (`[b"order", authority, order_id]`), `OrderNullifier` (`[b"nullifier", user, order_id]`), `RegistryShard` / `MarketShard` / `ZoneMarketShard`
- Aggregation via periodic admin instruction: `aggregate_readings` (oracle), `aggregate_shards` (registry). Global totals (`total_supply`, `total_readings`, `total_volume_global`, `Registry.active_meter_count`) are **stale on purpose** — never read mid-transaction assuming current. Live count: `sync_total_supply` in `energy_token`.
- Worked example: meter Active-counting lives on `RegistryShard.active_meter_count` (the owner's shard, `shard_for(owner)`); `register_meter` / `set_meter_status` / `deactivate_meter` write the shard while the global `Registry` stays read-only in their contexts, and `aggregate_shards` reconciles `Registry.active_meter_count`. A `mut` on the global account would take a Sealevel write lock per registration and serialize the hot path — this exact regression was shipped once and fixed.
- `num_shards` = 16 in registry, variable-per-market in trading. Shard select: `authority.to_bytes()[0] % num_shards` (`trading/src/state/market.rs::get_shard_id`).

**New high-frequency instruction → config read-only, per-entity PDA for state, add to an existing aggregation job.**

### 7. CPI: registry → energy-token

`registry/Cargo.toml` has `energy-token = { path = "../energy-token", features = ["cpi"] }` for `settle_and_mint_tokens` + airdrop paths:

- The **Registry PDA** (`[b"registry"]`) signs CPI into `energy_token::cpi::mint_tokens_direct` — passed BOTH as `authority` and `registry_authority`. Signer-seeds pattern in `registry::settle_and_mint_tokens`.
- When REC validators are registered in `TokenInfo`, `mint_tokens_direct` **requires** a `rec_validator` Signer in `TokenInfo::rec_validators`. Registry passes `meter_owner` or a separate validator account.
- Airdrop on `register_user` is **best-effort** — failure logged and swallowed (`if ... .is_err()`). Do not make it propagate; it would block user registration.

### 8. Governance ↔ trading coupling via `PoAConfig`

Every trading instruction takes `governance_config: Account<'info, PoAConfig>` and guards `governance_config.is_operational()` at the top. Keep the maintenance-mode guard on new trading instructions. `trading/Cargo.toml` has `governance = { path = "../governance", features = ["cpi"] }` — that's how `ErcCertificate` and `PoAConfig` re-export from `lib.rs`.

### 9. ERC double-claim prevention

`MeterAccount` tracks two high-water marks: `settled_net_generation` (tokenized into GRID) and `claimed_erc_generation` (certified as ERC). `governance::issue` computes `unclaimed = total_generation - claimed_erc_generation` and rejects over-issue.

**Known gap**: `governance::issue` reads `meter_account` read-only (`try_borrow_data` + `bytemuck::from_bytes`) with a `TODO` about writing `claimed_erc_generation` back. The high-water mark is only updated registry-side until `registry::mark_erc_claimed` is called by governance via CPI. Don't add a naive write to `meter_account` from governance — it's another program's account, must go through CPI.

### 10. Instruction discriminator hardcoding in `gridtokenx-blockchain-core`

The sibling Rust client library hardcodes Anchor's 8-byte SHA256 discriminators (e.g. `[2, 241, 150, 223, 99, 214, 116, 97]` for `register_user`). **Renaming** an instruction or **changing its namespace** (`#[program] pub mod <name>`) silently breaks every byte array in `gridtokenx-blockchain-core/src/rpc/instructions.rs`. Avoid renaming, or re-derive (`sha256("global:<instruction_name>")[..8]`) and update the client in the same PR.

## PDAs cheat sheet

`Pubkey::find_program_address(&[seeds], &program_id)`. Seeds in use (verified against source):

| Program      | Seeds                                                          | Purpose                       |
| ------------ | -------------------------------------------------------------- | ----------------------------- |
| energy-token | `[b"mint_2022"]`                                               | SPL-2022 mint                 |
| energy-token | `[b"token_info_2022"]`                                         | `TokenInfo` config PDA        |
| governance   | `[b"poa_config"]`                                              | `PoAConfig`                   |
| governance   | `[b"erc_certificate", certificate_id.as_bytes()]`             | One per ERC                   |
| oracle       | `[b"oracle_data"]`                                             | `OracleData` config           |
| oracle       | `[b"meter", meter_id.as_bytes()]`                             | Per-meter `MeterState`        |
| registry     | `[b"registry"]`                                               | `Registry` (also CPI signer)  |
| registry     | `[b"registry_shard", &[shard_id]]`                            | One of 16 shards              |
| registry     | `[b"user", authority.as_ref()]`                              | `UserAccount`                 |
| registry     | `[b"meter", owner.as_ref(), meter_id.as_bytes()]`           | `MeterAccount`                |
| registry     | `[b"grx_vault"]`                                              | Staking vault                 |
| trading      | `[b"market"]`                                                 | `Market`                      |
| trading      | `[b"market_authority"]`                                       | Settlement signer PDA         |
| trading      | `[b"market_shard", market.as_ref(), &[shard_id]]`           | `MarketShard`                 |
| trading      | `[b"zone_market", market.as_ref(), &zone_id.to_le_bytes()]` | `ZoneMarket`                  |
| trading      | `[b"order", authority.as_ref(), &order_id.to_le_bytes()]`   | `Order`                       |
| trading      | `[b"nullifier", user.as_ref(), &order_id_16_bytes]`         | `OrderNullifier` (off-chain)  |
| trading      | `[b"trade", buy_order.as_ref(), sell_order.as_ref()]`       | `TradeRecord`                 |

Two distinct meter seed conventions: **oracle** uses `[b"meter", meter_id]` (AMI gateway identifies meters by serial); **registry** uses `[b"meter", owner, meter_id]` (owner-scoped). Don't unify these.

## Build & test

```bash
anchor build                 # build all source programs → target/deploy + target/types
anchor build -- --features localnet   # feature-gated compute profiling

anchor test                  # build + validator + deploy + mocha (Anchor.toml [scripts] test = npx mocha -r tsx 'tests/**/*.ts')
npm run test:oracle          # per-suite npm scripts: oracle | registry | governance | blockbench | smallbank | tpc-stress | all
npx mocha -r tsx tests/oracle.ts --timeout 1000000   # single file (validator must be running)
./scripts/run-tests.sh --suite oracle                # standalone/CI runner (--skip-build --skip-deploy --suite)

npm run simnet               # Surfpool mainnet sim (no local validator); simnet:ci for headless
```

Tests use `AnchorProvider` against a live validator (import from `@anchor-lang/core`). `litesvm` is a devDependency but not used by the current `tests/`.

### Build & test gotchas

1. **Stale-binary blocker (no global Cargo workspace)**: because there's no root workspace, `anchor build` may emit `.so` to `programs/<name>/target/deploy/` while the validator deploy looks in root `./target/deploy/`. If a deploy uses a stale binary, copy explicitly:
   ```bash
   cp programs/oracle/target/deploy/oracle.so target/deploy/oracle.so
   ```
2. **Test runner is `mocha -r tsx`** (in `Anchor.toml`), not `ts-mocha` — fixes ESM module resolution conflicts.
3. **Precompiled benchmarks** (`blockbench`, `tpc_benchmark`) must stay in `Anchor.toml [programs.localnet]` so the test validator deploys them on startup.
4. **Time in tests**: don't `sleep` to advance time. Construct initial states with past timestamps (e.g. `timestamp.sub(new BN(70))`) to pass rate-limit / monotonicity checks without races.
5. **Apple Silicon validator crash**: `solana-test-validator` on M-series panics under load ("Too many open files"). Run `ulimit -n 65536` before launching (the superproject `scripts/app.sh` handles this).
6. **Arithmetic**: use `checked_*` / `saturating_*` for every on-chain arithmetic op. Every program's `Cargo.toml` also sets `[profile.release] overflow-checks = true` (cargo build-sbf defaults to off, which silently wraps), so any bare `+`/`-`/`*` that slips through panics instead of corrupting state. **New programs must include the same profile block.**
7. **Oracle epochs are 900-second-aligned**: `trigger_market_clearing` rejects any `epoch_timestamp` where `epoch_timestamp % 900 != 0` (and any epoch ≤ `last_cleared_epoch` or in the future). Tests must align: `now.sub(now.mod(new BN(900)))`.

## Common tasks

**Add an instruction to an existing program:**
1. Handler fn — complex logic in `governance/src/handlers/<name>.rs`; inline in `lib.rs` for others (match local style)
2. Add the `#[derive(Accounts)]` context
3. Wrap body in `compute_fn!("name" => { ... })`
4. Hoist `Clock::get()?.unix_timestamp` before any `emit!`
5. Writes to a global config account → stop, check invariant #6; most write-heavy paths want a per-entity PDA
6. Client needs it → compute discriminator (`sha256("global:<ix>")[..8]`) and add a builder in `gridtokenx-blockchain-core/src/rpc/instructions.rs`

**Add a field to a zero-copy struct** (breaking — account size grows, existing data unreadable):
1. Add field with correct alignment + padding
2. Verify every `init` site's `size_of::<T>()` (implicit but recheck)
3. For manual-`LEN` structs (`ErcCertificate::LEN`, `PoAConfig::LEN`), update the constant
4. Production: write a realloc + zero-init migration instruction; don't rely on `init_if_needed`

**Wire a new CPI** (follow `registry → energy-token`):
1. Add `<target> = { path = "../<target>", features = ["cpi"] }` to caller's `Cargo.toml`
2. Build `CpiContext::new_with_signer` with caller's PDA as authority + correct signer seeds
3. Import `<target>::cpi::accounts::<IxName>` and `<target>::cpi::<ix_name>` — don't hand-roll instruction bytes
4. If target checks a stored authority (`TokenInfo::registry_authority`), match the caller's signer to that key

## Known rough edges (don't "fix" without discussion)

- `registry::settle_and_mint_tokens` passes `ctx.accounts.registry` as BOTH `authority` and `registry_authority` to `mint_tokens_direct`. Correct given current `energy-token` validation; looks suspicious — leave it.
- `trading::lib.rs` inlines auction-clearing types (`AuctionOrder`, `CurvePoint`, `AuctionMatch`, `MatchPair`) at module scope ("Anchor macro issues") — don't move into `state/`.
- `trading::lib.rs` nests context structs inside the `#[program]` module (`InitializeProgram`, `InitializeMarketContext`, ...), while `instructions/` contexts (`InitializeMarketShardContext`, `SettleOffchainMatchContext`) live outside and import via glob. Match the surrounding pattern.
- `MarketShard` is populated only by `settle_offchain_match` / `batch_settle_offchain_match`; `Market`'s `clearing_enabled`, `locked` (re-entrancy), `active_orders`, `total_trades` still drive on-chain CDA. Shard and direct-write paths run in parallel during migration.
- `MeterState` (oracle) has no registry link — oracle doesn't verify the meter is registered. Auth is purely `oracle_data.api_gateway` = signer. Registry-side checks belong in the upstream gateway service, not the oracle program.
- `zone_id` is `i32` in `MeterState`, `u32` in `OffchainOrderPayload` / `ZoneMarket`. Don't unify — oracle meters use sentinel `-1` for "unassigned"; trading zones are always valid.

## Performance / TPS levers (in order)

1. **Write-lock contention on `Market`** — biggest offender. Fix: finish migrating updates out of `Market` into `MarketShard` / `ZoneMarketShard` (`_padding_depth_*` fields are leftover slots from depth arrays moved to `ZoneMarket`).
2. **`OracleData` global counters** — fixed by `aggregate_readings`; per-reading writes go to `MeterState`.
3. **Compute budget** — default 200k is tight for `execute_atomic_settlement` (5 CPIs) and `batch_settle_offchain_match` (up to 4 matches × 3 CPIs). Raise via `ComputeBudgetInstruction::set_compute_unit_limit` in the client, not the program.
4. **Tx size limit (1232 bytes)** — `MAX_DEPTH_LEVELS = 10` in `trading/src/state/zone_market.rs` is tuned for this. Don't raise without recalculating `update_depth` Vec payload size.
