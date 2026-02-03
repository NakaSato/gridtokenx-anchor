use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface, TransferChecked, transfer_checked};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum CurveType {
    LinearSolar = 0,    // Base curve
    SteepWind = 1,      // High volatility, high slope
    FlatBattery = 2,    // Storage-backed, low slope
}

#[account]
pub struct AmmPool {
    pub market: Pubkey,
    pub energy_mint: Pubkey,
    pub currency_mint: Pubkey,
    pub energy_reserve: u64,
    pub currency_reserve: u64,
    pub curve_type: CurveType,
    pub bonding_slope: u64,
    pub bonding_base: u64,
    pub fee_bps: u16,
    pub bump: u8,
}

#[derive(Accounts)]
#[instruction(curve_type: CurveType)]
pub struct InitializeAmmPool<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 32 + 32 + 8 + 8 + 2 + 8 + 8 + 2 + 1 + 64,
        seeds = [b"amm_pool", market.key().as_ref(), &[curve_type as u8]],
        bump
    )]
    pub pool: Account<'info, AmmPool>,
    /// CHECK: Reference to the Trading Market
    pub market: AccountInfo<'info>, 
    pub energy_mint: InterfaceAccount<'info, Mint>,
    pub currency_mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SwapEnergy<'info> {
    #[account(
        mut,
        seeds = [b"amm_pool", pool.market.as_ref(), &[pool.curve_type as u8]],
        bump = pool.bump
    )]
    pub pool: Account<'info, AmmPool>,
    #[account(mut)]
    pub user_energy_account: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub user_currency_account: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub pool_energy_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub pool_currency_vault: InterfaceAccount<'info, TokenAccount>,
    pub energy_mint: InterfaceAccount<'info, Mint>,
    pub currency_mint: InterfaceAccount<'info, Mint>,
    pub user: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle_initialize_amm_pool(
    ctx: Context<InitializeAmmPool>,
    curve_type: CurveType,
    slope: u64,
    base: u64,
    fee_bps: u16,
) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    pool.market = ctx.accounts.market.key();
    pool.energy_mint = ctx.accounts.energy_mint.key();
    pool.currency_mint = ctx.accounts.currency_mint.key();
    pool.energy_reserve = 0;
    pool.currency_reserve = 0;
    pool.curve_type = curve_type;
    pool.bonding_slope = slope;
    pool.bonding_base = base;
    pool.fee_bps = fee_bps;
    pool.bump = ctx.bumps.pool;

    msg!("AMM Pool initialized for market: {} type: {:?}", pool.market, curve_type);
    Ok(())
}

pub fn handle_swap_buy_energy(
    ctx: Context<SwapEnergy>,
    amount_milli_kwh: u64,
    max_currency: u64,
) -> Result<()> {
    let (total_cost, delta) = {
        let pool = &ctx.accounts.pool;
        let current_supply = pool.energy_reserve;
        let delta = amount_milli_kwh;
        
        let base = pool.bonding_base as u128;
        let slope = pool.bonding_slope as u128;
        
        let adjusted_slope = match pool.curve_type {
            CurveType::SteepWind => slope * 2,
            CurveType::FlatBattery => slope / 2,
            _ => slope,
        };
        
        let x = current_supply as u128;
        let d = delta as u128;
        
        let cost = (base * d) + (adjusted_slope * (2 * x * d + d * d) / 2000); 
        let fee = (cost * pool.fee_bps as u128) / 10000;
        let total_cost = (cost + fee) as u64;

        require!(total_cost <= max_currency, AmmError::SlippageExceeded);
        (total_cost, delta)
    };

    let cpi_accounts = TransferChecked {
        from: ctx.accounts.user_currency_account.to_account_info(),
        to: ctx.accounts.pool_currency_vault.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
        mint: ctx.accounts.currency_mint.to_account_info(),
    };
    transfer_checked(CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts), total_cost, ctx.accounts.currency_mint.decimals)?;

    let pool_market = ctx.accounts.pool.market;
    let pool_curve = ctx.accounts.pool.curve_type as u8;
    let pool_bump = ctx.accounts.pool.bump;
    let seeds = &[b"amm_pool", pool_market.as_ref(), &[pool_curve], &[pool_bump]];
    let signer = &[&seeds[..]];
    
    let cpi_accounts_energy = TransferChecked {
        from: ctx.accounts.pool_energy_vault.to_account_info(),
        to: ctx.accounts.user_energy_account.to_account_info(),
        authority: ctx.accounts.pool.to_account_info(),
        mint: ctx.accounts.energy_mint.to_account_info(),
    };
    transfer_checked(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), cpi_accounts_energy, signer), amount_milli_kwh, ctx.accounts.energy_mint.decimals)?;

    let pool = &mut ctx.accounts.pool;
    pool.energy_reserve += delta;
    pool.currency_reserve += total_cost;

    msg!("AMM SWAP ({:?}): Bought {} milli-kWh for {} micro-GUSD", pool.curve_type, amount_milli_kwh, total_cost);
    Ok(())
}

#[error_code]
pub enum AmmError {
    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded,
}
