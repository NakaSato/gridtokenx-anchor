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

The program ID is declared via `declare_id!("6FZKcVKCLFSNLMxypFJGU4K14xUBnxNW9VAuKGhmqjGX")` at `programs/energy-token/src/lib.rs:61`, and matches the `Anchor.toml` localnet entry `energy_token = "6FZKcVKCLFSNLMxypFJGU4K14xUBnxNW9VAuKGhmqjGX"` (`Anchor.toml:9`).

Crate metadata and dependency versions are defined in `programs/energy-token/Cargo.toml`: `anchor-lang = "1.0.0"` with `init-if-needed` (`Cargo.toml:24`), `anchor-spl = "1.0.0"` with the `metadata` feature (`Cargo.toml:25`), `spl-token = "4.0.0"` (`Cargo.toml:26`), `mpl-token-metadata = "5.1.2-alpha.2"` (`Cargo.toml:27`), `bytemuck` with the `derive` feature for the zero-copy state (`Cargo.toml:28`), and an optional path dependency on the in-repo `compute-debug` crate for compute-unit profiling (`Cargo.toml:29`).

### Dependency and feature notes

- The program declares no CPI path dependency on other GridTokenX programs; it is a leaf in the CPI graph and is *invoked by* other programs rather than invoking them (see §6). The governance program ID is hardcoded as `GOVERNANCE_PROGRAM_ID` (`lib.rs:27`) rather than imported, because an `energy-token → governance` path dependency would cycle through `registry`; the governance authority is instead validated by raw owner/PDA/byte checks (`lib.rs:33-40`).
- The `cpi` feature enables `no-entrypoint` (`Cargo.toml:13`), allowing other programs to depend on this crate as a CPI client library.
- The `localnet` feature enables `compute-debug/localnet` (`Cargo.toml:21`), which activates the `compute_fn!` / `compute_checkpoint!` profiling macros; in non-localnet builds these expand to no-ops (`lib.rs:48-59`).
- The release profile enforces `overflow-checks = true` (`Cargo.toml:33-34`) so that arithmetic on the SBF target panics on overflow rather than silently wrapping.
- Metaplex token metadata is created through `mpl_token_metadata::instructions::CreateV1CpiBuilder` (`instructions/create_token_mint.rs:5`, `instructions/create_token_mint.rs:80`).

## 2. System Role

The `energy-token` program is the token layer of the GridTokenX P2P energy-trading platform. In the platform's economics, one kilowatt-hour of metered, validated generation corresponds to one GRID token, the energy-backed unit of account. The program owns the GRID mint authority through a program-derived address (PDA) and is the only entity able to authorize minting, ensuring that GRID supply cannot be created outside the program's REC-gating and idempotency rules.

The program participates in two principal flows:

1. **Generation minting.** The Aggregator Bridge, after aggregating 15-minute metering windows, drives GRID issuance to producers. The idempotent `mint_generation` instruction is the authoritative exactly-once entry point for this path (`instructions/mint_generation.rs:89`), keyed on `(meter_id, window_start_ms)`.
2. **Registry-driven minting.** The registry program (or the configured `registry_authority`) may mint GRID to users via `mint_tokens_direct` (`instructions/mint_tokens_direct.rs:62`), with authorization checked against the stored `registry_authority` recorded in the program configuration.

The GRID mint is created as an SPL Token-2022 mint with 9 decimals (`mint::decimals = 9` at `instructions/initialize_token.rs:22`), under PDA seed `[b"mint_2022"]` (`instructions/initialize_token.rs:20`), and is used through the `anchor_spl::token_interface` abstraction so that the program operates against either the legacy SPL Token or Token-2022 program at runtime (`instructions/mint_to_wallet.rs:2-8`). The token transfer instruction enforces a checked transfer with the fixed 9-decimal scale (`token_interface::transfer_checked(cpi_ctx, amount, 9)` at `instructions/transfer_tokens.rs:39`).

> Note on naming: the source crate description (`Cargo.toml:4`) and several comments and metadata helpers refer to the token as "GRX" (e.g. the `create_token_mint` doc comment at `instructions/create_token_mint.rs:58-61`). The platform-level documentation distinguishes GRID (energy-backed, 1 kWh = 1 GRID) from GRX (the platform utility/governance token). This program holds a single 9-decimal mint under `[b"mint_2022"]`; the source uses the GRID and GRX labels interchangeably for that mint, and this document treats the managed asset as the GRID energy token per the platform model. This terminological overlap is a documentation ambiguity in the source, not two distinct mints.

### REC-validator gating

