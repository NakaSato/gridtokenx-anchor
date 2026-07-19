use anchor_lang::prelude::*;
use crate::error::TradingError;
use crate::state::*;

#[derive(Accounts)]
pub struct SetSettlementThbcMintContext<'info> {
    #[account(mut, has_one = authority)]
    pub market: AccountLoader<'info, Market>,
    pub authority: Signer<'info>,
}

/// Configure the settlement THBC mint for this market (admin only). Once set,
/// any match that settles in this mint MUST pass the treasury accounts so the
/// baht-denominated settlement is recorded — recording is no longer optional for
/// THBC-denominated trades. Pass `Pubkey::default()` is not allowed (use the real
/// THBC mint); to disable, this could be extended with a clear flag if ever needed.
pub fn set_settlement_thbc_mint(
    ctx: Context<SetSettlementThbcMintContext>,
    thbc_mint: Pubkey,
) -> Result<()> {
    require_keys_neq!(thbc_mint, Pubkey::default(), TradingError::TreasuryCurrencyMismatch);
    let mut market = ctx.accounts.market.load_mut()?;
    market.settlement_thbc_mint = thbc_mint;
    market.has_settlement_thbc_mint = 1;
    let now = Clock::get()?.unix_timestamp;
    emit!(crate::events::SettlementThbcMintSet {
        authority: ctx.accounts.authority.key(),
        thbc_mint,
        timestamp: now,
    });
    Ok(())
}
