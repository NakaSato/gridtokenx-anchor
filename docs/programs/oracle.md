# Oracle Program

## Abstract

The `oracle` program is the on-chain bridge between the platform's Advanced Metering Infrastructure (AMI) — the network of smart energy meters and their off-chain gateway — and the Solana ledger. It records validated per-meter energy production and consumption readings, enforces range, anomaly, and rate-limit checks at ingest time, and finalizes 15-minute market-clearing epochs that downstream settlement consumes. To keep the high-frequency reading path parallelizable under Solana's Sealevel runtime, the program writes each meter's data to its own Program Derived Address (PDA) while treating the singleton configuration account as read-only on that path (`programs/oracle/src/lib.rs:70`). Node-facing instructions are authorized either by the configured chain bridge key or by an aggregator admitted to the `governance` program's Proof-of-Authority (PoA) allow-list, the latter proven by supplying that aggregator's `AggregatorEntry` PDA (`programs/oracle/src/lib.rs:398`).

---

## 1. Program Identity

| Property | Value |
| --- | --- |
| Program ID | `64Vgos61STZ8pW9NnHi2iGtXMTQr7NqBoMorK6Zg8RJU` |
| Crate name | `oracle` |
| Crate version | `0.1.1` |
| Description | "Oracle program for P2P Energy Trading - AMI data bridge" |
| Edition | 2021 |

The program ID is declared at `programs/oracle/src/lib.rs:14` via `declare_id!`. The crate name, version, and description are defined in `programs/oracle/Cargo.toml:2`–`programs/oracle/Cargo.toml:4`.

### Dependencies

| Dependency | Version / Source | Role |
| --- | --- | --- |
| `anchor-lang` | `1.0.0` (feature `init-if-needed`) | Anchor framework runtime and macros (`programs/oracle/Cargo.toml:24`) |
| `anchor-spl` | `1.0.0` (feature `metadata`) | SPL helpers (`programs/oracle/Cargo.toml:25`) |
| `bytemuck` | `1.20.0` (feature `derive`) | Pod/zero-copy derivation for `OracleData` (`programs/oracle/Cargo.toml:26`) |
| `compute-debug` | path `../../shared/compute-debug`, optional | Compute-unit profiling macros, gated by the `localnet` feature (`programs/oracle/Cargo.toml:27`) |
| `governance` | path `../governance`, feature `cpi` | Types and program ID only — no CPI invoke (`programs/oracle/Cargo.toml:30`) |

The `governance` dependency is consumed for **types and the program ID only**; the oracle performs no cross-program invocation into governance. As documented in the crate manifest, the dependency exists to authorize admitted aggregators against governance's PoA allow-list, and the `cpi` feature is requested solely because it pulls in `no-entrypoint` to avoid a duplicate program entrypoint (`programs/oracle/Cargo.toml:28`–`programs/oracle/Cargo.toml:30`). Concretely, the oracle imports the `governance::ID` constant and the `governance::AggregatorEntry` account type, deserializes a supplied `AggregatorEntry` PDA in-process, and validates it — it never issues an instruction to the governance program (`programs/oracle/src/lib.rs:407`–`programs/oracle/src/lib.rs:412`).

The `localnet` feature enables compute profiling by importing `compute_debug::{compute_checkpoint, compute_fn}`; when the feature is absent, `compute_fn!` expands to a no-op that simply evaluates its block (`programs/oracle/src/lib.rs:16`–`programs/oracle/src/lib.rs:29`).

---

## 2. System Role

The oracle is the AMI gateway bridge. Advanced Metering Infrastructure (AMI) denotes the off-chain population of smart meters together with the gateway that collects their readings. The off-chain chain bridge submits each validated reading to the ledger through `submit_meter_reading`, and that instruction enforces that only the configured chain-bridge key may submit (`programs/oracle/src/lib.rs:95`–`programs/oracle/src/lib.rs:98`).

The program maintains two tiers of state:

1. **Per-meter state.** Each physical meter is represented by a dedicated `MeterState` PDA keyed by its meter identifier (`programs/oracle/src/state.rs:8`–`programs/oracle/src/state.rs:9`). Readings for distinct meters therefore touch disjoint write sets, which is the precondition for Solana Sealevel parallel execution.
2. **Singleton configuration and global counters.** A single `OracleData` account (PDA seed `b"oracle_data"`) holds program authority, the chain-bridge key, validation thresholds, and globally aggregated totals (`programs/oracle/src/lib.rs:473`–`programs/oracle/src/lib.rs:480`). On the hot reading path this account is loaded read-only so it imposes no write lock (`programs/oracle/src/lib.rs:91`).

