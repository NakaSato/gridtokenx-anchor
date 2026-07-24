# Registry Program

## Abstract

The `registry` program is the on-chain identity and accounting layer of the GridTokenX
peer-to-peer energy-trading platform. It maintains canonical records for two entity
classes — **users** (energy market participants) and **smart meters** (Advanced Metering
Infrastructure devices) — and serves as the trust anchor for downstream programs. To
preserve Sealevel write-parallelism on registration-heavy paths, global population counts
are partitioned across a fixed set of sixteen shard accounts and reconciled lazily by an
administrative instruction rather than updated on every write. The program additionally
operates a **validator security-bond staking system**: participants lock GRX (the
platform governance/utility SPL token) into a program-owned vault to qualify for an Active
validator slot, subject to a withdrawal cooldown and to administrative slashing of proven
misbehaviour. This staking mechanism is a *security bond* and yields no rewards; it is
distinct from the yield-bearing staking implemented by the `treasury` program.

---

## 1. Program Identity

| Property | Value |
| --- | --- |
| Program ID | `FcSd5x4X1nzJMKLZC4tMZXnQ1ipLrGsEfeoH8N4mvJX7` |
| Crate name | `registry` (`Cargo.toml:2`) |
| Crate version | `0.1.1` (`Cargo.toml:3`) |
| `declare_id!` | `lib.rs:19` |
| `GOVERNANCE_PROGRAM_ID` | `FokVuBSPXP11aeL7VZWd8n8aVAhWqVpyPZETToSxdvTS` — owner of the PoA aggregator allow-list (`AggregatorEntry` PDA); hardcoded to avoid a `registry → governance` CPI cycle (`lib.rs:26`) |
| `ORACLE_PROGRAM_ID` | `64Vgos61STZ8pW9NnHi2iGtXMTQr7NqBoMorK6Zg8RJU` — owner of the oracle's per-meter `MeterState` PDA cross-checked by `update_meter_reading`; hardcoded for the same no-cycle reason (`oracle → governance → registry`, `lib.rs:33`) |
| `RESIGN_COOLDOWN_SECS` | `24h` — bond stays locked and slashable after `deregister_validator` (`lib.rs:48`) |
| Anchor framework | `anchor-lang` / `anchor-spl` `1.0.0` (`Cargo.toml:24-25`) |

The program ID declared in source (`lib.rs:19`) is the canonical on-chain identity; the
`Anchor.toml [programs.localnet]` table is the deployment source of truth. The two must
agree (`anchor keys sync` regenerates them in tandem).

### Dependencies

- `anchor-lang` `1.0.0` with the `init-if-needed` feature (`Cargo.toml:24`).
- `anchor-spl` `1.0.0` with the `metadata` feature (`Cargo.toml:25`); the program uses the
  `token_interface` abstraction so the GRX mint may be either SPL Token or Token-2022.
- `bytemuck` `1.20.0` for the zero-copy `Pod`/`Zeroable` state layouts (`Cargo.toml:26`).
- `compute-debug` (optional, path dependency) gated behind the `localnet` feature for
  compute-unit profiling (`Cargo.toml:27`, `Cargo.toml:13`).
- **`energy-token` (path dependency, `features = ["cpi"]`, `Cargo.toml:30`)** — the registry
  invokes the energy-token program's `mint_tokens_direct` instruction via Cross-Program
  Invocation (CPI) to issue GRID/airdrop tokens (see §6).

The release profile forces `overflow-checks = true` (`Cargo.toml:34-35`) because
`cargo build-sbf` defaults arithmetic-overflow checks to off; this makes bare arithmetic
panic rather than silently wrap.

---

## 2. System Role

### 2.1 User and meter registry

The program is the authoritative ledger of platform participants. A **user** (a market
participant, either a `Prosumer` or a `Consumer`, `state.rs:103-106`) is recorded in a
per-key `UserAccount` PDA carrying identity, geolocation, status, staking state, and a
denormalised meter count (`state.rs:55-75`). A **meter** (an AMI device of type `Solar`,
`Wind`, `Battery`, or `Grid`, `state.rs:124-129`) is recorded in a per-device
`MeterAccount` PDA carrying ownership, status, cumulative generation/consumption, and
tokenization watermarks (`state.rs:80-98`). Downstream programs and services treat the
existence and `Active` status of these accounts as the canonical attestation that a user
or meter is real and admitted (`is_valid_user`, `queries.rs:30`; `is_valid_meter`,
`queries.rs:36`).

### 2.2 Sixteen-shard population counter

Maintaining a single global counter for users and meters would force every registration to
take a Sealevel write lock on one global account, serialising the platform's hottest path.
The program instead partitions counts across **sixteen `RegistryShard` PDAs**
(`state.rs:23-30`). Each entity is bound to exactly one shard by the canonical selector
`shard_for(key) = key.to_bytes()[0] % 16` (`lib.rs:80-82`). Registration writes the shard,
never the global `Registry` account, which remains read-only on hot paths (`register_meter.rs:34-37`).
The global totals on the `Registry` account are therefore **stale on purpose** and are
reconciled by the administrative `aggregate_shards` instruction (`aggregate_shards.rs:14-64`).

### 2.3 Validator security-bond staking

Participants lock GRX into a single program-owned vault PDA at seeds `[b"grx_vault"]`
(`initialize_vault.rs:16-25`) whose token authority is the `registry` PDA. The staked amount is tracked on
the staker's own `UserAccount.staked_grx` field (`state.rs:71`). Holding at least
`MIN_VALIDATOR_STAKE = 10,000 GRX` (`lib.rs:40`) qualifies an account to be promoted to an
`Active` validator via `register_validator` (`register_validator.rs:26-76`), gated additionally by a
governance-admitted `AggregatorEntry` allow-list entry (PoA aggregator-admission). Withdrawal
guards live in the pure, unit-tested helper `check_unstake_allowed` (`lib.rs:420-443`):
a 24-hour cooldown anchored to the most recent stake (`UNSTAKE_COOLDOWN_SECS`, `lib.rs:43`;
enforced `lib.rs:429-432`), and a bond lock — the bond of a still-slashable validator
(`Active`, or `Resigning` within the resign cooldown) cannot be drawn below the minimum
(`ValidatorStakeLocked`, `lib.rs:433-441`): an Active validator must first announce an honest
exit via `deregister_validator` and serve `RESIGN_COOLDOWN_SECS` (`lib.rs:48`) before the bond
unlocks.

**This is a security bond, not a yield product.** It pays no rewards, is gated by a
minimum, and is subject to slashing of the bond for validator misbehaviour
(`slash_validator`, `slash_validator.rs:67`). It is deliberately distinct from the yield-bearing GRX
staking in the `treasury` program; the two systems share no vault and no position account
and are not reconciled.

### 2.4 Slashing and slash routing

The PoA (Proof-of-Authority) registry authority may slash a validator's bond
(`slash_validator`, `slash_validator.rs:67`). Slashing is **severity-scaled and victim-compensating**,
not a flat forfeiture:

