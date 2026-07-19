# Treasury Program

## Abstract

The `treasury` program is the on-chain monetary and settlement-accounting component of the GridTokenX P2P energy-trading platform. It issues THBC, a Thai-baht-pegged stablecoin (six decimals) whose mint authority is the treasury program-derived address (PDA), and provides the baht-denominated settlement primitive by which producer GRX is converted to peg-collateralised value. The program enforces a two-part peg invariant — attestation freshness and a supply ceiling derived from an off-chain reserve attestation — and operates a GRX yield-staking facility that distributes rewards through a MasterChef-style accumulator. Four segregated GRX vaults isolate redemption collateral, staker custody, the reward pool, and the regulator / consumer-rebate pool; staked GRX never participates in peg collateralisation. The program holds no business logic in handlers beyond the necessary token-program cross-program invocations (CPIs) and the accounting updates that back each token movement.

---

## 1. Program Identity

| Property | Value |
| --- | --- |
| Program ID | `FfxSQYKUmx9NGdCC9TDPmZSYjWYE1h4ruu3JatzHN5Tn` |
| Crate name | `treasury` (`programs/treasury/Cargo.toml:2`) |
| Crate version | `0.1.0` (`programs/treasury/Cargo.toml:3`) |
| `declare_id!` location | `programs/treasury/src/lib.rs:32` |
| Edition | 2021 (`programs/treasury/Cargo.toml:5`) |
| Library types | `cdylib`, `lib` (`programs/treasury/Cargo.toml:8`) |

The program ID declared at `lib.rs:32` matches the canonical entry in the localnet program table (`Anchor.toml:15`).

### Dependencies

| Dependency | Version / source | Purpose |
| --- | --- | --- |
| `anchor-lang` | `1.0.0`, feature `init-if-needed` | Anchor runtime and account framework (`Cargo.toml:24`) |
| `anchor-spl` | `1.0.0` | SPL token-interface bindings (`Cargo.toml:25`) |
| `spl-token` | `4.0.0` | SPL token program types (`Cargo.toml:26`) |
| `bytemuck` | `1.16`, feature `derive` | Pod derivation for zero-copy state (`Cargo.toml:27`) |
| `compute-debug` | path `../../shared/compute-debug`, optional | Compute-unit profiling, gated on the `localnet` feature (`Cargo.toml:28`) |

The token interface is imported from `anchor_spl::token_interface` (`lib.rs:4`), which supports both the SPL Token and Token-2022 programs through the `TokenInterface` abstraction. All token operations (`transfer_checked`, `mint_to`, `burn`) are routed through this interface (`lib.rs:5-7`).

---

## 2. System Role

The treasury program serves three distinct functions within the platform.

**THBC stablecoin issuance.** THBC is a THB-pegged stablecoin with six decimals, so one whole baht equals 1,000,000 minor units (`state.rs:9-10`, constant `THBC_DECIMALS`). The THBC mint is created during initialisation with its mint authority set to the treasury PDA derived from the seed `[b"treasury"]` (`lib.rs:1095-1104`, `lib.rs:1086`). No external account can mint THBC; issuance occurs solely through `swap_grx_for_thbc`, signed by the treasury PDA (`lib.rs:710-723`).

**Baht-denominated settlement accounting.** The program maintains a cumulative `total_settled_thbc` counter (`state.rs:45`) advanced by the trading program through the `record_settlement` CPI after a trade is paid in THBC (`lib.rs:360-381`). On the batch path the trading program records into per-shard accumulators instead (`record_settlement_batch_sharded`, §4.3b), and the global counter is reconciled by `aggregate_settlement_shards`. This counter is the on-chain record of total baht value settled; the operation moves no funds.

**GRX↔THBC swap and GRX yield staking.** The `swap_grx_for_thbc` and `redeem_thbc_for_grx` instructions implement bidirectional conversion between GRX and THBC (`lib.rs:670`, `lib.rs:741`). The staking facility (`stake_grx`, `unstake_grx`, `claim_rewards`, `fund_rewards`) lets GRX holders earn GRX-denominated yield (`lib.rs:804`, `lib.rs:852`, `lib.rs:903`, `lib.rs:953`).

### The four GRX vaults

All four vaults are SPL token accounts holding GRX, owned by the treasury PDA, each derived from a distinct seed (`lib.rs:1107-1140` for the original three; `rebate_vault` added separately, see §4.13):

| Vault | Seed | Role |
| --- | --- | --- |
| `swap_vault` | `[b"swap_vault"]` | Redemption collateral: receives GRX on swap, pays out GRX on redeem (`lib.rs:1107-1116`) |
| `stake_vault` | `[b"stake_vault"]` | Staker custody: holds staked principal; explicitly never backs the peg (`lib.rs:1119-1128`) |
| `reward_vault` | `[b"reward_vault"]` | Reward pool: GRX paid out as staking rewards (`lib.rs:1131-1140`) |
| `rebate_vault` | `[b"rebate_vault"]` | Regulator / consumer-rebate pool: destination for registry's slashed validator bonds, role-map.md fix #10 (`lib.rs:1402-1411`) |

The segregation is structural: GRX deposited as swap collateral, GRX held in staking custody, GRX held for rewards, and GRX received from slashing reside in separate PDAs that share no account and are never commingled.

---

## 3. State Model

### 3.1 `Treasury` (global configuration and accounting)

`Treasury` is a zero-copy account (`#[account(zero_copy)] #[repr(C)]`, `state.rs:25-26`) stored at a single PDA derived from `[b"treasury"]` (`lib.rs:1086`). The layout is hand-padded for `bytemuck` Pod compatibility; the leading `u128` forces 16-byte struct alignment, and an explicit 15-byte tail pad brings the total size to exactly 272 bytes, a multiple of 16 (`state.rs:22-24`, `state.rs:60-61`). Account space is `8 + std::mem::size_of::<Treasury>()` (`lib.rs:1085`), where the leading 8 bytes are the Anchor discriminator.

