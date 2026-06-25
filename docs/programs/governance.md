# Governance Program

## Abstract

The `governance` program is the on-chain Proof-of-Authority (PoA) control plane of the GridTokenX P2P energy-trading platform. It establishes a single administrative authority — the Renewable Energy Certificate (REC) certifying entity — that issues, validates, revokes, and transfers ERC certificates (an ERC-1155-style record of certified renewable generation), manages platform-wide configuration, performs a two-step authority handover, and maintains an allow-list of off-chain aggregator nodes that other programs consult to authorize node-facing instructions. The program additionally hosts a per-zone Decentralized Autonomous Organization (DAO) subsystem in which meter-weighted votes adjust microgrid parameters. State is persisted in regular Anchor `#[account]` structures (no zero-copy in this program except the mirrored `MeterAccount` used for cross-program reads). All mutating instructions other than DAO voting are gated on the PoA authority signature, while DAO participation is gated on registry-owned meter ownership.

## 1. Program Identity

| Property | Value | Citation |
| --- | --- | --- |
| Program ID | `FokVuBSPXP11aeL7VZWd8n8aVAhWqVpyPZETToSxdvTS` | `programs/governance/src/lib.rs:20` |
| Crate name | `governance` | `programs/governance/Cargo.toml:2` |
| Crate version | `0.1.1` | `programs/governance/Cargo.toml:3` |
| `declare_id!` location | `programs/governance/src/lib.rs:20` | — |
| Program module | `pub mod governance` | `programs/governance/src/lib.rs:37-38` |

The `declare_id!` macro fixes the program address at `programs/governance/src/lib.rs:20`. The crate is configured as both a `cdylib` (deployable BPF object) and a `lib` (importable for CPI consumers) at `programs/governance/Cargo.toml:6-9`.

### Dependencies

| Dependency | Version / Path | Role | Citation |
| --- | --- | --- | --- |
| `anchor-lang` | `1.0.0`, features `init-if-needed` | Anchor framework | `programs/governance/Cargo.toml:21` |
| `anchor-spl` | `1.0.0`, features `metadata` | SPL token / metadata helpers | `programs/governance/Cargo.toml:22` |
| `bytemuck` | `1.20.0`, feature `derive` | Pod casting of the mirrored `MeterAccount` | `programs/governance/Cargo.toml:23` |
| `compute-debug` | path `../../shared/compute-debug`, optional | Compute-unit profiling macros | `programs/governance/Cargo.toml:24` |
| `registry` | path `../registry`, feature `cpi` | CPI into `mark_erc_claimed`; meter layout reuse | `programs/governance/Cargo.toml:25` |

The release profile sets `overflow-checks = true` (`programs/governance/Cargo.toml:29-30`), forcing bare arithmetic to panic rather than silently wrap; the handlers nonetheless prefer explicit `checked_*` / `saturating_*` operations.

The `compute_fn!` macro is a no-op outside the `localnet` feature; the program defines fallback no-op macros for non-`localnet` builds at `programs/governance/src/lib.rs:25-35`, and every instruction body is wrapped in `compute_fn!("<label>" => { ... })` at the dispatch layer (`programs/governance/src/lib.rs:41-215`).

## 2. System Role

### 2.1 PoA authority model

The program records a single `authority` pubkey — the REC certifying entity — on the `GovernanceConfig` singleton (`programs/governance/src/state/poa_config.rs:8`). On initialization the authority is set to the initializing signer, with a fixed authority name of `"REC"` and a fixed contact string (`programs/governance/src/handlers/initialize.rs:10-23`). Every administrative instruction context that mutates configuration or certificates enforces `has_one = authority` against this field, rejecting non-authority callers with `GovernanceError::UnauthorizedAuthority` (e.g. `programs/governance/src/contexts.rs:31`, `:90`, `:108`, `:149`, `:172`, `:210`, `:224`, `:247`, `:350`).

### 2.2 ERC-1155-style Renewable Energy Certificates (RECs)

An `ErcCertificate` is a per-certificate PDA recording a quantity of certified renewable energy (`energy_amount`, kWh), its renewable source, an owner, a lifecycle `status`, validity window, and transfer/revocation history (`programs/governance/src/state/erc_certificate.rs:3-43`). Certificates are fungible-by-quantity yet individually addressable — an ERC-1155-style model — supporting issuance, validation for trading, ownership transfer, and revocation. The term "ERC" in this codebase denotes a Renewable Energy Certificate, not the Ethereum request-for-comment numbering.

### 2.3 Two-step authority transfer

Authority handover is a two-step (propose / approve) protocol that prevents transferring control to an unreachable or mistyped key. The current authority proposes a new authority (`propose_authority_change`, `programs/governance/src/handlers/authority.rs:13-49`); the proposed authority must itself sign to accept (`approve_authority_change`, `programs/governance/src/handlers/authority.rs:53-95`). The pending proposal expires 48 hours after proposal (`AUTHORITY_CHANGE_EXPIRATION`, `programs/governance/src/handlers/authority.rs:9`) and may be cancelled by the current authority (`cancel_authority_change`, `programs/governance/src/handlers/authority.rs:99-120`).

### 2.4 Aggregator allow-list for the oracle

The PoA authority admits off-chain validator nodes ("aggregators") to an on-chain allow-list, each represented by a dedicated `AggregatorEntry` PDA (`programs/governance/src/state/aggregator.rs:9-21`). The `oracle` program authorizes a node-facing caller by deriving this PDA for the signer, asserting it is owned by the governance program, deserializing it, and requiring `active == true` with a matching aggregator pubkey (`programs/oracle/src/lib.rs:398-418`). This is a read-only validation: the oracle holds governance only as a types-and-ID dependency and never invokes a governance instruction.

## 3. State Model

All persistent accounts in this program are regular Anchor `#[account]` structures (Borsh-serialized) rather than zero-copy. The one exception is `MeterAccount`, a zero-copy `#[repr(C)]` mirror of the registry program's layout used solely for `bytemuck` reads of registry-owned accounts (`programs/governance/src/state/meter_account.rs:5-19`); the governance program never initializes a `MeterAccount`.

### 3.1 `GovernanceConfig` — `state/poa_config.rs`

