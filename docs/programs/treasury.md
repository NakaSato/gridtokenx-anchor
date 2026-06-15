# Treasury Program

## Abstract

The `treasury` program is the on-chain monetary and settlement-accounting component of the GridTokenX P2P energy-trading platform. It issues THBG, a Thai-baht-pegged stablecoin (six decimals) whose mint authority is the treasury program-derived address (PDA), and provides the baht-denominated settlement primitive by which producer GRX is converted to peg-collateralised value. The program enforces a two-part peg invariant — attestation freshness and a supply ceiling derived from an off-chain reserve attestation — and operates a GRX yield-staking facility that distributes rewards through a MasterChef-style accumulator. Three segregated GRX vaults isolate redemption collateral, staker custody, and the reward pool; staked GRX never participates in peg collateralisation. The program holds no business logic in handlers beyond the necessary token-program cross-program invocations (CPIs) and the accounting updates that back each token movement.

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

**THBG stablecoin issuance.** THBG is a THB-pegged stablecoin with six decimals, so one whole baht equals 1,000,000 minor units (`state.rs:9-10`, constant `THBG_DECIMALS`). The THBG mint is created during initialisation with its mint authority set to the treasury PDA derived from the seed `[b"treasury"]` (`lib.rs:680-681`, `lib.rs:283`). No external account can mint THBG; issuance occurs solely through `swap_grx_for_thbg`, signed by the treasury PDA (`lib.rs:282-295`).

**Baht-denominated settlement accounting.** The program maintains a cumulative `total_settled_thbg` counter (`state.rs:37`) advanced by the trading program through the `record_settlement` CPI after a trade is paid in THBG (`lib.rs:182-202`). This counter is the on-chain record of total baht value settled; the operation moves no funds.

**GRX↔THBG swap and GRX yield staking.** The `swap_grx_for_thbg` and `redeem_thbg_for_grx` instructions implement bidirectional conversion between GRX and THBG (`lib.rs:229`, `lib.rs:313`). The staking facility (`stake_grx`, `unstake_grx`, `claim_rewards`, `fund_rewards`) lets GRX holders earn GRX-denominated yield (`lib.rs:389`, `lib.rs:437`, `lib.rs:485`, `lib.rs:535`).

### The three GRX vaults

All three vaults are SPL token accounts holding GRX, owned by the treasury PDA, each derived from a distinct seed (`lib.rs:687-720`):

| Vault | Seed | Role |
| --- | --- | --- |
| `swap_vault` | `[b"swap_vault"]` | Redemption collateral: receives GRX on swap, pays out GRX on redeem (`lib.rs:687-696`) |
| `stake_vault` | `[b"stake_vault"]` | Staker custody: holds staked principal; explicitly never backs the peg (`lib.rs:698-708`) |
| `reward_vault` | `[b"reward_vault"]` | Reward pool: GRX paid out as staking rewards (`lib.rs:710-720`) |

The segregation is structural: GRX deposited as swap collateral, GRX held in staking custody, and GRX held for rewards reside in separate PDAs that share no account and are never commingled.

---

## 3. State Model

### 3.1 `Treasury` (global configuration and accounting)

`Treasury` is a zero-copy account (`#[account(zero_copy)] #[repr(C)]`, `state.rs:17-18`) stored at a single PDA derived from `[b"treasury"]` (`lib.rs:666`). The layout is hand-padded for `bytemuck` Pod compatibility; the leading `u128` forces 16-byte struct alignment, and the field ordering is arranged so the total size is exactly 256 bytes, a multiple of 16, requiring no tail padding (`state.rs:13-16`, `state.rs:51`). Account space is `8 + std::mem::size_of::<Treasury>()` (`lib.rs:665`), where the leading 8 bytes are the Anchor discriminator.

