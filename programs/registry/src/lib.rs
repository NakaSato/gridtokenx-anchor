#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

// Core modules
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

pub use error::RegistryError;
pub use events::*;
// Handler fns share names with the #[program]-generated re-exports; the glob is
// deliberate (Context structs + client accounts must be crate-public).
#[allow(ambiguous_glob_reexports)]
pub use instructions::*;
pub use state::*;

declare_id!("FcSd5x4X1nzJMKLZC4tMZXnQ1ipLrGsEfeoH8N4mvJX7");

/// Governance program ID — owner of the PoA aggregator allow-list (`AggregatorEntry` PDA).
/// Hardcoded rather than imported: `governance` already depends on `registry` for CPI, so
/// adding `registry -> governance` as a path dep would be a cycle. Validate the allow-list
/// entry by raw account checks (owner + PDA seeds + bytes) instead. Must match
/// `Anchor.toml [programs.localnet].governance`.
pub const GOVERNANCE_PROGRAM_ID: Pubkey = pubkey!("FokVuBSPXP11aeL7VZWd8n8aVAhWqVpyPZETToSxdvTS");

/// Oracle program ID — owner of the per-meter `MeterState` PDA. Hardcoded rather than
/// imported: `oracle` depends on `governance`, which depends on `registry` for CPI, so
/// `registry -> oracle` as a path dep would cycle through governance. Validate the oracle
/// meter record by raw account checks (owner + PDA seeds + bytes) instead, same pattern as
/// `GOVERNANCE_PROGRAM_ID` above. Must match `Anchor.toml [programs.localnet].oracle`.
pub const ORACLE_PROGRAM_ID: Pubkey = pubkey!("64Vgos61STZ8pW9NnHi2iGtXMTQr7NqBoMorK6Zg8RJU");

/// Airdrop amount for new users (in smallest token units, 9 decimals = 10 GRX)
pub const AIRDROP_AMOUNT: u64 = 10_000_000_000; // 10 GRX tokens

/// Minimum GRX stake (smallest units) required to hold an Active validator slot.
/// Falling below this on unstake/slash demotes the validator.
pub const MIN_VALIDATOR_STAKE: u64 = 10_000_000_000_000; // 10,000 GRX

/// Cooldown after the most recent `stake_grx` before tokens can be unstaked.
pub const UNSTAKE_COOLDOWN_SECS: i64 = 24 * 60 * 60; // 24h

/// Challenge/slashable window after a validator calls `deregister_validator`. The bond stays
/// locked (and the validator stays slashable) for this long, so an honest exit cannot be used
/// to dodge a pending slash. Only after it elapses may the bond be unstaked below MIN.
pub const RESIGN_COOLDOWN_SECS: i64 = 24 * 60 * 60; // 24h

// compute_fn! / compute_checkpoint! — real macros under `localnet`, no-ops otherwise.
#[cfg(feature = "localnet")]
use compute_debug::{compute_checkpoint, compute_fn};

// No-op versions for non-localnet builds. `#[macro_export]` hoists them to the crate
// root so the `instructions/` submodules can `use crate::{compute_fn, compute_checkpoint}`.
#[cfg(not(feature = "localnet"))]
#[macro_export]
macro_rules! compute_fn {
    ($name:expr => $block:block) => {
        $block
    };
}
#[cfg(not(feature = "localnet"))]
#[macro_export]
macro_rules! compute_checkpoint {
    ($name:expr) => {};
}

/// Helper to convert fixed [u8; 32] to String (trimming nulls)
pub(crate) fn bytes32_to_string(bytes: &[u8; 32]) -> String {
    let mut len = 0;
    while len < 32 && bytes[len] != 0 {
        len += 1;
    }
    String::from_utf8_lossy(&bytes[..len]).to_string()
}

/// Canonical shard selector — binds an entity to one of the 16 shards by its
/// first key byte. Matches the SKILL invariant `authority.to_bytes()[0] % num_shards`.
pub(crate) fn shard_for(key: &Pubkey) -> u8 {
    key.to_bytes()[0] % 16
}