The platform singleton. PDA seed `[b"poa_config"]` (`programs/governance/src/contexts.rs:13`). Regular `#[account]` (`programs/governance/src/state/poa_config.rs:4`). Allocated space is `8 + GovernanceConfig::LEN` (`programs/governance/src/contexts.rs:12`), where `LEN = 405` bytes summed field-by-field at `programs/governance/src/state/poa_config.rs:76-116`. A compile-time test asserts `size_of::<GovernanceConfig>() == 405` (`programs/governance/src/size_test.rs:6`).

| Field | Type | Purpose | Citation |
| --- | --- | --- | --- |
| `authority` | `Pubkey` | Current PoA authority (REC entity) | `state/poa_config.rs:8` |
| `authority_name` / `name_len` | `[u8; 64]` / `u8` | Fixed-buffer authority name | `state/poa_config.rs:10-11` |
| `contact_info` / `contact_len` | `[u8; 128]` / `u8` | Fixed-buffer contact string | `state/poa_config.rs:13-14` |
| `version` | `u8` | Governance schema version | `state/poa_config.rs:16` |
| `maintenance_mode` | `bool` | Global pause flag | `state/poa_config.rs:20` |
| `erc_validation_enabled` | `bool` | Whether ERC issuance is permitted | `state/poa_config.rs:24` |
| `min_energy_amount` | `u64` | Minimum kWh per ERC | `state/poa_config.rs:26` |
| `max_erc_amount` | `u64` | Maximum kWh per ERC | `state/poa_config.rs:28` |
| `erc_validity_period` | `i64` | ERC validity window (seconds) | `state/poa_config.rs:30` |
| `require_oracle_validation` | `bool` | Whether oracle validation is required for issuance | `state/poa_config.rs:32` |
| `oracle_authority` | `Pubkey` | Configured oracle authority | `state/poa_config.rs:36` |
| `min_oracle_confidence` | `u8` | Minimum oracle confidence (0–100) | `state/poa_config.rs:38` |
| `allow_certificate_transfers` | `bool` | Whether ERC transfers are enabled | `state/poa_config.rs:40` |
| `min_quorum_votes` | `u64` | Minimum total votes for DAO quorum | `state/poa_config.rs:44` |
| `total_ercs_issued` | `u64` | Lifetime issuance count | `state/poa_config.rs:48` |
| `total_ercs_validated` | `u64` | Lifetime validation count | `state/poa_config.rs:50` |
| `total_ercs_revoked` | `u64` | Lifetime revocation count | `state/poa_config.rs:52` |
| `total_energy_certified` | `u64` | Lifetime certified kWh | `state/poa_config.rs:54` |
| `created_at` | `i64` | Initialization timestamp | `state/poa_config.rs:58` |
| `last_updated` | `i64` | Last mutation timestamp | `state/poa_config.rs:60` |
| `last_erc_issued_at` | `i64` | Last issuance timestamp | `state/poa_config.rs:62` |
| `pending_authority` | `Pubkey` | Proposed next authority (`default` = none) | `state/poa_config.rs:66` |
| `pending_authority_proposed_at` | `i64` | When the change was proposed | `state/poa_config.rs:68` |
| `pending_authority_expires_at` | `i64` | When the proposal expires | `state/poa_config.rs:70` |
| `_reserved` | `[u8; 5]` | Reserved padding for future fields | `state/poa_config.rs:72` |

`GovernanceConfig` provides three helper predicates: `validate_config` (range checks on energy limits, validity period, and confidence; `programs/governance/src/state/poa_config.rs:119-137`), `is_operational` (`!maintenance_mode`; `:140-142`), and `can_issue_erc` (operational AND `erc_validation_enabled`; `:145-147`).

`GovernanceStats` (`programs/governance/src/state/poa_config.rs:150-191`) is a Borsh return type, not an account; it is the projection returned by `get_governance_stats`.

### 3.2 `ErcCertificate` — `state/erc_certificate.rs`

PDA seed `[b"erc_certificate", certificate_id_bytes]` (`programs/governance/src/contexts.rs:38`). Regular `#[account]` (`programs/governance/src/state/erc_certificate.rs:3`). Space `8 + ErcCertificate::LEN`, with `LEN = 65 + 32 + 32 + 8 + 65 + 258 + 8 + 9 + 1 + 1 + 9 + 129 + 9 + 1 + 9` (`programs/governance/src/state/erc_certificate.rs:52`, allocated at `programs/governance/src/contexts.rs:37`).

| Field | Type | Purpose | Citation |
| --- | --- | --- | --- |
| `certificate_id` / `id_len` | `[u8; 64]` / `u8` | Fixed-buffer unique ID | `state/erc_certificate.rs:6-7` |
| `authority` | `Pubkey` | Issuing authority | `state/erc_certificate.rs:9` |
| `owner` | `Pubkey` | Current certificate owner | `state/erc_certificate.rs:11` |
| `energy_amount` | `u64` | Certified renewable energy (kWh) | `state/erc_certificate.rs:13` |
| `renewable_source` / `source_len` | `[u8; 64]` / `u8` | Fixed-buffer source name | `state/erc_certificate.rs:15-16` |
| `validation_data` / `data_len` | `[u8; 256]` / `u16` | Fixed-buffer validation payload | `state/erc_certificate.rs:18-19` |
| `issued_at` | `i64` | Issuance timestamp | `state/erc_certificate.rs:21` |
| `expires_at` | `Option<i64>` | Expiry timestamp | `state/erc_certificate.rs:23` |
| `status` | `ErcStatus` | Lifecycle state | `state/erc_certificate.rs:25` |
| `validated_for_trading` | `bool` | Eligible to back a trade | `state/erc_certificate.rs:27` |
| `trading_validated_at` | `Option<i64>` | When validated for trading | `state/erc_certificate.rs:29` |
| `revocation_reason` / `reason_len` | `[u8; 128]` / `u8` | Fixed-buffer revocation reason | `state/erc_certificate.rs:33-34` |
| `revoked_at` | `Option<i64>` | Revocation timestamp | `state/erc_certificate.rs:36` |
| `transfer_count` | `u8` | Number of transfers | `state/erc_certificate.rs:40` |
| `last_transferred_at` | `Option<i64>` | Last transfer timestamp | `state/erc_certificate.rs:42` |