| Field | Type | Bytes | Meaning |
| --- | --- | --- | --- |
| `acc_reward_per_share` | `u128` | 16 | Cumulative GRX reward per staked GRX, scaled by `ACC_PRECISION` (`state.rs:28-29`) |
| `authority` | `Pubkey` | 32 | Admin for `set_params` and pause (`state.rs:31`) |
| `attestor` | `Pubkey` | 32 | Off-chain custodian authorised to attest the THB reserve (`state.rs:32`) |
| `grx_mint` | `Pubkey` | 32 | GRX SPL mint (energy-token program) (`state.rs:33`) |
| `thbc_mint` | `Pubkey` | 32 | THBC stablecoin mint; authority is this PDA (`state.rs:34`) |
| `settlement_recorder` | `Pubkey` | 32 | PDA authorised to call `record_settlement` (trading `market_authority`) (`state.rs:35`) |
| `attested_reserve` | `u64` | 8 | Off-chain THB reserve in THBC minor units; the peg ceiling (`state.rs:37`) |
| `attestation_ts` | `i64` | 8 | Unix timestamp of the last reserve attestation (`state.rs:38`) |
| `attestation_ttl` | `i64` | 8 | Maximum attestation age in seconds before mints are blocked (`state.rs:39`) |
| `thbc_supply` | `u64` | 8 | THBC minted by the treasury; must stay ≤ `attested_reserve` (`state.rs:40`) |
| `grx_per_thbc_rate` | `u64` | 8 | THBC minor units issued per one whole GRX (settlement price) (`state.rs:41`) |
| `total_staked` | `u64` | 8 | GRX currently staked; never counted toward the peg (`state.rs:42`) |
| `reward_pool` | `u64` | 8 | GRX available to pay staking rewards (`state.rs:43`) |
| `created_at` | `i64` | 8 | Initialisation timestamp (`state.rs:44`) |
| `total_settled_thbc` | `u64` | 8 | Cumulative baht value settled via trading CPI (`state.rs:45`) |
| `swap_fee_bps` | `u16` | 2 | Fee on swap output, basis points; capped at 10,000 (`state.rs:47`) |
| `paused` | `u8` | 1 | `1` = swaps and redeems halted (`state.rs:49`) |
| `bump` | `u8` | 1 | Treasury PDA bump; also the mint/transfer signer seed (`state.rs:50`) |
| `thbc_mint_bump` | `u8` | 1 | Stored canonical bump for the THBC mint PDA (`state.rs:55`) |
| `swap_vault_bump` | `u8` | 1 | Stored canonical bump for `swap_vault` (`state.rs:56`) |
| `stake_vault_bump` | `u8` | 1 | Stored canonical bump for `stake_vault` (`state.rs:57`) |
| `reward_vault_bump` | `u8` | 1 | Stored canonical bump for `reward_vault` (`state.rs:58`) |
| `rebate_vault_bump` | `u8` | 1 | Stored canonical bump for `rebate_vault`, written by `initialize_rebate_vault` (`state.rs:59`) |
| `_padding` | `[u8; 15]` | 15 | Tail pad to 272 bytes (16-aligned) (`state.rs:60`) |

Total size: 272 bytes (`state.rs:61`).

The mint and vault bumps are persisted deliberately. Account constraints validate the dependent PDAs with `bump = treasury.X_bump`, which uses `create_program_address` (a single hash, roughly 1 hash) rather than the bare `bump` form, which would trigger a `find_program_address` bump search costing approximately 12,000 compute units on the swap, stake, and redeem hot paths (`state.rs:51-54`).

### 3.2 `StakePosition` (per-user staking position)

`StakePosition` is a regular Borsh account (`#[account]`, `state.rs:66-73`), chosen because staking is not a hot path (`state.rs:64`). It is stored at a PDA derived from `[b"stake", owner]` (`state.rs:65`, `lib.rs:1234`).

| Field | Type | Bytes | Meaning |
| --- | --- | --- | --- |
| `owner` | `Pubkey` | 32 | Staker (`state.rs:68`) |
| `amount` | `u64` | 8 | GRX staked by this user (`state.rs:69`) |
| `reward_debt` | `u128` | 16 | Bookkeeping baseline: `amount × acc / ACC_PRECISION` at last update (`state.rs:70`) |
| `pending` | `u64` | 8 | Accrued-but-unclaimed GRX rewards (`state.rs:71`) |
| `bump` | `u8` | 1 | PDA bump (`state.rs:72`) |

`StakePosition::LEN = 32 + 8 + 16 + 8 + 1 = 65` bytes, excluding the 8-byte Anchor discriminator (`state.rs:75-78`); allocated space is `8 + StakePosition::LEN` (`lib.rs:1233`).

### 3.3 `SettlementRecord` (per-batch audit commitment)

`SettlementRecord` is a zero-copy account (`#[account(zero_copy)] #[repr(C)]`, `state.rs:117-118`), hand-padded for `bytemuck` Pod. It binds a Merkle root over one zone's settlement batch plus the VAT figures, for off-chain verification and e-Tax issuance; the chain stores the commitment but performs no on-chain verification (`state.rs:104-108`). Two deliberately distinct PDA seed namespaces write this account type, so the two batch-recording instructions can never `init` the same address for the same `(zone, batch)` (`state.rs:110-116`):

- `record_settlement_batch_sharded` (the live trading CPI path): `[b"settlement", zone_id, batch_id]` (`lib.rs:1461`);
- `record_settlement_batch` (standalone, non-sharded, not on the trading CPI path today): `[b"settlement_batch", zone_id, batch_id]` (`lib.rs:1353`).

Either way the record is created on first record for the batch with space `8 + std::mem::size_of::<SettlementRecord>()` (`lib.rs:1352`, `lib.rs:1460`).