/// Helper to convert String to fixed [u8; 32]
pub(crate) fn string_to_bytes32(s: &str) -> [u8; 32] {
    let mut bytes = [0u8; 32];
    let bytes_source = s.as_bytes();
    let len = bytes_source.len().min(32);
    bytes[..len].copy_from_slice(&bytes_source[..len]);
    bytes
}

#[program]
pub mod registry {
    use super::*;

    /// Initialize the registry with REC authority
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        compute_fn!("initialize" => { instructions::initialize(ctx) })
    }

    /// Initialize a registry shard for distributed counting
    pub fn initialize_shard(ctx: Context<InitializeShard>, shard_id: u8) -> Result<()> {
        compute_fn!("initialize_shard" => { instructions::initialize_shard(ctx, shard_id) })
    }

    /// Set the oracle authority (admin only)
    pub fn set_oracle_authority(ctx: Context<SetOracleAuthority>, oracle: Pubkey) -> Result<()> {
        compute_fn!("set_oracle_authority" => { instructions::set_oracle_authority(ctx, oracle) })
    }

    /// Set the allowed destination for slashed validator bonds (admin only).
    /// `slash_validator` will refuse to send the bond anywhere else, so a slash
    /// cannot be misrouted (point this at the treasury `reward_vault`).
    pub fn set_slash_destination(ctx: Context<SetSlashDestination>, destination: Pubkey) -> Result<()> {
        compute_fn!("set_slash_destination" => { instructions::set_slash_destination(ctx, destination) })
    }

    /// Update the registry authority (admin only)
    pub fn update_authority(ctx: Context<UpdateAuthority>, new_authority: Pubkey) -> Result<()> {
        compute_fn!("update_authority" => { instructions::update_authority(ctx, new_authority) })
    }

    /// Aggregate counts from all shards into the global registry (admin only)
    pub fn aggregate_shards(ctx: Context<AggregateShards>) -> Result<()> {
        compute_fn!("aggregate_shards" => { instructions::aggregate_shards(ctx) })
    }

    /// Register a new user in the P2P energy trading system
    /// Also automatically distributes airdrop amount of GRID tokens to the user
    pub fn register_user(
        ctx: Context<RegisterUser>,
        user_type: UserType,
        lat_e7: i32,
        long_e7: i32,
        h3_index: u64,
        shard_id: u8,
    ) -> Result<()> {
        compute_fn!("register_user" => {
            instructions::register_user(ctx, user_type, lat_e7, long_e7, h3_index, shard_id)
        })
    }

    /// Mint the one-time welcome airdrop to an already-registered user.
    ///
    /// Decoupled from `register_user` on purpose: a failed mint CPI aborts its whole
    /// transaction, so bundling it with registration would let a mint failure roll back
    /// the user's registration. Here the mint and the `airdrop_claimed` flag commit (or
    /// roll back) together, leaving the claim safely retryable without touching the user
    /// record created by `register_user`.
    pub fn claim_airdrop(ctx: Context<ClaimAirdrop>) -> Result<()> {
        compute_fn!("claim_airdrop" => { instructions::claim_airdrop(ctx) })
    }

    /// Register a smart meter for an existing user
    pub fn register_meter(
        ctx: Context<RegisterMeter>,
        meter_id: String,
        meter_type: MeterType,
        shard_id: u8,
        zone_id: i32,
    ) -> Result<()> {
        compute_fn!("register_meter" => {
            instructions::register_meter(ctx, meter_id, meter_type, shard_id, zone_id)
        })
    }

    /// Update user status (admin only)
    pub fn update_user_status(
        ctx: Context<UpdateUserStatus>,
        new_status: UserStatus,
    ) -> Result<()> {
        compute_fn!("update_user_status" => { instructions::update_user_status(ctx, new_status) })
    }

    /// Update meter reading (for oracles and authorized services)
    /// Now requires oracle authorization via registry
    pub fn update_meter_reading(
        ctx: Context<UpdateMeterReading>,
        energy_generated: u64,
        energy_consumed: u64,
        reading_timestamp: i64,
    ) -> Result<()> {
        compute_fn!("update_meter_reading" => {
            instructions::update_meter_reading(ctx, energy_generated, energy_consumed, reading_timestamp)
        })
    }

    /// Set meter status (owner or authority)
    pub fn set_meter_status(ctx: Context<SetMeterStatus>, new_status: MeterStatus) -> Result<()> {
        compute_fn!("set_meter_status" => { instructions::set_meter_status(ctx, new_status) })
    }

    /// Deactivate a meter permanently (owner only)
    pub fn deactivate_meter(ctx: Context<DeactivateMeter>) -> Result<()> {
        compute_fn!("deactivate_meter" => { instructions::deactivate_meter(ctx) })
    }

    /// Verify if a user is valid and active
    pub fn is_valid_user(ctx: Context<IsValidUser>) -> Result<bool> {
        let res = compute_fn!("is_valid_user" => { instructions::is_valid_user(ctx) })?;
        Ok(res)
    }

    /// Verify if a meter is valid and active
    pub fn is_valid_meter(ctx: Context<IsValidMeter>) -> Result<bool> {
        let res = compute_fn!("is_valid_meter" => { instructions::is_valid_meter(ctx) })?;
        Ok(res)
    }

    /// Calculate unsettled net generation ready for tokenization
    /// This is a view function that returns how much energy can be minted as GRID tokens
    pub fn get_unsettled_balance(ctx: Context<GetUnsettledBalance>) -> Result<u64> {
        let res = compute_fn!("get_unsettled_balance" => { instructions::get_unsettled_balance(ctx) })?;
        Ok(res)
    }

    /// Settle meter balance and prepare for GRID token minting
    /// This updates the settled_net_generation tracker to prevent double-minting
    /// The actual token minting should be called by the energy_token program
    pub fn settle_meter_balance(ctx: Context<SettleMeterBalance>) -> Result<u64> {
        let res = compute_fn!("settle_meter_balance" => { instructions::settle_meter_balance(ctx) })?;
        Ok(res)
    }

    /// Settle meter balance and automatically mint GRID tokens via CPI
    /// This is a convenience function that combines settlement + minting in one transaction
    pub fn settle_and_mint_tokens(ctx: Context<SettleAndMintTokens>) -> Result<()> {
        compute_fn!("settle_and_mint_tokens" => { instructions::settle_and_mint_tokens(ctx) })
    }

    /// Mark energy as claimed for ERC issuance (authorized by governance/oracle)
    pub fn mark_erc_claimed(ctx: Context<MarkErcClaimed>, amount: u64) -> Result<()> {
        compute_fn!("mark_erc_claimed" => { instructions::mark_erc_claimed(ctx, amount) })
    }

    /// Initialize the staking vault for GRX tokens (admin only)
    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        instructions::initialize_vault(ctx)
    }

    /// Stake GRX tokens to participate in the network
    pub fn stake_grx(ctx: Context<StakeGrx>, amount: u64) -> Result<()> {
        compute_fn!("stake_grx" => { instructions::stake_grx(ctx, amount) })
    }

    /// Register as a validator (requires at least 10,000 GRX staked)
    pub fn register_validator(ctx: Context<RegisterValidator>) -> Result<()> {
        compute_fn!("register_validator" => { instructions::register_validator(ctx) })
    }

    /// Announce an honest validator exit. Flips an Active validator to `Resigning` and stamps
    /// `resign_at`. The bond stays locked and the validator stays slashable for
    /// `RESIGN_COOLDOWN_SECS` (see `unstake_grx` + `compute_slash_amount`); only after the
    /// window may the bond be unstaked below `MIN_VALIDATOR_STAKE`. Re-calling
    /// `register_validator` before unstaking cancels the resignation.
    pub fn deregister_validator(ctx: Context<DeregisterValidator>) -> Result<()> {
        compute_fn!("deregister_validator" => { instructions::deregister_validator(ctx) })
    }

    /// Withdraw previously staked GRX back to the user's ATA.
    ///
    /// Enforces a cooldown since the last `stake_grx`, decrements the stake, and
    /// demotes an Active validator to Suspended if the remaining stake drops below
    /// `MIN_VALIDATOR_STAKE`. The registry PDA signs the vault → user transfer.
    pub fn unstake_grx(ctx: Context<UnstakeGrx>, amount: u64) -> Result<()> {
        compute_fn!("unstake_grx" => { instructions::unstake_grx(ctx, amount) })
    }

    /// Slash a validator's bond for proven misbehaviour (PoA authority only).
    ///
    /// The slashed GRX moves out of the registry vault to `slash_destination` — point it at
    /// the treasury `reward_vault` so honest stakers receive it (call `treasury::fund_rewards`
    /// afterwards), per the node design's "redistributed to honest stakers" rule.
    ///
    /// The target validator is identified by `target_authority`; its `UserAccount` PDA is
    /// passed mutably. The slashed amount is capped at the validator's staked balance.
    /// Slash a validator's GRX bond by a severity fraction, compensating proven
    /// victims (capped at their on-chain-provable loss) and routing the remainder to
    /// the transparent fund (`slash_destination`, e.g. treasury `reward_vault`).
    ///
    /// `slash_bps` — severity in basis points (1..=10000); `slash_amount = bond * bps / 10000`.
    /// `proven_loss` — total provable victim loss (governance-attested). Compensation is
    /// `min(slash_amount, proven_loss)`, paid to `victim_token_account`; the rest is the
    /// fund remainder. Value-accounting invariant: `slash_amount == compensation + fund`.
    ///
    /// Status: full forfeiture (bps == 10000 or bond fully consumed) → terminal `Slashed`;
    /// a partial slash that drops the remaining bond below `MIN_VALIDATOR_STAKE` → `Suspended`
    /// (recoverable by topping up + re-`register_validator`); otherwise stays `Active`.
    pub fn slash_validator(
        ctx: Context<SlashValidator>,
        slash_bps: u16,
        proven_loss: u64,
    ) -> Result<()> {
        compute_fn!("slash_validator" => { instructions::slash_validator(ctx, slash_bps, proven_loss) })
    }

    /// Multi-victim variant of `slash_validator` (T1.3): slash an Active validator's
    /// bond by `slash_bps` and distribute the capped compensation **pro-rata across
    /// several harmed parties** by their proven loss, routing the remainder to the
    /// configured fund. The single-victim `slash_validator` above is unchanged.
    ///
    /// Victim token accounts are passed as `remaining_accounts` (all GRX, all `mut`),
    /// in the same order as `victim_losses` (the per-victim governance-attested loss).
    /// Let `total_loss = Σ victim_losses` and `pool = min(slash_amount, total_loss)`;
    /// victim `i` receives `pool * victim_losses[i] / total_loss` (integer division —
    /// rounding dust falls to the fund). The fund receives `slash_amount − Σ paid`.
    /// Value invariant: `slash_amount == Σ paid + fund_amount`.
    pub fn slash_validator_multi<'info>(
        ctx: Context<'info, SlashValidatorMulti<'info>>,
        slash_bps: u16,
        victim_losses: Vec<u64>,
    ) -> Result<()> {
        compute_fn!("slash_validator_multi" => {
            instructions::slash_validator_multi(ctx, slash_bps, victim_losses)
        })
    }

    /// Initialize the transparent slash fund (T1.4): a registry-owned GRX vault
    /// `[b"slash_fund"]` that holds slashed remainders, plus a `SlashFundLedger`
    /// PDA `[b"slash_fund_ledger"]` publishing disbursement accounting. Point
    /// `slash_destination` at this vault (via `set_slash_destination`) so the
    /// slash fund remainder routes here automatically — inflows are then the
    /// vault's GRX balance, outflows are tracked precisely in the ledger.
    pub fn initialize_slash_fund(ctx: Context<InitializeSlashFund>) -> Result<()> {
        compute_fn!("initialize_slash_fund" => { instructions::initialize_slash_fund(ctx) })
    }

    /// Disburse GRX out of the slash fund (e.g. to the treasury `reward_vault` for
    /// redistribution via `fund_rewards`). PoA-gated; bounded by the vault balance;
    /// updates the published `SlashFundLedger` and emits `SlashFundDisbursed`.
    pub fn disburse_slash_fund(ctx: Context<DisburseSlashFund>, amount: u64) -> Result<()> {
        compute_fn!("disburse_slash_fund" => { instructions::disburse_slash_fund(ctx, amount) })
    }
}

