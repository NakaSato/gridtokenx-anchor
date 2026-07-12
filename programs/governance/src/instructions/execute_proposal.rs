use crate::errors::GovernanceError;
use crate::events::*;
use crate::state::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct ExecuteProposal<'info> {
    /// Governance config - needed for quorum threshold
    #[account(
        seeds = [b"governance_config"],
        bump
    )]
    pub governance_config: Account<'info, GovernanceConfig>,
    #[account(
        mut,
        seeds = [b"zone_config", zone_config.zone_id.to_le_bytes().as_ref()],
        bump
    )]
    pub zone_config: Account<'info, ZoneConfig>,
    #[account(
        mut,
        constraint = proposal.target_zone == zone_config.zone_id @ GovernanceError::InvalidTargetZone,
        // Allow Active (will be auto-finalized in handler) or already-Passed proposals
        constraint = (
            proposal.status == ProposalStatus::Active
            || proposal.status == ProposalStatus::Passed
        ) @ GovernanceError::InvalidProposalStatus
    )]
    pub proposal: Account<'info, Proposal>,
    #[account(mut)]
    pub executor: Signer<'info>,
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
