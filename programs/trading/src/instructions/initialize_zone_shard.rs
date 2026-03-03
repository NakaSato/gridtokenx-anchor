use anchor_lang::prelude::*;
use crate::state::*;

#[derive(Accounts)]
#[instruction(shard_id: u8)]
pub struct InitializeZoneMarketShardContext<'info> {
    pub zone_market: AccountLoader<'info, ZoneMarket>,
    
    #[account(
        init,
        payer = payer,
        space = 8 + ZoneMarketShard::INIT_SPACE,
        seeds = [b"zone_shard", zone_market.key().as_ref(), &[shard_id]],
        bump
    )]
    pub zone_shard: Account<'info, ZoneMarketShard>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_zone_market_shard(ctx: Context<InitializeZoneMarketShardContext>, shard_id: u8) -> Result<()> {
    let zone_shard = &mut ctx.accounts.zone_shard;
    zone_shard.shard_id = shard_id;
    zone_shard.zone_market = ctx.accounts.zone_market.key();
    zone_shard.volume_accumulated = 0;
    zone_shard.trade_count = 0;
    zone_shard.last_update = Clock::get()?.unix_timestamp;
    
    Ok(())
}
