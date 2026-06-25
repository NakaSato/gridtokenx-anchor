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
| `declare_id!` | `lib.rs:14` |
| `GOVERNANCE_PROGRAM_ID` | `FokVuBSPXP11aeL7VZWd8n8aVAhWqVpyPZETToSxdvTS` — owner of the PoA aggregator allow-list (`AggregatorEntry` PDA); hardcoded to avoid a `registry → governance` CPI cycle (`lib.rs:21`) |
| `RESIGN_COOLDOWN_SECS` | `24h` — bond stays locked and slashable after `deregister_validator` (`lib.rs:36`) |
| Anchor framework | `anchor-lang` / `anchor-spl` `1.0.0` (`Cargo.toml:24-25`) |

The program ID declared in source (`lib.rs:14`) is the canonical on-chain identity; the
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
participant, either a `Prosumer` or a `Consumer`, `state.rs:84-87`) is recorded in a
per-key `UserAccount` PDA carrying identity, geolocation, status, staking state, and a
denormalised meter count (`state.rs:41-60`). A **meter** (an AMI device of type `Solar`,
`Wind`, `Battery`, or `Grid`, `state.rs:105-110`) is recorded in a per-device
`MeterAccount` PDA carrying ownership, status, cumulative generation/consumption, and
tokenization watermarks (`state.rs:65-79`). Downstream programs and services treat the
existence and `Active` status of these accounts as the canonical attestation that a user
or meter is real and admitted (`is_valid_user`, `lib.rs:579`; `is_valid_meter`,
`lib.rs:588`).

### 2.2 Sixteen-shard population counter

Maintaining a single global counter for users and meters would force every registration to
take a Sealevel write lock on one global account, serialising the platform's hottest path.
The program instead partitions counts across **sixteen `RegistryShard` PDAs**
(`state.rs:23-30`). Each entity is bound to exactly one shard by the canonical selector
`shard_for(key) = key.to_bytes()[0] % 16` (`lib.rs:52-54`). Registration writes the shard,
never the global `Registry` account, which remains read-only on hot paths (`lib.rs:1073-1076`).
The global totals on the `Registry` account are therefore **stale on purpose** and are
reconciled by the administrative `aggregate_shards` instruction (`lib.rs:179-231`).

### 2.3 Validator security-bond staking

Participants lock GRX into a single program-owned vault PDA at seeds `[b"grx_vault"]`
(`lib.rs:1271`) whose token authority is the `registry` PDA. The staked amount is tracked on
the staker's own `UserAccount.staked_grx` field (`state.rs:57`). Holding at least
`MIN_VALIDATOR_STAKE = 10,000 GRX` (`lib.rs:21`) qualifies an account to be promoted to an
`Active` validator via `register_validator` (`lib.rs:757-809`), gated additionally by a
governance-admitted `AggregatorEntry` allow-list entry (PoA aggregator-admission). Withdrawal
is subject to a 24-hour cooldown anchored to the most recent stake (`UNSTAKE_COOLDOWN_SECS`,
`lib.rs:31`; enforced `lib.rs:851-854`). The bond of a still-slashable validator (`Active`,
or `Resigning` within the resign cooldown) cannot be drawn below the minimum
(`ValidatorStakeLocked`, `lib.rs:861-871`): an Active validator must first announce an honest
exit via `deregister_validator` and serve `RESIGN_COOLDOWN_SECS` (`lib.rs:36`) before the bond
unlocks.

**This is a security bond, not a yield product.** It pays no rewards, is gated by a
minimum, and is subject to slashing of the bond for validator misbehaviour
(`slash_validator`, `lib.rs:827`). It is deliberately distinct from the yield-bearing GRX
staking in the `treasury` program; the two systems share no vault and no position account
and are not reconciled.

### 2.4 Slashing and slash routing

The PoA (Proof-of-Authority) registry authority may slash an Active validator's bond
(`slash_validator`, `lib.rs:839`). Slashing is **severity-scaled and victim-compensating**,
not a flat forfeiture:

- **Severity.** A governance-attested `slash_bps` (1..=10000) sets `slash_amount = bond *
  slash_bps / 10_000`, capped at the bond (`lib.rs:883`).
