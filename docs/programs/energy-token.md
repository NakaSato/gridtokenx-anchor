# Energy Token Program

## Abstract

The `energy-token` program is the on-chain token issuance and lifecycle authority for the GridTokenX peer-to-peer energy-trading platform. It manages the GRID energy token — an SPL Token-2022 mint under a program-derived authority — and exposes minting, transfer, and burn instructions that wrap the SPL `token_interface` Cross-Program Invocation (CPI) layer. Token creation is gated by a configurable set of Renewable Energy Certificate (REC) validators whose co-signature attests the energy provenance of each mint, and by an idempotency mechanism that guarantees exactly-once minting per metering settlement window. The program is designed for Sealevel parallelism: high-frequency mint and burn paths treat the global configuration account as read-only and reconcile the stored total supply lazily through a dedicated synchronization instruction.

## 1. Program Identity

| Property | Value |
| --- | --- |
| Program ID | `6FZKcVKCLFSNLMxypFJGU4K14xUBnxNW9VAuKGhmqjGX` |
| Crate name | `energy-token` (lib name `energy_token`) |
| Crate version | `0.1.1` |
| `anchor-lang` | `1.0.0` (feature `init-if-needed`) |
| `anchor-spl` | `1.0.0` (feature `metadata`) |

The program ID is declared via `declare_id!("6FZKcVKCLFSNLMxypFJGU4K14xUBnxNW9VAuKGhmqjGX")` at `programs/energy-token/src/lib.rs:48`, and matches the `Anchor.toml` localnet entry `energy_token = "6FZKcVKCLFSNLMxypFJGU4K14xUBnxNW9VAuKGhmqjGX"` (`Anchor.toml:9`).

Crate metadata and dependency versions are defined in `programs/energy-token/Cargo.toml`: `anchor-lang = "1.0.0"` with `init-if-needed` (`Cargo.toml:24`), `anchor-spl = "1.0.0"` with the `metadata` feature (`Cargo.toml:25`), `spl-token = "4.0.0"` (`Cargo.toml:26`), `mpl-token-metadata = "5.1.2-alpha.2"` (`Cargo.toml:27`), `bytemuck` with the `derive` feature for the zero-copy state (`Cargo.toml:28`), and an optional path dependency on the in-repo `compute-debug` crate for compute-unit profiling (`Cargo.toml:29`).

### Dependency and feature notes

- The program declares no CPI path dependency on other GridTokenX programs; it is a leaf in the CPI graph and is *invoked by* other programs rather than invoking them (see §6).
- The `cpi` feature enables `no-entrypoint` (`Cargo.toml:13`), allowing other programs to depend on this crate as a CPI client library.
- The `localnet` feature enables `compute-debug/localnet` (`Cargo.toml:21`), which activates the `compute_fn!` / `compute_checkpoint!` profiling macros; in non-localnet builds these expand to no-ops (`lib.rs:37-46`).
- The release profile enforces `overflow-checks = true` (`Cargo.toml:33-34`) so that arithmetic on the SBF target panics on overflow rather than silently wrapping.
- Metaplex token metadata is created through `mpl_token_metadata::instructions::CreateV1CpiBuilder` (`lib.rs:20`, `lib.rs:81`).

## 2. System Role

The `energy-token` program is the token layer of the GridTokenX P2P energy-trading platform. In the platform's economics, one kilowatt-hour of metered, validated generation corresponds to one GRID token, the energy-backed unit of account. The program owns the GRID mint authority through a program-derived address (PDA) and is the only entity able to authorize minting, ensuring that GRID supply cannot be created outside the program's REC-gating and idempotency rules.

The program participates in two principal flows:

1. **Generation minting.** The Aggregator Bridge, after aggregating 15-minute metering windows, drives GRID issuance to producers. The idempotent `mint_generation` instruction is the authoritative exactly-once entry point for this path (`lib.rs:181`), keyed on `(meter_id, window_start_ms)`.
2. **Registry-driven minting.** The registry program (or the configured `registry_authority`) may mint GRID to users via `mint_tokens_direct` (`lib.rs:392`), with authorization checked against the stored `registry_authority` recorded in the program configuration.

The GRID mint is created as an SPL Token-2022 mint with 9 decimals (`mint::decimals = 9` at `lib.rs:639`), under PDA seed `[b"mint_2022"]` (`lib.rs:637`), and is used through the `anchor_spl::token_interface` abstraction so that the program operates against either the legacy SPL Token or Token-2022 program at runtime (`lib.rs:12-19`). The token transfer instruction enforces a checked transfer with the fixed 9-decimal scale (`token_interface::transfer_checked(cpi_ctx, amount, 9)` at `lib.rs:360`).

> Note on naming: the source crate description (`Cargo.toml:4`) and several comments and metadata helpers refer to the token as "GRX" (e.g. the `create_token_mint` doc comment at `lib.rs:60`). The platform-level documentation distinguishes GRID (energy-backed, 1 kWh = 1 GRID) from GRX (the platform utility/governance token). This program holds a single 9-decimal mint under `[b"mint_2022"]`; the source uses the GRID and GRX labels interchangeably for that mint, and this document treats the managed asset as the GRID energy token per the platform model. This terminological overlap is a documentation ambiguity in the source, not two distinct mints.

### REC-validator gating

A Renewable Energy Certificate (REC) validator is an authorized signer whose co-signature attests that the energy underlying a mint corresponds to a valid certificate. The program stores up to five REC-validator public keys in its configuration (`state.rs:15`). The REC co-signature gate is **mandatory on every mint path** — `mint_to_wallet`, `mint_generation`, and `mint_tokens_direct` each require a registered REC validator to co-sign (`lib.rs:120-139`, `lib.rs:210-227`, `lib.rs:405-410`). The earlier backward-compatibility allowance (when the registered count was zero, mints proceeded without a co-signer) has been **removed**: a freshly initialized token cannot mint at all until at least one validator is registered via `add_rec_validator`, because a zero count means no key can match and the membership check rejects (`RecValidatorNotFound`).

The membership check itself is centralized in a single free function, `rec_validator_registered(token_info, key)` (`lib.rs:54-56`), the single source of truth for the REC gate. It returns `true` iff `key` is one of the registered validators, scanning only the populated prefix (`rec_validators[..rec_validators_count]`). Every mint path calls it, so the check can never drift between paths.

## 3. State Model

The program defines two persistent account types.

### 3.1 `TokenInfo` (global configuration)

`TokenInfo` is the singleton global configuration account. It is a zero-copy account: `#[account(zero_copy)] #[repr(C)]` (`state.rs:6-7`), loaded through `AccountLoader` and accessed via `load()` / `load_mut()` / `load_init()`.

- **PDA seeds:** `[b"token_info_2022"]` (`lib.rs:629`).
- **Account space:** `8 + std::mem::size_of::<TokenInfo>()` (`lib.rs:628`) — the 8-byte Anchor discriminator plus the Pod struct size.

| Field | Type | Bytes | Description |
| --- | --- | --- | --- |
| `authority` | `Pubkey` | 32 | Program admin; authorized for config and admin mints (`state.rs:9`). |
| `registry_authority` | `Pubkey` | 32 | Authority permitted to drive `mint_tokens_direct` (`state.rs:10`). |
| `registry_program` | `Pubkey` | 32 | Recorded registry program ID (`state.rs:11`). |
| `mint` | `Pubkey` | 32 | The canonical GRID mint address (`state.rs:12`). |
| `total_supply` | `u64` | 8 | Lazily synchronized supply cache; not written on hot paths (`state.rs:13`). |
| `created_at` | `i64` | 8 | Initialization timestamp (`state.rs:14`). |
| `rec_validators` | `[Pubkey; 5]` | 160 | Registered REC-validator keys (`state.rs:15`). |
| `rec_validators_count` | `u8` | 1 | Number of active validators (0–5) (`state.rs:16`). |
| `_padding` | `[u8; 7]` | 7 | Manual alignment padding (`state.rs:17`). |