**Market-clearing epochs.** Market clearing is organized into 15-minute (900-second) epochs. The `trigger_market_clearing` instruction finalizes an epoch by recording its timestamp, and the timestamp must be aligned to a 900-second boundary (`programs/oracle/src/lib.rs:206`–`programs/oracle/src/lib.rs:209`). The epoch must be strictly greater than the last cleared epoch and must not be in the future (`programs/oracle/src/lib.rs:196`–`programs/oracle/src/lib.rs:203`).

**Relationship to the governance allow-list.** Beyond the chain-bridge key, the node-facing instructions `trigger_market_clearing` and `aggregate_readings` accept callers that are aggregators admitted to the `governance` PoA allow-list. Admission is represented in governance by a one-PDA-per-aggregator `AggregatorEntry` account (seeds `[b"aggregator", aggregator.as_ref()]`) carrying an `active` flag (`programs/governance/src/state/aggregator.rs:9`–`programs/governance/src/state/aggregator.rs:21`). The oracle validates such an entry in-handler (Section 6).

---

## 3. State Model

The program defines two account types in `programs/oracle/src/state.rs`. `MeterState` is a regular Borsh-serialized `#[account]` struct; `OracleData` is a zero-copy (`#[account(zero_copy)] #[repr(C)]`) struct accessed through an `AccountLoader`.

### 3.1 `MeterState` (regular account)

PDA seeds: `[b"meter", meter_id.as_bytes()]` (`programs/oracle/src/lib.rs:500`). One account per meter. Declared at `programs/oracle/src/state.rs:11`.

| Field | Type | Size (bytes) | Meaning |
| --- | --- | --- | --- |
| `meter_id` | `[u8; 32]` | 32 | Fixed-size meter identifier (`programs/oracle/src/state.rs:13`) |
| `meter_id_len` | `u8` | 1 | Actual byte length of `meter_id` (`programs/oracle/src/state.rs:14`) |
| `bump` | `u8` | 1 | PDA bump seed (`programs/oracle/src/state.rs:15`) |
| `zone_id` | `i32` | 4 | Regional/zone identifier (`programs/oracle/src/state.rs:16`) |
| `energy_produced` | `u64` | 8 | Latest reading — energy produced (`programs/oracle/src/state.rs:17`) |
| `energy_consumed` | `u64` | 8 | Latest reading — energy consumed (`programs/oracle/src/state.rs:18`) |
| `total_energy_produced` | `u64` | 8 | Cumulative production for this meter (`programs/oracle/src/state.rs:19`) |
| `total_energy_consumed` | `u64` | 8 | Cumulative consumption for this meter (`programs/oracle/src/state.rs:20`) |
| `last_reading_timestamp` | `i64` | 8 | Timestamp of the most recent accepted reading (`programs/oracle/src/state.rs:21`) |
| `total_readings` | `u64` | 8 | Count of accepted readings for this meter (`programs/oracle/src/state.rs:22`) |
| `created_at` | `i64` | 8 | First-use timestamp (`programs/oracle/src/state.rs:23`) |

Space: `MeterState::SPACE = 8 + 32 + 1 + 1 + 4 + 8 + 8 + 8 + 8 + 8 + 8 + 8 = 102` bytes, including the 8-byte account discriminator (`programs/oracle/src/state.rs:27`–`programs/oracle/src/state.rs:28`). The maximum meter identifier length is `MAX_METER_ID_LEN = 32` (`programs/oracle/src/state.rs:6`).

### 3.2 `OracleData` (zero-copy account)

PDA seed: `[b"oracle_data"]` — a program singleton (`programs/oracle/src/lib.rs:477`). Declared `#[account(zero_copy)] #[repr(C)]` at `programs/oracle/src/state.rs:34`–`programs/oracle/src/state.rs:35`. Allocated space is `8 + std::mem::size_of::<OracleData>()` (`programs/oracle/src/lib.rs:476`).

