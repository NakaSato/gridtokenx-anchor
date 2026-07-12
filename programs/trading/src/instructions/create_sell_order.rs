use anchor_lang::prelude::*;
use crate::error::TradingError;
use crate::state::*;
use crate::utils::get_governance_config;
use crate::{ErcCertificate, ErcStatus};

#[derive(Accounts)]
#[instruction(order_id_val: u64)]
pub struct CreateSellOrderContext<'info> {
    pub market: AccountLoader<'info, Market>,
    #[account(mut)]
    pub zone_market: AccountLoader<'info, ZoneMarket>,
    #[account(init, payer = authority, space = 8 + std::mem::size_of::<Order>(), seeds = [b"order", authority.key().as_ref(), &order_id_val.to_le_bytes()], bump)]
    pub order: AccountLoader<'info, Order>,
    pub erc_certificate: Option<Box<Account<'info, ErcCertificate>>>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: Manual deserialization to handle length mismatch in localnet
    pub governance_config: UncheckedAccount<'info>,
    // OPTIONAL (remaining_accounts[0]): the seller's fungible REC token account
    // (Token-2022, governance rec_mint). When appended, the provenance gate fires —
    // see the handler. Kept out of the named context to avoid forcing every existing
    // create_sell_order caller to pass an extra account.
}

pub fn create_sell_order(
    ctx: Context<CreateSellOrderContext>,
    order_id_val: u64,
    energy_amount: u64,
    price_per_kwh: u64,
) -> Result<()> {
    require!(
        get_governance_config(&ctx.accounts.governance_config.to_account_info())?.is_operational(),
        TradingError::MaintenanceMode
    );
    require!(energy_amount > 0, TradingError::InvalidAmount);
    require!(price_per_kwh > 0, TradingError::InvalidPrice);

    {
        let market_ref = ctx.accounts.market.load()?;
        require!(
            price_per_kwh >= market_ref.min_price_per_kwh,
            TradingError::PriceBelowMinimum
        );
        if market_ref.max_price_per_kwh > 0 {
            require!(
                price_per_kwh <= market_ref.max_price_per_kwh,
                TradingError::PriceAboveMaximum
            );
        }
    }

    // Single Clock::get() syscall hoisted before the ERC block — avoids a second
    // syscall when an ERC certificate is present (previously called twice).
    let clock = Clock::get()?;

    if let Some(erc) = &ctx.accounts.erc_certificate {
        require!(
            erc.status == ErcStatus::Valid,
            TradingError::InvalidErcCertificate
        );
        if let Some(expires_at) = erc.expires_at {
            require!(clock.unix_timestamp < expires_at, TradingError::ErcExpired);
        }
        require!(
            erc.validated_for_trading,
            TradingError::NotValidatedForTrading
        );
        require!(
            energy_amount <= erc.energy_amount,
            TradingError::ExceedsErcAmount
        );
    }

    // Fungible REC provenance gate (opt-in via remaining_accounts[0]): when the seller
    // appends their REC token account, require it to be the real governance rec_mint,
    // owned by the seller, holding at least `energy_amount * 1_000` base units (REC mint
    // is 6-dec; 1 kWh = 1_000 units, matching the kWh-denominated `energy_amount` the ERC
    // check above uses). Omitting it leaves placement unchanged (backwards compatible).
    if let Some(rec_info) = ctx.remaining_accounts.first() {
        let rec_acct = InterfaceAccount::<anchor_spl::token_interface::TokenAccount>::try_from(
            rec_info,
        )
        .map_err(|_| error!(TradingError::InvalidRecMint))?;
        let (expected_mint, _) = Pubkey::find_program_address(&[b"rec_mint"], &governance::ID);
        require_keys_eq!(rec_acct.mint, expected_mint, TradingError::InvalidRecMint);
        require_keys_eq!(
            rec_acct.owner,
            ctx.accounts.authority.key(),
            TradingError::RecAccountOwnerMismatch
        );
        let required_rec = energy_amount
            .checked_mul(1_000)
            .ok_or(TradingError::Overflow)?;
        require!(
            rec_acct.amount >= required_rec,
            TradingError::InsufficientRecBalance
        );
    }

    // No redundant market load — price bounds already checked above.
    let mut zone_market = ctx.accounts.zone_market.load_mut()?;
    let mut order = ctx.accounts.order.load_init()?;

    order.seller = ctx.accounts.authority.key();
    order.buyer = Pubkey::default();
    order.order_id = order_id_val;
    order.amount = energy_amount;
    order.filled_amount = 0;
    order.price_per_kwh = price_per_kwh;
    order.order_type = OrderType::Sell as u8;
    order.status = OrderStatus::Active as u8;
    order.created_at = clock.unix_timestamp;
    order.expires_at = clock.unix_timestamp + 86400;

    zone_market.active_orders += 1;
    emit!(crate::events::SellOrderCreated {
        seller: ctx.accounts.authority.key(),
        order_id: ctx.accounts.order.key(),
        amount: energy_amount,
        price_per_kwh,
        timestamp: clock.unix_timestamp,
    });
    Ok(())
}