| Field | Type | Bytes | Meaning |
| --- | --- | --- | --- |
| `acc_reward_per_share` | `u128` | 16 | Cumulative GRX reward per staked GRX, scaled by `ACC_PRECISION` (`state.rs:20-21`) |
| `authority` | `Pubkey` | 32 | Admin for `set_params` and pause (`state.rs:23`) |
| `attestor` | `Pubkey` | 32 | Off-chain custodian authorised to attest the THB reserve (`state.rs:24`) |
| `grx_mint` | `Pubkey` | 32 | GRX SPL mint (energy-token program) (`state.rs:25`) |
| `thbg_mint` | `Pubkey` | 32 | THBG stablecoin mint; authority is this PDA (`state.rs:26`) |
| `settlement_recorder` | `Pubkey` | 32 | PDA authorised to call `record_settlement` (trading `market_authority`) (`state.rs:27`) |
| `attested_reserve` | `u64` | 8 | Off-chain THB reserve in THBG minor units; the peg ceiling (`state.rs:29`) |
| `attestation_ts` | `i64` | 8 | Unix timestamp of the last reserve attestation (`state.rs:30`) |
| `attestation_ttl` | `i64` | 8 | Maximum attestation age in seconds before mints are blocked (`state.rs:31`) |
| `thbg_supply` | `u64` | 8 | THBG minted by the treasury; must stay ≤ `attested_reserve` (`state.rs:32`) |
| `grx_per_thbg_rate` | `u64` | 8 | THBG minor units issued per one whole GRX (settlement price) (`state.rs:33`) |
| `total_staked` | `u64` | 8 | GRX currently staked; never counted toward the peg (`state.rs:34`) |
| `reward_pool` | `u64` | 8 | GRX available to pay staking rewards (`state.rs:35`) |
| `created_at` | `i64` | 8 | Initialisation timestamp (`state.rs:36`) |
| `total_settled_thbg` | `u64` | 8 | Cumulative baht value settled via trading CPI (`state.rs:37`) |
| `swap_fee_bps` | `u16` | 2 | Fee on swap output, basis points (`state.rs:39`) |
| `paused` | `u8` | 1 | `1` = swaps and redeems halted (`state.rs:41`) |
| `bump` | `u8` | 1 | Treasury PDA bump; also the mint/transfer signer seed (`state.rs:42`) |
| `thbg_mint_bump` | `u8` | 1 | Stored canonical bump for the THBG mint PDA (`state.rs:47`) |
| `swap_vault_bump` | `u8` | 1 | Stored canonical bump for `swap_vault` (`state.rs:48`) |
| `stake_vault_bump` | `u8` | 1 | Stored canonical bump for `stake_vault` (`state.rs:49`) |
| `reward_vault_bump` | `u8` | 1 | Stored canonical bump for `reward_vault` (`state.rs:50`) |

Total size: 256 bytes (`state.rs:51`).

The mint and vault bumps are persisted deliberately. Account constraints validate the dependent PDAs with `bump = treasury.X_bump`, which uses `create_program_address` (a single hash, roughly 1 hash) rather than the bare `bump` form, which would trigger a `find_program_address` bump search costing approximately 12,000 compute units on the swap, stake, and redeem hot paths (`state.rs:43-46`).

### 3.2 `StakePosition` (per-user staking position)

`StakePosition` is a regular Borsh account (`#[account]`, `state.rs:56-63`), chosen because staking is not a hot path (`state.rs:54`). It is stored at a PDA derived from `[b"stake", owner]` (`state.rs:55`, `lib.rs:814`).

| Field | Type | Bytes | Meaning |
| --- | --- | --- | --- |
| `owner` | `Pubkey` | 32 | Staker (`state.rs:58`) |
| `amount` | `u64` | 8 | GRX staked by this user (`state.rs:59`) |
| `reward_debt` | `u128` | 16 | Bookkeeping baseline: `amount × acc / ACC_PRECISION` at last update (`state.rs:60`) |
| `pending` | `u64` | 8 | Accrued-but-unclaimed GRX rewards (`state.rs:61`) |
| `bump` | `u8` | 1 | PDA bump (`state.rs:62`) |

`StakePosition::LEN = 32 + 8 + 16 + 8 + 1 = 65` bytes, excluding the 8-byte Anchor discriminator (`state.rs:65-68`); allocated space is `8 + StakePosition::LEN` (`lib.rs:813`).

### 3.3 Constants

| Constant | Value | Purpose |
| --- | --- | --- |
| `ACC_PRECISION` | `1_000_000_000_000` (1e12) | Fixed-point precision for the reward accumulator (`state.rs:7`) |
| `THBG_DECIMALS` | `6` | THBG decimals (`state.rs:10`) |
| `GRX_ATOMS_PER_WHOLE` | `1_000_000_000` (1e9) | GRX atomic units per whole GRX; the swap divisor (`lib.rs:36`) |

---

## 4. Instruction Set