- **Severity.** A governance-attested `slash_bps` (1..=10000) sets `slash_amount = bond *
  slash_bps / 10_000`, capped at the bond (`compute_slash_amount`, `lib.rs:393-412`).
- **Capped victim compensation.** `compensation = min(slash_amount, proven_loss)` is paid to
  the passed `victim_token_account` (`slash_validator.rs:94`); capping at the governance-attested
  `proven_loss` removes the bounty-gaming incentive.
- **Transparent fund remainder.** `fund_amount = slash_amount − compensation` goes to the
  pre-configured `slash_destination` (`slash_validator.rs:95`), which must first be set by the authority
  via `set_slash_destination` (`set_slash_destination.rs:15`). The platform wires the destination to the
  treasury `rebate_vault` — the regulator / consumer-rebate pool, not staker yield
  (`scripts/init-treasury.ts:106-121`).
- **Value invariant.** `slash_amount == compensation + fund_amount` is enforced on-chain
  (`slash_validator.rs:101-104`) — no value is created or destroyed.
- **Status transition.** Full forfeiture (`slash_bps == 10000` or the bond fully consumed) →
  terminal `Slashed`; a partial slash leaving the remaining bond below `MIN_VALIDATOR_STAKE`
  → `Suspended` (recoverable by topping up); otherwise the validator stays `Active`
  (`apply_slash_status`, `lib.rs:447-455`).

Only an `Active` or `Resigning` validator can be slashed (`lib.rs:398-404` — the honest-exit
path stays slashable through the resign cooldown), only the registry authority may call it, and
the destination must equal the configured one (no misroute). On-chain verified in
`tests/staking.ts` (partial→Suspended, capped comp both directions, invariant, CU ≈ 27.8k);
the pure slash-math and status-transition helpers are additionally unit-tested in-crate (§9).

Two extensions complete the slashing pipeline. A **multi-victim variant**,
`slash_validator_multi` (`slash_validator_multi.rs:57`), distributes the capped compensation pool
**pro-rata across several harmed parties** by their governance-attested losses, routing the
remainder (including integer-division rounding dust) to the same configured fund (§4.5).
And a **transparent slash fund** — a registry-owned GRX vault at `[b"slash_fund"]` paired
with a published `SlashFundLedger` PDA (`state.rs:44`) — gives the slash remainder an
auditable in-registry sink: point `slash_destination` at the fund vault so remainders
accumulate there, then redistribute via the PoA-gated `disburse_slash_fund`, each outflow
recorded on the ledger and emitted as `SlashFundDisbursed` (§4.5, §7). This is an
alternative to wiring `slash_destination` straight to the treasury `rebate_vault`; either
way the destination remains the single configured, misroute-proof sink.

---

## 3. State Model

All persistent accounts use Anchor's zero-copy layout (`#[account(zero_copy)] #[repr(C)]`,
`bytemuck::Pod`), accessed through `AccountLoader` with `load()` / `load_mut()` /
`load_init()`. Manual `_paddingN` fields enforce field alignment. Account space is
`8 + std::mem::size_of::<T>()` (8-byte Anchor discriminator plus the Pod struct).

### 3.1 String encoding convention

Zero-copy structs cannot hold `String`. Meter identifiers are stored as a fixed `[u8; 32]`
buffer (`MeterAccount.meter_id`, `state.rs:81`). Conversion is performed by two helpers:
`string_to_bytes32` truncates/zero-pads a `&str` into the buffer (`lib.rs:85-91`), and
`bytes32_to_string` rehydrates the buffer back to a `String`, trimming trailing nulls,
when emitting events (`lib.rs:70-76`). Meter IDs are bounded to 32 bytes at registration
(`register_meter.rs:81`, error `InvalidMeterId`).

### 3.2 `Registry`

Global singleton holding authorities and the lazily-reconciled global totals.

- **PDA seeds:** `[b"registry"]` (`initialize.rs:13`).
- **Layout:** zero-copy (`state.rs:6-18`). **Space:** `8 + size_of::<Registry>()` (`initialize.rs:12`).

| Field | Type | Notes |
| --- | --- | --- |
| `authority` | `Pubkey` | PoA registry admin (`state.rs:9`) |
| `oracle_authority` | `Pubkey` | Authorised oracle signer for meter readings (`state.rs:10`) |
| `has_oracle_authority` | `u8` | 1 when `oracle_authority` is valid (Option-as-flag, `state.rs:11`) |
| `has_slash_destination` | `u8` | 1 when `slash_destination` is configured (`state.rs:12`) |
| `_padding` | `[u8; 6]` | alignment (`state.rs:13`) |
| `user_count` | `u64` | global user total — stale, reconciled by `aggregate_shards` (`state.rs:14`) |
| `meter_count` | `u64` | global meter total — stale (`state.rs:15`) |
| `active_meter_count` | `u64` | global active-meter total — stale (`state.rs:16`) |
| `slash_destination` | `Pubkey` | allowed sink for slashed bonds (`state.rs:17`) |

### 3.3 `RegistryShard`

Per-shard distributed counter; one of sixteen.

- **PDA seeds:** `[b"registry_shard", &[shard_id]]` (`initialize_shard.rs:13`).
- **Layout:** zero-copy (`state.rs:23-30`). **Space:** `8 + size_of::<RegistryShard>()` (`initialize_shard.rs:12`).
- Provides `load_from_bytes` for raw deserialisation during aggregation (`state.rs:33-35`).

| Field | Type | Notes |
| --- | --- | --- |
| `shard_id` | `u8` | shard index 0–15 (`state.rs:24`) |
| `bump` | `u8` | canonical PDA bump cached on init for cheap re-validation (`state.rs:25`) |
| `_padding` | `[u8; 6]` | alignment (`state.rs:26`) |
| `user_count` | `u64` | users bound to this shard (`state.rs:27`) |
| `meter_count` | `u64` | live (non-deactivated) meters on this shard (`state.rs:28`) |
| `active_meter_count` | `u64` | meters currently `Active` on this shard (`state.rs:29`) |

### 3.4 `UserAccount`

Per-user identity, staking, and validator record.

- **PDA seeds:** `[b"user", authority.key()]` (`register_user.rs:15`).
- **Layout:** zero-copy, manually padded to 104 bytes (`state.rs:55-75`).
  **Space:** `8 + size_of::<UserAccount>()` (`register_user.rs:14`).

