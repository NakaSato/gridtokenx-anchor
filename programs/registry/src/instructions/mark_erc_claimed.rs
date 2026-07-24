use anchor_lang::prelude::*;

use crate::error::RegistryError;
use crate::events::*;
use crate::state::*;
use crate::bytes32_to_string;

#[derive(Accounts)]
pub struct MarkErcClaimed<'info> {
    #[account(mut)]
    pub meter_account: AccountLoader<'info, MeterAccount>,
    #[account(seeds = [b"registry"], bump)]
    pub registry: AccountLoader<'info, Registry>,
    pub authority: Signer<'info>,
}

pub fn mark_erc_claimed(ctx: Context<MarkErcClaimed>, amount: u64) -> Result<()> {
    let mut meter = ctx.accounts.meter_account.load_mut()?;

    // Authorization: registry authority ONLY. The sole caller is governance `issue_erc`
    // via CPI, which already forces its signer == registry.authority (issue_erc.rs
    // registry-authority cross-check), so no legitimate path needs oracle_authority here.
    // Accepting oracle_authority previously let the oracle key grief producers by
    // inflating claimed_erc_generation (denying future REC issuance / GRID settlement),
    // with no ERC minted. Dropped.
    let registry = ctx.accounts.registry.load()?;
    require!(
        ctx.accounts.authority.key() == registry.authority,
        RegistryError::UnauthorizedAuthority
    );

    // Bound ERC claims against NET generation (same base as do_settle_meter),
    // so combined GRID + ERC claims can never exceed net generation.
    let net_gen = meter
        .total_generation
        .saturating_sub(meter.total_consumption);
    let unclaimed = net_gen
        .saturating_sub(meter.claimed_erc_generation)
        .saturating_sub(meter.settled_net_generation);
    require!(amount <= unclaimed, RegistryError::NoUnsettledBalance);

    meter.claimed_erc_generation = meter.claimed_erc_generation.saturating_add(amount);

    emit!(ErcClaimed {
        meter_id: bytes32_to_string(&meter.meter_id),
        owner: meter.owner,
        amount,
        total_claimed: meter.claimed_erc_generation,
    });
    Ok(())
}
