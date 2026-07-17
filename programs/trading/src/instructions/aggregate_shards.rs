use anchor_lang::prelude::*;
use crate::error::TradingError;
use crate::state::*;

#[cfg(feature = "localnet")]
use compute_debug::compute_fn;
#[cfg(not(feature = "localnet"))]
use crate::compute_fn;

/// Reconcile a zone's sharded trade bookkeeping back into `ZoneMarket`.
///
/// The hot paths (`sharded_match_orders`, `settle_offchain_match`,
/// `batch_settle_offchain_match`) write only their per-shard `ZoneMarketShard`
/// PDA so `ZoneMarket` stays read-only and matches run in parallel (SKILL.md
/// invariant #3). That leaves `ZoneMarket.total_volume` / `total_trades` stale.
/// This periodic admin instruction folds the shard deltas back in.
///
/// Semantics are DRAIN, not snapshot (unlike registry::aggregate_shards, which
/// sets global = Σ shards): `match_orders` and `clear_auction` also increment
/// `ZoneMarket` totals directly, so a snapshot would clobber their
/// contributions. Instead each shard's accumulated counters are ADDED to the
/// zone totals and then zeroed — the shard is a staging buffer, drained here.
///
/// Shards are passed via `remaining_accounts` (writable). Any subset is
/// accepted and the call is idempotent per drain: a shard passed twice in one
/// call is rejected (`DuplicateShard`); a re-run after a drain adds zero.
/// `last_clearing_price` is refreshed best-effort from the most recently
/// updated shard that had trades since the previous drain.
///
/// NOT reconciled: `active_orders` (shards don't track order lifecycle) and
/// the informational shard fields `last_clearing_price` / `last_update`
/// (kept on the shard for observability).
#[derive(Accounts)]
pub struct AggregateShardsContext<'info> {
    // Read-only: canonical singleton market — only the authority gate reads it.
    #[account(seeds = [b"market"], bump)]
    pub market: AccountLoader<'info, Market>,
    // Must belong to `market` — blocks aggregating a foreign zone book.
    #[account(mut, constraint = zone_market.load()?.market == market.key())]
    pub zone_market: AccountLoader<'info, ZoneMarket>,
    pub authority: Signer<'info>,
}

pub fn aggregate_shards<'info>(
    ctx: Context<'info, AggregateShardsContext<'info>>,
) -> Result<()> {
    compute_fn!("aggregate_shards" => {
    {
        let market = ctx.accounts.market.load()?;
        require_keys_eq!(
            market.authority,
            ctx.accounts.authority.key(),
            TradingError::UnauthorizedAuthority
        );
    }

    let zone_market_key = ctx.accounts.zone_market.key();
    let mut zone_market = ctx.accounts.zone_market.load_mut()?;
    let now = Clock::get()?.unix_timestamp;

    let mut volume_added = 0u64;
    let mut trades_added = 0u32;
    let mut latest_ts = i64::MIN;
    let mut latest_price = 0u64;
    // Bitmask of shard_ids already drained this call (shard_id is u8 → 256 bits)
    // — reject duplicates so a shard passed twice cannot double-drain into totals.
    let mut seen = [0u64; 4];
    let mut shards_drained = 0u32;

    for account_info in ctx.remaining_accounts.iter() {
        // Owner + discriminator checked by the loader; parent binding below.
        let loader = AccountLoader::<ZoneMarketShard>::try_from(account_info)?;
        let mut shard = loader.load_mut()?;
        require_keys_eq!(shard.zone_market, zone_market_key, TradingError::ShardZoneMismatch);

        let word = (shard.shard_id / 64) as usize;
        let bit = 1u64 << (shard.shard_id % 64);
        require!(seen[word] & bit == 0, TradingError::DuplicateShard);
        seen[word] |= bit;

        // Best-effort price refresh: most recently updated shard with activity.
        if shard.trade_count > 0 && shard.last_update >= latest_ts {
            latest_ts = shard.last_update;
            latest_price = shard.last_clearing_price;
        }

        volume_added = volume_added
            .checked_add(shard.volume_accumulated)
            .ok_or(TradingError::Overflow)?;
        trades_added = trades_added
            .checked_add(shard.trade_count)
            .ok_or(TradingError::Overflow)?;

        // Drain the staging counters; keep last_clearing_price / last_update
        // on the shard as informational.
        shard.volume_accumulated = 0;
        shard.trade_count = 0;
        shards_drained += 1;
    }

    zone_market.total_volume = zone_market
        .total_volume
        .checked_add(volume_added)
        .ok_or(TradingError::Overflow)?;
    zone_market.total_trades = zone_market
        .total_trades
        .checked_add(trades_added)
        .ok_or(TradingError::Overflow)?;
    if latest_price > 0 {
        zone_market.last_clearing_price = latest_price;
    }

    emit!(crate::events::ShardsAggregated {
        zone_id: zone_market.zone_id,
        volume_added,
        trades_added,
        shards_drained,
        timestamp: now,
    });

    Ok(())
    })
}
