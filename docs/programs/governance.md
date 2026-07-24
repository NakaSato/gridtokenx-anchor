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

The `declare_id!` macro fixes the program address at `programs/governance/src/lib.rs:20`. The crate is configured as both a `cdylib` (deployable BPF object) and a `lib` (importable for CPI consumers) at `programs/governance/Cargo.toml:7-9`.

### Dependencies

| Dependency | Version / Path | Role | Citation |
| --- | --- | --- | --- |
| `anchor-lang` | `1.0.0`, features `init-if-needed` | Anchor framework | `programs/governance/Cargo.toml:24` |
| `anchor-spl` | `1.0.0`, features `metadata` | SPL token / metadata helpers | `programs/governance/Cargo.toml:25` |
| `bytemuck` | `1.20.0`, feature `derive` | Pod casting of the mirrored `MeterAccount` | `programs/governance/Cargo.toml:26` |
| `compute-debug` | path `../../shared/compute-debug`, optional | Compute-unit profiling macros | `programs/governance/Cargo.toml:27` |
| `registry` | path `../registry`, feature `cpi` | CPI into `mark_erc_claimed`; meter layout reuse | `programs/governance/Cargo.toml:28` |

The release profile sets `overflow-checks = true` (`programs/governance/Cargo.toml:32-33`), forcing bare arithmetic to panic rather than silently wrap; the handlers nonetheless prefer explicit `checked_*` / `saturating_*` operations.

The `compute_fn!` macro is a no-op outside the `localnet` feature; the program defines fallback no-op macros for non-`localnet` builds at `programs/governance/src/lib.rs:25-35`, and every instruction body is wrapped in `compute_fn!("<label>" => { ... })` at the dispatch layer (`programs/governance/src/lib.rs:41-229`).

## 2. System Role

### 2.1 PoA authority model

The program records a single `authority` pubkey — the REC certifying entity — on the `GovernanceConfig` singleton (`programs/governance/src/state/governance_config.rs:8`). On initialization the authority is set to the initializing signer, with a fixed authority name of `"REC"` and a fixed contact string (`programs/governance/src/instructions/initialize_governance.rs:25-38`). Every administrative instruction context that mutates configuration or certificates enforces `has_one = authority` against this field, rejecting non-authority callers with `GovernanceError::UnauthorizedAuthority` (`programs/governance/src/instructions/issue_erc.rs:18`, `init_rec_mint.rs:11`, `validate_erc_for_trading.rs:12`, `revoke_erc.rs:12`, `update_governance_config.rs:15`, `propose_authority_change.rs:15`, `cancel_authority_change.rs:12`, `set_oracle_authority.rs:12`, `admit_aggregator.rs:12`, `revoke_aggregator.rs:11`, `initialize_zone_config.rs:19`).

### 2.2 ERC-1155-style Renewable Energy Certificates (RECs)

An `ErcCertificate` is a per-certificate PDA recording a quantity of certified renewable energy (`energy_amount`, kWh), its renewable source, an owner, a lifecycle `status`, validity window, and transfer/revocation history (`programs/governance/src/state/erc_certificate.rs:3-43`). Certificates are fungible-by-quantity yet individually addressable — an ERC-1155-style model — supporting issuance, validation for trading, ownership transfer, and revocation. Issuance additionally mints matching **fungible REC tokens** (1 token = 1 MWh, 6 decimals) from the `[b"rec_mint"]` mint to the producer's associated token account; holders retire (burn) them via `retire_rec` (§3.8, §4.2). The term "ERC" in this codebase denotes a Renewable Energy Certificate, not the Ethereum request-for-comment numbering.

### 2.3 Two-step authority transfer

Authority handover is a two-step (propose / approve) protocol that prevents transferring control to an unreachable or mistyped key. The current authority proposes a new authority (`propose_authority_change`, `programs/governance/src/instructions/propose_authority_change.rs:23-59`); the proposed authority must itself sign to accept (`approve_authority_change`, `programs/governance/src/instructions/approve_authority_change.rs:20-62`). The pending proposal expires 48 hours after proposal (`AUTHORITY_CHANGE_EXPIRATION`, `programs/governance/src/instructions/propose_authority_change.rs:7`) and may be cancelled by the current authority (`cancel_authority_change`, `programs/governance/src/instructions/cancel_authority_change.rs:20-41`).

### 2.4 Aggregator allow-list for the oracle