| Field | Type | Offset | Notes |
| --- | --- | --- | --- |
| `authority` | `Pubkey` | 0–32 | owning wallet (`state.rs:56`) |
| `user_type` | `UserType` | 32–33 | Prosumer/Consumer (`state.rs:57`) |
| `_padding1` | `[u8; 3]` | 33–36 | (`state.rs:58`) |
| `lat_e7` | `i32` | 36–40 | latitude ×1e7 (`state.rs:59`) |
| `long_e7` | `i32` | 40–44 | longitude ×1e7 (`state.rs:60`) |
| `_padding2` | `[u8; 4]` | 44–48 | aligns `h3_index` (`state.rs:61`) |
| `h3_index` | `u64` | 48–56 | H3 geospatial cell index (`state.rs:62`) |
| `status` | `UserStatus` | 56–57 | Active/Suspended/Inactive (`state.rs:63`) |
| `validator_status` | `ValidatorStatus` | 57–58 | None/Active/Slashed/Suspended/Resigning (`state.rs:64`) |
| `shard_id` | `u8` | 58–59 | bound shard (`state.rs:65`) |
| `airdrop_claimed` | `u8` | 59–60 | 0 unclaimed / 1 claimed (`state.rs:66`) |
| `_padding3` | `[u8; 4]` | 60–64 | (`state.rs:67`) |
| `registered_at` | `i64` | 64–72 | registration timestamp (`state.rs:68`) |
| `meter_count` | `u32` | 72–76 | owned-meter count (`state.rs:69`) |
| `_padding4` | `[u8; 4]` | 76–80 | aligns `staked_grx` (`state.rs:70`) |
| `staked_grx` | `u64` | 80–88 | staked security bond in smallest GRX units (`state.rs:71`) |
| `last_stake_at` | `i64` | 88–96 | timestamp of most recent stake — anchors cooldown (`state.rs:72`) |
| `resign_at` | `i64` | 96–104 | unix ts of `deregister_validator`; 0 = not resigning. Carved from former `_padding5`; total still 104 bytes (`state.rs:73-74`) |

### 3.5 `MeterAccount`

Per-meter device record and tokenization watermarks.

- **PDA seeds:** `[b"meter", owner.key(), meter_id.as_bytes()]` (`register_meter.rs:15`).
- **Layout:** zero-copy (`state.rs:80-98`). **Space:** `8 + size_of::<MeterAccount>()` (`register_meter.rs:14`).

| Field | Type | Notes |
| --- | --- | --- |
| `meter_id` | `[u8; 32]` | fixed-buffer meter identifier (`state.rs:81`) |
| `owner` | `Pubkey` | owning user (`state.rs:82`) |
| `meter_type` | `MeterType` | Solar/Wind/Battery/Grid (`state.rs:83`) |
| `status` | `MeterStatus` | Active/Inactive/Maintenance (`state.rs:84`) |
| `_pad_a` | `[u8; 2]` | aligns `zone_id` (`state.rs:85`) |
| `zone_id` | `i32` | microgrid governance zone; carved from former `_padding[6]`, existing accounts read 0 (`state.rs:86-89`) |
| `registered_at` | `i64` | registration timestamp (`state.rs:90`) |
| `last_reading_at` | `i64` | timestamp of last accepted reading (`state.rs:91`) |
| `total_generation` | `u64` | cumulative energy generated (`state.rs:92`) |
| `total_consumption` | `u64` | cumulative energy consumed (`state.rs:93`) |
| `settled_net_generation` | `u64` | net generation already tokenised as GRID (`state.rs:96`) |
| `claimed_erc_generation` | `u64` | net generation already claimed for ERC issuance (`state.rs:97`) |

### 3.6 `SlashFundLedger`

Published disbursement accounting for the transparent slash fund (§2.4, §4.5). Inflows are
simply the `slash_fund` vault's GRX balance (slashed remainders routed in via the
configured `slash_destination`); outflows are tracked here precisely, one event per
disbursement, so the fund's redistribution history is auditable on-chain (`state.rs:38-41`).

- **PDA seeds:** `[b"slash_fund_ledger"]` (`initialize_slash_fund.rs:33`).
- **Layout:** zero-copy (`state.rs:44-50`). **Space:** `8 + size_of::<SlashFundLedger>()` (`initialize_slash_fund.rs:32`).

| Field | Type | Notes |
| --- | --- | --- |
| `total_disbursed` | `u64` | cumulative GRX paid out of the fund (`state.rs:45`) |
| `disbursement_count` | `u64` | number of `disburse_slash_fund` calls (`state.rs:46`) |
| `last_disbursed_ts` | `i64` | unix timestamp of the most recent disbursement (`state.rs:47`) |
| `bump` | `u8` | canonical PDA bump cached on init (`state.rs:48`) |
| `_padding` | `[u8; 7]` | alignment (`state.rs:49`) |

### 3.7 Enumerations

All enums are `#[repr(u8)]` with manual `bytemuck::Pod`/`Zeroable` impls for inclusion in
zero-copy structs.

| Enum | Variants | Source |
| --- | --- | --- |
| `UserType` | `Prosumer`, `Consumer` | `state.rs:103-106` |
| `UserStatus` | `Active`, `Suspended`, `Inactive` | `state.rs:113-117` |
| `MeterType` | `Solar`, `Wind`, `Battery`, `Grid` | `state.rs:124-129` |
| `MeterStatus` | `Active`, `Inactive`, `Maintenance` | `state.rs:136-140` |
| `ValidatorStatus` | `None`, `Active`, `Slashed`, `Suspended`, `Resigning` | `state.rs:147-155` |

---

## 4. Instruction Set

Every handler wraps its body in `compute_fn!("label" => { … })`, a no-op in release builds
and a compute-unit profiler under the `localnet` feature.

### 4.1 Administration and configuration

#### `initialize`
- **Signer:** `authority` (becomes `registry.authority`).
- **Accounts:** initialises the `Registry` PDA at `[b"registry"]` (`initialize.rs:9-16`).
- **Effects:** sets `authority`, clears `has_oracle_authority`, `has_slash_destination`, and
  all global counts (`initialize.rs:26-31`).
- **Event:** `RegistryInitialized` (`initialize.rs:33`).

#### `initialize_shard(shard_id: u8)`
- **Signer:** `authority`.
- **Precondition:** `shard_id < 16`, else `InvalidShardId` (`initialize_shard.rs:25`).
- **Effects:** initialises the `RegistryShard` PDA, caches its canonical `bump`, and zeroes
  its counters (`initialize_shard.rs:26-31`).

#### `set_oracle_authority(oracle: Pubkey)`
- **Signer:** `authority` — must equal `registry.authority`, else `UnauthorizedAuthority`
  (`set_oracle_authority.rs:17-21`).
- **Effects:** sets `oracle_authority`, raises `has_oracle_authority` (`set_oracle_authority.rs:29-30`).
- **Event:** `OracleAuthoritySet` (carries the prior oracle if any, `set_oracle_authority.rs:32`).

#### `set_slash_destination(destination: Pubkey)`
- **Signer:** `authority` — must equal `registry.authority` (`set_slash_destination.rs:17-21`).
- **Effects:** sets `slash_destination`, raises `has_slash_destination` (`set_slash_destination.rs:29-30`).
  This is a precondition for any slashing.
- **Event:** `SlashDestinationSet` (`set_slash_destination.rs:32`).

#### `update_authority(new_authority: Pubkey)`
- **Signer:** current `authority` (`update_authority.rs:17-21`).
- **Effects:** replaces `registry.authority` (`update_authority.rs:23-24`).
- **Event:** `AuthorityUpdated` (`update_authority.rs:26`).

