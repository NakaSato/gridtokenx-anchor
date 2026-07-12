use anchor_lang::prelude::*;

use crate::error::RegistryError;
use crate::events::*;
use crate::state::*;
use crate::{shard_for, string_to_bytes32};

#[derive(Accounts)]
#[instruction(meter_id: String, meter_type: MeterType, shard_id: u8)]
pub struct RegisterMeter<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + std::mem::size_of::<MeterAccount>(),
        seeds = [b"meter", owner.key().as_ref(), meter_id.as_bytes()],
        bump
    )]
    pub meter_account: AccountLoader<'info, MeterAccount>,

    #[account(
        mut,
        seeds = [b"user", owner.key().as_ref()],
        bump
    )]
    pub user_account: AccountLoader<'info, UserAccount>,

    #[account(
        mut,
        seeds = [b"registry_shard".as_ref(), &[shard_id]],
        bump
    )]
    pub registry_shard: AccountLoader<'info, RegistryShard>,

    // Read-only on purpose: a `mut` here would take a Sealevel write lock on the
    // global Registry for every registration, serializing the hot path.
    #[account(seeds = [b"registry"], bump)]
    pub registry: AccountLoader<'info, Registry>,

    /// CHECK: The user's wallet pubkey. Non-signing in the custodial-bridge model
    /// (the user's key is Vault-custodied; the bridge's `payer` funds + signs).
    /// Safe: the handler enforces `owner == user_account.authority` and the
    /// meter/user PDAs are seeded by `owner.key()`, so a meter can only ever be
    /// created under its true owner's registered account.
    pub owner: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn register_meter(
    ctx: Context<RegisterMeter>,
    meter_id: String,
    meter_type: MeterType,
    shard_id: u8,
    zone_id: i32,
) -> Result<()> {
    require!(shard_id < 16, RegistryError::InvalidShardId);
    require!(zone_id >= 0, RegistryError::InvalidZone);
    let owner = ctx.accounts.owner.key();
    // Meter co-locates on its owner's shard.
    require!(shard_id == shard_for(&owner), RegistryError::InvalidShardId);

    let mut meter_account = ctx.accounts.meter_account.load_init()?;
    let mut user_account = ctx.accounts.user_account.load_mut()?;
    let mut shard = ctx.accounts.registry_shard.load_mut()?;

    require!(
        user_account.status == UserStatus::Active,
        RegistryError::UnauthorizedUser
    );

    // Basic owner-user validation (though PDA seeds also protect this)
    require_keys_eq!(
        owner,
        user_account.authority,
        RegistryError::UnauthorizedUser
    );

    require!(meter_id.len() <= 32, RegistryError::InvalidMeterId);

    meter_account.meter_id = string_to_bytes32(&meter_id);
    meter_account.owner = owner;
    meter_account.meter_type = meter_type;
    meter_account.status = MeterStatus::Active;
    meter_account.zone_id = zone_id;
    meter_account.registered_at = Clock::get()?.unix_timestamp;
    meter_account.last_reading_at = 0;
    meter_account.total_generation = 0;
    meter_account.total_consumption = 0;
    meter_account.settled_net_generation = 0;
    meter_account.claimed_erc_generation = 0;

    user_account.meter_count = user_account.meter_count.checked_add(1).ok_or(RegistryError::MathOverflow)?;
    shard.meter_count = shard.meter_count.checked_add(1).ok_or(RegistryError::MathOverflow)?;
    // New meters are created Active — count on the shard, NOT the global Registry.
    // Writing the global account here would take a write lock on every registration
    // and serialize the hot path; aggregate_shards reconciles the global total.
    shard.active_meter_count = shard.active_meter_count.checked_add(1).ok_or(RegistryError::MathOverflow)?;

    emit!(MeterRegistered {
        meter_id: meter_id.clone(),
        owner,
        meter_type,
    });
    Ok(())
}
