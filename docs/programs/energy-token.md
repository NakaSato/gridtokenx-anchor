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

The program ID is declared via `declare_id!("6FZKcVKCLFSNLMxypFJGU4K14xUBnxNW9VAuKGhmqjGX")` at `programs/energy-token/src/lib.rs:71`, and matches the `Anchor.toml` localnet entry `energy_token = "6FZKcVKCLFSNLMxypFJGU4K14xUBnxNW9VAuKGhmqjGX"` (`Anchor.toml:9`).

Crate metadata and dependency versions are defined in `programs/energy-token/Cargo.toml`: `anchor-lang = "1.0.0"` with `init-if-needed` (`Cargo.toml:24`), `anchor-spl = "1.0.0"` with the `metadata` feature (`Cargo.toml:25`), `spl-token = "4.0.0"` (`Cargo.toml:26`), `mpl-token-metadata = "5.1.2-alpha.2"` (`Cargo.toml:27`), `bytemuck` with the `derive` feature for the zero-copy state (`Cargo.toml:28`), and an optional path dependency on the in-repo `compute-debug` crate for compute-unit profiling (`Cargo.toml:29`).

### Dependency and feature notes

- The program declares no CPI path dependency on other GridTokenX programs; it is a leaf in the CPI graph and is *invoked by* other programs rather than invoking them (see §6). The governance program ID is hardcoded as `GOVERNANCE_PROGRAM_ID` (`lib.rs:40`) rather than imported, because an `energy-token → governance` path dependency would cycle through `registry`; the governance authority is instead validated by raw owner/PDA/byte checks (`lib.rs:46-53`).
- The `cpi` feature enables `no-entrypoint` (`Cargo.toml:13`), allowing other programs to depend on this crate as a CPI client library.
- The `localnet` feature enables `compute-debug/localnet` (`Cargo.toml:21`), which activates the `compute_fn!` / `compute_checkpoint!` profiling macros; in non-localnet builds these expand to no-ops (`lib.rs:60-69`).
- The release profile enforces `overflow-checks = true` (`Cargo.toml:33-34`) so that arithmetic on the SBF target panics on overflow rather than silently wrapping.
- Metaplex token metadata is created through `mpl_token_metadata::instructions::CreateV1CpiBuilder` (`lib.rs:20`, `lib.rs:174`).

## 2. System Role

The `energy-token` program is the token layer of the GridTokenX P2P energy-trading platform. In the platform's economics, one kilowatt-hour of metered, validated generation corresponds to one GRID token, the energy-backed unit of account. The program owns the GRID mint authority through a program-derived address (PDA) and is the only entity able to authorize minting, ensuring that GRID supply cannot be created outside the program's REC-gating and idempotency rules.

The program participates in two principal flows:

1. **Generation minting.** The Aggregator Bridge, after aggregating 15-minute metering windows, drives GRID issuance to producers. The idempotent `mint_generation` instruction is the authoritative exactly-once entry point for this path (`lib.rs:269`), keyed on `(meter_id, window_start_ms)`.
2. **Registry-driven minting.** The registry program (or the configured `registry_authority`) may mint GRID to users via `mint_tokens_direct` (`lib.rs:487`), with authorization checked against the stored `registry_authority` recorded in the program configuration.

The GRID mint is created as an SPL Token-2022 mint with 9 decimals (`mint::decimals = 9` at `lib.rs:765`), under PDA seed `[b"mint_2022"]` (`lib.rs:763`), and is used through the `anchor_spl::token_interface` abstraction so that the program operates against either the legacy SPL Token or Token-2022 program at runtime (`lib.rs:12-19`). The token transfer instruction enforces a checked transfer with the fixed 9-decimal scale (`token_interface::transfer_checked(cpi_ctx, amount, 9)` at `lib.rs:455`).

> Note on naming: the source crate description (`Cargo.toml:4`) and several comments and metadata helpers refer to the token as "GRX" (e.g. the `create_token_mint` doc comment at `lib.rs:151-154`). The platform-level documentation distinguishes GRID (energy-backed, 1 kWh = 1 GRID) from GRX (the platform utility/governance token). This program holds a single 9-decimal mint under `[b"mint_2022"]`; the source uses the GRID and GRX labels interchangeably for that mint, and this document treats the managed asset as the GRID energy token per the platform model. This terminological overlap is a documentation ambiguity in the source, not two distinct mints.