The total Pod payload is 312 bytes (32×4 + 8 + 8 + 160 + 1 + 7), so the on-chain account size is `8 + 312 = 320` bytes.

### 3.2 `GenerationMintRecord` (per-window idempotency guard)

`GenerationMintRecord` is a regular (Borsh-serialized) `#[account]` (`state.rs:26`), one PDA per metering settlement window, used to make generation minting exactly-once.

- **PDA seeds:** `[b"gen_mint", meter_id, window_start_ms.to_le_bytes()]` (`lib.rs:605`, documented at `state.rs:24-25`).
- **Account space:** `8 + GenerationMintRecord::LEN` (`lib.rs:604`), where `LEN = 16 + 8 + 8 + 1 + 1 = 34` (`state.rs:37`), for a total account size of 42 bytes.
- **Creation:** `init_if_needed` so the first mint creates the record and a replay finds it already present (`lib.rs:601-607`).

| Field | Type | Bytes | Description |
| --- | --- | --- | --- |
| `meter_id` | `[u8; 16]` | 16 | Settlement meter UUID bytes (`state.rs:28`). |
| `window_start_ms` | `i64` | 8 | 15-minute window start, ms since epoch (`state.rs:29`). |
| `amount` | `u64` | 8 | Atomic GRID amount minted for this window (`state.rs:30`). |
| `minted` | `bool` | 1 | `true` once the mint CPI succeeded (`state.rs:31`). |
| `bump` | `u8` | 1 | PDA bump (`state.rs:32`). |

## 4. Instruction Set

The program module is `energy_token` (`lib.rs:51`). Each handler body is wrapped in `compute_fn!` for compute-unit profiling under the `localnet` feature.

### 4.1 `initialize`

A no-op bootstrap instruction (`lib.rs:54-58`). The sole account is `authority: Signer` (`lib.rs:492-495`). It performs no state changes, emits no events, and produces no error paths.

### 4.2 `initialize_token`

Creates and initializes the program state (`lib.rs:268-286`).

- **Parameters:** `registry_program_id: Pubkey`, `registry_authority: Pubkey`.
- **Signers:** `authority` (also the rent payer) (`lib.rs:645-646`).
- **Accounts:** initializes the `token_info` PDA at `[b"token_info_2022"]` (`lib.rs:625-632`) and the GRID `mint` PDA at `[b"mint_2022"]` with 9 decimals and mint authority set to the `token_info` PDA (`lib.rs:634-643`).
- **State effects:** sets `authority`, `registry_authority`, `registry_program`, `mint`, `total_supply = 0`, `created_at`, `rec_validators_count = 0`, and `rec_validators = [default; 5]` (`lib.rs:276-283`), loading the account with `load_init()` (`lib.rs:275`).
- **Events:** none. **Error paths:** standard Anchor account/`init` constraints.

### 4.3 `create_token_mint`

Attaches Metaplex metadata to the existing GRID mint (`lib.rs:62-103`).

- **Parameters:** `name: String`, `symbol: String`, `uri: String`.
- **Signers:** `payer`, `authority` (`lib.rs:517`, `lib.rs:519`).
- **Accounts:** `mint` (constrained to equal `token_info.mint`, `lib.rs:499-503`), `token_info` (constrained so `authority` equals the stored admin, `lib.rs:505-510`), an unchecked `metadata` account, the Metaplex `metadata_program`, and the instructions sysvar constrained to the canonical `IX_ID` address (`lib.rs:526-528`). The `IX_ID` constant is the corrected Instructions-sysvar address (`lib.rs:7-10`).
- **State effects:** if the metadata program account is executable, issues a `CreateV1` CPI signed by the `token_info` PDA (seed `[b"token_info_2022"]`) as mint authority, creating a `Fungible` token-standard metadata record with 9 decimals and zero seller-fee basis points (`lib.rs:72-100`). This branch is unexercised on localnet (no Metaplex program loaded) and is verified only by compilation (`lib.rs:78-79`).
- **Events:** none. **Error paths:** `UnauthorizedAuthority` if the mint or authority constraints fail (`lib.rs:501`, `lib.rs:508`).

