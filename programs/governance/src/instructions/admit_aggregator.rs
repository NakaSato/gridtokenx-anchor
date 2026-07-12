use crate::errors::GovernanceError;
use crate::events::*;
use crate::state::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(aggregator: Pubkey, segment: u8)]
pub struct AdmitAggregator<'info> {
    #[account(
        seeds = [b"governance_config"],
        bump,
        has_one = authority @ GovernanceError::UnauthorizedAuthority
    )]
    pub governance_config: Account<'info, GovernanceConfig>,

    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + AggregatorEntry::LEN,
        seeds = [b"aggregator", aggregator.as_ref()],
        bump
    )]
    pub aggregator_entry: Account<'info, AggregatorEntry>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// Admit an aggregator node to the PoA allow-list (current authority only).
///
/// Idempotent re-admission: if the entry already exists (was revoked), this flips it back to
/// `active` rather than failing — the account is created via `init_if_needed`.
pub fn admit_aggregator(ctx: Context<AdmitAggregator>, aggregator: Pubkey, segment: u8) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let entry = &mut ctx.accounts.aggregator_entry;

    let first_admission = entry.aggregator == Pubkey::default();
    if first_admission {
        entry.aggregator = aggregator;
        entry.admitted_at = now;
        entry.bump = ctx.bumps.aggregator_entry;
    }
    entry.active = true;
    entry.updated_at = now;
    // 0 = Retail (MEA/PEA), 1 = Wholesale (EGAT) — role-map.md fix #6. Re-settable on
    // re-admission, same as `active`.
    entry.segment = segment;

    emit!(AggregatorAdmitted {
        authority: ctx.accounts.authority.key(),
        aggregator,
        timestamp: now,
    });
    Ok(())
}