### REC-validator gating

A Renewable Energy Certificate (REC) validator is an authorized signer whose co-signature attests that the energy underlying a mint corresponds to a valid certificate. The program stores up to five REC-validator public keys in its configuration (`state.rs:15`). The REC co-signature gate covers **every mint path**, with one narrow bootstrap exception: `mint_to_wallet` and `mint_generation` unconditionally require a registered REC validator to co-sign (`lib.rs:208-222`, `lib.rs:298-310`) — a freshly initialized token cannot mint on these paths until at least one validator is registered via `add_rec_validator`, because a zero count means no key can match and the membership check rejects (`RecValidatorNotFound`). `mint_tokens_direct` requires a registered co-signer whenever any validator is registered (`lib.rs:500-504`); when the count is zero the gate cannot be satisfied, and the skip is restricted to the **registry caller only** — a human admin is rejected with `RecValidatorNotFound` — preserving the registry's bootstrap mints (`claim_airdrop`, `settle_and_mint_tokens`, which CPI in as the registry PDA) while closing the count==0 REC bypass on the admin path (`lib.rs:505-514`).

The membership check itself is centralized in a single free function, `rec_validator_registered(token_info, key)` (`lib.rs:77-79`), the single source of truth for the REC gate. It returns `true` iff `key` is one of the registered validators, scanning only the populated prefix (`rec_validators[..rec_validators_count]`). Every mint path calls it, so the check can never drift between paths.

Membership of the validator set is itself governance-bound: `add_rec_validator` / `remove_rec_validator` require the signer to match the `authority` stored in governance's `governance_config` PDA (the ERC governance seat), validated by raw owner/PDA/byte checks rather than a CPI (`lib.rs:380-384`, `lib.rs:417-421`, helper at `lib.rs:46-53`) — see §4.10.

## 3. State Model

The program defines two persistent account types.

### 3.1 `TokenInfo` (global configuration)

`TokenInfo` is the singleton global configuration account. It is a zero-copy account: `#[account(zero_copy)] #[repr(C)]` (`state.rs:6-7`), loaded through `AccountLoader` and accessed via `load()` / `load_mut()` / `load_init()`.

- **PDA seeds:** `[b"token_info_2022"]` (`lib.rs:755`).
- **Account space:** `8 + std::mem::size_of::<TokenInfo>()` (`lib.rs:754`) — the 8-byte Anchor discriminator plus the Pod struct size.

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

- **PDA seeds:** `[b"gen_mint", meter_id, window_start_ms.to_le_bytes()]` (`lib.rs:729`, documented at `state.rs:24-25`).
- **Account space:** `8 + GenerationMintRecord::LEN` (`lib.rs:728`), where `LEN = 16 + 8 + 8 + 1 + 1 = 34` (`state.rs:37`), for a total account size of 42 bytes.
- **Creation:** `init_if_needed` so the first mint creates the record and a replay finds it already present (`lib.rs:725-732`).

| Field | Type | Bytes | Description |
| --- | --- | --- | --- |
| `meter_id` | `[u8; 16]` | 16 | Settlement meter UUID bytes (`state.rs:28`). |
| `window_start_ms` | `i64` | 8 | 15-minute window start, ms since epoch (`state.rs:29`). |
| `amount` | `u64` | 8 | Atomic GRID amount minted for this window (`state.rs:30`). |
| `minted` | `bool` | 1 | `true` once the mint CPI succeeded (`state.rs:31`). |
| `bump` | `u8` | 1 | PDA bump (`state.rs:32`). |

## 4. Instruction Set

The program module is `energy_token` (`lib.rs:142`). Each handler body is wrapped in `compute_fn!` for compute-unit profiling under the `localnet` feature.

### 4.1 `initialize`

