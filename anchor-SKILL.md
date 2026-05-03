---
name: gridtokenx-anchor
description: Use this skill whenever the user is working on the on-chain Anchor programs in the GridTokenX Solana workspace — the `energy-token`, `governance`, `oracle`, `registry`, or `trading` programs, or anything involving the `Anchor.toml` / workspace `Cargo.toml` at the root. Trigger for tasks like adding instructions, changing account structs, modifying PDAs or seeds, wiring CPIs between programs, adjusting the zero-copy state layouts, tuning compute usage, fixing Anchor lifetime errors, regenerating instruction discriminators, or reasoning about Sealevel write-lock contention and sharding. Also trigger for work on the `compute-debug` feature, `zero_copy` Pod layouts, or the dual-token (GRID + GRX) logic. Do not trigger for the `blockchain-core` Rust client library — that has its own skill.
---

# GridTokenX Anchor Programs

This skill covers the five on-chain Anchor programs that together form the GridTokenX P2P energy trading platform on Solana (localnet / permissioned PoA). They're deployed via a single Anchor workspace (`Anchor.toml` + workspace `Cargo.toml`) and share a number of hard conventions that must be preserved on every edit.

## Workspace layout

```
Anchor.toml                 # anchor_version = 0.32.1, declares 5 program IDs
Cargo.toml                  # workspace root, anchor-lang/spl pinned to 0.30.1 / 4.0.0
programs/
├── energy-token/           # GRID (1 kWh = 1 GRID) + GRX SPL mint, REC-validator gated
├── governance/             # PoA authority (REC), ERC-1155-style certificates, 2-step authority transfer
├── oracle/                 # AMI-gateway bridge, per-meter PDA state, market-clearing epochs
├── registry/               # User + meter accounts, 16-shard counter, staking + validator registration
└── trading/                # Order book, CDA, batch/auction clearing, off-chain-signed match settlement
```

