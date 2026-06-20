use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface};

// Core modules
pub mod error;
pub mod events;
pub mod state;

pub use error::RegistryError;
pub use events::*;
pub use state::*;

declare_id!("FcSd5x4X1nzJMKLZC4tMZXnQ1ipLrGsEfeoH8N4mvJX7");

/// Airdrop amount for new users (in smallest token units, 9 decimals = 10 GRX)
pub const AIRDROP_AMOUNT: u64 = 10_000_000_000; // 10 GRX tokens

/// Minimum GRX stake (smallest units) required to hold an Active validator slot.
/// Falling below this on unstake/slash demotes the validator.
pub const MIN_VALIDATOR_STAKE: u64 = 10_000_000_000_000; // 10,000 GRX

/// Cooldown after the most recent `stake_grx` before tokens can be unstaked.
pub const UNSTAKE_COOLDOWN_SECS: i64 = 24 * 60 * 60; // 24h

#[cfg(feature = "localnet")]
use compute_debug::{compute_checkpoint, compute_fn};

#[cfg(not(feature = "localnet"))]
macro_rules! compute_fn {
    ($name:expr => $block:block) => {
        $block
    };
}
#[cfg(not(feature = "localnet"))]
#[allow(unused_macros)]
macro_rules! compute_checkpoint {
    ($name:expr) => {};
}

/// Helper to convert fixed [u8; 32] to String (trimming nulls)
fn bytes32_to_string(bytes: &[u8; 32]) -> String {
    let mut len = 0;
    while len < 32 && bytes[len] != 0 {
        len += 1;
    }
    String::from_utf8_lossy(&bytes[..len]).to_string()
}

/// Canonical shard selector — binds an entity to one of the 16 shards by its
/// first key byte. Matches the SKILL invariant `authority.to_bytes()[0] % num_shards`.
fn shard_for(key: &Pubkey) -> u8 {
    key.to_bytes()[0] % 16
}