A Renewable Energy Certificate (REC) validator is an authorized signer whose co-signature attests that the energy underlying a mint corresponds to a valid certificate. The program stores up to five REC-validator public keys in its configuration (`state.rs:15`). The REC co-signature gate covers **every human-driven mint path**, with one caller-scoped exemption: `mint_to_wallet` and `mint_generation` unconditionally require a registered REC validator to co-sign (`instructions/mint_to_wallet.rs:75-84`, `instructions/mint_generation.rs:132-141`) — a freshly initialized token cannot mint on these paths until at least one validator is registered via `add_rec_validator`, because a zero count means no key can match and the membership check rejects (`RecValidatorNotFound`). `mint_tokens_direct` applies the same rule to any **non-registry** caller: a human admin must present a registered co-signer and cannot mint at all while the validator set is empty (`rec_validators_count > 0 && rec_validator_registered(...)`, `instructions/mint_tokens_direct.rs:80-86`). Registry-program CPIs (`claim_airdrop` / `settle_and_mint_tokens`, which sign in as the registry PDA) are **exempt from the co-sign gate entirely** — those are protocol mints with their own on-chain guards (claim flag, settlement validation), not energy-generation claims, and they pass the registry PDA as a `rec_validator` placeholder that can never be in the validator list (`instructions/mint_tokens_direct.rs:72-79`).

The membership check itself is centralized in a single free function, `rec_validator_registered(token_info, key)` (`lib.rs:67-69`), the single source of truth for the REC gate. It returns `true` iff `key` is one of the registered validators, scanning only the populated prefix (`rec_validators[..rec_validators_count]`). Every mint-path membership check routes through it, so the check can never drift between paths — `mint_tokens_direct` does not weaken the check for its exempt registry caller, it skips it wholesale (`if !is_registry`, `instructions/mint_tokens_direct.rs:80`).

Membership of the validator set is itself governance-bound: `add_rec_validator` / `remove_rec_validator` require the signer to match the `authority` stored in governance's `governance_config` PDA (the ERC governance seat), validated by raw owner/PDA/byte checks rather than a CPI (`instructions/rec_validator.rs:32-36`, `instructions/rec_validator.rs:67-71`, helper at `lib.rs:33-40`) — see §4.10.

## 3. State Model

The program defines two persistent account types.

### 3.1 `TokenInfo` (global configuration)

`TokenInfo` is the singleton global configuration account. It is a zero-copy account: `#[account(zero_copy)] #[repr(C)]` (`state.rs:6-7`), loaded through `AccountLoader` and accessed via `load()` / `load_mut()` / `load_init()`.

- **PDA seeds:** `[b"token_info_2022"]` (`instructions/initialize_token.rs:12`).
- **Account space:** `8 + std::mem::size_of::<TokenInfo>()` (`instructions/initialize_token.rs:11`) — the 8-byte Anchor discriminator plus the Pod struct size.

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

- **PDA seeds:** `[b"gen_mint", meter_id, window_start_ms.to_le_bytes()]` (`instructions/mint_generation.rs:55`, documented at `state.rs:24-25`).
- **Account space:** `8 + GenerationMintRecord::LEN` (`instructions/mint_generation.rs:54`), where `LEN = 16 + 8 + 8 + 1 + 1 = 34` (`state.rs:37`), for a total account size of 42 bytes.
- **Creation:** `init_if_needed` so the first mint creates the record and a replay finds it already present (`instructions/mint_generation.rs:51-58`).

| Field | Type | Bytes | Description |
| --- | --- | --- | --- |
| `meter_id` | `[u8; 16]` | 16 | Settlement meter UUID bytes (`state.rs:28`). |
| `window_start_ms` | `i64` | 8 | 15-minute window start, ms since epoch (`state.rs:29`). |
| `amount` | `u64` | 8 | Atomic GRID amount minted for this window (`state.rs:30`). |
| `minted` | `bool` | 1 | `true` once the mint CPI succeeded (`state.rs:31`). |
| `bump` | `u8` | 1 | PDA bump (`state.rs:32`). |

## 4. Instruction Set

The program module is `energy_token` (`lib.rs:131`), whose `#[program]` functions are thin wrappers that each call the matching handler in `instructions/*.rs`. Each wrapper body is wrapped in `compute_fn!` for compute-unit profiling under the `localnet` feature.

### 4.1 `initialize`

A no-op bootstrap instruction (`instructions/initialize.rs:8-10`). The sole account is `authority: Signer` (`instructions/initialize.rs:4-6`). It performs no state changes, emits no events, and produces no error paths.

### 4.2 `initialize_token`

Creates and initializes the program state (`instructions/initialize_token.rs:37-53`).

- **Parameters:** `registry_program_id: Pubkey`, `registry_authority: Pubkey`.
- **Signers:** `authority` (also the rent payer) (`instructions/initialize_token.rs:28-29`).
- **Accounts:** initializes the `token_info` PDA at `[b"token_info_2022"]` (`instructions/initialize_token.rs:8-15`) and the GRID `mint` PDA at `[b"mint_2022"]` with 9 decimals and mint authority set to the `token_info` PDA (`instructions/initialize_token.rs:17-26`).
- **State effects:** sets `authority`, `registry_authority`, `registry_program`, `mint`, `total_supply = 0`, `created_at`, `rec_validators_count = 0`, and `rec_validators = [default; 5]` (`instructions/initialize_token.rs:44-51`), loading the account with `load_init()` (`instructions/initialize_token.rs:43`).
- **Events:** none. **Error paths:** standard Anchor account/`init` constraints.

### 4.3 `create_token_mint`

Attaches Metaplex metadata to the existing GRID mint (`instructions/create_token_mint.rs:62-101`).

