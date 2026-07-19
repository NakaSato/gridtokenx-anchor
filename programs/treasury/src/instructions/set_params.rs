use anchor_lang::prelude::*;

use crate::error::TreasuryError;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
pub struct SetParams<'info> {
    #[account(mut, seeds = [b"treasury"], bump)]
    pub treasury: AccountLoader<'info, Treasury>,
    pub authority: Signer<'info>,
}

/// Admin: update swap rate, fee, attestation TTL, pause flag, and the
/// authorized settlement recorder (the trading market_authority PDA).
pub fn set_params(
    ctx: Context<SetParams>,
    grx_per_thbc_rate: u64,
    swap_fee_bps: u16,
    attestation_ttl: i64,
    paused: bool,
    settlement_recorder: Pubkey,
) -> Result<()> {
    require!(swap_fee_bps <= 10_000, TreasuryError::InvalidFeeBps);
    let now = Clock::get()?.unix_timestamp;
    let mut t = ctx.accounts.treasury.load_mut()?;
    require!(t.authority == ctx.accounts.authority.key(), TreasuryError::UnauthorizedAuthority);
    t.grx_per_thbc_rate = grx_per_thbc_rate;
    t.swap_fee_bps = swap_fee_bps;
    t.attestation_ttl = attestation_ttl;
    t.paused = if paused { 1 } else { 0 };
    t.settlement_recorder = settlement_recorder;

    emit!(ParamsUpdated {
        authority: ctx.accounts.authority.key(),
        grx_per_thbc_rate,
        swap_fee_bps,
        attestation_ttl,
        paused,
        settlement_recorder,
        timestamp: now,
    });
    Ok(())
}