| Field | Type | Size (bytes) | Meaning |
| --- | --- | --- | --- |
| `authority` | `Pubkey` | 32 | Administrative authority (`programs/oracle/src/state.rs:38`) |
| `chain_bridge` | `Pubkey` | 32 | Authorized gateway / chain-bridge signer key (`programs/oracle/src/state.rs:39`) |
| `total_readings` | `u64` | 8 | Global reading counter (`programs/oracle/src/state.rs:42`) |
| `last_reading_timestamp` | `i64` | 8 | Timestamp of last aggregation (`programs/oracle/src/state.rs:43`) |
| `last_clearing` | `i64` | 8 | Wall-clock time of last clearing trigger (`programs/oracle/src/state.rs:44`) |
| `created_at` | `i64` | 8 | Account creation timestamp (`programs/oracle/src/state.rs:45`) |
| `min_energy_value` | `u64` | 8 | Lower bound for non-zero energy values (`programs/oracle/src/state.rs:46`) |
| `max_energy_value` | `u64` | 8 | Upper bound for energy values (`programs/oracle/src/state.rs:47`) |
| `total_valid_readings` | `u64` | 8 | Cumulative accepted readings (`programs/oracle/src/state.rs:48`) |
| `total_rejected_readings` | `u64` | 8 | Cumulative rejected readings (`programs/oracle/src/state.rs:49`) |
| `quality_score_updated_at` | `i64` | 8 | Timestamp of last quality-score update (`programs/oracle/src/state.rs:50`) |
| `total_global_energy_produced` | `u64` | 8 | Cumulative global production (`programs/oracle/src/state.rs:51`) |
| `total_global_energy_consumed` | `u64` | 8 | Cumulative global consumption (`programs/oracle/src/state.rs:52`) |
| `last_cleared_epoch` | `i64` | 8 | Last finalized epoch (Unix seconds) (`programs/oracle/src/state.rs:53`) |
| `min_reading_interval` | `u16` | 2 | Minimum seconds between readings — rate limit (`programs/oracle/src/state.rs:56`) |
| `max_production_consumption_ratio` | `u16` | 2 | Anomaly threshold; 1000 = 10× (`programs/oracle/src/state.rs:57`) |
| `active` | `u8` | 1 | 1 = active, 0 = inactive (`programs/oracle/src/state.rs:60`) |
| `anomaly_detection_enabled` | `u8` | 1 | 1 = enabled, 0 = disabled (`programs/oracle/src/state.rs:61`) |
| `last_quality_score` | `u8` | 1 | Quality score 0–100 (`programs/oracle/src/state.rs:62`) |
| `_padding` | `[u8; 1]` | 1 | Explicit alignment padding (`programs/oracle/src/state.rs:67`) |

Per the layout commentary, the two `Pubkey` fields (64 bytes) plus twelve 8-byte fields (96 bytes) reach 160 bytes; the two `u16` fields (4 bytes) and three `u8` fields (3 bytes) contribute 7 bytes, and a single byte of explicit `_padding` raises the total to 168 bytes, divisible by 8 for `bytemuck::Pod` alignment (`programs/oracle/src/state.rs:64`–`programs/oracle/src/state.rs:67`). The struct contains no `String`, consistent with the zero-copy invariant; the meter identifier is stored as `[u8; 32]` plus a length byte on `MeterState`.

---

## 4. Instruction Set

The program exposes eight instructions, all defined in the `#[program] mod oracle` block (`programs/oracle/src/lib.rs:31`). Each instruction body is wrapped in `compute_fn!` for compute-unit profiling under the `localnet` feature.

### 4.1 `initialize`

- **Signature:** `initialize(ctx, chain_bridge: Pubkey)` (`programs/oracle/src/lib.rs:35`).
- **Accounts (`Initialize`, `programs/oracle/src/lib.rs:471`):** `oracle_data` (`init`, PDA `b"oracle_data"`, payer = `authority`, space `8 + size_of::<OracleData>()`); `authority` (`mut` signer, rent payer); `system_program`.
- **Signers:** `authority`.
- **Effects:** Initializes `OracleData` via `load_init()`, setting `authority`, `chain_bridge`, `active = 1`, `created_at = now`, default validation thresholds (`min_energy_value = 0`, `max_energy_value = 1_000_000`, `anomaly_detection_enabled = 1`, `max_production_consumption_ratio = 1000`), `min_reading_interval = 60`, `last_quality_score = 100`, and zeroed counters (`programs/oracle/src/lib.rs:40`–`programs/oracle/src/lib.rs:62`). A single `Clock::get()` is reused for both `created_at` and `quality_score_updated_at` (`programs/oracle/src/lib.rs:37`–`programs/oracle/src/lib.rs:39`).
- **Events:** None.
- **Errors:** None beyond Anchor account-init constraints.