This section documents each instruction defined in the `#[program]` module (`lib.rs:114-654`). All instruction bodies are wrapped in `compute_fn!`, which is a real profiling macro under the `localnet` feature and a no-op otherwise (`lib.rs:17-30`).

### 4.1 `initialize`

Bootstraps the treasury (`lib.rs:120-155`).

- **Signers:** `authority` (also the rent payer) (`lib.rs:722-723`).
- **Accounts:** `treasury` (init, `[b"treasury"]`), `grx_mint`, `thbg_mint` (init, `[b"thbg_mint"]`, six decimals, authority = treasury), `swap_vault`, `stake_vault`, `reward_vault` (all init, authority = treasury), `token_program`, `system_program`, `rent` (`lib.rs:660-728`).
- **Parameters:** `attestor`, `settlement_recorder`, `grx_per_thbg_rate`, `swap_fee_bps`, `attestation_ttl` (`lib.rs:120-127`).
- **Effects:** writes all configuration fields via `load_init`, sets counters to zero, records `created_at`, and persists all PDA bumps (`lib.rs:130-152`). `attested_reserve`, `attestation_ts`, `thbg_supply`, `total_staked`, `reward_pool`, `total_settled_thbg`, and `acc_reward_per_share` all start at zero, and `paused` starts at `0` (`lib.rs:131-152`).
- **Events / errors:** none emitted.

### 4.2 `set_params`

Admin update of swap rate, fee, attestation TTL, pause flag, and settlement recorder (`lib.rs:159-175`).

- **Signers:** `authority` (`lib.rs:734`).
- **Preconditions:** `treasury.authority == authority.key()`, else `UnauthorizedAuthority` (`lib.rs:168`).
- **Effects:** overwrites `grx_per_thbg_rate`, `swap_fee_bps`, `attestation_ttl`, `paused`, and `settlement_recorder` (`lib.rs:169-173`).
- **Events / errors:** none emitted; `UnauthorizedAuthority` on failure.

### 4.3 `record_settlement`

Records a baht-denominated trade settlement; non-custodial (`lib.rs:182-202`).

- **Signers:** `recorder` (`lib.rs:921`).
- **Preconditions:** `treasury.settlement_recorder == recorder.key()`, else `UnauthorizedRecorder` (`lib.rs:186-189`).
- **Effects:** `total_settled_thbg += value` with checked addition (`lib.rs:190-193`).
- **Events:** `SettlementRecorded` (`lib.rs:194-199`).
- **Errors:** `UnauthorizedRecorder`, `MathOverflow`.

### 4.4 `update_attestation`

Custodian refresh of the off-chain THB reserve figure (`lib.rs:206-220`).

- **Signers:** `attestor` (`lib.rs:741`).
- **Preconditions:** `treasury.attestor == attestor.key()`, else `UnauthorizedAttestor` (`lib.rs:210`).
- **Effects:** sets `attested_reserve` to the supplied value and `attestation_ts` to the current clock time (`lib.rs:211-212`).
- **Events:** `ReserveAttested` (`lib.rs:213-217`).
- **Errors:** `UnauthorizedAttestor`.

### 4.5 `swap_grx_for_thbg`

The baht-denominated settlement primitive: converts GRX to THBG (`lib.rs:229-309`).

- **Signers:** `user` (`lib.rs:768`).
- **Accounts:** `treasury`, `grx_mint`, `thbg_mint`, `swap_vault`, `user_grx_ata`, `user_thbg_ata`, `token_program` (`lib.rs:744-770`). The treasury constraints assert `grx_mint` and `thbg_mint` match the stored mints (`lib.rs:750-751`).
- **Preconditions:** `grx_in > 0` (`ZeroAmount`); `paused == 0` (`Paused`); `grx_per_thbg_rate > 0` (`RateNotSet`); attestation freshness `now − attestation_ts ≤ attestation_ttl` (`StaleAttestation`); net output `> 0` (`ZeroAmount`); peg ceiling `thbg_supply + net ≤ attested_reserve` (`PegBreach`) (`lib.rs:231-257`).
- **Swap formula:** the gross THBG output is

  ```
  gross    = grx_in × grx_per_thbg_rate / 1e9      (1e9 = GRX_ATOMS_PER_WHOLE)
  fee      = gross × swap_fee_bps / 10_000
  thbg_out = gross − fee
  ```

  computed in `u128` to avoid intermediate overflow (`lib.rs:243-251`). The division by `GRX_ATOMS_PER_WHOLE` converts an atomic GRX amount through the rate expressed in THBG minor units per whole GRX.