- **Parameters:** `name: String`, `symbol: String`, `uri: String`.
- **Signers:** `payer`, `authority` (`instructions/create_token_mint.rs:44`, `instructions/create_token_mint.rs:46`).
- **Accounts:** `mint` (constrained to equal `token_info.mint`, `instructions/create_token_mint.rs:26-30`), `token_info` (constrained so `authority` equals the stored admin, `instructions/create_token_mint.rs:32-37`), an unchecked `metadata` account, the Metaplex `metadata_program`, and the instructions sysvar constrained to the canonical `IX_ID` address (`instructions/create_token_mint.rs:53-55`). The `IX_ID` constant is the corrected Instructions-sysvar address (`instructions/create_token_mint.rs:19-22`).
- **State effects:** if the metadata program account is executable, issues a `CreateV1` CPI signed by the `token_info` PDA (seed `[b"token_info_2022"]`) as mint authority, creating a `Fungible` token-standard metadata record with 9 decimals and zero seller-fee basis points (`instructions/create_token_mint.rs:71-96`). This branch is unexercised on localnet (no Metaplex program loaded) and is verified only by compilation (`instructions/create_token_mint.rs:77-78`).
- **Events:** none. **Error paths:** `UnauthorizedAuthority` if the mint or authority constraints fail (`instructions/create_token_mint.rs:28`, `instructions/create_token_mint.rs:35`).

### 4.4 `mint_to_wallet`

Mints GRID to a destination token account (`instructions/mint_to_wallet.rs:62-114`).

- **Parameters:** `amount: u64`.
- **Signers:** `authority` (must equal `token_info.authority`, `instructions/mint_to_wallet.rs:65-68`), `payer`, and `rec_validator: Option<Signer>` (`instructions/mint_to_wallet.rs:51`). The signer is typed `Option` only so a missing co-signer surfaces as `RecValidatorNotFound` rather than a coarse "not enough keys"; it is **not** optional in policy — the handler rejects `None` (`instructions/mint_to_wallet.rs:75-80`).
- **Accounts:** `mint` (constrained to `token_info.mint`), `token_info` PDA, `destination` token account (constrained `token::mint = mint`, `token::authority = destination_owner`), `destination_owner` (unchecked), and the token, associated-token, and system programs (`instructions/mint_to_wallet.rs:20-59`).
- **Preconditions:** the supplied `rec_validator` is **mandatory** — `None` is rejected with `RecValidatorNotFound`, and the key must be listed in `rec_validators` per `rec_validator_registered` (`instructions/mint_to_wallet.rs:75-84`).
- **State effects:** issues a Token-2022 `mint_to` CPI signed by the `token_info` PDA (seed `[b"token_info_2022"]`, `instructions/mint_to_wallet.rs:90-102`). `total_supply` is deliberately not updated here (`instructions/mint_to_wallet.rs:105-106`).
- **Events:** `TokensMinted { recipient, amount, timestamp }` (`instructions/mint_to_wallet.rs:108-112`).
- **Error paths:** `UnauthorizedAuthority` (`instructions/mint_to_wallet.rs:67`), `RecValidatorNotFound` (`instructions/mint_to_wallet.rs:80`, `instructions/mint_to_wallet.rs:83`).

### 4.5 `mint_generation`

Idempotent generation mint keyed by `(meter_id, window_start_ms)` (`instructions/mint_generation.rs:89-185`).

- **Parameters:** `meter_id: [u8; 16]`, `window_start_ms: i64`, `amount: u64`.
- **Signers:** `authority`, `payer`, `rec_validator: Option<Signer>` (`instructions/mint_generation.rs:65`) — `Option`-typed for the same error-shaping reason as `mint_to_wallet`, but **mandatory** in policy (the handler rejects `None`).
- **Accounts:** identical mint accounts to `mint_to_wallet`, plus the `mint_record` PDA at `[b"gen_mint", meter_id, window_start_ms.to_le_bytes()]` created with `init_if_needed` (`instructions/mint_generation.rs:20-73`).
- **Preconditions and ordering:**
  1. **Idempotency short-circuit first.** If `mint_record.minted` is already `true`, the instruction returns `Ok(())` as a no-op, never re-running the CPI (`instructions/mint_generation.rs:97-99`).
  2. **Non-zero amount.** `amount` must be `> 0`; a zero-amount mint is rejected with `ZeroAmount` before any state write, so a silent `mint_to(_, 0)` cannot stamp `minted = true` and permanently poison the window (`instructions/mint_generation.rs:104`).
  3. **Window alignment.** `window_start_ms` must be positive, a multiple of `900_000` ms (15 minutes), and no later than one window past now (`window_start_ms / 1000 <= now + 900`); otherwise `MisalignedWindow` (`instructions/mint_generation.rs:115-120`).
  4. **Authority and REC checks** — the authority match, the mandatory `rec_validator` co-signer and `rec_validator_registered` membership check, plus a two-party-control check that the co-signer key differs from the platform authority (`RecValidatorIsAuthority`) (`instructions/mint_generation.rs:122-149`).