### 4.2 `submit_meter_reading`

- **Signature:** `submit_meter_reading(ctx, meter_id: String, energy_produced: u64, energy_consumed: u64, reading_timestamp: i64, zone_id: i32)` (`programs/oracle/src/lib.rs:75`).
- **Accounts (`SubmitMeterReading`, `programs/oracle/src/lib.rs:488`):** `oracle_data` (read-only PDA — no write lock); `meter_state` (`init_if_needed`, PDA `[b"meter", meter_id.as_bytes()]`, payer = `authority`, space `MeterState::SPACE`); `authority` (`mut` signer); `system_program`.
- **Signers:** `authority` — must equal `oracle_data.chain_bridge` (`programs/oracle/src/lib.rs:95`–`programs/oracle/src/lib.rs:98`).
- **Preconditions:**
  - `meter_id.len() ≤ MAX_METER_ID_LEN` else `MeterIdTooLong` (`programs/oracle/src/lib.rs:85`–`programs/oracle/src/lib.rs:88`).
  - `oracle_data.active == 1` else `OracleInactive` (`programs/oracle/src/lib.rs:93`).
  - Signer is the configured chain bridge else `UnauthorizedGateway` (`programs/oracle/src/lib.rs:95`–`programs/oracle/src/lib.rs:98`).
  - `reading_timestamp ≤ now + 60` else `FutureReading` (`programs/oracle/src/lib.rs:103`–`programs/oracle/src/lib.rs:106`).
  - If the meter already has readings: `reading_timestamp` strictly greater than the last (`OutdatedReading`) and at least `min_reading_interval` seconds beyond it (`RateLimitExceeded`) (`programs/oracle/src/lib.rs:109`–`programs/oracle/src/lib.rs:118`).
  - `validate_meter_reading` passes: each non-zero value ≥ `min_energy_value`, both values ≤ `max_energy_value` (`EnergyValueOutOfRange`); when anomaly detection is on and consumption is non-zero, `energy_produced × 100 ≤ max_production_consumption_ratio × energy_consumed` (`AnomalousReading`), evaluated by integer cross-multiplication (`programs/oracle/src/lib.rs:421`–`programs/oracle/src/lib.rs:468`).
- **Effects:** On first use, populates `meter_id`, `meter_id_len`, `bump`, and `created_at`. On every call updates `zone_id` (permitting meter relocation), the latest and cumulative production/consumption (saturating), `last_reading_timestamp`, and `total_readings` (`programs/oracle/src/lib.rs:143`–`programs/oracle/src/lib.rs:162`).
- **Events:** `MeterReadingSubmitted` on success (`programs/oracle/src/lib.rs:164`); `MeterReadingRejected` is emitted from the validation error path before propagating the error (`programs/oracle/src/lib.rs:125`–`programs/oracle/src/lib.rs:135`).
- **Errors:** `MeterIdTooLong`, `OracleInactive`, `UnauthorizedGateway`, `FutureReading`, `OutdatedReading`, `RateLimitExceeded`, `EnergyValueOutOfRange`, `AnomalousReading`, `InvalidConfiguration` (from the multiplication overflow guards).

### 4.3 `trigger_market_clearing`

- **Signature:** `trigger_market_clearing(ctx, epoch_timestamp: i64)` (`programs/oracle/src/lib.rs:178`).
- **Accounts (`TriggerMarketClearing`, `programs/oracle/src/lib.rs:523`):** `oracle_data` (`mut` PDA); `authority` (signer); `aggregator_entry` (optional `UncheckedAccount`, validated in-handler).
- **Signers:** `authority` — either the chain bridge or an admitted aggregator (Section 6).
- **Preconditions:** `oracle_data.active == 1` (`OracleInactive`); `authorize_node_caller` passes; `epoch_timestamp > last_cleared_epoch`, `epoch_timestamp ≤ now`, and `epoch_timestamp % 900 == 0` (all `InvalidEpoch`) (`programs/oracle/src/lib.rs:185`–`programs/oracle/src/lib.rs:209`).
- **Effects:** Sets `last_clearing = now` and `last_cleared_epoch = epoch_timestamp` (`programs/oracle/src/lib.rs:211`–`programs/oracle/src/lib.rs:212`).
- **Events:** `MarketClearingTriggered` (`programs/oracle/src/lib.rs:214`).
- **Errors:** `OracleInactive`, `InvalidEpoch`, `UnauthorizedGateway`, `AggregatorNotAdmitted`.

