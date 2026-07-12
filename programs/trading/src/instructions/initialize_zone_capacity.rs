use anchor_lang::prelude::*;
use crate::state::*;

#[derive(Accounts)]
pub struct InitializeZoneCapacityContext<'info> {
    pub zone_market: AccountLoader<'info, ZoneMarket>,
    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<ZoneCapacity>(),
        seeds = [b"zone_capacity", zone_market.key().as_ref()],
        bump
    )]
    pub zone_capacity: AccountLoader<'info, ZoneCapacity>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// One-time creation of the per-zone `ZoneCapacity` PDA (Tier-A). Holds the cross-zone
/// `committed_flow` counter moved off `ZoneMarket` so the settle hot path can keep
/// `ZoneMarket` read-only on intra-zone batches. Idempotent per zone_market.
pub fn initialize_zone_capacity(ctx: Context<InitializeZoneCapacityContext>) -> Result<()> {
    let mut zc = ctx.accounts.zone_capacity.load_init()?;
    zc.zone_market = ctx.accounts.zone_market.key();
    zc.committed_flow = 0;
    zc.bump = ctx.bumps.zone_capacity;
    Ok(())
}