`ErcStatus` is the enum `{ Valid, Expired, Revoked, Pending }` (`programs/governance/src/state/erc_certificate.rs:65-71`). Helper predicates `can_transfer` (`status == Valid && validated_for_trading`; `:55-57`) and `can_revoke` (`status == Valid || status == Pending`; `:60-62`).

### 3.3 `AggregatorEntry` — `state/aggregator.rs`

One PDA per admitted aggregator. Seed `[b"aggregator", aggregator.as_ref()]` (`programs/governance/src/contexts.rs:232`). Regular `#[account]` (`programs/governance/src/state/aggregator.rs:10`). Space `8 + AggregatorEntry::LEN`, with `LEN = 32 + 8 + 8 + 1 + 1 = 50` (`programs/governance/src/state/aggregator.rs:24-28`, allocated at `programs/governance/src/contexts.rs:231`).

| Field | Type | Purpose | Citation |
| --- | --- | --- | --- |
| `aggregator` | `Pubkey` | Admitted node's signing pubkey | `state/aggregator.rs:12` |
| `admitted_at` | `i64` | First-admission timestamp | `state/aggregator.rs:14` |
| `updated_at` | `i64` | Last revoke/re-admit timestamp | `state/aggregator.rs:16` |
| `active` | `bool` | True while permitted to act | `state/aggregator.rs:18` |
| `bump` | `u8` | Canonical PDA bump | `state/aggregator.rs:20` |

The per-aggregator PDA design avoids a growing `Vec` in a global account, conforming to the Sealevel per-entity-PDA rule (`programs/governance/src/state/aggregator.rs:3-8`).

### 3.4 `Proposal` — `state/proposal.rs`

DAO proposal. PDA seed `[b"proposal", target_zone.to_le_bytes(), proposal_id.to_le_bytes()]` (`programs/governance/src/contexts.rs:270`). Regular `#[account]` (`programs/governance/src/state/proposal.rs:3`). `LEN = 87` bytes (`8 + 32 + 4 + 1 + 8 + 8 + 8 + 1 + 8 + 8 + 1`), with the 8-byte discriminator included in the constant itself (`programs/governance/src/state/proposal.rs:49-59`); the context allocates `space = Proposal::LEN` directly (`programs/governance/src/contexts.rs:269`).

| Field | Type | Purpose | Citation |
| --- | --- | --- | --- |
| `proposer` | `Pubkey` | Proposal creator | `state/proposal.rs:6` |
| `target_zone` | `i32` | Affected microgrid zone | `state/proposal.rs:8` |
| `parameter` | `GridParameter` | Parameter under adjustment | `state/proposal.rs:10` |
| `new_value` | `u64` | Proposed value | `state/proposal.rs:12` |
| `votes_for` | `u64` | Aggregate "for" weight | `state/proposal.rs:14` |
| `votes_against` | `u64` | Aggregate "against" weight | `state/proposal.rs:16` |
| `status` | `ProposalStatus` | Lifecycle state | `state/proposal.rs:18` |
| `expires_at` | `i64` | Voting end timestamp | `state/proposal.rs:20` |
| `proposal_id` | `u64` | Per-zone proposal index | `state/proposal.rs:22` |
| `bump` | `u8` | PDA bump | `state/proposal.rs:24` |

`GridParameter` enumerates `{ IncentiveMultiplier, WheelingCharge, LossFactor, MaintenanceMode }` (`programs/governance/src/state/proposal.rs:27-37`). `ProposalStatus` enumerates `{ Active, Passed, Rejected, Executed, Cancelled }` (`programs/governance/src/state/proposal.rs:39-46`).

### 3.5 `VoteRecord` — `state/vote.rs`

Per-(proposal, voter) vote record preventing double-voting. PDA seed `[b"vote", proposal.key(), voter.key()]` (`programs/governance/src/contexts.rs:293`). Regular `#[account]` (`programs/governance/src/state/vote.rs:3`). `LEN = 90` bytes, discriminator included in the constant (`programs/governance/src/state/vote.rs:20-26`); context allocates `space = VoteRecord::LEN` (`programs/governance/src/contexts.rs:292`).

| Field | Type | Purpose | Citation |
| --- | --- | --- | --- |
| `proposal` | `Pubkey` | Target proposal | `state/vote.rs:6` |
| `voter` | `Pubkey` | Voter wallet | `state/vote.rs:8` |
| `choice` | `bool` | `true` = for, `false` = against | `state/vote.rs:10` |
| `weight` | `u64` | Voting weight at cast time | `state/vote.rs:12` |
| `voted_at` | `i64` | Cast timestamp | `state/vote.rs:14` |
| `bump` | `u8` | PDA bump | `state/vote.rs:16` |

### 3.6 `ZoneConfig` — `state/zone_config.rs`

Per-zone parameter store mutated by executed proposals. PDA seed `[b"zone_config", zone_id.to_le_bytes()]` (`programs/governance/src/contexts.rs:343`). Regular `#[account]` (`programs/governance/src/state/zone_config.rs:3`). `LEN = 46` bytes, discriminator included (`programs/governance/src/state/zone_config.rs:22-29`); context allocates `space = ZoneConfig::LEN` (`programs/governance/src/contexts.rs:342`).

| Field | Type | Purpose | Citation |
| --- | --- | --- | --- |
| `zone_id` | `i32` | Zone identifier | `state/zone_config.rs:6` |
| `incentive_multiplier` | `u64` | Generation incentive (×1000) | `state/zone_config.rs:8` |
| `wheeling_charge` | `u64` | Base wheeling charge (scaled) | `state/zone_config.rs:10` |
| `loss_factor` | `u64` | Loss factor (×1000) | `state/zone_config.rs:12` |
| `maintenance_mode` | `bool` | Per-zone pause flag | `state/zone_config.rs:14` |
| `last_updated` | `i64` | Last update timestamp | `state/zone_config.rs:16` |
| `bump` | `u8` | PDA bump | `state/zone_config.rs:18` |

### 3.7 `MeterAccount` (mirror) — `state/meter_account.rs`