The PoA authority admits off-chain validator nodes ("aggregators") to an on-chain allow-list, each represented by a dedicated `AggregatorEntry` PDA (`programs/governance/src/state/aggregator.rs:9-26`). Each entry also carries a market `segment` tag — `0` = Retail (MEA/PEA), `1` = Wholesale (EGAT) — implementing the application-layer wholesale/retail split (role-map.md fix #6; `programs/governance/src/state/aggregator.rs:21-25`). The `oracle` program authorizes a node-facing caller by deriving this PDA for the signer, asserting it is owned by the governance program, deserializing it, and requiring `active == true` with a matching aggregator pubkey (`programs/oracle/src/lib.rs:405-425`). The `trading` program's settlement path likewise raw-byte-reads the entry (active flag + segment) to gate who may submit settlements, requiring a Wholesale-admitted aggregator for a Wholesale zone (`programs/trading/src/instructions/settle_offchain.rs:152-171`). These are read-only validations: neither consumer invokes a governance instruction.

## 3. State Model

All persistent accounts in this program are regular Anchor `#[account]` structures (Borsh-serialized) rather than zero-copy. The one exception is `MeterAccount`, a zero-copy `#[repr(C)]` mirror of the registry program's layout used solely for `bytemuck` reads of registry-owned accounts (`programs/governance/src/state/meter_account.rs:5-19`); the governance program never initializes a `MeterAccount`.

### 3.1 `GovernanceConfig` — `state/governance_config.rs`

The platform singleton. PDA seed `[b"governance_config"]` (`programs/governance/src/instructions/initialize_governance.rs:11`). Regular `#[account]` (`programs/governance/src/state/governance_config.rs:4`). Allocated space is `8 + GovernanceConfig::LEN` (`programs/governance/src/instructions/initialize_governance.rs:10`), where `LEN = 405` bytes summed field-by-field at `programs/governance/src/state/governance_config.rs:76-116`. A compile-time test asserts `size_of::<GovernanceConfig>() == 405` (`programs/governance/src/size_test.rs:6`).

| Field | Type | Purpose | Citation |
| --- | --- | --- | --- |
| `authority` | `Pubkey` | Current PoA authority (REC entity) | `state/governance_config.rs:8` |
| `authority_name` / `name_len` | `[u8; 64]` / `u8` | Fixed-buffer authority name | `state/governance_config.rs:10-11` |
| `contact_info` / `contact_len` | `[u8; 128]` / `u8` | Fixed-buffer contact string | `state/governance_config.rs:13-14` |
| `version` | `u8` | Governance schema version | `state/governance_config.rs:16` |
| `maintenance_mode` | `bool` | Global pause flag | `state/governance_config.rs:20` |
| `erc_validation_enabled` | `bool` | Whether ERC issuance is permitted | `state/governance_config.rs:24` |
| `min_energy_amount` | `u64` | Minimum kWh per ERC | `state/governance_config.rs:26` |
| `max_erc_amount` | `u64` | Maximum kWh per ERC | `state/governance_config.rs:28` |
| `erc_validity_period` | `i64` | ERC validity window (seconds) | `state/governance_config.rs:30` |
| `require_oracle_validation` | `bool` | Whether oracle validation is required for issuance | `state/governance_config.rs:32` |
| `oracle_authority` | `Pubkey` | Configured oracle authority | `state/governance_config.rs:36` |
| `min_oracle_confidence` | `u8` | Minimum oracle confidence (0–100) | `state/governance_config.rs:38` |
| `allow_certificate_transfers` | `bool` | Whether ERC transfers are enabled | `state/governance_config.rs:40` |
| `min_quorum_votes` | `u64` | Minimum total votes for DAO quorum | `state/governance_config.rs:44` |
| `total_ercs_issued` | `u64` | Lifetime issuance count | `state/governance_config.rs:48` |
| `total_ercs_validated` | `u64` | Lifetime validation count | `state/governance_config.rs:50` |
| `total_ercs_revoked` | `u64` | Lifetime revocation count | `state/governance_config.rs:52` |
| `total_energy_certified` | `u64` | Lifetime certified kWh | `state/governance_config.rs:54` |
| `created_at` | `i64` | Initialization timestamp | `state/governance_config.rs:58` |
| `last_updated` | `i64` | Last mutation timestamp | `state/governance_config.rs:60` |
| `last_erc_issued_at` | `i64` | Last issuance timestamp | `state/governance_config.rs:62` |
| `pending_authority` | `Pubkey` | Proposed next authority (`default` = none) | `state/governance_config.rs:66` |
| `pending_authority_proposed_at` | `i64` | When the change was proposed | `state/governance_config.rs:68` |
| `pending_authority_expires_at` | `i64` | When the proposal expires | `state/governance_config.rs:70` |
| `_reserved` | `[u8; 5]` | Reserved padding for future fields | `state/governance_config.rs:72` |

`GovernanceConfig` provides three helper predicates: `validate_config` (range checks on energy limits, validity period, and confidence; `programs/governance/src/state/governance_config.rs:119-137`), `is_operational` (`!maintenance_mode`; `:140-142`), and `can_issue_erc` (operational AND `erc_validation_enabled`; `:145-147`).

`GovernanceStats` (`programs/governance/src/state/governance_config.rs:150-191`) is a Borsh return type, not an account; it is the projection returned by `get_governance_stats`.

### 3.2 `ErcCertificate` — `state/erc_certificate.rs`

PDA seed `[b"erc_certificate", certificate_id_bytes]` (`programs/governance/src/instructions/issue_erc.rs:25`). Regular `#[account]` (`programs/governance/src/state/erc_certificate.rs:3`). Space `8 + ErcCertificate::LEN`, with `LEN = 65 + 32 + 32 + 8 + 65 + 258 + 8 + 9 + 1 + 1 + 9 + 129 + 9 + 1 + 9` (`programs/governance/src/state/erc_certificate.rs:52`, allocated at `programs/governance/src/instructions/issue_erc.rs:24`).

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

One PDA per admitted aggregator. Seed `[b"aggregator", aggregator.as_ref()]` (`programs/governance/src/instructions/admit_aggregator.rs:20`). Regular `#[account]` (`programs/governance/src/state/aggregator.rs:9`). Space `8 + AggregatorEntry::LEN`, with `LEN = 32 + 8 + 8 + 1 + 1 + 1 = 51` (`programs/governance/src/state/aggregator.rs:28-35`, allocated at `programs/governance/src/instructions/admit_aggregator.rs:19`).

| Field | Type | Purpose | Citation |
| --- | --- | --- | --- |
| `aggregator` | `Pubkey` | Admitted node's signing pubkey | `state/aggregator.rs:12` |
| `admitted_at` | `i64` | First-admission timestamp | `state/aggregator.rs:14` |
| `updated_at` | `i64` | Last revoke/re-admit timestamp | `state/aggregator.rs:16` |
| `active` | `bool` | True while permitted to act | `state/aggregator.rs:18` |
| `bump` | `u8` | Canonical PDA bump | `state/aggregator.rs:20` |
| `segment` | `u8` | Market segment: `0` = Retail (MEA/PEA), `1` = Wholesale (EGAT) | `state/aggregator.rs:25` |

The per-aggregator PDA design avoids a growing `Vec` in a global account, conforming to the Sealevel per-entity-PDA rule (`programs/governance/src/state/aggregator.rs:3-8`). The `segment` field is deliberately appended at the **end** of the struct so that pre-existing raw-byte readers — registry's `register_validator` and trading's `require_admitted_aggregator`, which read only `[8..40)` and `[56]` — are unaffected by the size change; trading's segment gate reads byte `[58]` tolerantly, defaulting a shorter legacy account to Retail (`programs/governance/src/state/aggregator.rs:21-24`, `programs/trading/src/instructions/settle_offchain.rs:160-169`).

### 3.4 `Proposal` — `state/proposal.rs`

DAO proposal. PDA seed `[b"proposal", target_zone.to_le_bytes(), proposal_id.to_le_bytes()]` (`programs/governance/src/instructions/create_proposal.rs:13`). Regular `#[account]` (`programs/governance/src/state/proposal.rs:3`). `LEN = 87` bytes (`8 + 32 + 4 + 1 + 8 + 8 + 8 + 1 + 8 + 8 + 1`), with the 8-byte discriminator included in the constant itself (`programs/governance/src/state/proposal.rs:49-59`); the context allocates `space = Proposal::LEN` directly (`programs/governance/src/instructions/create_proposal.rs:12`).

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

Per-(proposal, voter) vote record preventing double-voting. PDA seed `[b"vote", proposal.key(), voter.key()]` (`programs/governance/src/instructions/cast_vote.rs:14`). Regular `#[account]` (`programs/governance/src/state/vote.rs:3`). `LEN = 90` bytes, discriminator included in the constant (`programs/governance/src/state/vote.rs:20-26`); context allocates `space = VoteRecord::LEN` (`programs/governance/src/instructions/cast_vote.rs:13`).

| Field | Type | Purpose | Citation |
| --- | --- | --- | --- |
| `proposal` | `Pubkey` | Target proposal | `state/vote.rs:6` |
| `voter` | `Pubkey` | Voter wallet | `state/vote.rs:8` |
| `choice` | `bool` | `true` = for, `false` = against | `state/vote.rs:10` |
| `weight` | `u64` | Voting weight at cast time | `state/vote.rs:12` |
| `voted_at` | `i64` | Cast timestamp | `state/vote.rs:14` |
| `bump` | `u8` | PDA bump | `state/vote.rs:16` |

### 3.6 `ZoneConfig` — `state/zone_config.rs`

Per-zone parameter store mutated by executed proposals. PDA seed `[b"zone_config", zone_id.to_le_bytes()]` (`programs/governance/src/instructions/initialize_zone_config.rs:12`). Regular `#[account]` (`programs/governance/src/state/zone_config.rs:3`). `LEN = 46` bytes, discriminator included (`programs/governance/src/state/zone_config.rs:22-29`); context allocates `space = ZoneConfig::LEN` (`programs/governance/src/instructions/initialize_zone_config.rs:11`).

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

### 3.8 Fungible REC mint — `[b"rec_mint"]` PDA (token mint, not program state)

The program also owns a **fungible REC token mint** at PDA `[b"rec_mint"]` — an SPL mint account, not an Anchor state struct. It is created once by `init_rec_mint` with **6 decimals** and mint authority = the `[b"governance_config"]` PDA (`programs/governance/src/instructions/init_rec_mint.rs:16-25`). Denomination: 1 token = 1 MWh, so the base unit is 1 Wh and 1 kWh = 1 000 base units. All mint/token accounts are accessed through `anchor_spl::token_interface` (`programs/governance/src/instructions/issue_erc.rs:6-9`, `init_rec_mint.rs:4`, `retire_rec.rs:4-7`), so the program is agnostic between SPL Token and Token-2022; the deployment scripts create it under **Token-2022** (`scripts/init-rec-mint.ts:13`, `:32`). Supply enters circulation only via `issue_erc` (minted to the producer) and leaves via `retire_rec` (burned by the holder) — see §4.2.

## 4. Instruction Set

Instructions are dispatched by thin `compute_fn!` wrappers in `programs/governance/src/lib.rs:43-232` and implemented one file per instruction under `programs/governance/src/instructions/` (module list at `programs/governance/src/instructions/mod.rs:1-39`), each file co-locating the `#[derive(Accounts)]` context with its handler body.

### 4.1 Initialization (`instructions/initialize_governance.rs`)

#### `initialize_governance`

- **Signers:** `authority` (becomes the PoA authority).
- **Accounts:** `governance_config` (`init`, seed `[b"governance_config"]`), `authority`, `system_program` (`programs/governance/src/instructions/initialize_governance.rs:5-18`).
- **Preconditions:** none beyond PDA non-existence; `validate_config` must pass.
- **Effects:** Sets authority to the signer; fixed name `"REC"` and contact `"engineering_erc@utcc.ac.th"`; defaults `version=1`, `maintenance_mode=false`, `erc_validation_enabled=true`, `min_energy_amount=100`, `max_erc_amount=1_000_000`, `erc_validity_period=31_536_000` (1 year), `require_oracle_validation=false`, `min_oracle_confidence=80`, `allow_certificate_transfers=true`, `min_quorum_votes=100`; zeroes counters and pending-authority state; validates config (`programs/governance/src/instructions/initialize_governance.rs:20-81`).
- **Event:** `GovernanceInitialized` (`programs/governance/src/instructions/initialize_governance.rs:83-87`).
- **Errors:** the `validate_config` range errors (`InvalidMinimumEnergy`, `InvalidMaximumEnergy`, `InvalidValidityPeriod`, `InvalidOracleConfidence`).

### 4.2 ERC certificate (`instructions/issue_erc.rs`, `init_rec_mint.rs`, `retire_rec.rs`, `validate_erc_for_trading.rs`, `revoke_erc.rs`, `transfer_erc.rs`)

#### `issue_erc(certificate_id, energy_amount, renewable_source, validation_data)`

- **Signers:** `authority` (PoA) and `owner` (meter owner) (`programs/governance/src/instructions/issue_erc.rs:45`, `:82`).
- **Accounts:** `governance_config` (`has_one = authority`), `erc_certificate` (`init`, seed `[b"erc_certificate", certificate_id]`), `meter_account` (registry-owned, validated via `owner = registry::ID`), `owner` (must equal the meter's owner field), `registry` (singleton PDA whose authority must equal the governance authority), `registry_program` (pinned to `registry::ID`), `rec_mint` (`mut`, seed `[b"rec_mint"]`), `rec_token_account` (`init_if_needed` associated token account for `rec_mint` owned by `owner`), `token_program` (`Interface<TokenInterface>`), `associated_token_program`, `authority`, `system_program` (`programs/governance/src/instructions/issue_erc.rs:11-84`; REC accounts at `:66-80`).
- **Preconditions:** `can_issue_erc()`; `energy_amount` within `[min_energy_amount, max_erc_amount]`; string-length bounds (`certificate_id ≤ 64`, `renewable_source ≤ 64`, `validation_data ≤ 256`); `energy_amount ≤ unclaimed_generation` where `unclaimed = (total_generation − total_consumption) − claimed_erc_generation − settled_net_generation` (saturating, **net-generation basis** — matches the authoritative bound in registry `mark_erc_claimed`, which the CPI re-checks; the local check just fails fast, `programs/governance/src/instructions/issue_erc.rs:105-119`, `:148-155`); if `require_oracle_validation`, `oracle_authority != default` (`programs/governance/src/instructions/issue_erc.rs:157-163`).
- **Meter deserialization:** the registry-owned meter is read by slicing exactly `&meter_data[8..8 + size_of::<MeterAccount>()]` (not the open-ended `[8..]` remainder) after the `len() >= 8 + size_of::<MeterAccount>()` check — `from_bytes` panics on a length mismatch, so an account with trailing bytes would otherwise DoS issuance (`programs/governance/src/instructions/issue_erc.rs:96-106`).
- **Effects:** Performs a CPI to `registry::mark_erc_claimed(energy_amount)` to debit unclaimed generation, then initializes the certificate (`status=Valid`, `validated_for_trading=false`, `expires_at = now + erc_validity_period`, owner = meter owner) and increments `total_ercs_issued` / `total_energy_certified` (`programs/governance/src/instructions/issue_erc.rs:165-220`). Finally **mints fungible REC tokens to the producer**: `rec_amount = energy_amount × 1_000` base units (the mint has 6 decimals and 1 token = 1 MWh, so 1 kWh = 1 000 base units), minted to `rec_token_account` via a `token_interface::mint_to` CPI signed by the `governance_config` PDA (`programs/governance/src/instructions/issue_erc.rs:230-248`).
- **Events:** `ErcIssued` (`programs/governance/src/instructions/issue_erc.rs:222-228`) then `RecMinted` (`programs/governance/src/instructions/issue_erc.rs:250-255`).
- **Errors:** `ErcValidationDisabled`, `BelowMinimumEnergy`, `ExceedsMaximumEnergy`, `CertificateIdTooLong`, `SourceNameTooLong`, `ValidationDataTooLong`, `InsufficientUnclaimedGeneration`, `OracleValidationRequired`, `InvalidMeterAccount`, `UnauthorizedAuthority`, `MathOverflow` (REC amount `checked_mul`, `programs/governance/src/instructions/issue_erc.rs:234-236`).

#### `init_rec_mint`

- **Signers:** `authority` (PoA).
- **Accounts:** `governance_config` (`has_one = authority`), `rec_mint` (`init`, seed `[b"rec_mint"]`, `mint::decimals = 6`, `mint::authority = governance_config`), `authority`, `token_program` (`Interface<TokenInterface>`), `system_program` (`programs/governance/src/instructions/init_rec_mint.rs:6-30`).
- **Effects:** Creates the fungible REC mint (§3.8) entirely via account constraints; the handler body is empty (`programs/governance/src/instructions/init_rec_mint.rs:35-37`). Run once, before any `issue_erc`.
- **Event:** none.
- **Errors:** `UnauthorizedAuthority`.

#### `retire_rec(amount)`

- **Signers:** `holder` (any REC holder — **not** PoA-gated).
- **Accounts:** `rec_mint` (`mut`, seed `[b"rec_mint"]`), `holder`, `holder_token_account` (the holder's associated token account for `rec_mint`), `token_program` (`programs/governance/src/instructions/retire_rec.rs:9-24`).
- **Preconditions:** `amount > 0` (`InvalidAmount`, `programs/governance/src/instructions/retire_rec.rs:29`).
- **Effects:** Burns `amount` base units (6 decimals) from the holder's token account via a `token_interface::burn` CPI signed by the holder — the standard REC end-of-life: the green attribute is permanently claimed and supply is removed (`programs/governance/src/instructions/retire_rec.rs:28-39`).
- **Event:** `RecRetired` (`programs/governance/src/instructions/retire_rec.rs:40-44`).
- **Errors:** `InvalidAmount`.

#### `validate_erc_for_trading`

- **Signers:** `authority` (PoA).
- **Accounts:** `governance_config` (`has_one`), `erc_certificate` (seed re-derived from stored `certificate_id[..id_len]`), `authority` (`programs/governance/src/instructions/validate_erc_for_trading.rs:6-22`).
- **Preconditions:** `is_operational()`; `status == Valid`; `!validated_for_trading`; not expired (`programs/governance/src/instructions/validate_erc_for_trading.rs:30-49`).
- **Effects:** Sets `validated_for_trading = true`, records `trading_validated_at`, increments `total_ercs_validated` (`programs/governance/src/instructions/validate_erc_for_trading.rs:52-57`).
- **Event:** `ErcValidatedForTrading` (`programs/governance/src/instructions/validate_erc_for_trading.rs:59-66`).
- **Errors:** `MaintenanceMode`, `InvalidErcStatus`, `AlreadyValidated`, `ErcExpired`, `UnauthorizedAuthority`.

#### `revoke_erc(reason)`

- **Signers:** `authority` (PoA).
- **Accounts:** `governance_config` (`has_one`), `erc_certificate`, `authority` (`programs/governance/src/instructions/revoke_erc.rs:6-22`).
- **Preconditions:** `is_operational()`; `reason` non-empty and `≤ 128`; `can_revoke()` (status `Valid` or `Pending`) (`programs/governance/src/instructions/revoke_erc.rs:31-50`).
- **Effects:** Sets `status = Revoked`, `revoked_at`, clears `validated_for_trading`, writes the reason buffer, increments `total_ercs_revoked` (`programs/governance/src/instructions/revoke_erc.rs:56-71`).
- **Event:** `ErcRevoked` (`programs/governance/src/instructions/revoke_erc.rs:73-82`).
- **Errors:** `MaintenanceMode`, `RevocationReasonRequired`, `RevocationReasonTooLong`, `AlreadyRevoked`, `UnauthorizedAuthority`.

#### `transfer_erc`

- **Signers:** `current_owner` (the certificate owner — note this instruction does **not** require the PoA authority).
- **Accounts:** `governance_config` (read-only, no `has_one`), `erc_certificate` (`constraint = owner == current_owner`), `current_owner`, `new_owner` (`programs/governance/src/instructions/transfer_erc.rs:6-25`).
- **Preconditions:** `is_operational()`; either `allow_certificate_transfers` is set **or** the current owner equals the PoA authority (issuance transfer); `can_transfer()` (`Valid` + `validated_for_trading`); not expired; `new_owner != owner` (`programs/governance/src/instructions/transfer_erc.rs:34-63`).
- **Effects:** Reassigns `owner`, increments `transfer_count`, records `last_transferred_at` (`programs/governance/src/instructions/transfer_erc.rs:71-73`).
- **Event:** `ErcTransferred` (`programs/governance/src/instructions/transfer_erc.rs:75-84`).
- **Errors:** `MaintenanceMode`, `TransfersNotAllowed`, `NotValidatedForTrading`, `ErcExpired`, `CannotTransferToSelf`, and `UnauthorizedAuthority` (from the `owner == current_owner` constraint at `programs/governance/src/instructions/transfer_erc.rs:17`).

### 4.3 Configuration (`instructions/update_governance_config.rs`)

All four instructions share the `UpdateGovernanceConfig` context (`governance_config` `has_one = authority`, `authority`; `programs/governance/src/instructions/update_governance_config.rs:9-19`).

| Instruction | Effect | Preconditions | Event | Citation |
| --- | --- | --- | --- | --- |
| `update_governance_config(erc_validation_enabled, allow_certificate_transfers)` | Sets the two boolean flags | PoA signer | `GovernanceConfigUpdated` | `instructions/update_governance_config.rs:21-41` |
| `set_maintenance_mode(maintenance_enabled)` | Sets `maintenance_mode` | PoA signer | `MaintenanceModeUpdated` | `instructions/update_governance_config.rs:43-60` |
| `update_erc_limits(min_energy_amount, max_erc_amount, erc_validity_period)` | Updates the three limits | `min > 0`, `max > min`, `validity > 0` (`InvalidMinimumEnergy` / `InvalidMaximumEnergy` / `InvalidValidityPeriod`) | `ErcLimitsUpdated` | `instructions/update_governance_config.rs:62-102` |
| `update_authority_info(contact_info)` | Updates contact buffer | `contact_info.len() ≤ 128` (`ContactInfoTooLong`) | `AuthorityInfoUpdated` | `instructions/update_governance_config.rs:104-138` |

### 4.4 DAO governance (`instructions/initialize_zone_config.rs`, `create_proposal.rs`, `cast_vote.rs`, `execute_proposal.rs`)

#### `initialize_zone_config(zone_id, incentive_multiplier, wheeling_charge)`

- **Signers:** `authority` (PoA).
- **Accounts:** `zone_config` (`init`, seed `[b"zone_config", zone_id]`), `governance_config` (`has_one = authority`), `authority`, `system_program` (`programs/governance/src/instructions/initialize_zone_config.rs:5-25`).
- **Effects:** Initializes the zone with the supplied multiplier and charge, `loss_factor = 1_000` (1.000×), `maintenance_mode = false` (`programs/governance/src/instructions/initialize_zone_config.rs:36-42`).
- **Event:** none (`msg!` log only).

#### `create_proposal(target_zone, proposal_id, parameter, new_value, voting_period_seconds)`

- **Signers:** `proposer`.
- **Accounts:** `proposal` (`init`, seed `[b"proposal", target_zone, proposal_id]`), `proposer`, `meter_account` (registry-owned), `system_program` (`programs/governance/src/instructions/create_proposal.rs:6-26`).
- **Preconditions:** `voting_period_seconds > 0` (`InvalidProposalStatus`); the supplied meter's `owner` must equal `proposer` (`MeterOwnerMismatch`); the meter's `zone_id` must equal the supplied `target_zone` (`MeterZoneMismatch`) — a proposer may only open a proposal for the zone their meter is in, so `target_zone` cannot be an attacker-chosen value unrelated to the meter (`programs/governance/src/instructions/create_proposal.rs:40-66`).
- **Meter deserialization:** the registry-owned meter is read by slicing exactly `&meter_data[8..8 + size_of::<MeterAccount>()]` (not the open-ended `[8..]` remainder) before `bytemuck::from_bytes`, after asserting `len() >= 8 + size_of::<MeterAccount>()` — `from_bytes` panics on a length mismatch, so an account carrying trailing bytes would otherwise DoS the instruction (`programs/governance/src/instructions/create_proposal.rs:47-54`).
- **Effects:** Initializes the proposal (`status = Active`, zeroed tallies, `expires_at = now + voting_period_seconds` via `checked_add`) (`programs/governance/src/instructions/create_proposal.rs:68-80`).
- **Event:** `ProposalCreated` (`programs/governance/src/instructions/create_proposal.rs:82-90`).
- **Errors:** `InvalidProposalStatus`, `InvalidMeterAccount`, `MeterOwnerMismatch`, `MeterZoneMismatch`, `MathOverflow`.

#### `cast_vote(choice)`

- **Signers:** `voter`.
- **Accounts:** `proposal` (`mut`), `vote_record` (`init`, seed `[b"vote", proposal, voter]` — its existence prevents double-voting), `voter`, `meter_account` (registry-owned), `system_program` (`programs/governance/src/instructions/cast_vote.rs:6-27`).
- **Preconditions:** `proposal.status == Active`; `now < expires_at`; the supplied meter's `owner` must equal `voter` (`MeterOwnerMismatch`); the meter's `zone_id` must equal `proposal.target_zone` (`MeterZoneMismatch`) — a prosumer cannot swing another zone's proposal with an unrelated high-generation meter (`programs/governance/src/instructions/cast_vote.rs:38-70`).
- **Meter deserialization:** as in `create_proposal`, the meter is read via `&meter_data[8..8 + size_of::<MeterAccount>()]` after the `len() >= 8 + size_of::<MeterAccount>()` check, avoiding the `from_bytes` length-mismatch panic that an over-long account would trigger (`programs/governance/src/instructions/cast_vote.rs:51-58`).
- **Effects:** Computes weight = `max(100, total_generation / 1_000)`; adds weight to `votes_for` or `votes_against` (`checked_add`); writes the `VoteRecord` (`programs/governance/src/instructions/cast_vote.rs:47-87`).
- **Event:** `VoteCast` (`programs/governance/src/instructions/cast_vote.rs:89-95`).
- **Errors:** `InvalidProposalStatus`, `ProposalExpired`, `InvalidMeterAccount`, `MeterOwnerMismatch`, `MeterZoneMismatch`, `MathOverflow`.

#### `execute_proposal`

- **Signers:** `executor` (any signer; permissionless finalization).
- **Accounts:** `governance_config` (read-only, supplies `min_quorum_votes`), `zone_config` (`mut`, seed `[b"zone_config", zone_id]`), `proposal` (`mut`, constrained `target_zone == zone_config.zone_id` and status `Active` or `Passed`), `executor` (`programs/governance/src/instructions/execute_proposal.rs:6-32`).
- **Preconditions:** `now >= proposal.expires_at` (`ProposalNotExpired`); after auto-finalization, `status == Passed` (`InvalidProposalStatus`) (`programs/governance/src/instructions/execute_proposal.rs:58-76`).
- **Effects:** Auto-finalizes an `Active` proposal via the pure helper `finalize_proposal_status` — `Rejected` if `total_votes < min_quorum` or `votes_for <= votes_against`, else `Passed` (`programs/governance/src/instructions/execute_proposal.rs:38-47`); applies the parameter change to `zone_config` (with `LossFactor` requiring `new_value > 0`); sets `status = Executed` (`programs/governance/src/instructions/execute_proposal.rs:64-97`).
- **Event:** `ProposalExecuted` (`programs/governance/src/instructions/execute_proposal.rs:99-105`).
- **Errors:** `ProposalNotExpired`, `InvalidProposalStatus`, `InvalidTargetZone`, `InvalidParameterType`.

### 4.5 Authority management (`instructions/propose_authority_change.rs`, `approve_authority_change.rs`, `cancel_authority_change.rs`, `set_oracle_authority.rs`)

| Instruction | Signers | Effect | Preconditions | Event | Citation |
| --- | --- | --- | --- | --- | --- |
| `propose_authority_change(new_authority)` | current `authority` | Sets pending authority with 48-hour expiry | no pending change (`AuthorityChangePending`); `new_authority != authority` (`CannotTransferToSelf`) | `AuthorityChangeProposed` | `instructions/propose_authority_change.rs:23-59` |
| `approve_authority_change` | `new_authority` (the proposed key) | Promotes pending to authority; clears pending | pending != default (`NoAuthorityChangePending`); signer == pending (`InvalidPendingAuthority`); not expired (`AuthorityChangeExpired`) | `AuthorityChangeApproved` | `instructions/approve_authority_change.rs:20-62` |
| `cancel_authority_change` | current `authority` | Clears pending state | pending != default (`NoAuthorityChangePending`) | `AuthorityChangeCancelled` | `instructions/cancel_authority_change.rs:20-41` |
| `set_oracle_authority(oracle_authority, min_confidence, require_validation)` | current `authority` | Sets oracle authority/confidence/requirement | `min_confidence ≤ 100` (`InvalidOracleConfidence`) | `OracleAuthoritySet` | `instructions/set_oracle_authority.rs:19-48` |

`approve_authority_change` uses the `ApproveAuthorityChange` context (`programs/governance/src/instructions/approve_authority_change.rs:6-16`), whose `governance_config` is **not** `has_one`-gated; authorization is enforced in-handler by requiring the signer to equal `pending_authority`.

### 4.6 Aggregator allow-list (`instructions/admit_aggregator.rs`, `revoke_aggregator.rs`)

| Instruction | Signers | Effect | Event | Citation |
| --- | --- | --- | --- | --- |
| `admit_aggregator(aggregator, segment)` | current `authority` | `init_if_needed` the `AggregatorEntry`; sets `active = true` and writes the market `segment` (`0` = Retail, `1` = Wholesale; re-settable on re-admission, same as `active`); idempotent re-admission flips a revoked entry back active without failing | `AggregatorAdmitted` | `instructions/admit_aggregator.rs:34-56` |
| `revoke_aggregator` | current `authority` | Sets `active = false`, retains the PDA as an audit trail | `AggregatorRevoked` | `instructions/revoke_aggregator.rs:28-41` |

Both contexts gate `governance_config` with `has_one = authority` (`programs/governance/src/instructions/admit_aggregator.rs:12`, `programs/governance/src/instructions/revoke_aggregator.rs:11`).

### 4.7 Statistics (`instructions/get_governance_stats.rs`)

#### `get_governance_stats`

A read-only view returning a `GovernanceStats` value projecting `GovernanceConfig` fields, with the fixed-buffer name/contact rehydrated via `String::from_utf8_lossy` (`programs/governance/src/instructions/get_governance_stats.rs:13-63`). Context `GetGovernanceStats` requires only the `governance_config` PDA, no signer (`programs/governance/src/instructions/get_governance_stats.rs:4-11`).

## 5. Invariants & Security Properties

### 5.1 PoA authority gating

All configuration-mutating, ERC-administrative (issue, validate, revoke), REC-mint-initialization, zone-initialization, oracle-configuration, and aggregator instructions enforce `has_one = authority` on the `governance_config` PDA, rejecting non-authority signers with `UnauthorizedAuthority` (`programs/governance/src/instructions/issue_erc.rs:18`, `init_rec_mint.rs:11`, `validate_erc_for_trading.rs:12`, `revoke_erc.rs:12`, `update_governance_config.rs:15`, `propose_authority_change.rs:15`, `cancel_authority_change.rs:12`, `set_oracle_authority.rs:12`, `admit_aggregator.rs:12`, `revoke_aggregator.rs:11`, `initialize_zone_config.rs:19`). The singleton PDA seed `[b"governance_config"]` guarantees a single canonical config account (`programs/governance/src/instructions/initialize_governance.rs:11`).

### 5.2 Two-step transfer safety

The proposing step refuses to overwrite an existing pending change (`AuthorityChangePending`, `programs/governance/src/instructions/propose_authority_change.rs:31-34`) and refuses a self-proposal (`CannotTransferToSelf`, `:37-40`). The approving step requires the **proposed** key to sign, comparing it to the stored pending value (`InvalidPendingAuthority`, `programs/governance/src/instructions/approve_authority_change.rs:29-32`), and rejects an expired proposal (`AuthorityChangeExpired`, `:35-41`). Because acceptance requires the new key's signature, control cannot be transferred to a key that cannot sign. The current authority retains a unilateral cancel path before acceptance (`programs/governance/src/instructions/cancel_authority_change.rs:20-41`). The 48-hour expiry (`AUTHORITY_CHANGE_EXPIRATION`, `programs/governance/src/instructions/propose_authority_change.rs:7`) bounds the window in which a stale proposal can be accepted.

### 5.3 Aggregator allow-list integrity

Admission and revocation are PoA-gated (§5.1). Each entry is a deterministic PDA keyed by the aggregator pubkey (`programs/governance/src/instructions/admit_aggregator.rs:20`), so a consumer can derive and verify the canonical address. Revocation preserves the PDA and sets `active = false` rather than closing it, retaining an audit trail; the source explicitly requires consumers to reject inactive entries (`programs/governance/src/instructions/revoke_aggregator.rs:25-27`). The oracle program enforces exactly that (`active == true` plus pubkey match) before authorizing a node caller (`programs/oracle/src/lib.rs:420-423`). The `segment` byte is additionally consumed as authorization data by trading's settlement gate: a Wholesale zone (`ZoneMarket.segment == 1`) only accepts a Wholesale-admitted aggregator (`AggregatorSegmentMismatch` otherwise), while Retail zones accept any admitted aggregator — additive and backward compatible, since a legacy pre-segment entry is read as Retail (`programs/trading/src/instructions/settle_offchain.rs:160-169`).

### 5.4 ERC supply / double-claim accounting

ERC issuance is bounded by unclaimed **net** meter generation: `unclaimed = (total_generation − total_consumption) − claimed_erc_generation − settled_net_generation` (saturating subtraction), and `energy_amount ≤ unclaimed` is required (`InsufficientUnclaimedGeneration`, `programs/governance/src/instructions/issue_erc.rs:105-119`, `:148-155`). The net basis deliberately mirrors registry `mark_erc_claimed`, the authoritative bound: the CPI re-checks against net generation and reverts the whole tx if exceeded, so combined GRID + REC claims can never exceed net generation. Issuance then performs a CPI into `registry::mark_erc_claimed` to atomically debit the registry's claimed counter, closing the double-claim window (`programs/governance/src/instructions/issue_erc.rs:165-177`). The certificate is initialized as `Valid` but **not** `validated_for_trading`; a separate authority action gates trading eligibility (`programs/governance/src/instructions/issue_erc.rs:203-204`). Aggregate counters (`total_ercs_issued`, `total_energy_certified`, `total_ercs_validated`, `total_ercs_revoked`) use `saturating_add` (`programs/governance/src/instructions/issue_erc.rs:215-218`, `validate_erc_for_trading.rs:56`, `revoke_erc.rs:61`). Fungible REC supply is bound to the same gate: REC tokens are minted only inside `issue_erc` (at `energy_amount × 1_000` base units, `checked_mul`), so on-chain REC supply can never exceed certified-and-claimed generation, and `retire_rec` only ever burns (`programs/governance/src/instructions/issue_erc.rs:234-248`, `retire_rec.rs:31-39`).

### 5.5 DAO weight and finalization integrity

Voting weight is derived from the registry-owned meter's `total_generation`, and the meter account is bound to `owner = registry::ID` at the context level so a forged account cannot manufacture weight (`programs/governance/src/instructions/cast_vote.rs:20-25`); the handler additionally requires `meter.owner == voter` (`MeterOwnerMismatch`, `programs/governance/src/instructions/cast_vote.rs:60-64`) and `meter.zone_id == proposal.target_zone` (`MeterZoneMismatch`, `programs/governance/src/instructions/cast_vote.rs:65-70`), so a prosumer cannot swing another zone's proposal with an unrelated high-generation meter. The symmetric binding on `create_proposal` (`meter.zone_id == target_zone`, `programs/governance/src/instructions/create_proposal.rs:60-65`) prevents an attacker-chosen `target_zone` divorced from the meter. Double-voting is prevented structurally by the `init` of the per-(proposal, voter) `vote_record` PDA, which fails if the record already exists (`programs/governance/src/instructions/cast_vote.rs:10-17`). Tally updates use `checked_add` returning `MathOverflow` (`programs/governance/src/instructions/cast_vote.rs:75-79`). Execution is permissionless but requires the voting window to have closed and quorum (`min_quorum_votes`) plus a strict majority to mark a proposal `Passed` before any state change (`programs/governance/src/instructions/execute_proposal.rs:38-47`, `:58-76`).

### 5.6 Cross-program account binding

ERC issuance and DAO proposal/vote contexts bind the supplied registry-owned accounts via `owner = registry::ID` constraints, and the issuance context further pins `registry_program.key() == registry::ID` and verifies the registry singleton's authority equals the governance authority (`programs/governance/src/instructions/issue_erc.rs:31-34`, `:48-65`, `programs/governance/src/instructions/create_proposal.rs:23`, `programs/governance/src/instructions/cast_vote.rs:24`). Manual deserialization through the `bytemuck` `MeterAccount` mirror checks the account is at least discriminator + struct size, then slices **exactly** `[8..8 + size_of::<MeterAccount>()]` rather than the open-ended `[8..]` remainder before casting — `from_bytes` panics on a length mismatch, so an over-long account would otherwise be a DoS vector (`programs/governance/src/instructions/issue_erc.rs:96-106`, `programs/governance/src/instructions/create_proposal.rs:47-54`, `programs/governance/src/instructions/cast_vote.rs:51-58`).

## 6. Cross-Program Interfaces (CPI)

### 6.1 governance → registry (outbound CPI)

During `issue_erc`, the program invokes `registry::cpi::mark_erc_claimed(energy_amount)` to debit unclaimed generation on the registry-side meter, passing `meter_account`, `registry`, and `authority` (`programs/governance/src/instructions/issue_erc.rs:165-177`). The `registry` crate is a path dependency with the `cpi` feature (`programs/governance/Cargo.toml:28`); the target handler is `registry::mark_erc_claimed` (`programs/registry/src/lib.rs:233`, body in `programs/registry/src/instructions/mark_erc_claimed.rs`).

### 6.2 trading → governance (inbound, type reuse)

The `trading` program depends on `governance` with the `cpi` feature (`programs/trading/Cargo.toml:35`) and imports the `ErcCertificate`, `ErcStatus`, and `GovernanceConfig` types (`programs/trading/src/lib.rs:21`). When an order supplies an ERC, trading validates `status == Valid`, not expired, `validated_for_trading == true`, and `energy_amount ≤ erc.energy_amount` (`programs/trading/src/instructions/create_sell_order.rs:58-73`). It also deserializes the governance `GovernanceConfig` to read configuration (`programs/trading/src/utils.rs:5-12`, account at `programs/trading/src/instructions/create_sell_order.rs:20`). This is a read/validation relationship over governance-owned account data, not an invocation of a governance instruction.

### 6.3 oracle → governance (inbound, allow-list validation, no invoke)

The `oracle` program depends on `governance` with the `cpi` feature for types and the program ID (`programs/oracle/Cargo.toml:30`). Its `authorize_node_caller` helper derives the `[b"aggregator", signer]` PDA against `governance::ID`, asserts the supplied account is owned by `governance::ID`, deserializes it as `governance::AggregatorEntry`, and requires `active == true` and `aggregator == signer` (`programs/oracle/src/lib.rs:405-425`). No governance instruction is invoked; the dependency is types-and-ID only.

## 7. Events

| Event | Emitted by | Citation |
| --- | --- | --- |
| `GovernanceInitialized` | `initialize_governance` | `events.rs:3-8`; `instructions/initialize_governance.rs:83` |
| `ErcIssued` | `issue_erc` | `events.rs:10-17`; `instructions/issue_erc.rs:222` |
| `RecMinted` | `issue_erc` (fungible REC minted to the producer alongside the certificate) | `events.rs:21-27`; `instructions/issue_erc.rs:250` |
| `RecRetired` | `retire_rec` | `events.rs:30-35`; `instructions/retire_rec.rs:40` |
| `ErcValidatedForTrading` | `validate_erc_for_trading` | `events.rs:37-42`; `instructions/validate_erc_for_trading.rs:59` |
| `GovernanceConfigUpdated` | `update_governance_config` | `events.rs:44-50`; `instructions/update_governance_config.rs:33` |
| `MaintenanceModeUpdated` | `set_maintenance_mode` | `events.rs:52-57`; `instructions/update_governance_config.rs:53` |
| `ErcLimitsUpdated` | `update_erc_limits` | `events.rs:59-69`; `instructions/update_governance_config.rs:90` |
| `AuthorityInfoUpdated` | `update_authority_info` | `events.rs:71-77`; `instructions/update_governance_config.rs:130` |
| `ErcRevoked` | `revoke_erc` | `events.rs:81-88`; `instructions/revoke_erc.rs:73` |
| `ErcTransferred` | `transfer_erc` | `events.rs:92-99`; `instructions/transfer_erc.rs:75` |
| `AuthorityChangeProposed` | `propose_authority_change` | `events.rs:103-109`; `instructions/propose_authority_change.rs:49` |
| `AuthorityChangeApproved` | `approve_authority_change` | `events.rs:111-116`; `instructions/approve_authority_change.rs:53` |
| `AuthorityChangeCancelled` | `cancel_authority_change` | `events.rs:118-123`; `instructions/cancel_authority_change.rs:34` |
| `OracleAuthoritySet` | `set_oracle_authority` | `events.rs:127-133`; `instructions/set_oracle_authority.rs:40` |
| `ProposalCreated` | `create_proposal` | `events.rs:137-146`; `instructions/create_proposal.rs:82` |
| `VoteCast` | `cast_vote` | `events.rs:148-155`; `instructions/cast_vote.rs:89` |
| `ProposalExecuted` | `execute_proposal` | `events.rs:157-164`; `instructions/execute_proposal.rs:99` |
| `AggregatorAdmitted` | `admit_aggregator` | `events.rs:166-171`; `instructions/admit_aggregator.rs:50` |
| `AggregatorRevoked` | `revoke_aggregator` | `events.rs:173-178`; `instructions/revoke_aggregator.rs:35` |

(All event citations are within `programs/governance/src/events.rs` and the named files under `programs/governance/src/instructions/`.)

## 8. Error Codes

All codes are defined in `programs/governance/src/errors.rs:3-103`.

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
| `InvalidAmount` | Amount must be greater than zero | `errors.rs:102` |

(Several codes — `InvalidRecipient`, `OracleConfidenceTooLow`, `InvalidOracleAuthority`, `InsufficientVotingPower`, `VoterNotRegisteredInZone`, `InsufficientQuorum` — are declared but not referenced by the current handlers; they are reserved for forthcoming or alternative validation paths.)

## 9. Testing

### 9.1 Unit / compile-time tests

- `programs/governance/src/size_test.rs:3-7` asserts `size_of::<GovernanceConfig>() == 405`, guarding the manually computed `LEN`.
- `programs/governance/src/instructions/execute_proposal.rs:110-160` unit-tests the pure `finalize_proposal_status` helper (quorum boundary, tie, against-majority, zero-quorum, and vote-sum saturation cases).

These run under `cd gridtokenx-anchor && cargo test -p governance` (per-crate test invocation; the repo has no root Cargo workspace).

### 9.2 Integration tests (mocha/TypeScript)

- `npm run test:governance` runs `anchor test tests/governance.ts` (`package.json:18`). The suite `tests/governance.ts` exercises the program against a validator.
- A companion DAO suite exists at `tests/governance_dao.ts`.
- `npm run test:all` includes governance among the bundled suites (`package.json:23`).
- Raw mocha invocation (validator already running): `npx mocha -r tsx tests/governance.ts --timeout 1000000`.

Per the repo `CLAUDE.md`, Anchor 1.0 spawns `surfpool` as the test validator.