- **Capped victim compensation.** `compensation = min(slash_amount, proven_loss)` is paid to
  the passed `victim_token_account` (`lib.rs:889`); capping at the governance-attested
  `proven_loss` removes the bounty-gaming incentive.
- **Transparent fund remainder.** `fund_amount = slash_amount − compensation` goes to the
  pre-configured `slash_destination` (`lib.rs:890`), which must first be set by the authority
  via `set_slash_destination` (`lib.rs:131`). The intended destination is the treasury
  `reward_vault`, so the remainder is redistributed to honest stakers via a subsequent
  `treasury::fund_rewards` call.
- **Value invariant.** `slash_amount == compensation + fund_amount` is enforced on-chain
  (`lib.rs:896`) — no value is created or destroyed.
- **Status transition.** Full forfeiture (`slash_bps == 10000` or the bond fully consumed) →
  terminal `Slashed`; a partial slash leaving the remaining bond below `MIN_VALIDATOR_STAKE`
  → `Suspended` (recoverable by topping up); otherwise the validator stays `Active`
  (`lib.rs:949`).

Only an `Active` validator can be slashed, only the registry authority may call it, and the
destination must equal the configured one (no misroute). On-chain verified in
`tests/staking.ts` (partial→Suspended, capped comp both directions, invariant, CU ≈ 27.8k).

---

## 3. State Model

All persistent accounts use Anchor's zero-copy layout (`#[account(zero_copy)] #[repr(C)]`,
`bytemuck::Pod`), accessed through `AccountLoader` with `load()` / `load_mut()` /
`load_init()`. Manual `_paddingN` fields enforce field alignment. Account space is
`8 + std::mem::size_of::<T>()` (8-byte Anchor discriminator plus the Pod struct).

### 3.1 String encoding convention

Zero-copy structs cannot hold `String`. Meter identifiers are stored as a fixed `[u8; 32]`
buffer (`MeterAccount.meter_id`, `state.rs:66`). Conversion is performed by two helpers:
`string_to_bytes32` truncates/zero-pads a `&str` into the buffer (`lib.rs:57-63`), and
`bytes32_to_string` rehydrates the buffer back to a `String`, trimming trailing nulls,
when emitting events (`lib.rs:42-48`). Meter IDs are bounded to 32 bytes at registration
(`lib.rs:383`, error `InvalidMeterId`).

### 3.2 `Registry`

Global singleton holding authorities and the lazily-reconciled global totals.

- **PDA seeds:** `[b"registry"]` (`lib.rs:944`).
- **Layout:** zero-copy (`state.rs:6-18`). **Space:** `8 + size_of::<Registry>()` (`lib.rs:943`).

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

- **PDA seeds:** `[b"registry_shard", &[shard_id]]` (`lib.rs:962`).
- **Layout:** zero-copy (`state.rs:23-30`). **Space:** `8 + size_of::<RegistryShard>()` (`lib.rs:961`).
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

- **PDA seeds:** `[b"user", authority.key()]` (`lib.rs:980`).
- **Layout:** zero-copy, manually padded to 104 bytes (`state.rs:41-60`).
  **Space:** `8 + size_of::<UserAccount>()` (`lib.rs:979`).

