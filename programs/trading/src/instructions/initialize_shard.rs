use anchor_lang::prelude::*;
use crate::state::*;

#[derive(Accounts)]
#[instruction(shard_id: u8)]
pub struct InitializeMarketShardContext<'info> {
    pub market: AccountLoader<'info, Market>,
    
    #[account(
        init,
        payer = payer,
        space = 8 + std::mem::size_of::<MarketShard>(),
        seeds = [b"market_shard", market.key().as_ref(), &[shard_id]],
        bump
    )]
    pub market_shard: AccountLoader<'info, MarketShard>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_market_shard(ctx: Context<InitializeMarketShardContext>, shard_id: u8) -> Result<()> {
    let mut market_shard = ctx.accounts.market_shard.load_init()?;
    market_shard.shard_id = shard_id;
    market_shard.market = ctx.accounts.market.key();
    market_shard.volume_accumulated = 0;
    market_shard.order_count = 0;
    market_shard.last_update = Clock::get()?.unix_timestamp;
    
    Ok(())
}