// Internal helpers
pub(crate) fn do_settle_meter(meter: &mut MeterAccount, owner_key: Pubkey) -> Result<u64> {
    require!(
        meter.status == MeterStatus::Active,
        RegistryError::InvalidMeterStatus
    );

    require_keys_eq!(
        owner_key,
        meter.owner,
        RegistryError::UnauthorizedUser
    );

    let current_net_gen = meter
        .total_generation
        .saturating_sub(meter.total_consumption);

    // FIX: Subtract claimed_erc_generation to prevent double-claiming
    // Total claims (GRX + ERC) cannot exceed total generation.
    let new_tokens_to_mint = current_net_gen
        .saturating_sub(meter.settled_net_generation)
        .saturating_sub(meter.claimed_erc_generation);

    require!(new_tokens_to_mint > 0, RegistryError::NoUnsettledBalance);

    meter.settled_net_generation = meter.settled_net_generation.saturating_add(new_tokens_to_mint);

    emit!(MeterBalanceSettled {
        meter_id: bytes32_to_string(&meter.meter_id),
        owner: meter.owner,
        tokens_to_mint: new_tokens_to_mint,
        total_settled: meter.settled_net_generation,
    });

    Ok(new_tokens_to_mint)
}

/// PoA slash gate — shared by `slash_validator` and `slash_validator_multi`. Verifies
/// the caller is the registry authority and that the passed destination is the single
/// configured `slash_destination`, so the slash remainder can never be misrouted.
pub(crate) fn poa_slash_gate(registry: &Registry, authority: Pubkey, slash_destination: Pubkey) -> Result<()> {
    require_keys_eq!(authority, registry.authority, RegistryError::UnauthorizedAuthority);
    require!(
        registry.has_slash_destination == 1,
        RegistryError::SlashDestinationNotSet
    );
    require_keys_eq!(
        slash_destination,
        registry.slash_destination,
        RegistryError::InvalidSlashDestination
    );
    Ok(())
}