#### `aggregate_shards`
- **Signer:** `authority` — must equal `registry.authority` (`aggregate_shards.rs:16-20`).
- **Accounts:** the `Registry` PDA plus shard accounts passed as `remaining_accounts`.
- **Preconditions / checks:** each remaining account must be program-owned
  (`aggregate_shards.rs:31`); its address is re-validated against `create_program_address` using the
  stored canonical bump (cheaper than `find_program_address`, `aggregate_shards.rs:39-42`); a
  16-bit `seen` bitmask rejects duplicate shard ids (`DuplicateShard`, `aggregate_shards.rs:44-46`).
- **Effects:** checked summation of the per-shard counts into the global `Registry`
  totals (`MathOverflow` on overflow, `aggregate_shards.rs:48-62`).

### 4.2 User and meter lifecycle

#### `register_user(user_type, lat_e7, long_e7, h3_index, shard_id)`
- **Signers:** `payer` (funds the account). `authority` is an `AccountInfo`, not a
  `Signer`, supporting a custodial model where either the user signs for themselves or the
  registry admin (`payer == registry.authority`) signs on their behalf (`register_user.rs:59-67`).
- **Preconditions:** `shard_id < 16` **and** `shard_id == shard_for(authority)`, binding
  the user to its canonical shard so counts cannot be scattered (`register_user.rs:50-55`).
- **Effects:** initialises the `UserAccount` (`Active`, `airdrop_claimed = 0`), increments
  the shard's `user_count` (checked, `register_user.rs:74-85`).
- **Note:** the welcome airdrop is deliberately **not** minted here, so a failed mint CPI
  cannot roll back registration (`register_user.rs:87-90`).
- **Event:** `UserRegistered` (`register_user.rs:91`).

#### `claim_airdrop`
- **Signers:** the user, or the admin acting for them (`claim_airdrop.rs:56-62`).
- **Preconditions:** `user_account.authority` matches the `authority`; `airdrop_claimed == 0`,
  else `AirdropAlreadyClaimed` (`claim_airdrop.rs:68-72`).
- **Account pinning:** the `energy_token_program` account is constrained to
  `energy_token::ID`, rejecting any other program with `InvalidEnergyTokenProgram`
  (`instructions/claim_airdrop.rs:37-39`) — the CPI target cannot be substituted, and a
  wrong program fails fast at account validation rather than inside the CPI.
- **Effects:** sets `airdrop_claimed = 1` **before** the CPI so the flag and the mint commit
  or roll back together (`claim_airdrop.rs:64-74`); CPIs `energy_token::mint_tokens_direct` for
  `AIRDROP_AMOUNT` with the registry PDA signing (`claim_airdrop.rs:76-94`).
- **Event:** `AirdropClaimed` (`claim_airdrop.rs:98`).

#### `register_meter(meter_id: String, meter_type, shard_id, zone_id: i32)`
- **Signer:** `payer`. `owner` is a non-signing `AccountInfo` (custodial model);
  ownership is enforced by `owner == user_account.authority` and by PDA seeds
  (`register_meter.rs:75-79`, `register_meter.rs:20-25`).
- **Preconditions:** `shard_id < 16` and `shard_id == shard_for(owner)` (`register_meter.rs:59-63`);
  `zone_id >= 0` (`InvalidZone`, `register_meter.rs:60`); user must be `Active` (`UnauthorizedUser`,
  `register_meter.rs:69-72`); `meter_id.len() <= 32` (`InvalidMeterId`, `register_meter.rs:81`).
- **Effects (zone):** persists `zone_id` on the `MeterAccount`, binding the meter to one
  governance zone (`register_meter.rs:87`).
- **Effects:** initialises the `MeterAccount` (`Active`, zeroed watermarks); increments the
  user's `meter_count` and the shard's `meter_count` and `active_meter_count` (all checked,
  `register_meter.rs:83-100`).
- **Event:** `MeterRegistered` (`register_meter.rs:102`).

#### `update_user_status(new_status)`
- **Signer:** `authority` — must equal `registry.authority` (`update_user_status.rs:25-29`).
- **Effects:** overwrites `user_account.status` (`update_user_status.rs:31-32`).
- **Event:** `UserStatusUpdated` (`update_user_status.rs:34`).

#### `set_meter_status(new_status)`
- **Signer:** `authority` — must be the meter owner or the registry admin (`set_meter_status.rs:33-35`).
- **Preconditions:** the supplied shard must be the owner's shard (`InvalidShardId`,
  `set_meter_status.rs:39-42`; the seed is derived from `meter.owner`, `set_meter_status.rs:20`); neither the old
  nor the new status may be `Inactive` (`InvalidMeterStatusTransition`, `set_meter_status.rs:52-55`) —
  `Inactive` is terminal and owned solely by `deactivate_meter`, so this instruction can
  neither revive a deactivated meter nor deactivate one (either would desync the shard's
  `active_meter_count` from `meter_count`).
- **Effects:** adjusts the shard's `active_meter_count` on Active↔non-Active transitions
  (saturating, `set_meter_status.rs:57-61`); sets the new status.
- **Event:** `MeterStatusUpdated` (`set_meter_status.rs:65`).

#### `deactivate_meter`
- **Signer:** `owner` — must equal `meter.owner` (`deactivate_meter.rs:43-47`).
- **Account binding (security fix):** `user_account` is seeds-bound to `owner`
  (`[b"user", owner.key()]`, `deactivate_meter.rs:16-21`), so the `meter_count` decrement can only
  ever hit the signer's own `UserAccount` — a caller cannot pass a victim's account to
  grief their `meter_count` down.
- **Preconditions:** meter not already `Inactive` (`AlreadyInactive`, `deactivate_meter.rs:49-52`).
- **Effects:** decrements the shard `active_meter_count` if previously Active; sets
  `Inactive`; decrements the user's `meter_count` and the shard's `meter_count` (all
  saturating, `deactivate_meter.rs:54-63`).
- **Event:** `MeterDeactivated` (`deactivate_meter.rs:65`).

### 4.3 Metering and tokenization

#### `update_meter_reading(energy_generated, energy_consumed, reading_timestamp)`
- **Signer:** `oracle_authority` — must equal the configured `registry.oracle_authority`;
  requires `has_oracle_authority == 1` (`OracleNotConfigured` / `UnauthorizedOracle`,
  `update_meter_reading.rs:35-40`).
- **Preconditions:** meter `Active` (`InvalidMeterStatus`); `reading_timestamp >
  last_reading_at` (`StaleReading`); minimum 60 s between readings after the first
  (`ReadingTooFrequent`); each delta `<= 1,000,000,000,000` (`ReadingTooHigh`)
  (`update_meter_reading.rs:42-69`).
- **Effects:** advances `last_reading_at`; checked-adds the cumulative generation and
  consumption (`update_meter_reading.rs:71-73`).