| Field | Type | Offset | Notes |
| --- | --- | --- | --- |
| `authority` | `Pubkey` | 0–32 | owning wallet (`state.rs:42`) |
| `user_type` | `UserType` | 32–33 | Prosumer/Consumer (`state.rs:43`) |
| `_padding1` | `[u8; 3]` | 33–36 | (`state.rs:44`) |
| `lat_e7` | `i32` | 36–40 | latitude ×1e7 (`state.rs:45`) |
| `long_e7` | `i32` | 40–44 | longitude ×1e7 (`state.rs:46`) |
| `_padding2` | `[u8; 4]` | 44–48 | aligns `h3_index` (`state.rs:47`) |
| `h3_index` | `u64` | 48–56 | H3 geospatial cell index (`state.rs:48`) |
| `status` | `UserStatus` | 56–57 | Active/Suspended/Inactive (`state.rs:49`) |
| `validator_status` | `ValidatorStatus` | 57–58 | None/Active/Slashed/Suspended/Resigning (`state.rs:64`) |
| `shard_id` | `u8` | 58–59 | bound shard (`state.rs:51`) |
| `airdrop_claimed` | `u8` | 59–60 | 0 unclaimed / 1 claimed (`state.rs:52`) |
| `_padding3` | `[u8; 4]` | 60–64 | (`state.rs:53`) |
| `registered_at` | `i64` | 64–72 | registration timestamp (`state.rs:54`) |
| `meter_count` | `u32` | 72–76 | owned-meter count (`state.rs:55`) |
| `_padding4` | `[u8; 4]` | 76–80 | aligns `staked_grx` (`state.rs:56`) |
| `staked_grx` | `u64` | 80–88 | staked security bond in smallest GRX units (`state.rs:71`) |
| `last_stake_at` | `i64` | 88–96 | timestamp of most recent stake — anchors cooldown (`state.rs:72`) |
| `resign_at` | `i64` | 96–104 | unix ts of `deregister_validator`; 0 = not resigning. Carved from former `_padding5`; total still 104 bytes (`state.rs:73-74`) |

### 3.5 `MeterAccount`

Per-meter device record and tokenization watermarks.

- **PDA seeds:** `[b"meter", owner.key(), meter_id.as_bytes()]` (`lib.rs:1054`).
- **Layout:** zero-copy (`state.rs:65-79`). **Space:** `8 + size_of::<MeterAccount>()` (`lib.rs:1053`).

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

### 3.6 Enumerations

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
- **Accounts:** initialises the `Registry` PDA at `[b"registry"]` (`lib.rs:940-947`).
- **Effects:** sets `authority`, clears `has_oracle_authority`, `has_slash_destination`, and
  all global counts (`lib.rs:72-79`).
- **Event:** `RegistryInitialized` (`lib.rs:80`).

#### `initialize_shard(shard_id: u8)`
- **Signer:** `authority`.
- **Precondition:** `shard_id < 16`, else `InvalidShardId` (`lib.rs:89`).
- **Effects:** initialises the `RegistryShard` PDA, caches its canonical `bump`, and zeroes
  its counters (`lib.rs:91-96`).

#### `set_oracle_authority(oracle: Pubkey)`
- **Signer:** `authority` — must equal `registry.authority`, else `UnauthorizedAuthority`
  (`lib.rs:105-109`).
- **Effects:** sets `oracle_authority`, raises `has_oracle_authority` (`lib.rs:117-118`).
- **Event:** `OracleAuthoritySet` (carries the prior oracle if any, `lib.rs:120`).

#### `set_slash_destination(destination: Pubkey)`
- **Signer:** `authority` — must equal `registry.authority` (`lib.rs:134-138`).
- **Effects:** sets `slash_destination`, raises `has_slash_destination` (`lib.rs:146-147`).
  This is a precondition for any slashing.
- **Event:** `SlashDestinationSet` (`lib.rs:149`).

#### `update_authority(new_authority: Pubkey)`
- **Signer:** current `authority` (`lib.rs:161-165`).
- **Effects:** replaces `registry.authority` (`lib.rs:167-168`).
- **Event:** `AuthorityUpdated` (`lib.rs:170`).

#### `aggregate_shards`
- **Signer:** `authority` — must equal `registry.authority` (`lib.rs:182-186`).
- **Accounts:** the `Registry` PDA plus shard accounts passed as `remaining_accounts`.
- **Preconditions / checks:** each remaining account must be program-owned
  (`lib.rs:197`); its address is re-validated against `create_program_address` using the
  stored canonical bump (cheaper than `find_program_address`, `lib.rs:205-208`); a
  16-bit `seen` bitmask rejects duplicate shard ids (`DuplicateShard`, `lib.rs:210-211`).
- **Effects:** checked summation of the per-shard counts into the global `Registry`
  totals (`MathOverflow` on overflow, `lib.rs:214-228`).

### 4.2 User and meter lifecycle

