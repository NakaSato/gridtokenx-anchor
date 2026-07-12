use anchor_lang::prelude::*;

use crate::error::RegistryError;
use crate::events::*;
use crate::state::*;
use crate::{bytes32_to_string, shard_for};

#[derive(Accounts)]
pub struct SetMeterStatus<'info> {
    #[account(seeds = [b"registry"], bump)]
    pub registry: AccountLoader<'info, Registry>,

    #[account(mut)]
    pub meter_account: AccountLoader<'info, MeterAccount>,

    // Owner's shard — handler verifies shard_id == shard_for(meter.owner), so the
    // Active count moves on the same shard register_meter incremented.
    #[account(
        mut,
        seeds = [b"registry_shard".as_ref(), &[meter_account.load()?.owner.to_bytes()[0] % 16]],
        bump
    )]
    pub registry_shard: AccountLoader<'info, RegistryShard>,

    pub authority: Signer<'info>,
}

pub fn set_meter_status(ctx: Context<SetMeterStatus>, new_status: MeterStatus) -> Result<()> {
    let mut meter = ctx.accounts.meter_account.load_mut()?;
    let registry_acc = ctx.accounts.registry.load()?;
    let mut shard = ctx.accounts.registry_shard.load_mut()?;

    let is_owner = ctx.accounts.authority.key() == meter.owner;
    let is_admin = ctx.accounts.authority.key() == registry_acc.authority;
    require!(is_owner || is_admin, RegistryError::UnauthorizedUser);

    // Active counting lives on the owner's shard (see register_meter); the
    // global Registry stays read-only here and is reconciled via aggregate_shards.
    require!(
        shard.shard_id == shard_for(&meter.owner),
        RegistryError::InvalidShardId
    );

    let old_status = meter.status;

    // Inactive is terminal and owned solely by `deactivate_meter` (which also drops
    // meter_count + user.meter_count). `set_meter_status` only toggles the reversible
    // Active<->Maintenance states. It must NOT revive a deactivated meter (old ==
    // Inactive) — that would re-add active_meter_count without restoring meter_count,
    // leaving active_meter_count > meter_count — nor set Inactive itself (which would
    // drop active_meter_count but leave meter_count/user.meter_count overcounted).
    require!(
        old_status != MeterStatus::Inactive && new_status != MeterStatus::Inactive,
        RegistryError::InvalidMeterStatusTransition
    );

    if old_status == MeterStatus::Active && new_status != MeterStatus::Active {
        shard.active_meter_count = shard.active_meter_count.saturating_sub(1);
    } else if old_status != MeterStatus::Active && new_status == MeterStatus::Active {
        shard.active_meter_count = shard.active_meter_count.saturating_add(1);
    }

    meter.status = new_status;

    emit!(MeterStatusUpdated {
        meter_id: bytes32_to_string(&meter.meter_id),
        owner: meter.owner,
        old_status,
        new_status,
    });
    Ok(())
}
