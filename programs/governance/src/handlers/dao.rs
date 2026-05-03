use anchor_lang::prelude::*;
use crate::contexts::*;
use crate::state::*;
use crate::errors::GovernanceError;

pub fn create_proposal(
    ctx: Context<CreateProposal>,
    target_zone: i32,
    proposal_id: u64,
    parameter: GridParameter,
    new_value: u64,
    voting_period_seconds: i64,
) -> Result<()> {
    let proposal = &mut ctx.accounts.proposal;
    let clock = Clock::get()?;

    proposal.proposer = ctx.accounts.proposer.key();
    proposal.target_zone = target_zone;
    proposal.proposal_id = proposal_id;
    proposal.parameter = parameter;
    proposal.new_value = new_value;
    proposal.votes_for = 0;
    proposal.votes_against = 0;
    proposal.status = ProposalStatus::Active;
    proposal.expires_at = clock.unix_timestamp + voting_period_seconds;
    proposal.bump = ctx.bumps.proposal;

    msg!("🚀 Proposal created: Zone {}, Param {:?}, Value {}", target_zone, proposal.parameter, new_value);

    Ok(())
}

pub fn cast_vote(
    ctx: Context<CastVote>,
    choice: bool,
) -> Result<()> {
    let proposal = &mut ctx.accounts.proposal;
    let vote_record = &mut ctx.accounts.vote_record;
    let clock = Clock::get()?;

    // 1. Check if proposal is still active
    require!(
        proposal.status == ProposalStatus::Active,
        GovernanceError::InvalidProposalStatus
    );
    require!(
        clock.unix_timestamp < proposal.expires_at,
        GovernanceError::ProposalExpired
    );

    // 2. Determine voting weight
    // In a real system, we'd pull this from the meter_account or staked tokens
    // For now, we use a constant weight or placeholder
    let weight = 100; // Placeholder for "One Meter = 100 Weight"

    // 3. Update proposal totals
    if choice {
        proposal.votes_for = proposal.votes_for.checked_add(weight).unwrap();
    } else {
        proposal.votes_against = proposal.votes_against.checked_add(weight).unwrap();
    }

    // 4. Record the vote
    vote_record.proposal = proposal.key();
    vote_record.voter = ctx.accounts.voter.key();
    vote_record.choice = choice;
    vote_record.weight = weight;
    vote_record.voted_at = clock.unix_timestamp;
    vote_record.bump = ctx.bumps.vote_record;

    msg!("🗳️ Vote cast for proposal {}: {} (Weight {})", proposal.proposal_id, if choice { "FOR" } else { "AGAINST" }, weight);

    // 5. Check for early passing (optional quorum logic could go here)
    
    Ok(())
}

pub fn execute_proposal(
    ctx: Context<ExecuteProposal>,
) -> Result<()> {
    let proposal = &mut ctx.accounts.proposal;
    let zone_config = &mut ctx.accounts.zone_config;
    let clock = Clock::get()?;

    // 1. Verify voting has ended
    require!(
        clock.unix_timestamp >= proposal.expires_at,
        GovernanceError::ProposalNotExpired
    );

    // 2. Determine outcome if status is still Active
    if proposal.status == ProposalStatus::Active {
        if proposal.votes_for > proposal.votes_against {
            proposal.status = ProposalStatus::Passed;
        } else {
            proposal.status = ProposalStatus::Rejected;
        }
    }

    // 3. Execute if Passed
    require!(
        proposal.status == ProposalStatus::Passed,
        GovernanceError::InvalidProposalStatus
    );

    // 4. Apply changes to zone_config
    match proposal.parameter {
        GridParameter::IncentiveMultiplier => {
            zone_config.incentive_multiplier = proposal.new_value;
        }
        GridParameter::WheelingCharge => {
            zone_config.wheeling_charge = proposal.new_value;
        }
        GridParameter::MaintenanceMode => {
            zone_config.maintenance_mode = proposal.new_value > 0;
        }
        _ => return Err(GovernanceError::InvalidParameterType.into()),
    }

    zone_config.last_updated = clock.unix_timestamp;
    proposal.status = ProposalStatus::Executed;

    msg!("✅ Proposal executed: Zone {} parameter updated to {}", zone_config.zone_id, proposal.new_value);

    Ok(())
}

pub fn initialize_zone_config(
    ctx: Context<InitializeZoneConfig>,
    zone_id: i32,
    incentive_multiplier: u64,
    wheeling_charge: u64,
) -> Result<()> {
    let zone_config = &mut ctx.accounts.zone_config;
    let clock = Clock::get()?;

    zone_config.zone_id = zone_id;
    zone_config.incentive_multiplier = incentive_multiplier;
    zone_config.wheeling_charge = wheeling_charge;
    zone_config.maintenance_mode = false;
    zone_config.last_updated = clock.unix_timestamp;
    zone_config.bump = ctx.bumps.zone_config;

    msg!("📍 ZoneConfig initialized for Zone {}", zone_id);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_governance_logic_placeholder() {
        // This is a placeholder for logic verification 
        // In a real Anchor test, we'd use the program-test crate
        assert!(true);
    }
}