| Field | Type | Bytes | Meaning |
| --- | --- | --- | --- |
| `merkle_root` | `[u8; 32]` | 32 | Root over the batch's match leaves (`state.rs:120`) |
| `recorder` | `Pubkey` | 32 | `settlement_recorder` that committed the batch (`state.rs:121`) |
| `total_value` | `u64` | 8 | Gross baht (THBC minor units) in the batch (`state.rs:122`) |
| `vat_amount` | `u64` | 8 | VAT on the energy value, for audit / e-Tax (`state.rs:123`) |
| `committed_ts` | `i64` | 8 | Unix timestamp of the commit (`state.rs:124`) |
| `batch_id` | `u64` | 8 | Settlement batch id within the zone (`state.rs:125`) |
| `zone_id` | `u32` | 4 | Market zone (`state.rs:126`) |
| `vat_rate_bps` | `u16` | 2 | VAT rate applied, basis points (`state.rs:127`) |
| `bump` | `u8` | 1 | PDA bump (`state.rs:128`) |
| `_padding` | `[u8; 9]` | 9 | Pad to 112 bytes, 8-aligned (`state.rs:129`) |

Total size: 112 bytes (`state.rs:130`).

### 3.4 Constants

| Constant | Value | Purpose |
| --- | --- | --- |
| `ACC_PRECISION` | `1_000_000_000_000` (1e12) | Fixed-point precision for the reward accumulator (`state.rs:7`) |
| `THBC_DECIMALS` | `6` | THBC decimals (`state.rs:10`) |
| `NUM_SETTLE_SHARDS` | `16` | Number of per-shard settlement accumulator PDAs (`state.rs:18`) |
| `GRX_ATOMS_PER_WHOLE` | `1_000_000_000` (1e9) | GRX atomic units per whole GRX; the swap divisor (`lib.rs:36`) |

---

## 4. Instruction Set

This section documents each instruction defined in the `#[program]` module (`lib.rs:272-1074`). All instruction bodies are wrapped in `compute_fn!`, which is a real profiling macro under the `localnet` feature and a no-op otherwise (`lib.rs:17-30`).

### 4.1 `initialize`

Bootstraps the treasury (`lib.rs:278-314`).

- **Signers:** `authority` (also the rent payer) (`lib.rs:1142-1143`).
- **Accounts:** `treasury` (init, `[b"treasury"]`), `grx_mint`, `thbc_mint` (init, `[b"thbc_mint"]`, `THBC_DECIMALS` decimals, authority = treasury), `swap_vault`, `stake_vault`, `reward_vault` (all init, authority = treasury), `token_program`, `system_program`, `rent` (`lib.rs:1081-1148`).
- **Parameters:** `attestor`, `settlement_recorder`, `grx_per_thbc_rate`, `swap_fee_bps`, `attestation_ttl` (`lib.rs:278-285`).
- **Preconditions:** `swap_fee_bps ≤ 10_000`, else `InvalidFeeBps` — an unbounded fee could otherwise zero every swap's output platform-wide (`lib.rs:287`).
- **Effects:** writes all configuration fields via `load_init`, sets counters to zero, records `created_at`, and persists all PDA bumps (`lib.rs:288-311`). `attested_reserve`, `attestation_ts`, `thbc_supply`, `total_staked`, `reward_pool`, `total_settled_thbc`, and `acc_reward_per_share` all start at zero, and `paused` starts at `0` (`lib.rs:289-311`).
- **Events / errors:** none emitted; `InvalidFeeBps` on an out-of-range fee.

### 4.2 `set_params`

Admin update of swap rate, fee, attestation TTL, pause flag, and settlement recorder (`lib.rs:318-348`).

- **Signers:** `authority` (`lib.rs:1154`).
- **Preconditions:** `swap_fee_bps ≤ 10_000`, else `InvalidFeeBps` (`lib.rs:327`); `treasury.authority == authority.key()`, else `UnauthorizedAuthority` (`lib.rs:330`).
- **Effects:** overwrites `grx_per_thbc_rate`, `swap_fee_bps`, `attestation_ttl`, `paused`, and `settlement_recorder` (`lib.rs:331-335`).
- **Events / errors:** emits `ParamsUpdated` with the full new parameter set (`lib.rs:337-345`); `InvalidFeeBps`, `UnauthorizedAuthority` on failure.

### 4.3 `record_settlement`

Records a baht-denominated trade settlement; non-custodial (`lib.rs:360-381`).