#### `register_user(user_type, lat_e7, long_e7, h3_index, shard_id)`
- **Signers:** `payer` (funds the account). `authority` is an `AccountInfo`, not a
  `Signer`, supporting a custodial model where either the user signs for themselves or the
  registry admin (`payer == registry.authority`) signs on their behalf (`lib.rs:254-260`).
- **Preconditions:** `shard_id < 16` **and** `shard_id == shard_for(authority)`, binding
  the user to its canonical shard so counts cannot be scattered (`lib.rs:243-248`).
- **Effects:** initialises the `UserAccount` (`Active`, `airdrop_claimed = 0`), increments
  the shard's `user_count` (checked, `lib.rs:267-278`).
- **Note:** the welcome airdrop is deliberately **not** minted here, so a failed mint CPI
  cannot roll back registration (`lib.rs:280-283`).
- **Event:** `UserRegistered` (`lib.rs:284`).

#### `claim_airdrop`
- **Signers:** the user, or the admin acting for them (`lib.rs:305-310`).
- **Preconditions:** `user_account.authority` matches the `authority`; `airdrop_claimed == 0`,
  else `AirdropAlreadyClaimed` (`lib.rs:316-320`).
- **Effects:** sets `airdrop_claimed = 1` **before** the CPI so the flag and the mint commit
  or roll back together (`lib.rs:313-321`); CPIs `energy_token::mint_tokens_direct` for
  `AIRDROP_AMOUNT` with the registry PDA signing (`lib.rs:324-342`).
- **Event:** `AirdropClaimed` (`lib.rs:346`).

#### `register_meter(meter_id: String, meter_type, shard_id, zone_id: i32)`
- **Signer:** `payer`. `owner` is a non-signing `AccountInfo` (custodial model);
  ownership is enforced by `owner == user_account.authority` and by PDA seeds
  (`lib.rs:391-395`, `lib.rs:1452`).
- **Preconditions:** `shard_id < 16` and `shard_id == shard_for(owner)` (`lib.rs:375-379`);
  `zone_id >= 0` (`InvalidZone`, `lib.rs:376`); user must be `Active` (`UnauthorizedUser`,
  `lib.rs:385-388`); `meter_id.len() <= 32` (`InvalidMeterId`, `lib.rs:397`).
- **Effects (zone):** persists `zone_id` on the `MeterAccount`, binding the meter to one
  governance zone (`lib.rs:403`).
- **Effects:** initialises the `MeterAccount` (`Active`, zeroed watermarks); increments the
  user's `meter_count` and the shard's `meter_count` and `active_meter_count` (all checked,
  `lib.rs:385-401`).
- **Event:** `MeterRegistered` (`lib.rs:403`).

#### `update_user_status(new_status)`
- **Signer:** `authority` — must equal `registry.authority` (`lib.rs:421-425`).
- **Effects:** overwrites `user_account.status` (`lib.rs:427-428`).
- **Event:** `UserStatusUpdated` (`lib.rs:430`).

#### `set_meter_status(new_status)`
- **Signer:** `authority` — must be the meter owner or the registry admin (`lib.rs:523-525`).
- **Preconditions:** the supplied shard must be the owner's shard (`InvalidShardId`,
  `lib.rs:529-532`; the seed is derived from `meter.owner`, `lib.rs:1547`); neither the old
  nor the new status may be `Inactive` (`InvalidMeterStatusTransition`, `lib.rs:542-545`) —
  `Inactive` is terminal and owned solely by `deactivate_meter`, so this instruction can
  neither revive a deactivated meter nor deactivate one (either would desync the shard's
  `active_meter_count` from `meter_count`).
- **Effects:** adjusts the shard's `active_meter_count` on Active↔non-Active transitions
  (saturating, `lib.rs:547-551`); sets the new status.
- **Event:** `MeterStatusUpdated` (`lib.rs:555`).

#### `deactivate_meter`
- **Signer:** `owner` — must equal `meter.owner` (`lib.rs:572-576`).
- **Account binding (security fix):** `user_account` is seeds-bound to `owner`
  (`[b"user", owner.key()]`, `lib.rs:1563-1567`), so the `meter_count` decrement can only
  ever hit the signer's own `UserAccount` — a caller cannot pass a victim's account to
  grief their `meter_count` down.