A zero-copy `#[account(zero_copy)] #[repr(C)]` mirror of the registry program's meter layout (`programs/governance/src/state/meter_account.rs:5-19`). It is never initialized by this program; it exists so handlers can `bytemuck::from_bytes` registry-owned account data after the discriminator to read `owner`, `total_generation`, `claimed_erc_generation`, and `settled_net_generation`.

## 4. Instruction Set

Instructions are dispatched in `programs/governance/src/lib.rs:41-215` and implemented in the named handler modules (`programs/governance/src/handlers/mod.rs:1-7`).

### 4.1 Initialization (`handlers/initialize.rs`)

#### `initialize_governance`

- **Signers:** `authority` (becomes the PoA authority).
- **Accounts:** `governance_config` (`init`, seed `[b"poa_config"]`), `authority`, `system_program` (`programs/governance/src/contexts.rs:8-20`).
- **Preconditions:** none beyond PDA non-existence; `validate_config` must pass.
- **Effects:** Sets authority to the signer; fixed name `"REC"` and contact `"engineering_erc@utcc.ac.th"`; defaults `version=1`, `maintenance_mode=false`, `erc_validation_enabled=true`, `min_energy_amount=100`, `max_erc_amount=1_000_000`, `erc_validity_period=31_536_000` (1 year), `require_oracle_validation=false`, `min_oracle_confidence=80`, `allow_certificate_transfers=true`, `min_quorum_votes=100`; zeroes counters and pending-authority state; validates config (`programs/governance/src/handlers/initialize.rs:10-66`).
- **Event:** `GovernanceInitialized` (`programs/governance/src/handlers/initialize.rs:68-72`).
- **Errors:** the `validate_config` range errors (`InvalidMinimumEnergy`, `InvalidMaximumEnergy`, `InvalidValidityPeriod`, `InvalidOracleConfidence`).

### 4.2 ERC certificate (`handlers/erc.rs`)

#### `issue_erc(certificate_id, energy_amount, renewable_source, validation_data)`