Program IDs (from `Anchor.toml` — do not change without a full `anchor keys sync` + `declare_id!` update in that program's `lib.rs`):

| Program        | ID                                              |
| -------------- | ----------------------------------------------- |
| `energy_token` | `n52aKuZwUeZAocpWqRZAJR4xFhQqAvaRE7Xepy2JBGk`   |
| `governance`   | `DamT9e1VqbA5nSyFZHExKwQu6qs4L5FW6dirWCK8YLd4`  |
| `oracle`       | `JDUVXMkeGi4oxLp8njBaGScAFaVBBg7iGoiqcY1LxKop`  |
| `registry`     | `FmvDiFUWPrwXsqo7z7XnVniKbZDcz32U5HSDVwPug89c`  |
| `trading`      | `69dGpKu9a8EZiZ7orgfTH6CoGj9DeQHHkHBF2exSr8na`  |

## Invariants — read before touching any program

These are non-obvious rules that make the workspace work. Break them and you'll get runtime panics, `AccountDidNotSerialize` errors, or silent Sealevel contention that tanks TPS.

### 1. Mix of `anchor_version = 0.32.1` (in `Anchor.toml`) and `anchor-lang = 0.30.1` (in `Cargo.toml`)

This is intentional — the Anchor CLI is 0.32.1 (needed for newer IDL behavior) but the on-chain crate is pinned to 0.30.1 for `solana-program = 1.18.17` compatibility. Do **not** bump `anchor-lang` to 0.32 without also updating `solana-program`, `spl-token`, and `mpl-token-metadata`. The `winnow = "=0.6.13"` pin in the workspace is a load-bearing transitive-dependency lock — leave it alone.

### 2. All state structs are `#[account(zero_copy)] #[repr(C)]` with explicit padding

Every on-chain struct in `state.rs` / `state/*.rs` is zero-copy and Pod-compatible. You must:

- Keep `#[repr(C)]` on the struct
- Manually insert `_paddingN: [u8; N]` to align every field (8-byte alignment for `u64`/`i64`, 4-byte for `u32`, etc.)
- For enums stored in zero-copy structs: mark them `#[repr(u8)]` and implement `bytemuck::Zeroable + bytemuck::Pod` manually (see `registry/src/state.rs` for `UserType`, `UserStatus`, `MeterType`, `MeterStatus`, `ValidatorStatus`)
- Use `AccountLoader<'info, T>` + `load()` / `load_mut()` / `load_init()` — never `Account<'info, T>` on a zero-copy struct
- Space calculation: `8 + std::mem::size_of::<T>()` for zero-copy, manual `T::LEN` for regular `#[account]` structs (see `ErcCertificate::LEN`, `PoAConfig::LEN`, `OrderNullifier::LEN`)

If you add a field, recount the padding by hand. The comments in `OracleData` and `UserAccount` show the offset arithmetic — keep that style.

### 3. No `String` fields in zero-copy structs — use fixed `[u8; N]` + `*_len: u8`

Every user-visible string (meter IDs, certificate IDs, authority names, contact info, revocation reasons, validation data) is stored as a fixed byte array with a companion length field. Conversion helpers live in `registry/src/lib.rs` (`string_to_bytes32`, `bytes32_to_string`) — reuse them rather than inlining the pattern. When emitting events, rehydrate to `String` via `String::from_utf8_lossy(&bytes[..len as usize]).into_owned()`.

Size caps currently in use: meter_id 32, certificate_id 64, renewable_source 64, authority_name 64, contact_info 128, revocation_reason 128, validation_data 256.

### 4. The `compute-debug` feature flag pattern

Every program has a `localnet` feature that pulls in `compute-debug` and provides two macros: `compute_fn!("label" => { ... })` and `compute_checkpoint!("label")`. In release/mainnet builds these are no-op macros (defined inline at the top of each `lib.rs`). **Every instruction handler wraps its body in `compute_fn!`** — preserve this when adding new instructions. It's how we profile CU usage against the 200k default and 1.4M max compute budget.

### 5. Hoist `Clock::get()` before `emit!`

Every file does `let now = Clock::get()?.unix_timestamp;` before the `emit!` macro rather than calling `Clock::get()` inside the event struct. This avoids a sysvar syscall inside macro expansion that the compiler can't optimize away. Look for the comment `// Hoist Clock::get() before emit!` — match the pattern.

### 6. Sealevel parallelism pattern: read-only global config + per-entity PDA for writes

This is the most important architectural rule. High-frequency writes (meter readings, trades) **do not** write to global config accounts. Instead:

- Config accounts (`OracleData`, `Registry`, `Market`, `TokenInfo`, `PoAConfig`) are loaded read-only during hot-path instructions
- Writes go to per-entity PDAs: `MeterState` (seeds `[b"meter", meter_id]`), `Order` (seeds `[b"order", authority, order_id]`), `OrderNullifier` (seeds `[b"nullifier", user, order_id]`), `RegistryShard` / `MarketShard` / `ZoneMarketShard` (seeds `[b"<prefix>_shard", <parent>, &[shard_id]]`)
- Aggregation is done by a periodic admin instruction: `aggregate_readings` (oracle), `aggregate_shards` (registry). Global totals (`total_supply`, `total_readings`, `total_volume_global`) are **stale on purpose** — never read them mid-transaction and assume they're current. If you need a live count, use `sync_total_supply` in `energy_token`.
- `num_shards` is currently 16 in registry and variable-per-market in trading. Shard selection: `authority.to_bytes()[0] % num_shards` (see `trading/src/state/market.rs::get_shard_id`).

**When adding a new high-frequency instruction, follow this pattern**: put the config in read-only mode, create/use a per-entity PDA for state, and add the aggregation to an existing periodic job.

### 7. CPI pattern: registry → energy-token

`registry` depends on `energy-token` with `features = ["cpi"]` for the `settle_and_mint_tokens` and airdrop paths. Two things to know:

- The **Registry PDA** (seeds `[b"registry"]`) is the signer on CPI into `energy_token::cpi::mint_tokens_direct` — it is passed in BOTH as `authority` and as `registry_authority`. The signer seeds pattern is in `registry/src/lib.rs::settle_and_mint_tokens`.
- When REC validators have been registered in `TokenInfo`, `mint_tokens_direct` **requires** a `rec_validator` Signer that's in the `TokenInfo::rec_validators` list. The registry passes the `meter_owner` or a separate validator account as `rec_validator`.
- Airdrop on `register_user` is **best-effort** — failure is logged and swallowed (`if ... .is_err()`). Do not change this to propagate errors; it would block user registration.

### 8. Governance ↔ trading coupling via `PoAConfig`

Every trading instruction requires a `governance_config: Account<'info, PoAConfig>` and guards on `governance_config.is_operational()` at the top of the handler. When adding a new trading instruction, keep the maintenance-mode guard. The `trading` program has `governance = { path = "../governance", features = ["cpi"] }` — this is how `ErcCertificate` and `PoAConfig` get re-exported from `lib.rs`.

### 9. ERC double-claim prevention

`MeterAccount` tracks two high-water marks: `settled_net_generation` (tokenized into GRID) and `claimed_erc_generation` (certified as ERC). When issuing an ERC in `governance::issue`, the handler computes `unclaimed = total_generation - claimed_erc_generation` and rejects if the request exceeds it.

**Known gap**: the current `governance::issue` reads `meter_account` read-only via `try_borrow_data` + `bytemuck::from_bytes` and has a `TODO` comment about writing `claimed_erc_generation` back. Until `registry::mark_erc_claimed` is called by governance via CPI, the high-water mark is only updated from registry side. Don't add a naive write to `meter_account` from governance — it's a different program's account and must go through CPI. If you need to close this gap, add a CPI from `governance::issue` into `registry::mark_erc_claimed`.

### 10. Instruction discriminator hardcoding in `blockchain-core`

The Rust client library hardcodes Anchor's 8-byte SHA256 discriminators (e.g., `[2, 241, 150, 223, 99, 214, 116, 97]` for `register_user`). If you **rename** an instruction or **change its namespace** (`#[program] pub mod <name>`), every one of these byte arrays in `gridtokenx-blockchain-core/src/rpc/instructions.rs` silently breaks. Either avoid renaming or re-derive all affected discriminators (`sha256("global:<instruction_name>")[..8]`) and update the client in the same PR.

## PDAs cheat sheet

All PDAs are derived with `Pubkey::find_program_address(&[seeds], &program_id)`. Seeds currently in use:

| Program      | Seeds                                                              | Purpose                       |
| ------------ | ------------------------------------------------------------------ | ----------------------------- |
| energy-token | `[b"mint_2022"]`                                                   | SPL mint                      |
| energy-token | `[b"token_info_2022"]`                                             | `TokenInfo` config PDA        |
| governance   | `[b"poa_config"]`                                                  | `PoAConfig`                   |
| governance   | `[b"erc_certificate", certificate_id.as_bytes()]`                  | One per ERC                   |
| oracle       | `[b"oracle_data"]`                                                 | `OracleData` config           |
| oracle       | `[b"meter", meter_id.as_bytes()]`                                  | Per-meter `MeterState`        |
| registry     | `[b"registry"]`                                                    | `Registry` (also CPI signer)  |
| registry     | `[b"registry_shard", &[shard_id]]`                                 | One of 16 shards              |
| registry     | `[b"user", authority.as_ref()]`                                    | `UserAccount`                 |
| registry     | `[b"meter", owner.as_ref(), meter_id.as_bytes()]`                  | `MeterAccount`                |
| registry     | `[b"grx_vault"]`                                                   | Staking vault                 |
| trading      | `[b"market"]`                                                      | `Market`                      |
| trading      | `[b"market_authority"]`                                            | Settlement signer PDA         |
| trading      | `[b"market_shard", market.as_ref(), &[shard_id]]`                  | `MarketShard`                 |
| trading      | `[b"zone_market", market.as_ref(), &zone_id.to_le_bytes()]`        | `ZoneMarket`                  |
| trading      | `[b"zone_shard", zone_market.as_ref(), &[shard_id]]`               | `ZoneMarketShard`             |
| trading      | `[b"order", authority.as_ref(), &order_id.to_le_bytes()]`          | `Order`                       |
| trading      | `[b"nullifier", user.as_ref(), &order_id_16_bytes]`                | `OrderNullifier` (off-chain)  |
| trading      | `[b"trade", buy_order.as_ref(), sell_order.as_ref()]`              | `TradeRecord`                 |

Notice the two distinct meter seed conventions: **oracle** uses `[b"meter", meter_id]` (meter-id only, because the oracle's AMI gateway identifies meters by serial), while **registry** uses `[b"meter", owner, meter_id]` (owner-scoped, because the same physical meter is always paired with a registered user). Don't unify these.

## Build & test

```bash
# Build all programs (from workspace root)
anchor build

# Feature-gated compute profiling
anchor build -- --features localnet

# Tests defined as scripts in Anchor.toml
anchor run test-oracle       # → anchor test tests/oracle.ts
anchor run test-registry     # → anchor test tests/registry_sharding.ts
```

Startup: `Anchor.toml` sets `startup_wait = 10000` and `shutdown_wait = 2000` — if you add a program that takes longer to deploy, bump `startup_wait`.

Release profile (in workspace `Cargo.toml`) uses `lto = "fat"`, `codegen-units = 1`, `opt-level = 3`, `strip = true`, `panic = "abort"`, and `overflow-checks = true`. Overflow checks are ON in release — `saturating_*` / `checked_*` arithmetic is not optional, it's enforced. Keep every arithmetic operation explicit.

## Common tasks

**Adding a new instruction to an existing program:**

1. Add a handler function (put complex logic in `handlers/<name>.rs` for governance; inline in `lib.rs` for the others — match the program's existing style)
2. Add the `#[derive(Accounts)]` context struct
3. Wrap the body in `compute_fn!("name" => { ... })`
4. Hoist `Clock::get()?.unix_timestamp` before any `emit!`
5. If it writes to a global config account, stop and check invariant #6 — most new write-heavy instructions should target a per-entity PDA instead
6. If `blockchain-core` needs to call it, compute the discriminator (`sha256("global:<ix_name>")[..8]`) and add a builder in `gridtokenx-blockchain-core/src/rpc/instructions.rs`

**Adding a field to an existing zero-copy struct:**

This is a breaking change — the account size grows and existing on-chain data becomes unreadable. Unless you're resetting localnet, you need to:

1. Add the field with correct alignment + padding
2. Update `std::mem::size_of::<T>()` everywhere the struct is `init`'d (it's implicit, but verify)
3. For structs with manual `LEN` constants (`ErcCertificate::LEN`, `PoAConfig::LEN`), update the constant
4. For production: write a migration instruction that realloc's existing accounts and zero-initializes the new field — do not assume `init_if_needed` will save you

**Wiring a new CPI between programs:**

Follow the `registry → energy-token` pattern in `registry/Cargo.toml` and `registry::settle_and_mint_tokens`:

1. Add `<target-program> = { path = "../<target>", features = ["cpi"] }` to the caller's `Cargo.toml`
2. In the caller, build `CpiContext::new_with_signer` with the caller's PDA as authority and the correct PDA-signer seeds
3. Import `<target>::cpi::accounts::<IxName>` and `<target>::cpi::<ix_name>` — **do not** hand-roll the instruction bytes
4. If the target checks a stored authority (like `TokenInfo::registry_authority`), make sure the caller's signer matches that exact key

## Known rough edges (don't "fix" without discussion)

- `registry::settle_and_mint_tokens` signs with `b"registry"` seeds but passes `ctx.accounts.registry` as BOTH `authority` AND `registry_authority` to `mint_tokens_direct`. This is correct given the current `energy-token` validation but looks suspicious. Leave it.
- `trading::lib.rs` inlines auction-clearing types (`AuctionOrder`, `CurvePoint`, `AuctionMatch`, `MatchPair`) at module scope with a comment about "Anchor macro issues" — don't move them into `state/`.
- `trading::lib.rs` has the `#[program]` module contain all context structs as nested items (`InitializeProgram`, `InitializeMarketContext`, ...). This is unconventional Anchor layout but it's how the trading program happens to be structured. The `instructions/` submodule contexts (`InitializeMarketShardContext`, `SettleOffchainMatchContext`, etc.) live outside and are imported via glob — match whichever pattern the surrounding code uses.
- `MarketShard` is declared in `trading/src/state/market.rs` but is currently only populated by `settle_offchain_match` / `batch_settle_offchain_match`. The `clearing_enabled`, `locked` (re-entrancy), `active_orders`, and `total_trades` fields on `Market` still exist for on-chain CDA matching — the shard and direct-write paths are deliberately running in parallel during the migration.
- `MeterState` in oracle has no registry link — the oracle doesn't verify the meter is registered. Authentication is purely via `oracle_data.api_gateway` = signer. If you need registry-side checks, add them upstream in the gateway service, not in the oracle program.
- The `zone_id` field appears in `MeterState`, `OffchainOrderPayload`, and `ZoneMarket` with different types (`i32`, `u32`, `u32` respectively). Don't unify — the signed/unsigned choice reflects that oracle meters may have a sentinel `-1` for "unassigned" while trading zones are always valid.

## When the user asks about performance / TPS

Point at these levers in order:

1. **Write-lock contention on the main `Market` account** — biggest offender historically. The fix is to finish migrating updates out of `Market` into `MarketShard` / `ZoneMarketShard`. See the `_padding_depth_*` fields in `Market` — those are leftover slots from the depth arrays that moved to `ZoneMarket`.
2. **`OracleData` global counters** — fixed by `aggregate_readings`. Every per-reading write goes to `MeterState` now.
3. **Compute budget per tx** — default 200k is tight for `execute_atomic_settlement` (5 CPIs) and `batch_settle_offchain_match` (up to 4 matches × 3 CPIs). Raise via `ComputeBudgetInstruction::set_compute_unit_limit` in the client, not in the program.
4. **Transaction size limit (1232 bytes)** — `MAX_DEPTH_LEVELS = 10` in `trading/src/state/zone_market.rs` is tuned for this. Don't raise it without recalculating the `update_depth` Vec payload size.