/// Helper to convert String to fixed [u8; 32]
fn string_to_bytes32(s: &str) -> [u8; 32] {
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
        compute_fn!("initialize" => {
            let mut registry = ctx.accounts.registry.load_init()?;
            registry.authority = ctx.accounts.authority.key();
            registry.has_oracle_authority = 0;
            registry.has_slash_destination = 0;
            registry.user_count = 0;
            registry.meter_count = 0;
            registry.active_meter_count = 0;

            emit!(RegistryInitialized {
                authority: ctx.accounts.authority.key(),
            });
        });
        Ok(())
    }

    /// Initialize a registry shard for distributed counting
    pub fn initialize_shard(ctx: Context<InitializeShard>, shard_id: u8) -> Result<()> {
        require!(shard_id < 16, RegistryError::InvalidShardId);
        compute_fn!("initialize_shard" => {
            let mut shard = ctx.accounts.shard.load_init()?;
            shard.shard_id = shard_id;
            shard.bump = ctx.bumps.shard; // cache canonical bump for cheap PDA checks later
            shard.user_count = 0;
            shard.meter_count = 0;
            shard.active_meter_count = 0;
        });
        Ok(())
    }

    /// Set the oracle authority (admin only)
    pub fn set_oracle_authority(ctx: Context<SetOracleAuthority>, oracle: Pubkey) -> Result<()> {
        compute_fn!("set_oracle_authority" => {
            let mut registry = ctx.accounts.registry.load_mut()?;
            require_keys_eq!(
                registry.authority,
                ctx.accounts.authority.key(),
                RegistryError::UnauthorizedAuthority
            );

            let old_oracle = if registry.has_oracle_authority == 1 {
                Some(registry.oracle_authority)
            } else {
                None
            };

            registry.oracle_authority = oracle;
            registry.has_oracle_authority = 1;

            emit!(OracleAuthoritySet {
                old_oracle,
                new_oracle: oracle,
            });
        });
        Ok(())
    }

    /// Set the allowed destination for slashed validator bonds (admin only).
    /// `slash_validator` will refuse to send the bond anywhere else, so a slash
    /// cannot be misrouted (point this at the treasury `reward_vault`).
    pub fn set_slash_destination(ctx: Context<SetSlashDestination>, destination: Pubkey) -> Result<()> {
        compute_fn!("set_slash_destination" => {
            let mut registry = ctx.accounts.registry.load_mut()?;
            require_keys_eq!(
                registry.authority,
                ctx.accounts.authority.key(),
                RegistryError::UnauthorizedAuthority
            );

            let old_destination = if registry.has_slash_destination == 1 {
                Some(registry.slash_destination)
            } else {
                None
            };

            registry.slash_destination = destination;
            registry.has_slash_destination = 1;

            emit!(SlashDestinationSet {
                old_destination,
                new_destination: destination,
            });
        });
        Ok(())
    }

    /// Update the registry authority (admin only)
    pub fn update_authority(ctx: Context<UpdateAuthority>, new_authority: Pubkey) -> Result<()> {
        compute_fn!("update_authority" => {
            let mut registry = ctx.accounts.registry.load_mut()?;
            require_keys_eq!(
                registry.authority,
                ctx.accounts.authority.key(),
                RegistryError::UnauthorizedAuthority
            );

            let old_authority = registry.authority;
            registry.authority = new_authority;

            emit!(AuthorityUpdated {
                old_authority,
                new_authority,
            });
        });
        Ok(())
    }

    /// Aggregate counts from all shards into the global registry (admin only)
    pub fn aggregate_shards(ctx: Context<AggregateShards>) -> Result<()> {
        compute_fn!("aggregate_shards" => {
            let mut registry = ctx.accounts.registry.load_mut()?;
            require_keys_eq!(
                registry.authority,
                ctx.accounts.authority.key(),
                RegistryError::UnauthorizedAuthority
            );

            let mut total_users = 0u64;
            let mut total_meters = 0u64;
            let mut total_active_meters = 0u64;
            // Bitmask of shard_ids already counted — reject duplicates so a shard
            // passed twice cannot inflate the totals.
            let mut seen: u16 = 0;
            const SHARD_LEN: usize = std::mem::size_of::<RegistryShard>();

            for account_info in ctx.remaining_accounts.iter() {
                require_keys_eq!(*account_info.owner, crate::ID, RegistryError::UnauthorizedAuthority);

                let shard_data = account_info.try_borrow_data()?;
                if shard_data.len() >= 8 + SHARD_LEN {
                    let shard = RegistryShard::load_from_bytes(&shard_data[8..8 + SHARD_LEN])?;

                    // Validate via the stored canonical bump (create_program_address ~1,651 CU)
                    // instead of re-deriving with find_program_address (~12,136 CU).
                    let expected_pda = Pubkey::create_program_address(
                        &[b"registry_shard", &[shard.shard_id], &[shard.bump]], &crate::ID
                    ).map_err(|_| RegistryError::UnauthorizedAuthority)?;
                    require_keys_eq!(account_info.key(), expected_pda, RegistryError::UnauthorizedAuthority);

                    let bit = 1u16 << shard.shard_id;
                    require!(seen & bit == 0, RegistryError::DuplicateShard);
                    seen |= bit;

                    total_users = total_users
                        .checked_add(shard.user_count)
                        .ok_or(RegistryError::MathOverflow)?;
                    total_meters = total_meters
                        .checked_add(shard.meter_count)
                        .ok_or(RegistryError::MathOverflow)?;
                    total_active_meters = total_active_meters
                        .checked_add(shard.active_meter_count)
                        .ok_or(RegistryError::MathOverflow)?;
                }
            }

            registry.user_count = total_users;
            registry.meter_count = total_meters;
            registry.active_meter_count = total_active_meters;
        });
        Ok(())
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
        require!(shard_id < 16, RegistryError::InvalidShardId);
        // Shard is bound to the user's key — caller cannot scatter counts onto arbitrary shards.
        require!(
            shard_id == shard_for(&ctx.accounts.authority.key()),
            RegistryError::InvalidShardId
        );
        compute_fn!("register_user" => {
            let registry = ctx.accounts.registry.load()?;
            
            // Authorization Check: Either the user signs for themselves, or the Registry Authority signs for them.
            // Note: `authority` is an `AccountInfo` instead of `Signer` because the admin can sign on behalf of the user.
            let is_user_signing = ctx.accounts.authority.is_signer;
            let is_admin_signing = ctx.accounts.payer.key() == registry.authority;
            
            require!(
                is_user_signing || is_admin_signing,
                RegistryError::UnauthorizedAuthority
            );

            let user_authority = ctx.accounts.authority.key();
            let now = Clock::get()?.unix_timestamp;
            let mut user_account = ctx.accounts.user_account.load_init()?;
            let mut shard = ctx.accounts.registry_shard.load_mut()?;

            user_account.authority = user_authority;
            user_account.user_type = user_type;
            user_account.lat_e7 = lat_e7;
            user_account.long_e7 = long_e7;
            user_account.h3_index = h3_index;
            user_account.status = UserStatus::Active;
            user_account.shard_id = shard_id;
            user_account.registered_at = now;
            user_account.meter_count = 0;
            user_account.airdrop_claimed = 0;

            shard.user_count = shard.user_count.checked_add(1).ok_or(RegistryError::MathOverflow)?;

            // The welcome airdrop is NOT minted here. A failed mint CPI would abort the
            // whole transaction (Solana cannot "swallow" a failed CPI), which would block
            // registration entirely. Registration must always succeed independently; the
            // airdrop is claimed separately via `claim_airdrop` and is safely retryable.
            emit!(UserRegistered {
                user: user_authority,
                user_type,
                lat_e7,
                long_e7,
                h3_index,
            });
        });
        Ok(())
    }

    /// Mint the one-time welcome airdrop to an already-registered user.
    ///
    /// Decoupled from `register_user` on purpose: a failed mint CPI aborts its whole
    /// transaction, so bundling it with registration would let a mint failure roll back
    /// the user's registration. Here the mint and the `airdrop_claimed` flag commit (or
    /// roll back) together, leaving the claim safely retryable without touching the user
    /// record created by `register_user`.
    pub fn claim_airdrop(ctx: Context<ClaimAirdrop>) -> Result<()> {
        compute_fn!("claim_airdrop" => {
            // Authorization: the user signs for themselves, or the registry admin signs for them.
            let is_user_signing = ctx.accounts.authority.is_signer;
            let is_admin_signing = {
                let registry = ctx.accounts.registry.load()?;
                ctx.accounts.payer.key() == registry.authority
            };
            require!(is_user_signing || is_admin_signing, RegistryError::UnauthorizedAuthority);

            // Mark claimed first; if the mint CPI below fails, this write rolls back with
            // the failed tx, so the flag never desyncs from the actual mint.
            {
                let mut user_account = ctx.accounts.user_account.load_mut()?;
                require!(
                    user_account.authority == ctx.accounts.authority.key(),
                    RegistryError::UnauthorizedAuthority
                );
                require!(user_account.airdrop_claimed == 0, RegistryError::AirdropAlreadyClaimed);
                user_account.airdrop_claimed = 1;
            }

            let cpi_accounts = energy_token::cpi::accounts::MintTokensDirect {
                token_info: ctx.accounts.token_info.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                user_token_account: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.registry.to_account_info(), // Registry PDA signs
                registry_authority: ctx.accounts.registry.to_account_info(), // Must match stored registry_authority
                rec_validator: ctx.accounts.registry.to_account_info(), // Placeholder when REC count is 0
                token_program: ctx.accounts.token_program.to_account_info(),
            };
            let registry_seeds = &[b"registry".as_ref(), &[ctx.bumps.registry]];
            let signer = &[&registry_seeds[..]];
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.energy_token_program.key(),
                cpi_accounts,
                signer,
            );

            compute_checkpoint!("before_claim_cpi");
            energy_token::cpi::mint_tokens_direct(cpi_ctx, AIRDROP_AMOUNT)?;
            compute_checkpoint!("after_claim_cpi");

            let now = Clock::get()?.unix_timestamp;
            emit!(AirdropClaimed {
                user: ctx.accounts.authority.key(),
                amount: AIRDROP_AMOUNT,
                timestamp: now,
            });
        });
        Ok(())
    }

    /// Register a smart meter for an existing user
    pub fn register_meter(
        ctx: Context<RegisterMeter>,
        meter_id: String,
        meter_type: MeterType,
        shard_id: u8,
    ) -> Result<()> {
        require!(shard_id < 16, RegistryError::InvalidShardId);
        let owner = ctx.accounts.owner.key();
        // Meter co-locates on its owner's shard.
        require!(shard_id == shard_for(&owner), RegistryError::InvalidShardId);
        compute_fn!("register_meter" => {
            let mut meter_account = ctx.accounts.meter_account.load_init()?;
            let mut user_account = ctx.accounts.user_account.load_mut()?;
            let mut shard = ctx.accounts.registry_shard.load_mut()?;

            require!(
                user_account.status == UserStatus::Active,
                RegistryError::UnauthorizedUser
            );

            // Basic owner-user validation (though PDA seeds also protect this)
            require_keys_eq!(
                owner,
                user_account.authority,
                RegistryError::UnauthorizedUser
            );

            require!(meter_id.len() <= 32, RegistryError::InvalidMeterId);

            meter_account.meter_id = string_to_bytes32(&meter_id);
            meter_account.owner = owner;
            meter_account.meter_type = meter_type;
            meter_account.status = MeterStatus::Active;
            meter_account.registered_at = Clock::get()?.unix_timestamp;
            meter_account.last_reading_at = 0;
            meter_account.total_generation = 0;
            meter_account.total_consumption = 0;
            meter_account.settled_net_generation = 0;
            meter_account.claimed_erc_generation = 0;

            user_account.meter_count = user_account.meter_count.checked_add(1).ok_or(RegistryError::MathOverflow)?;
            shard.meter_count = shard.meter_count.checked_add(1).ok_or(RegistryError::MathOverflow)?;
            // New meters are created Active — count on the shard, NOT the global Registry.
            // Writing the global account here would take a write lock on every registration
            // and serialize the hot path; aggregate_shards reconciles the global total.
            shard.active_meter_count = shard.active_meter_count.checked_add(1).ok_or(RegistryError::MathOverflow)?;

            emit!(MeterRegistered {
                meter_id: meter_id.clone(),
                owner,
                meter_type,
            });
        });
        Ok(())
    }

    /// Update user status (admin only)
    pub fn update_user_status(
        ctx: Context<UpdateUserStatus>,
        new_status: UserStatus,
    ) -> Result<()> {
        compute_fn!("update_user_status" => {
            let mut user_account = ctx.accounts.user_account.load_mut()?;
            let registry = ctx.accounts.registry.load()?;

            require_keys_eq!(
                ctx.accounts.authority.key(),
                registry.authority,
                RegistryError::UnauthorizedAuthority
            );

            let old_status = user_account.status;
            user_account.status = new_status;

            emit!(UserStatusUpdated {
                user: user_account.authority,
                old_status,
                new_status,
            });
        });
        Ok(())
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
            let registry = ctx.accounts.registry.load()?;
            let mut meter_account = ctx.accounts.meter_account.load_mut()?;

            require!(registry.has_oracle_authority == 1, RegistryError::OracleNotConfigured);
            require_keys_eq!(
                ctx.accounts.oracle_authority.key(),
                registry.oracle_authority,
                RegistryError::UnauthorizedOracle
            );

            require!(
                meter_account.status == MeterStatus::Active,
                RegistryError::InvalidMeterStatus
            );

            require!(
                reading_timestamp > meter_account.last_reading_at,
                RegistryError::StaleReading
            );

            // Rate-limit: minimum interval between readings (skipped on first reading).
            const MIN_READING_INTERVAL_SECS: i64 = 60;
            if meter_account.last_reading_at > 0 {
                require!(
                    reading_timestamp >= meter_account.last_reading_at + MIN_READING_INTERVAL_SECS,
                    RegistryError::ReadingTooFrequent
                );
            }

            const MAX_READING_DELTA: u64 = 1_000_000_000_000;
            require!(
                energy_generated <= MAX_READING_DELTA,
                RegistryError::ReadingTooHigh
            );
            require!(
                energy_consumed <= MAX_READING_DELTA,
                RegistryError::ReadingTooHigh
            );

            meter_account.last_reading_at = reading_timestamp;
            meter_account.total_generation = meter_account.total_generation.checked_add(energy_generated).ok_or(RegistryError::MathOverflow)?;
            meter_account.total_consumption = meter_account.total_consumption.checked_add(energy_consumed).ok_or(RegistryError::MathOverflow)?;

            emit!(MeterReadingUpdated {
                meter_id: bytes32_to_string(&meter_account.meter_id),
                owner: meter_account.owner,
                energy_generated,
                energy_consumed,
            });
        });
        Ok(())
    }

    /// Set meter status (owner or authority)
    pub fn set_meter_status(ctx: Context<SetMeterStatus>, new_status: MeterStatus) -> Result<()> {
        compute_fn!("set_meter_status" => {
            let mut meter = ctx.accounts.meter_account.load_mut()?;
            let registry_acc = ctx.accounts.registry.load()?;
            let mut shard = ctx.accounts.registry_shard.load_mut()?;

            let is_owner = ctx.accounts.authority.key() == meter.owner;
            let is_admin = ctx.accounts.authority.key() == registry_acc.authority;
            require!(is_owner || is_admin, RegistryError::UnauthorizedUser);

            // Active counting lives on the owner's shard (see register_meter); the
            // global Registry stays read-only here and is reconciled via aggregate_shards.
            require!(
                shard.shard_id == shard_for(&meter.owner),
                RegistryError::InvalidShardId
            );

            let old_status = meter.status;

            if old_status == MeterStatus::Active && new_status != MeterStatus::Active {
                shard.active_meter_count = shard.active_meter_count.saturating_sub(1);
            } else if old_status != MeterStatus::Active && new_status == MeterStatus::Active {
                shard.active_meter_count = shard.active_meter_count.saturating_add(1);
            }

            meter.status = new_status;

            emit!(MeterStatusUpdated {
                meter_id: bytes32_to_string(&meter.meter_id),
                owner: meter.owner,
                old_status,
                new_status,
            });
        });
        Ok(())
    }

    /// Deactivate a meter permanently (owner only)
    pub fn deactivate_meter(ctx: Context<DeactivateMeter>) -> Result<()> {
        compute_fn!("deactivate_meter" => {
            let mut meter = ctx.accounts.meter_account.load_mut()?;
            let mut user = ctx.accounts.user_account.load_mut()?;
            let mut shard = ctx.accounts.registry_shard.load_mut()?;

            require_keys_eq!(
                ctx.accounts.owner.key(),
                meter.owner,
                RegistryError::UnauthorizedUser
            );

            require!(
                meter.status != MeterStatus::Inactive,
                RegistryError::AlreadyInactive
            );

            if meter.status == MeterStatus::Active {
                // Per-shard count; global total reconciled via aggregate_shards.
                shard.active_meter_count = shard.active_meter_count.saturating_sub(1);
            }

            meter.status = MeterStatus::Inactive;
            user.meter_count = user.meter_count.saturating_sub(1);
            // Meter leaves the registry — drop it from its owner's shard count so
            // aggregate_shards reflects live (non-deactivated) meters.
            shard.meter_count = shard.meter_count.saturating_sub(1);

            emit!(MeterDeactivated {
                meter_id: bytes32_to_string(&meter.meter_id),
                owner: meter.owner,
                final_generation: meter.total_generation,
                final_consumption: meter.total_consumption,
            });
        });
        Ok(())
    }

    /// Verify if a user is valid and active
    pub fn is_valid_user(ctx: Context<IsValidUser>) -> Result<bool> {
        let res = compute_fn!("is_valid_user" => {
            let user_account = ctx.accounts.user_account.load()?;
            user_account.status == UserStatus::Active
        });
        Ok(res)
    }

    /// Verify if a meter is valid and active
    pub fn is_valid_meter(ctx: Context<IsValidMeter>) -> Result<bool> {
        let res = compute_fn!("is_valid_meter" => {
            let meter_account = ctx.accounts.meter_account.load()?;
            meter_account.status == MeterStatus::Active
        });
        Ok(res)
    }

    /// Calculate unsettled net generation ready for tokenization
    /// This is a view function that returns how much energy can be minted as GRID tokens
    pub fn get_unsettled_balance(ctx: Context<GetUnsettledBalance>) -> Result<u64> {
        let res = compute_fn!("get_unsettled_balance" => {
            let meter = ctx.accounts.meter_account.load()?;

            // Calculate current net generation (total produced - total consumed)
            let current_net_gen = meter
                .total_generation
                .saturating_sub(meter.total_consumption);

            // Calculate how much hasn't been tokenized yet
            current_net_gen.saturating_sub(meter.settled_net_generation)
        });
        Ok(res)
    }

    /// Settle meter balance and prepare for GRID token minting
    /// This updates the settled_net_generation tracker to prevent double-minting
    /// The actual token minting should be called by the energy_token program
    pub fn settle_meter_balance(ctx: Context<SettleMeterBalance>) -> Result<u64> {
        let res = compute_fn!("settle_meter_balance" => {
            let mut meter = ctx.accounts.meter_account.load_mut()?;
            do_settle_meter(&mut meter, ctx.accounts.meter_owner.key())?
        });

        Ok(res)
    }

    /// Settle meter balance and automatically mint GRID tokens via CPI
    /// This is a convenience function that combines settlement + minting in one transaction
    pub fn settle_and_mint_tokens(ctx: Context<SettleAndMintTokens>) -> Result<()> {
        compute_fn!("settle_and_mint_tokens" => {
            let mut meter = ctx.accounts.meter_account.load_mut()?;
            let new_tokens_to_mint = do_settle_meter(&mut meter, ctx.accounts.meter_owner.key())?;

            // We need to sign as the Registry because the Registry is the authority of the Energy Token (TokenInfo)
            let bump = ctx.bumps.registry;
            let signer_seeds = &[
                b"registry".as_ref(),
                &[bump],
            ];
            let signer = &[&signer_seeds[..]];

            // let cpi_program = ctx.accounts.energy_token_program.to_account_info();
            let cpi_accounts = energy_token::cpi::accounts::MintTokensDirect {
                token_info: ctx.accounts.token_info.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                user_token_account: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.registry.to_account_info(), // Registry signs
                registry_authority: ctx.accounts.registry.to_account_info(),
                rec_validator: ctx.accounts.rec_validator.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
            };

            let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.energy_token_program.key(), cpi_accounts, signer);
            energy_token::cpi::mint_tokens_direct(cpi_ctx, new_tokens_to_mint)?;
        });

        Ok(())
    }

    /// Mark energy as claimed for ERC issuance (authorized by governance/oracle)
    pub fn mark_erc_claimed(ctx: Context<MarkErcClaimed>, amount: u64) -> Result<()> {
        compute_fn!("mark_erc_claimed" => {
            let mut meter = ctx.accounts.meter_account.load_mut()?;

            // Authorization check - usually either the registry authority or a specific governance program
            let registry = ctx.accounts.registry.load()?;
            require!(
                ctx.accounts.authority.key() == registry.authority
                    || ctx.accounts.authority.key() == registry.oracle_authority,
                RegistryError::UnauthorizedAuthority
            );

            // Bound ERC claims against NET generation (same base as do_settle_meter),
            // so combined GRID + ERC claims can never exceed net generation.
            let net_gen = meter
                .total_generation
                .saturating_sub(meter.total_consumption);
            let unclaimed = net_gen
                .saturating_sub(meter.claimed_erc_generation)
                .saturating_sub(meter.settled_net_generation);
            require!(amount <= unclaimed, RegistryError::NoUnsettledBalance);

            meter.claimed_erc_generation = meter.claimed_erc_generation.saturating_add(amount);

            emit!(ErcClaimed {
                meter_id: bytes32_to_string(&meter.meter_id),
                owner: meter.owner,
                amount,
                total_claimed: meter.claimed_erc_generation,
            });
        });
        Ok(())
    }

    /// Initialize the staking vault for GRX tokens (admin only)
    pub fn initialize_vault(_ctx: Context<InitializeVault>) -> Result<()> {
        Ok(())
    }

    /// Stake GRX tokens to participate in the network
    pub fn stake_grx(ctx: Context<StakeGrx>, amount: u64) -> Result<()> {
        require!(amount > 0, RegistryError::MinStakeNotMet);
        compute_fn!("stake_grx" => {
            let cpi_accounts = token_interface::TransferChecked {
                from: ctx.accounts.user_grx_ata.to_account_info(),
                to: ctx.accounts.grx_vault.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
                mint: ctx.accounts.grx_mint.to_account_info(),
            };
            let cpi_ctx = CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts);

            compute_checkpoint!("before_stake_transfer_cpi");
            token_interface::transfer_checked(cpi_ctx, amount, ctx.accounts.grx_mint.decimals)?;
            compute_checkpoint!("after_stake_transfer_cpi");

            let mut user_account = ctx.accounts.user_account.load_mut()?;
            user_account.staked_grx = user_account
                .staked_grx
                .checked_add(amount)
                .ok_or(RegistryError::MathOverflow)?;
            // Re-anchor the unstake cooldown to the most recent stake/top-up on
            // EVERY stake. Anchoring only to the first deposit let a staker keep a
            // dust balance permanently staked so `last_stake_at` never refreshed,
            // then stake-large-and-immediately-unstake-large with zero cooldown —
            // escaping the slashing window. Every fresh GRX must serve the full
            // cooldown before it can leave the vault.
            user_account.last_stake_at = Clock::get()?.unix_timestamp;
        });
        Ok(())
    }

    /// Register as a validator (requires at least 10,000 GRX staked)
    pub fn register_validator(ctx: Context<RegisterValidator>) -> Result<()> {
        compute_fn!("register_validator" => {
            let mut user_account = ctx.accounts.user_account.load_mut()?;

            // A slashed validator is permanently barred from self-reinstatement;
            // restaking must not silently undo a slash. Reinstatement, if ever
            // desired, belongs in an explicit admin-gated instruction.
            require!(
                user_account.validator_status != ValidatorStatus::Slashed,
                RegistryError::ValidatorAlreadySlashed
            );

            require!(
                user_account.staked_grx >= MIN_VALIDATOR_STAKE,
                RegistryError::MinStakeNotMet
            );

            user_account.validator_status = ValidatorStatus::Active;
        });
        Ok(())
    }

    /// Withdraw previously staked GRX back to the user's ATA.
    ///
    /// Enforces a cooldown since the last `stake_grx`, decrements the stake, and
    /// demotes an Active validator to Suspended if the remaining stake drops below
    /// `MIN_VALIDATOR_STAKE`. The registry PDA signs the vault → user transfer.
    pub fn unstake_grx(ctx: Context<UnstakeGrx>, amount: u64) -> Result<()> {
        require!(amount > 0, RegistryError::InsufficientStakingBalance);
        compute_fn!("unstake_grx" => {
            let now = Clock::get()?.unix_timestamp;

            // Read-then-drop the loader borrow before the CPI; re-borrow after.
            let (staked, last_stake_at) = {
                let user_account = ctx.accounts.user_account.load()?;
                (user_account.staked_grx, user_account.last_stake_at)
            };
            require!(amount <= staked, RegistryError::InsufficientStakingBalance);
            require!(
                now.saturating_sub(last_stake_at) >= UNSTAKE_COOLDOWN_SECS,
                RegistryError::UnstakingLocked
            );

            // Registry PDA is the vault authority — sign the withdrawal.
            let bump = ctx.bumps.registry;
            let signer_seeds: &[&[u8]] = &[b"registry".as_ref(), &[bump]];
            let signer = &[signer_seeds];

            let cpi_accounts = token_interface::TransferChecked {
                from: ctx.accounts.grx_vault.to_account_info(),
                to: ctx.accounts.user_grx_ata.to_account_info(),
                authority: ctx.accounts.registry.to_account_info(),
                mint: ctx.accounts.grx_mint.to_account_info(),
            };
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                cpi_accounts,
                signer,
            );

            compute_checkpoint!("before_unstake_transfer_cpi");
            token_interface::transfer_checked(cpi_ctx, amount, ctx.accounts.grx_mint.decimals)?;
            compute_checkpoint!("after_unstake_transfer_cpi");

            let mut user_account = ctx.accounts.user_account.load_mut()?;
            let remaining = user_account
                .staked_grx
                .checked_sub(amount)
                .ok_or(RegistryError::MathOverflow)?;
            user_account.staked_grx = remaining;

            // Demote a validator that no longer meets the minimum stake.
            if user_account.validator_status == ValidatorStatus::Active
                && remaining < MIN_VALIDATOR_STAKE
            {
                user_account.validator_status = ValidatorStatus::Suspended;
            }

            emit!(Unstaked {
                user: ctx.accounts.authority.key(),
                amount,
                remaining_stake: remaining,
                timestamp: now,
            });
        });
        Ok(())
    }

    /// Slash a validator's bond for proven misbehaviour (PoA authority only).
    ///
    /// The slashed GRX moves out of the registry vault to `slash_destination` — point it at
    /// the treasury `reward_vault` so honest stakers receive it (call `treasury::fund_rewards`
    /// afterwards), per the node design's "redistributed to honest stakers" rule.
    ///
    /// The target validator is identified by `target_authority`; its `UserAccount` PDA is
    /// passed mutably. The slashed amount is capped at the validator's staked balance.
    pub fn slash_validator(ctx: Context<SlashValidator>, amount: u64) -> Result<()> {
        require!(amount > 0, RegistryError::MinStakeNotMet);
        // PoA gate: only the registry authority may slash, and only to the configured
        // slash destination (e.g. treasury reward_vault) so a slash cannot be misrouted.
        {
            let registry = ctx.accounts.registry.load()?;
            require_keys_eq!(
                ctx.accounts.authority.key(),
                registry.authority,
                RegistryError::UnauthorizedAuthority
            );
            require!(
                registry.has_slash_destination == 1,
                RegistryError::SlashDestinationNotSet
            );
            require_keys_eq!(
                ctx.accounts.slash_destination.key(),
                registry.slash_destination,
                RegistryError::InvalidSlashDestination
            );
        }
        compute_fn!("slash_validator" => {
            let slashed = {
                let user_account = ctx.accounts.target_user_account.load()?;
                // Only an active validator can be slashed — never a plain staker or an
                // already-slashed account.
                require!(
                    user_account.validator_status == ValidatorStatus::Active,
                    RegistryError::NotActiveValidator
                );
                require!(
                    user_account.staked_grx > 0,
                    RegistryError::InsufficientStakingBalance
                );
                amount.min(user_account.staked_grx)
            };

            let cpi_accounts = token_interface::TransferChecked {
                from: ctx.accounts.grx_vault.to_account_info(),
                to: ctx.accounts.slash_destination.to_account_info(),
                authority: ctx.accounts.registry.to_account_info(),
                mint: ctx.accounts.grx_mint.to_account_info(),
            };
            let registry_seeds = &[b"registry".as_ref(), &[ctx.bumps.registry]];
            let signer = &[&registry_seeds[..]];
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                cpi_accounts,
                signer,
            );

            compute_checkpoint!("before_slash_transfer_cpi");
            token_interface::transfer_checked(cpi_ctx, slashed, ctx.accounts.grx_mint.decimals)?;
            compute_checkpoint!("after_slash_transfer_cpi");

            let mut user_account = ctx.accounts.target_user_account.load_mut()?;
            user_account.staked_grx = user_account.staked_grx.saturating_sub(slashed);
            user_account.validator_status = ValidatorStatus::Slashed;

            let now = Clock::get()?.unix_timestamp;
            emit!(ValidatorSlashed {
                validator: ctx.accounts.target_authority.key(),
                slashed_amount: slashed,
                remaining_stake: user_account.staked_grx,
                timestamp: now,
            });
        });
        Ok(())
    }
}

