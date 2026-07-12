use anchor_lang::prelude::*;

use crate::do_settle_meter;
use crate::state::*;

#[derive(Accounts)]
pub struct IsValidUser<'info> {
    pub user_account: AccountLoader<'info, UserAccount>,
}

#[derive(Accounts)]
pub struct IsValidMeter<'info> {
    pub meter_account: AccountLoader<'info, MeterAccount>,
}

#[derive(Accounts)]
pub struct GetUnsettledBalance<'info> {
    pub meter_account: AccountLoader<'info, MeterAccount>,
}

#[derive(Accounts)]
pub struct SettleMeterBalance<'info> {
    #[account(mut)]
    pub meter_account: AccountLoader<'info, MeterAccount>,

    pub meter_owner: Signer<'info>,
}

/// Verify if a user is valid and active
pub fn is_valid_user(ctx: Context<IsValidUser>) -> Result<bool> {
    let user_account = ctx.accounts.user_account.load()?;
    Ok(user_account.status == UserStatus::Active)
}

/// Verify if a meter is valid and active
pub fn is_valid_meter(ctx: Context<IsValidMeter>) -> Result<bool> {
    let meter_account = ctx.accounts.meter_account.load()?;
    Ok(meter_account.status == MeterStatus::Active)
}

/// Calculate unsettled net generation ready for tokenization
pub fn get_unsettled_balance(ctx: Context<GetUnsettledBalance>) -> Result<u64> {
    let meter = ctx.accounts.meter_account.load()?;

    // Calculate current net generation (total produced - total consumed)
    let current_net_gen = meter
        .total_generation
        .saturating_sub(meter.total_consumption);

    // Calculate how much hasn't been tokenized yet
    Ok(current_net_gen.saturating_sub(meter.settled_net_generation))
}

/// Settle meter balance and prepare for GRID token minting
pub fn settle_meter_balance(ctx: Context<SettleMeterBalance>) -> Result<u64> {
    let mut meter = ctx.accounts.meter_account.load_mut()?;
    let res = do_settle_meter(&mut meter, ctx.accounts.meter_owner.key())?;
    Ok(res)
}