- **Oracle cross-check (anti-double-bookkeeping):** the instruction takes the oracle
  program's own per-meter `MeterState` PDA as an `UncheckedAccount`
  (`oracle_meter_state`, `update_meter_reading.rs:16-21`) and raw-validates it in-handler — owner ==
  `ORACLE_PROGRAM_ID`, canonical PDA `[b"meter", meter_id]`, and minimum byte length —
  then requires the registry's post-update cumulative totals to never exceed the oracle's
  `total_energy_produced` / `total_energy_consumed` for the same meter
  (`OracleTotalMismatch`, `update_meter_reading.rs:84-101`). The comparison is `<=`, not `==`, so a
  registry sync that lags an oracle submission still passes; only "registry claims more
  than oracle ever recorded" is rejected. This closes the gap where a corrupt
  `oracle_authority` could push inflated totals to registry alone and mint GRID against
  energy the oracle never saw. Raw validation (no `oracle` crate dependency) avoids the
  `registry → oracle → governance → registry` dependency cycle, mirroring the
  `GOVERNANCE_PROGRAM_ID` pattern (`lib.rs:33`).
- **Event:** `MeterReadingUpdated` (`update_meter_reading.rs:103`).

#### `get_unsettled_balance` (view, returns `u64`)
- Returns `net_generation − settled_net_generation`, saturating (`queries.rs:42-52`).

#### `settle_meter_balance` (returns `u64`)
- **Signer:** `meter_owner` (verified inside `do_settle_meter`, `lib.rs:344-348`).
- **Effects:** computes new mintable tokens as
  `net_gen − settled_net_generation − claimed_erc_generation` (saturating), requires the
  result `> 0` (`NoUnsettledBalance`), advances `settled_net_generation`, and returns the
  amount (`lib.rs:350-371`). No tokens are minted; minting is the caller's responsibility.
- **Event:** `MeterBalanceSettled` (`lib.rs:364`).

#### `settle_and_mint_tokens`
- Convenience variant: runs `do_settle_meter` then CPIs
  `energy_token::mint_tokens_direct` for the settled amount, with the registry PDA signing
  (`settle_and_mint_tokens.rs:48-73`).
- **Account pinning:** as in `claim_airdrop`, the `energy_token_program` account is
  constrained to `energy_token::ID` (`InvalidEnergyTokenProgram`,
  `instructions/settle_and_mint_tokens.rs:36-38`).

#### `mark_erc_claimed(amount)`
- **Signer:** `authority` — must equal `registry.authority` **only**
  (`instructions/mark_erc_claimed.rs:26-30`). The instruction previously also accepted
  `registry.oracle_authority`, but that path was dropped: the sole legitimate caller is
  the governance `issue_erc` CPI, which already forces its signer to be
  `registry.authority` (its registry-authority cross-check), so no legitimate path needs
  the oracle key — and accepting it let a compromised oracle key grief producers by
  inflating `claimed_erc_generation` (denying future REC issuance / GRID settlement) with
  no ERC minted (`instructions/mark_erc_claimed.rs:20-25`).
- **Preconditions:** `amount <= net_gen − claimed_erc_generation − settled_net_generation`
  (`NoUnsettledBalance`), so combined GRID + ERC claims never exceed net generation
  (`instructions/mark_erc_claimed.rs:32-40`).
- **Effects:** saturating-adds `amount` to `claimed_erc_generation`
  (`instructions/mark_erc_claimed.rs:42`).
- **Event:** `ErcClaimed` (`instructions/mark_erc_claimed.rs:44`).

### 4.4 Validation views

`is_valid_user` (`queries.rs:30`) and `is_valid_meter` (`queries.rs:36`) return a boolean
indicating that the respective account's status is `Active`.

### 4.5 Staking, validation, and slashing

#### `initialize_vault`
- **Signer:** `authority` — `has_one = authority` on the `Registry` (`initialize_vault.rs:12`).
- **Effects:** the handler body is empty (`initialize_vault.rs:37-39`); the work is the account-context
  `init` of the GRX vault PDA at `[b"grx_vault"]` with the registry as token authority
  (`initialize_vault.rs:16-25`).

#### `stake_grx(amount)`
- **Signer:** `authority` — `has_one = authority` binds the `UserAccount` (`stake_grx.rs:18`).
- **Precondition:** `amount > 0` (`MinStakeNotMet`, `stake_grx.rs:55`).
- **Effects:** `transfer_checked` of `amount` GRX from the user's ATA into the vault
  (`stake_grx.rs:56-65`); checked-adds to `staked_grx` (`stake_grx.rs:68-72`); **re-anchors
  `last_stake_at` to now on every stake** (`stake_grx.rs:79`, see §5).

#### `register_validator`
- **Signer:** `authority` (`has_one`, `register_validator.rs:13`).
- **Accounts:** an `aggregator_entry` PDA — the governance `AggregatorEntry` allow-list
  entry for `authority`, passed as an `UncheckedAccount` and raw-validated in-handler
  (`register_validator.rs:17-21`).
- **Preconditions:** `validator_status != Slashed` (`ValidatorAlreadySlashed`, a slashed
  validator may never self-reinstate, `register_validator.rs:32-35`); `staked_grx >=
  MIN_VALIDATOR_STAKE` (`MinStakeNotMet`, `register_validator.rs:37-40`).
- **PoA aggregator-admission gate:** the bond is only granted to a governance-admitted
  aggregator — `MIN` stake alone cannot self-promote. The `aggregator_entry` is validated
  by raw account checks (no governance crate dep — would cycle): owner ==
  `GOVERNANCE_PROGRAM_ID` (`AggregatorNotAdmitted`), canonical PDA
  `[b"aggregator", authority]` (`AggregatorNotAdmitted`), borsh length `>= 57`
  (`InvalidAggregatorEntry`), `aggregator == authority`, and `active == 1`
  (`AggregatorNotAdmitted`) (`register_validator.rs:46-70`).
- **Effect:** sets `validator_status = Active` and clears `resign_at = 0`, so re-activating
  from `Resigning` cancels a pending resignation (`register_validator.rs:73-74`).

#### `deregister_validator`
- **Signer:** `authority` (`has_one`, `deregister_validator.rs:12`).
- **Precondition:** `validator_status == Active` (`NotActiveValidator`, `deregister_validator.rs:22-25`).
- **Effects:** flips `Active → Resigning` and stamps `resign_at = now` (`deregister_validator.rs:26-27`).
  This is the **honest-exit path**: the bond stays locked and the validator stays slashable
  for `RESIGN_COOLDOWN_SECS` (24 h), so an honest exit cannot dodge a pending slash. Only
  after the window may the bond be unstaked below `MIN_VALIDATOR_STAKE`; calling
  `register_validator` again before unstaking cancels the resignation.

#### `unstake_grx(amount)`
- **Signer:** `authority` (`has_one`, `unstake_grx.rs:20`).
- **Guard helper:** the balance, cooldown, and bond-lock checks live in the pure function
  `check_unstake_allowed(amount, staked, last_stake_at, resign_at, now, validator_status)`
  (`lib.rs:420-443`), extracted for direct unit-testing (§9) and called before the CPI
  (`unstake_grx.rs:71`).