### 4.4 `mint_to_wallet`

Mints GRID to a destination token account (`lib.rs:106-165`).

- **Parameters:** `amount: u64`.
- **Signers:** `authority` (must equal `token_info.authority`, `lib.rs:120-123`), `payer`, and `rec_validator: Option<Signer>` (`lib.rs:559`). The signer is typed `Option` only so a missing co-signer surfaces as `RecValidatorNotFound` rather than a coarse "not enough keys"; it is **not** optional in policy — the handler rejects `None` (`lib.rs:130-135`).
- **Accounts:** `mint` (constrained to `token_info.mint`), `token_info` PDA, `destination` token account (constrained `token::mint = mint`, `token::authority = destination_owner`), `destination_owner` (unchecked), and the token, associated-token, and system programs (`lib.rs:531-567`).
- **Preconditions:** the supplied `rec_validator` is **mandatory** — `None` is rejected with `RecValidatorNotFound`, and the key must be listed in `rec_validators` per `rec_validator_registered` (`lib.rs:120-139`).
- **State effects:** issues a Token-2022 `mint_to` CPI signed by the `token_info` PDA (seed `[b"token_info_2022"]`, `lib.rs:145-154`). `total_supply` is deliberately not updated here (`lib.rs:160-161`).
- **Events:** `TokensMinted { recipient, amount, timestamp }` (`lib.rs:163-167`).
- **Error paths:** `UnauthorizedAuthority` (`lib.rs:122`), `RecValidatorNotFound` (`lib.rs:135`, `lib.rs:138`).

### 4.5 `mint_generation`

Idempotent generation mint keyed by `(meter_id, window_start_ms)` (`lib.rs:181-265`).

- **Parameters:** `meter_id: [u8; 16]`, `window_start_ms: i64`, `amount: u64`.
- **Signers:** `authority`, `payer`, `rec_validator: Option<Signer>` (`lib.rs:614`) — `Option`-typed for the same error-shaping reason as `mint_to_wallet`, but **mandatory** in policy (the handler rejects `None`).
- **Accounts:** identical mint accounts to `mint_to_wallet`, plus the `mint_record` PDA at `[b"gen_mint", meter_id, window_start_ms.to_le_bytes()]` created with `init_if_needed` (`lib.rs:585-621`).
- **Preconditions and ordering:**
  1. **Idempotency short-circuit first.** If `mint_record.minted` is already `true`, the instruction returns `Ok(())` as a no-op, never re-running the CPI (`lib.rs:190-192`).
  2. **Window alignment.** `window_start_ms` must be positive and a multiple of `900_000` ms (15 minutes); otherwise `MisalignedWindow` (`lib.rs:198-201`).
  3. **Authority and REC checks** identical to `mint_to_wallet` — the mandatory `rec_validator` co-signer and `rec_validator_registered` membership check (`lib.rs:208-228`).
- **State effects:** mints via Token-2022 `mint_to` signed by the `token_info` PDA (`lib.rs:231-246`), and only *after* a successful mint stamps the record (`meter_id`, `window_start_ms`, `amount`, `minted = true`, `bump`) so a failed mint leaves the window retryable (`lib.rs:248-256`).
- **Events:** `TokensMinted { recipient, amount, timestamp }` (`lib.rs:258-262`).
- **Error paths:** `MisalignedWindow` (`lib.rs:205`), `UnauthorizedAuthority` (`lib.rs:212`), `RecValidatorNotFound` (`lib.rs:223`, `lib.rs:226`). The idempotency design is per-instruction (not per-transaction) so a replayed recipient batched with fresh ones no-ops without aborting the whole transaction (`lib.rs:184-185`).

