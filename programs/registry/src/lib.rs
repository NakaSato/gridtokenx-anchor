#![allow(deprecated)]

use anchor_lang::prelude::*;
use base64::{engine::general_purpose, Engine as _};

declare_id!("DiJi39HDJQwEYGxSwL6qtLUtWzbAP5irv1S4Tube9ouH");

#[program]
pub mod registry {
    use super::*;

    /// Initialize the registry with REC authority
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let registry = &mut ctx.accounts.registry;
        registry.authority = ctx.accounts.authority.key();
        registry.oracle_authority = None;  // Set later via set_oracle_authority
        registry.user_count = 0;
        registry.meter_count = 0;
        registry.active_meter_count = 0;
        registry.created_at = Clock::get()?.unix_timestamp;

        emit!(RegistryInitialized {
            authority: ctx.accounts.authority.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Set the oracle authority (admin only)
    pub fn set_oracle_authority(
        ctx: Context<SetOracleAuthority>,
        oracle: Pubkey,
    ) -> Result<()> {
        let registry = &mut ctx.accounts.registry;
        
        require!(
            ctx.accounts.authority.key() == registry.authority,
            ErrorCode::UnauthorizedAuthority
        );
        
        let old_oracle = registry.oracle_authority;
        registry.oracle_authority = Some(oracle);
        
        emit!(OracleAuthoritySet {
            old_oracle,
            new_oracle: oracle,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    /// Register a new user in the P2P energy trading system
    pub fn register_user(
        ctx: Context<RegisterUser>,
        user_type: UserType,
        location: String,
    ) -> Result<()> {
        let user_account = &mut ctx.accounts.user_account;
        let registry = &mut ctx.accounts.registry;

        // Set user account data
        user_account.authority = ctx.accounts.user_authority.key();
        user_account.user_type = user_type;
        user_account.location = location.clone();
        user_account.status = UserStatus::Active;
        user_account.registered_at = Clock::get()?.unix_timestamp;
        user_account.meter_count = 0;
        user_account.created_at = Clock::get()?.unix_timestamp; // For backward compatibility

        // Update registry counters
        registry.user_count += 1;

        emit!(UserRegistered {
            user: ctx.accounts.user_authority.key(),
            user_type,
            location,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Register a smart meter for an existing user
    pub fn register_meter(
        ctx: Context<RegisterMeter>,
        meter_id: String,
        meter_type: MeterType,
    ) -> Result<()> {
        let meter_account = &mut ctx.accounts.meter_account;
        let user_account = &mut ctx.accounts.user_account;
        let registry = &mut ctx.accounts.registry;

        // Verify user owns this operation
        require!(
            ctx.accounts.user_authority.key() == user_account.authority,
            ErrorCode::UnauthorizedUser
        );

        // Set meter account data
        meter_account.meter_id = meter_id.clone();
        meter_account.owner = ctx.accounts.user_authority.key();
        meter_account.meter_type = meter_type;
        meter_account.status = MeterStatus::Active;
        meter_account.registered_at = Clock::get()?.unix_timestamp;
        meter_account.last_reading_at = 0;
        meter_account.total_generation = 0;
        meter_account.total_consumption = 0;
        meter_account.settled_net_generation = 0; // Initialize GRID token tracker
        meter_account.claimed_erc_generation = 0; // Initialize ERC certificate tracker

        // Update counters
        user_account.meter_count += 1;
        registry.meter_count += 1;
        registry.active_meter_count += 1;

        emit!(MeterRegistered {
            meter_id: meter_id.clone(),
            owner: ctx.accounts.user_authority.key(),
            meter_type,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Update user status (admin only)
    pub fn update_user_status(
        ctx: Context<UpdateUserStatus>,
        new_status: UserStatus,
    ) -> Result<()> {
        let user_account = &mut ctx.accounts.user_account;
        let registry = &ctx.accounts.registry;

        // Only registry authority can update user status
        require!(
            ctx.accounts.authority.key() == registry.authority,
            ErrorCode::UnauthorizedAuthority
        );

        let old_status = user_account.status;
        user_account.status = new_status;

        emit!(UserStatusUpdated {
            user: user_account.authority,
            old_status,
            new_status,
            timestamp: Clock::get()?.unix_timestamp,
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
        let registry = &ctx.accounts.registry;
        let meter_account = &mut ctx.accounts.meter_account;
        
        // Validate oracle authority
        // Validate oracle authority
        let auth_key = registry.oracle_authority.ok_or(ErrorCode::OracleNotConfigured)?;
        require!(
            ctx.accounts.oracle_authority.key() == auth_key,
            ErrorCode::UnauthorizedOracle
        );
        
        // Validate meter is active
        require!(
            meter_account.status == MeterStatus::Active,
            ErrorCode::InvalidMeterStatus
        );
        
        // Validate timestamp (must be newer than last reading)
        require!(
            reading_timestamp > meter_account.last_reading_at,
            ErrorCode::StaleReading
        );
        
        // Validate reading deltas (max 1 GWh per reading as safety limit)
        const MAX_READING_DELTA: u64 = 1_000_000_000_000; // 1 GWh in Wh
        require!(
            energy_generated <= MAX_READING_DELTA,
            ErrorCode::ReadingTooHigh
        );
        require!(
            energy_consumed <= MAX_READING_DELTA,
            ErrorCode::ReadingTooHigh
        );

        // Update meter data
        meter_account.last_reading_at = reading_timestamp;
        meter_account.total_generation += energy_generated;
        meter_account.total_consumption += energy_consumed;

        emit!(MeterReadingUpdated {
            meter_id: meter_account.meter_id.clone(),
            owner: meter_account.owner,
            energy_generated,
            energy_consumed,
            timestamp: reading_timestamp,
        });

        Ok(())
    }

    /// Set meter status (owner or authority)
    pub fn set_meter_status(
        ctx: Context<SetMeterStatus>,
        new_status: MeterStatus,
    ) -> Result<()> {
        let meter = &mut ctx.accounts.meter_account;
        let registry = &mut ctx.accounts.registry;
        
        // Only owner or registry authority can change status
        let is_owner = ctx.accounts.authority.key() == meter.owner;
        let is_admin = ctx.accounts.authority.key() == registry.authority;
        require!(is_owner || is_admin, ErrorCode::UnauthorizedUser);
        
        let old_status = meter.status;
        
        // Update active meter count
        if old_status == MeterStatus::Active && new_status != MeterStatus::Active {
            registry.active_meter_count = registry.active_meter_count.saturating_sub(1);
        } else if old_status != MeterStatus::Active && new_status == MeterStatus::Active {
            registry.active_meter_count += 1;
        }
        
        meter.status = new_status;
        
        emit!(MeterStatusUpdated {
            meter_id: meter.meter_id.clone(),
            owner: meter.owner,
            old_status,
            new_status,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    /// Deactivate a meter permanently (owner only)
    pub fn deactivate_meter(ctx: Context<DeactivateMeter>) -> Result<()> {
        let meter = &mut ctx.accounts.meter_account;
        let user = &mut ctx.accounts.user_account;
        let registry = &mut ctx.accounts.registry;
        
        require!(
            ctx.accounts.owner.key() == meter.owner,
            ErrorCode::UnauthorizedUser
        );
        
        require!(
            meter.status != MeterStatus::Inactive,
            ErrorCode::AlreadyInactive
        );
        
        // Update counters if was active
        if meter.status == MeterStatus::Active {
            registry.active_meter_count = registry.active_meter_count.saturating_sub(1);
        }
        
        meter.status = MeterStatus::Inactive;
        user.meter_count = user.meter_count.saturating_sub(1);
        
        emit!(MeterDeactivated {
            meter_id: meter.meter_id.clone(),
            owner: meter.owner,
            final_generation: meter.total_generation,
            final_consumption: meter.total_consumption,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    /// Verify if a user is valid and active
    pub fn is_valid_user(ctx: Context<IsValidUser>) -> Result<bool> {
        let user_account = &ctx.accounts.user_account;
        Ok(user_account.status == UserStatus::Active)
    }

    /// Verify if a meter is valid and active
    pub fn is_valid_meter(ctx: Context<IsValidMeter>) -> Result<bool> {
        let meter_account = &ctx.accounts.meter_account;
        Ok(meter_account.status == MeterStatus::Active)
    }

    /// Calculate unsettled net generation ready for tokenization
    /// This is a view function that returns how much energy can be minted as GRID tokens
    pub fn get_unsettled_balance(ctx: Context<GetUnsettledBalance>) -> Result<u64> {
        let meter = &ctx.accounts.meter_account;

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
        let meter = &mut ctx.accounts.meter_account;

        // Verify meter is active
        require!(
            meter.status == MeterStatus::Active,
            ErrorCode::InvalidMeterStatus
        );

        // Calculate current net generation (total produced - total consumed)
        let current_net_gen = meter
            .total_generation
            .saturating_sub(meter.total_consumption);

        // Calculate new tokens to mint (what hasn't been settled yet)
        let new_tokens_to_mint = current_net_gen.saturating_sub(meter.settled_net_generation);

        // Only proceed if there's something new to settle
        require!(new_tokens_to_mint > 0, ErrorCode::NoUnsettledBalance);

        // Update the settled tracker to prevent double-minting
        meter.settled_net_generation = current_net_gen;

        // Encode settlement data as base64 for external systems
        let settlement_data = format!(
            "{}:{}:{}:{}",
            meter.meter_id, meter.owner, new_tokens_to_mint, current_net_gen
        );
        let encoded_data = general_purpose::STANDARD.encode(settlement_data.as_bytes());
        msg!("Settlement data (base64): {}", encoded_data);

        emit!(MeterBalanceSettled {
            meter_id: meter.meter_id.clone(),
            owner: meter.owner,
            tokens_to_mint: new_tokens_to_mint,
            total_settled: current_net_gen,
            timestamp: Clock::get()?.unix_timestamp,
        });

        // Return the amount to mint so the energy_token program can use it
        Ok(new_tokens_to_mint)
    }

    /// Settle meter balance and automatically mint GRID tokens via CPI
    /// This is a convenience function that combines settlement + minting in one transaction
    pub fn settle_and_mint_tokens(ctx: Context<SettleAndMintTokens>) -> Result<()> {
        let meter = &mut ctx.accounts.meter_account;

        // Verify meter is active
        require!(
            meter.status == MeterStatus::Active,
            ErrorCode::InvalidMeterStatus
        );

        // Verify meter owner
        require!(
            ctx.accounts.meter_owner.key() == meter.owner,
            ErrorCode::UnauthorizedUser
        );

        // Calculate current net generation (total produced - total consumed)
        let current_net_gen = meter
            .total_generation
            .saturating_sub(meter.total_consumption);

        // Calculate new tokens to mint (what hasn't been settled yet)
        let new_tokens_to_mint = current_net_gen.saturating_sub(meter.settled_net_generation);

        // Only proceed if there's something new to settle
        require!(new_tokens_to_mint > 0, ErrorCode::NoUnsettledBalance);

        // Update the settled tracker to prevent double-minting
        meter.settled_net_generation = current_net_gen;

        msg!(
            "Settlement complete: {} Wh ready to mint for meter {}",
            new_tokens_to_mint,
            meter.meter_id
        );

        emit!(MeterBalanceSettled {
            meter_id: meter.meter_id.clone(),
            owner: meter.owner,
            tokens_to_mint: new_tokens_to_mint,
            total_settled: current_net_gen,
            timestamp: Clock::get()?.unix_timestamp,
        });

        // CPI to energy_token program to mint tokens
        msg!(
            "Calling energy_token program to mint {} tokens",
            new_tokens_to_mint
        );

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

        msg!(
            "Successfully minted {} GRID tokens via CPI",
            new_tokens_to_mint
        );

        Ok(())
    }
}

// Account structs
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Registry::INIT_SPACE,
        seeds = [b"registry"],
        bump
    )]
    pub registry: Account<'info, Registry>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(user_type: UserType, location: String)]
pub struct RegisterUser<'info> {
    #[account(mut)]
    pub registry: Account<'info, Registry>,

    #[account(
        init,
        payer = user_authority,
        space = 8 + UserAccount::INIT_SPACE,
        seeds = [b"user", user_authority.key().as_ref()],
        bump
    )]
    pub user_account: Account<'info, UserAccount>,

    #[account(mut)]
    pub user_authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(meter_id: String)]
pub struct RegisterMeter<'info> {
    #[account(mut)]
    pub registry: Account<'info, Registry>,

    #[account(mut)]
    pub user_account: Account<'info, UserAccount>,

    #[account(
        init,
        payer = user_authority,
        space = 8 + MeterAccount::INIT_SPACE,
        seeds = [b"meter", meter_id.as_bytes()],
        bump
    )]
    pub meter_account: Account<'info, MeterAccount>,

    #[account(mut)]
    pub user_authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateUserStatus<'info> {
    #[account(has_one = authority @ ErrorCode::UnauthorizedAuthority)]
    pub registry: Account<'info, Registry>,

    #[account(mut)]
    pub user_account: Account<'info, UserAccount>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateMeterReading<'info> {
    pub registry: Account<'info, Registry>,
    
    #[account(mut)]
    pub meter_account: Account<'info, MeterAccount>,

    pub oracle_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetOracleAuthority<'info> {
    #[account(mut)]
    pub registry: Account<'info, Registry>,
    
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetMeterStatus<'info> {
    #[account(mut)]
    pub registry: Account<'info, Registry>,
    
    #[account(mut)]
    pub meter_account: Account<'info, MeterAccount>,
    
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct DeactivateMeter<'info> {
    #[account(mut)]
    pub registry: Account<'info, Registry>,
    
    #[account(mut)]
    pub user_account: Account<'info, UserAccount>,
    
    #[account(mut)]
    pub meter_account: Account<'info, MeterAccount>,
    
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct IsValidUser<'info> {
    pub user_account: Account<'info, UserAccount>,
}

#[derive(Accounts)]
pub struct IsValidMeter<'info> {
    pub meter_account: Account<'info, MeterAccount>,
}

#[derive(Accounts)]
pub struct GetUnsettledBalance<'info> {
    pub meter_account: Account<'info, MeterAccount>,
}

#[derive(Accounts)]
pub struct SettleMeterBalance<'info> {
    #[account(mut)]
    pub meter_account: Account<'info, MeterAccount>,

    pub meter_owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct SettleAndMintTokens<'info> {
    #[account(mut)]
    pub meter_account: Account<'info, MeterAccount>,

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

// Data structs
#[account]
#[derive(InitSpace)]
pub struct Registry {
    pub authority: Pubkey,
    pub oracle_authority: Option<Pubkey>,  // Authorized oracle for meter readings
    pub user_count: u64,
    pub meter_count: u64,
    pub active_meter_count: u64,           // Track active meters separately
    pub created_at: i64,
}

#[account]
#[derive(InitSpace)]
pub struct UserAccount {
    pub authority: Pubkey,   // Wallet address that owns this account
    pub user_type: UserType, // Prosumer or Consumer
    #[max_len(100)]
    pub location: String, // User's location (max 100 chars)
    pub status: UserStatus,  // Active, Suspended, or Inactive
    pub registered_at: i64,  // Unix timestamp of registration
    pub meter_count: u32,    // Number of meters owned
    pub created_at: i64,     // Backward compatibility field
}

#[account]
#[derive(InitSpace)]
pub struct MeterAccount {
    #[max_len(50)]
    pub meter_id: String, // Unique meter identifier (max 50 chars)
    pub owner: Pubkey,          // User who owns this meter
    pub meter_type: MeterType,  // Solar, Wind, Battery, or Grid
    pub status: MeterStatus,    // Active, Inactive, or Maintenance
    pub registered_at: i64,     // When meter was registered
    pub last_reading_at: i64,   // Last time reading was updated
    pub total_generation: u64,  // Cumulative energy generated (in smallest units)
    pub total_consumption: u64, // Cumulative energy consumed (in smallest units)

    // --- TOKENIZATION TRACKING ---
    // FIELD 1: Tracks the "net generation" that has already been
    // settled and minted into GRID tokens (the tradable commodity).
    // This prevents double-minting of GRID tokens.
    pub settled_net_generation: u64,

    // FIELD 2: Tracks the "total generation" that has already been
    // claimed and converted into ERCs (the green certificates).
    // This prevents double-claiming of renewable certificates.
    pub claimed_erc_generation: u64,
}

// Enums
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum UserType {
    Prosumer,
    Consumer,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum UserStatus {
    Active,
    Suspended,
    Inactive,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum MeterType {
    Solar,
    Wind,
    Battery,
    Grid,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum MeterStatus {
    Active,
    Inactive,
    Maintenance,
}

// Events
#[event]
pub struct RegistryInitialized {
    pub authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct UserRegistered {
    pub user: Pubkey,
    pub user_type: UserType,
    pub location: String,
    pub timestamp: i64,
}

#[event]
pub struct MeterRegistered {
    pub meter_id: String,
    pub owner: Pubkey,
    pub meter_type: MeterType,
    pub timestamp: i64,
}

#[event]
pub struct UserStatusUpdated {
    pub user: Pubkey,
    pub old_status: UserStatus,
    pub new_status: UserStatus,
    pub timestamp: i64,
}

#[event]
pub struct MeterReadingUpdated {
    pub meter_id: String,
    pub owner: Pubkey,
    pub energy_generated: u64,
    pub energy_consumed: u64,
    pub timestamp: i64,
}

#[event]
pub struct MeterBalanceSettled {
    pub meter_id: String,
    pub owner: Pubkey,
    pub tokens_to_mint: u64,
    pub total_settled: u64,
    pub timestamp: i64,
}

#[event]
pub struct OracleAuthoritySet {
    pub old_oracle: Option<Pubkey>,
    pub new_oracle: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct MeterStatusUpdated {
    pub meter_id: String,
    pub owner: Pubkey,
    pub old_status: MeterStatus,
    pub new_status: MeterStatus,
    pub timestamp: i64,
}

#[event]
pub struct MeterDeactivated {
    pub meter_id: String,
    pub owner: Pubkey,
    pub final_generation: u64,
    pub final_consumption: u64,
    pub timestamp: i64,
}

// Errors
#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized user")]
    UnauthorizedUser,
    #[msg("Unauthorized authority")]
    UnauthorizedAuthority,
    #[msg("Invalid user status")]
    InvalidUserStatus,
    #[msg("Invalid meter status")]
    InvalidMeterStatus,
    #[msg("User not found")]
    UserNotFound,
    #[msg("Meter not found")]
    MeterNotFound,
    #[msg("No unsettled balance to tokenize")]
    NoUnsettledBalance,
    #[msg("Oracle authority not configured")]
    OracleNotConfigured,
    #[msg("Unauthorized oracle - signer is not the configured oracle")]
    UnauthorizedOracle,
    #[msg("Stale reading - timestamp must be newer than last reading")]
    StaleReading,
    #[msg("Reading too high - exceeds maximum delta limit")]
    ReadingTooHigh,
    #[msg("Meter is already inactive")]
    AlreadyInactive,
}