A no-op bootstrap instruction (`lib.rs:145-149`). The sole account is `authority: Signer` (`lib.rs:614-617`). It performs no state changes, emits no events, and produces no error paths.

### 4.2 `initialize_token`

Creates and initializes the program state (`lib.rs:351-369`).

- **Parameters:** `registry_program_id: Pubkey`, `registry_authority: Pubkey`.
- **Signers:** `authority` (also the rent payer) (`lib.rs:771-772`).
- **Accounts:** initializes the `token_info` PDA at `[b"token_info_2022"]` (`lib.rs:751-758`) and the GRID `mint` PDA at `[b"mint_2022"]` with 9 decimals and mint authority set to the `token_info` PDA (`lib.rs:760-769`).
- **State effects:** sets `authority`, `registry_authority`, `registry_program`, `mint`, `total_supply = 0`, `created_at`, `rec_validators_count = 0`, and `rec_validators = [default; 5]` (`lib.rs:359-366`), loading the account with `load_init()` (`lib.rs:358`).
- **Events:** none. **Error paths:** standard Anchor account/`init` constraints.

### 4.3 `create_token_mint`

Attaches Metaplex metadata to the existing GRID mint (`lib.rs:155-196`).

- **Parameters:** `name: String`, `symbol: String`, `uri: String`.
- **Signers:** `payer`, `authority` (`lib.rs:639`, `lib.rs:641`).
- **Accounts:** `mint` (constrained to equal `token_info.mint`, `lib.rs:621-625`), `token_info` (constrained so `authority` equals the stored admin, `lib.rs:627-632`), an unchecked `metadata` account, the Metaplex `metadata_program`, and the instructions sysvar constrained to the canonical `IX_ID` address (`lib.rs:648-650`). The `IX_ID` constant is the corrected Instructions-sysvar address (`lib.rs:7-10`).
- **State effects:** if the metadata program account is executable, issues a `CreateV1` CPI signed by the `token_info` PDA (seed `[b"token_info_2022"]`) as mint authority, creating a `Fungible` token-standard metadata record with 9 decimals and zero seller-fee basis points (`lib.rs:165-190`). This branch is unexercised on localnet (no Metaplex program loaded) and is verified only by compilation (`lib.rs:171-172`).
- **Events:** none. **Error paths:** `UnauthorizedAuthority` if the mint or authority constraints fail (`lib.rs:623`, `lib.rs:630`).

### 4.4 `mint_to_wallet`

Mints GRID to a destination token account (`lib.rs:199-253`).

- **Parameters:** `amount: u64`.
- **Signers:** `authority` (must equal `token_info.authority`, `lib.rs:203-206`), `payer`, and `rec_validator: Option<Signer>` (`lib.rs:684`). The signer is typed `Option` only so a missing co-signer surfaces as `RecValidatorNotFound` rather than a coarse "not enough keys"; it is **not** optional in policy — the handler rejects `None` (`lib.rs:213-218`).
- **Accounts:** `mint` (constrained to `token_info.mint`), `token_info` PDA, `destination` token account (constrained `token::mint = mint`, `token::authority = destination_owner`), `destination_owner` (unchecked), and the token, associated-token, and system programs (`lib.rs:653-692`).
- **Preconditions:** the supplied `rec_validator` is **mandatory** — `None` is rejected with `RecValidatorNotFound`, and the key must be listed in `rec_validators` per `rec_validator_registered` (`lib.rs:208-222`).
- **State effects:** issues a Token-2022 `mint_to` CPI signed by the `token_info` PDA (seed `[b"token_info_2022"]`, `lib.rs:228-240`). `total_supply` is deliberately not updated here (`lib.rs:243-244`).
- **Events:** `TokensMinted { recipient, amount, timestamp }` (`lib.rs:246-250`).
- **Error paths:** `UnauthorizedAuthority` (`lib.rs:205`), `RecValidatorNotFound` (`lib.rs:218`, `lib.rs:221`).

### 4.5 `mint_generation`

Idempotent generation mint keyed by `(meter_id, window_start_ms)` (`lib.rs:269-348`).