/// `slash_amount = bond * slash_bps / 10_000`, capped at the bond. Validates the
/// target is an Active validator with a positive bond. Shared by both slash paths.
pub(crate) fn compute_slash_amount(user: &UserAccount, slash_bps: u16) -> Result<u64> {
    // Only an Active or Resigning validator can be slashed — never a plain staker, an
    // already-slashed account, or a Suspended one. Including Resigning is what keeps the
    // honest-exit path from being a slash dodge: the bond stays slashable for the whole
    // resign cooldown (matching the unstake lock in `unstake_grx`).
    require!(
        matches!(
            user.validator_status,
            ValidatorStatus::Active | ValidatorStatus::Resigning
        ),
        RegistryError::NotActiveValidator
    );
    require!(user.staked_grx > 0, RegistryError::InsufficientStakingBalance);
    let bond = user.staked_grx;
    let amt = ((bond as u128)
        .checked_mul(slash_bps as u128)
        .ok_or(RegistryError::MathOverflow)?
        / 10_000u128) as u64;
    Ok(amt.min(bond))
}

/// Validator-bond unstake guard (pure, extracted for unit-testing). Enforces, in order:
/// sufficient balance (InsufficientStakingBalance), the post-stake cooldown
/// (UnstakingLocked), and the anti-slash-escape bond lock (ValidatorStakeLocked) — an
/// Active validator (always), or a Resigning one still within its resign cooldown, cannot
/// draw the bond below MIN_VALIDATOR_STAKE; excess above the floor is always withdrawable,
/// and Suspended/Slashed/None accounts are unlocked.
pub(crate) fn check_unstake_allowed(
    amount: u64,
    staked: u64,
    last_stake_at: i64,
    resign_at: i64,
    now: i64,
    validator_status: ValidatorStatus,
) -> Result<()> {
    require!(amount <= staked, RegistryError::InsufficientStakingBalance);
    require!(
        now.saturating_sub(last_stake_at) >= UNSTAKE_COOLDOWN_SECS,
        RegistryError::UnstakingLocked
    );
    let bond_locked = match validator_status {
        ValidatorStatus::Active => true,
        ValidatorStatus::Resigning => now.saturating_sub(resign_at) < RESIGN_COOLDOWN_SECS,
        _ => false,
    };
    require!(
        !(bond_locked && staked.saturating_sub(amount) < MIN_VALIDATOR_STAKE),
        RegistryError::ValidatorStakeLocked
    );
    Ok(())
}

