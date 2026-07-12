use anchor_lang::prelude::*;

use crate::error::RegistryError;
use crate::events::*;
use crate::state::*;
use crate::bytes32_to_string;

#[derive(Accounts)]
pub struct DeactivateMeter<'info> {
    #[account(mut)]
    pub meter_account: AccountLoader<'info, MeterAccount>,

    // Bound to `owner` so the `meter_count` decrement can only ever hit the signer's
    // OWN UserAccount. Without this seed binding an attacker could pass a victim's
    // account and grief their meter_count down on each deactivate of an owned meter.
    #[account(
        mut,
        seeds = [b"user", owner.key().as_ref()],
        bump
    )]
    pub user_account: AccountLoader<'info, UserAccount>,

    #[account(seeds = [b"registry"], bump)]
    pub registry: AccountLoader<'info, Registry>,

    // Owner's shard — seeds bind to `owner` so the count is decremented on the
    // same shard `register_meter` incremented (shard = owner first byte % 16).
    #[account(
        mut,
        seeds = [b"registry_shard".as_ref(), &[owner.key().to_bytes()[0] % 16]],
        bump
    )]
    pub registry_shard: AccountLoader<'info, RegistryShard>,

    pub owner: Signer<'info>,
}

pub fn deactivate_meter(ctx: Context<DeactivateMeter>) -> Result<()> {
    let mut meter = ctx.accounts.meter_account.load_mut()?;
    let mut user = ctx.accounts.user_account.load_mut()?;
    let mut shard = ctx.accounts.registry_shard.load_mut()?;

    require_keys_eq!(
        ctx.accounts.owner.key(),
        meter.owner,
        RegistryError::UnauthorizedUser
    );

    require!(
        meter.status != MeterStatus::Inactive,
        RegistryError::AlreadyInactive
    );

    if meter.status == MeterStatus::Active {
        // Per-shard count; global total reconciled via aggregate_shards.
        shard.active_meter_count = shard.active_meter_count.saturating_sub(1);
    }

    meter.status = MeterStatus::Inactive;
    user.meter_count = user.meter_count.saturating_sub(1);
    // Meter leaves the registry — drop it from its owner's shard count so
    // aggregate_shards reflects live (non-deactivated) meters.
    shard.meter_count = shard.meter_count.saturating_sub(1);

    emit!(MeterDeactivated {
        meter_id: bytes32_to_string(&meter.meter_id),
        owner: meter.owner,
        final_generation: meter.total_generation,
        final_consumption: meter.total_consumption,
    });
    Ok(())
}