### 4.4 `update_oracle_status`

- **Signature:** `update_oracle_status(ctx, active: bool)` (`programs/oracle/src/lib.rs:225`).
- **Accounts (`UpdateOracleStatus`, `programs/oracle/src/lib.rs:535`):** `oracle_data` (`mut` PDA); `authority` (signer).
- **Signers:** `authority` — must equal `oracle_data.authority` else `UnauthorizedAuthority`, enforced via the shared `require_oracle_admin` helper (`programs/oracle/src/lib.rs:228`, helper at `programs/oracle/src/lib.rs:392`–`programs/oracle/src/lib.rs:394`).
- **Effects:** Sets `active` to 1 or 0 (`programs/oracle/src/lib.rs:230`).
- **Events:** `OracleStatusUpdated`, with `Clock::get()` hoisted into a local before `emit!` per invariant #5 (`programs/oracle/src/lib.rs:234`–`programs/oracle/src/lib.rs:239`).
- **Errors:** `UnauthorizedAuthority`.

### 4.5 `update_api_gateway`

- **Signature:** `update_api_gateway(ctx, new_api_gateway: Pubkey)` (`programs/oracle/src/lib.rs:247`).
- **Accounts (`UpdateApiGateway`, `programs/oracle/src/lib.rs:543`):** `oracle_data` (`mut` PDA); `authority` (signer).
- **Signers:** `authority` — must equal `oracle_data.authority` else `UnauthorizedAuthority`, enforced via the shared `require_oracle_admin` helper (`programs/oracle/src/lib.rs:252`, helper at `programs/oracle/src/lib.rs:392`–`programs/oracle/src/lib.rs:394`).
- **Effects:** Replaces `chain_bridge` with `new_api_gateway` (`programs/oracle/src/lib.rs:254`–`programs/oracle/src/lib.rs:255`).
- **Events:** `ApiGatewayUpdated` (carrying old and new keys), with `Clock::get()` hoisted into a local before `emit!` per invariant #5 (`programs/oracle/src/lib.rs:258`–`programs/oracle/src/lib.rs:264`).
- **Errors:** `UnauthorizedAuthority`.

### 4.6 `update_production_ratio_config`

- **Signature:** `update_production_ratio_config(ctx, max_production_consumption_ratio: u16)` (`programs/oracle/src/lib.rs:275`).
- **Accounts (`UpdateValidationConfig`, `programs/oracle/src/lib.rs:551`):** `oracle_data` (`mut` PDA); `authority` (signer).
- **Signers:** `authority` — must equal `oracle_data.authority` else `UnauthorizedAuthority`, enforced via the shared `require_oracle_admin` helper (`programs/oracle/src/lib.rs:278`, helper at `programs/oracle/src/lib.rs:392`–`programs/oracle/src/lib.rs:394`).
- **Preconditions:** `max_production_consumption_ratio > 0` else `InvalidConfiguration` (`programs/oracle/src/lib.rs:280`–`programs/oracle/src/lib.rs:283`).
- **Effects:** Updates `max_production_consumption_ratio` (`programs/oracle/src/lib.rs:285`).
- **Events:** `ProductionRatioConfigUpdated`, with `Clock::get()` hoisted into a local before `emit!` per invariant #5 (`programs/oracle/src/lib.rs:288`–`programs/oracle/src/lib.rs:293`).
- **Errors:** `UnauthorizedAuthority`, `InvalidConfiguration`.

### 4.7 `update_validation_config`

