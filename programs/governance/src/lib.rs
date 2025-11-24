#![allow(deprecated)]

use anchor_lang::prelude::*;

// Module declarations
mod errors;
mod events;
mod handlers;
mod state;

// Re-exports
pub use errors::*;
pub use events::*;
pub use state::*;

declare_id!("4DY97YYBt4bxvG7xaSmWy3MhYhmA6HoMajBHVqhySvXe");

#[program]
pub mod governance {
    use super::*;

    /// Initialize PoA with single REC authority for ERC certification
    pub fn initialize_poa(ctx: Context<InitializePoa>) -> Result<()> {
        handlers::initialize::handler(ctx)
    }

    /// Emergency pause functionality - REC authority only
    pub fn emergency_pause(ctx: Context<EmergencyControl>) -> Result<()> {
        handlers::emergency::pause(ctx)
    }

    /// Emergency unpause functionality - REC authority only
    pub fn emergency_unpause(ctx: Context<EmergencyControl>) -> Result<()> {
        handlers::emergency::unpause(ctx)
    }

    /// Issue ERC (Energy Renewable Certificate) - REC authority only
    /// This prevents double-claiming by tracking claimed_erc_generation in the meter
    pub fn issue_erc(
        ctx: Context<IssueErc>,
        certificate_id: String,
        energy_amount: u64,
        renewable_source: String,
        validation_data: String,
    ) -> Result<()> {
        handlers::erc::issue(
            ctx,
            certificate_id,
            energy_amount,
            renewable_source,
            validation_data,
        )
    }

    /// Validate ERC for trading - REC authority only
    pub fn validate_erc_for_trading(ctx: Context<ValidateErc>) -> Result<()> {
        handlers::erc::validate_for_trading(ctx)
    }

    /// Update governance configuration - Engineering Department only
    pub fn update_governance_config(
        ctx: Context<UpdateGovernanceConfig>,
        erc_validation_enabled: bool,
    ) -> Result<()> {
        handlers::config::update_governance_config(ctx, erc_validation_enabled)
    }

    /// Set maintenance mode - Engineering Department only
    pub fn set_maintenance_mode(
        ctx: Context<UpdateGovernanceConfig>,
        maintenance_enabled: bool,
    ) -> Result<()> {
        handlers::config::set_maintenance_mode(ctx, maintenance_enabled)
    }

    /// Update ERC limits - Engineering Department only
    pub fn update_erc_limits(
        ctx: Context<UpdateGovernanceConfig>,
        min_energy_amount: u64,
        max_erc_amount: u64,
        erc_validity_period: i64,
    ) -> Result<()> {
        handlers::config::update_erc_limits(
            ctx,
            min_energy_amount,
            max_erc_amount,
            erc_validity_period,
        )
    }

    /// Update authority contact info - Engineering Department only
    pub fn update_authority_info(
        ctx: Context<UpdateGovernanceConfig>,
        contact_info: String,
    ) -> Result<()> {
        handlers::config::update_authority_info(ctx, contact_info)
    }

    /// Get governance statistics
    pub fn get_governance_stats(ctx: Context<GetGovernanceStats>) -> Result<GovernanceStats> {
        handlers::stats::handler(ctx)
    }
}

// ========== ACCOUNT STRUCTURES ==========

#[derive(Accounts)]
pub struct InitializePoa<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + PoAConfig::LEN,
        seeds = [b"poa_config"],
        bump
    )]
    pub poa_config: Account<'info, PoAConfig>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct EmergencyControl<'info> {
    #[account(
        mut,
        seeds = [b"poa_config"],
        bump,
        has_one = authority @ GovernanceError::UnauthorizedAuthority
    )]
    pub poa_config: Account<'info, PoAConfig>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(certificate_id: String)]
pub struct IssueErc<'info> {
    #[account(
        seeds = [b"poa_config"],
        bump,
        has_one = authority @ GovernanceError::UnauthorizedAuthority
    )]
    pub poa_config: Account<'info, PoAConfig>,
    #[account(
        init,
        payer = authority,
        space = 8 + ErcCertificate::LEN,
        seeds = [b"erc_certificate", certificate_id.as_bytes()],
        bump
    )]
    pub erc_certificate: Account<'info, ErcCertificate>,
    /// Meter account from registry program - tracks claimed ERC generation
    #[account(mut)]
    pub meter_account: Account<'info, MeterAccount>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ValidateErc<'info> {
    #[account(
        seeds = [b"poa_config"],
        bump,
        has_one = authority @ GovernanceError::UnauthorizedAuthority
    )]
    pub poa_config: Account<'info, PoAConfig>,
    #[account(
        mut,
        seeds = [b"erc_certificate", erc_certificate.certificate_id.as_bytes()],
        bump
    )]
    pub erc_certificate: Account<'info, ErcCertificate>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateGovernanceConfig<'info> {
    #[account(
        mut,
        seeds = [b"poa_config"],
        bump,
        has_one = authority @ GovernanceError::UnauthorizedAuthority
    )]
    pub poa_config: Account<'info, PoAConfig>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct GetGovernanceStats<'info> {
    #[account(
        seeds = [b"poa_config"],
        bump
    )]
    pub poa_config: Account<'info, PoAConfig>,
}