/// Post-slash validator status transition (shared): full forfeiture (bps == 10000 or
/// nothing left) → terminal `Slashed`; below the bond floor → `Suspended`; else Active.
pub(crate) fn apply_slash_status(user: &mut UserAccount, slash_bps: u16, remaining: u64) {
    if slash_bps == 10_000 || remaining == 0 {
        // Full forfeiture is terminal — barred from re-registration.
        user.validator_status = ValidatorStatus::Slashed;
    } else if remaining < MIN_VALIDATOR_STAKE {
        // Partial slash below the bond floor: suspend until topped up.
        user.validator_status = ValidatorStatus::Suspended;
    } // else: remains Active.
}

#[cfg(test)]
mod slash_math_tests {
    use super::*;

    fn err_code(e: anchor_lang::error::Error) -> u32 {
        match e {
            anchor_lang::error::Error::AnchorError(ae) => ae.error_code_number,
            other => panic!("expected AnchorError, got {other:?}"),
        }
    }
    fn code_of(v: RegistryError) -> u32 { err_code(v.into()) }

    // UserAccount is zero_copy/Pod — a host struct literal builds it directly.
    fn ua(status: ValidatorStatus, staked: u64) -> UserAccount {
        UserAccount {
            authority: Pubkey::default(),
            user_type: UserType::Prosumer,
            _padding1: [0; 3],
            lat_e7: 0,
            long_e7: 0,
            _padding2: [0; 4],
            h3_index: 0,
            status: UserStatus::Active,
            validator_status: status,
            shard_id: 0,
            airdrop_claimed: 0,
            _padding3: [0; 4],
            registered_at: 0,
            meter_count: 0,
            _padding4: [0; 4],
            staked_grx: staked,
            last_stake_at: 0,
            resign_at: 0,
        }
    }