- **Signers:** `authority` (PoA) and `owner` (meter owner) (`programs/governance/src/contexts.rs:58`, `:80`).
- **Accounts:** `governance_config` (`has_one = authority`), `erc_certificate` (`init`, seed `[b"erc_certificate", certificate_id]`), `meter_account` (registry-owned, validated via `owner = registry::ID`), `owner` (must equal the meter's owner field), `registry` (singleton PDA whose authority must equal the governance authority), `registry_program` (pinned to `registry::ID`), `authority`, `system_program` (`programs/governance/src/contexts.rs:26-82`).
- **Preconditions:** `can_issue_erc()`; `energy_amount` within `[min_energy_amount, max_erc_amount]`; string-length bounds (`certificate_id ≤ 64`, `renewable_source ≤ 64`, `validation_data ≤ 256`); `energy_amount ≤ unclaimed_generation` where `unclaimed = total_generation − claimed_erc_generation − settled_net_generation` (saturating); if `require_oracle_validation`, `oracle_authority != default` (`programs/governance/src/handlers/erc.rs:16-72`).
- **Meter deserialization:** the registry-owned meter is read by slicing exactly `&meter_data[8..8 + size_of::<MeterAccount>()]` (not the open-ended `[8..]` remainder) after the `len() >= 8 + size_of::<MeterAccount>()` check — `from_bytes` panics on a length mismatch, so an account with trailing bytes would otherwise DoS issuance (`programs/governance/src/handlers/erc.rs:18-27`).
- **Effects:** Performs a CPI to `registry::mark_erc_claimed(energy_amount)` to debit unclaimed generation, then initializes the certificate (`status=Valid`, `validated_for_trading=false`, `expires_at = now + erc_validity_period`, owner = meter owner) and increments `total_ercs_issued` / `total_energy_certified` (`programs/governance/src/handlers/erc.rs:74-129`).
- **Event:** `ErcIssued` (`programs/governance/src/handlers/erc.rs:131-137`).
- **Errors:** `ErcValidationDisabled`, `BelowMinimumEnergy`, `ExceedsMaximumEnergy`, `CertificateIdTooLong`, `SourceNameTooLong`, `ValidationDataTooLong`, `InsufficientUnclaimedGeneration`, `OracleValidationRequired`, `InvalidMeterAccount`, `UnauthorizedAuthority`.

#### `validate_erc_for_trading`

- **Signers:** `authority` (PoA).
- **Accounts:** `governance_config` (`has_one`), `erc_certificate` (seed re-derived from stored `certificate_id[..id_len]`), `authority` (`programs/governance/src/contexts.rs:85-100`).
- **Preconditions:** `is_operational()`; `status == Valid`; `!validated_for_trading`; not expired (`programs/governance/src/handlers/erc.rs:147-167`).
- **Effects:** Sets `validated_for_trading = true`, records `trading_validated_at`, increments `total_ercs_validated` (`programs/governance/src/handlers/erc.rs:170-175`).
- **Event:** `ErcValidatedForTrading` (`programs/governance/src/handlers/erc.rs:177-184`).
- **Errors:** `MaintenanceMode`, `InvalidErcStatus`, `AlreadyValidated`, `ErcExpired`, `UnauthorizedAuthority`.

#### `revoke_erc(reason)`

- **Signers:** `authority` (PoA).
- **Accounts:** `governance_config` (`has_one`), `erc_certificate`, `authority` (`programs/governance/src/contexts.rs:103-118`).
- **Preconditions:** `is_operational()`; `reason` non-empty and `≤ 128`; `can_revoke()` (status `Valid` or `Pending`) (`programs/governance/src/handlers/erc.rs:195-215`).
- **Effects:** Sets `status = Revoked`, `revoked_at`, clears `validated_for_trading`, writes the reason buffer, increments `total_ercs_revoked` (`programs/governance/src/handlers/erc.rs:220-236`).
- **Event:** `ErcRevoked` (`programs/governance/src/handlers/erc.rs:238-247`).
- **Errors:** `MaintenanceMode`, `RevocationReasonRequired`, `RevocationReasonTooLong`, `AlreadyRevoked`, `UnauthorizedAuthority`.

#### `transfer_erc`

- **Signers:** `current_owner` (the certificate owner — note this instruction does **not** require the PoA authority).
- **Accounts:** `governance_config` (read-only, no `has_one`), `erc_certificate` (`constraint = owner == current_owner`), `current_owner`, `new_owner` (`programs/governance/src/contexts.rs:121-139`).
- **Preconditions:** `is_operational()`; either `allow_certificate_transfers` is set **or** the current owner equals the PoA authority (issuance transfer); `can_transfer()` (`Valid` + `validated_for_trading`); not expired; `new_owner != owner` (`programs/governance/src/handlers/erc.rs:258-288`).
- **Effects:** Reassigns `owner`, increments `transfer_count`, records `last_transferred_at` (`programs/governance/src/handlers/erc.rs:295-298`).
- **Event:** `ErcTransferred` (`programs/governance/src/handlers/erc.rs:300-309`).
- **Errors:** `MaintenanceMode`, `TransfersNotAllowed`, `NotValidatedForTrading`, `ErcExpired`, `CannotTransferToSelf`, and `UnauthorizedAuthority` (from the `owner == current_owner` constraint at `programs/governance/src/contexts.rs:131`).

### 4.3 Configuration (`handlers/config.rs`)

All four instructions share the `UpdateGovernanceConfig` context (`governance_config` `has_one = authority`, `authority`; `programs/governance/src/contexts.rs:143-153`).

| Instruction | Effect | Preconditions | Event | Citation |
| --- | --- | --- | --- | --- |
| `update_governance_config(erc_validation_enabled, allow_certificate_transfers)` | Sets the two boolean flags | PoA signer | `GovernanceConfigUpdated` | `handlers/config.rs:6-26` |
| `set_maintenance_mode(maintenance_enabled)` | Sets `maintenance_mode` | PoA signer | `MaintenanceModeUpdated` | `handlers/config.rs:28-45` |
| `update_erc_limits(min_energy_amount, max_erc_amount, erc_validity_period)` | Updates the three limits | `min > 0`, `max > min`, `validity > 0` (`InvalidMinimumEnergy` / `InvalidMaximumEnergy` / `InvalidValidityPeriod`) | `ErcLimitsUpdated` | `handlers/config.rs:47-87` |
| `update_authority_info(contact_info)` | Updates contact buffer | `contact_info.len() ≤ 128` (`ContactInfoTooLong`) | `AuthorityInfoUpdated` | `handlers/config.rs:89-123` |

### 4.4 DAO governance (`handlers/dao.rs`)

#### `initialize_zone_config(zone_id, incentive_multiplier, wheeling_charge)`

- **Signers:** `authority` (PoA).
- **Accounts:** `zone_config` (`init`, seed `[b"zone_config", zone_id]`), `governance_config` (`has_one = authority`), `authority`, `system_program` (`programs/governance/src/contexts.rs:336-356`).
- **Effects:** Initializes the zone with the supplied multiplier and charge, `loss_factor = 1_000` (1.000×), `maintenance_mode = false` (`programs/governance/src/handlers/dao.rs:198-217`).
- **Event:** none (`msg!` log only).

#### `create_proposal(target_zone, proposal_id, parameter, new_value, voting_period_seconds)`

- **Signers:** `proposer`.
- **Accounts:** `proposal` (`init`, seed `[b"proposal", target_zone, proposal_id]`), `proposer`, `meter_account` (registry-owned), `system_program` (`programs/governance/src/contexts.rs:263-283`).
- **Preconditions:** `voting_period_seconds > 0` (`InvalidProposalStatus`); the supplied meter's `owner` must equal `proposer` (`MeterOwnerMismatch`); the meter's `zone_id` must equal the supplied `target_zone` (`MeterZoneMismatch`) — a proposer may only open a proposal for the zone their meter is in, so `target_zone` cannot be an attacker-chosen value unrelated to the meter (`programs/governance/src/handlers/dao.rs:18-45`).
- **Meter deserialization:** the registry-owned meter is read by slicing exactly `&meter_data[8..8 + size_of::<MeterAccount>()]` (not the open-ended `[8..]` remainder) before `bytemuck::from_bytes`, after asserting `len() >= 8 + size_of::<MeterAccount>()` — `from_bytes` panics on a length mismatch, so an account carrying trailing bytes would otherwise DoS the instruction (`programs/governance/src/handlers/dao.rs:27-33`).
- **Effects:** Initializes the proposal (`status = Active`, zeroed tallies, `expires_at = now + voting_period_seconds` via `checked_add`) (`programs/governance/src/handlers/dao.rs:47-59`).
- **Event:** `ProposalCreated` (`programs/governance/src/handlers/dao.rs:61-69`).
- **Errors:** `InvalidProposalStatus`, `InvalidMeterAccount`, `MeterOwnerMismatch`, `MeterZoneMismatch`, `MathOverflow`.

#### `cast_vote(choice)`

- **Signers:** `voter`.
- **Accounts:** `proposal` (`mut`), `vote_record` (`init`, seed `[b"vote", proposal, voter]` — its existence prevents double-voting), `voter`, `meter_account` (registry-owned), `system_program` (`programs/governance/src/contexts.rs:285-306`).
- **Preconditions:** `proposal.status == Active`; `now < expires_at`; the supplied meter's `owner` must equal `voter` (`MeterOwnerMismatch`); the meter's `zone_id` must equal `proposal.target_zone` (`MeterZoneMismatch`) — a prosumer cannot swing another zone's proposal with an unrelated high-generation meter (`programs/governance/src/handlers/dao.rs:83-115`).
- **Meter deserialization:** as in `create_proposal`, the meter is read via `&meter_data[8..8 + size_of::<MeterAccount>()]` after the `len() >= 8 + size_of::<MeterAccount>()` check, avoiding the `from_bytes` length-mismatch panic that an over-long account would trigger (`programs/governance/src/handlers/dao.rs:96-103`).
- **Effects:** Computes weight = `max(100, total_generation / 1_000)`; adds weight to `votes_for` or `votes_against` (`checked_add`); writes the `VoteRecord` (`programs/governance/src/handlers/dao.rs:116-132`).
- **Event:** `VoteCast` (`programs/governance/src/handlers/dao.rs:134-140`).
- **Errors:** `InvalidProposalStatus`, `ProposalExpired`, `InvalidMeterAccount`, `MeterOwnerMismatch`, `MeterZoneMismatch`, `MathOverflow`.

#### `execute_proposal`

- **Signers:** `executor` (any signer; permissionless finalization).
- **Accounts:** `governance_config` (read-only, supplies `min_quorum_votes`), `zone_config` (`mut`, seed `[b"zone_config", zone_id]`), `proposal` (`mut`, constrained `target_zone == zone_config.zone_id` and status `Active` or `Passed`), `executor` (`programs/governance/src/contexts.rs:308-334`).
- **Preconditions:** `now >= proposal.expires_at` (`ProposalNotExpired`); after auto-finalization, `status == Passed` (`InvalidProposalStatus`) (`programs/governance/src/handlers/dao.rs:142-164`).
- **Effects:** Auto-finalizes an `Active` proposal — `Rejected` if `total_votes < min_quorum` or `votes_for <= votes_against`, else `Passed`; applies the parameter change to `zone_config` (with `LossFactor` requiring `new_value > 0`); sets `status = Executed` (`programs/governance/src/handlers/dao.rs:147-185`).
- **Event:** `ProposalExecuted` (`programs/governance/src/handlers/dao.rs:187-193`).
- **Errors:** `ProposalNotExpired`, `InvalidProposalStatus`, `InvalidTargetZone`, `InvalidParameterType`.

### 4.5 Authority management (`handlers/authority.rs`)

| Instruction | Signers | Effect | Preconditions | Event | Citation |
| --- | --- | --- | --- | --- | --- |
| `propose_authority_change(new_authority)` | current `authority` | Sets pending authority with 48-hour expiry | no pending change (`AuthorityChangePending`); `new_authority != authority` (`CannotTransferToSelf`) | `AuthorityChangeProposed` | `handlers/authority.rs:13-49` |
| `approve_authority_change` | `new_authority` (the proposed key) | Promotes pending to authority; clears pending | pending != default (`NoAuthorityChangePending`); signer == pending (`InvalidPendingAuthority`); not expired (`AuthorityChangeExpired`) | `AuthorityChangeApproved` | `handlers/authority.rs:53-95` |
| `cancel_authority_change` | current `authority` | Clears pending state | pending != default (`NoAuthorityChangePending`) | `AuthorityChangeCancelled` | `handlers/authority.rs:99-120` |
| `set_oracle_authority(oracle_authority, min_confidence, require_validation)` | current `authority` | Sets oracle authority/confidence/requirement | `min_confidence ≤ 100` (`InvalidOracleConfidence`) | `OracleAuthoritySet` | `handlers/authority.rs:123-152` |

`approve_authority_change` uses the `ApproveAuthorityChange` context (`programs/governance/src/contexts.rs:178-188`), whose `governance_config` is **not** `has_one`-gated; authorization is enforced in-handler by requiring the signer to equal `pending_authority`.

### 4.6 Aggregator allow-list (`handlers/aggregator.rs`)

| Instruction | Signers | Effect | Event | Citation |
| --- | --- | --- | --- | --- |
| `admit_aggregator(aggregator)` | current `authority` | `init_if_needed` the `AggregatorEntry`; sets `active = true`; idempotent re-admission flips a revoked entry back active without failing | `AggregatorAdmitted` | `handlers/aggregator.rs:9-28` |
| `revoke_aggregator` | current `authority` | Sets `active = false`, retains the PDA as an audit trail | `AggregatorRevoked` | `handlers/aggregator.rs:33-46` |

Both contexts gate `governance_config` with `has_one = authority` (`programs/governance/src/contexts.rs:224`, `:247`).

### 4.7 Statistics (`handlers/stats.rs`)

#### `get_governance_stats`

A read-only view returning a `GovernanceStats` value projecting `GovernanceConfig` fields, with the fixed-buffer name/contact rehydrated via `String::from_utf8_lossy` (`programs/governance/src/handlers/stats.rs:5-54`). Context `GetGovernanceStats` requires only the `governance_config` PDA, no signer (`programs/governance/src/contexts.rs:155-162`).

## 5. Invariants & Security Properties

### 5.1 PoA authority gating

All configuration-mutating, ERC-administrative (issue, validate, revoke), zone-initialization, oracle-configuration, and aggregator instructions enforce `has_one = authority` on the `governance_config` PDA, rejecting non-authority signers with `UnauthorizedAuthority` (`programs/governance/src/contexts.rs:31`, `:90`, `:108`, `:149`, `:172`, `:196`, `:210`, `:224`, `:247`, `:350`). The singleton PDA seed `[b"poa_config"]` guarantees a single canonical config account (`programs/governance/src/contexts.rs:13`).

### 5.2 Two-step transfer safety

The proposing step refuses to overwrite an existing pending change (`AuthorityChangePending`, `programs/governance/src/handlers/authority.rs:21-24`) and refuses a self-proposal (`CannotTransferToSelf`, `:27-30`). The approving step requires the **proposed** key to sign, comparing it to the stored pending value (`InvalidPendingAuthority`, `programs/governance/src/handlers/authority.rs:62-65`), and rejects an expired proposal (`AuthorityChangeExpired`, `:67-74`). Because acceptance requires the new key's signature, control cannot be transferred to a key that cannot sign. The current authority retains a unilateral cancel path before acceptance (`programs/governance/src/handlers/authority.rs:99-120`). The 48-hour expiry (`AUTHORITY_CHANGE_EXPIRATION`, `programs/governance/src/handlers/authority.rs:9`) bounds the window in which a stale proposal can be accepted.

### 5.3 Aggregator allow-list integrity

Admission and revocation are PoA-gated (§5.1). Each entry is a deterministic PDA keyed by the aggregator pubkey (`programs/governance/src/contexts.rs:232`), so a consumer can derive and verify the canonical address. Revocation preserves the PDA and sets `active = false` rather than closing it, retaining an audit trail; the source explicitly requires consumers to reject inactive entries (`programs/governance/src/handlers/aggregator.rs:31-37`). The oracle program enforces exactly that (`active == true` plus pubkey match) before authorizing a node caller (`programs/oracle/src/lib.rs:413-416`).

### 5.4 ERC supply / double-claim accounting

ERC issuance is bounded by unclaimed meter generation: `unclaimed = total_generation − claimed_erc_generation − settled_net_generation` (saturating subtraction), and `energy_amount ≤ unclaimed` is required (`InsufficientUnclaimedGeneration`, `programs/governance/src/handlers/erc.rs:24-27`, `:61-64`). Issuance then performs a CPI into `registry::mark_erc_claimed` to atomically debit the registry's claimed counter, closing the double-claim window (`programs/governance/src/handlers/erc.rs:74-86`). The certificate is initialized as `Valid` but **not** `validated_for_trading`; a separate authority action gates trading eligibility (`programs/governance/src/handlers/erc.rs:112-113`). Aggregate counters (`total_ercs_issued`, `total_energy_certified`, `total_ercs_validated`, `total_ercs_revoked`) use `saturating_add` (`programs/governance/src/handlers/erc.rs:124-127`, `:174`, `:226`).

### 5.5 DAO weight and finalization integrity

Voting weight is derived from the registry-owned meter's `total_generation`, and the meter account is bound to `owner = registry::ID` at the context level so a forged account cannot manufacture weight (`programs/governance/src/contexts.rs:299-304`); the handler additionally requires `meter.owner == voter` (`MeterOwnerMismatch`, `programs/governance/src/handlers/dao.rs:104-109`) and `meter.zone_id == proposal.target_zone` (`MeterZoneMismatch`, `programs/governance/src/handlers/dao.rs:110-115`), so a prosumer cannot swing another zone's proposal with an unrelated high-generation meter. The symmetric binding on `create_proposal` (`meter.zone_id == target_zone`, `programs/governance/src/handlers/dao.rs:39-44`) prevents an attacker-chosen `target_zone` divorced from the meter. Double-voting is prevented structurally by the `init` of the per-(proposal, voter) `vote_record` PDA, which fails if the record already exists (`programs/governance/src/contexts.rs:289-296`). Tally updates use `checked_add` returning `MathOverflow` (`programs/governance/src/handlers/dao.rs:109-111`). Execution is permissionless but requires the voting window to have closed and quorum (`min_quorum_votes`) plus a strict majority to mark a proposal `Passed` before any state change (`programs/governance/src/handlers/dao.rs:142-164`).

### 5.6 Cross-program account binding

ERC issuance and DAO proposal/vote contexts bind the supplied registry-owned accounts via `owner = registry::ID` constraints, and the issuance context further pins `registry_program.key() == registry::ID` and verifies the registry singleton's authority equals the governance authority (`programs/governance/src/contexts.rs:46`, `:61-78`, `:280`, `:303`). Manual deserialization through the `bytemuck` `MeterAccount` mirror checks the account is at least discriminator + struct size, then slices **exactly** `[8..8 + size_of::<MeterAccount>()]` rather than the open-ended `[8..]` remainder before casting — `from_bytes` panics on a length mismatch, so an over-long account would otherwise be a DoS vector (`programs/governance/src/handlers/erc.rs:18-27`, `programs/governance/src/handlers/dao.rs:27-33`, `:96-103`).

## 6. Cross-Program Interfaces (CPI)

### 6.1 governance → registry (outbound CPI)

During `issue_erc`, the program invokes `registry::cpi::mark_erc_claimed(energy_amount)` to debit unclaimed generation on the registry-side meter, passing `meter_account`, `registry`, and `authority` (`programs/governance/src/handlers/erc.rs:76-86`). The `registry` crate is a path dependency with the `cpi` feature (`programs/governance/Cargo.toml:25`); the target handler is `registry::mark_erc_claimed` (`programs/registry/src/lib.rs:659`).

### 6.2 trading → governance (inbound, type reuse)

The `trading` program depends on `governance` with the `cpi` feature (`programs/trading/Cargo.toml:35`) and imports the `ErcCertificate`, `ErcStatus`, and `GovernanceConfig` types (`programs/trading/src/lib.rs:18`). When an order supplies an ERC, trading validates `status == Valid`, not expired, `validated_for_trading == true`, and `energy_amount ≤ erc.energy_amount` (`programs/trading/src/lib.rs:227-242`). It also deserializes the governance `GovernanceConfig` to read configuration (`programs/trading/src/utils.rs:2-11`, account at `programs/trading/src/lib.rs:1533`). This is a read/validation relationship over governance-owned account data, not an invocation of a governance instruction.

### 6.3 oracle → governance (inbound, allow-list validation, no invoke)

The `oracle` program depends on `governance` with the `cpi` feature for types and the program ID (`programs/oracle/Cargo.toml:30`). Its `authorize_node_caller` helper derives the `[b"aggregator", signer]` PDA against `governance::ID`, asserts the supplied account is owned by `governance::ID`, deserializes it as `governance::AggregatorEntry`, and requires `active == true` and `aggregator == signer` (`programs/oracle/src/lib.rs:398-418`). No governance instruction is invoked; the dependency is types-and-ID only.

## 7. Events

| Event | Emitted by | Citation |
| --- | --- | --- |
| `GovernanceInitialized` | `initialize_governance` | `events.rs:3-8`; `handlers/initialize.rs:68` |
| `ErcIssued` | `issue_erc` | `events.rs:10-17`; `handlers/erc.rs:131` |
| `ErcValidatedForTrading` | `validate_erc_for_trading` | `events.rs:19-24`; `handlers/erc.rs:177` |
| `GovernanceConfigUpdated` | `update_governance_config` | `events.rs:26-32`; `handlers/config.rs:18` |
| `MaintenanceModeUpdated` | `set_maintenance_mode` | `events.rs:34-39`; `handlers/config.rs:38` |
| `ErcLimitsUpdated` | `update_erc_limits` | `events.rs:41-51`; `handlers/config.rs:75` |
| `AuthorityInfoUpdated` | `update_authority_info` | `events.rs:53-59`; `handlers/config.rs:115` |
| `ErcRevoked` | `revoke_erc` | `events.rs:63-70`; `handlers/erc.rs:238` |
| `ErcTransferred` | `transfer_erc` | `events.rs:74-81`; `handlers/erc.rs:300` |
| `AuthorityChangeProposed` | `propose_authority_change` | `events.rs:85-91`; `handlers/authority.rs:39` |
| `AuthorityChangeApproved` | `approve_authority_change` | `events.rs:93-98`; `handlers/authority.rs:86` |
| `AuthorityChangeCancelled` | `cancel_authority_change` | `events.rs:100-105`; `handlers/authority.rs:113` |
| `OracleAuthoritySet` | `set_oracle_authority` | `events.rs:109-115`; `handlers/authority.rs:144` |
| `ProposalCreated` | `create_proposal` | `events.rs:119-128`; `handlers/dao.rs:55` |
| `VoteCast` | `cast_vote` | `events.rs:130-137`; `handlers/dao.rs:122` |
| `ProposalExecuted` | `execute_proposal` | `events.rs:139-146`; `handlers/dao.rs:187` |
| `AggregatorAdmitted` | `admit_aggregator` | `events.rs:148-153`; `handlers/aggregator.rs:22` |
| `AggregatorRevoked` | `revoke_aggregator` | `events.rs:155-160`; `handlers/aggregator.rs:40` |

(All event citations are within `programs/governance/src/events.rs` and the named handler files.)

## 8. Error Codes

All codes are defined in `programs/governance/src/errors.rs:3-101`.

| Code | Message | Line |
| --- | --- | --- |
| `UnauthorizedAuthority` | Unauthorized authority | `errors.rs:6` |
| `MaintenanceMode` | System is in maintenance mode | `errors.rs:8` |
| `ErcValidationDisabled` | ERC validation is disabled | `errors.rs:10` |
| `InvalidErcStatus` | Invalid ERC status | `errors.rs:12` |
| `AlreadyValidated` | ERC already validated | `errors.rs:14` |
| `BelowMinimumEnergy` | Energy amount below minimum required | `errors.rs:16` |
| `ExceedsMaximumEnergy` | Energy amount exceeds maximum allowed | `errors.rs:18` |
| `CertificateIdTooLong` | Certificate ID too long | `errors.rs:20` |
| `SourceNameTooLong` | Renewable source name too long | `errors.rs:22` |
| `ErcExpired` | ERC certificate has expired | `errors.rs:24` |
| `InvalidMinimumEnergy` | Invalid minimum energy amount | `errors.rs:26` |
| `InvalidMaximumEnergy` | Invalid maximum energy amount | `errors.rs:28` |
| `InvalidValidityPeriod` | Invalid validity period | `errors.rs:30` |
| `ContactInfoTooLong` | Contact information too long | `errors.rs:32` |
| `InvalidOracleConfidence` | Invalid oracle confidence score (must be 0-100) | `errors.rs:34` |
| `OracleValidationRequired` | Oracle validation required but not configured | `errors.rs:36` |
| `TransfersNotAllowed` | Certificate transfers not allowed | `errors.rs:38` |
| `InsufficientUnclaimedGeneration` | Insufficient unclaimed generation for ERC issuance | `errors.rs:40` |
| `AlreadyRevoked` | Certificate already revoked | `errors.rs:44` |
| `RevocationReasonRequired` | Revocation reason required | `errors.rs:46` |
| `InvalidRecipient` | Invalid transfer recipient | `errors.rs:50` |
| `CannotTransferToSelf` | Cannot transfer to self | `errors.rs:52` |
| `NotValidatedForTrading` | Certificate not validated for trading | `errors.rs:54` |
| `AuthorityChangePending` | Authority change already pending | `errors.rs:58` |
| `NoAuthorityChangePending` | No authority change pending | `errors.rs:60` |
| `InvalidPendingAuthority` | Invalid pending authority | `errors.rs:62` |
| `AuthorityChangeExpired` | Authority change expired | `errors.rs:64` |
| `OracleConfidenceTooLow` | Oracle confidence below minimum threshold | `errors.rs:68` |
| `InvalidOracleAuthority` | Invalid oracle authority | `errors.rs:70` |
| `ValidationDataTooLong` | Validation data too long | `errors.rs:72` |
| `InvalidMeterAccount` | Invalid meter account | `errors.rs:74` |
| `InvalidProposalStatus` | Invalid proposal status | `errors.rs:78` |
| `ProposalExpired` | Proposal has expired | `errors.rs:80` |
| `ProposalNotExpired` | Proposal has not expired yet | `errors.rs:82` |
| `InvalidTargetZone` | Invalid target zone | `errors.rs:84` |
| `InvalidParameterType` | Invalid parameter type | `errors.rs:86` |
| `InsufficientVotingPower` | Insufficient voting power | `errors.rs:88` |
| `VoterNotRegisteredInZone` | Voter is not registered in target zone | `errors.rs:90` |
| `RevocationReasonTooLong` | Revocation reason too long | `errors.rs:92` |
| `InsufficientQuorum` | Proposal did not reach quorum | `errors.rs:94` |
| `MeterOwnerMismatch` | Meter account does not belong to signer | `errors.rs:96` |
| `MeterZoneMismatch` | Meter's zone does not match the proposal's target zone | `errors.rs:98` |
| `MathOverflow` | Math overflow | `errors.rs:100` |

(Several codes — `InvalidRecipient`, `OracleConfidenceTooLow`, `InvalidOracleAuthority`, `InsufficientVotingPower`, `VoterNotRegisteredInZone`, `InsufficientQuorum` — are declared but not referenced by the current handlers; they are reserved for forthcoming or alternative validation paths.)

## 9. Testing

### 9.1 Unit / compile-time tests

- `programs/governance/src/size_test.rs:3-7` asserts `size_of::<GovernanceConfig>() == 405`, guarding the manually computed `LEN`.
- `programs/governance/src/handlers/dao.rs:220-230` contains a placeholder unit test (`test_governance_logic_placeholder`).

These run under `cd gridtokenx-anchor && cargo test -p governance` (per-crate test invocation; the repo has no root Cargo workspace).

### 9.2 Integration tests (mocha/TypeScript)

- `npm run test:governance` runs `anchor test tests/governance.ts` (`package.json:18`). The suite `tests/governance.ts` exercises the program against a validator.
- A companion DAO suite exists at `tests/governance_dao.ts`.
- `npm run test:all` includes governance among the bundled suites (`package.json:23`).
- Raw mocha invocation (validator already running): `npx mocha -r tsx tests/governance.ts --timeout 1000000`.

Per the repo `CLAUDE.md`, Anchor 1.0 spawns `surfpool` as the test validator; where `surfpool` is unavailable, `./scripts/run-tests.sh` drives `solana-test-validator` instead.