- **Preconditions:** meter not already `Inactive` (`AlreadyInactive`, `lib.rs:578-581`).
- **Effects:** decrements the shard `active_meter_count` if previously Active; sets
  `Inactive`; decrements the user's `meter_count` and the shard's `meter_count` (all
  saturating, `lib.rs:583-592`).
- **Event:** `MeterDeactivated` (`lib.rs:594`).

### 4.3 Metering and tokenization

#### `update_meter_reading(energy_generated, energy_consumed, reading_timestamp)`
- **Signer:** `oracle_authority` — must equal the configured `registry.oracle_authority`;
  requires `has_oracle_authority == 1` (`OracleNotConfigured` / `UnauthorizedOracle`,
  `lib.rs:451-456`).
- **Preconditions:** meter `Active` (`InvalidMeterStatus`); `reading_timestamp >
  last_reading_at` (`StaleReading`); minimum 60 s between readings after the first
  (`ReadingTooFrequent`); each delta `<= 1,000,000,000,000` (`ReadingTooHigh`)
  (`lib.rs:458-485`).
- **Effects:** advances `last_reading_at`; checked-adds the cumulative generation and
  consumption (`lib.rs:487-489`).
- **Event:** `MeterReadingUpdated` (`lib.rs:491`).

#### `get_unsettled_balance` (view, returns `u64`)
- Returns `net_generation − settled_net_generation`, saturating (`lib.rs:603-608`).

#### `settle_meter_balance` (returns `u64`)
- **Signer:** `meter_owner` (verified inside `do_settle_meter`, `lib.rs:905-909`).
- **Effects:** computes new mintable tokens as
  `net_gen − settled_net_generation − claimed_erc_generation` (saturating), requires the
  result `> 0` (`NoUnsettledBalance`), advances `settled_net_generation`, and returns the
  amount (`lib.rs:911-932`). No tokens are minted; minting is the caller's responsibility.
- **Event:** `MeterBalanceSettled` (`lib.rs:925`).

#### `settle_and_mint_tokens`
- Convenience variant: runs `do_settle_meter` then CPIs
  `energy_token::mint_tokens_direct` for the settled amount, with the registry PDA signing
  (`lib.rs:628-652`).

#### `mark_erc_claimed(amount)`
- **Signer:** `authority` — must be `registry.authority` **or** `registry.oracle_authority`
  (`lib.rs:665-669`).
- **Preconditions:** `amount <= net_gen − claimed_erc_generation − settled_net_generation`
  (`NoUnsettledBalance`), so combined GRID + ERC claims never exceed net generation
  (`lib.rs:673-679`).
- **Effects:** saturating-adds `amount` to `claimed_erc_generation` (`lib.rs:681`).
- **Event:** `ErcClaimed` (`lib.rs:683`).

### 4.4 Validation views

`is_valid_user` (`lib.rs:579`) and `is_valid_meter` (`lib.rs:588`) return a boolean
indicating that the respective account's status is `Active`.

### 4.5 Staking, validation, and slashing

#### `initialize_vault`
- **Signer:** `authority` — `has_one = authority` on the `Registry` (`lib.rs:1264`).
- **Effects:** the handler body is empty (`lib.rs:694`); the work is the account-context
  `init` of the GRX vault PDA at `[b"grx_vault"]` with the registry as token authority
  (`lib.rs:1268-1277`).

#### `stake_grx(amount)`
- **Signer:** `authority` — `has_one = authority` binds the `UserAccount` (`lib.rs:1295`).
- **Precondition:** `amount > 0` (`MinStakeNotMet`, `lib.rs:700`).
- **Effects:** `transfer_checked` of `amount` GRX from the user's ATA into the vault
  (`lib.rs:702-711`); checked-adds to `staked_grx` (`lib.rs:714-718`); **re-anchors
  `last_stake_at` to now on every stake** (`lib.rs:725`, see §5).

