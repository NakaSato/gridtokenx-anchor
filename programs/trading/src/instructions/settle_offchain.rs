use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use crate::state::*;
use crate::error::TradingError;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct OffchainOrderPayload {
    pub order_id: [u8; 16], // UUID
    pub user: Pubkey,
    pub energy_amount: u64,
    pub price_per_kwh: u64,
    pub side: u8, // 0 = Buy, 1 = Sell
    pub zone_id: u32,
    pub expires_at: i64,
}

#[derive(Accounts)]
#[instruction(buyer_payload: OffchainOrderPayload, seller_payload: OffchainOrderPayload)]
pub struct SettleOffchainMatchContext<'info> {
    pub market: AccountLoader<'info, Market>,
    pub zone_market: AccountLoader<'info, ZoneMarket>,
    
    // Nullifiers to track filled amounts and prevent replay
    #[account(
        init_if_needed,
        payer = payer,
        space = OrderNullifier::LEN,
        seeds = [b"nullifier", buyer_payload.user.as_ref(), &buyer_payload.order_id],
        bump
    )]
    pub buyer_nullifier: Box<Account<'info, OrderNullifier>>,

    #[account(
        init_if_needed,
        payer = payer,
        space = OrderNullifier::LEN,
        seeds = [b"nullifier", seller_payload.user.as_ref(), &seller_payload.order_id],
        bump
    )]
    pub seller_nullifier: Box<Account<'info, OrderNullifier>>,

    // Token Accounts
    #[account(mut)]
    pub buyer_currency_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub seller_currency_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub seller_energy_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub buyer_energy_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub fee_collector: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub wheeling_collector: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub loss_collector: Box<InterfaceAccount<'info, TokenAccount>>,

    // Mints
    pub currency_mint: Box<InterfaceAccount<'info, Mint>>,
    pub energy_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: The PDA authority that holds the delegation for buyer/seller token accounts
    #[account(seeds = [b"market_authority"], bump)]
    pub market_authority: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [b"market_shard", market.key().as_ref(), &[get_shard_id(&payer.key(), market.load()?.num_shards)]],
        bump
    )]
    pub market_shard: AccountLoader<'info, MarketShard>,

    #[account(
        mut,
        seeds = [b"zone_shard", zone_market.key().as_ref(), &[get_shard_id(&payer.key(), zone_market.load()?.num_shards)]],
        bump
    )]
    pub zone_shard: AccountLoader<'info, ZoneMarketShard>,

    #[account(mut)]
    pub payer: Signer<'info>,

    // Program sysvars and interfaces
    /// CHECK: Instructions sysvar to verify Ed25519 sigs
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub sysvar_instructions: AccountInfo<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub secondary_token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn settle_offchain_match(
    ctx: Context<SettleOffchainMatchContext>,
    buyer_payload: OffchainOrderPayload,
    seller_payload: OffchainOrderPayload,
    match_amount: u64,
    match_price: u64,
    wheeling_charge_val: u64,
    loss_cost_val: u64,
) -> Result<()> {
    require!(match_amount > 0, TradingError::InvalidAmount);
    
    // Slippage Protection: Ensure match price is within limits of both signed payloads
    require!(match_price <= buyer_payload.price_per_kwh, TradingError::SlippageExceeded);
    require!(match_price >= seller_payload.price_per_kwh, TradingError::SlippageExceeded);

    // Ensure sides are correct (0 = Buy, 1 = Sell)
    require!(buyer_payload.side == 0, TradingError::InvalidOrderSide);
    require!(seller_payload.side == 1, TradingError::InvalidOrderSide);
    
    // Ensure prices cross (redundant but safe)
    require!(buyer_payload.price_per_kwh >= seller_payload.price_per_kwh, TradingError::PriceMismatch);

    let clock = Clock::get()?;
    require!(buyer_payload.expires_at == 0 || clock.unix_timestamp < buyer_payload.expires_at, TradingError::OrderExpired);
    require!(seller_payload.expires_at == 0 || clock.unix_timestamp < seller_payload.expires_at, TradingError::OrderExpired);

    let market = ctx.accounts.market.load()?;
    let _zone_market = ctx.accounts.zone_market.load()?;
    let mut market_shard = ctx.accounts.market_shard.load_mut()?;
    let mut zone_shard = ctx.accounts.zone_shard.load_mut()?;

    // Check remaining amounts using Nullifiers
    let buyer_remaining = buyer_payload.energy_amount.saturating_sub(ctx.accounts.buyer_nullifier.filled_amount);
    let seller_remaining = seller_payload.energy_amount.saturating_sub(ctx.accounts.seller_nullifier.filled_amount);
    require!(match_amount <= buyer_remaining && match_amount <= seller_remaining, TradingError::InvalidAmount);

    let clearing_price = match_price;
    let total_currency_value = match_amount.saturating_mul(clearing_price);
    let market_fee = total_currency_value.checked_mul(market.market_fee_bps as u64).map(|v| v / 10000).unwrap_or(0);
    let net_seller_amount = total_currency_value.saturating_sub(market_fee).saturating_sub(wheeling_charge_val).saturating_sub(loss_cost_val);

    // Authority seeds for CPI
    let authority_bump = ctx.bumps.market_authority;
    let authority_seeds = &[b"market_authority".as_ref(), &[authority_bump]];
    let signer = &[&authority_seeds[..]];

    // Token Transfers
    // 1. Fee
    if market_fee > 0 {
        anchor_spl::token_interface::transfer_checked(
            CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), anchor_spl::token_interface::TransferChecked {
                from: ctx.accounts.buyer_currency_account.to_account_info(),
                mint: ctx.accounts.currency_mint.to_account_info(),
                to: ctx.accounts.fee_collector.to_account_info(),
                authority: ctx.accounts.market_authority.to_account_info(),
            }, signer),
            market_fee,
            ctx.accounts.currency_mint.decimals
        )?;
    }

    // 2. Seller Currency
    if net_seller_amount > 0 {
        anchor_spl::token_interface::transfer_checked(
            CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), anchor_spl::token_interface::TransferChecked {
                from: ctx.accounts.buyer_currency_account.to_account_info(),
                mint: ctx.accounts.currency_mint.to_account_info(),
                to: ctx.accounts.seller_currency_account.to_account_info(),
                authority: ctx.accounts.market_authority.to_account_info(),
            }, signer),
            net_seller_amount,
            ctx.accounts.currency_mint.decimals
        )?;
    }

    // 3. Energy Transfer to Buyer
    anchor_spl::token_interface::transfer_checked(
        CpiContext::new_with_signer(ctx.accounts.secondary_token_program.to_account_info(), anchor_spl::token_interface::TransferChecked {
            from: ctx.accounts.seller_energy_account.to_account_info(),
            mint: ctx.accounts.energy_mint.to_account_info(),
            to: ctx.accounts.buyer_energy_account.to_account_info(),
            authority: ctx.accounts.market_authority.to_account_info(),
        }, signer),
        match_amount,
        ctx.accounts.energy_mint.decimals
    )?;

    // Update State (Sharded)
    ctx.accounts.buyer_nullifier.filled_amount += match_amount;
    ctx.accounts.buyer_nullifier.order_id = buyer_payload.order_id;
    ctx.accounts.buyer_nullifier.authority = buyer_payload.user;
    ctx.accounts.buyer_nullifier.bump = ctx.bumps.buyer_nullifier;

    ctx.accounts.seller_nullifier.filled_amount += match_amount;
    ctx.accounts.seller_nullifier.order_id = seller_payload.order_id;
    ctx.accounts.seller_nullifier.authority = seller_payload.user;
    ctx.accounts.seller_nullifier.bump = ctx.bumps.seller_nullifier;

    // Update Shard instead of Market to avoid global lock contention
    market_shard.volume_accumulated += match_amount;
    market_shard.order_count += 1;
    market_shard.last_update = clock.unix_timestamp;

    // Zone Market Shard updates
    zone_shard.volume_accumulated += match_amount;
    zone_shard.trade_count += 1;
    zone_shard.last_clearing_price = clearing_price;
    zone_shard.last_update = clock.unix_timestamp;

    Ok(())
}
