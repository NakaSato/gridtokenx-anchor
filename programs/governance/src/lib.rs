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

declare_id!("opUKK54PxUHNgzkPAaJioCSWxx8P7p3tYeotyixE84W");

#[cfg(feature = "localnet")]
use compute_debug::{compute_fn, compute_checkpoint};

#[cfg(not(feature = "localnet"))]
macro_rules! compute_fn {
    ($name:expr => $block:block) => { $block };
}
#[cfg(not(feature = "localnet"))]
macro_rules! compute_checkpoint {
    ($name:expr) => {};
}

#[program]
pub mod governance {
    use super::*;

    pub fn initialize_poa(ctx: Context<InitializePoa>) -> Result<()> {
        compute_fn!("initialize_poa" => {
            handlers::initialize::handler(ctx)
        })
    }

    pub fn emergency_pause(ctx: Context<EmergencyControl>) -> Result<()> {
        compute_fn!("emergency_pause" => {
            handlers::emergency::pause(ctx)
        })
    }

    pub fn emergency_unpause(ctx: Context<EmergencyControl>) -> Result<()> {
        compute_fn!("emergency_unpause" => {
            handlers::emergency::unpause(ctx)
        })
    }

    pub fn issue_erc(
        ctx: Context<IssueErc>,
        certificate_id: String,
        energy_amount: u64,
        renewable_source: String,
        validation_data: String,
    ) -> Result<()> {
        compute_fn!("issue_erc" => {
            handlers::erc::issue(
                ctx,
                certificate_id,
                energy_amount,
                renewable_source,
                validation_data,
            )
        })
    }

    pub fn validate_erc_for_trading(ctx: Context<ValidateErc>) -> Result<()> {
        compute_fn!("validate_erc_for_trading" => {
            handlers::erc::validate_for_trading(ctx)
        })
    }

    pub fn update_governance_config(
        ctx: Context<UpdateGovernanceConfig>,
        erc_validation_enabled: bool,
    ) -> Result<()> {
        compute_fn!("update_governance_config" => {
            handlers::config::update_governance_config(ctx, erc_validation_enabled)
        })
    }

    pub fn set_maintenance_mode(
        ctx: Context<UpdateGovernanceConfig>,
        maintenance_enabled: bool,
    ) -> Result<()> {
        compute_fn!("set_maintenance_mode" => {
            handlers::config::set_maintenance_mode(ctx, maintenance_enabled)
        })
    }

    pub fn update_erc_limits(
        ctx: Context<UpdateGovernanceConfig>,
        min_energy_amount: u64,
        max_erc_amount: u64,
        erc_validity_period: i64,
    ) -> Result<()> {
        compute_fn!("update_erc_limits" => {
            handlers::config::update_erc_limits(
                ctx,
                min_energy_amount,
                max_erc_amount,
                erc_validity_period,
            )
        })
    }

    pub fn update_authority_info(
        ctx: Context<UpdateGovernanceConfig>,
        contact_info: String,
    ) -> Result<()> {
        compute_fn!("update_authority_info" => {
            handlers::config::update_authority_info(ctx, contact_info)
        })
    }

    pub fn get_governance_stats(ctx: Context<GetGovernanceStats>) -> Result<GovernanceStats> {
        compute_fn!("get_governance_stats" => {
            handlers::stats::handler(ctx)
        })
    }
    
    pub fn revoke_erc(ctx: Context<RevokeErc>, reason: String) -> Result<()> {
        compute_fn!("revoke_erc" => {
            handlers::erc::revoke(ctx, reason)
        })
    }
    
    pub fn transfer_erc(ctx: Context<TransferErc>) -> Result<()> {
        compute_fn!("transfer_erc" => {
            handlers::erc::transfer(ctx)
        })
    }
    
    pub fn propose_authority_change(
        ctx: Context<ProposeAuthorityChange>,
        new_authority: Pubkey,
    ) -> Result<()> {
        compute_fn!("propose_authority_change" => {
            handlers::authority::propose_authority_change(ctx, new_authority)
        })
    }
    
    pub fn approve_authority_change(ctx: Context<ApproveAuthorityChange>) -> Result<()> {
        compute_fn!("approve_authority_change" => {
            handlers::authority::approve_authority_change(ctx)
        })
    }
    
    pub fn cancel_authority_change(ctx: Context<CancelAuthorityChange>) -> Result<()> {
        compute_fn!("cancel_authority_change" => {
            handlers::authority::cancel_authority_change(ctx)
        })
    }
    
    pub fn set_oracle_authority(
        ctx: Context<SetOracleAuthority>,
        oracle_authority: Pubkey,
        min_confidence: u8,
        require_validation: bool,
    ) -> Result<()> {
        compute_fn!("set_oracle_authority" => {
            handlers::authority::set_oracle_authority(ctx, oracle_authority, min_confidence, require_validation)
        })
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