### 4.6 `mint_tokens_direct`

Registry/admin mint path optimized for Sealevel parallelism (`lib.rs:392-448`).

- **Parameters:** `amount: u64`.
- **Signers:** `authority`, and a mandatory `rec_validator: Signer` (`lib.rs:725`).
- **Accounts:** `token_info` PDA (read-only, no write lock, `lib.rs:691-697`), `mint` (constrained to `token_info.mint`), `user_token_account` (bound `token::mint = mint`, `token::token_program = token_program` — defense-in-depth parity with the `destination` binding on the other mint paths; the `mint_to` CPI already rejects a wrong-mint account, but the constraint fails earlier in account validation, `lib.rs:709-714`), and a `registry_authority` unchecked account constrained to equal the stored `registry_authority` (`lib.rs:718-722`).
- **Preconditions:** authorization succeeds if the signer is either the admin (`token_info.authority`) or the `registry_authority` (`lib.rs:397-401`). The `rec_validator` co-signer is **mandatory** and must be a registered validator per `rec_validator_registered` (`lib.rs:405-410`).
- **State effects:** mints via `mint_to` signed by the `token_info` PDA (`lib.rs:419-431`); `total_supply` is not updated (`lib.rs:434`).
- **Events:** `GridTokensMinted { meter_owner, amount, timestamp }` (`lib.rs:436-442`). Note `meter_owner` emits `user_token_account.owner` — the recipient **wallet**, not the token-account address — because downstream REC/provenance consumers key on the owner (`lib.rs:439`).
- **Error paths:** `UnauthorizedAuthority` (`lib.rs:401`, plus the `registry_authority` constraint at `lib.rs:720`), `RecValidatorNotFound` (`lib.rs:407`).

The REC gate is **mandatory on all three mint paths** — `mint_tokens_direct` is no longer distinguished from `mint_to_wallet` / `mint_generation` in this respect. The only typing difference is that `rec_validator` is a plain `Signer` here (`lib.rs:725`) rather than the `Option<Signer>` used on the other two paths; in all three, a registered co-signer is required and an unregistered or absent one is rejected with `RecValidatorNotFound`.

### 4.7 `transfer_tokens`

Transfers GRID between token accounts (`lib.rs:348-365`).

- **Parameters:** `amount: u64`. **Signer:** `from_authority` (`lib.rs:671`).
- **Accounts:** `from_token_account`, `to_token_account`, `mint`, token program (`lib.rs:662-674`).
- **State effects:** issues `transfer_checked` with a fixed 9-decimal scale (`lib.rs:360`).
- **Events:** none. **Error paths:** SPL token program errors (e.g. insufficient balance, mint mismatch).

### 4.8 `burn_tokens`

Burns GRID to represent energy consumption (`lib.rs:368-385`).

- **Parameters:** `amount: u64`. **Signer:** `authority` (`lib.rs:684`).
- **Accounts:** `mint`, `token_account`, token program (`lib.rs:676-687`).
- **State effects:** issues a `burn` CPI (`lib.rs:379`); `total_supply` is not updated (`lib.rs:382`).
- **Events:** none. **Error paths:** SPL token program errors.

### 4.9 `sync_total_supply`

Reconciles the cached `total_supply` with the canonical SPL mint supply (`lib.rs:455-476`).

- **Signer:** `authority` (must equal `token_info.authority`, `lib.rs:459-462`).
- **Accounts:** `token_info` PDA (mutable), `mint` (constrained to `token_info.mint`) (`lib.rs:721-736`).
- **State effects:** sets `token_info.total_supply = mint.supply` (`lib.rs:464-465`).
- **Events:** `TotalSupplySynced { authority, supply, timestamp }` (`lib.rs:469-473`).
- **Error paths:** `UnauthorizedAuthority` (`lib.rs:461`).

