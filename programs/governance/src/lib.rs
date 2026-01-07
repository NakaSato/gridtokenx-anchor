#![allow(deprecated)]

use anchor_lang::prelude::*;

// Module declarations
mod errors;
mod events;
mod handlers;
mod state;

pub use errors::*;
pub use events::*;
pub use state::*;

declare_id!("2u2yvp6cBqegv7ApcLfvaFXd9WBrrCy6o3bhxtWgxpC5");

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
    
    // ========== NEW INSTRUCTIONS: ERC Revocation ==========
    
    /// Revoke an ERC certificate - REC authority only
    /// Revoked certificates cannot be traded or used
    pub fn revoke_erc(ctx: Context<RevokeErc>, reason: String) -> Result<()> {
        handlers::erc::revoke(ctx, reason)
    }
    
    // ========== NEW INSTRUCTIONS: Certificate Transfer ==========
    
    /// Transfer an ERC certificate to a new owner
    /// Requires: transfers enabled, certificate valid & validated for trading
    pub fn transfer_erc(ctx: Context<TransferErc>) -> Result<()> {
        handlers::erc::transfer(ctx)
    }
    
    // ========== NEW INSTRUCTIONS: Multi-sig Authority ==========
    
    /// Propose a new authority (step 1 of 2-step transfer)
    /// Current authority proposes, new authority must approve within 48h
    pub fn propose_authority_change(
        ctx: Context<ProposeAuthorityChange>,
        new_authority: Pubkey,
    ) -> Result<()> {
        handlers::authority::propose_authority_change(ctx, new_authority)
    }
    
    /// Approve authority change (step 2 of 2-step transfer)
    /// Must be called by the proposed new authority
    pub fn approve_authority_change(ctx: Context<ApproveAuthorityChange>) -> Result<()> {
        handlers::authority::approve_authority_change(ctx)
    }
    
    /// Cancel a pending authority change
    /// Can only be called by current authority
    pub fn cancel_authority_change(ctx: Context<CancelAuthorityChange>) -> Result<()> {
        handlers::authority::cancel_authority_change(ctx)
    }
    
    // ========== NEW INSTRUCTIONS: Oracle Integration ==========
    
    /// Set oracle authority for data validation
    /// Configures oracle-based validation for ERC issuance
    pub fn set_oracle_authority(
        ctx: Context<SetOracleAuthority>,
        oracle_authority: Pubkey,
        min_confidence: u8,
        require_validation: bool,
    ) -> Result<()> {
        handlers::authority::set_oracle_authority(ctx, oracle_authority, min_confidence, require_validation)
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
    /// CHECK: Manual validation of Registry-owned account 
    pub meter_account: AccountInfo<'info>,
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

// ========== NEW ACCOUNT STRUCTURES: ERC Revocation ==========

#[derive(Accounts)]
pub struct RevokeErc<'info> {
    #[account(
        mut,
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

// ========== NEW ACCOUNT STRUCTURES: Certificate Transfer ==========

#[derive(Accounts)]
pub struct TransferErc<'info> {
    #[account(
        seeds = [b"poa_config"],
        bump
    )]
    pub poa_config: Account<'info, PoAConfig>,
    #[account(
        mut,
        seeds = [b"erc_certificate", erc_certificate.certificate_id.as_bytes()],
        bump,
        constraint = erc_certificate.owner == current_owner.key() @ GovernanceError::UnauthorizedAuthority
    )]
    pub erc_certificate: Account<'info, ErcCertificate>,
    /// Current owner of the certificate
    pub current_owner: Signer<'info>,
    /// New owner to transfer to
    /// CHECK: This is the new owner address, validated in handler
    pub new_owner: AccountInfo<'info>,
}

// ========== NEW ACCOUNT STRUCTURES: Multi-sig Authority ==========

#[derive(Accounts)]
pub struct ProposeAuthorityChange<'info> {
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
pub struct ApproveAuthorityChange<'info> {
    #[account(
        mut,
        seeds = [b"poa_config"],
        bump
    )]
    pub poa_config: Account<'info, PoAConfig>,
    /// The proposed new authority who must sign to approve
    pub new_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct CancelAuthorityChange<'info> {
    #[account(
        mut,
        seeds = [b"poa_config"],
        bump,
        has_one = authority @ GovernanceError::UnauthorizedAuthority
    )]
    pub poa_config: Account<'info, PoAConfig>,
    pub authority: Signer<'info>,
}

// ========== NEW ACCOUNT STRUCTURES: Oracle Integration ==========

#[derive(Accounts)]
pub struct SetOracleAuthority<'info> {
    #[account(
        mut,
        seeds = [b"poa_config"],
        bump,
        has_one = authority @ GovernanceError::UnauthorizedAuthority
    )]
    pub poa_config: Account<'info, PoAConfig>,
    pub authority: Signer<'info>,
}