#### `register_validator`
- **Signer:** `authority` (`has_one`, `lib.rs:1742`).
- **Accounts:** an `aggregator_entry` PDA — the governance `AggregatorEntry` allow-list
  entry for `authority`, passed as an `UncheckedAccount` and raw-validated in-handler
  (`lib.rs:1746-1750`).
- **Preconditions:** `validator_status != Slashed` (`ValidatorAlreadySlashed`, a slashed
  validator may never self-reinstate, `lib.rs:764-767`); `staked_grx >=
  MIN_VALIDATOR_STAKE` (`MinStakeNotMet`, `lib.rs:769-772`).
- **PoA aggregator-admission gate:** the bond is only granted to a governance-admitted
  aggregator — `MIN` stake alone cannot self-promote. The `aggregator_entry` is validated
  by raw account checks (no governance crate dep — would cycle): owner ==
  `GOVERNANCE_PROGRAM_ID` (`AggregatorNotAdmitted`), canonical PDA
  `[b"aggregator", authority]` (`AggregatorNotAdmitted`), borsh length `>= 57`
  (`InvalidAggregatorEntry`), `aggregator == authority`, and `active == 1`
  (`AggregatorNotAdmitted`) (`lib.rs:778-802`).
- **Effect:** sets `validator_status = Active` and clears `resign_at = 0`, so re-activating
  from `Resigning` cancels a pending resignation (`lib.rs:805-806`).

#### `deregister_validator`
- **Signer:** `authority` (`has_one`, `lib.rs:1761`).
- **Precondition:** `validator_status == Active` (`NotActiveValidator`, `lib.rs:820-823`).
- **Effects:** flips `Active → Resigning` and stamps `resign_at = now` (`lib.rs:824-825`).
  This is the **honest-exit path**: the bond stays locked and the validator stays slashable
  for `RESIGN_COOLDOWN_SECS` (24 h), so an honest exit cannot dodge a pending slash. Only
  after the window may the bond be unstaked below `MIN_VALIDATOR_STAKE`; calling
  `register_validator` again before unstaking cancels the resignation.

#### `unstake_grx(amount)`
- **Signer:** `authority` (`has_one`, `lib.rs:1774`).
- **Preconditions:** `amount > 0` (`InsufficientStakingBalance`, `lib.rs:836`);
  `amount <= staked_grx` (`lib.rs:850`); cooldown elapsed,
  `now − last_stake_at >= UNSTAKE_COOLDOWN_SECS` (`UnstakingLocked`, `lib.rs:851-854`).
- **Bond lock (anti-slash-escape):** while the validator is still slashable, the bond
  cannot be drawn below `MIN_VALIDATOR_STAKE` (`ValidatorStakeLocked`, `lib.rs:861-871`).
  An `Active` validator is always locked; a `Resigning` one stays locked until the resign
  cooldown elapses (`now − resign_at >= RESIGN_COOLDOWN_SECS`). Suspended/Slashed/None
  accounts are unlocked, and excess above `MIN` is always withdrawable. To exit, an Active
  validator must first `deregister_validator` and serve the resign cooldown (or be slashed).
- **Effects:** `transfer_checked` from vault to the user's ATA, with the registry PDA
  signing (`lib.rs:878-891`); checked-subtracts from `staked_grx` (`lib.rs:894-899`). The
  former `Active → Suspended` auto-demotion is **removed**: the pre-CPI bond-lock guard
  guarantees an Active validator's remaining stake can never drop below `MIN` via unstake
  (`lib.rs:901-903`).
- **Event:** `Unstaked` (`lib.rs:905`).

#### `slash_validator(slash_bps, proven_loss)`
- **Signer:** `authority` — must equal `registry.authority` (`UnauthorizedAuthority`).
- **Preconditions:** `slash_bps ∈ 1..=10000` (`InvalidSlashFraction`, `lib.rs:940-943`);
  PoA gate via the shared `poa_slash_gate` helper — registry authority + `has_slash_destination
  == 1` (`SlashDestinationNotSet`) + supplied destination equals the configured one
  (`InvalidSlashDestination`) (`lib.rs:947-954`, `lib.rs:1284-1296`); and (in
  `compute_slash_amount`, `lib.rs:1300-1319`) the target's `validator_status` is `Active`
  **or `Resigning`** (`NotActiveValidator`) with `staked_grx > 0`
  (`InsufficientStakingBalance`). Including `Resigning` keeps the honest-exit path from
  being a slash dodge — the bond stays slashable for the whole resign cooldown.