// Internal helpers
fn do_settle_meter(meter: &mut MeterAccount, owner_key: Pubkey) -> Result<u64> {
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


// Account structs
#[derive(Accounts)]
pub struct Initialize<'info> {
    // Shared registry account for authorities and global state
    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<Registry>(),
        seeds = [b"registry"],
        bump
    )]
    pub registry: AccountLoader<'info, Registry>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(shard_id: u8)]
pub struct InitializeShard<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<RegistryShard>(),
        seeds = [b"registry_shard".as_ref(), &[shard_id]],
        bump
    )]
    pub shard: AccountLoader<'info, RegistryShard>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(user_type: UserType, lat_e7: i32, long_e7: i32, h3_index: u64, shard_id: u8)]
pub struct RegisterUser<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + std::mem::size_of::<UserAccount>(),
        seeds = [b"user", authority.key().as_ref()],
        bump
    )]
    pub user_account: AccountLoader<'info, UserAccount>,

    #[account(
        mut,
        seeds = [b"registry_shard".as_ref(), &[shard_id]],
        bump
    )]
    pub registry_shard: AccountLoader<'info, RegistryShard>,

    #[account(
        seeds = [b"registry"],
        bump,
    )]
    pub registry: AccountLoader<'info, Registry>,

    /// CHECK: The user's public key. Authorization checked in instruction body.
    pub authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Accounts for the decoupled welcome airdrop. Mirrors the energy-token
