use anchor_lang::prelude::*;

use crate::error::TradingError;
use crate::state::{Market, TariffConfig, MAX_LOSS_BPS, MAX_WHEELING_RATE_PER_KWH};

#[derive(Accounts)]
pub struct InitializeTariffConfigContext<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + TariffConfig::LEN,
        seeds = [b"tariff_config"],
        bump,
    )]
    pub tariff_config: Account<'info, TariffConfig>,
    #[account(has_one = authority)]
    pub market: AccountLoader<'info, Market>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// One-time init of the tariff schedule, gated by the trading market's own admin
/// (`market.authority`) — mirrors `UpdateMarketParamsContext`. `wheeling_authority`
/// and `loss_authority` (both MEA/PEA — retail P2P trades stay on the distribution
/// grid, never reaching EGAT's transmission network, see role-map.md) are the only
/// keys that can subsequently move their own rate; the market admin can re-point
/// either key via `set_tariff_authorities`.
pub fn initialize_tariff_config(
    ctx: Context<InitializeTariffConfigContext>,
    wheeling_authority: Pubkey,
    loss_authority: Pubkey,
    wheeling_rate_per_kwh: u64,
    loss_bps: u16,
) -> Result<()> {
    require!(wheeling_rate_per_kwh <= MAX_WHEELING_RATE_PER_KWH, TradingError::TariffRateExceedsCap);
    require!((loss_bps as u64) <= MAX_LOSS_BPS, TradingError::TariffRateExceedsCap);
    let tariff_config = &mut ctx.accounts.tariff_config;
    tariff_config.wheeling_authority = wheeling_authority;
    tariff_config.loss_authority = loss_authority;
    tariff_config.wheeling_rate_per_kwh = wheeling_rate_per_kwh;
    tariff_config.loss_bps = loss_bps;
    tariff_config.bump = ctx.bumps.tariff_config;
    Ok(())
}

#[derive(Accounts)]
pub struct SetWheelingRateContext<'info> {
    #[account(mut, seeds = [b"tariff_config"], bump = tariff_config.bump, has_one = wheeling_authority)]
    pub tariff_config: Account<'info, TariffConfig>,
    pub wheeling_authority: Signer<'info>,
}

/// MEA/PEA self-service: only the registered `wheeling_authority` key can move the
/// distribution wheeling tariff — a flat rate (6-decimal currency units per kWh, same
/// representation as `price_per_kwh`), capped independently of `loss_bps` since the two
/// are different units (flat per-kWh vs bps-of-trade-value) and no longer share a
/// combined cap.
pub fn set_wheeling_rate(ctx: Context<SetWheelingRateContext>, new_rate_per_kwh: u64) -> Result<()> {
    require!(new_rate_per_kwh <= MAX_WHEELING_RATE_PER_KWH, TradingError::TariffRateExceedsCap);
    ctx.accounts.tariff_config.wheeling_rate_per_kwh = new_rate_per_kwh;
    Ok(())
}

#[derive(Accounts)]
pub struct SetLossRateContext<'info> {
    #[account(mut, seeds = [b"tariff_config"], bump = tariff_config.bump, has_one = loss_authority)]
    pub tariff_config: Account<'info, TariffConfig>,
    pub loss_authority: Signer<'info>,
}

/// MEA/PEA self-service: only the registered `loss_authority` key can move the
/// distribution-loss tariff (bps of trade value — loss is genuinely proportional to
/// price, unlike wheeling). Capped independently of `wheeling_rate_per_kwh`.
pub fn set_loss_rate(ctx: Context<SetLossRateContext>, new_bps: u16) -> Result<()> {
    require!((new_bps as u64) <= MAX_LOSS_BPS, TradingError::TariffRateExceedsCap);
    ctx.accounts.tariff_config.loss_bps = new_bps;
    Ok(())
}

#[derive(Accounts)]
pub struct CloseTariffConfigContext<'info> {
    /// CHECK: deliberately untyped — this instruction exists specifically to reclaim a
    /// `tariff_config` account whose on-chain bytes may predate the current `TariffConfig`
    /// layout (a typed `Account<'info, TariffConfig>` would fail to deserialize the old
    /// layout before the handler even runs). Ownership + PDA-seeds are still verified.
    #[account(mut, seeds = [b"tariff_config"], bump, owner = crate::ID)]
    pub tariff_config: UncheckedAccount<'info>,
    #[account(has_one = authority)]
    pub market: AccountLoader<'info, Market>,
    #[account(mut)]
    pub authority: Signer<'info>,
}

/// Market-admin-gated reclaim, for migrating `TariffConfig`'s on-chain layout (e.g. the
/// 2026-07-04 wheeling bps → flat-rate-per-kWh migration) — manually drains lamports and
/// zeroes the account so `initialize_tariff_config` can recreate it at the new size.
/// Pre-mainnet/localnet only; a live deployment with real rates set would need a proper
/// migration path instead.
pub fn close_tariff_config(ctx: Context<CloseTariffConfigContext>) -> Result<()> {
    let tariff_info = ctx.accounts.tariff_config.to_account_info();
    let authority_info = ctx.accounts.authority.to_account_info();
    let lamports = tariff_info.lamports();
    **authority_info.try_borrow_mut_lamports()? += lamports;
    **tariff_info.try_borrow_mut_lamports()? = 0;
    tariff_info.try_borrow_mut_data()?.fill(0);
    Ok(())
}

#[derive(Accounts)]
pub struct SetTariffAuthoritiesContext<'info> {
    #[account(mut, seeds = [b"tariff_config"], bump = tariff_config.bump)]
    pub tariff_config: Account<'info, TariffConfig>,
    #[account(has_one = authority)]
    pub market: AccountLoader<'info, Market>,
    pub authority: Signer<'info>,
}

/// Market-admin-gated key rotation (e.g. MEA/PEA rotate their signing key). Does
/// not touch the rates themselves.
pub fn set_tariff_authorities(
    ctx: Context<SetTariffAuthoritiesContext>,
    new_wheeling_authority: Pubkey,
    new_loss_authority: Pubkey,
) -> Result<()> {
    ctx.accounts.tariff_config.wheeling_authority = new_wheeling_authority;
    ctx.accounts.tariff_config.loss_authority = new_loss_authority;
    Ok(())
}
