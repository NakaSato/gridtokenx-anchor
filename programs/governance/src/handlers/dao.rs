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
        // Zone binding: a proposer may only open a proposal for the zone their meter is in.
        // Without this the `target_zone` is attacker-chosen and unrelated to the meter.
        require!(
            meter.zone_id == target_zone,
            GovernanceError::MeterZoneMismatch
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
        // Zone binding: the meter must belong to the proposal's zone, so a prosumer cannot
        // swing another zone's proposal with an unrelated high-generation meter.
        require!(
            meter.zone_id == proposal.target_zone,
            GovernanceError::MeterZoneMismatch
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

/// Pure proposal finalization (extracted for unit-testing): `Passed` iff participation
/// meets quorum (`votes_for + votes_against >= min_quorum`) AND `votes_for` strictly
/// exceeds `votes_against`; otherwise `Rejected`. Ties and under-quorum both fail.
/// The vote sum saturates (cast_vote already guards per-vote with checked_add).
fn finalize_proposal_status(votes_for: u64, votes_against: u64, min_quorum: u64) -> ProposalStatus {
    let total_votes = votes_for.saturating_add(votes_against);
    if total_votes < min_quorum {
        ProposalStatus::Rejected
    } else if votes_for > votes_against {
        ProposalStatus::Passed
    } else {
        ProposalStatus::Rejected
    }
}

pub fn execute_proposal(
    ctx: Context<ExecuteProposal>,
) -> Result<()> {
    let proposal = &mut ctx.accounts.proposal;
    let zone_config = &mut ctx.accounts.zone_config;
    let min_quorum = ctx.accounts.governance_config.min_quorum_votes;
    let clock = Clock::get()?;

    // 1. Verify voting period has ended
    require!(
        clock.unix_timestamp >= proposal.expires_at,
        GovernanceError::ProposalNotExpired
    );

    // 2. Auto-finalize if still Active
    if proposal.status == ProposalStatus::Active {
        proposal.status = finalize_proposal_status(
            proposal.votes_for,
            proposal.votes_against,
            min_quorum,
        );
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

    fn passed(f: u64, a: u64, q: u64) -> bool {
        matches!(finalize_proposal_status(f, a, q), ProposalStatus::Passed)
    }

    #[test]
    fn passes_with_quorum_and_majority_for() {
        // total 100 >= quorum 50, for 60 > against 40.
        assert!(passed(60, 40, 50));
    }

    #[test]
    fn rejected_under_quorum_even_if_for_leads() {
        // for 9 > against 0 but total 9 < quorum 10 → participation fails.
        assert!(!passed(9, 0, 10));
    }

    #[test]
    fn quorum_boundary_is_inclusive() {
        // total 10 == quorum 10, for > against → passes (>= not >).
        assert!(passed(6, 4, 10));
    }

    #[test]
    fn tie_is_rejected() {
        // quorum met, for == against → no majority → Rejected.
        assert!(!passed(50, 50, 10));
    }

    #[test]
    fn against_majority_is_rejected() {
        assert!(!passed(40, 60, 10));
    }

    #[test]
    fn zero_quorum_still_needs_a_for_majority() {
        // quorum 0: any participation meets it, but 0 for / 0 against is a tie → Rejected.
        assert!(!passed(0, 0, 0));
        assert!(passed(1, 0, 0));
    }

    #[test]
    fn vote_sum_saturates_without_overflow() {
        // votes_for + votes_against would overflow u64; saturating sum still >= quorum,
        // and for > against → Passed (no panic).
        assert!(passed(u64::MAX, 1, u64::MAX));
    }
}