/// `mint_tokens_direct` CPI inputs; the registry PDA signs the mint.
#[derive(Accounts)]
pub struct ClaimAirdrop<'info> {
    #[account(
        mut,
        seeds = [b"user", authority.key().as_ref()],
        bump
    )]
    pub user_account: AccountLoader<'info, UserAccount>,

    #[account(
        seeds = [b"registry"],
        bump,
    )]
    pub registry: AccountLoader<'info, Registry>,

    /// CHECK: The user's public key. Authorization checked in instruction body.
    pub authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: The energy token program.
    pub energy_token_program: UncheckedAccount<'info>,

    /// CHECK: The energy token mint.
    #[account(mut)]
    pub mint: UncheckedAccount<'info>,

    /// CHECK: The user's token account (ATA).
    #[account(mut)]
    pub user_token_account: UncheckedAccount<'info>,

    /// CHECK: The token info account (mint authority).
    pub token_info: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
#[instruction(meter_id: String, meter_type: MeterType, shard_id: u8)]
pub struct RegisterMeter<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + std::mem::size_of::<MeterAccount>(),
        seeds = [b"meter", owner.key().as_ref(), meter_id.as_bytes()],
        bump
    )]
    pub meter_account: AccountLoader<'info, MeterAccount>,

    #[account(
        mut,
        seeds = [b"user", owner.key().as_ref()],
        bump
    )]
    pub user_account: AccountLoader<'info, UserAccount>,

    #[account(
        mut,
        seeds = [b"registry_shard".as_ref(), &[shard_id]],
        bump
    )]
    pub registry_shard: AccountLoader<'info, RegistryShard>,

    // Read-only on purpose: a `mut` here would take a Sealevel write lock on the
    // global Registry for every registration, serializing the hot path.
    #[account(seeds = [b"registry"], bump)]
    pub registry: AccountLoader<'info, Registry>,

    /// CHECK: The user's wallet pubkey. Non-signing in the custodial-bridge model
    /// (the user's key is Vault-custodied; the bridge's `payer` funds + signs).
    /// Safe: the handler enforces `owner == user_account.authority` and the
    /// meter/user PDAs are seeded by `owner.key()`, so a meter can only ever be
    /// created under its true owner's registered account.
    pub owner: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateUserStatus<'info> {
    #[account(mut, seeds = [b"registry"], bump)]
    pub registry: AccountLoader<'info, Registry>,

    #[account(mut)]
    pub user_account: AccountLoader<'info, UserAccount>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateMeterReading<'info> {
    #[account(seeds = [b"registry"], bump)]
    pub registry: AccountLoader<'info, Registry>,

    #[account(mut)]
    pub meter_account: AccountLoader<'info, MeterAccount>,

    pub oracle_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetOracleAuthority<'info> {
    #[account(mut)]
    pub registry: AccountLoader<'info, Registry>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetSlashDestination<'info> {
    #[account(mut)]
    pub registry: AccountLoader<'info, Registry>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateAuthority<'info> {
    #[account(mut)]
    pub registry: AccountLoader<'info, Registry>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetMeterStatus<'info> {
    #[account(seeds = [b"registry"], bump)]
    pub registry: AccountLoader<'info, Registry>,

    #[account(mut)]
    pub meter_account: AccountLoader<'info, MeterAccount>,

    // Owner's shard — handler verifies shard_id == shard_for(meter.owner), so the
    // Active count moves on the same shard register_meter incremented.
    #[account(
        mut,
        seeds = [b"registry_shard".as_ref(), &[meter_account.load()?.owner.to_bytes()[0] % 16]],
        bump
    )]
    pub registry_shard: AccountLoader<'info, RegistryShard>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct DeactivateMeter<'info> {
    #[account(mut)]
    pub meter_account: AccountLoader<'info, MeterAccount>,

    #[account(mut)]
    pub user_account: AccountLoader<'info, UserAccount>,

    #[account(seeds = [b"registry"], bump)]
    pub registry: AccountLoader<'info, Registry>,

    // Owner's shard — seeds bind to `owner` so the count is decremented on the
    // same shard `register_meter` incremented (shard = owner first byte % 16).
    #[account(
        mut,
        seeds = [b"registry_shard".as_ref(), &[owner.key().to_bytes()[0] % 16]],
        bump
    )]
    pub registry_shard: AccountLoader<'info, RegistryShard>,

    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct IsValidUser<'info> {
    pub user_account: AccountLoader<'info, UserAccount>,
}