- **Signature:** `update_validation_config(ctx, min_energy_value: u64, max_energy_value: u64, anomaly_detection_enabled: bool)` (`programs/oracle/src/lib.rs:304`).
- **Accounts (`UpdateValidationConfig`, `programs/oracle/src/lib.rs:551`):** `oracle_data` (`mut` PDA); `authority` (signer). (Shares the `UpdateValidationConfig` accounts struct with §4.6.)
- **Signers:** `authority` — must equal `oracle_data.authority` else `UnauthorizedAuthority`, enforced via the shared `require_oracle_admin` helper (`programs/oracle/src/lib.rs:307`, helper at `programs/oracle/src/lib.rs:392`–`programs/oracle/src/lib.rs:394`).
- **Preconditions:** `min_energy_value ≤ max_energy_value` else `InvalidConfiguration` — guards against inverted bounds that would reject every reading (`programs/oracle/src/lib.rs:310`–`programs/oracle/src/lib.rs:313`).
- **Effects:** Updates `min_energy_value`, `max_energy_value`, and `anomaly_detection_enabled` (`programs/oracle/src/lib.rs:315`–`programs/oracle/src/lib.rs:317`).
- **Events:** `ValidationConfigUpdated`, with `Clock::get()` hoisted into a local before `emit!` per invariant #5 (`programs/oracle/src/lib.rs:320`–`programs/oracle/src/lib.rs:324`).
- **Errors:** `UnauthorizedAuthority`, `InvalidConfiguration`.

### 4.8 `aggregate_readings`

- **Signature:** `aggregate_readings(ctx, total_produced: u64, total_consumed: u64, valid_count: u64, rejected_count: u64)` (`programs/oracle/src/lib.rs:341`).
- **Accounts (`AggregateReadings`, `programs/oracle/src/lib.rs:511`):** `oracle_data` (`mut` PDA); `authority` (signer); `aggregator_entry` (optional `UncheckedAccount`).
- **Signers:** `authority` — chain bridge or admitted aggregator (Section 6).
- **Preconditions:** `oracle_data.active == 1` (`OracleInactive`); `authorize_node_caller` passes (`programs/oracle/src/lib.rs:351`–`programs/oracle/src/lib.rs:357`).
- **Effects:** Folds batch totals into the global counters with saturating arithmetic — `total_global_energy_produced`, `total_global_energy_consumed`, `total_valid_readings`, `total_rejected_readings`, `total_readings`, and `last_reading_timestamp` — then recomputes `last_quality_score` as `valid × 100 / (valid + rejected)` capped at 100 (`programs/oracle/src/lib.rs:363`–`programs/oracle/src/lib.rs:379`). The single `Clock::get()` is reused for both timestamp fields and the event (`programs/oracle/src/lib.rs:359`–`programs/oracle/src/lib.rs:361`).
- **Events:** `ReadingsAggregated` (`programs/oracle/src/lib.rs:381`).
- **Errors:** `OracleInactive`, `UnauthorizedGateway`, `AggregatorNotAdmitted`.

---

## 5. Invariants & Security Properties

### 5.1 Per-meter PDA isolation (Sealevel parallelism)

Meter readings are written to per-meter `MeterState` PDAs keyed by `[b"meter", meter_id.as_bytes()]`, while `oracle_data` is loaded read-only on the submit path (`programs/oracle/src/lib.rs:91`, `programs/oracle/src/lib.rs:493`). Because submissions for distinct meters touch disjoint write sets, the Sealevel scheduler can execute them in parallel. The source records an explicit caveat: the per-transaction fee payer — the chain-bridge authority, which is also the `mut` rent payer — is always write-locked, so submissions sharing one gateway signer still serialize; per-meter PDAs only parallelize across distinct fee payers (`programs/oracle/src/lib.rs:70`–`programs/oracle/src/lib.rs:74`). Global totals are deliberately kept off the hot path and reconciled in batch by `aggregate_readings`, consistent with the repository's "stale-on-purpose global totals" rule.

### 5.2 Reading-validity invariants

For an accepted reading: timestamps are monotonically increasing per meter (`OutdatedReading`), respect the configured minimum interval (`RateLimitExceeded`), and never exceed `now + 60` seconds (`FutureReading`) (`programs/oracle/src/lib.rs:103`–`programs/oracle/src/lib.rs:118`). Energy magnitudes stay within `[min_energy_value, max_energy_value]` — with the lower bound applied only to non-zero values so unilateral (produce-only or consume-only) meters remain valid — and, when anomaly detection is enabled, satisfy the cross-multiplied production/consumption ratio bound (`programs/oracle/src/lib.rs:421`–`programs/oracle/src/lib.rs:468`). The ratio check uses integer cross-multiplication rather than floating-point division, with `checked_mul` guards that surface `InvalidConfiguration` on overflow (`programs/oracle/src/lib.rs:454`–`programs/oracle/src/lib.rs:463`).