    // --- compute_slash_amount ---

    #[test]
    fn slashes_a_fraction_of_the_bond() {
        // 50% of a 1_000_000 bond = 500_000.
        let amt = compute_slash_amount(&ua(ValidatorStatus::Active, 1_000_000), 5_000).unwrap();
        assert_eq!(amt, 500_000);
    }

    #[test]
    fn full_slash_equals_the_bond() {
        let amt = compute_slash_amount(&ua(ValidatorStatus::Active, 1_000_000), 10_000).unwrap();
        assert_eq!(amt, 1_000_000);
    }

    #[test]
    fn slash_amount_is_capped_at_the_bond() {
        // bps > 10000 would compute > bond; .min(bond) caps it.
        let amt = compute_slash_amount(&ua(ValidatorStatus::Active, 1_000_000), u16::MAX).unwrap();
        assert_eq!(amt, 1_000_000);
    }

    #[test]
    fn resigning_validator_is_still_slashable() {
        // Honest-exit (Resigning) stays slashable through the cooldown — not a slash dodge.
        let amt = compute_slash_amount(&ua(ValidatorStatus::Resigning, 1_000_000), 5_000).unwrap();
        assert_eq!(amt, 500_000);
    }

    #[test]
    fn rejects_slashing_a_non_active_validator() {
        for s in [ValidatorStatus::None, ValidatorStatus::Slashed, ValidatorStatus::Suspended] {
            let e = compute_slash_amount(&ua(s, 1_000_000), 5_000).unwrap_err();
            assert_eq!(err_code(e), code_of(RegistryError::NotActiveValidator));
        }
    }

    #[test]
    fn rejects_slashing_a_zero_bond() {
        let e = compute_slash_amount(&ua(ValidatorStatus::Active, 0), 5_000).unwrap_err();
        assert_eq!(err_code(e), code_of(RegistryError::InsufficientStakingBalance));
    }

    // --- apply_slash_status ---

    #[test]
    fn full_forfeiture_is_terminal_slashed() {
        let mut u = ua(ValidatorStatus::Active, 0);
        apply_slash_status(&mut u, 10_000, 500); // bps==10000 -> Slashed even if remaining>0
        assert!(matches!(u.validator_status, ValidatorStatus::Slashed));
    }