#[derive(Accounts)]
pub struct IsValidMeter<'info> {
    pub meter_account: AccountLoader<'info, MeterAccount>,
}

#[derive(Accounts)]
pub struct GetUnsettledBalance<'info> {
    pub meter_account: AccountLoader<'info, MeterAccount>,
}

#[derive(Accounts)]
pub struct SettleMeterBalance<'info> {
    #[account(mut)]
    pub meter_account: AccountLoader<'info, MeterAccount>,

    pub meter_owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct SettleAndMintTokens<'info> {
    #[account(mut)]
    pub meter_account: AccountLoader<'info, MeterAccount>,

    pub meter_owner: Signer<'info>,

    /// CHECK: Energy token program's token_info PDA
    #[account(mut)]
    pub token_info: UncheckedAccount<'info>,

    /// CHECK: Energy token mint account
    #[account(mut)]
    pub mint: UncheckedAccount<'info>,

    /// CHECK: User's token account for receiving minted tokens
    #[account(mut)]
    pub user_token_account: UncheckedAccount<'info>,

    /// CHECK: Authority that can mint tokens (usually program authority)
    /// We use the Registry account itself as the authority signer
    #[account(
        mut,
        seeds = [b"registry"],
        bump
    )]
    pub registry: AccountLoader<'info, Registry>,

    /// The energy token program
    /// CHECK: This is validated by the CPI call
    pub energy_token_program: UncheckedAccount<'info>,

    /// CHECK: SPL Token program
    pub token_program: UncheckedAccount<'info>,

    /// CHECK: REC Validator co-signer (required when validators are registered in token_info)
    /// For registry->energy_token CPI, this can be the meter_owner or a separate validator
    pub rec_validator: UncheckedAccount<'info>,
}
#[derive(Accounts)]
pub struct MarkErcClaimed<'info> {
    #[account(mut)]
    pub meter_account: AccountLoader<'info, MeterAccount>,
    #[account(seeds = [b"registry"], bump)]
    pub registry: AccountLoader<'info, Registry>,
    pub authority: Signer<'info>,
}
#[derive(Accounts)]
pub struct AggregateShards<'info> {
    #[account(mut, seeds = [b"registry"], bump)]
    pub registry: AccountLoader<'info, Registry>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(
        mut,
        seeds = [b"registry"],
        bump,
        has_one = authority,
    )]
    pub registry: AccountLoader<'info, Registry>,

    #[account(
        init,
        payer = authority,
        seeds = [b"grx_vault"],
        bump,
        token::mint = grx_mint,
        token::authority = registry,
        token::token_program = token_program,
    )]
    pub grx_vault: InterfaceAccount<'info, TokenAccount>,

    pub grx_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct StakeGrx<'info> {
    #[account(
        mut,
        seeds = [b"user", authority.key().as_ref()],
        bump,
        has_one = authority,
    )]
    pub user_account: AccountLoader<'info, UserAccount>,

    #[account(
        mut,
        seeds = [b"grx_vault"],
        bump,
        token::mint = grx_mint,
        token::authority = registry,
        token::token_program = token_program,
    )]
    pub grx_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        seeds = [b"registry"],
        bump,
    )]
    pub registry: AccountLoader<'info, Registry>,

    #[account(
        mut,
        token::mint = grx_mint,
        token::authority = authority,
        token::token_program = token_program,
    )]
    pub user_grx_ata: InterfaceAccount<'info, TokenAccount>,

    pub grx_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct RegisterValidator<'info> {
    #[account(
        mut,
        seeds = [b"user", authority.key().as_ref()],
        bump,
        has_one = authority,
    )]
    pub user_account: AccountLoader<'info, UserAccount>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct UnstakeGrx<'info> {
    #[account(
        mut,
        seeds = [b"user", authority.key().as_ref()],
        bump,
        has_one = authority,
    )]
    pub user_account: AccountLoader<'info, UserAccount>,

    #[account(
        mut,
        seeds = [b"grx_vault"],
        bump,
        token::mint = grx_mint,
        token::authority = registry,
        token::token_program = token_program,
    )]
    pub grx_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        seeds = [b"registry"],
        bump,
    )]
    pub registry: AccountLoader<'info, Registry>,

    #[account(
        mut,
        token::mint = grx_mint,
        token::authority = authority,
        token::token_program = token_program,
    )]
    pub user_grx_ata: InterfaceAccount<'info, TokenAccount>,

    pub grx_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct SlashValidator<'info> {
    /// CHECK: the validator being slashed; only used to derive its UserAccount PDA and label the event.
    pub target_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"user", target_authority.key().as_ref()],
        bump,
    )]
    pub target_user_account: AccountLoader<'info, UserAccount>,

    #[account(
        mut,
        seeds = [b"grx_vault"],
        bump,
        token::mint = grx_mint,
        token::authority = registry,
        token::token_program = token_program,
    )]
    pub grx_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        seeds = [b"registry"],
        bump,
    )]
    pub registry: AccountLoader<'info, Registry>,

    /// Destination for the slashed bond (e.g. treasury `reward_vault`).
    #[account(
        mut,
        token::mint = grx_mint,
        token::token_program = token_program,
    )]
    pub slash_destination: InterfaceAccount<'info, TokenAccount>,

    pub grx_mint: InterfaceAccount<'info, Mint>,

    /// PoA authority — must equal `registry.authority`.
    pub authority: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}