- **Effects:** transfers `grx_in` GRX from `user_grx_ata` into `swap_vault` (authority = user) via `transfer_checked` (`lib.rs:268-279`); mints `thbg_out` THBG to `user_thbg_ata`, signed by the treasury PDA seeds `[b"treasury", bump]` (`lib.rs:282-295`); sets `thbg_supply = new_supply` (`lib.rs:297`).
- **Events:** `SwappedGrxForThbg` (`lib.rs:299-306`).
- **Errors:** `ZeroAmount`, `Paused`, `RateNotSet`, `StaleAttestation`, `PegBreach`, `MathOverflow`.

### 4.6 `redeem_thbg_for_grx`

Redeems THBG back into GRX from the swap vault (`lib.rs:313-385`).

- **Signers:** `user` (`lib.rs:796`).
- **Accounts:** same shape as the swap (`lib.rs:772-798`).
- **Preconditions:** `thbg_in > 0` (`ZeroAmount`); `paused == 0` (`Paused`); `grx_per_thbg_rate > 0` (`RateNotSet`); `thbg_in ≤ thbg_supply` (`SupplyUnderflow`); computed `grx_out > 0` (`ZeroAmount`); `grx_out ≤ swap_vault.amount` (`InsufficientVault`) (`lib.rs:315-339`).
- **Formula:** `grx_out = thbg_in × 1e9 / grx_per_thbg_rate`, the inverse of the swap rate (`lib.rs:326-329`).
- **Effects:** burns `thbg_in` THBG from `user_thbg_ata` (authority = user) (`lib.rs:348-357`); transfers `grx_out` GRX from `swap_vault` to `user_grx_ata`, signed by the treasury PDA (`lib.rs:359-372`); sets `thbg_supply = thbg_supply − thbg_in` (`lib.rs:341-344`, `lib.rs:374`).
- **Events:** `RedeemedThbgForGrx` (`lib.rs:376-382`).
- **Errors:** `ZeroAmount`, `Paused`, `RateNotSet`, `SupplyUnderflow`, `InsufficientVault`, `MathOverflow`.

### 4.7 `stake_grx`

Stakes GRX into the staking vault (`lib.rs:389-434`).

- **Signers:** `user` (`lib.rs:827`).
- **Accounts:** `treasury`, `position` (`init_if_needed`, `[b"stake", user]`), `grx_mint`, `stake_vault`, `user_grx_ata`, `token_program`, `system_program` (`lib.rs:800-830`).
- **Preconditions:** `amount > 0` (`ZeroAmount`); `total_staked + amount` must not overflow (`MathOverflow`) (`lib.rs:391`, `lib.rs:396`).
- **Effects:** if the existing position is non-zero, settles accrued reward into `pending` at the current accumulator before growing it (`lib.rs:401-405`); transfers `amount` GRX from the user into `stake_vault` (`lib.rs:407-417`); updates `position.owner`, `position.amount += amount`, recomputes `reward_debt`, and increments `total_staked` (`lib.rs:419-424`).
- **Events:** `Staked` (`lib.rs:426-431`).
- **Errors:** `ZeroAmount`, `MathOverflow`.

### 4.8 `unstake_grx`

Withdraws staked GRX principal (`lib.rs:437-482`).

- **Signers:** `user` (`lib.rs:861`).
- **Accounts:** `treasury`, `position` (`[b"stake", user]`, `has_one = owner`), `owner` (must equal `user.key()`), `grx_mint`, `stake_vault`, `user_grx_ata`, `token_program` (`lib.rs:832-863`).
- **Preconditions:** `amount > 0` (`ZeroAmount`); `amount ≤ position.amount` (`InsufficientStake`) (`lib.rs:439`, `lib.rs:448`).
- **Effects:** settles accrued reward into `pending`, decrements `position.amount`, recomputes `reward_debt` (`lib.rs:449-452`); transfers `amount` GRX from `stake_vault` to the user, signed by the treasury PDA (`lib.rs:454-466`); decrements `total_staked` via saturating subtraction (`lib.rs:468-472`).
- **Events:** `Unstaked` (`lib.rs:474-479`).
- **Errors:** `ZeroAmount`, `InsufficientStake`, `MathOverflow`.

