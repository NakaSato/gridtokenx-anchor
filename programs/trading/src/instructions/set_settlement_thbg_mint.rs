use anchor_lang::prelude::*;
use crate::error::TradingError;
use crate::state::*;

#[derive(Accounts)]
pub struct SetSettlementThbgMintContext<'info> {
    #[account(mut, has_one = authority)]
    pub market: AccountLoader<'info, Market>,
    pub authority: Signer<'info>,
}

/// Configure the settlement THBG mint for this market (admin only). Once set,
/// any match that settles in this mint MUST pass the treasury accounts so the
/// baht-denominated settlement is recorded — recording is no longer optional for
/// THBG-denominated trades. Pass `Pubkey::default()` is not allowed (use the real
/// THBG mint); to disable, this could be extended with a clear flag if ever needed.
pub fn set_settlement_thbg_mint(
    ctx: Context<SetSettlementThbgMintContext>,
    thbg_mint: Pubkey,
) -> Result<()> {
    require_keys_neq!(thbg_mint, Pubkey::default(), TradingError::TreasuryCurrencyMismatch);
    let mut market = ctx.accounts.market.load_mut()?;
    market.settlement_thbg_mint = thbg_mint;
    market.has_settlement_thbg_mint = 1;
    let now = Clock::get()?.unix_timestamp;
    emit!(crate::events::SettlementThbgMintSet {
        authority: ctx.accounts.authority.key(),
        thbg_mint,
        timestamp: now,
    });
    Ok(())
}
