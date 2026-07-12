use anchor_lang::prelude::*;

use crate::error::EnergyTokenError;
use crate::governance_authority;
use crate::state::*;

/// Shared context for REC validator-set management — used by both `add_rec_validator`
/// and `remove_rec_validator` (tight group: one context, two admin handlers).
#[derive(Accounts)]
pub struct AddRecValidator<'info> {
    #[account(mut)]
    pub token_info: AccountLoader<'info, TokenInfo>,

    /// The governance `governance_config` PDA — its `authority` (ERC) is the only signer allowed
    /// to register/remove REC validators, checked in the handler body. Not typed as a
    /// `governance::GovernanceConfig` account: importing that crate would create a Cargo
    /// cycle (see `GOVERNANCE_PROGRAM_ID`).
    /// CHECK: validated in the handler via `governance_authority()`.
    pub governance_config: UncheckedAccount<'info>,

    pub authority: Signer<'info>,
}

/// Add a REC validator to the system
pub fn add_rec_validator(
    ctx: Context<AddRecValidator>,
    validator_pubkey: Pubkey,
    _authority_name: String,
) -> Result<()> {
    // REC-issuer binding: only ERC's governance authority may register validators
    // (role-map.md's "REC issuer gate ... bind issuer = ERC").
    require_keys_eq!(
        ctx.accounts.authority.key(),
        governance_authority(&ctx.accounts.governance_config.to_account_info())?,
        EnergyTokenError::UnauthorizedAuthority
    );
    let mut token_info = ctx.accounts.token_info.load_mut()?;

    // Check that it does not exceed the specified number
    require!(
        token_info.rec_validators_count < 5,
        EnergyTokenError::MaxValidatorsReached
    );

    // Check if it already exists
    for i in 0..token_info.rec_validators_count as usize {
        require!(
            token_info.rec_validators[i] != validator_pubkey,
            EnergyTokenError::ValidatorAlreadyExists
        );
    }

    let index = token_info.rec_validators_count as usize;
    token_info.rec_validators[index] = validator_pubkey;
    token_info.rec_validators_count += 1;
    Ok(())
}

/// Remove a REC validator (admin only)
///
/// Enables rotation of a compromised or retired validator key. Swap-removes the
/// entry with the last slot to keep the array dense.
pub fn remove_rec_validator(
    ctx: Context<AddRecValidator>,
    validator_pubkey: Pubkey,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.authority.key(),
        governance_authority(&ctx.accounts.governance_config.to_account_info())?,
        EnergyTokenError::UnauthorizedAuthority
    );
    let mut token_info = ctx.accounts.token_info.load_mut()?;

    let count = token_info.rec_validators_count as usize;
    let mut target = None;
    for i in 0..count {
        if token_info.rec_validators[i] == validator_pubkey {
            target = Some(i);
            break;
        }
    }
    let idx = target.ok_or(EnergyTokenError::RemoveValidatorNotFound)?;

    let last = count - 1;
    token_info.rec_validators[idx] = token_info.rec_validators[last];
    token_info.rec_validators[last] = Pubkey::default();
    token_info.rec_validators_count -= 1;
    Ok(())
}
