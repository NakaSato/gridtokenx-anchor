use anchor_lang::prelude::*;
use crate::state::*;

#[derive(Accounts)]
#[instruction(zone_id: u32)]
pub struct InitializeZoneConfig<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + 128,
        seeds = [b"zone_config", zone_id.to_le_bytes().as_ref()],
        bump
    )]
    pub zone_config: Account<'info, ZoneConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn initialize_zone_config(
    ctx: Context<InitializeZoneConfig>,
    zone_id: u32,
    incentive_multiplier_bps: u64,
) -> Result<()> {
    let config = &mut ctx.accounts.zone_config;
    config.zone_id = zone_id;
    config.incentive_multiplier_bps = incentive_multiplier_bps;
    config.authority = ctx.accounts.authority.key();
    config.last_updated = Clock::get()?.unix_timestamp;
    config.maintenance_mode = 0;
    Ok(())
}
