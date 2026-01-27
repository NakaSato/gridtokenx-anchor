#![allow(deprecated)]

use anchor_lang::prelude::*;

// Module declarations
mod contexts;
mod errors;
mod events;
mod handlers;
mod state;

pub use contexts::*;
pub use errors::*;
pub use events::*;
pub use state::*;

declare_id!("51d3SDcs5coxkiwvcjMzPrKeajTPF9yikw66WezipTva");

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
