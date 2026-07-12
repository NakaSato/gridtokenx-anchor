use crate::errors::GovernanceError;
use crate::events::*;
use crate::state::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct CastVote<'info> {
    #[account(mut)]
    pub proposal: Account<'info, Proposal>,
    #[account(
        init,
        payer = voter,
        space = VoteRecord::LEN,
        seeds = [b"vote", proposal.key().as_ref(), voter.key().as_ref()],
        bump
    )]
    pub vote_record: Account<'info, VoteRecord>,
    #[account(mut)]
    pub voter: Signer<'info>,
    /// Voter's meter account to determine voting weight.
    /// Bound to the registry program so a forged account with an inflated total_generation
    /// cannot manufacture voting weight (handler still checks meter.owner == voter).
    /// CHECK: program-owner bound here; field-level validation in handler
    #[account(owner = registry::ID @ GovernanceError::InvalidMeterAccount)]
    pub meter_account: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
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