### 5.3 Epoch logic

`trigger_market_clearing` enforces three conjoined constraints that together prevent replay, stale, and arbitrary epochs: `epoch_timestamp` must be strictly greater than `last_cleared_epoch` (no re-clearing), must not exceed `now` (no future clearing), and must be aligned to a 900-second boundary (`epoch_timestamp % 900 == 0`) so an "epoch" cannot be an arbitrary instant (`programs/oracle/src/lib.rs:196`–`programs/oracle/src/lib.rs:209`). `last_cleared_epoch` is advanced monotonically (`programs/oracle/src/lib.rs:212`).

### 5.4 Authorization

Administrative instructions (`update_oracle_status`, `update_api_gateway`, `update_production_ratio_config`, `update_validation_config`) require the signer to equal `oracle_data.authority` (`UnauthorizedAuthority`). This check is centralized in a single helper, `require_oracle_admin`, that all four handlers call so the gate can never drift between them (`programs/oracle/src/lib.rs:392`–`programs/oracle/src/lib.rs:395`). The submit path requires the signer to equal `oracle_data.chain_bridge` (`UnauthorizedGateway`). The node-facing batch/clearing instructions accept the chain bridge or a governance-admitted aggregator, validated by `authorize_node_caller` (Section 6).

### 5.5 Arithmetic safety

The release profile sets `overflow-checks = true`, so bare arithmetic panics rather than silently wrapping (`programs/oracle/Cargo.toml:34`–`programs/oracle/Cargo.toml:35`). In addition, cumulative counters use `saturating_add`/`saturating_mul` (`programs/oracle/src/lib.rs:159`–`programs/oracle/src/lib.rs:162`, `programs/oracle/src/lib.rs:363`–`programs/oracle/src/lib.rs:374`), the quality-score division uses `checked_div(...).unwrap_or(0)` (`programs/oracle/src/lib.rs:375`–`programs/oracle/src/lib.rs:376`), and the rate-limit comparison uses `saturating_add` on the interval (`programs/oracle/src/lib.rs:115`).

Per invariant #5, `Clock::get()` is hoisted into a local binding before each `emit!` rather than being invoked inside the macro expansion — applied across the four admin handlers (`programs/oracle/src/lib.rs:234`, `programs/oracle/src/lib.rs:258`, `programs/oracle/src/lib.rs:288`, `programs/oracle/src/lib.rs:320`) and `aggregate_readings`, where a single `Clock::get()` is reused for both timestamp fields and the event (`programs/oracle/src/lib.rs:352`–`programs/oracle/src/lib.rs:354`).

---

## 6. Cross-Program Interfaces (CPI)

The oracle does **not** invoke any other program. Its only inter-program coupling is a read-side validation against the `governance` program, performed in-process via `authorize_node_caller` (`programs/oracle/src/lib.rs:398`–`programs/oracle/src/lib.rs:418`).

The authorization algorithm for `trigger_market_clearing` and `aggregate_readings` is:

1. If the signer equals `oracle_data.chain_bridge`, authorize immediately (`programs/oracle/src/lib.rs:403`–`programs/oracle/src/lib.rs:405`).
2. Otherwise an `aggregator_entry` account must be supplied, or `UnauthorizedGateway` is returned (`programs/oracle/src/lib.rs:406`).
3. The supplied account must be owned by `governance::ID`, else `AggregatorNotAdmitted` (`programs/oracle/src/lib.rs:407`).
4. Its address must equal the PDA derived from `[b"aggregator", signer.as_ref()]` under `governance::ID`, else `AggregatorNotAdmitted` — binding the entry to the actual signer (`programs/oracle/src/lib.rs:408`–`programs/oracle/src/lib.rs:410`).
5. The account is deserialized as a `governance::AggregatorEntry` and must satisfy `entry.active && entry.aggregator == signer`, else `AggregatorNotAdmitted` (`programs/oracle/src/lib.rs:411`–`programs/oracle/src/lib.rs:416`).

This relies on the governance type contract: `AggregatorEntry` is a one-PDA-per-aggregator allow-list entry with seeds `[b"aggregator", aggregator.as_ref()]` and an `active` flag (`programs/governance/src/state/aggregator.rs:3`–`programs/governance/src/state/aggregator.rs:21`). The dependency therefore supplies only the program ID and the account type for deserialization — there is no instruction invocation into governance (`programs/oracle/Cargo.toml:28`–`programs/oracle/Cargo.toml:30`).

