use anchor_lang::prelude::*;

use crate::error::RegistryError;
use crate::events::*;
use crate::shard_for;
use crate::state::*;

#[derive(Accounts)]
#[instruction(user_type: UserType, lat_e7: i32, long_e7: i32, h3_index: u64, shard_id: u8)]
pub struct RegisterUser<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + std::mem::size_of::<UserAccount>(),
        seeds = [b"user", authority.key().as_ref()],
        bump
    )]
    pub user_account: AccountLoader<'info, UserAccount>,

    #[account(
        mut,
        seeds = [b"registry_shard".as_ref(), &[shard_id]],
        bump
    )]
    pub registry_shard: AccountLoader<'info, RegistryShard>,

    #[account(
        seeds = [b"registry"],
        bump,
    )]
    pub registry: AccountLoader<'info, Registry>,

    /// CHECK: The user's public key. Authorization checked in instruction body.
    pub authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn register_user(
    ctx: Context<RegisterUser>,
    user_type: UserType,
    lat_e7: i32,
    long_e7: i32,
    h3_index: u64,
    shard_id: u8,
) -> Result<()> {
    require!(shard_id < 16, RegistryError::InvalidShardId);
    // Shard is bound to the user's key — caller cannot scatter counts onto arbitrary shards.
    require!(
        shard_id == shard_for(&ctx.accounts.authority.key()),
        RegistryError::InvalidShardId
    );

    let registry = ctx.accounts.registry.load()?;

    // Authorization Check: Either the user signs for themselves, or the Registry Authority signs for them.
    // Note: `authority` is an `AccountInfo` instead of `Signer` because the admin can sign on behalf of the user.
    let is_user_signing = ctx.accounts.authority.is_signer;
    let is_admin_signing = ctx.accounts.payer.key() == registry.authority;

    require!(
        is_user_signing || is_admin_signing,
        RegistryError::UnauthorizedAuthority
    );

    let user_authority = ctx.accounts.authority.key();
    let now = Clock::get()?.unix_timestamp;
    let mut user_account = ctx.accounts.user_account.load_init()?;
    let mut shard = ctx.accounts.registry_shard.load_mut()?;

    user_account.authority = user_authority;
    user_account.user_type = user_type;
    user_account.lat_e7 = lat_e7;
    user_account.long_e7 = long_e7;
    user_account.h3_index = h3_index;
    user_account.status = UserStatus::Active;
    user_account.shard_id = shard_id;
    user_account.registered_at = now;
    user_account.meter_count = 0;
    user_account.airdrop_claimed = 0;

    shard.user_count = shard.user_count.checked_add(1).ok_or(RegistryError::MathOverflow)?;

    // The welcome airdrop is NOT minted here. A failed mint CPI would abort the
    // whole transaction (Solana cannot "swallow" a failed CPI), which would block
    // registration entirely. Registration must always succeed independently; the
    // airdrop is claimed separately via `claim_airdrop` and is safely retryable.
    emit!(UserRegistered {
        user: user_authority,
        user_type,
        lat_e7,
        long_e7,
        h3_index,
    });
    Ok(())
}
