use crate::errors::GovernanceError;
use crate::events::*;
use crate::state::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(target_zone: i32, proposal_id: u64)]
pub struct CreateProposal<'info> {
    #[account(
        init,
        payer = proposer,
        space = Proposal::LEN,
        seeds = [b"proposal", target_zone.to_le_bytes().as_ref(), proposal_id.to_le_bytes().as_ref()],
        bump
    )]
    pub proposal: Account<'info, Proposal>,
    #[account(mut)]
    pub proposer: Signer<'info>,
    /// We need to verify that the proposer has a registered meter in the target zone.
    /// Bound to the registry program so a forged/attacker-owned account cannot stand in
    /// for a real meter (handler still checks meter.owner == proposer).
    /// CHECK: program-owner bound here; field-level validation in handler
    #[account(owner = registry::ID @ GovernanceError::InvalidMeterAccount)]
    pub meter_account: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

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