- **Parameters:** `meter_id: [u8; 16]`, `window_start_ms: i64`, `amount: u64`.
- **Signers:** `authority`, `payer`, `rec_validator: Option<Signer>` (`lib.rs:739`) — `Option`-typed for the same error-shaping reason as `mint_to_wallet`, but **mandatory** in policy (the handler rejects `None`).
- **Accounts:** identical mint accounts to `mint_to_wallet`, plus the `mint_record` PDA at `[b"gen_mint", meter_id, window_start_ms.to_le_bytes()]` created with `init_if_needed` (`lib.rs:694-747`).
- **Preconditions and ordering:**
  1. **Idempotency short-circuit first.** If `mint_record.minted` is already `true`, the instruction returns `Ok(())` as a no-op, never re-running the CPI (`lib.rs:278-280`).
  2. **Window alignment.** `window_start_ms` must be positive and a multiple of `900_000` ms (15 minutes); otherwise `MisalignedWindow` (`lib.rs:286-289`).
  3. **Authority and REC checks** identical to `mint_to_wallet` — the mandatory `rec_validator` co-signer and `rec_validator_registered` membership check (`lib.rs:292-311`).
- **State effects:** mints via Token-2022 `mint_to` signed by the `token_info` PDA (`lib.rs:313-329`), and only *after* a successful mint stamps the record (`meter_id`, `window_start_ms`, `amount`, `minted = true`, `bump`) so a failed mint leaves the window retryable (`lib.rs:331-339`).
- **Events:** `TokensMinted { recipient, amount, timestamp }` (`lib.rs:341-345`).
- **Error paths:** `MisalignedWindow` (`lib.rs:288`), `UnauthorizedAuthority` (`lib.rs:295`), `RecValidatorNotFound` (`lib.rs:306`, `lib.rs:309`). The idempotency design is per-instruction (not per-transaction) so a replayed recipient batched with fresh ones no-ops without aborting the whole transaction (`lib.rs:266-268`).

### 4.6 `mint_tokens_direct`

Registry/admin mint path optimized for Sealevel parallelism (`lib.rs:487-549`).

- **Parameters:** `amount: u64`.
- **Signers:** `authority`, and a mandatory `rec_validator: Signer` (`lib.rs:857`).
- **Accounts:** `token_info` PDA (read-only, no write lock, `lib.rs:824-829`), `mint` (constrained to `token_info.mint`), `user_token_account` (bound `token::mint = mint`, `token::token_program = token_program` — defense-in-depth parity with the `destination` binding on the other mint paths; the `mint_to` CPI already rejects a wrong-mint account, but the constraint fails earlier in account validation, `lib.rs:841-846`), and a `registry_authority` unchecked account constrained to equal the stored `registry_authority` (`lib.rs:850-854`).
- **Preconditions:** authorization succeeds if the signer is either the admin (`token_info.authority`) or the `registry_authority` (`lib.rs:491-496`). When any REC validator is registered (`rec_validators_count > 0`), the `rec_validator` co-signer must be a registered validator per `rec_validator_registered` (`lib.rs:500-504`). When the count is **zero**, the gate cannot be satisfied and the skip is restricted to the registry caller: `is_registry` must hold, otherwise `RecValidatorNotFound` (`lib.rs:505-514`). This window exists only for the registry's bootstrap mints (`claim_airdrop` / `settle_and_mint_tokens`, which CPI in as the registry PDA and pass a placeholder `rec_validator`); a human admin can no longer mint un-RECed tokens just because the validator set happens to be empty.
- **State effects:** mints via `mint_to` signed by the `token_info` PDA (`lib.rs:522-536`); `total_supply` is not updated (`lib.rs:538`).
- **Events:** `GridTokensMinted { meter_owner, amount, timestamp }` (`lib.rs:540-546`). Note `meter_owner` emits `user_token_account.owner` — the recipient **wallet**, not the token-account address — because downstream REC/provenance consumers key on the owner (`lib.rs:543`).
- **Error paths:** `UnauthorizedAuthority` (`lib.rs:496`, plus the `registry_authority` constraint at `lib.rs:852`), `RecValidatorNotFound` (`lib.rs:503`, `lib.rs:513`).

