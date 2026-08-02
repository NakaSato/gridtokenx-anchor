use anchor_lang::prelude::*;
use crate::error::TradingError;
use crate::state::*;

#[derive(Accounts)]
pub struct SetSettlementEnergyMintContext<'info> {
    #[account(mut, has_one = authority)]
    pub market: AccountLoader<'info, Market>,
    pub authority: Signer<'info>,
}

/// Pin the energy mint this market is allowed to BURN on settlement (admin only).
///
/// `settle_offchain_match` retires the seller's energy instead of transferring it to
/// the buyer, and the escrow it burns from is derived `[b"escrow", user, energy_mint]`
/// off a mint the CALLER supplies. Unpinned, that lets the settlement authority point
/// the burn at any Token-2022 asset a user holds in escrow — the seller's Ed25519
/// payload binds their identity and amount, not the mint. So settlement refuses to burn
/// until this is set, and then only for this exact mint.
///
/// Deliberately fails closed: leaving it unset does not silently fall back to
/// "transfer instead" or "burn whatever was passed" — the settle path rejects with
/// `SettlementEnergyMintUnset`. Repo invariant #8, same lesson as the 2026-07-30
/// `retire_energy_tokens` fix.
pub fn set_settlement_energy_mint(
    ctx: Context<SetSettlementEnergyMintContext>,
    energy_mint: Pubkey,
) -> Result<()> {
    require_keys_neq!(energy_mint, Pubkey::default(), TradingError::InvalidEnergyMint);
    let mut market = ctx.accounts.market.load_mut()?;
    market.settlement_energy_mint = energy_mint;
    market.has_settlement_energy_mint = 1;
    let now = Clock::get()?.unix_timestamp;
    emit!(crate::events::SettlementEnergyMintSet {
        authority: ctx.accounts.authority.key(),
        energy_mint,
        timestamp: now,
    });
    Ok(())
}