### 4.10 `add_rec_validator`

Registers a REC validator (`lib.rs:289-316`).

- **Parameters:** `validator_pubkey: Pubkey`, `_authority_name: String` (the name parameter is unused beyond the signature).
- **Signer:** `authority`, with a `has_one = authority` constraint on `token_info` (`lib.rs:655`).
- **State effects:** appends `validator_pubkey` and increments `rec_validators_count` (`lib.rs:311-313`).
- **Error paths:** `MaxValidatorsReached` if the count is already 5 (`lib.rs:298-301`); `ValidatorAlreadyExists` if the key is present (`lib.rs:304-308`).

### 4.11 `remove_rec_validator`

Removes a REC validator using swap-remove to keep the array dense (`lib.rs:322-345`). It reuses the `AddRecValidator` account context (`lib.rs:323`), so it requires the admin signer via `has_one = authority`.

- **Parameter:** `validator_pubkey: Pubkey`.
- **State effects:** finds the target, swaps it with the last entry, clears the last slot, and decrements the count (`lib.rs:339-342`).
- **Error paths:** `RemoveValidatorNotFound` if the key is not registered (`lib.rs:337`).

### 4.12 `set_registry_authority`

Updates the stored registry authority (`lib.rs:479-488`).

- **Parameter:** `new_registry_authority: Pubkey`. **Signer:** `authority` (must equal `token_info.authority`, `lib.rs:481-484`).
- **State effects:** sets `token_info.registry_authority` (`lib.rs:486`).
- **Events:** none. **Error paths:** `UnauthorizedAuthority` (`lib.rs:483`).

## 5. Invariants & Security Properties

1. **Mint authority is the `token_info` PDA.** The GRID mint is created with `mint::authority = token_info` (`lib.rs:640`), and every mint CPI signs with the seed `[b"token_info_2022"]` and the stored bump (`lib.rs:146-149`, `lib.rs:236-237`, `lib.rs:424-425`). No external key can mint GRID; only the program, acting under that PDA, can.

2. **REC provenance gating is mandatory on every mint path.** All three minting instructions require the supplied REC validator to be a member of `rec_validators`, checked through the shared `rec_validator_registered` helper (`lib.rs:120-139`, `lib.rs:208-227`, `lib.rs:405-410`). This couples GRID issuance to certificate attestation with no opt-out: the former backward-compatibility allowance (mints permitted without a co-signer while the validator count was zero) has been removed, so a freshly initialized token cannot mint until at least one validator is registered (count 0 ⇒ no key matches ⇒ `RecValidatorNotFound`).

3. **Authorization is constrained on every privileged instruction.** Admin-gated instructions check `authority == token_info.authority` either via in-handler `require!` or via account constraints (`lib.rs:110-113`, `lib.rs:206`, `lib.rs:459-462`, `lib.rs:481-484`, `has_one` at `lib.rs:655`). `mint_tokens_direct` additionally accepts the configured `registry_authority` and constrains the supplied `registry_authority` account against the stored value (`lib.rs:397-401`, `lib.rs:709-713`).

4. **Exactly-once generation minting.** The `GenerationMintRecord` PDA keyed on `(meter_id, window_start_ms)` plus the early `minted` short-circuit (`lib.rs:190-192`) guarantee that a replay of a settled window is a no-op rather than a double-mint. The record is stamped only after a successful CPI (`lib.rs:248-256`), so a failed mint leaves the window retryable. This is the authoritative exactly-once guard; the Aggregator Bridge's Redis `MINTED_SET` is only a fast path (`lib.rs:172-176`).

5. **Window alignment.** `mint_generation` requires `window_start_ms` to be a positive multiple of 900,000 ms, matching the oracle's 15-minute epoch boundary in seconds (`lib.rs:198-201`), rejecting unaligned or garbage windows before any mint.