- **State effects:** mints via Token-2022 `mint_to` signed by the `token_info` PDA (`instructions/mint_generation.rs:152-167`), and only *after* a successful mint stamps the record (`meter_id`, `window_start_ms`, `amount`, `minted = true`, `bump`) so a failed mint leaves the window retryable (`instructions/mint_generation.rs:172-177`).
- **Events:** `TokensMinted { recipient, amount, timestamp }` (`instructions/mint_generation.rs:179-183`).
- **Error paths:** `ZeroAmount` (`instructions/mint_generation.rs:104`), `MisalignedWindow` (`instructions/mint_generation.rs:119`), `UnauthorizedAuthority` (`instructions/mint_generation.rs:126`), `RecValidatorNotFound` (`instructions/mint_generation.rs:137`, `instructions/mint_generation.rs:140`), `RecValidatorIsAuthority` (`instructions/mint_generation.rs:148`). The idempotency design is per-instruction (not per-transaction) so a replayed recipient batched with fresh ones no-ops without aborting the whole transaction (`instructions/mint_generation.rs:86-88`).

### 4.6 `mint_tokens_direct`

Registry/admin mint path optimized for Sealevel parallelism (handler at `instructions/mint_tokens_direct.rs:62-120`; entrypoint wrapper at `lib.rs:242-246`).

- **Parameters:** `amount: u64`.
- **Signers:** `authority`, and `rec_validator: Signer` (`instructions/mint_tokens_direct.rs:52`) — the account must always be supplied and sign, but its **membership** in the validator set is checked only for non-registry callers (see preconditions).
- **Accounts:** `token_info` PDA (read-only, no write lock, `instructions/mint_tokens_direct.rs:19-24`), `mint` (constrained to `token_info.mint`, `instructions/mint_tokens_direct.rs:26-30`), `user_token_account` (bound `token::mint = mint`, `token::token_program = token_program` — defense-in-depth parity with the `destination` binding on the other mint paths; the `mint_to` CPI already rejects a wrong-mint account, but the constraint fails earlier in account validation, `instructions/mint_tokens_direct.rs:32-41`), and a `registry_authority` unchecked account constrained to equal the stored `registry_authority` (`instructions/mint_tokens_direct.rs:45-49`).
- **Preconditions:** authorization succeeds if the signer is either the admin (`token_info.authority`) or the `registry_authority` (`instructions/mint_tokens_direct.rs:66-70`). The REC gate is then **caller-scoped** (`instructions/mint_tokens_direct.rs:72-86`): a **non-registry** (admin) caller must satisfy `rec_validators_count > 0` **and** present a co-signer registered per `rec_validator_registered`, otherwise `RecValidatorNotFound` — a human authority can never mint un-RECed tokens and cannot mint at all while the validator set is empty. A **registry** caller (`authority == registry_authority`, i.e. the registry program CPI-ing in as its PDA for `claim_airdrop` / `settle_and_mint_tokens`) is **exempt from the co-sign gate entirely**, regardless of the validator count: those are protocol mints with their own on-chain guards (claim flag, settlement validation), not energy-generation claims, and the registry passes its own PDA as the `rec_validator` placeholder — a key that can never be in the validator list.
- **State effects:** mints via `mint_to` signed by the `token_info` PDA (`instructions/mint_tokens_direct.rs:94-108`); `total_supply` is not updated (`instructions/mint_tokens_direct.rs:110`).
- **Events:** `GridTokensMinted { meter_owner, amount, timestamp }` (`instructions/mint_tokens_direct.rs:112-118`). Note `meter_owner` emits `user_token_account.owner` — the recipient **wallet**, not the token-account address — because downstream REC/provenance consumers key on the owner (`instructions/mint_tokens_direct.rs:113-115`).
- **Error paths:** `UnauthorizedAuthority` (`instructions/mint_tokens_direct.rs:70`, plus the `mint` and `registry_authority` constraints at `instructions/mint_tokens_direct.rs:28` and `instructions/mint_tokens_direct.rs:47`), `RecValidatorNotFound` (`instructions/mint_tokens_direct.rs:84`).

The REC gate therefore differs from `mint_to_wallet` / `mint_generation` in exactly one respect: those two require a registered co-signer from **every** caller with no exemption, while `mint_tokens_direct` exempts the **registry caller** from the membership check entirely and holds any other caller to the same always-on rule (`instructions/mint_tokens_direct.rs:80-86`). A further typing difference is that `rec_validator` is a plain `Signer` here (`instructions/mint_tokens_direct.rs:52`) rather than the `Option<Signer>` used on the other two paths, so the account must always be supplied and sign; the registry exemption waives only the membership check, not the account itself.

### 4.7 `transfer_tokens`

Transfers GRID between token accounts (`instructions/transfer_tokens.rs:28-43`).

- **Parameters:** `amount: u64`. **Signer:** `from_authority` (`instructions/transfer_tokens.rs:22`).
- **Accounts:** `from_token_account`, `to_token_account`, `mint`, token program (`instructions/transfer_tokens.rs:12-25`).
- **State effects:** issues `transfer_checked` with a fixed 9-decimal scale (`instructions/transfer_tokens.rs:39`).
- **Events:** none. **Error paths:** SPL token program errors (e.g. insufficient balance, mint mismatch).

