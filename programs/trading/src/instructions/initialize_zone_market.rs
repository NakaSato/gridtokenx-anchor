use anchor_lang::prelude::*;
use crate::state::*;

#[derive(Accounts)]
#[instruction(zone_id: u32)]
pub struct InitializeZoneMarketContext<'info> {
    pub market: AccountLoader<'info, Market>,
    #[account(init, payer = authority, space = 8 + std::mem::size_of::<ZoneMarket>(), seeds = [b"zone_market", market.key().as_ref(), &zone_id.to_le_bytes()], bump)]
    pub zone_market: AccountLoader<'info, ZoneMarket>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_zone_market(
    ctx: Context<InitializeZoneMarketContext>,
    zone_id: u32,
    num_shards: u8,
    capacity: u64,
    segment: u8,
) -> Result<()> {
    let mut zone_market = ctx.accounts.zone_market.load_init()?;
    zone_market.market = ctx.accounts.market.key();
    zone_market.zone_id = zone_id;
    zone_market.num_shards = num_shards;
    zone_market.capacity = capacity;
    zone_market.segment = segment;
    zone_market.committed_flow = 0;
    zone_market.total_volume = 0;
    zone_market.active_orders = 0;
    zone_market.buy_side_depth_count = 0;
    zone_market.sell_side_depth_count = 0;

    // Zero out the arrays
    zone_market.buy_side_depth = [PriceLevel::default(); MAX_DEPTH_LEVELS];
    zone_market.sell_side_depth = [PriceLevel::default(); MAX_DEPTH_LEVELS];

    Ok(())
}