6. **Supply accounting is lazily reconciled.** Hot-path mint and burn instructions deliberately do not write `total_supply` (`lib.rs:155-156`, `lib.rs:382`, `lib.rs:439`); the field is reconciled to the canonical SPL mint supply only via `sync_total_supply` (`lib.rs:464-465`). The cached `total_supply` is therefore stale on purpose between syncs; the canonical SPL `Mint.supply` is the source of truth. This is a Sealevel optimization that keeps `token_info` read-only on minting/burning paths (`lib.rs:691` marks it read-only in `MintTokensDirect`).

7. **Overflow checking.** The release profile sets `overflow-checks = true` (`Cargo.toml:33-34`), so SBF arithmetic panics rather than wrapping. The `rec_validators_count` increment/decrement (`lib.rs:313`, `lib.rs:342`) is additionally bounded by the explicit `< 5` and swap-remove logic.

8. **Zero-copy state discipline.** `TokenInfo` is `#[account(zero_copy)] #[repr(C)]` with manual `_padding: [u8; 7]` for 8-byte alignment (`state.rs:6-17`) and is accessed only through `AccountLoader` (`load`/`load_mut`/`load_init`). Adding fields requires re-counting the padding.

## 6. Cross-Program Interfaces (CPI)

### Calls made by this program

- **SPL token interface** (`anchor_spl::token_interface`): `mint_to`, `transfer_checked`, and `burn` CPIs to the active token program (legacy SPL Token or Token-2022) selected at runtime via `Interface<'info, TokenInterface>` (`lib.rs:14-18`, `lib.rs:152`, `lib.rs:360`, `lib.rs:379`).
- **Metaplex Token Metadata** (`mpl_token_metadata`): a `CreateV1` CPI to attach fungible-token metadata, signed by the `token_info` PDA (`lib.rs:81-97`). This path runs only when the metadata program account is executable, which does not occur on localnet (`lib.rs:72`, `lib.rs:78-79`).

### Calls made into this program

The crate exposes the `cpi` feature (`Cargo.toml:13`) so other programs can invoke it as a CPI client. Per the repository's CPI graph documentation, the registry program performs `registry → energy-token` CPI for user-driven minting; `mint_tokens_direct` is the entry point, authorized against the stored `registry_authority` (`lib.rs:397-401`, `lib.rs:709-713`). The Aggregator Bridge (off-chain) drives `mint_generation` for settlement-window issuance. This program does not perform a CPI back into the registry, treasury, or governance programs; it is a leaf in the platform's CPI graph.

## 7. Events

Defined in `programs/energy-token/src/events.rs`.

| Event | Fields | Emitted by / when |
| --- | --- | --- |
| `GridTokensMinted` | `meter_owner: Pubkey`, `amount: u64`, `timestamp: i64` (`events.rs:5-10`) | `mint_tokens_direct` after a successful mint; `meter_owner` carries `user_token_account.owner` (the recipient wallet), not the token-account key (`lib.rs:436-442`). |
| `TokensMinted` | `recipient: Pubkey`, `amount: u64`, `timestamp: i64` (`events.rs:12-17`) | `mint_to_wallet` (`lib.rs:163-167`) and `mint_generation` (`lib.rs:258-262`) after a successful mint. |
| `TotalSupplySynced` | `authority: Pubkey`, `supply: u64`, `timestamp: i64` (`events.rs:19-24`) | `sync_total_supply` after updating the cached supply (`lib.rs:466-470`). |

In every emitting handler the timestamp is hoisted via `let now = Clock::get()?.unix_timestamp;` before the `emit!` macro, avoiding a sysvar syscall inside macro expansion (`lib.rs:143`, `lib.rs:230`, `lib.rs:416`, `lib.rs:465`).

## 8. Error Codes

Defined in `programs/energy-token/src/error.rs` as `EnergyTokenError`.