- **Signers:** `recorder` (`lib.rs:1336`).
- **Preconditions:** `value > 0`, else `ZeroAmount` (`lib.rs:362`); `treasury.settlement_recorder == recorder.key()`, else `UnauthorizedRecorder` (`lib.rs:365-368`).
- **Effects:** `total_settled_thbc += value` with checked addition (`lib.rs:369-372`).
- **Events:** `SettlementRecorded` (`lib.rs:373-378`).
- **Errors:** `ZeroAmount`, `UnauthorizedRecorder`, `MathOverflow`.
- **Replay safety:** not independently replay-safe — the instruction has no per-call nullifier of its own and relies on the caller (trading's per-match `TradeNullifier` in `settle_offchain.rs`) to guarantee it is never invoked twice for the same match (`lib.rs:356-359`).

### 4.3a `record_settlement_batch`

Records a per-batch baht settlement with an on-chain audit commitment; non-custodial (`lib.rs:389-438`). This is the standalone, non-sharded variant — it is **not** the live trading CPI path (the batch settle in trading drives `record_settlement_batch_sharded`, §4.3b), which is why it uses its own `SettlementRecord` seed namespace.

- **Signers:** `recorder` (= the trading `market_authority` PDA) and `payer` (rent payer for the `SettlementRecord` PDA) (`lib.rs:1358-1359`, `lib.rs:1361-1362`).
- **Accounts:** `treasury` (`[b"treasury"]`), `settlement_record` (init, per-`(zone, batch)` PDA, seeds `[b"settlement_batch", zone_id, batch_id]` — deliberately distinct from the sharded variant's `[b"settlement", ...]` so the two can never `init` the same PDA for the same `(zone, batch)`), `recorder`, `payer`, `system_program` (`lib.rs:1341-1365`). The `SettlementRecord` is created on first record for the batch (`lib.rs:1345-1356`).
- **Parameters:** `value`, `merkle_root: [u8; 32]`, `vat_amount`, `vat_rate_bps`, `zone_id`, `batch_id` (`lib.rs:389-397`).
- **Preconditions:** `value > 0`, else `ZeroAmount` — also closes a PDA-orphan path where a zero-value call would consume the batch's `SettlementRecord` address (`lib.rs:399`); `treasury.settlement_recorder == recorder.key()`, else `UnauthorizedRecorder` (`lib.rs:403-406`).
- **Effects:** bumps `total_settled_thbc` by the gross batch `value` with checked addition (`lib.rs:407-412`); writes the per-`(zone, batch)` `SettlementRecord` carrying `merkle_root`, `recorder`, `total_value`, `vat_amount`, `committed_ts`, `batch_id`, `zone_id`, `vat_rate_bps`, and `bump` (`lib.rs:414-423`). Commit-only — no on-chain verification of the Merkle root; off-chain verifiers recompute it and e-Tax issuance consumes the VAT fields.
- **Events:** `SettlementBatchRecorded` (`lib.rs:425-435`).
- **Errors:** `ZeroAmount`, `UnauthorizedRecorder`, `MathOverflow`.

### 4.3b Sharded settlement recording (`initialize_settlement_shard`, `record_settlement_sharded`, `record_settlement_batch_sharded`, `aggregate_settlement_shards`)

Settlement recording into the single `Treasury` PDA write-locks it under Sealevel, serialising every settle. The sharded path spreads the counter across `NUM_SETTLE_SHARDS = 16` per-shard `SettlementShard` PDAs (`[b"settle_shard", &[shard_id]]`, `state.rs:80-94`), keeping `treasury` **read-only** on the hot path (recorder gate only) so parallel settles on distinct shards do not serialise (`lib.rs:1425-1426`, `lib.rs:1449-1450`). The global `total_settled_thbc` is stale on purpose and reconciled by aggregation.

- **`initialize_settlement_shard(shard_id)`** (`lib.rs:443-460`): admin-only; creates one shard PDA per `shard_id < NUM_SETTLE_SHARDS`, storing its canonical bump (`lib.rs:1367-1386`). Errors: `InvalidShardId`, `UnauthorizedAuthority`.
- **`record_settlement_sharded(value, shard_id)`** (`lib.rs:488-519`): parallel-friendly `record_settlement` — requires `value > 0` (`ZeroAmount`) and `shard_id < NUM_SETTLE_SHARDS` (`InvalidShardId`), gates on `settlement_recorder`, then bumps the shard's `settled_thbc` and `settlement_count` with checked addition (`lib.rs:494-509`). Emits `SettlementShardRecorded` (`lib.rs:510-516`). Same replay-safety caveat as `record_settlement`: relies on trading's per-match `TradeNullifier` (`lib.rs:486-487`).
- **`record_settlement_batch_sharded(value, merkle_root, vat_amount, vat_rate_bps, zone_id, batch_id, shard_id)`** (`lib.rs:586-643`): the **live trading batch CPI path**. Requires `value > 0` and a valid `shard_id`, gates on `settlement_recorder`, bumps the shard accumulator, and writes the per-`(zone, batch)` `SettlementRecord` under `[b"settlement", zone_id, batch_id]` (`lib.rs:597-627`, `lib.rs:1457-1464`). Emits `SettlementBatchShardRecorded`, carrying the full audit fields (Merkle root, VAT amount/rate, batch identity) plus the shard's running total (`lib.rs:629-640`).
- **`aggregate_settlement_shards`** (`lib.rs:534-577`): admin-only drain-and-fold reconcile. Each `SettlementShard` passed via `remaining_accounts` is validated — program ownership, minimum data length (`InvalidShardAccount`, a hard failure: malformed accounts are rejected, never silently skipped), `shard_id` range, stored-bump PDA re-derivation via `create_program_address`, a shard-id bitmask against duplicates (`DuplicateShard`), and writability (`ShardNotWritable`) — then its `settled_thbc` is **added** to the live global and zeroed (`lib.rs:547-574`). Folding (rather than overwriting) preserves single-match `record_settlement` contributions; zeroing makes each shard a delta-since-last-aggregate, so re-running with no new settles is a no-op. `settlement_count` stays cumulative.

### 4.4 `update_attestation`

Custodian refresh of the off-chain THB reserve figure (`lib.rs:647-661`).

- **Signers:** `attestor` (`lib.rs:1161`).
- **Preconditions:** `treasury.attestor == attestor.key()`, else `UnauthorizedAttestor` (`lib.rs:651`).
- **Effects:** sets `attested_reserve` to the supplied value and `attestation_ts` to the current clock time (`lib.rs:652-653`).
- **Events:** `ReserveAttested` (`lib.rs:654-658`).
- **Errors:** `UnauthorizedAttestor`.

### 4.5 `swap_grx_for_thbc`

The baht-denominated settlement primitive: converts GRX to THBC (`lib.rs:670-737`). The peg math is extracted into the unit-testable helper `compute_swap_grx_for_thbc` (`lib.rs:62-88`).

- **Signers:** `user` (`lib.rs:1188`).
- **Accounts:** `treasury`, `grx_mint`, `thbc_mint`, `swap_vault`, `user_grx_ata`, `user_thbc_ata`, `token_program` (`lib.rs:1165-1190`). The treasury constraints assert `grx_mint` and `thbc_mint` match the stored mints (`lib.rs:1170-1171`).
- **Preconditions:** `grx_in > 0` (`ZeroAmount`); `paused == 0` (`Paused`); `grx_per_thbc_rate > 0` (`RateNotSet`); attestation freshness `now − attestation_ts ≤ attestation_ttl` (`StaleAttestation`) (`lib.rs:672-682`); inside the helper, net output `> 0` (`ZeroAmount`, `lib.rs:78`) and peg ceiling `thbc_supply + net ≤ attested_reserve` (`PegBreach`, `lib.rs:82`).
- **Swap formula:** the gross THBC output is

  ```
  gross    = grx_in × grx_per_thbc_rate / 1e9      (1e9 = GRX_ATOMS_PER_WHOLE)
  fee      = gross × swap_fee_bps / 10_000
  thbc_out = gross − fee
  ```

  computed in `u128` to avoid intermediate overflow (`lib.rs:69-77`). The division by `GRX_ATOMS_PER_WHOLE` converts an atomic GRX amount through the rate expressed in THBC minor units per whole GRX.
- **Effects:** transfers `grx_in` GRX from `user_grx_ata` into `swap_vault` (authority = user) via `transfer_checked` (`lib.rs:696-708`); mints `thbc_out` THBC to `user_thbc_ata`, signed by the treasury PDA seeds `[b"treasury", bump]` (`lib.rs:710-723`); sets `thbc_supply = new_supply` (`lib.rs:725`).
- **Events:** `SwappedGrxForThbc` (`lib.rs:727-734`).
- **Errors:** `ZeroAmount`, `Paused`, `RateNotSet`, `StaleAttestation`, `PegBreach`, `MathOverflow`.

### 4.6 `redeem_thbc_for_grx`

Redeems THBC back into GRX from the swap vault (`lib.rs:741-799`). The peg math is extracted into the unit-testable helper `compute_redeem_thbc_for_grx` (`lib.rs:95-113`).

- **Signers:** `user` (`lib.rs:1216`).
- **Accounts:** same shape as the swap (`lib.rs:1193-1218`).
- **Preconditions:** `thbc_in > 0` (`ZeroAmount`); `paused == 0` (`Paused`); `grx_per_thbc_rate > 0` (`RateNotSet`) (`lib.rs:743-749`); inside the helper, `thbc_in ≤ thbc_supply` (`SupplyUnderflow`, `lib.rs:101`); computed `grx_out > 0` (`ZeroAmount`, `lib.rs:106`); `grx_out ≤ swap_vault.amount` (`InsufficientVault`, `lib.rs:108`).
- **Formula:** `grx_out = thbc_in × 1e9 / grx_per_thbc_rate`, the inverse of the swap rate (`lib.rs:102-105`).
- **Effects:** burns `thbc_in` THBC from `user_thbc_ata` (authority = user) (`lib.rs:764-772`); transfers `grx_out` GRX from `swap_vault` to `user_grx_ata`, signed by the treasury PDA (`lib.rs:774-787`); sets `thbc_supply = thbc_supply − thbc_in` (`lib.rs:109-111`, `lib.rs:789`).
- **Events:** `RedeemedThbcForGrx` (`lib.rs:791-797`).
- **Errors:** `ZeroAmount`, `Paused`, `RateNotSet`, `SupplyUnderflow`, `InsufficientVault`, `MathOverflow`.

### 4.7 `stake_grx`

Stakes GRX into the staking vault (`lib.rs:804-849`).

- **Signers:** `user` (`lib.rs:1246-1247`).
- **Accounts:** `treasury`, `position` (`init_if_needed`, `[b"stake", user]`), `grx_mint`, `stake_vault`, `user_grx_ata`, `token_program`, `system_program` (`lib.rs:1221-1250`).
- **Preconditions:** `amount > 0` (`ZeroAmount`); `total_staked + amount` must not overflow (`MathOverflow`) (`lib.rs:806`, `lib.rs:811`).
- **Effects:** if the existing position is non-zero, settles accrued reward into `pending` at the current accumulator before growing it (`lib.rs:815-820`); transfers `amount` GRX from the user into `stake_vault` (`lib.rs:822-832`); updates `position.owner`, `position.amount += amount`, recomputes `reward_debt`, and increments `total_staked` (`lib.rs:834-839`).
- **Events:** `Staked` (`lib.rs:841-846`).
- **Errors:** `ZeroAmount`, `MathOverflow`.

### 4.8 `unstake_grx`

Withdraws staked GRX principal (`lib.rs:852-900`).

- **Signers:** `user` (`lib.rs:1276`).
- **Accounts:** `treasury`, `position` (`[b"stake", user]` — the PDA seeds alone bind the position to the signer, so no separate `owner` account or `has_one` check is needed), `grx_mint`, `stake_vault`, `user_grx_ata`, `token_program` (`lib.rs:1252-1278`).
- **Preconditions:** `amount > 0` (`ZeroAmount`); `amount ≤ position.amount` (`InsufficientStake`) (`lib.rs:854`, `lib.rs:863`).
- **Effects:** settles accrued reward into `pending`, decrements `position.amount`, recomputes `reward_debt` (`lib.rs:864-867`); transfers `amount` GRX from `stake_vault` to the user, signed by the treasury PDA (`lib.rs:869-881`); decrements `total_staked` via checked subtraction, failing loud with `MathOverflow` on underflow rather than clamping (`lib.rs:883-890`).
- **Events:** `Unstaked` (`lib.rs:892-897`).
- **Errors:** `ZeroAmount`, `InsufficientStake`, `MathOverflow`.

### 4.9 `claim_rewards`

Claims accrued staking rewards, paid in GRX from the reward pool (`lib.rs:903-949`).

- **Signers:** `user` (`lib.rs:1304`).
- **Accounts:** `treasury`, `position` (`[b"stake", user]`), `grx_mint`, `reward_vault`, `user_grx_ata`, `token_program` (`lib.rs:1281-1306`).
- **Preconditions:** payout `> 0` (`ZeroAmount`); `reward_pool ≥ payout` (`InsufficientRewardPool`) (`lib.rs:919`, `lib.rs:921-924`).
- **Effects:** computes `payout = pending + accrued_since(...)`, zeroes `pending`, rebases `reward_debt` (`lib.rs:911-918`); transfers `payout` GRX from `reward_vault` to the user, signed by the treasury PDA (`lib.rs:926-938`); decrements `reward_pool` (`lib.rs:940`).
- **Events:** `RewardsClaimed` (`lib.rs:942-946`).
- **Errors:** `ZeroAmount`, `InsufficientRewardPool`, `MathOverflow`.

### 4.10 `fund_rewards`

Deposits GRX into the reward pool, distributed pro-rata to current stakers (`lib.rs:953-991`).

- **Signers:** `funder` (`lib.rs:1325`).
- **Accounts:** `treasury`, `grx_mint`, `reward_vault`, `funder_grx_ata`, `token_program` (`lib.rs:1309-1327`).
- **Preconditions:** `amount > 0` (`ZeroAmount`); `total_staked > 0` (`NoStakeToReward`) (`lib.rs:955`, `lib.rs:960`).
- **Effects:** transfers `amount` GRX from `funder_grx_ata` into `reward_vault` (`lib.rs:964-974`); advances the accumulator by `delta = amount × ACC_PRECISION / total_staked` and increments `reward_pool` (`lib.rs:976-982`).
- **Events:** `RewardsFunded` (`lib.rs:984-988`).
- **Errors:** `ZeroAmount`, `NoStakeToReward`, `MathOverflow`.

### 4.11 `slash_stake`

Slashes a staker's principal for misbehaviour and redistributes it to remaining stakers (`lib.rs:1001-1073`).

- **Signers:** `authority` (must equal `treasury.authority` via `has_one`, `lib.rs:1481`).
- **Accounts:** `treasury`, `target_owner` (unchecked; identifies the slashed staker), `position` (`[b"stake", target_owner]`), `grx_mint`, `stake_vault`, `reward_vault`, `authority`, `token_program` (`lib.rs:1476-1505`).
- **Preconditions:** `amount > 0` (`ZeroAmount`); `position.amount > 0` (`InsufficientStake`) (`lib.rs:1002`, `lib.rs:1014`).
- **Effects:** settles the slashed staker's accrued reward into `pending` at the old accumulator, then removes `slashed = min(amount, position.amount)` from principal (`lib.rs:1012-1020`); advances the accumulator by `slashed × ACC_PRECISION / total_after` when stake remains, otherwise leaves it unchanged (`lib.rs:1027-1035`); rebases the slashed staker's `reward_debt` at the new accumulator so they do not share in their own slash (`lib.rs:1037-1041`); transfers `slashed` GRX from `stake_vault` to `reward_vault`, signed by the treasury PDA, and adds it to `reward_pool` (`lib.rs:1043-1062`).
- **Events:** `StakeSlashed` (`lib.rs:1064-1070`).
- **Errors:** `ZeroAmount`, `InsufficientStake`, `MathOverflow`.

### 4.12 Reward accumulator (MasterChef pattern)

Reward accounting follows the MasterChef accumulator pattern. The shared `acc_reward_per_share` (scaled by `ACC_PRECISION = 1e12`) tracks cumulative reward per staked GRX (`state.rs:7`, `state.rs:28-29`). Two helper functions implement the bookkeeping (`lib.rs:39-55`):

```
accrued_since(amount, acc, reward_debt) = amount × acc / ACC_PRECISION − reward_debt   (saturating at 0)
reward_debt_for(amount, acc)            = amount × acc / ACC_PRECISION
```

`fund_rewards` and the redistribution branch of `slash_stake` advance the accumulator by `delta = deposited × ACC_PRECISION / total_staked` (`lib.rs:976-979`, `lib.rs:1028-1031`). A staker's claimable reward is the difference between `amount × acc / ACC_PRECISION` and the `reward_debt` captured at the last position update, plus any settled `pending`. The unit tests verify exactness of the accumulator: a sole staker earns the full funded pot, equal stakers split evenly, and a late joiner earns nothing from a prior pot (`lib.rs:121-155`).

### 4.13 `initialize_rebate_vault`

One-time creation of the fourth GRX vault — the regulator / consumer-rebate pool that registry's `slash_destination` should point at (role-map.md fix #10), added so a slashed validator bond never lands in `reward_vault` and mixes with staker yield (`lib.rs:469-476`).

- **Signers:** `authority`, checked against `treasury.authority` (`UnauthorizedAuthority` on mismatch) (`lib.rs:471-472`).
- **Accounts:** `treasury` (`[b"treasury"]`, mut, constrains `grx_mint` to match `treasury.grx_mint`), `grx_mint`, `rebate_vault` (init, `[b"rebate_vault"]`, authority = treasury), `authority`, `token_program`, `system_program` (`lib.rs:1389-1418`).
- **Parameters:** none.
- **Effects:** creates the `rebate_vault` token account and persists its canonical bump into `Treasury.rebate_vault_bump` (`lib.rs:473`, `state.rs:59`), so later constraints can use the cheap `create_program_address` form; idempotent in practice (a second call fails with an "already in use" account error, handled by `scripts/init-treasury.ts`). No CPI wiring — registry sends slashed GRX here via a plain token transfer; this program never reads or moves it.
- **Events / errors:** none emitted; `UnauthorizedAuthority` on failure.

---

## 5. Invariants and Security Properties

### 5.1 Peg invariants (minting)

Two conditions, both enforced in `swap_grx_for_thbc`, govern THBC issuance:

1. **Attestation freshness.** A mint is permitted only when `now − attestation_ts ≤ attestation_ttl`; a stale attestation yields `StaleAttestation` (`lib.rs:679-682`). The attestation is the peg's source of truth and is refreshed solely by the custodian through `update_attestation` (`lib.rs:647-661`).
2. **Supply ceiling.** Outstanding `thbc_supply + minted` must never exceed `attested_reserve`; a breach yields `PegBreach` (`lib.rs:79-82`, in the `compute_swap_grx_for_thbc` helper). Thus the total THBC in circulation can never exceed the attested off-chain THB reserve.

### 5.2 Redemption collateral guards

`redeem_thbc_for_grx` enforces two guards, both in the `compute_redeem_thbc_for_grx` helper (`lib.rs:95-113`, called at `lib.rs:754-759`), that keep the ledger and the vault consistent:

1. **Supply underflow.** Burning more THBC than the tracked supply would desynchronise the peg ledger, so `thbc_in ≤ thbc_supply` is required, yielding `SupplyUnderflow` otherwise (`lib.rs:101`; also enforced on the subtraction at `lib.rs:109-111`).
2. **Vault sufficiency.** The payout `grx_out` must not exceed the physical GRX held in `swap_vault.amount`, yielding `InsufficientVault` otherwise (`lib.rs:108`). This guard prevents a rate change via `set_params` from decoupling the payout from deposited collateral and draining other swappers' GRX.

### 5.3 Staked GRX never backs the peg

Staked principal is held in `stake_vault` (`lib.rs:1119-1128`), separate from `swap_vault`, which is the only redemption-collateral source (`lib.rs:1106`, `lib.rs:777-782`). The `total_staked` field is documented as never counted toward the peg (`state.rs:42`), and the peg ceiling is computed solely against `thbc_supply` and `attested_reserve` (`lib.rs:79-82`). Consequently, the peg's solvency arithmetic is independent of staking activity.

### 5.4 Settlement recording authorisation

`record_settlement` advances `total_settled_thbc` only when the signing `recorder` equals the stored `settlement_recorder` (`lib.rs:365-368`), which is the trading `market_authority` PDA passed via `invoke_signed` from the trading program (`lib.rs:1334-1336`). All four recording instructions additionally require `value > 0` (`ZeroAmount`), so a zero-value call can neither emit a misleading event nor orphan a batch's `SettlementRecord` PDA (`lib.rs:362`, `lib.rs:399`, `lib.rs:494`, `lib.rs:597`). The operation moves no funds and increments the counter by the **gross** settled value supplied by the caller (`lib.rs:369-372`). Because only the configured recorder can advance the counter, only genuine trading settlements can do so. Recording is, however, **not independently replay-safe**: no recording instruction has a per-call nullifier, so the treasury relies on trading's per-match `TradeNullifier` to guarantee a match is never recorded twice (`lib.rs:356-359`).

### 5.5 Two distinct GRX staking systems

The platform operates two separate GRX staking facilities that share lock/unlock/slash plumbing but are different products and must not be merged. The treasury staking here is **yield staking**: opt-in, reward-bearing (funded through `fund_rewards`), with custody in `stake_vault` and per-user accounting on `StakePosition`. The registry program's `stake_grx` is a **validator security bond**: no yield, gated by a minimum-validator-stake threshold, slashable for validator misbehaviour, with a separate vault. The two share no vault or position account and are not reconciled; a user may hold both. (See the repository `CLAUDE.md` "Treasury program" notes for the platform-level statement of this separation.)

### 5.6 Arithmetic safety

The release profile sets `overflow-checks = true` (`Cargo.toml:32-33`), because `cargo build-sbf` otherwise defaults to silent wrapping. Beyond this, the program prefers explicit `checked_*` and `saturating_*` operations throughout — for example `checked_mul`/`checked_add` in the accumulator helpers (`lib.rs:41-53`), the swap arithmetic (`lib.rs:69-82`), and the redemption supply subtraction (`lib.rs:109-111`); `saturating_sub` for attestation age (`lib.rs:680`); `checked_sub` with an explicit `MathOverflow` for the `total_staked` decrement (`lib.rs:888`). Overflow conversions to `u64` map to `MathOverflow` (`lib.rs:45`, `lib.rs:84-86`).

---

## 6. Cross-Program Interfaces (CPI)

### 6.1 Trading → Treasury (`record_settlement`)

The trading program's single-match settle invokes `record_settlement` as a non-custodial CPI after settling a trade paid in THBC (`lib.rs:350-381`; trading side `programs/trading/src/instructions/settle_offchain.rs:914`). The trading `market_authority` PDA is passed as the `recorder` signer through `invoke_signed` (`lib.rs:1334-1336`), matched against `treasury.settlement_recorder`. The treasury moves no funds; it only advances `total_settled_thbc` by the gross settled value (`lib.rs:369-372`). The `settlement_recorder` is configured at initialisation and may be updated through `set_params` (`lib.rs:295`, `lib.rs:335`).

The trading program's batch-settlement path drives the `record_settlement_batch_sharded` CPI (`lib.rs:586-643`; trading side `programs/trading/src/instructions/settle_offchain.rs:1328`), which records the whole batch with one call: it bumps the caller-selected per-shard accumulator (keeping the treasury PDA read-only so parallel batches on distinct shards don't serialise) and writes a per-`(zone, batch)` `SettlementRecord` audit commitment (`lib.rs:605-627`); the global `total_settled_thbc` is reconciled later via `aggregate_settlement_shards` (§4.3b). The non-sharded `record_settlement_batch` is a standalone variant that is not on this CPI path. Recording is **mandatory for THBC markets** — once the trading-program THBC settlement policy is set on a market, any batch match in that currency that omits the treasury accounts is rejected, so the audit commitment cannot be silently skipped.

### 6.2 Registry slash routing → Treasury rebate vault

The registry program's validator-slashing path routes slashed validator bonds to a configured slash destination. As of role-map.md fix #10 this is pointed at the treasury `rebate_vault` (`initialize_rebate_vault`, `lib.rs:469-476`, PDA `seeds = [b"rebate_vault"]`, `lib.rs:1402-1411`) — a regulator / consumer-rebate pool — **not** the `reward_vault`. This is a plain SPL token transfer, not a CPI into the treasury program, and the treasury takes no part in the registry's slashing decision. A slashed bond is a penalty for the harmed side, not staker yield, so it deliberately does **not** flow into `fund_rewards`/`reward_vault` (which remains yield-staking-only, funded manually through `fund_rewards` deposits; the swap fee is simply un-minted THBC — it reduces `thbc_out` and is never routed to any vault, `lib.rs:73-77`). (The treasury program's own `slash_stake` instruction at `lib.rs:1001-1073` is a separate facility that slashes treasury yield-staking positions, not registry validator bonds, and is unaffected by this change.)

---

## 7. Events

All events are defined in `events.rs`.

| Event | Fields | Emitted by | Source |
| --- | --- | --- | --- |
| `ReserveAttested` | `attestor`, `attested_reserve`, `timestamp` | `update_attestation` | `events.rs:6-11`, emit `lib.rs:654` |
| `SwappedGrxForThbc` | `user`, `grx_in`, `thbc_out`, `fee`, `thbc_supply`, `timestamp` | `swap_grx_for_thbc` | `events.rs:14-22`, emit `lib.rs:727` |
| `RedeemedThbcForGrx` | `user`, `thbc_in`, `grx_out`, `thbc_supply`, `timestamp` | `redeem_thbc_for_grx` | `events.rs:25-32`, emit `lib.rs:791` |
| `Staked` | `user`, `amount`, `total_staked`, `timestamp` | `stake_grx` | `events.rs:34-40`, emit `lib.rs:841` |
| `Unstaked` | `user`, `amount`, `total_staked`, `timestamp` | `unstake_grx` | `events.rs:42-48`, emit `lib.rs:892` |
| `RewardsClaimed` | `user`, `amount`, `timestamp` | `claim_rewards` | `events.rs:50-55`, emit `lib.rs:942` |
| `RewardsFunded` | `funder`, `amount`, `timestamp` | `fund_rewards` | `events.rs:57-62`, emit `lib.rs:984` |
| `SettlementRecorded` | `recorder`, `value`, `total_settled_thbc`, `timestamp` | `record_settlement` | `events.rs:64-71`, emit `lib.rs:373` |
| `SettlementShardRecorded` | `recorder`, `shard_id`, `value`, `shard_total`, `timestamp` | `record_settlement_sharded` | `events.rs:76-83`, emit `lib.rs:510` |
| `SettlementBatchRecorded` | `recorder`, `zone_id`, `batch_id`, `total_value`, `vat_amount`, `vat_rate_bps`, `merkle_root`, `total_settled_thbc`, `timestamp` | `record_settlement_batch` | `events.rs:86-97`, emit `lib.rs:425` |
| `SettlementBatchShardRecorded` | `recorder`, `shard_id`, `zone_id`, `batch_id`, `value`, `shard_total`, `vat_amount`, `vat_rate_bps`, `merkle_root`, `timestamp` | `record_settlement_batch_sharded` | `events.rs:103-115`, emit `lib.rs:629` |
| `ParamsUpdated` | `authority`, `grx_per_thbc_rate`, `swap_fee_bps`, `attestation_ttl`, `paused`, `settlement_recorder`, `timestamp` | `set_params` | `events.rs:119-128`, emit `lib.rs:337` |
| `StakeSlashed` | `authority`, `owner`, `slashed_amount`, `total_staked`, `timestamp` | `slash_stake` | `events.rs:131-138`, emit `lib.rs:1064` |

---

## 8. Error Codes

All errors are defined in `error.rs` as `TreasuryError`.

| Variant | Message | Source |
| --- | --- | --- |
| `UnauthorizedAuthority` | Unauthorized authority | `error.rs:7-8` |
| `UnauthorizedAttestor` | Unauthorized reserve attestor | `error.rs:9-10` |
| `UnauthorizedRecorder` | Unauthorized settlement recorder | `error.rs:11-12` |
| `Paused` | Treasury is paused | `error.rs:13-14` |
| `ZeroAmount` | Amount must be greater than zero | `error.rs:15-16` |
| `MathOverflow` | Arithmetic overflow | `error.rs:17-18` |
| `StaleAttestation` | Reserve attestation is stale — refresh before minting THBC | `error.rs:19-20` |
| `PegBreach` | Mint would breach the peg: outstanding THBC must not exceed attested THB reserve | `error.rs:21-22` |
| `RateNotSet` | Swap/redeem rate is not configured | `error.rs:23-24` |
| `InsufficientStake` | Insufficient staked balance | `error.rs:25-26` |
| `InsufficientRewardPool` | Insufficient reward pool to pay the claim | `error.rs:27-28` |
| `InsufficientVault` | Swap vault has insufficient GRX collateral to satisfy the redemption | `error.rs:29-30` |
| `SupplyUnderflow` | Redeem amount exceeds outstanding THBC supply | `error.rs:31-32` |
| `NoStakeToReward` | No stake to fund rewards against | `error.rs:33-34` |
| `InvalidShardId` | Settlement shard id out of range (must be < NUM_SETTLE_SHARDS) | `error.rs:35-36` |
| `DuplicateShard` | Settlement shard passed more than once in aggregation | `error.rs:37-38` |
| `ShardNotWritable` | Settlement shard must be writable to be drained during aggregation | `error.rs:39-40` |
| `InvalidFeeBps` | swap_fee_bps must not exceed 10_000 (100%) | `error.rs:41-42` |
| `InvalidShardAccount` | Settlement shard account is malformed or too small | `error.rs:43-44` |

---

## 9. Testing

The treasury program is exercised by an integration suite and an initialisation script.

- **Integration tests:** `tests/treasury.ts`, run with `npm run test:treasury`, which resolves to `anchor test tests/treasury.ts` (`package.json:28`).
- **Initialisation script:** `scripts/init-treasury.ts` bootstraps the treasury, configures the `settlement_recorder` to the trading `market_authority` PDA, wires the trading-program THBC settlement policy, creates the `rebate_vault`, and points the registry slash destination at it (not `reward_vault` — see §6.2).
- **In-source unit tests:** the `#[cfg(test)] mod tests` block (`lib.rs:115-270`) validates the reward accumulator and the swap/redeem peg math in pure arithmetic, against the extracted helpers `compute_swap_grx_for_thbc` / `compute_redeem_thbc_for_grx` (`lib.rs:57-113`).