- **Preconditions:** `amount > 0` (`InsufficientStakingBalance`, `unstake_grx.rs:57`);
  `amount <= staked_grx` (`lib.rs:428`); cooldown elapsed,
  `now − last_stake_at >= UNSTAKE_COOLDOWN_SECS` (`UnstakingLocked`, `lib.rs:429-432`).
- **Bond lock (anti-slash-escape):** while the validator is still slashable, the bond
  cannot be drawn below `MIN_VALIDATOR_STAKE` (`ValidatorStakeLocked`, `lib.rs:433-441`).
  An `Active` validator is always locked; a `Resigning` one stays locked until the resign
  cooldown elapses (`now − resign_at >= RESIGN_COOLDOWN_SECS`). Suspended/Slashed/None
  accounts are unlocked, and excess above `MIN` is always withdrawable. To exit, an Active
  validator must first `deregister_validator` and serve the resign cooldown (or be slashed).
- **Effects:** `transfer_checked` from vault to the user's ATA, with the registry PDA
  signing (`unstake_grx.rs:78-91`); checked-subtracts from `staked_grx` (`unstake_grx.rs:94-99`). The
  former `Active → Suspended` auto-demotion is **removed**: the pre-CPI bond-lock guard
  guarantees an Active validator's remaining stake can never drop below `MIN` via unstake
  (`unstake_grx.rs:101-103`).
- **Event:** `Unstaked` (`unstake_grx.rs:105-110`).

#### `slash_validator(slash_bps, proven_loss)`
- **Signer:** `authority` — must equal `registry.authority` (`UnauthorizedAuthority`).
- **Preconditions:** `slash_bps ∈ 1..=10000` (`InvalidSlashFraction`, `slash_validator.rs:72-75`);
  PoA gate via the shared `poa_slash_gate` helper — registry authority + `has_slash_destination
  == 1` (`SlashDestinationNotSet`) + supplied destination equals the configured one
  (`InvalidSlashDestination`) (`slash_validator.rs:79-86`, `lib.rs:377-389`); and (in
  `compute_slash_amount`, `lib.rs:393-412`) the target's `validator_status` is `Active`
  **or `Resigning`** (`NotActiveValidator`) with `staked_grx > 0`
  (`InsufficientStakingBalance`). Including `Resigning` keeps the honest-exit path from
  being a slash dodge — the bond stays slashable for the whole resign cooldown.
- **Effects:** `slash_amount = bond * slash_bps / 10000` capped at the bond; victim
  compensation `= min(slash_amount, proven_loss)` to `victim_token_account`, the remainder
  to `slash_destination` — both `transfer_checked` with the registry PDA signing; value
  invariant `slash_amount == compensation + fund` enforced (`slash_validator.rs:88-150`). Status
  transition applied by the shared `apply_slash_status` helper (`lib.rs:447-455`).
- **Event:** `ValidatorSlashed` (`slash_validator.rs:157-165`).

> The PoA gate (`poa_slash_gate`) and the amount/status helpers (`compute_slash_amount`,
> `apply_slash_status`) are **deduped** and shared with the multi-victim
> `slash_validator_multi` variant (`slash_validator_multi.rs:57`). The pure helpers — plus the
> `check_unstake_allowed` unstake guard — carry direct in-crate unit tests
> (`mod slash_math_tests`, `lib.rs:457-634`; see §9).

#### `slash_validator_multi(slash_bps, victim_losses: Vec<u64>)`
- **Signer:** `authority` — identical PoA gate to `slash_validator` via the shared
  `poa_slash_gate` (`slash_validator_multi.rs:71-78`).
- **Accounts:** same as `SlashValidator` except the single `victim_token_account` is
  replaced by N victim GRX token accounts passed as `remaining_accounts` (all `mut`),
  parallel to `victim_losses` (`slash_validator_multi.rs:12-55`).
- **Preconditions:** `slash_bps ∈ 1..=10000` (`InvalidSlashFraction`, `slash_validator_multi.rs:62-65`);
  `victim_losses.len()` must equal the number of remaining accounts
  (`VictimCountMismatch`, `slash_validator_multi.rs:66-69`); target `Active`/`Resigning` with a positive
  bond (shared `compute_slash_amount`, `slash_validator_multi.rs:84`).
- **Effects:** `total_loss = Σ victim_losses` (checked, `slash_validator_multi.rs:86-89`); compensation
  pool `= min(slash_amount, total_loss)` (`slash_validator_multi.rs:90`); victim `i` receives
  `pool * victim_losses[i] / total_loss` (u128 floor division; zero-amount payouts are
  skipped, `slash_validator_multi.rs:102-127`); the fund receives everything not paid to victims,
  `slash_amount − Σ paid`, so integer rounding dust falls to the fund (`slash_validator_multi.rs:131`);
  value invariant `slash_amount == paid + fund_amount` enforced
  (`SlashAccountingMismatch`, `slash_validator_multi.rs:132-135`); status transition via the shared
  `apply_slash_status` (`slash_validator_multi.rs:156`).
- **Event:** `ValidatorSlashed` — `compensation` carries the total paid across all
  victims, `proven_loss` the summed loss (`slash_validator_multi.rs:159-167`).

#### `initialize_slash_fund`
- **Signer:** `authority` — `has_one = authority` on the `Registry` (`initialize_slash_fund.rs:14`).
- **Effects:** creates the **transparent slash fund**: a registry-owned GRX vault PDA at
  `[b"slash_fund"]` with the registry as token authority (`initialize_slash_fund.rs:18-27`) plus the
  `SlashFundLedger` PDA at `[b"slash_fund_ledger"]` (§3.6) with zeroed accounting and its
  canonical bump cached (`initialize_slash_fund.rs:49-53`).
- **Intended wiring:** point `slash_destination` at this vault via `set_slash_destination`
  so slash remainders route here automatically — inflows are then the vault's GRX balance,
  outflows are tracked precisely in the ledger (`lib.rs:319-324`).

#### `disburse_slash_fund(amount)`
- **Signer:** `authority` — must equal `registry.authority` (`UnauthorizedAuthority`,
  `disburse_slash_fund.rs:52-59`).
- **Preconditions:** `amount > 0` (`InvalidAmount`, `disburse_slash_fund.rs:51`); `amount <=
  slash_fund.amount` (`InsufficientSlashFund`, `disburse_slash_fund.rs:60-63`).
- **Effects:** `transfer_checked` of `amount` GRX from the fund vault to the passed
  `destination` token account (e.g. the treasury `reward_vault` for redistribution via
  `fund_rewards`, `disburse_slash_fund.rs:34`, `disburse_slash_fund.rs:35-40`), with the registry PDA signing
  (`disburse_slash_fund.rs:65-82`); checked-updates the published ledger — `total_disbursed`,
  `disbursement_count`, `last_disbursed_ts` (`disburse_slash_fund.rs:85-97`).
- **Event:** `SlashFundDisbursed` (`disburse_slash_fund.rs:98-104`).

---

## 5. Invariants and Security Properties

