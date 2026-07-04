use anchor_lang::prelude::*;

use crate::error::TradingError;
use crate::state::{Market, TariffConfig, MAX_NETWORK_CHARGE_BPS};

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
/// (EGAT) and `loss_authority` (MEA/PEA) are the only keys that can subsequently move
/// their own rate; the market admin can re-point either key via `set_tariff_authorities`.
pub fn initialize_tariff_config(
    ctx: Context<InitializeTariffConfigContext>,
    wheeling_authority: Pubkey,
    loss_authority: Pubkey,
    wheeling_bps: u16,
    loss_bps: u16,
) -> Result<()> {
    require!(
        (wheeling_bps as u64).checked_add(loss_bps as u64).ok_or(TradingError::Overflow)? <= MAX_NETWORK_CHARGE_BPS,
        TradingError::TariffRateExceedsCap
    );
    let tariff_config = &mut ctx.accounts.tariff_config;
    tariff_config.wheeling_authority = wheeling_authority;
    tariff_config.loss_authority = loss_authority;
    tariff_config.wheeling_bps = wheeling_bps;
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

/// EGAT self-service: only the registered `wheeling_authority` key can move the
/// transmission tariff. Capped combined with the current `loss_bps` so no update can
/// push total network charges past `MAX_NETWORK_CHARGE_BPS`.
pub fn set_wheeling_rate(ctx: Context<SetWheelingRateContext>, new_bps: u16) -> Result<()> {
    let tariff_config = &mut ctx.accounts.tariff_config;
    require!(
        (new_bps as u64).checked_add(tariff_config.loss_bps as u64).ok_or(TradingError::Overflow)? <= MAX_NETWORK_CHARGE_BPS,
        TradingError::TariffRateExceedsCap
    );
    tariff_config.wheeling_bps = new_bps;
    Ok(())
}

#[derive(Accounts)]
pub struct SetLossRateContext<'info> {
    #[account(mut, seeds = [b"tariff_config"], bump = tariff_config.bump, has_one = loss_authority)]
    pub tariff_config: Account<'info, TariffConfig>,
    pub loss_authority: Signer<'info>,
}

/// MEA/PEA self-service: only the registered `loss_authority` key can move the
/// distribution-loss tariff. Same combined cap as `set_wheeling_rate`.
pub fn set_loss_rate(ctx: Context<SetLossRateContext>, new_bps: u16) -> Result<()> {
    let tariff_config = &mut ctx.accounts.tariff_config;
    require!(
        (tariff_config.wheeling_bps as u64).checked_add(new_bps as u64).ok_or(TradingError::Overflow)? <= MAX_NETWORK_CHARGE_BPS,
        TradingError::TariffRateExceedsCap
    );
    tariff_config.loss_bps = new_bps;
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

/// Market-admin-gated key rotation (e.g. EGAT/MEA-PEA rotate their signing key). Does
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