| Variant | Message | Meaning |
| --- | --- | --- |
| `UnauthorizedAuthority` | "Unauthorized authority" | Signer is neither the admin nor (where applicable) the configured registry authority (`error.rs:7-8`). |
| `InvalidMeter` | "Invalid meter" | Defined but not referenced by current handlers (`error.rs:9-10`). |
| `InsufficientBalance` | "Insufficient token balance" | Defined; balance enforcement is delegated to the SPL token program (`error.rs:11-12`). |
| `InvalidMetadataAccount` | "Invalid metadata account" | Defined for metadata validation (`error.rs:13-14`). |
| `NoUnsettledBalance` | "No unsettled balance" | Defined but not referenced by current handlers (`error.rs:15-16`). |
| `UnauthorizedRegistry` | "Unauthorized registry program" | Defined; registry authorization currently uses `UnauthorizedAuthority` (`error.rs:17-18`). |
| `ValidatorAlreadyExists` | "Validator already exists in the list" | `add_rec_validator` rejects a duplicate key (`error.rs:19-20`, `lib.rs:307`). |
| `MaxValidatorsReached` | "Maximum number of validators reached" | `add_rec_validator` rejects when count is 5 (`error.rs:21-22`, `lib.rs:300`). |
| `RecValidatorNotFound` | "REC validator not found in the registered list" | A required REC co-signer is missing or not registered — raised on all three mint paths (`error.rs:23-24`, `lib.rs:135`, `lib.rs:223`, `lib.rs:407`). |
| `RemoveValidatorNotFound` | "Validator to remove not found in the registered list" | `remove_rec_validator` could not find the key (`error.rs:25-26`, `lib.rs:337`). |
| `MisalignedWindow` | "Window start must be a positive 15-minute (900_000 ms) boundary" | `mint_generation` window-alignment check failed (`error.rs:27-28`, `lib.rs:200`). |

Several variants (`InvalidMeter`, `InsufficientBalance`, `InvalidMetadataAccount`, `NoUnsettledBalance`, `UnauthorizedRegistry`) are declared but not currently raised by any handler; they are part of the error vocabulary but presently unused.

## 9. Testing

The program's TypeScript bindings are generated to `target/types/energy_token` and imported as `EnergyToken` in the test suites (e.g. `tests/generation_mint_idempotency.ts:3`, `tests/bootstrap_token2022.ts:4`).

| Test file | Coverage |
| --- | --- |
| `tests/generation_mint_idempotency.ts` | Exercises `mint_generation`: asserts the per-`(meter, window)` `GenerationMintRecord` PDA makes a replay a no-op and prevents double-minting (`tests/generation_mint_idempotency.ts:20-25`). |
| `tests/bootstrap_token2022.ts` | Verifies the GRID/GRX mint and downstream accounts are wired to the canonical Token-2022 program ID `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` (`tests/bootstrap_token2022.ts:15-19`). |

Related scripts that drive the program against a live validator include `scripts/bootstrap.ts`, `scripts/mint-tokens.ts`, `scripts/mint-to-owners.ts`, `scripts/sync-supply.ts`, and `scripts/simulate-token-lifecycle.ts` (all reference the `energy_token` program type).

### Commands

```bash
# Build all programs (energy-token among them)
anchor build

# Run the generation-mint idempotency suite directly (validator must be running)
npx mocha -r tsx tests/generation_mint_idempotency.ts --timeout 1000000

# Run the Token-2022 bootstrap suite
npx mocha -r tsx tests/bootstrap_token2022.ts --timeout 1000000

# Standalone/CI runner
./scripts/run-tests.sh
```

There is no dedicated `npm run test:*` script scoped to the energy-token program in `package.json`; the named scripts target the oracle, registry, staking, governance, treasury, and benchmark suites. The energy-token tests are run via raw mocha or the `run-tests.sh` runner as shown above.
