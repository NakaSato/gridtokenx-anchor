use anchor_lang::prelude::*;

use crate::error::RegistryError;
use crate::state::*;

#[derive(Accounts)]
pub struct AggregateShards<'info> {
    #[account(mut, seeds = [b"registry"], bump)]
    pub registry: AccountLoader<'info, Registry>,

    pub authority: Signer<'info>,
}

pub fn aggregate_shards(ctx: Context<AggregateShards>) -> Result<()> {
    let mut registry = ctx.accounts.registry.load_mut()?;
    require_keys_eq!(
        registry.authority,
        ctx.accounts.authority.key(),
        RegistryError::UnauthorizedAuthority
    );

    let mut total_users = 0u64;
    let mut total_meters = 0u64;
    let mut total_active_meters = 0u64;
    // Bitmask of shard_ids already counted — reject duplicates so a shard
    // passed twice cannot inflate the totals.
    let mut seen: u16 = 0;
    const SHARD_LEN: usize = std::mem::size_of::<RegistryShard>();

    for account_info in ctx.remaining_accounts.iter() {
        require_keys_eq!(*account_info.owner, crate::ID, RegistryError::UnauthorizedAuthority);

        let shard_data = account_info.try_borrow_data()?;
        if shard_data.len() >= 8 + SHARD_LEN {
            let shard = RegistryShard::load_from_bytes(&shard_data[8..8 + SHARD_LEN])?;

            // Validate via the stored canonical bump (create_program_address ~1,651 CU)
            // instead of re-deriving with find_program_address (~12,136 CU).
            let expected_pda = Pubkey::create_program_address(
                &[b"registry_shard", &[shard.shard_id], &[shard.bump]], &crate::ID
            ).map_err(|_| RegistryError::UnauthorizedAuthority)?;
            require_keys_eq!(account_info.key(), expected_pda, RegistryError::UnauthorizedAuthority);

            let bit = 1u16 << shard.shard_id;
            require!(seen & bit == 0, RegistryError::DuplicateShard);
            seen |= bit;

            total_users = total_users
                .checked_add(shard.user_count)
                .ok_or(RegistryError::MathOverflow)?;
            total_meters = total_meters
                .checked_add(shard.meter_count)
                .ok_or(RegistryError::MathOverflow)?;
            total_active_meters = total_active_meters
                .checked_add(shard.active_meter_count)
                .ok_or(RegistryError::MathOverflow)?;
        }
    }

    registry.user_count = total_users;
    registry.meter_count = total_meters;
    registry.active_meter_count = total_active_meters;
    Ok(())
}
