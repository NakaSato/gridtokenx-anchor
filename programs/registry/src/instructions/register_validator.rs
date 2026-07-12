use anchor_lang::prelude::*;

use crate::error::RegistryError;
use crate::state::*;
use crate::{GOVERNANCE_PROGRAM_ID, MIN_VALIDATOR_STAKE};

#[derive(Accounts)]
pub struct RegisterValidator<'info> {
    #[account(
        mut,
        seeds = [b"user", authority.key().as_ref()],
        bump,
        has_one = authority,
    )]
    pub user_account: AccountLoader<'info, UserAccount>,

    /// CHECK: governance `AggregatorEntry` PDA for `authority`. Validated in-handler
    /// (owner = governance program, PDA seeds match, `active`, `aggregator == authority`)
    /// rather than via a typed account, because importing the governance crate would
    /// cycle (governance depends on registry).
    pub aggregator_entry: UncheckedAccount<'info>,

    pub authority: Signer<'info>,
}

pub fn register_validator(ctx: Context<RegisterValidator>) -> Result<()> {
    let mut user_account = ctx.accounts.user_account.load_mut()?;

    // A slashed validator is permanently barred from self-reinstatement;
    // restaking must not silently undo a slash. Reinstatement, if ever
    // desired, belongs in an explicit admin-gated instruction.
    require!(
        user_account.validator_status != ValidatorStatus::Slashed,
        RegistryError::ValidatorAlreadySlashed
    );

    require!(
        user_account.staked_grx >= MIN_VALIDATOR_STAKE,
        RegistryError::MinStakeNotMet
    );

    // PoA gate: the validator bond is only granted to a governance-admitted
    // aggregator — the bond cannot be self-promoted by anyone holding MIN stake.
    // Raw-validate the allow-list entry (no governance crate dep — would cycle):
    // owner == governance, canonical PDA for this authority, active, identity match.
    let entry_ai = ctx.accounts.aggregator_entry.to_account_info();
    require_keys_eq!(
        *entry_ai.owner,
        GOVERNANCE_PROGRAM_ID,
        RegistryError::AggregatorNotAdmitted
    );
    let (expected_entry, _bump) = Pubkey::find_program_address(
        &[b"aggregator", ctx.accounts.authority.key().as_ref()],
        &GOVERNANCE_PROGRAM_ID,
    );
    require_keys_eq!(
        entry_ai.key(),
        expected_entry,
        RegistryError::AggregatorNotAdmitted
    );
    // AggregatorEntry borsh layout:
    // [0..8] discriminator | [8..40] aggregator | [40..48] admitted_at
    // [48..56] updated_at | [56] active | [57] bump
    let data = entry_ai.try_borrow_data()?;
    require!(data.len() >= 57, RegistryError::InvalidAggregatorEntry);
    require!(
        &data[8..40] == ctx.accounts.authority.key().as_ref(),
        RegistryError::AggregatorNotAdmitted
    );
    require!(data[56] == 1, RegistryError::AggregatorNotAdmitted);

    // Activating (or re-activating from Resigning) clears any pending resignation.
    user_account.validator_status = ValidatorStatus::Active;
    user_account.resign_at = 0;
    Ok(())
}