The REC gate therefore differs from `mint_to_wallet` / `mint_generation` in exactly one respect: those two reject outright at `rec_validators_count == 0`, while `mint_tokens_direct` keeps a **registry-only** count==0 bootstrap window (`lib.rs:505-514`). A further typing difference is that `rec_validator` is a plain `Signer` here (`lib.rs:857`) rather than the `Option<Signer>` used on the other two paths, so the account must always be supplied and sign; its membership is what the count==0 window relaxes.

### 4.7 `transfer_tokens`

Transfers GRID between token accounts (`lib.rs:443-460`).

- **Parameters:** `amount: u64`. **Signer:** `from_authority` (`lib.rs:804`).
- **Accounts:** `from_token_account`, `to_token_account`, `mint`, token program (`lib.rs:794-807`).
- **State effects:** issues `transfer_checked` with a fixed 9-decimal scale (`lib.rs:455`).
- **Events:** none. **Error paths:** SPL token program errors (e.g. insufficient balance, mint mismatch).

### 4.8 `retire_energy_tokens`

Burns GRID to represent energy consumption (`lib.rs:463-480`).

- **Parameters:** `amount: u64`. **Signer:** `authority` (`lib.rs:817`).
- **Accounts:** `mint`, `token_account`, token program (`lib.rs:809-820`).
- **State effects:** issues a `burn` CPI (`lib.rs:474`); `total_supply` is not updated (`lib.rs:477`).
- **Events:** none. **Error paths:** SPL token program errors.

### 4.9 `sync_total_supply`

Reconciles the cached `total_supply` with the canonical SPL mint supply (`lib.rs:556-577`).

- **Signer:** `authority` (must equal `token_info.authority`, `lib.rs:560-563`).
- **Accounts:** `token_info` PDA (mutable), `mint` (constrained to `token_info.mint`) (`lib.rs:862-877`).
- **State effects:** sets `token_info.total_supply = mint.supply` (`lib.rs:565-566`).
- **Events:** `TotalSupplySynced { authority, supply, timestamp }` (`lib.rs:570-574`).
- **Error paths:** `UnauthorizedAuthority` (`lib.rs:562`).

### 4.10 `add_rec_validator`

Registers a REC validator (`lib.rs:372-406`).

- **Parameters:** `validator_pubkey: Pubkey`, `_authority_name: String` (the name parameter is unused beyond the signature).
- **Signer:** `authority` — must match the **governance authority** (the ERC governance seat), not `token_info.authority`. The `AddRecValidator` context supplies the governance `governance_config` PDA as an `UncheckedAccount` (`lib.rs:784-789`), and the handler requires the signer to equal the `authority` stored in that account (`lib.rs:380-384`). The account is validated by `governance_authority()` — owner must be the hardcoded `GOVERNANCE_PROGRAM_ID`, the key must be the canonical `[b"governance_config"]` PDA, and the data must be long enough to carry the authority bytes (`lib.rs:46-53`). No CPI into governance is made; a `governance` crate dependency would cycle through `registry` (`lib.rs:32-40`).
- **State effects:** appends `validator_pubkey` and increments `rec_validators_count` (`lib.rs:401-403`).
- **Error paths:** `InvalidGovernanceAccount` if the supplied `governance_config` fails the owner/PDA/size validation (`lib.rs:47-51`); `UnauthorizedAuthority` if the signer is not the governance authority (`lib.rs:383`); `MaxValidatorsReached` if the count is already 5 (`lib.rs:388-391`); `ValidatorAlreadyExists` if the key is present (`lib.rs:394-399`).

### 4.11 `remove_rec_validator`

Removes a REC validator using swap-remove to keep the array dense (`lib.rs:412-440`). It reuses the `AddRecValidator` account context (`lib.rs:413`), so it carries the same governance-authority gate: the signer must equal the `governance_config` authority (`lib.rs:417-421`).

