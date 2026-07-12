use crate::errors::GovernanceError;
use crate::state::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(zone_id: i32)]
pub struct InitializeZoneConfig<'info> {
    #[account(
        init,
        payer = authority,
        space = ZoneConfig::LEN,
        seeds = [b"zone_config", zone_id.to_le_bytes().as_ref()],
        bump
    )]
    pub zone_config: Account<'info, ZoneConfig>,
    #[account(
        seeds = [b"governance_config"],
        bump,
        has_one = authority @ GovernanceError::UnauthorizedAuthority
    )]
    pub governance_config: Account<'info, GovernanceConfig>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_zone_config(
    ctx: Context<InitializeZoneConfig>,
    zone_id: i32,
    incentive_multiplier: u64,
    wheeling_charge: u64,
) -> Result<()> {
    let zone_config = &mut ctx.accounts.zone_config;
    let clock = Clock::get()?;

    zone_config.zone_id = zone_id;
    zone_config.incentive_multiplier = incentive_multiplier;
    zone_config.wheeling_charge = wheeling_charge;
    zone_config.loss_factor = 1_000; // 1.000x — no adjustment (scaled by 1000)
    zone_config.maintenance_mode = false;
    zone_config.last_updated = clock.unix_timestamp;
    zone_config.bump = ctx.bumps.zone_config;

    msg!("📍 ZoneConfig initialized for Zone {}", zone_id);

    Ok(())
}