    #[test]
    fn zero_remaining_is_terminal_slashed() {
        let mut u = ua(ValidatorStatus::Active, 0);
        apply_slash_status(&mut u, 5_000, 0); // remaining==0 -> Slashed
        assert!(matches!(u.validator_status, ValidatorStatus::Slashed));
    }

    #[test]
    fn below_bond_floor_is_suspended() {
        let mut u = ua(ValidatorStatus::Active, 0);
        apply_slash_status(&mut u, 5_000, MIN_VALIDATOR_STAKE - 1); // partial, under floor
        assert!(matches!(u.validator_status, ValidatorStatus::Suspended));
    }

    #[test]
    fn at_or_above_floor_stays_active() {
        let mut u = ua(ValidatorStatus::Active, 0);
        apply_slash_status(&mut u, 5_000, MIN_VALIDATOR_STAKE); // partial, still bonded
        assert!(matches!(u.validator_status, ValidatorStatus::Active));
    }

    // --- check_unstake_allowed (validator-bond unstake guard) ---

    const NOW: i64 = 10_000_000; // well past any cooldown when last_stake_at = 0

    #[test]
    fn unstake_rejects_more_than_staked() {
        let e = check_unstake_allowed(11, 10, 0, 0, NOW, ValidatorStatus::Suspended).unwrap_err();
        assert_eq!(err_code(e), code_of(RegistryError::InsufficientStakingBalance));
    }

    #[test]
    fn unstake_rejects_within_cooldown() {
        // last_stake_at 100s ago < 24h cooldown. Suspended isolates the cooldown check.
        let e = check_unstake_allowed(1, 1_000, NOW - 100, 0, NOW, ValidatorStatus::Suspended)
            .unwrap_err();
        assert_eq!(err_code(e), code_of(RegistryError::UnstakingLocked));
    }

    #[test]
    fn unstake_cooldown_boundary_is_inclusive() {
        // exactly UNSTAKE_COOLDOWN_SECS elapsed → allowed (>=).
        assert!(check_unstake_allowed(
            1, 1_000, NOW - UNSTAKE_COOLDOWN_SECS, 0, NOW, ValidatorStatus::Suspended
        ).is_ok());
    }

    #[test]
    fn unstake_active_below_floor_is_locked() {
        // Active bond can never drop below MIN_VALIDATOR_STAKE.
        let e = check_unstake_allowed(
            10, MIN_VALIDATOR_STAKE + 5, 0, 0, NOW, ValidatorStatus::Active
        ).unwrap_err();
        assert_eq!(err_code(e), code_of(RegistryError::ValidatorStakeLocked));
    }

    #[test]
    fn unstake_active_excess_above_floor_is_allowed() {
        // Withdraw excess while staying bonded.
        assert!(check_unstake_allowed(
            50, MIN_VALIDATOR_STAKE + 100, 0, 0, NOW, ValidatorStatus::Active
        ).is_ok());
    }

    #[test]
    fn unstake_resigning_within_cooldown_below_floor_is_locked() {
        // Still slashable during the resign window → bond stays locked below the floor.
        let e = check_unstake_allowed(
            10, MIN_VALIDATOR_STAKE, 0, NOW - 100, NOW, ValidatorStatus::Resigning
        ).unwrap_err();
        assert_eq!(err_code(e), code_of(RegistryError::ValidatorStakeLocked));
    }

    #[test]
    fn unstake_resigning_after_cooldown_unlocks_full_exit() {
        // Resign cooldown elapsed → honest exit may draw the whole bond below the floor.
        assert!(check_unstake_allowed(
            MIN_VALIDATOR_STAKE, MIN_VALIDATOR_STAKE, 0, NOW - RESIGN_COOLDOWN_SECS, NOW,
            ValidatorStatus::Resigning
        ).is_ok());
    }

    #[test]
    fn unstake_suspended_below_floor_is_allowed() {
        // Suspended/Slashed/None are not slashable → bond unlocked.
        assert!(check_unstake_allowed(
            MIN_VALIDATOR_STAKE, MIN_VALIDATOR_STAKE, 0, 0, NOW, ValidatorStatus::Suspended
        ).is_ok());
    }
}