- **Parameter:** `validator_pubkey: Pubkey`.
- **State effects:** finds the target, swaps it with the last entry, clears the last slot, and decrements the count (`lib.rs:434-437`).
- **Error paths:** `InvalidGovernanceAccount` / `UnauthorizedAuthority` as in §4.10 (`lib.rs:417-421`); `RemoveValidatorNotFound` if the key is not registered (`lib.rs:432`).

### 4.12 `set_registry_authority`

Updates the stored registry authority (`lib.rs:580-589`).

- **Parameter:** `new_registry_authority: Pubkey`. **Signer:** `authority` (must equal `token_info.authority`, `lib.rs:582-585`).
- **State effects:** sets `token_info.registry_authority` (`lib.rs:587`).
- **Events:** none. **Error paths:** `UnauthorizedAuthority` (`lib.rs:584`).

### 4.13 `set_authority`

Rotates the admin authority in place (`lib.rs:600-610`). `token_info.authority` gates every privileged path (`mint_to_wallet`, `mint_generation`, `sync_total_supply`, `set_*`); it was previously fixed at `initialize_token` with no rotation path, so a deployment whose admin must become a different signer (e.g. an off-chain bridge's signing key) had to be re-initialized (`lib.rs:591-599`).

- **Parameter:** `new_authority: Pubkey`. **Signer:** the **current** `authority` (must equal `token_info.authority`, `lib.rs:603-606`), so the rotation cannot be hijacked.
- **Accounts:** the mutable `token_info` PDA and the `authority` signer (`SetAuthority`, `lib.rs:892-901`).
- **State effects:** sets `token_info.authority = new_authority` (`lib.rs:607`).
- **Events:** none. **Error paths:** `UnauthorizedAuthority` (`lib.rs:605`).

## 5. Invariants & Security Properties

1. **Mint authority is the `token_info` PDA.** The GRID mint is created with `mint::authority = token_info` (`lib.rs:766`), and every mint CPI signs with the seed `[b"token_info_2022"]` and the stored bump (`lib.rs:234-237`, `lib.rs:319-320`, `lib.rs:523-524`). No external key can mint GRID; only the program, acting under that PDA, can.

2. **REC provenance gating covers every mint path, with a registry-only bootstrap window.** All three minting instructions check the supplied REC validator against `rec_validators` through the shared `rec_validator_registered` helper (`lib.rs:208-222`, `lib.rs:298-310`, `lib.rs:500-504`). `mint_to_wallet` and `mint_generation` have no opt-out: a freshly initialized token cannot mint on those paths until at least one validator is registered (count 0 ⇒ no key matches ⇒ `RecValidatorNotFound`). `mint_tokens_direct` keeps a single count==0 exception restricted to the registry caller (`require!(is_registry, ...)`, `lib.rs:505-514`) so the registry's bootstrap mints keep working while a human admin cannot mint un-RECed tokens against an empty validator set.

3. **Authorization is constrained on every privileged instruction.** Admin-gated instructions check `authority == token_info.authority` either via in-handler `require!` or via account constraints (`lib.rs:203-206`, `lib.rs:293-296`, `lib.rs:560-563`, `lib.rs:582-585`, `lib.rs:603-606`, constraint at `lib.rs:630`). The admin key itself is rotatable only by the current admin via `set_authority` (`lib.rs:600-610`). `mint_tokens_direct` additionally accepts the configured `registry_authority` and constrains the supplied `registry_authority` account against the stored value (`lib.rs:491-496`, `lib.rs:850-854`). REC validator-set management is gated on a *different* trust root: `add_rec_validator` / `remove_rec_validator` require the governance authority read from the validated `governance_config` PDA (`lib.rs:380-384`, `lib.rs:417-421`, `lib.rs:46-53`), binding REC issuer control to the ERC governance seat rather than the program admin.

4. **Exactly-once generation minting.** The `GenerationMintRecord` PDA keyed on `(meter_id, window_start_ms)` plus the early `minted` short-circuit (`lib.rs:278-280`) guarantee that a replay of a settled window is a no-op rather than a double-mint. The record is stamped only after a successful CPI (`lib.rs:331-339`), so a failed mint leaves the window retryable. This is the authoritative exactly-once guard; the Aggregator Bridge's Redis `MINTED_SET` is only a fast path (`lib.rs:259-264`).

5. **Window alignment.** `mint_generation` requires `window_start_ms` to be a positive multiple of 900,000 ms, matching the oracle's 15-minute epoch boundary in seconds (`lib.rs:286-289`), rejecting unaligned or garbage windows before any mint.

6. **Supply accounting is lazily reconciled.** Hot-path mint and burn instructions deliberately do not write `total_supply` (`lib.rs:243-244`, `lib.rs:477`, `lib.rs:538`); the field is reconciled to the canonical SPL mint supply only via `sync_total_supply` (`lib.rs:565-566`). The cached `total_supply` is therefore stale on purpose between syncs; the canonical SPL `Mint.supply` is the source of truth. This is a Sealevel optimization that keeps `token_info` read-only on minting/burning paths (`lib.rs:823-829` marks it read-only in `MintTokensDirect`).

7. **Overflow checking.** The release profile sets `overflow-checks = true` (`Cargo.toml:33-34`), so SBF arithmetic panics rather than wrapping. The `rec_validators_count` increment/decrement (`lib.rs:403`, `lib.rs:437`) is additionally bounded by the explicit `< 5` and swap-remove logic.

8. **Zero-copy state discipline.** `TokenInfo` is `#[account(zero_copy)] #[repr(C)]` with manual `_padding: [u8; 7]` for 8-byte alignment (`state.rs:6-17`) and is accessed only through `AccountLoader` (`load`/`load_mut`/`load_init`). Adding fields requires re-counting the padding.

## 6. Cross-Program Interfaces (CPI)

### Calls made by this program

- **SPL token interface** (`anchor_spl::token_interface`): `mint_to`, `transfer_checked`, and `burn` CPIs to the active token program (legacy SPL Token or Token-2022) selected at runtime via `Interface<'info, TokenInterface>` (`lib.rs:14-18`, `lib.rs:240`, `lib.rs:455`, `lib.rs:474`).
- **Metaplex Token Metadata** (`mpl_token_metadata`): a `CreateV1` CPI to attach fungible-token metadata, signed by the `token_info` PDA (`lib.rs:174-190`). This path runs only when the metadata program account is executable, which does not occur on localnet (`lib.rs:165`, `lib.rs:171-172`).

### Calls made into this program

The crate exposes the `cpi` feature (`Cargo.toml:13`) so other programs can invoke it as a CPI client. Per the repository's CPI graph documentation, the registry program performs `registry → energy-token` CPI for user-driven minting; `mint_tokens_direct` is the entry point, authorized against the stored `registry_authority` (`lib.rs:491-496`, `lib.rs:850-854`). The Aggregator Bridge (off-chain) drives `mint_generation` for settlement-window issuance. This program does not perform a CPI back into the registry, treasury, or governance programs; it is a leaf in the platform's CPI graph. (The governance binding on `add_rec_validator` / `remove_rec_validator` is a raw read of the `governance_config` PDA — owner/PDA/byte validation, no CPI invoke — `lib.rs:46-53`.)

## 7. Events

Defined in `programs/energy-token/src/events.rs`.

| Event | Fields | Emitted by / when |
| --- | --- | --- |
| `GridTokensMinted` | `meter_owner: Pubkey`, `amount: u64`, `timestamp: i64` (`events.rs:5-10`) | `mint_tokens_direct` after a successful mint; `meter_owner` carries `user_token_account.owner` (the recipient wallet), not the token-account key (`lib.rs:540-546`). |
| `TokensMinted` | `recipient: Pubkey`, `amount: u64`, `timestamp: i64` (`events.rs:12-17`) | `mint_to_wallet` (`lib.rs:246-250`) and `mint_generation` (`lib.rs:341-345`) after a successful mint. |
| `TotalSupplySynced` | `authority: Pubkey`, `supply: u64`, `timestamp: i64` (`events.rs:19-24`) | `sync_total_supply` after updating the cached supply (`lib.rs:570-574`). |

In every emitting handler the timestamp is hoisted via `let now = Clock::get()?.unix_timestamp;` before the `emit!` macro, avoiding a sysvar syscall inside macro expansion (`lib.rs:226`, `lib.rs:313`, `lib.rs:520`, `lib.rs:569`).

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
| `ValidatorAlreadyExists` | "Validator already exists in the list" | `add_rec_validator` rejects a duplicate key (`error.rs:19-20`, `lib.rs:397`). |
| `MaxValidatorsReached` | "Maximum number of validators reached" | `add_rec_validator` rejects when count is 5 (`error.rs:21-22`, `lib.rs:390`). |
| `RecValidatorNotFound` | "REC validator not found in the registered list" | A required REC co-signer is missing or not registered — raised on all three mint paths, including the non-registry count==0 case in `mint_tokens_direct` (`error.rs:23-24`, `lib.rs:218`, `lib.rs:306`, `lib.rs:503`, `lib.rs:513`). |
| `RemoveValidatorNotFound` | "Validator to remove not found in the registered list" | `remove_rec_validator` could not find the key (`error.rs:25-26`, `lib.rs:432`). |
| `MisalignedWindow` | "Window start must be a positive 15-minute (900_000 ms) boundary" | `mint_generation` window-alignment check failed (`error.rs:27-28`, `lib.rs:288`). |
| `InvalidGovernanceAccount` | "Invalid governance account — must be the canonical governance_config PDA" | The `governance_config` account supplied to `add_rec_validator` / `remove_rec_validator` failed the owner/PDA/size validation in `governance_authority()` (`error.rs:29-30`, `lib.rs:47-51`). |

Several variants (`InvalidMeter`, `InsufficientBalance`, `InvalidMetadataAccount`, `NoUnsettledBalance`, `UnauthorizedRegistry`) are declared but not currently raised by any handler; they are part of the error vocabulary but presently unused.

## 9. Testing

The program's TypeScript bindings are generated to `target/types/energy_token` and imported as `EnergyToken` in the test suites (e.g. `tests/generation_mint_idempotency.ts:3`, `tests/bootstrap_token2022.ts:4`).

| Test file | Coverage |
| --- | --- |
| `tests/generation_mint_idempotency.ts` | Exercises `mint_generation`: asserts the per-`(meter, window)` `GenerationMintRecord` PDA makes a replay a no-op and prevents double-minting (`tests/generation_mint_idempotency.ts:22-27`). |
| `tests/bootstrap_token2022.ts` | Verifies the GRID/GRX mint and downstream accounts are wired to the canonical Token-2022 program ID `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` (`tests/bootstrap_token2022.ts:15-19`). |
| `tests/energy_token_rec_guards_litesvm.ts` | In-process (litesvm) coverage of the REC gate and validator-set guards on `mint_to_wallet` / `add_rec_validator` / `remove_rec_validator`, including the governance-authority binding via a fabricated `governance_config` account (`tests/energy_token_rec_guards_litesvm.ts:1-10`, fabrication at `tests/energy_token_rec_guards_litesvm.ts:93-94`). |
| `tests/mint_tokens_direct_litesvm.ts` | Instruction-level coverage of `mint_tokens_direct`: `UnauthorizedAuthority`, `RecValidatorNotFound`, and the hardened count==0 skip — admin rejected, registry caller allowed (`tests/mint_tokens_direct_litesvm.ts:1-15`). |
| `tests/energy_token_admin_litesvm.ts` | Coverage of `set_registry_authority` and `create_token_mint` account constraints (the Metaplex CPI body is a no-op without a loaded metadata program) (`tests/energy_token_admin_litesvm.ts:1-11`). |
| `tests/cu_profile_energy_token_litesvm.ts` | Compute-unit profile of the GRID mint lifecycle (init, validator management, REC-gated mint, transfer, burn), each instruction asserted under the 200k CU budget (`tests/cu_profile_energy_token_litesvm.ts:1-7`). |
| In-crate unit tests | `rec_validator_tests` (`lib.rs:81-139`) covers the `rec_validator_registered` membership gate, including the unpopulated-tail case (only the `rec_validators_count` prefix counts) and count==0; run with `cargo test` inside `programs/energy-token/`. |

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
