#![allow(deprecated)]

use anchor_lang::prelude::*;

// Module declarations
mod errors;
mod events;
mod instructions;
mod state;

#[cfg(test)]
mod size_test;

pub use errors::*;
pub use events::*;
// Handler fns share names with the #[program]-generated re-exports; the glob is
// deliberate (Context structs + client accounts must be crate-public).
#[allow(ambiguous_glob_reexports)]
pub use instructions::*;
pub use state::*;

declare_id!("FokVuBSPXP11aeL7VZWd8n8aVAhWqVpyPZETToSxdvTS");

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

#[program]
pub mod governance {
    use super::*;

    pub fn initialize_governance(ctx: Context<InitializeGovernance>) -> Result<()> {
        compute_fn!("initialize_governance" => {
            instructions::initialize_governance(ctx)
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
            instructions::issue_erc(
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
            instructions::validate_erc_for_trading(ctx)
        })
    }

    /// Initialize the fungible REC mint (1 token = 1 MWh, 6 decimals). Run once.
    pub fn init_rec_mint(ctx: Context<InitRecMint>) -> Result<()> {
        compute_fn!("init_rec_mint" => {
            instructions::init_rec_mint(ctx)
        })
    }

    /// Retire (burn) REC tokens; `amount` is base units (6 decimals).
    pub fn retire_rec(ctx: Context<RetireRec>, amount: u64) -> Result<()> {
        compute_fn!("retire_rec" => {
            instructions::retire_rec(ctx, amount)
        })
    }

    pub fn update_governance_config(
        ctx: Context<UpdateGovernanceConfig>,
        erc_validation_enabled: bool,
        allow_certificate_transfers: bool,
    ) -> Result<()> {
        compute_fn!("update_governance_config" => {
            instructions::update_governance_config(ctx, erc_validation_enabled, allow_certificate_transfers)
        })
    }

    pub fn set_maintenance_mode(
        ctx: Context<UpdateGovernanceConfig>,
        maintenance_enabled: bool,
    ) -> Result<()> {
        compute_fn!("set_maintenance_mode" => {
            instructions::set_maintenance_mode(ctx, maintenance_enabled)
        })
    }

    pub fn update_erc_limits(
        ctx: Context<UpdateGovernanceConfig>,
        min_energy_amount: u64,
        max_erc_amount: u64,
        erc_validity_period: i64,
    ) -> Result<()> {
        compute_fn!("update_erc_limits" => {
            instructions::update_erc_limits(
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
            instructions::update_authority_info(ctx, contact_info)
        })
    }

    pub fn get_governance_stats(ctx: Context<GetGovernanceStats>) -> Result<GovernanceStats> {
        let res = compute_fn!("get_governance_stats" => {
            instructions::get_governance_stats(ctx)
        })?;
        Ok(res)
    }

    pub fn revoke_erc(ctx: Context<RevokeErc>, reason: String) -> Result<()> {
        compute_fn!("revoke_erc" => {
            instructions::revoke_erc(ctx, reason)
        })
    }

    pub fn transfer_erc(ctx: Context<TransferErc>) -> Result<()> {
        compute_fn!("transfer_erc" => {
            instructions::transfer_erc(ctx)
        })
    }

    pub fn propose_authority_change(
        ctx: Context<ProposeAuthorityChange>,
        new_authority: Pubkey,
    ) -> Result<()> {
        compute_fn!("propose_authority_change" => {
            instructions::propose_authority_change(ctx, new_authority)
        })
    }

    pub fn approve_authority_change(ctx: Context<ApproveAuthorityChange>) -> Result<()> {
        compute_fn!("approve_authority_change" => {
            instructions::approve_authority_change(ctx)
        })
    }

    pub fn cancel_authority_change(ctx: Context<CancelAuthorityChange>) -> Result<()> {
        compute_fn!("cancel_authority_change" => {
            instructions::cancel_authority_change(ctx)
        })
    }

    pub fn set_oracle_authority(
        ctx: Context<SetOracleAuthority>,
        oracle_authority: Pubkey,
        min_confidence: u8,
        require_validation: bool,
    ) -> Result<()> {
        compute_fn!("set_oracle_authority" => {
            instructions::set_oracle_authority(ctx, oracle_authority, min_confidence, require_validation)
        })
    }

    // === AGGREGATOR ALLOW-LIST (Governance admission of off-chain validator nodes) ===

    pub fn admit_aggregator(ctx: Context<AdmitAggregator>, aggregator: Pubkey, segment: u8) -> Result<()> {
        compute_fn!("admit_aggregator" => {
            instructions::admit_aggregator(ctx, aggregator, segment)
        })
    }

    pub fn revoke_aggregator(ctx: Context<RevokeAggregator>) -> Result<()> {
        compute_fn!("revoke_aggregator" => {
            instructions::revoke_aggregator(ctx)
        })
    }

    // === DAO GOVERNANCE ===

    pub fn initialize_zone_config(
        ctx: Context<InitializeZoneConfig>,
        zone_id: i32,
        incentive_multiplier: u64,
        wheeling_charge: u64,
    ) -> Result<()> {
        compute_fn!("initialize_zone_config" => {
            instructions::initialize_zone_config(ctx, zone_id, incentive_multiplier, wheeling_charge)
        })
    }

    pub fn create_proposal(
        ctx: Context<CreateProposal>,
        target_zone: i32,
        proposal_id: u64,
        parameter: GridParameter,
        new_value: u64,
        voting_period_seconds: i64,
    ) -> Result<()> {
        compute_fn!("create_proposal" => {
            instructions::create_proposal(ctx, target_zone, proposal_id, parameter, new_value, voting_period_seconds)
        })
    }

    pub fn cast_vote(ctx: Context<CastVote>, choice: bool) -> Result<()> {
        compute_fn!("cast_vote" => {
            instructions::cast_vote(ctx, choice)
        })
    }

    pub fn execute_proposal(ctx: Context<ExecuteProposal>) -> Result<()> {
        compute_fn!("execute_proposal" => {
            instructions::execute_proposal(ctx)
        })
    }
}