- **Effects:** `slash_amount = bond * slash_bps / 10000` capped at the bond; victim
  compensation `= min(slash_amount, proven_loss)` to `victim_token_account`, the remainder
  to `slash_destination` — both `transfer_checked` with the registry PDA signing; value
  invariant `slash_amount == compensation + fund` enforced (`lib.rs:955-1022`). Status
  transition applied by the shared `apply_slash_status` helper (`lib.rs:1323-1331`).
- **Event:** `ValidatorSlashed` (`lib.rs:1025`).

> The PoA gate (`poa_slash_gate`) and the amount/status helpers (`compute_slash_amount`,
> `apply_slash_status`) are **deduped** and shared with the multi-victim
> `slash_validator_multi` variant (`lib.rs:1049`).

---

## 5. Invariants and Security Properties

1. **Cooldown re-anchoring closes the dust-bypass (recent fix).** `stake_grx` re-anchors
   `last_stake_at` to the current time on **every** stake, not only the first deposit
   (`lib.rs:719-725`). Anchoring only to the first deposit had allowed a staker to keep a
   permanent dust balance so that `last_stake_at` never refreshed, then stake-large and
   immediately unstake-large with zero cooldown, escaping the slashing window. Every fresh
   GRX now serves the full 24-hour cooldown before it can leave the vault.

2. **Slashing is constrained to Active validators and a configured sink.** `slash_validator`
   refuses to operate until `set_slash_destination` has been called (`SlashDestinationNotSet`),
   rejects any destination other than the configured one (`InvalidSlashDestination`), and
   slashes only accounts whose `validator_status == Active` (`NotActiveValidator`)
   (`lib.rs:838-856`). A slash therefore cannot be misrouted, and plain stakers or
   already-slashed accounts cannot be slashed.

3. **Slashed validators cannot self-reinstate.** `register_validator` rejects accounts in
   `Slashed` status (`lib.rs:738-741`); restaking can never silently undo a slash.

4. **Sharding preserves write-parallelism.** Hot-path registrations write only the per-shard
   counter and never take a write lock on the global `Registry` (`lib.rs:1073-1076`). The
   global totals are stale by design and reconciled by `aggregate_shards`, which rejects
   non-program-owned accounts, validates each shard's PDA via its cached bump, and rejects
   duplicate shards through a bitmask (`lib.rs:196-211`).

5. **Shard binding cannot be forged.** Both `register_user` and `register_meter` require
   `shard_id == shard_for(key)` (`lib.rs:245-248`, `lib.rs:362-365`), so counts cannot be
   scattered onto arbitrary shards, and the same selector seeds the shard PDA in
   status-change instructions (`lib.rs:1147-1152`, `lib.rs:1170-1175`).

6. **Combined tokenization claims are bounded by net generation.** Both GRID settlement
   (`do_settle_meter`, `lib.rs:917-919`) and ERC claims (`mark_erc_claimed`,
   `lib.rs:673-679`) subtract the other's watermark from net generation, so the sum of
   GRID-minted and ERC-claimed energy can never exceed total net generation. This prevents
   double-minting.

7. **Airdrop is exactly-once and idempotent in failure.** `claim_airdrop` sets
   `airdrop_claimed = 1` before the mint CPI, so the flag and the mint commit or roll back
   atomically; a second claim is rejected with `AirdropAlreadyClaimed` (`lib.rs:316-321`).
   The airdrop amount is fixed at `AIRDROP_AMOUNT = 10,000,000,000` smallest units = **10 GRX**
   (9 decimals, `lib.rs:17`).

8. **Checked arithmetic throughout.** The release profile forces `overflow-checks = true`
   (`Cargo.toml:34-35`), and counters use explicit `checked_add` (`MathOverflow`) on
   registration paths and `saturating_*` on decrement paths.

