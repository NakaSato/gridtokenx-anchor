#![allow(deprecated)]

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

declare_id!("HZR6b8GhzhDowyL6dX58qBjdSDNtFyJHU5dPF3kXDcTS");

/// Airdrop amount for new users (in smallest token units, 9 decimals = 20 GRX)
pub const AIRDROP_AMOUNT: u64 = 20_000_000_000; // 20 GRX tokens

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
            registry.user_count = 0;
            registry.meter_count = 0;
            registry.active_meter_count = 0;
        });
        Ok(())
    }

    /// Initialize a registry shard for distributed counting
    pub fn initialize_shard(ctx: Context<InitializeShard>, shard_id: u8) -> Result<()> {
        require!(shard_id < 16, RegistryError::InvalidShardId);
        let mut shard = ctx.accounts.shard.load_init()?;
        shard.shard_id = shard_id;
        shard.user_count = 0;
        shard.meter_count = 0;
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

    /// Update the registry authority (admin only)
    pub fn update_authority(ctx: Context<UpdateAuthority>, new_authority: Pubkey) -> Result<()> {
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

        Ok(())
    }

    /// Aggregate counts from all shards into the global registry (admin only)
    pub fn aggregate_shards(ctx: Context<AggregateShards>) -> Result<()> {
        let mut registry = ctx.accounts.registry.load_mut()?;
        require_keys_eq!(
            registry.authority,
            ctx.accounts.authority.key(),
            RegistryError::UnauthorizedAuthority
        );

        let mut total_users = 0u64;
        let mut total_meters = 0u64;

        for account_info in ctx.remaining_accounts.iter() {
            // Verify it's a RegistryShard account
            // In production, we'd check the seeds too, but simple type check for now
            let shard_data = account_info.try_borrow_data()?;
            if shard_data.len() >= 8 + std::mem::size_of::<RegistryShard>() {
                // Manually deserialize or use zero_copy check
                // For simplicity in this benchmark-to-prod transition:
                let shard = RegistryShard::load_from_bytes(&shard_data[8..])?;
                total_users = total_users
                    .checked_add(shard.user_count)
                    .ok_or(RegistryError::MathOverflow)?;
                total_meters = total_meters
                    .checked_add(shard.meter_count)
                    .ok_or(RegistryError::MathOverflow)?;
            }
        }

        registry.user_count = total_users;
        registry.meter_count = total_meters;

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
        compute_fn!("register_user" => {
            let registry = ctx.accounts.registry.load()?;
            
            // Authorization Check: Either the user signs for themselves, or the Registry Authority signs for them.
            let is_user_signing = ctx.accounts.authority.is_signer;
            let is_admin_signing = ctx.accounts.payer.key() == registry.authority;
            
            require!(
                is_user_signing || is_admin_signing,
                RegistryError::UnauthorizedAuthority
            );

            let user_authority = ctx.accounts.authority.key();
            let mut user_account = ctx.accounts.user_account.load_init()?;
            let mut shard = ctx.accounts.registry_shard.load_mut()?;

            user_account.authority = user_authority;
            user_account.user_type = user_type;
            user_account.lat_e7 = lat_e7;
            user_account.long_e7 = long_e7;
            user_account.h3_index = h3_index;
            user_account.status = UserStatus::Active;
            user_account.shard_id = shard_id;
            user_account.registered_at = Clock::get()?.unix_timestamp;
            user_account.meter_count = 0;

            shard.user_count += 1;

            emit!(UserRegistered {
                user: user_authority,
                user_type,
                lat_e7,
                long_e7,
                h3_index,
            });

            // Perform automatic airdrop via CPI to energy token program
            if ctx.accounts.energy_token_program.key() != Pubkey::default() {
                
                compute_checkpoint!("before_airdrop_cpi");

                // Build CPI context for MintTo Wallet instruction
                let cpi_accounts = energy_token::cpi::accounts::MintTokensDirect {
                    token_info: ctx.accounts.token_info.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    user_token_account: ctx.accounts.user_token_account.to_account_info(),
                    authority: ctx.accounts.registry.to_account_info(), // Registry PDA signs
                    registry_authority: ctx.accounts.registry.to_account_info(), // Must match stored registry_authority
                    rec_validator: ctx.accounts.registry.to_account_info(), // Placeholder since count is 0
                    token_program: ctx.accounts.token_program.to_account_info(),
                };

                // let cpi_program = ctx.accounts.energy_token_program.to_account_info();

                // Use the registry pda as the signer
                let registry_seeds = &[
                    b"registry".as_ref(),
                    &[ctx.bumps.registry]
                ];
                let signer = &[&registry_seeds[..]];

                let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.energy_token_program.key(), cpi_accounts, signer);

                // Call mint_tokens_direct from the energy token program
                if energy_token::cpi::mint_tokens_direct(cpi_ctx, AIRDROP_AMOUNT).is_err() {
                    // Airdrop failure is non-critical, user registration continues
                    msg!("Warning: Airdrop minting failed for user {}, but registration succeeded", user_authority);
                }

                compute_checkpoint!("after_airdrop_cpi");
            }
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
        compute_fn!("register_meter" => {
            let owner = ctx.accounts.owner.key();
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

            user_account.meter_count += 1;
            shard.meter_count += 1;

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
            meter_account.total_generation += energy_generated;
            meter_account.total_consumption += energy_consumed;

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
            let _shard = ctx.accounts.registry_shard.load()?;
            let registry_acc = ctx.accounts.registry.load()?;

            let is_owner = ctx.accounts.authority.key() == meter.owner;
            let is_admin = ctx.accounts.authority.key() == registry_acc.authority;
            require!(is_owner || is_admin, RegistryError::UnauthorizedUser);

            let old_status = meter.status;

            if old_status == MeterStatus::Active && new_status != MeterStatus::Active {
                // _registry_acc.active_meter_count = _registry_acc.active_meter_count.saturating_sub(1);
            } else if old_status != MeterStatus::Active && new_status == MeterStatus::Active {
                // _registry_acc.active_meter_count += 1;
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
            let _shard = ctx.accounts.registry_shard.load()?;
            let _registry_acc = ctx.accounts.registry.load()?;

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
                // _registry_acc.active_meter_count = _registry_acc.active_meter_count.saturating_sub(1);
            }

            meter.status = MeterStatus::Inactive;
            user.meter_count = user.meter_count.saturating_sub(1);

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
        let user_account = ctx.accounts.user_account.load()?;
        Ok(user_account.status == UserStatus::Active)
    }

    /// Verify if a meter is valid and active
    pub fn is_valid_meter(ctx: Context<IsValidMeter>) -> Result<bool> {
        let meter_account = ctx.accounts.meter_account.load()?;
        Ok(meter_account.status == MeterStatus::Active)
    }

    /// Calculate unsettled net generation ready for tokenization
    /// This is a view function that returns how much energy can be minted as GRID tokens
    pub fn get_unsettled_balance(ctx: Context<GetUnsettledBalance>) -> Result<u64> {
        let meter = ctx.accounts.meter_account.load()?;

        // Calculate current net generation (total produced - total consumed)
        let current_net_gen = meter
            .total_generation
            .saturating_sub(meter.total_consumption);

        // Calculate how much hasn't been tokenized yet
        let unsettled = current_net_gen.saturating_sub(meter.settled_net_generation);

        Ok(unsettled)
    }

    /// Settle meter balance and prepare for GRID token minting
    /// This updates the settled_net_generation tracker to prevent double-minting
    /// The actual token minting should be called by the energy_token program
    pub fn settle_meter_balance(ctx: Context<SettleMeterBalance>) -> Result<u64> {
        let res = compute_fn!("settle_meter_balance" => {
            let mut meter = ctx.accounts.meter_account.load_mut()?;

            require!(
                meter.status == MeterStatus::Active,
                RegistryError::InvalidMeterStatus
            );

            require_keys_eq!(
                ctx.accounts.meter_owner.key(),
                meter.owner,
                RegistryError::UnauthorizedUser
            );

            let current_net_gen = meter
                .total_generation
                .saturating_sub(meter.total_consumption);

            let new_tokens_to_mint = current_net_gen.saturating_sub(meter.settled_net_generation);

            require!(new_tokens_to_mint > 0, RegistryError::NoUnsettledBalance);

            meter.settled_net_generation = current_net_gen;

            emit!(MeterBalanceSettled {
                meter_id: bytes32_to_string(&meter.meter_id),
                owner: meter.owner,
                tokens_to_mint: new_tokens_to_mint,
                total_settled: current_net_gen,
            });

            new_tokens_to_mint
        });

        Ok(res)
    }

    /// Settle meter balance and automatically mint GRID tokens via CPI
    /// This is a convenience function that combines settlement + minting in one transaction
    pub fn settle_and_mint_tokens(ctx: Context<SettleAndMintTokens>) -> Result<()> {
        compute_fn!("settle_and_mint_tokens" => {
            let mut meter = ctx.accounts.meter_account.load_mut()?;

            require!(
                meter.status == MeterStatus::Active,
                RegistryError::InvalidMeterStatus
            );

            require_keys_eq!(
                ctx.accounts.meter_owner.key(),
                meter.owner,
                RegistryError::UnauthorizedUser
            );

            let current_net_gen = meter
                .total_generation
                .saturating_sub(meter.total_consumption);

            let new_tokens_to_mint = current_net_gen.saturating_sub(meter.settled_net_generation);

            require!(new_tokens_to_mint > 0, RegistryError::NoUnsettledBalance);

            meter.settled_net_generation = current_net_gen;

            emit!(MeterBalanceSettled {
                meter_id: bytes32_to_string(&meter.meter_id),
                owner: meter.owner,
                tokens_to_mint: new_tokens_to_mint,
                total_settled: current_net_gen,
            });

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
        let mut meter = ctx.accounts.meter_account.load_mut()?;

        // Authorization check - usually either the registry authority or a specific governance program
        let registry = ctx.accounts.registry.load()?;
        require!(
            ctx.accounts.authority.key() == registry.authority
                || ctx.accounts.authority.key() == registry.oracle_authority,
            RegistryError::UnauthorizedAuthority
        );

        let unclaimed = meter
            .total_generation
            .saturating_sub(meter.claimed_erc_generation);
        require!(amount <= unclaimed, RegistryError::NoUnsettledBalance);

        meter.claimed_erc_generation = meter.claimed_erc_generation.saturating_add(amount);

        emit!(MeterReadingUpdated {
            meter_id: bytes32_to_string(&meter.meter_id),
            owner: meter.owner,
            energy_generated: 0,
            energy_consumed: 0,
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

            let cpi_accounts = token_interface::TransferChecked {
                from: ctx.accounts.user_grx_ata.to_account_info(),
                to: ctx.accounts.grx_vault.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
                mint: ctx.accounts.grx_mint.to_account_info(),
            };
            // let cpi_program = ctx.accounts.token_program.to_account_info();
            let cpi_ctx = CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts);

            token_interface::transfer_checked(cpi_ctx, amount, ctx.accounts.grx_mint.decimals)?;

            let mut user_account = ctx.accounts.user_account.load_mut()?;
            user_account.staked_grx = user_account
                .staked_grx
                .checked_add(amount)
                .ok_or(RegistryError::MathOverflow)?;
            user_account.last_stake_at = Clock::get()?.unix_timestamp;

            Ok(())
        }

        /// Register as a validator (requires at least 10,000 GRX staked)
        pub fn register_validator(ctx: Context<RegisterValidator>) -> Result<()> {
            let mut user_account = ctx.accounts.user_account.load_mut()?;

            // Minimum stake requirement: 10,000 GRX
            const MIN_VALIDATOR_STAKE: u64 = 10_000_000_000_000;
            require!(
                user_account.staked_grx >= MIN_VALIDATOR_STAKE,
                RegistryError::MinStakeNotMet
            );

            user_account.validator_status = ValidatorStatus::Active;

            Ok(())
        }
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
        mut,
        seeds = [b"registry"],
        bump,
    )]
    pub registry: AccountLoader<'info, Registry>,

    /// CHECK: The user's public key. Authorization checked in instruction body.
    pub authority: AccountInfo<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: The energy token program.
    pub energy_token_program: AccountInfo<'info>,

    /// CHECK: The energy token mint.
    #[account(mut)]
    pub mint: AccountInfo<'info>,

    /// CHECK: The user's token account (ATA).
    #[account(mut)]
    pub user_token_account: AccountInfo<'info>,

    /// CHECK: The token info account (mint authority).
    pub token_info: AccountInfo<'info>,

    pub token_program: Interface<'info, TokenInterface>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(meter_id: String, meter_type: MeterType, shard_id: u8)]
pub struct RegisterMeter<'info> {
    #[account(
        init,
        payer = owner,
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

    #[account(mut)]
    pub registry: AccountLoader<'info, Registry>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateUserStatus<'info> {
    #[account(mut)]
    pub registry: AccountLoader<'info, Registry>,

    #[account(mut)]
    pub user_account: AccountLoader<'info, UserAccount>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateMeterReading<'info> {
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
pub struct UpdateAuthority<'info> {
    #[account(mut)]
    pub registry: AccountLoader<'info, Registry>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetMeterStatus<'info> {
    #[account(mut)]
    pub registry: AccountLoader<'info, Registry>,

    #[account(mut)]
    pub meter_account: AccountLoader<'info, MeterAccount>,

    #[account(
        seeds = [b"registry_shard".as_ref(), &[0u8]], // Default to shard 0 for view operations
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

    #[account(
        seeds = [b"registry_shard".as_ref(), &[0u8]],
        bump
    )]
    pub registry_shard: AccountLoader<'info, RegistryShard>,

    #[account(mut)]
    pub registry: AccountLoader<'info, Registry>,

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
    pub token_info: AccountInfo<'info>,

    /// CHECK: Energy token mint account
    #[account(mut)]
    pub mint: AccountInfo<'info>,

    /// CHECK: User's token account for receiving minted tokens
    #[account(mut)]
    pub user_token_account: AccountInfo<'info>,

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
    pub energy_token_program: AccountInfo<'info>,

    /// CHECK: SPL Token program
    pub token_program: AccountInfo<'info>,

    /// CHECK: REC Validator co-signer (required when validators are registered in token_info)
    /// For registry->energy_token CPI, this can be the meter_owner or a separate validator
    pub rec_validator: AccountInfo<'info>,
}
#[derive(Accounts)]
pub struct MarkErcClaimed<'info> {
    #[account(mut)]
    pub meter_account: AccountLoader<'info, MeterAccount>,
    pub registry: AccountLoader<'info, Registry>,
    pub authority: Signer<'info>,
}
#[derive(Accounts)]
pub struct AggregateShards<'info> {
    #[account(mut)]
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
