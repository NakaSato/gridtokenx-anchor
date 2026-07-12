use anchor_lang::prelude::*;
use crate::state::*;

#[derive(Accounts)]
pub struct InitializeMarketContext<'info> {
    #[account(init, payer = authority, space = 8 + std::mem::size_of::<Market>(), seeds = [b"market"], bump)]
    pub market: AccountLoader<'info, Market>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_market(ctx: Context<InitializeMarketContext>, num_shards: u8) -> Result<()> {
    // Single syscall — reused for both created_at and the emitted event timestamp
    let clock = Clock::get()?;
    let mut market = ctx.accounts.market.load_init()?;
    market.authority = ctx.accounts.authority.key();
    market.active_orders = 0;
    market.total_volume = 0;
    market.total_trades = 0;
    market.created_at = clock.unix_timestamp;
    market.clearing_enabled = 1;
    market.market_fee_bps = 25;
    market.min_price_per_kwh = 1;
    market.max_price_per_kwh = 0;
    market.num_shards = num_shards;

    market.batch_config = BatchConfig {
        enabled: 0,
        _padding1: [0; 3],
        max_batch_size: 100,
        batch_timeout_seconds: 300,
        min_batch_size: 5,
        price_improvement_threshold: 5,
        _padding2: [0; 6],
    };

    market.last_clearing_price = 0;
    market.price_history = [PricePoint::default(); 24];
    market.price_history_count = 0;
    market.price_history_head = 0; // ring-buffer head starts at slot 0
    market.volume_weighted_price = 0;

    emit!(crate::events::MarketInitialized {
        authority: ctx.accounts.authority.key(),
        timestamp: clock.unix_timestamp,
    });
    Ok(())
}