### 4.8 `retire_energy_tokens`

Burns GRID to represent energy consumption (`instructions/retire_energy_tokens.rs:26-41`).

- **Parameters:** `amount: u64`. **Signer:** `authority` (`instructions/retire_energy_tokens.rs:20`).
- **Accounts:** `mint`, `token_account`, token program (`instructions/retire_energy_tokens.rs:12-23`).
- **State effects:** issues a `burn` CPI (`instructions/retire_energy_tokens.rs:36`); `total_supply` is not updated (`instructions/retire_energy_tokens.rs:39`).
- **Events:** none. **Error paths:** SPL token program errors.

### 4.9 `sync_total_supply`

Reconciles the cached `total_supply` with the canonical SPL mint supply (`instructions/sync_total_supply.rs:30-49`).

- **Signer:** `authority` (must equal `token_info.authority`, `instructions/sync_total_supply.rs:33-36`).
- **Accounts:** `token_info` PDA (mutable), `mint` (constrained to `token_info.mint`) (`instructions/sync_total_supply.rs:8-23`).
- **State effects:** sets `token_info.total_supply = mint.supply` (`instructions/sync_total_supply.rs:38-39`).
- **Events:** `TotalSupplySynced { authority, supply, timestamp }` (`instructions/sync_total_supply.rs:43-47`).
- **Error paths:** `UnauthorizedAuthority` (`instructions/sync_total_supply.rs:35`).

### 4.10 `add_rec_validator`

Registers a REC validator (`instructions/rec_validator.rs:25-57`).

- **Parameters:** `validator_pubkey: Pubkey`, `_authority_name: String` (the name parameter is unused beyond the signature).
- **Signer:** `authority` — must match the **governance authority** (the ERC governance seat), not `token_info.authority`. The `AddRecValidator` context supplies the governance `governance_config` PDA as an `UncheckedAccount` (`instructions/rec_validator.rs:14-19`), and the handler requires the signer to equal the `authority` stored in that account (`instructions/rec_validator.rs:32-36`). The account is validated by `governance_authority()` — owner must be the hardcoded `GOVERNANCE_PROGRAM_ID`, the key must be the canonical `[b"governance_config"]` PDA, and the data must be long enough to carry the authority bytes (`lib.rs:33-40`). No CPI into governance is made; a `governance` crate dependency would cycle through `registry` (`lib.rs:19-27`).
- **State effects:** appends `validator_pubkey` and increments `rec_validators_count` (`instructions/rec_validator.rs:53-55`).
- **Error paths:** `InvalidGovernanceAccount` if the supplied `governance_config` fails the owner/PDA/size validation (`lib.rs:34-38`); `UnauthorizedAuthority` if the signer is not the governance authority (`instructions/rec_validator.rs:35`); `MaxValidatorsReached` if the count is already 5 (`instructions/rec_validator.rs:40-43`); `ValidatorAlreadyExists` if the key is present (`instructions/rec_validator.rs:46-51`).

### 4.11 `remove_rec_validator`

Removes a REC validator using swap-remove to keep the array dense (`instructions/rec_validator.rs:63-89`). It reuses the `AddRecValidator` account context (`instructions/rec_validator.rs:64`), so it carries the same governance-authority gate: the signer must equal the `governance_config` authority (`instructions/rec_validator.rs:67-71`).

- **Parameter:** `validator_pubkey: Pubkey`.
- **State effects:** finds the target, swaps it with the last entry, clears the last slot, and decrements the count (`instructions/rec_validator.rs:84-87`).
- **Error paths:** `InvalidGovernanceAccount` / `UnauthorizedAuthority` as in §4.10 (`instructions/rec_validator.rs:67-71`); `RemoveValidatorNotFound` if the key is not registered (`instructions/rec_validator.rs:82`).

### 4.12 `set_registry_authority`

Updates the stored registry authority (`instructions/set_registry_authority.rs:19-28`).

- **Parameter:** `new_registry_authority: Pubkey`. **Signer:** `authority` (must equal `token_info.authority`, `instructions/set_registry_authority.rs:21-24`).
- **State effects:** sets `token_info.registry_authority` (`instructions/set_registry_authority.rs:26`).
- **Events:** none. **Error paths:** `UnauthorizedAuthority` (`instructions/set_registry_authority.rs:23`).

### 4.13 `set_authority`

