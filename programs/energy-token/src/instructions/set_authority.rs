use anchor_lang::prelude::*;

use crate::error::EnergyTokenError;
use crate::state::*;

#[derive(Accounts)]
pub struct SetAuthority<'info> {
    #[account(
        mut,
        seeds = [b"token_info_2022"],
        bump,
    )]
    pub token_info: AccountLoader<'info, TokenInfo>,

    pub authority: Signer<'info>,
}

/// Rotate the admin authority (current authority only).
///
/// `token_info.authority` gates the privileged mint/admin paths (mint_to_wallet,
/// mint_generation, sync_total_supply, set_*; REC validator-set management is
/// instead gated by the governance authority via governance_config). It was
/// previously fixed at `initialize_token` with no rotation path, so a deployment
/// whose authority must become a different signer (e.g. an off-chain bridge's
/// signing key) had to be re-initialized. This transfers authority in place. The
/// CURRENT authority must sign, so it cannot be hijacked.
pub fn set_authority(ctx: Context<SetAuthority>, new_authority: Pubkey) -> Result<()> {
    let mut token_info = ctx.accounts.token_info.load_mut()?;
    require!(
        ctx.accounts.authority.key() == token_info.authority,
        EnergyTokenError::UnauthorizedAuthority
    );
    token_info.authority = new_authority;
    Ok(())
}