### 4.9 `claim_rewards`

Claims accrued staking rewards, paid in GRX from the reward pool (`lib.rs:485-531`).

- **Signers:** `user` (`lib.rs:889`).
- **Accounts:** `treasury`, `position` (`[b"stake", user]`), `grx_mint`, `reward_vault`, `user_grx_ata`, `token_program` (`lib.rs:865-891`).
- **Preconditions:** payout `> 0` (`ZeroAmount`); `reward_pool ≥ payout` (`InsufficientRewardPool`) (`lib.rs:501`, `lib.rs:503-506`).
- **Effects:** computes `payout = pending + accrued_since(...)`, zeroes `pending`, rebases `reward_debt` (`lib.rs:493-500`); transfers `payout` GRX from `reward_vault` to the user, signed by the treasury PDA (`lib.rs:508-520`); decrements `reward_pool` (`lib.rs:522`).
- **Events:** `RewardsClaimed` (`lib.rs:524-528`).
- **Errors:** `ZeroAmount`, `InsufficientRewardPool`, `MathOverflow`.

### 4.10 `fund_rewards`

Deposits GRX into the reward pool, distributed pro-rata to current stakers (`lib.rs:535-573`).

- **Signers:** `funder` (`lib.rs:910`).
- **Accounts:** `treasury`, `grx_mint`, `reward_vault`, `funder_grx_ata`, `token_program` (`lib.rs:893-912`).
- **Preconditions:** `amount > 0` (`ZeroAmount`); `total_staked > 0` (`NoStakeToReward`) (`lib.rs:537`, `lib.rs:542`).
- **Effects:** transfers `amount` GRX from `funder_grx_ata` into `reward_vault` (`lib.rs:546-556`); advances the accumulator by `delta = amount × ACC_PRECISION / total_staked` and increments `reward_pool` (`lib.rs:558-564`).
- **Events:** `RewardsFunded` (`lib.rs:566-570`).
- **Errors:** `ZeroAmount`, `NoStakeToReward`, `MathOverflow`.

### 4.11 `slash_stake`

Slashes a staker's principal for misbehaviour and redistributes it to remaining stakers (`lib.rs:583-653`).

- **Signers:** `authority` (must equal `treasury.authority` via `has_one`, `lib.rs:930`).
- **Accounts:** `treasury`, `target_owner` (unchecked; identifies the slashed staker), `position` (`[b"stake", target_owner]`), `grx_mint`, `stake_vault`, `reward_vault`, `authority`, `token_program` (`lib.rs:924-954`).
- **Preconditions:** `amount > 0` (`ZeroAmount`); `position.amount > 0` (`InsufficientStake`) (`lib.rs:584`, `lib.rs:596`).
- **Effects:** settles the slashed staker's accrued reward into `pending` at the old accumulator, then removes `slashed = min(amount, position.amount)` from principal (`lib.rs:593-602`); advances the accumulator by `slashed × ACC_PRECISION / total_after` when stake remains, otherwise leaves it unchanged (`lib.rs:606-615`); rebases the slashed staker's `reward_debt` at the new accumulator so they do not share in their own slash (`lib.rs:617-621`); transfers `slashed` GRX from `stake_vault` to `reward_vault`, signed by the treasury PDA, and adds it to `reward_pool` (`lib.rs:623-642`).
- **Events:** `StakeSlashed` (`lib.rs:644-650`).
- **Errors:** `ZeroAmount`, `InsufficientStake`, `MathOverflow`.

### 4.12 Reward accumulator (MasterChef pattern)

Reward accounting follows the MasterChef accumulator pattern. The shared `acc_reward_per_share` (scaled by `ACC_PRECISION = 1e12`) tracks cumulative reward per staked GRX (`state.rs:7`, `state.rs:20-21`). Two helper functions implement the bookkeeping (`lib.rs:39-55`):

```
accrued_since(amount, acc, reward_debt) = amount × acc / ACC_PRECISION − reward_debt   (saturating at 0)
reward_debt_for(amount, acc)            = amount × acc / ACC_PRECISION
```

