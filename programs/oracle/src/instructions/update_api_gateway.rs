use anchor_lang::prelude::*;

use crate::events::*;
use crate::require_oracle_admin;
use crate::state::*;

#[derive(Accounts)]
pub struct UpdateApiGateway<'info> {
    #[account(mut, seeds = [b"oracle_data"], bump)]
    pub oracle_data: AccountLoader<'info, OracleData>,

    pub authority: Signer<'info>,
}

pub fn update_api_gateway(
    ctx: Context<UpdateApiGateway>,
    new_api_gateway: Pubkey,
) -> Result<()> {
    let mut oracle_data = ctx.accounts.oracle_data.load_mut()?;
    require_oracle_admin(&oracle_data, ctx.accounts.authority.key())?;

    let old_gateway = oracle_data.chain_bridge;
    oracle_data.chain_bridge = new_api_gateway;

    // Hoist Clock::get() before emit! (invariant #5).
    let now = Clock::get()?.unix_timestamp;
    emit!(ApiGatewayUpdated {
        authority: ctx.accounts.authority.key(),
        old_gateway,
        new_gateway: new_api_gateway,
        timestamp: now,
    });

    Ok(())
}
