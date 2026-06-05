use anchor_lang::prelude::*;
use crate::contexts::*;
use crate::state::*;
use crate::errors::GovernanceError;
use crate::events::*;

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

    // Voting period must be positive (a non-positive period would expire in the past)
    require!(
        voting_period_seconds > 0,
        GovernanceError::InvalidProposalStatus
    );

    // Validate that the proposer owns the supplied meter account
    {
        let meter_data = ctx.accounts.meter_account.try_borrow_data()?;
        require!(
            meter_data.len() >= 8 + std::mem::size_of::<MeterAccount>(),
            GovernanceError::InvalidMeterAccount
        );
        let meter = bytemuck::from_bytes::<MeterAccount>(
            &meter_data[8..8 + std::mem::size_of::<MeterAccount>()],
        );
        let meter_owner = Pubkey::new_from_array(meter.owner);
        require!(
            meter_owner == ctx.accounts.proposer.key(),
            GovernanceError::MeterOwnerMismatch
        );
    }

    proposal.proposer = ctx.accounts.proposer.key();
    proposal.target_zone = target_zone;
    proposal.proposal_id = proposal_id;
    proposal.parameter = parameter.clone();
    proposal.new_value = new_value;
    proposal.votes_for = 0;
    proposal.votes_against = 0;
    proposal.status = ProposalStatus::Active;
    proposal.expires_at = clock
        .unix_timestamp
        .checked_add(voting_period_seconds)
        .ok_or(GovernanceError::MathOverflow)?;
    proposal.bump = ctx.bumps.proposal;

    emit!(ProposalCreated {
        proposal_id,
        proposer: ctx.accounts.proposer.key(),
        target_zone,
        parameter: format!("{:?}", parameter),
        new_value,
        expires_at: proposal.expires_at,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

pub fn cast_vote(
    ctx: Context<CastVote>,
    choice: bool,
) -> Result<()> {
    let proposal = &mut ctx.accounts.proposal;
    let vote_record = &mut ctx.accounts.vote_record;
    let clock = Clock::get()?;

    // 1. Check proposal is still active
    require!(
        proposal.status == ProposalStatus::Active,
        GovernanceError::InvalidProposalStatus
    );
    require!(
        clock.unix_timestamp < proposal.expires_at,
        GovernanceError::ProposalExpired
    );

    // 2. Determine voting weight from meter's total_generation
    //    weight = max(100, total_generation / 1_000)
    //    → every 1,000 kWh of lifetime generation = 1 weight unit, floor 100
    let weight: u64 = {
        let meter_data = ctx.accounts.meter_account.try_borrow_data()?;
        require!(
            meter_data.len() >= 8 + std::mem::size_of::<MeterAccount>(),
            GovernanceError::InvalidMeterAccount
        );
        let meter = bytemuck::from_bytes::<MeterAccount>(
            &meter_data[8..8 + std::mem::size_of::<MeterAccount>()],
        );
        // Validate voter owns the supplied meter
        let meter_owner = Pubkey::new_from_array(meter.owner);
        require!(
            meter_owner == ctx.accounts.voter.key(),
            GovernanceError::MeterOwnerMismatch
        );
        (meter.total_generation / 1_000).max(100)
    };

    // 3. Update proposal totals
    if choice {
        proposal.votes_for = proposal.votes_for.checked_add(weight).ok_or(GovernanceError::MathOverflow)?;
    } else {
        proposal.votes_against = proposal.votes_against.checked_add(weight).ok_or(GovernanceError::MathOverflow)?;
    }

    // 4. Record the vote
    vote_record.proposal = proposal.key();
    vote_record.voter = ctx.accounts.voter.key();
    vote_record.choice = choice;
    vote_record.weight = weight;
    vote_record.voted_at = clock.unix_timestamp;
    vote_record.bump = ctx.bumps.vote_record;

    emit!(VoteCast {
        proposal_id: proposal.proposal_id,
        voter: ctx.accounts.voter.key(),
        choice,
        weight,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

pub fn execute_proposal(
    ctx: Context<ExecuteProposal>,
) -> Result<()> {
    let proposal = &mut ctx.accounts.proposal;
    let zone_config = &mut ctx.accounts.zone_config;
    let min_quorum = ctx.accounts.poa_config.min_quorum_votes;
    let clock = Clock::get()?;

    // 1. Verify voting period has ended
    require!(
        clock.unix_timestamp >= proposal.expires_at,
        GovernanceError::ProposalNotExpired
    );

    // 2. Auto-finalize if still Active
    if proposal.status == ProposalStatus::Active {
        let total_votes = proposal.votes_for.saturating_add(proposal.votes_against);
        // Quorum check: enough participation?
        if total_votes < min_quorum {
            proposal.status = ProposalStatus::Rejected;
        } else if proposal.votes_for > proposal.votes_against {
            proposal.status = ProposalStatus::Passed;
        } else {
            proposal.status = ProposalStatus::Rejected;
        }
    }

    // 4. Require Passed status to execute
    require!(
        proposal.status == ProposalStatus::Passed,
        GovernanceError::InvalidProposalStatus
    );

    // 5. Apply changes to zone_config
    match proposal.parameter {
        GridParameter::IncentiveMultiplier => {
            zone_config.incentive_multiplier = proposal.new_value;
        }
        GridParameter::WheelingCharge => {
            zone_config.wheeling_charge = proposal.new_value;
        }
        GridParameter::LossFactor => {
            // loss_factor is a divisor/multiplier; zero would break downstream calculations
            require!(proposal.new_value > 0, GovernanceError::InvalidParameterType);
            zone_config.loss_factor = proposal.new_value;
        }
        GridParameter::MaintenanceMode => {
            zone_config.maintenance_mode = proposal.new_value > 0;
        }
    }

    zone_config.last_updated = clock.unix_timestamp;
    proposal.status = ProposalStatus::Executed;

    emit!(ProposalExecuted {
        proposal_id: proposal.proposal_id,
        target_zone: zone_config.zone_id,
        parameter: format!("{:?}", proposal.parameter),
        new_value: proposal.new_value,
        timestamp: clock.unix_timestamp,
    });

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
    zone_config.loss_factor = 1_000; // 1.000x — no adjustment (scaled by 1000)
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
        // Placeholder for logic verification
        // In a real Anchor test, we'd use the program-test crate
        assert!(true);
    }
}