Rotates the admin authority in place (`instructions/set_authority.rs:27-35`). `token_info.authority` gates every privileged path (`mint_to_wallet`, `mint_generation`, `sync_total_supply`, `set_*`); it was previously fixed at `initialize_token` with no rotation path, so a deployment whose admin must become a different signer (e.g. an off-chain bridge's signing key) had to be re-initialized (`instructions/set_authority.rs:18-26`).

- **Parameter:** `new_authority: Pubkey`. **Signer:** the **current** `authority` (must equal `token_info.authority`, `instructions/set_authority.rs:29-32`), so the rotation cannot be hijacked.
- **Accounts:** the mutable `token_info` PDA and the `authority` signer (`SetAuthority`, `instructions/set_authority.rs:6-16`).
- **State effects:** sets `token_info.authority = new_authority` (`instructions/set_authority.rs:33`).
- **Events:** none. **Error paths:** `UnauthorizedAuthority` (`instructions/set_authority.rs:31`).

## 5. Invariants & Security Properties

1. **Mint authority is the `token_info` PDA.** The GRID mint is created with `mint::authority = token_info` (`instructions/initialize_token.rs:23`), and every mint CPI signs with the seed `[b"token_info_2022"]` and the stored bump (`instructions/mint_to_wallet.rs:96-97`, `instructions/mint_generation.rs:157-158`, `instructions/mint_tokens_direct.rs:95-96`). No external key can mint GRID; only the program, acting under that PDA, can.

2. **REC provenance gating covers every human-driven mint path; only registry CPIs are exempt.** The membership check routes through the shared `rec_validator_registered` helper (`lib.rs:67-69`; call sites `instructions/mint_to_wallet.rs:81-84`, `instructions/mint_generation.rs:138-141`, `instructions/mint_tokens_direct.rs:80-86`). `mint_to_wallet` and `mint_generation` have no opt-out: a freshly initialized token cannot mint on those paths until at least one validator is registered (count 0 ⇒ no key matches ⇒ `RecValidatorNotFound`). `mint_tokens_direct` applies the same always-on rule to any non-registry caller (`rec_validators_count > 0 && rec_validator_registered(...)`) and exempts only the registry caller (`if !is_registry`, `instructions/mint_tokens_direct.rs:80-86`), so the registry's protocol mints (`claim_airdrop` / `settle_and_mint_tokens`, guarded by their own claim/settlement checks) keep working while a human admin can never mint un-RECed tokens — not even against an empty validator set.

3. **Authorization is constrained on every privileged instruction.** Admin-gated instructions check `authority == token_info.authority` either via in-handler `require!` or via account constraints (`instructions/mint_to_wallet.rs:65-68`, `instructions/mint_generation.rs:124-127`, `instructions/sync_total_supply.rs:33-36`, `instructions/set_registry_authority.rs:21-24`, `instructions/set_authority.rs:29-32`, constraint at `instructions/create_token_mint.rs:35`). The admin key itself is rotatable only by the current admin via `set_authority` (`instructions/set_authority.rs:27-35`). `mint_tokens_direct` additionally accepts the configured `registry_authority` and constrains the supplied `registry_authority` account against the stored value (`instructions/mint_tokens_direct.rs:66-70`, `instructions/mint_tokens_direct.rs:45-49`). REC validator-set management is gated on a *different* trust root: `add_rec_validator` / `remove_rec_validator` require the governance authority read from the validated `governance_config` PDA (`instructions/rec_validator.rs:32-36`, `instructions/rec_validator.rs:67-71`, `lib.rs:33-40`), binding REC issuer control to the ERC governance seat rather than the program admin.

4. **Exactly-once generation minting.** The `GenerationMintRecord` PDA keyed on `(meter_id, window_start_ms)` plus the early `minted` short-circuit (`instructions/mint_generation.rs:97-99`) guarantee that a replay of a settled window is a no-op rather than a double-mint. The record is stamped only after a successful CPI (`instructions/mint_generation.rs:172-177`), so a failed mint leaves the window retryable. This is the authoritative exactly-once guard; the Aggregator Bridge's Redis `MINTED_SET` is only a fast path (`instructions/mint_generation.rs:79-84`).

5. **Window alignment.** `mint_generation` requires `window_start_ms` to be a positive multiple of 900,000 ms, matching the oracle's 15-minute epoch boundary in seconds, and no later than one window past the current time (`instructions/mint_generation.rs:115-120`), rejecting unaligned, future, or garbage windows before any mint.

6. **Supply accounting is lazily reconciled.** Hot-path mint and burn instructions deliberately do not write `total_supply` (`instructions/mint_tokens_direct.rs:110` among them); the field is reconciled to the canonical SPL mint supply only via `sync_total_supply`. The cached `total_supply` is therefore stale on purpose between syncs; the canonical SPL `Mint.supply` is the source of truth. This is a Sealevel optimization that keeps `token_info` read-only on minting/burning paths (`instructions/mint_tokens_direct.rs:19-24` marks it read-only in `MintTokensDirect`).

7. **Overflow checking.** The release profile sets `overflow-checks = true` (`Cargo.toml:33-34`), so SBF arithmetic panics rather than wrapping. The `rec_validators_count` increment/decrement (`instructions/rec_validator.rs:55`, `instructions/rec_validator.rs:87`) is additionally bounded by the explicit `< 5` and swap-remove logic.

8. **Zero-copy state discipline.** `TokenInfo` is `#[account(zero_copy)] #[repr(C)]` with manual `_padding: [u8; 7]` for 8-byte alignment (`state.rs:6-17`) and is accessed only through `AccountLoader` (`load`/`load_mut`/`load_init`). Adding fields requires re-counting the padding.

## 6. Cross-Program Interfaces (CPI)

### Calls made by this program

- **SPL token interface** (`anchor_spl::token_interface`): `mint_to`, `transfer_checked`, and `burn` CPIs to the active token program (legacy SPL Token or Token-2022) selected at runtime via `Interface<'info, TokenInterface>` (`instructions/mint_to_wallet.rs:2-8`, `instructions/mint_to_wallet.rs:102`, `instructions/transfer_tokens.rs:39`, `instructions/retire_energy_tokens.rs:36`).
- **Metaplex Token Metadata** (`mpl_token_metadata`): a `CreateV1` CPI to attach fungible-token metadata, signed by the `token_info` PDA (`instructions/create_token_mint.rs:80-96`). This path runs only when the metadata program account is executable, which does not occur on localnet (`instructions/create_token_mint.rs:71`, `instructions/create_token_mint.rs:77-78`).

### Calls made into this program

The crate exposes the `cpi` feature (`Cargo.toml:13`) so other programs can invoke it as a CPI client. Per the repository's CPI graph documentation, the registry program performs `registry → energy-token` CPI for user-driven minting; `mint_tokens_direct` is the entry point, authorized against the stored `registry_authority` (`instructions/mint_tokens_direct.rs:66-70`, `instructions/mint_tokens_direct.rs:45-49`) and exempt from the REC co-sign gate on that registry path (`instructions/mint_tokens_direct.rs:80-86`). The Aggregator Bridge (off-chain) drives `mint_generation` for settlement-window issuance. This program does not perform a CPI back into the registry, treasury, or governance programs; it is a leaf in the platform's CPI graph. (The governance binding on `add_rec_validator` / `remove_rec_validator` is a raw read of the `governance_config` PDA — owner/PDA/byte validation, no CPI invoke — `lib.rs:33-40`.)

## 7. Events

Defined in `programs/energy-token/src/events.rs`.

| Event | Fields | Emitted by / when |
| --- | --- | --- |
| `GridTokensMinted` | `meter_owner: Pubkey`, `amount: u64`, `timestamp: i64` (`events.rs:5-10`) | `mint_tokens_direct` after a successful mint; `meter_owner` carries `user_token_account.owner` (the recipient wallet), not the token-account key (`instructions/mint_tokens_direct.rs:112-118`). |
| `TokensMinted` | `recipient: Pubkey`, `amount: u64`, `timestamp: i64` (`events.rs:12-17`) | `mint_to_wallet` (`instructions/mint_to_wallet.rs:108-112`) and `mint_generation` (`instructions/mint_generation.rs:179-183`) after a successful mint. |
| `TotalSupplySynced` | `authority: Pubkey`, `supply: u64`, `timestamp: i64` (`events.rs:19-24`) | `sync_total_supply` after updating the cached supply (`instructions/sync_total_supply.rs:43-47`). |

In every emitting handler the timestamp is hoisted via `let now = Clock::get()?.unix_timestamp;` before the `emit!` macro, avoiding a sysvar syscall inside macro expansion (`instructions/mint_to_wallet.rs:88`, `instructions/mint_generation.rs:106`, `instructions/mint_tokens_direct.rs:92`, `instructions/sync_total_supply.rs:42`).

## 8. Error Codes

Defined in `programs/energy-token/src/error.rs` as `EnergyTokenError`.

| Variant | Message | Meaning |
| --- | --- | --- |
| `UnauthorizedAuthority` | "Unauthorized authority" | Signer is neither the admin nor (where applicable) the configured registry authority; on `add_rec_validator` / `remove_rec_validator`, signer is not the governance authority (`error.rs:7-8`). |
| `InvalidMeter` | "Invalid meter" | Defined but not referenced by current handlers (`error.rs:9-10`). |
| `InsufficientBalance` | "Insufficient token balance" | Defined; balance enforcement is delegated to the SPL token program (`error.rs:11-12`). |
| `InvalidMetadataAccount` | "Invalid metadata account" | Defined for metadata validation (`error.rs:13-14`). |
| `NoUnsettledBalance` | "No unsettled balance" | Defined but not referenced by current handlers (`error.rs:15-16`). |
| `UnauthorizedRegistry` | "Unauthorized registry program" | Defined; registry authorization currently uses `UnauthorizedAuthority` (`error.rs:17-18`). |
| `ValidatorAlreadyExists` | "Validator already exists in the list" | `add_rec_validator` rejects a duplicate key (`error.rs:19-20`, `instructions/rec_validator.rs:49`). |
| `MaxValidatorsReached` | "Maximum number of validators reached" | `add_rec_validator` rejects when count is 5 (`error.rs:21-22`, `instructions/rec_validator.rs:42`). |
| `RecValidatorNotFound` | "REC validator not found in the registered list" | A required REC co-signer is missing or not registered — raised on all three mint paths; on `mint_tokens_direct` only for non-registry callers (empty validator set or unregistered co-signer), since registry CPIs are exempt from the gate (`error.rs:23-24`, `instructions/mint_to_wallet.rs:80-84`, `instructions/mint_generation.rs:137-141`, `instructions/mint_tokens_direct.rs:80-86`). |
| `RemoveValidatorNotFound` | "Validator to remove not found in the registered list" | `remove_rec_validator` could not find the key (`error.rs:25-26`, `instructions/rec_validator.rs:82`). |
| `MisalignedWindow` | "Window start must be a positive 15-minute (900_000 ms) boundary at or before now" | `mint_generation` window-alignment check failed — not positive, not a `900_000` ms multiple, or later than one window past now (`error.rs:27-28`, `instructions/mint_generation.rs:119`). |
| `ZeroAmount` | "Mint amount must be greater than zero" | `mint_generation` rejects a zero-amount mint before stamping the window (`error.rs:29-30`, `instructions/mint_generation.rs:104`). |
| `RecValidatorIsAuthority` | "REC validator co-signer must differ from the platform authority" | `mint_generation` two-party-control check — the REC co-signer key equals the platform `authority`, collapsing the mandatory co-sign to a single signer (`error.rs:31-32`, `instructions/mint_generation.rs:148`). |
| `InvalidGovernanceAccount` | "Invalid governance account — must be the canonical governance_config PDA" | The `governance_config` account supplied to `add_rec_validator` / `remove_rec_validator` failed the owner/PDA/size validation in `governance_authority()` (`error.rs:33-34`, `lib.rs:34-38`). |

Several variants (`InvalidMeter`, `InsufficientBalance`, `InvalidMetadataAccount`, `NoUnsettledBalance`, `UnauthorizedRegistry`) are declared but not currently raised by any handler; they are part of the error vocabulary but presently unused.

## 9. Testing

The program's TypeScript bindings are generated to `target/types/energy_token` and imported as `EnergyToken` in the test suites (e.g. `tests/generation_mint_idempotency.ts:3`, `tests/bootstrap_token2022.ts:4`).

| Test file | Coverage |
| --- | --- |
| `tests/generation_mint_idempotency.ts` | Exercises `mint_generation`: asserts the per-`(meter, window)` `GenerationMintRecord` PDA makes a replay a no-op and prevents double-minting (`tests/generation_mint_idempotency.ts:22-27`). |
| `tests/bootstrap_token2022.ts` | Verifies the GRID/GRX mint and downstream accounts are wired to the canonical Token-2022 program ID `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` (`tests/bootstrap_token2022.ts:15-19`). |
| `tests/energy_token_rec_guards_litesvm.ts` | In-process (litesvm) coverage of the REC gate and validator-set guards on `mint_to_wallet` / `add_rec_validator` / `remove_rec_validator`, including the governance-authority binding via a fabricated `governance_config` account (`tests/energy_token_rec_guards_litesvm.ts:1-10`, fabrication at `tests/energy_token_rec_guards_litesvm.ts:93-94`). |
| `tests/rec_gate_litesvm.ts` | In-process (litesvm) coverage of the caller-scoped REC gate on `mint_tokens_direct`: an admin must present a registered co-signer and cannot mint while the validator set is empty; the registry caller mints co-sign-exempt with its own PDA as the `rec_validator` placeholder (`tests/rec_gate_litesvm.ts:1-10`). |
| `tests/energy_token_admin_litesvm.ts` | Coverage of `set_registry_authority` and `create_token_mint` account constraints (the Metaplex CPI body is a no-op without a loaded metadata program) (`tests/energy_token_admin_litesvm.ts:1-11`). |
| `tests/cu_profile_energy_token_litesvm.ts` | Compute-unit profile of the GRID mint lifecycle (init, validator management, REC-gated mint, transfer, burn), each instruction asserted under the 200k CU budget (`tests/cu_profile_energy_token_litesvm.ts:1-7`). |
| In-crate unit tests | `rec_validator_tests` (`lib.rs:71-129`) covers the `rec_validator_registered` membership gate, including the unpopulated-tail case (only the `rec_validators_count` prefix counts) and count==0; run with `cargo test` inside `programs/energy-token/`. |

The `set_authority` instruction (§4.13) currently has no dedicated test coverage in `tests/`.

`scripts/bootstrap.ts` drives the program against a live validator (it references the `energy_token` program type).

### Commands

```bash
# Build all programs (energy-token among them)
anchor build

# Run the generation-mint idempotency suite directly (validator must be running)
npx mocha -r tsx tests/generation_mint_idempotency.ts --timeout 1000000

# Run the Token-2022 bootstrap suite
npx mocha -r tsx tests/bootstrap_token2022.ts --timeout 1000000

# In-process litesvm suites (no validator; includes the energy-token guard,
# admin, and CU-profile suites listed above)
npm run test:litesvm
npm run test:cu-profile

# In-crate unit tests (rec_validator_registered)
cd programs/energy-token && cargo test

# Full validator-backed suite
anchor test
```

There is no dedicated `npm run test:*` script scoped to the energy-token program in `package.json`; the named scripts target the oracle, registry, staking, governance, treasury, and benchmark suites, while `npm run test:litesvm` runs every `tests/*_litesvm.ts` suite (the energy-token ones among them). The validator-backed energy-token tests are run via raw mocha or the full `anchor test` suite as shown above.