1. **Cooldown re-anchoring closes the dust-bypass (recent fix).** `stake_grx` re-anchors
   `last_stake_at` to the current time on **every** stake, not only the first deposit
   (`stake_grx.rs:73-79`). Anchoring only to the first deposit had allowed a staker to keep a
   permanent dust balance so that `last_stake_at` never refreshed, then stake-large and
   immediately unstake-large with zero cooldown, escaping the slashing window. Every fresh
   GRX now serves the full 24-hour cooldown before it can leave the vault.

2. **Slashing is constrained to slashable validators and a configured sink.** `slash_validator`
   refuses to operate until `set_slash_destination` has been called (`SlashDestinationNotSet`),
   rejects any destination other than the configured one (`InvalidSlashDestination`)
   (`poa_slash_gate`, `lib.rs:377-389`), and slashes only accounts whose
   `validator_status` is `Active` or `Resigning` (`NotActiveValidator`,
   `lib.rs:398-404`). A slash therefore cannot be misrouted, and plain stakers,
   suspended, or already-slashed accounts cannot be slashed — while an honest exit
   (`Resigning`) stays slashable through its cooldown.

3. **Slashed validators cannot self-reinstate.** `register_validator` rejects accounts in
   `Slashed` status (`register_validator.rs:32-35`); restaking can never silently undo a slash.

4. **Sharding preserves write-parallelism.** Hot-path registrations write only the per-shard
   counter and never take a write lock on the global `Registry` (`register_meter.rs:34-37`). The
   global totals are stale by design and reconciled by `aggregate_shards`, which rejects
   non-program-owned accounts, validates each shard's PDA via its cached bump, and rejects
   duplicate shards through a bitmask (`aggregate_shards.rs:31-46`).

5. **Shard binding cannot be forged.** Both `register_user` and `register_meter` require
   `shard_id == shard_for(key)` (`register_user.rs:52-55`, `register_meter.rs:62-63`), so counts cannot be
   scattered onto arbitrary shards, and the same selector seeds the shard PDA in
   status-change instructions (`set_meter_status.rs:18-22`, `deactivate_meter.rs:28-32`).

6. **Combined tokenization claims are bounded by net generation.** Both GRID settlement
   (`do_settle_meter`, `lib.rs:350-360`) and ERC claims (`mark_erc_claimed`,
   `instructions/mark_erc_claimed.rs:32-40`) subtract the other's watermark from net
   generation, so the sum of GRID-minted and ERC-claimed energy can never exceed total net
   generation. This prevents double-minting. `mark_erc_claimed` is callable by
   `registry.authority` only (the governance `issue_erc` CPI path); the oracle key was
   removed from its authorization so it cannot inflate `claimed_erc_generation` to deny
   producers future issuance (`instructions/mark_erc_claimed.rs:20-30`).

7. **Airdrop is exactly-once and idempotent in failure.** `claim_airdrop` sets
   `airdrop_claimed = 1` before the mint CPI, so the flag and the mint commit or roll back
   atomically; a second claim is rejected with `AirdropAlreadyClaimed` (`claim_airdrop.rs:64-74`).
   The airdrop amount is fixed at `AIRDROP_AMOUNT = 10,000,000,000` smallest units = **10 GRX**
   (9 decimals, `lib.rs:36`).

8. **Checked arithmetic throughout.** The release profile forces `overflow-checks = true`
   (`Cargo.toml:34-35`), and counters use explicit `checked_add` (`MathOverflow`) on
   registration paths and `saturating_*` on decrement paths.

9. **Meter-reading anti-abuse.** Readings must be strictly newer than the last
   (`StaleReading`), at least 60 s apart (`ReadingTooFrequent`), and below a per-delta cap
   of `1e12` units (`ReadingTooHigh`) (`update_meter_reading.rs:42-69`).

10. **Registry energy totals are bounded by the oracle's ledger (recent fix).** The
    registry (`MeterAccount.total_generation/total_consumption`) and the oracle
    (`MeterState.total_energy_produced/consumed`) keep two cumulative energy ledgers,
    pushed by separate signed calls with no CPI between them. `update_meter_reading` now
    cross-checks the raw-validated oracle `MeterState` PDA and rejects any update that
    would make the registry's totals exceed the oracle's (`OracleTotalMismatch`,
    `update_meter_reading.rs:84-101`), so a corrupt `oracle_authority` can no longer inflate the
    settleable (mintable) balance through registry alone. `<=` rather than `==` tolerates
    a registry sync that lags an oracle submission.

---

## 6. Cross-Program Interfaces (CPI)

### 6.1 `registry → energy-token` (token minting)

The registry depends on `energy-token` with `features = ["cpi"]` (`Cargo.toml:30`) and
invokes its `mint_tokens_direct` instruction in two places:

- **`claim_airdrop`** — mints `AIRDROP_AMOUNT` to the new user (`claim_airdrop.rs:76-94`).
- **`settle_and_mint_tokens`** — mints the freshly-settled net generation (`settle_and_mint_tokens.rs:61-72`).

In both cases the registry PDA (`[b"registry"]`) signs via
`CpiContext::new_with_signer` with `registry_seeds = [b"registry", &[bump]]`
(`claim_airdrop.rs:85-91`, `settle_and_mint_tokens.rs:53-71`). The registry PDA is supplied as the energy-token
`authority`, `registry_authority`, and (in the airdrop case, where no REC validator is
required) `rec_validator` accounts (`claim_airdrop.rs:80-82`). In both instructions the
`energy_token_program` account is pinned by an Anchor constraint to `energy_token::ID`
(`InvalidEnergyTokenProgram`, `instructions/claim_airdrop.rs:37-39`,
`instructions/settle_and_mint_tokens.rs:36-38`), so the CPI can only ever target the real
energy-token program.

### 6.2 `registry → treasury` (slash routing — token transfer, not CPI)

Slash redistribution is **not** a CPI into the treasury program. `slash_validator` performs
plain SPL `transfer_checked`s of the slashed bond from the GRX vault — victim compensation
to `victim_token_account`, the remainder to the configured `slash_destination` token
account (`slash_validator.rs:110-150`), which the platform wires to the treasury `rebate_vault`
(regulator / consumer-rebate pool, `scripts/init-treasury.ts:106-121`). The registry holds
no compile-time dependency on the treasury program.

---

## 7. Events

