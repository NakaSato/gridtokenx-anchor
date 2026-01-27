#![allow(deprecated)]

use anchor_lang::prelude::*;

// Core modules
pub mod error;
pub mod events;
pub mod state;

pub use error::RegistryError;
pub use events::*;
pub use state::*;

declare_id!("3aF9FmyFuGzg4i1TCyySLQM1zWK8UUQyFALxo2f236ye");

#[cfg(feature = "localnet")]
use compute_debug::{compute_fn, compute_checkpoint};

#[cfg(not(feature = "localnet"))]
macro_rules! compute_fn {
    ($name:expr => $block:block) => { $block };
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
            registry.created_at = Clock::get()?.unix_timestamp;

            msg!("Registry initialized with authority: {}", registry.authority);
        });
        Ok(())
    }

    /// Set the oracle authority (admin only)
    pub fn set_oracle_authority(
        ctx: Context<SetOracleAuthority>,
        oracle: Pubkey,
    ) -> Result<()> {
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
                timestamp: Clock::get()?.unix_timestamp,
            });

            msg!("Oracle authority set to: {}", oracle);
        });
        Ok(())
    }

    /// Register a new user in the P2P energy trading system
    pub fn register_user(
        ctx: Context<RegisterUser>,
        user_type: UserType,
        lat: f64,
        long: f64,
    ) -> Result<()> {
        compute_fn!("register_user" => {
            let user_authority = ctx.accounts.authority.key();
            let mut user_account = ctx.accounts.user_account.load_init()?;
            let mut registry = ctx.accounts.registry.load_mut()?;

            user_account.authority = user_authority;
            user_account.user_type = user_type;
            user_account.lat = lat;
            user_account.long = long;
            user_account.status = UserStatus::Active;
            user_account.registered_at = Clock::get()?.unix_timestamp;
            user_account.created_at = user_account.registered_at;
            user_account.meter_count = 0;

            registry.user_count += 1;

            emit!(UserRegistered {
                user: user_authority,
                user_type,
                lat,
                long,
                timestamp: user_account.registered_at,
            });

            msg!(
                "User registered: {}. Type: {:?}. Count: {}",
                user_authority,
                user_type,
                registry.user_count
            );
        });
        Ok(())
    }

    /// Register a smart meter for an existing user
    pub fn register_meter(
        ctx: Context<RegisterMeter>,
        meter_id: String,
        meter_type: MeterType,
    ) -> Result<()> {
        compute_fn!("register_meter" => {
            let owner = ctx.accounts.owner.key();
            let mut meter_account = ctx.accounts.meter_account.load_init()?;
            let mut user_account = ctx.accounts.user_account.load_mut()?;
            let mut registry = ctx.accounts.registry.load_mut()?;

            // Basic owner-user validation (though PDA seeds also protect this)
            require_keys_eq!(
                owner,
                user_account.authority,
                RegistryError::UnauthorizedUser
            );

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
            registry.meter_count += 1;
            registry.active_meter_count += 1;

            emit!(MeterRegistered {
                meter_id: meter_id.clone(),
                owner,
                meter_type,
                timestamp: meter_account.registered_at,
            });

            msg!(
                "Meter registered: {}. Type: {:?}. Total Registry Meters: {}",
                meter_id,
                meter_type,
                registry.meter_count
            );
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
                timestamp: Clock::get()?.unix_timestamp,
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
                timestamp: reading_timestamp,
            });
        });
        Ok(())
    }

    /// Set meter status (owner or authority)
    pub fn set_meter_status(
        ctx: Context<SetMeterStatus>,
        new_status: MeterStatus,
    ) -> Result<()> {
        compute_fn!("set_meter_status" => {
            let mut meter = ctx.accounts.meter_account.load_mut()?;
            let mut registry = ctx.accounts.registry.load_mut()?;
            
            let is_owner = ctx.accounts.authority.key() == meter.owner;
            let is_admin = ctx.accounts.authority.key() == registry.authority;
            require!(is_owner || is_admin, RegistryError::UnauthorizedUser);
            
            let old_status = meter.status;
            
            if old_status == MeterStatus::Active && new_status != MeterStatus::Active {
                registry.active_meter_count = registry.active_meter_count.saturating_sub(1);
            } else if old_status != MeterStatus::Active && new_status == MeterStatus::Active {
                registry.active_meter_count += 1;
            }
            
            meter.status = new_status;
            
            emit!(MeterStatusUpdated {
                meter_id: bytes32_to_string(&meter.meter_id),
                owner: meter.owner,
                old_status,
                new_status,
                timestamp: Clock::get()?.unix_timestamp,
            });
        });
        Ok(())
    }

    /// Deactivate a meter permanently (owner only)
    pub fn deactivate_meter(ctx: Context<DeactivateMeter>) -> Result<()> {
        compute_fn!("deactivate_meter" => {
            let mut meter = ctx.accounts.meter_account.load_mut()?;
            let mut user = ctx.accounts.user_account.load_mut()?;
            let mut registry = ctx.accounts.registry.load_mut()?;
            
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
                registry.active_meter_count = registry.active_meter_count.saturating_sub(1);
            }
            
            meter.status = MeterStatus::Inactive;
            user.meter_count = user.meter_count.saturating_sub(1);
            
            emit!(MeterDeactivated {
                meter_id: bytes32_to_string(&meter.meter_id),
                owner: meter.owner,
                final_generation: meter.total_generation,
                final_consumption: meter.total_consumption,
                timestamp: Clock::get()?.unix_timestamp,
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
                timestamp: Clock::get()?.unix_timestamp,
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
                timestamp: Clock::get()?.unix_timestamp,
            });

            let cpi_program = ctx.accounts.energy_token_program.to_account_info();
            let cpi_accounts = energy_token::cpi::accounts::MintTokensDirect {
                token_info: ctx.accounts.token_info.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                user_token_account: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
            };

            let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
            energy_token::cpi::mint_tokens_direct(cpi_ctx, new_tokens_to_mint)?;
        });

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
#[instruction(user_type: UserType, lat: f64, long: f64)]
pub struct RegisterUser<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<UserAccount>(),
        seeds = [b"user", authority.key().as_ref()],
        bump
    )]
    pub user_account: AccountLoader<'info, UserAccount>,

    #[account(mut)]
    pub registry: AccountLoader<'info, Registry>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(meter_id: String)]
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
pub struct SetMeterStatus<'info> {
    #[account(mut)]
    pub registry: AccountLoader<'info, Registry>,
    
    #[account(mut)]
    pub meter_account: AccountLoader<'info, MeterAccount>,
    
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct DeactivateMeter<'info> {
    #[account(mut)]
    pub meter_account: AccountLoader<'info, MeterAccount>,

    #[account(mut)]
    pub user_account: AccountLoader<'info, UserAccount>,
    
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
    pub authority: AccountInfo<'info>,

    /// The energy token program
    /// CHECK: This is validated by the CPI call
    pub energy_token_program: AccountInfo<'info>,

    /// CHECK: SPL Token program
    pub token_program: AccountInfo<'info>,
}