---

## 7. Events

All events are defined in `programs/oracle/src/events.rs`.

| Event | Emitted by | Fields | Definition |
| --- | --- | --- | --- |
| `MeterReadingSubmitted` | `submit_meter_reading` (success) | `meter_id: String`, `energy_produced: u64`, `energy_consumed: u64`, `timestamp: i64`, `zone_id: i32`, `submitter: Pubkey` | `programs/oracle/src/events.rs:5` |
| `MeterReadingRejected` | `submit_meter_reading` (validation failure) | `meter_id: String`, `energy_produced: u64`, `energy_consumed: u64`, `timestamp: i64`, `zone_id: i32`, `reason: String` | `programs/oracle/src/events.rs:43` |
| `MarketClearingTriggered` | `trigger_market_clearing` | `authority: Pubkey`, `timestamp: i64`, `epoch_number: i64` | `programs/oracle/src/events.rs:15` |
| `OracleStatusUpdated` | `update_oracle_status` | `authority: Pubkey`, `active: bool`, `timestamp: i64` | `programs/oracle/src/events.rs:22` |
| `ApiGatewayUpdated` | `update_api_gateway` | `authority: Pubkey`, `old_gateway: Pubkey`, `new_gateway: Pubkey`, `timestamp: i64` | `programs/oracle/src/events.rs:29` |
| `ValidationConfigUpdated` | `update_validation_config` | `authority: Pubkey`, `timestamp: i64` | `programs/oracle/src/events.rs:37` |
| `ProductionRatioConfigUpdated` | `update_production_ratio_config` | `authority: Pubkey`, `max_production_consumption_ratio: u16`, `timestamp: i64` | `programs/oracle/src/events.rs:53` |
| `ReadingsAggregated` | `aggregate_readings` | `authority: Pubkey`, `total_produced: u64`, `total_consumed: u64`, `valid_count: u64`, `rejected_count: u64`, `timestamp: i64` | `programs/oracle/src/events.rs:60` |

---

## 8. Error Codes

All errors are defined in the `OracleError` enum (`programs/oracle/src/error.rs:5`).

| Variant | Message | Definition |
| --- | --- | --- |
| `UnauthorizedAuthority` | "Unauthorized authority" | `programs/oracle/src/error.rs:7` |
| `UnauthorizedGateway` | "Unauthorized API Gateway" | `programs/oracle/src/error.rs:9` |
| `OracleInactive` | "Oracle is inactive" | `programs/oracle/src/error.rs:11` |
| `EnergyValueOutOfRange` | "Energy value out of range" | `programs/oracle/src/error.rs:13` |
| `AnomalousReading` | "Anomalous reading detected" | `programs/oracle/src/error.rs:15` |
| `OutdatedReading` | "Reading timestamp is older than last reading" | `programs/oracle/src/error.rs:17` |
| `FutureReading` | "Reading timestamp is too far in the future" | `programs/oracle/src/error.rs:19` |
| `RateLimitExceeded` | "Rate limit exceeded - readings too frequent" | `programs/oracle/src/error.rs:21` |
| `InvalidConfiguration` | "Invalid configuration parameter" | `programs/oracle/src/error.rs:23` |
| `InvalidEpoch` | "Invalid market epoch - must be greater than last cleared epoch" | `programs/oracle/src/error.rs:25` |
| `MeterIdTooLong` | "Meter ID exceeds maximum length of 32 bytes" | `programs/oracle/src/error.rs:27` |
| `AggregatorNotAdmitted` | "Aggregator is not on the governance allow-list, inactive, or entry mismatched" | `programs/oracle/src/error.rs:29` |

---

## 9. Testing

The integration suite is `tests/oracle.ts`, executed via the npm script `test:oracle`, which runs `anchor test tests/oracle.ts` (`package.json:14`). Per the repository conventions, `anchor test` builds the programs, spins up a test validator, deploys, and runs the Mocha suite; on Anchor 1.0 the validator is `surfpool`, and where it is unavailable `./scripts/run-tests.sh --suite oracle` runs the suite against `solana-test-validator` instead. The single-file Mocha invocation is `npx mocha -r tsx tests/oracle.ts --timeout 1000000` against an already-running validator.