| Event | Fields | Source |
| --- | --- | --- |
| `RegistryInitialized` | `authority` | `events.rs:7` |
| `AirdropClaimed` | `user`, `amount`, `timestamp` | `events.rs:12` |
| `UserRegistered` | `user`, `user_type`, `lat_e7`, `long_e7`, `h3_index` | `events.rs:19` |
| `MeterRegistered` | `meter_id`, `owner`, `meter_type` | `events.rs:28` |
| `UserStatusUpdated` | `user`, `old_status`, `new_status` | `events.rs:35` |
| `MeterReadingUpdated` | `meter_id`, `owner`, `energy_generated`, `energy_consumed` | `events.rs:42` |
| `MeterBalanceSettled` | `meter_id`, `owner`, `tokens_to_mint`, `total_settled` | `events.rs:50` |
| `OracleAuthoritySet` | `old_oracle` (opt), `new_oracle` | `events.rs:58` |
| `SlashDestinationSet` | `old_destination` (opt), `new_destination` | `events.rs:64` |
| `MeterStatusUpdated` | `meter_id`, `owner`, `old_status`, `new_status` | `events.rs:70` |
| `MeterDeactivated` | `meter_id`, `owner`, `final_generation`, `final_consumption` | `events.rs:78` |
| `AuthorityUpdated` | `old_authority`, `new_authority` | `events.rs:86` |
| `ErcClaimed` | `meter_id`, `owner`, `amount`, `total_claimed` | `events.rs:92` |
| `Unstaked` | `user`, `amount`, `remaining_stake`, `timestamp` | `events.rs:100` |
| `ValidatorSlashed` | `validator`, `slashed_amount`, `compensation`, `fund_amount`, `proven_loss`, `remaining_stake`, `timestamp` | `events.rs:108` |
| `SlashFundDisbursed` | `amount`, `destination`, `total_disbursed`, `disbursement_count`, `timestamp` | `events.rs:119` |

---

## 8. Error Codes

| Variant | Message | Source |
| --- | --- | --- |
| `UnauthorizedUser` | Unauthorized user | `error.rs:8` |
| `UnauthorizedAuthority` | Unauthorized authority | `error.rs:10` |
| `InvalidMeterStatus` | Invalid meter status | `error.rs:12` |
| `NoUnsettledBalance` | No unsettled balance to tokenize | `error.rs:14` |
| `OracleNotConfigured` | Oracle authority not configured | `error.rs:16` |
| `UnauthorizedOracle` | Unauthorized oracle — signer is not the configured oracle | `error.rs:18` |
| `StaleReading` | Stale reading — timestamp must be newer than last reading | `error.rs:20` |
| `ReadingTooFrequent` | Reading too frequent — minimum interval not met | `error.rs:22` |
| `ReadingTooHigh` | Reading too high — exceeds maximum delta limit | `error.rs:24` |
| `AlreadyInactive` | Meter is already inactive | `error.rs:26` |
| `InvalidMeterId` | Invalid meter ID length (max 32 bytes) | `error.rs:28` |
| `MathOverflow` | Mathematical overflow | `error.rs:30` |
| `InvalidShardId` | Invalid shard ID — must be less than 16 | `error.rs:32` |
| `DuplicateShard` | Duplicate shard passed to aggregation | `error.rs:34` |
| `InsufficientStakingBalance` | Insufficient staking balance | `error.rs:36` |
| `MinStakeNotMet` | Minimum stake requirement not met | `error.rs:38` |
| `UnstakingLocked` | Unstaking is currently locked | `error.rs:40` |
| `AirdropAlreadyClaimed` | Airdrop already claimed for this user | `error.rs:42` |
| `SlashDestinationNotSet` | Slash destination is not configured — call set_slash_destination first | `error.rs:44` |
| `InvalidSlashDestination` | Slash destination does not match the configured destination | `error.rs:46` |
| `NotActiveValidator` | Target is not an active validator | `error.rs:48` |
| `ValidatorAlreadySlashed` | Validator has been slashed and cannot re-register | `error.rs:50` |
| `InvalidSlashFraction` | Slash fraction must be between 1 and 10000 basis points | `error.rs:52` |
| `SlashAccountingMismatch` | Slash accounting mismatch: slashed != compensation + fund | `error.rs:54` |
| `VictimCountMismatch` | victim_losses length must equal the number of victim token accounts passed | `error.rs:56` |
| `InvalidAmount` | Amount must be greater than zero | `error.rs:58` |
| `InsufficientSlashFund` | Slash fund has insufficient balance for this disbursement | `error.rs:60` |
| `AggregatorNotAdmitted` | Validator bond requires an active governance-admitted aggregator entry | `error.rs:62` |
| `InvalidAggregatorEntry` | Aggregator entry account is malformed or too short | `error.rs:64` |
| `ValidatorStakeLocked` | Active validator cannot unstake below the minimum bond; deregister or be slashed first | `error.rs:66` |
| `InvalidMeterStatusTransition` | set_meter_status cannot set or leave Inactive; Inactive is terminal (use deactivate_meter) | `error.rs:68` |
| `InvalidZone` | Zone id must be non-negative | `error.rs:70` |
| `OracleTotalMismatch` | Registry energy total exceeds the oracle's own recorded total for this meter | `error.rs:72` |
| `InvalidEnergyTokenProgram` | Provided energy-token program does not match the expected program ID | `error.rs:74` |

---

## 9. Testing

| Suite | Command | Coverage |
| --- | --- | --- |
| Unit (Rust, in-crate) | `cd programs/registry && cargo test` | 21 tests over the pure helpers and layouts: `compute_slash_amount` (fractional / full / capped slash, Resigning slashable, non-Active and zero-bond rejections) and `apply_slash_status` (terminal `Slashed`, below-floor `Suspended`, at-floor stays `Active`) plus the `check_unstake_allowed` bond-guard edges (`mod slash_math_tests`, `lib.rs:457-634`), and zero-copy layout guards (`state.rs:160`) |
| Sharding (Mocha/Anchor) | `npm run test:registry` → `anchor test tests/registry_sharding.ts` (`package.json:15`) | shard initialisation, shard-bound registration, `aggregate_shards` reconciliation |
| Staking (Mocha/Anchor) | `npm run test:staking` → `anchor test tests/staking.ts` (`package.json:16`) | stake / register-validator / unstake-cooldown / slash flows; multi-victim pro-rata slash (`tests/staking.ts:546-577`) and the slash-fund init → route-remainder → disburse lifecycle with ledger deltas (`tests/staking.ts:579-625`) |
| Staking (LiteSVM, in-process) | `npm run test:staking-litesvm` → `mocha -r tsx tests/staking_unstake_litesvm.ts` (`package.json:17`) | clock-warped unstake happy-path, cooldown, and demotion without a live validator |
| Meter-reading guards (LiteSVM) | part of `npm run test:litesvm` → `tests/registry_meter_reading_guards_litesvm.ts` | `update_meter_reading` oracle-auth / staleness / rate-limit / delta-cap guards; bootstraps a real oracle `MeterState` for the cross-check account |

Per-suite npm recipes: `npm run test:registry` runs only the sharding suite, and
`npm run test:staking` runs the staking suite; both build, deploy `registry` among the
programs, spin up a validator, and run the Mocha file.

The LiteSVM harness (`tests/staking_unstake_litesvm.ts`) runs the program in-process with
the ability to warp the validator clock, which is required to exercise the 24-hour
`UNSTAKE_COOLDOWN_SECS` boundary deterministically without waiting in real time.

Since `update_meter_reading` takes the oracle's `MeterState` PDA (§4.3), every caller —
scripts, Mocha suites, and the LiteSVM suites — must pass `oracle_meter_state` and keep an
oracle-side record for the meter; suites that previously never loaded `oracle.so` now
bootstrap one.
