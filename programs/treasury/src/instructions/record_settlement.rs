use anchor_lang::prelude::*;

use crate::error::TreasuryError;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
pub struct RecordSettlement<'info> {
    #[account(mut, seeds = [b"treasury"], bump)]
    pub treasury: AccountLoader<'info, Treasury>,

    /// The authorized settlement recorder — the trading market_authority PDA,
    /// passed as a signer via `invoke_signed` from the trading program.
    pub recorder: Signer<'info>,
}

/// Record a baht-denominated trade settlement. Called via CPI by the trading
/// program after it pays a seller in THBG; bumps the cumulative settled total.
/// Non-custodial — moves no funds. Authorized by the `settlement_recorder`
/// signer (the trading market_authority PDA), so only genuine trading
/// settlements can advance the counter.
///
/// Not independently replay-safe: this instruction has no per-call nullifier
/// of its own and relies on the caller (trading's per-match `TradeNullifier`,
/// see `settle_offchain.rs`) to guarantee it's never invoked twice for the
/// same match.
pub fn record_settlement(ctx: Context<RecordSettlement>, value: u64) -> Result<()> {
    require!(value > 0, TreasuryError::ZeroAmount);
    let now = Clock::get()?.unix_timestamp;
    let mut t = ctx.accounts.treasury.load_mut()?;
    require!(
        t.settlement_recorder == ctx.accounts.recorder.key(),
        TreasuryError::UnauthorizedRecorder
    );
    t.total_settled_thbg = t
        .total_settled_thbg
        .checked_add(value)
        .ok_or(TreasuryError::MathOverflow)?;
    emit!(SettlementRecorded {
        recorder: ctx.accounts.recorder.key(),
        value,
        total_settled_thbg: t.total_settled_thbg,
        timestamp: now,
    });
    Ok(())
}