`fund_rewards` and the redistribution branch of `slash_stake` advance the accumulator by `delta = deposited × ACC_PRECISION / total_staked` (`lib.rs:558-561`, `lib.rs:608-611`). A staker's claimable reward is the difference between `amount × acc / ACC_PRECISION` and the `reward_debt` captured at the last position update, plus any settled `pending`. The unit tests verify exactness of the accumulator: a sole staker earns the full funded pot, equal stakers split evenly, and a late joiner earns nothing from a prior pot (`lib.rs:63-97`).

---

## 5. Invariants and Security Properties

### 5.1 Peg invariants (minting)

Two conditions, both enforced in `swap_grx_for_thbg`, govern THBG issuance:

1. **Attestation freshness.** A mint is permitted only when `now − attestation_ts ≤ attestation_ttl`; a stale attestation yields `StaleAttestation` (`lib.rs:238-241`). The attestation is the peg's source of truth and is refreshed solely by the custodian through `update_attestation` (`lib.rs:206-220`).
2. **Supply ceiling.** Outstanding `thbg_supply + minted` must never exceed `attested_reserve`; a breach yields `PegBreach` (`lib.rs:254-257`). Thus the total THBG in circulation can never exceed the attested off-chain THB reserve.

### 5.2 Redemption collateral guards

`redeem_thbg_for_grx` enforces two guards that keep the ledger and the vault consistent:

1. **Supply underflow.** Burning more THBG than the tracked supply would desynchronise the peg ledger, so `thbg_in ≤ thbg_supply` is required, yielding `SupplyUnderflow` otherwise (`lib.rs:323-324`; also enforced on the subtraction at `lib.rs:341-344`).
2. **Vault sufficiency.** The payout `grx_out` must not exceed the physical GRX held in `swap_vault.amount`, yielding `InsufficientVault` otherwise (`lib.rs:333-339`). This guard prevents a rate change via `set_params` from decoupling the payout from deposited collateral and draining other swappers' GRX.

### 5.3 Staked GRX never backs the peg

Staked principal is held in `stake_vault` (`lib.rs:698-708`), separate from `swap_vault`, which is the only redemption-collateral source (`lib.rs:686`, `lib.rs:363`). The `total_staked` field is documented as never counted toward the peg (`state.rs:34`), and the peg ceiling is computed solely against `thbg_supply` and `attested_reserve` (`lib.rs:254-257`). Consequently, the peg's solvency arithmetic is independent of staking activity.

### 5.4 Settlement recording authorisation

`record_settlement` advances `total_settled_thbg` only when the signing `recorder` equals the stored `settlement_recorder` (`lib.rs:186-189`), which is the trading `market_authority` PDA passed via `invoke_signed` from the trading program (`lib.rs:919-921`). The operation moves no funds and increments the counter by the **gross** settled value supplied by the caller (`lib.rs:190-193`). Because only the configured recorder can advance the counter, only genuine trading settlements can do so.

### 5.5 Two distinct GRX staking systems

The platform operates two separate GRX staking facilities that share lock/unlock/slash plumbing but are different products and must not be merged. The treasury staking here is **yield staking**: opt-in, reward-bearing (funded through `fund_rewards`), with custody in `stake_vault` and per-user accounting on `StakePosition`. The registry program's `stake_grx` is a **validator security bond**: no yield, gated by a minimum-validator-stake threshold, slashable for validator misbehaviour, with a separate vault. The two share no vault or position account and are not reconciled; a user may hold both. (See the repository `CLAUDE.md` "Treasury program" notes for the platform-level statement of this separation.)

### 5.6 Arithmetic safety

The release profile sets `overflow-checks = true` (`Cargo.toml:32-33`), because `cargo build-sbf` otherwise defaults to silent wrapping. Beyond this, the program prefers explicit `checked_*` and `saturating_*` operations throughout — for example `checked_mul`/`checked_add` in the accumulator helpers (`lib.rs:41-53`), the swap arithmetic (`lib.rs:243-256`), and the redemption supply subtraction (`lib.rs:341-344`); `saturating_sub` for attestation age (`lib.rs:239`) and `total_staked` decrement (`lib.rs:470`). Overflow conversions to `u64` map to `MathOverflow` (`lib.rs:45`, `lib.rs:261-263`).

---

## 6. Cross-Program Interfaces (CPI)

### 6.1 Trading → Treasury (`record_settlement`)