9. **Meter-reading anti-abuse.** Readings must be strictly newer than the last
   (`StaleReading`), at least 60 s apart (`ReadingTooFrequent`), and below a per-delta cap
   of `1e12` units (`ReadingTooHigh`) (`lib.rs:458-485`).

---

## 6. Cross-Program Interfaces (CPI)

### 6.1 `registry → energy-token` (token minting)

The registry depends on `energy-token` with `features = ["cpi"]` (`Cargo.toml:30`) and
invokes its `mint_tokens_direct` instruction in two places:

- **`claim_airdrop`** — mints `AIRDROP_AMOUNT` to the new user (`lib.rs:324-342`).
- **`settle_and_mint_tokens`** — mints the freshly-settled net generation (`lib.rs:641-652`).

In both cases the registry PDA (`[b"registry"]`) signs via
`CpiContext::new_with_signer` with `registry_seeds = [b"registry", &[bump]]`
(`lib.rs:333-339`, `lib.rs:633-651`). The registry PDA is supplied as the energy-token
`authority`, `registry_authority`, and (in the airdrop case, where no REC validator is
required) `rec_validator` accounts (`lib.rs:328-330`).

### 6.2 `registry → treasury` (slash routing — token transfer, not CPI)

Slash redistribution is **not** a CPI into the treasury program. `slash_validator` performs
a plain SPL `transfer_checked` of the slashed bond from the GRX vault to the configured
`slash_destination` token account (`lib.rs:864-879`), which the platform wires to the
treasury `reward_vault`. Redistribution to honest stakers is then performed off this path
by a subsequent `treasury::fund_rewards` call (`lib.rs:819-823`). The registry holds no
compile-time dependency on the treasury program.

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
| `ValidatorSlashed` | `validator`, `slashed_amount`, `remaining_stake`, `timestamp` | `events.rs:108` |

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
| `SlashDestinationNotSet` | Slash destination is not configured | `error.rs:44` |
| `InvalidSlashDestination` | Slash destination does not match the configured destination | `error.rs:46` |
| `NotActiveValidator` | Target is not an active validator | `error.rs:48` |
| `ValidatorAlreadySlashed` | Validator has been slashed and cannot re-register | `error.rs:50` |
| `AggregatorNotAdmitted` | Validator bond requires an active governance-admitted aggregator entry | `error.rs:62` |
| `InvalidAggregatorEntry` | Aggregator entry account is malformed or too short | `error.rs:64` |
| `ValidatorStakeLocked` | Active validator cannot unstake below the minimum bond; deregister or be slashed first | `error.rs:66` |
| `InvalidMeterStatusTransition` | set_meter_status cannot set or leave Inactive; Inactive is terminal (use deactivate_meter) | `error.rs:68` |
| `InvalidZone` | Zone id must be non-negative | `error.rs:70` |

---

## 9. Testing

| Suite | Command | Coverage |
| --- | --- | --- |
| Sharding (Mocha/Anchor) | `npm run test:registry` → `anchor test tests/registry_sharding.ts` (`package.json:15`) | shard initialisation, shard-bound registration, `aggregate_shards` reconciliation |
| Staking (Mocha/Anchor) | `npm run test:staking` → `anchor test tests/staking.ts` (`package.json:16`) | stake / register-validator / unstake-cooldown / slash flows |
| Staking (LiteSVM, in-process) | `npm run test:staking-litesvm` → `mocha -r tsx tests/staking_unstake_litesvm.ts` (`package.json:17`) | clock-warped unstake happy-path, cooldown, and demotion without a live validator |

Standalone / CI runner: `scripts/run-tests.sh --suite registry` runs only the sharding
suite (`scripts/run-tests.sh:94-95`), and `--suite staking` runs the staking suite
(`scripts/run-tests.sh:97-98`); flags `--skip-build` / `--skip-deploy` skip the
respective phases. The runner deploys `registry` among the programs it builds and deploys
(`scripts/run-tests.sh:209`).

The LiteSVM harness (`tests/staking_unstake_litesvm.ts`) runs the program in-process with
the ability to warp the validator clock, which is required to exercise the 24-hour
`UNSTAKE_COOLDOWN_SECS` boundary deterministically without waiting in real time.