The trading program invokes `record_settlement` as a non-custodial CPI after settling a trade paid in THBG (`lib.rs:177-202`). The trading `market_authority` PDA is passed as the `recorder` signer through `invoke_signed` (`lib.rs:919-921`), matched against `treasury.settlement_recorder`. The treasury moves no funds; it only advances `total_settled_thbg` by the gross settled value (`lib.rs:190-193`). The `settlement_recorder` is configured at initialisation and may be updated through `set_params` (`lib.rs:136`, `lib.rs:173`).

### 6.2 Registry slash routing → Treasury reward vault

The registry program's validator-slashing path routes slashed validator bonds to a configured slash destination, which is pointed at the treasury `reward_vault`. This is a plain SPL token transfer into the reward vault, not a CPI into the treasury program. Once GRX has landed in `reward_vault`, it is redistributed pro-rata to treasury stakers by a subsequent `fund_rewards` call, which advances the accumulator (`lib.rs:535-573`). The treasury program itself takes no part in the registry's slashing decision; it simply receives the tokens. (The treasury program's own `slash_stake` instruction at `lib.rs:583-653` is a separate facility that slashes treasury yield-staking positions, not registry validator bonds.)

---

## 7. Events

All events are defined in `events.rs`.

| Event | Fields | Emitted by | Source |
| --- | --- | --- | --- |
| `ReserveAttested` | `attestor`, `attested_reserve`, `timestamp` | `update_attestation` | `events.rs:6-11`, emit `lib.rs:213` |
| `SwappedGrxForThbg` | `user`, `grx_in`, `thbg_out`, `fee`, `thbg_supply`, `timestamp` | `swap_grx_for_thbg` | `events.rs:14-22`, emit `lib.rs:299` |
| `RedeemedThbgForGrx` | `user`, `thbg_in`, `grx_out`, `thbg_supply`, `timestamp` | `redeem_thbg_for_grx` | `events.rs:25-32`, emit `lib.rs:376` |
| `Staked` | `user`, `amount`, `total_staked`, `timestamp` | `stake_grx` | `events.rs:34-40`, emit `lib.rs:426` |
| `Unstaked` | `user`, `amount`, `total_staked`, `timestamp` | `unstake_grx` | `events.rs:42-48`, emit `lib.rs:474` |
| `RewardsClaimed` | `user`, `amount`, `timestamp` | `claim_rewards` | `events.rs:50-55`, emit `lib.rs:524` |
| `RewardsFunded` | `funder`, `amount`, `timestamp` | `fund_rewards` | `events.rs:57-62`, emit `lib.rs:566` |
| `SettlementRecorded` | `recorder`, `value`, `total_settled_thbg`, `timestamp` | `record_settlement` | `events.rs:64-71`, emit `lib.rs:194` |
| `StakeSlashed` | `authority`, `owner`, `slashed_amount`, `total_staked`, `timestamp` | `slash_stake` | `events.rs:73-81`, emit `lib.rs:644` |

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
| `StaleAttestation` | Reserve attestation is stale — refresh before minting THBG | `error.rs:19-20` |
| `PegBreach` | Mint would breach the peg: outstanding THBG must not exceed attested THB reserve | `error.rs:21-22` |
| `RateNotSet` | Swap/redeem rate is not configured | `error.rs:23-24` |
| `InsufficientStake` | Insufficient staked balance | `error.rs:25-26` |
| `InsufficientRewardPool` | Insufficient reward pool to pay the claim | `error.rs:27-28` |
| `InsufficientVault` | Swap vault has insufficient GRX collateral to satisfy the redemption | `error.rs:29-30` |
| `SupplyUnderflow` | Redeem amount exceeds outstanding THBG supply | `error.rs:31-32` |
| `NoStakeToReward` | No stake to fund rewards against | `error.rs:33-34` |

---

## 9. Testing

The treasury program is exercised by an integration suite and an initialisation script.

- **Integration tests:** `tests/treasury.ts`, run with `npm run test:treasury`, which resolves to `anchor test tests/treasury.ts` (`package.json:22`).
- **Initialisation script:** `scripts/init-treasury.ts` bootstraps the treasury, configures the `settlement_recorder` to the trading `market_authority` PDA, wires the trading-program THBG settlement policy, and points the registry slash destination at the treasury `reward_vault`.
- **In-source unit tests:** the `#[cfg(test)] mod tests` block validates the reward accumulator and the swap formula in pure arithmetic (`lib.rs:57-112`).
